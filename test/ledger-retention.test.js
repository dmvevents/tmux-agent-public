/**
 * Ledger retention + footprint — gate G3 "resource bounds" for the ledger itself.
 *
 * Measured 2026-09-11 on this host's own ~/.tmux-agent after 18 unattended days: `ledger/` held
 * 18 day files, 62.9 MB, 3.4–4.5 MB/day and rising with fleet size; `rotate.ts` bounded the 8 KB
 * of capture logs and nothing bounded the 60 MB of ledger — `Ledger.emit` opened a new day file
 * forever, nothing archived, compressed or counted them. This file is the check that FAILS if
 * the bound is removed:
 *   - a sweep archives day files older than `keepDays` to `ledger/archive/*.ndjson.gz`,
 *     byte-identical once gunzipped, and NEVER unlinks data unless `deleteAfterDays` is set —
 *     the total file count (live + archive) is conserved;
 *   - the sweep is idempotent (a second pass moves nothing and ledgers nothing) and ledgers
 *     exactly one `ledger.archived` per pass that moved something;
 *   - the production trigger is the first write of a new UTC day (the dashboard's health tick
 *     calls the same method, at most once per day per process);
 *   - readers (`wasteReport`, `LedgerIndex`) see live days only — an archived day is out of the
 *     analytics window by definition;
 *   - `ledgerFootprint` reports live and archived bytes exactly (what /api/health and doctor serve).
 * Watched FAIL first on HEAD 2ff8b5a: no ledger-retention module, `Ledger` had no `sweep()`, 40
 * planted day files stayed 40 live (output on TMUX-90). End-to-end (/api/health.ledger + doctor
 * against planted files) is test/smoke-web.sh step 27; the H3 `ledger` rule is in
 * test/healthwatch.test.js.
 *
 * Error paths. The sweep has four paths a healthy host never takes — the archive verify
 * finding the re-read tmp differs from the source (dist 128-131), the unlink after the rename finding
 * ENOENT because a racing sweep claimed the move (139-142), the outer catch (148-149) and the delete
 * loop's catch (164-165) — and until this card no case drove them: raw V8 dumps of all 520 processes
 * that loaded dist/core/ledger-retention.js during one `npm run test:coverage` (2026-10-01, scratch/
 * ga-fire-2026-10-01-10Z/v8scan-1.log) carry count 0 on every one of them. The reads that printed the
 * row at 100.00 were node's merge (lib/internal/test_runner/coverage.js mergeCoverageRanges) dropping
 * the zero-count blocks: a daemon whose startup health tick sweeps an EMPTY ledger directory (a bare
 * home, before its first write) reports a zero-count loop body whose offsets equal this file's covered
 * loop body, the exact match ends the inner loop, and the nested zero blocks are never re-added. The
 * cases below drive each path on purpose, in-process: `fs` is patched for one call shape and carried
 * into dist/'s `import { … } from "node:fs"` bindings by module.syncBuiltinESMExports() (measured on
 * node 22: without the call the built module keeps the originals), restored in `finally`; a patch
 * that never bit reds its case rather than passing it vacuously. FAIL-first on the parent 436b04f:
 * `grep -c 'errors, [1-9]' test/ledger-retention.test.js` read 0 and the file alone read the row at
 * 85.80 / 79.49 / 80.00 with 128-131 139-142 148-149 164-165 uncovered; after, 100.00 / 100.00 / 100.00.
 *
 * Run: node --test test/ledger-retention.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync, symlinkSync, lstatSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

import { Ledger } from "../dist/core/ledger.js";
import { sweepLedger, ledgerFootprint, archivedDays, DEFAULT_RETENTION } from "../dist/core/ledger-retention.js";
import { wasteReport } from "../dist/analytics/status.js";
import { LedgerIndex } from "../dist/analytics/ledger-index.js";

const DAY_MS = 86_400_000;
const dayStr = (daysAgo, now) => new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
const ev = (day, i, session = "s", extra = {}) =>
  JSON.stringify({ v: 1, ts: `${day}T12:00:00.000Z`, type: "session.state", session, data: { to: i % 2 ? "WORKING" : "IDLE", pad: "x".repeat(40 + i) }, ...extra }) + "\n";
/** One day file `daysAgo` days before `now`, with content unique to that day. Returns its name and bytes. */
function plant(dir, daysAgo, now, lines = 5, session = "s") {
  const day = dayStr(daysAgo, now);
  const body = Array.from({ length: lines }, (_, i) => ev(day, i + daysAgo, session)).join("");
  const name = `events-${day}.ndjson`;
  writeFileSync(join(dir, name), body, { mode: 0o600 });
  return { name, day, body: Buffer.from(body) };
}
const live = (dir) => readdirSync(dir).filter((f) => /^events-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort();
const archived = (dir) => (existsSync(join(dir, "archive")) ? readdirSync(join(dir, "archive")).filter((f) => f.endsWith(".ndjson.gz")).sort() : []);
const eventsOfType = (dir, type) =>
  live(dir)
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
    .filter((e) => e.type === type);
const fresh = () => mkdtempSync(join(tmpdir(), "ta-ret-"));

test("retention: 40 day files, keepDays 30 → one sweep leaves 30 live + 10 gzip archives, byte-identical; a second sweep moves and ledgers nothing; nothing is ever unlinked by default", () => {
  const dir = fresh();
  try {
    const now = new Date();
    const planted = new Map();
    for (let age = 0; age < 40; age++) { const p = plant(dir, age, now); planted.set(p.name, p.body); }
    assert.equal(live(dir).length, 40, "precondition: 40 live day files planted");

    const l = new Ledger(dir);
    l.retention = { keepDays: 30, deleteAfterDays: 0 };
    const r = l.sweep(true, now);
    assert.ok(r, "sweep(force) must run and report");
    assert.equal(live(dir).length, 30, `30 live day files expected after the sweep, got ${live(dir).length}`);
    assert.equal(archived(dir).length, 10, `10 archives expected, got ${archived(dir).length}: ${archived(dir).join(",")}`);
    assert.deepEqual(r.archived, Array.from({ length: 10 }, (_, i) => `events-${dayStr(39 - i, now)}.ndjson`), "exactly the 10 oldest days were archived, oldest first");
    assert.deepEqual(r.deleted, [], "deleteAfterDays 0 → nothing deleted");
    assert.equal(live(dir).length + archived(dir).length, 40, "total file count (live + archive) is conserved — nothing was unlinked");

    // every archive gunzips to exactly the bytes that were planted; live files are untouched
    let rawSum = 0, gzSum = 0;
    for (const gz of archived(dir)) {
      const name = gz.slice(0, -3);
      const p = join(dir, "archive", gz);
      assert.equal(statSync(p).mode & 0o777, 0o600, `${gz} must not be world-readable`);
      const back = gunzipSync(readFileSync(p));
      assert.ok(back.equals(planted.get(name)), `${gz} does not gunzip to the planted ${name}`);
      rawSum += planted.get(name).length; gzSum += statSync(p).size;
    }
    assert.equal(statSync(join(dir, "archive")).mode & 0o777, 0o700, "archive/ must be 0700 like the home");
    for (const f of live(dir)) {
      // today's file also carries the ledger.archived event; every other live file is byte-identical
      if (f === `events-${dayStr(0, now)}.ndjson`) continue;
      assert.ok(readFileSync(join(dir, f)).equals(planted.get(f)), `${f} was altered by the sweep`);
    }
    assert.equal(r.bytesBefore, rawSum, "bytesBefore = raw bytes of the moved files");
    assert.equal(r.bytesAfter, gzSum, "bytesAfter = compressed bytes of the moved files");

    // exactly one ledger.archived for the effective sweep, naming what moved
    const evs = eventsOfType(dir, "ledger.archived");
    assert.equal(evs.length, 1, `exactly one ledger.archived expected, got ${evs.length}`);
    assert.deepEqual(evs[0].data.files, r.archived);
    assert.equal(evs[0].data.bytesBefore, rawSum);
    assert.equal(evs[0].data.bytesAfter, gzSum);

    // idempotent: nothing left to move, nothing ledgered
    const r2 = l.sweep(true, now);
    assert.deepEqual([r2.archived, r2.deleted], [[], []], "second sweep must move nothing");
    assert.equal(live(dir).length, 30);
    assert.equal(archived(dir).length, 10);
    assert.equal(eventsOfType(dir, "ledger.archived").length, 1, "second sweep must not ledger a second event");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention: the first write of a new day triggers the sweep; the same process never sweeps twice in a day", () => {
  const dir = fresh();
  try {
    // ages chosen far from the 30-day boundary so a midnight rollover during the test cannot move a file across it
    const now = new Date();
    for (const age of [1, 2, 3, 4, 5]) plant(dir, age, now);
    for (const age of [35, 36, 37, 38, 39, 40]) plant(dir, age, now);
    assert.equal(live(dir).length, 11);
    assert.ok(!existsSync(join(dir, `events-${dayStr(0, now)}.ndjson`)), "precondition: today's file does not exist yet");

    const l = new Ledger(dir); // defaults: keepDays 30, never delete
    assert.deepEqual(l.retention, DEFAULT_RETENTION);
    l.emit({ type: "session.spawned", session: "trigger", parent: "t" });
    assert.equal(archived(dir).length, 6, "the new day's first write must archive the six 35–40-day-old files");
    assert.equal(live(dir).length, 6, "five recent days + today stay live");
    assert.equal(eventsOfType(dir, "ledger.archived").length, 1);

    // plant another old file: a later write on the SAME day must not sweep again (once per day per process)
    plant(dir, 41, now);
    l.emit({ type: "input.sent", session: "trigger" });
    assert.equal(archived(dir).length, 6, "a second write on the same day must not run another sweep");
    assert.equal(eventsOfType(dir, "ledger.archived").length, 1);
    // ...until asked to (the health tick's path when the day has not rolled: a no-op; forced here to prove it still works)
    l.sweep(true, now);
    assert.equal(archived(dir).length, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention: deleteAfterDays is an explicit opt-in — archives older than it are unlinked and named in the event; it never reaches below keepDays", () => {
  const dir = fresh();
  try {
    const now = new Date();
    for (let age = 0; age < 40; age++) plant(dir, age, now);
    const r = sweepLedger(dir, { keepDays: 30, deleteAfterDays: 35 }, now);
    assert.equal(r.archived.length, 10);
    assert.equal(live(dir).length, 30);
    assert.deepEqual(r.deleted, Array.from({ length: 5 }, (_, i) => `events-${dayStr(39 - i, now)}.ndjson.gz`), "ages 35–39 deleted, oldest first");
    assert.equal(archived(dir).length, 5, "ages 30–34 stay archived");

    // a delete horizon shorter than keepDays is clamped to keepDays: a typo cannot delete live history
    const dir2 = fresh();
    try {
      for (let age = 0; age < 40; age++) plant(dir2, age, now);
      const r2 = sweepLedger(dir2, { keepDays: 30, deleteAfterDays: 5 }, now);
      assert.equal(live(dir2).length, 30, "live files are never deleted");
      assert.equal(r2.deleted.length, 10, "every archived day is at or past the clamped horizon");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention: readers see live days only — an archived day that would top the waste ranking is invisible to wasteReport and LedgerIndex", () => {
  const dir = fresh();
  try {
    const now = new Date();
    const today = plant(dir, 0, now, 2, "live");
    // an archived day carrying 50 ERROR transitions for a ghost session: on the live path it would rank first
    const oldDay = dayStr(45, now);
    const ghost = Array.from({ length: 50 }, (_, i) => ev(oldDay, i, "ghost", { data: { to: "ERROR" } })).join("");
    mkdirSync(join(dir, "archive"), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "archive", `events-${oldDay}.ndjson.gz`), gzipSync(ghost), { mode: 0o600 });

    const waste = wasteReport(dir);
    assert.deepEqual(waste.map((r) => r.session), ["live"], `wasteReport must see live days only, saw ${JSON.stringify(waste.map((r) => r.session))}`);
    assert.equal(waste[0].events, 2, "the live day is still counted exactly");
    const idx = new LedgerIndex(dir, 0);
    assert.deepEqual(idx.sessions(true).map((r) => r.session), ["live"], "LedgerIndex must see live days only");
    assert.equal(idx.sessions(true)[0].events, 2);

    const fp = ledgerFootprint(dir);
    assert.equal(fp.files, 1);
    assert.equal(fp.bytes, today.body.length);
    assert.equal(fp.archiveFiles, 1);
    assert.equal(fp.archiveBytes, statSync(join(dir, "archive", `events-${oldDay}.ndjson.gz`)).size, "archive bytes are counted separately, never mixed into the live figure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention: ledgerFootprint is exact — bytes, files, oldest/newest day, average — and honest on an empty or absent ledger", () => {
  const dir = fresh();
  try {
    assert.deepEqual(ledgerFootprint(join(dir, "nope")), { bytes: 0, files: 0, oldestDay: null, newestDay: null, avgBytesPerDay: 0, archiveBytes: 0, archiveFiles: 0 }, "absent dir → zeros, never a throw");
    assert.deepEqual(ledgerFootprint(dir).files, 0, "empty dir → zero files");
    const now = new Date();
    const a = plant(dir, 3, now, 3), b = plant(dir, 2, now, 7), c = plant(dir, 1, now, 11);
    writeFileSync(join(dir, "notes.txt"), "not a day file"); // ignored: only events-YYYY-MM-DD.ndjson counts
    const sum = a.body.length + b.body.length + c.body.length;
    const fp = ledgerFootprint(dir);
    assert.equal(fp.bytes, sum);
    assert.equal(fp.files, 3);
    assert.equal(fp.oldestDay, a.day);
    assert.equal(fp.newestDay, c.day);
    assert.equal(fp.avgBytesPerDay, Math.round(sum / 3));
    assert.equal(fp.archiveBytes, 0);
    assert.equal(fp.archiveFiles, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention: never touches today's file or non-day files, never throws — keepDays 0 clamps to 1, an absent dir is an empty sweep", () => {
  const dir = fresh();
  try {
    const now = new Date();
    plant(dir, 0, now);
    plant(dir, 1, now);
    writeFileSync(join(dir, "notes.txt"), "keep me");
    writeFileSync(join(dir, "events-2026-13-99.ndjson"), "not a real date — left alone\n");
    const r = sweepLedger(dir, { keepDays: 0, deleteAfterDays: 0 }, now);
    assert.deepEqual(r.archived, [`events-${dayStr(1, now)}.ndjson`], "keepDays 0 behaves as 1: yesterday archives, today never does (the writer is appending to it)");
    assert.ok(existsSync(join(dir, `events-${dayStr(0, now)}.ndjson`)), "today's file untouched");
    assert.ok(existsSync(join(dir, "notes.txt")) && existsSync(join(dir, "events-2026-13-99.ndjson")), "non-day files untouched");
    assert.equal(r.errors, 0);
    assert.deepEqual(sweepLedger(join(dir, "absent"), DEFAULT_RETENTION, now), { archived: [], deleted: [], bytesBefore: 0, bytesAfter: 0, errors: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── TMUX-186: the error paths, driven on purpose ──────────────────────────────────────────────────────────────────────

/**
 * Run `fn` with each named `fs` function replaced by `wrap(real)`, carried into the built module's
 * `import { … } from "node:fs"` bindings by syncBuiltinESMExports() — the patch on the CJS object alone
 * never reaches dist/ (measured on node 22) — and restored (and re-synced) in `finally`, so nothing
 * leaks into the next case or into the runner. Every wrapper below passes through untouched unless the
 * path is the one it plants on, and counts its bites: a plant that never bit is a vacuous case.
 */
function withFs(patches, fn) {
  const real = Object.fromEntries(Object.keys(patches).map((k) => [k, fs[k]]));
  for (const [k, wrap] of Object.entries(patches)) fs[k] = wrap(real[k]);
  syncBuiltinESMExports();
  try {
    return fn();
  } finally {
    Object.assign(fs, real);
    syncBuiltinESMExports();
  }
}
const planted = (code, syscall, path) => Object.assign(new Error(`${code}: planted by ledger-retention.test.js, ${syscall} '${path}'`), { code, syscall, path });

test("retention (a): a torn archive — the re-read tmp gunzips to bytes that differ from the source → errors 1, the day stays live and byte-identical, no .gz for it, the .tmp gone, the sweep continues to the next file and the next sweep finishes it", () => {
  const dir = fresh();
  try {
    const now = new Date();
    const torn = plant(dir, 36, now, 4); // readdirSync(dir).sort() walks the oldest day first: the torn one comes before the good one
    const good = plant(dir, 35, now, 3);
    plant(dir, 0, now);
    let bit = 0;
    const r = withFs({
      // the sweep writes gzip(raw) to a per-pid .tmp and re-reads it; this write lands a VALID gzip of raw minus its last byte — a torn
      // write that still decompresses, which only the byte-compare can catch
      writeFileSync: (real) => (p, data, opts) => {
        if (String(p).startsWith(join(dir, "archive", `.${torn.name}.`))) { bit++; return real.call(fs, p, gzipSync(gunzipSync(data).subarray(0, -1)), opts); }
        return real.call(fs, p, data, opts);
      },
    }, () => sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now));
    assert.equal(bit, 1, "the plant must bite exactly once — the torn day's tmp");
    assert.equal(r.errors, 1, `one error for the torn archive, got ${r.errors}`);
    assert.deepEqual(r.archived, [good.name], "the sweep continued past the torn file and archived the next one");
    assert.ok(readFileSync(join(dir, torn.name)).equals(torn.body), "the torn day stays live and byte-identical — a torn archive never replaces real data");
    assert.deepEqual(archived(dir), [`${good.name}.gz`], "no .gz exists for the torn day");
    assert.deepEqual(readdirSync(join(dir, "archive")).filter((f) => f.endsWith(".tmp")), [], "the torn .tmp was unlinked");
    assert.ok(gunzipSync(readFileSync(join(dir, "archive", `${good.name}.gz`))).equals(good.body), "the good day's archive is byte-identical");
    assert.equal(r.bytesBefore, good.body.length, "bytes count only what was moved");
    // the next sweep, unpatched, archives the day the torn write held back
    const r2 = sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now);
    assert.deepEqual([r2.archived, r2.errors], [[torn.name], 0], "the next sweep retries the torn day and succeeds");
    assert.ok(gunzipSync(readFileSync(join(dir, "archive", `${torn.name}.gz`))).equals(torn.body));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention (b): a racing sweep claims the move — the source is unlinked between this sweep's rename and its unlink → errors 0, the day NOT in archived, its .gz present and byte-identical, nothing archived twice", () => {
  const dir = fresh();
  try {
    const now = new Date();
    const raced = plant(dir, 36, now, 4);
    const own = plant(dir, 35, now, 3);
    plant(dir, 0, now);
    let bit = 0;
    const r = withFs({
      // the other sweep wins: the instant this sweep's rename lands the .gz, the original is already gone
      renameSync: (real) => (from, to) => {
        const out = real.call(fs, from, to);
        if (String(to) === join(dir, "archive", `${raced.name}.gz`)) { bit++; fs.unlinkSync(join(dir, raced.name)); }
        return out;
      },
    }, () => sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now));
    assert.equal(bit, 1, "the plant must bite exactly once — the raced day's rename");
    assert.equal(r.errors, 0, `a lost race is not an error, got ${r.errors}`);
    assert.deepEqual(r.archived, [own.name], "only the day this sweep's own unlink claimed is reported");
    assert.deepEqual(archived(dir), [`${raced.name}.gz`, `${own.name}.gz`].sort(), "both days are archived, each exactly once");
    assert.ok(gunzipSync(readFileSync(join(dir, "archive", `${raced.name}.gz`))).equals(raced.body), "the raced day's archive is byte-identical");
    assert.deepEqual(live(dir), [`events-${dayStr(0, now)}.ndjson`], "neither old day is live");
    assert.equal(r.bytesBefore, own.body.length, "bytes count only what this sweep claimed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention (b′): an unlink that fails for any reason but ENOENT is counted, not skipped — errors 1, the day both live and archived (nothing lost), the next sweep finishes the move", () => {
  const dir = fresh();
  try {
    const now = new Date();
    const stuck = plant(dir, 36, now, 4);
    const own = plant(dir, 35, now, 3);
    plant(dir, 0, now);
    let bit = 0;
    const r = withFs({
      unlinkSync: (real) => (p) => {
        if (String(p) === join(dir, stuck.name)) { bit++; throw planted("EPERM", "unlink", p); }
        return real.call(fs, p);
      },
    }, () => sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now));
    assert.equal(bit, 1, "the plant must bite exactly once — the stuck day's unlink");
    assert.equal(r.errors, 1, `EPERM on the unlink is counted, got ${r.errors}`);
    assert.deepEqual(r.archived, [own.name], "the stuck day is not reported as archived; the sweep went on to the next file");
    assert.ok(readFileSync(join(dir, stuck.name)).equals(stuck.body), "the stuck day stays live and byte-identical");
    assert.ok(gunzipSync(readFileSync(join(dir, "archive", `${stuck.name}.gz`))).equals(stuck.body), "…and its archive already holds the same bytes — the data exists twice until the next sweep, never zero times");
    const r2 = sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now);
    assert.deepEqual([r2.archived, r2.errors], [[stuck.name], 0], "the next sweep retries and finishes the move");
    assert.deepEqual(live(dir), [`events-${dayStr(0, now)}.ndjson`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention (c): a day file that is listed but gone when read — what a file another process archived between readdir and read looks like — → errors 1, nothing unlinked, the sweep continues; the footprint and archivedDays skip and count the same way", () => {
  const dir = fresh();
  try {
    const now = new Date();
    const gone = `events-${dayStr(36, now)}.ndjson`;
    symlinkSync(join(dir, "vanished"), join(dir, gone)); // a dangling link: readdir names it, read and stat get the race's own ENOENT
    const own = plant(dir, 35, now, 3);
    const today = plant(dir, 0, now, 2);
    const before = ledgerFootprint(dir);
    assert.deepEqual([before.files, before.bytes], [2, own.body.length + today.body.length], "the footprint counts the two readable days and skips the one that vanished");
    const r = sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now);
    assert.equal(r.errors, 1, `one error for the vanished source, got ${r.errors}`);
    assert.deepEqual(r.archived, [own.name], "the sweep continued to the next file");
    assert.deepEqual(archived(dir), [`${own.name}.gz`]);
    assert.ok(lstatSync(join(dir, gone)).isSymbolicLink(), "nothing was unlinked for the file that could not be read");
    // the archive side of the same race: an archive named in readdir and gone at stat is skipped by the footprint; archivedDays lists NAMES only
    const ghost = `events-${dayStr(45, now)}.ndjson.gz`;
    symlinkSync(join(dir, "archive", "vanished.gz"), join(dir, "archive", ghost));
    const after = ledgerFootprint(dir);
    assert.deepEqual([after.files, after.archiveFiles, after.archiveBytes], [1, 1, statSync(join(dir, "archive", `${own.name}.gz`)).size], "today's file live; one archive counted, the vanished one skipped");
    assert.deepEqual(archivedDays(dir), [dayStr(45, now), dayStr(35, now)].sort(), "archivedDays answers from names, oldest first, and never opens an archive");
    assert.deepEqual(archivedDays(join(dir, "absent")), [], "no archive directory → no archived days, never a throw");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention (d): deleteAfterDays walks archive/ past what is not an archive (a crashed sweep's .tmp, a note, a name that is not a date) and counts an unlink it cannot do — errors 1, that archive still present, the rest deleted", () => {
  const dir = fresh();
  try {
    const now = new Date();
    for (const age of [0, 36, 37, 38]) plant(dir, age, now);
    assert.equal(sweepLedger(dir, { keepDays: 30, deleteAfterDays: 0 }, now).archived.length, 3, "precondition: three archives");
    const strays = [`.events-${dayStr(36, now)}.ndjson.99999.tmp`, "README", "events-2026-13-99.ndjson.gz"]; // a crashed sweep's leftover, an operator's note, not a real date
    for (const s of strays) writeFileSync(join(dir, "archive", s), "left alone\n");
    const fp = ledgerFootprint(dir);
    assert.deepEqual([fp.files, fp.archiveFiles], [1, 4], "the footprint counts every archive-SHAPED name — the three real ones and the not-a-date one — and skips the .tmp and the note");
    assert.deepEqual(archivedDays(dir), ["2026-13-99", dayStr(38, now), dayStr(37, now), dayStr(36, now)].sort(), "archivedDays lists names, not validated dates; the sweep's delete loop is what leaves a name that is not a date alone");
    const stuck = `events-${dayStr(37, now)}.ndjson.gz`;
    let bit = 0;
    const r = withFs({
      unlinkSync: (real) => (p) => {
        if (String(p) === join(dir, "archive", stuck)) { bit++; throw planted("EPERM", "unlink", p); }
        return real.call(fs, p);
      },
    }, () => sweepLedger(dir, { keepDays: 30, deleteAfterDays: 35 }, now));
    assert.equal(bit, 1, "the plant must bite exactly once — the stuck archive's unlink");
    assert.equal(r.errors, 1, `the unlink that failed is counted, got ${r.errors}`);
    assert.deepEqual(r.deleted, [`events-${dayStr(38, now)}.ndjson.gz`, `events-${dayStr(36, now)}.ndjson.gz`], "the two archives past the horizon that could be unlinked, oldest first; the loop went on past the failure");
    assert.deepEqual(readdirSync(join(dir, "archive")).sort(), [...strays, stuck].sort(), "the stuck archive and every non-archive entry are untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
