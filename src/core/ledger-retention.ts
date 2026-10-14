/**
 * Ledger retention — the bound on the ledger's own footprint.
 *
 * `rotate.ts` caps capture logs; nothing capped `ledger/`. Measured 2026-09-11 on a development host after
 * 18 unattended days: 18 day files, 62.9 MB, 3.4–4.5 MB/day and rising with fleet size, while the
 * directory rotate.ts protected held 8 KB. An append-only file with no bound, in a process whose
 * docstring says it runs for days, fails the resource-bounds requirement at any write rate — our production predecessor reached
 * a 345 MB single log and a 38 GB sqlite before anyone noticed.
 *
 * Two rules, both deliberate departures from rotate.ts:
 *   1. ARCHIVE, NEVER DELETE by default. A day file older than `keepDays` is gzip-archived to
 *      `ledger/archive/events-YYYY-MM-DD.ndjson.gz` — verified byte-identical before the original
 *      goes — so no history is ever lost to a default. Deleting archives is an explicit opt-in
 *      (`deleteAfterDays`), clamped so it can never reach a live day. Capture logs stay
 *      uncompressed because a human must grep them with zero tooling; the ledger's consumers are
 *      programs, and `zcat | jq` is the whole toolchain for a cold day.
 *   2. Readers see LIVE days only. LedgerIndex, wasteReport and /api/timeline list
 *      `ledger/*.ndjson`; an archived day is out of the analytics window by definition (a
 *      long-running LedgerIndex keeps what it already ingested until its process restarts).
 *
 * Today's file is never touched (the writer is appending to it): keepDays is clamped to ≥ 1.
 * Never throws into the writer's path — an observability layer must not break the thing it
 * observes; a file another process archived first is skipped and the next sweep retries the rest.
 */
import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

export interface LedgerRetention {
  /** day files older than this many days are archived; today's never is (clamped to ≥ 1) */
  keepDays: number;
  /** archives older than this many days are unlinked; 0 = never (the default); clamped to ≥ keepDays */
  deleteAfterDays: number;
}

export const DEFAULT_RETENTION: LedgerRetention = { keepDays: 30, deleteAfterDays: 0 };

export interface SweepResult {
  /** live day files moved into archive/, oldest first ("events-2026-08-01.ndjson") */
  archived: string[];
  /** archive files unlinked under deleteAfterDays, oldest first */
  deleted: string[];
  /** raw bytes of the archived files, and their compressed size — what the sweep saved */
  bytesBefore: number;
  bytesAfter: number;
  /** files skipped because a step failed (full disk, unreadable file); counted, never thrown */
  errors: number;
}

/** What the ledger occupies — served on /api/health and `doctor`, judged by the H3 `ledger` rule. */
export interface LedgerFootprint {
  /** bytes of live day files in ledger/ — the number keepDays controls */
  bytes: number;
  files: number;
  oldestDay: string | null;
  newestDay: string | null;
  avgBytesPerDay: number;
  /** ledger/archive/*.ndjson.gz, counted separately: compressed history, not the live window */
  archiveBytes: number;
  archiveFiles: number;
}

const DAY_FILE = /^events-(\d{4}-\d{2}-\d{2})\.ndjson$/;
const ARCHIVE_FILE = /^events-(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/;
const DAY_MS = 86_400_000;

/** Whole UTC days between a day file's date and `now`; null when the name is not a real date. */
function ageDays(day: string, now: Date): number | null {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - t) / DAY_MS);
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return []; // no ledger yet, or no archive yet — an empty set, not an error
  }
}

export function ledgerFootprint(dir: string): LedgerFootprint {
  let bytes = 0, files = 0, archiveBytes = 0, archiveFiles = 0;
  const days: string[] = [];
  for (const f of listDir(dir)) {
    const m = DAY_FILE.exec(f);
    if (!m) continue;
    try {
      bytes += statSync(join(dir, f)).size;
    } catch {
      continue; // archived between readdir and stat
    }
    files++;
    days.push(m[1]);
  }
  for (const f of listDir(join(dir, "archive"))) {
    if (!ARCHIVE_FILE.test(f)) continue;
    try {
      archiveBytes += statSync(join(dir, "archive", f)).size;
      archiveFiles++;
    } catch {
      /* deleted between readdir and stat */
    }
  }
  days.sort();
  return {
    bytes,
    files,
    oldestDay: days[0] ?? null,
    newestDay: days[days.length - 1] ?? null,
    avgBytesPerDay: files ? Math.round(bytes / files) : 0,
    archiveBytes,
    archiveFiles,
  };
}

/**
 * The DATES of the archived days present under `dir`/archive, oldest first — the history rule 2 above
 * declined to open. Names only: nothing here decompresses an archive, so a reader can say which days it
 * left out at the cost of one readdir. `ledgerFootprint` counts the same files; this answers
 * *which*, because "2 archived days" without their dates is not something an operator can act on.
 */
export function archivedDays(dir: string): string[] {
  const days: string[] = [];
  for (const f of listDir(join(dir, "archive"))) {
    const m = ARCHIVE_FILE.exec(f);
    if (m) days.push(m[1]);
  }
  return days.sort();
}

/**
 * One retention pass over `dir`. `now` is injectable so a test can pin the day boundary;
 * production callers never pass it.
 */
export function sweepLedger(dir: string, retention: LedgerRetention = DEFAULT_RETENTION, now = new Date()): SweepResult {
  const keep = Math.max(1, Math.floor(retention.keepDays));
  const del = retention.deleteAfterDays > 0 ? Math.max(keep, Math.floor(retention.deleteAfterDays)) : 0;
  const out: SweepResult = { archived: [], deleted: [], bytesBefore: 0, bytesAfter: 0, errors: 0 };
  const archiveDir = join(dir, "archive");

  for (const f of listDir(dir)) {
    const m = DAY_FILE.exec(f);
    if (!m) continue;
    const age = ageDays(m[1], now);
    if (age === null || age < keep) continue;
    const src = join(dir, f);
    try {
      mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      const raw = readFileSync(src);
      const gz = gzipSync(raw);
      // write, re-read, compare, THEN rename into place, THEN unlink: a truncated or torn archive
      // must never be what replaces real data. The tmp name is per-process so two sweeps racing
      // on the same day file cannot clobber each other's partial write.
      const tmp = join(archiveDir, `.${f}.${process.pid}.tmp`);
      writeFileSync(tmp, gz, { mode: 0o600 });
      if (!gunzipSync(readFileSync(tmp)).equals(raw)) {
        unlinkSync(tmp);
        out.errors++;
        continue;
      }
      renameSync(tmp, join(archiveDir, `${f}.gz`));
      // whoever unlinks the original claims the move: a racing sweep that lost finds ENOENT here
      // and reports nothing — the data is archived exactly once either way
      try {
        unlinkSync(src);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      out.archived.push(f);
      out.bytesBefore += raw.length;
      out.bytesAfter += gz.length;
    } catch {
      out.errors++; // never propagate: retention failure must not stop the ledger
    }
  }

  if (del > 0) {
    for (const f of listDir(archiveDir)) {
      const m = ARCHIVE_FILE.exec(f);
      if (!m) continue;
      const age = ageDays(m[1], now);
      if (age === null || age < del) continue;
      try {
        unlinkSync(join(archiveDir, f));
        out.deleted.push(f);
      } catch {
        out.errors++;
      }
    }
  }
  return out;
}
