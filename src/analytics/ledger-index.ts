/**
 * Incremental ledger reader.
 *
 * The naive analytics path re-parses every .ndjson file on every request. At 1k events/day
 * that is megabytes of JSON.parse per poll per connected browser — the classic observability
 * tool that costs more than the thing it observes. This keeps a per-file byte offset and
 * parses only the bytes appended since last read, maintaining rolling aggregates in memory.
 *
 * Append-only files make this safe: offsets never move backwards. Truncation/rotation is
 * detected by size < offset, which resets that file's cursor.
 */
import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { isErrorEvent, redactEventText, LedgerEvent } from "../core/ledger.js";

/**
 * Enrichment a supervisor/census writes as `session.meta` events: which repo/branch a session
 * drives, its human role, and a keep/close verdict. Sessions ADOPTED from a shared server have
 * no spawn event and no tmux user-options, so without this the fleet view shows 30 rows of
 * blank lineage. Latest event per session wins — for the rollup's `parent` too: a later
 * census that names another parent, or none, replaces what an earlier one said, unless the parent
 * came from a real `session.spawned` row, which stays authoritative.
 */
export interface SessionMeta {
  repo?: string;
  branch?: string;
  cwd?: string;
  role?: string;
  verdict?: string;
  parent?: string;
  why?: string;
  source?: string;
  ts: string;
}

export interface SessionRollup {
  session: string;
  parent: string | null;
  task: string | null;
  spawnedAt: string | null;
  killedAt: string | null;
  events: number;
  errorEvents: number;
  stateChurn: number;
  inputsSent: number;
  execs: number;
  lastEventAt: string | null;
  meta: SessionMeta | null;
}

export class LedgerIndex {
  private offsets = new Map<string, number>();
  private rollups = new Map<string, SessionRollup>();
  private recent: LedgerEvent[] = [];
  private readonly recentCap = 500;
  private lastScan = 0;

  constructor(private readonly dir: string, private readonly minScanIntervalMs = 1000) {}

  /** Parse only newly-appended bytes. Cheap enough to call on every request. */
  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastScan < this.minScanIntervalMs) return;
    this.lastScan = now;
    if (!existsSync(this.dir)) return;

    for (const f of readdirSync(this.dir).filter((x) => x.endsWith(".ndjson")).sort()) {
      const p = join(this.dir, f);
      let size: number;
      try {
        size = statSync(p).size;
      } catch {
        continue;
      }
      const prev = this.offsets.get(f) ?? 0;
      if (size === prev) continue;
      if (size < prev) this.offsets.set(f, 0); // rotated/truncated → re-read from start

      const from = this.offsets.get(f) ?? 0;
      const len = size - from;
      let chunk = "";
      try {
        const fd = openSync(p, "r");
        const buf = Buffer.allocUnsafe(len);
        readSync(fd, buf, 0, len, from);
        closeSync(fd);
        chunk = buf.toString("utf8");
      } catch {
        continue;
      }
      // a partial trailing line means the writer is mid-append: keep it for next pass
      const lastNl = chunk.lastIndexOf("\n");
      if (lastNl === -1) continue;
      const consumable = chunk.slice(0, lastNl + 1);
      this.offsets.set(f, from + Buffer.byteLength(consumable, "utf8"));

      for (const line of consumable.split("\n")) {
        if (!line.trim()) continue;
        try {
          this.ingest(JSON.parse(line) as LedgerEvent);
        } catch {
          /* tolerate a malformed line rather than lose the file */
        }
      }
    }
  }

  /** Sessions whose rollup parent came from a `session.spawned` row — census enrichment never replaces those. */
  private readonly spawnParent = new Set<string>();

  private ingest(raw: LedgerEvent): void {
    // The read-side redaction boundary for the ledger's text fields: a row filed before its producer
    // redacted first is served redacted from here on — `recent` (events()) and the rollups below both see the
    // projected row, so every route through this index inherits it. The file is never rewritten.
    const e = redactEventText(raw);
    this.recent.push(e);
    if (this.recent.length > this.recentCap) this.recent.splice(0, this.recent.length - this.recentCap);
    if (!e.session) return;
    const r =
      this.rollups.get(e.session) ??
      ({
        session: e.session,
        parent: null,
        task: null,
        spawnedAt: null,
        killedAt: null,
        events: 0,
        errorEvents: 0,
        stateChurn: 0,
        inputsSent: 0,
        execs: 0,
        lastEventAt: null,
        meta: null,
      } satisfies SessionRollup);
    r.events++;
    r.lastEventAt = e.ts;
    if (isErrorEvent(e)) r.errorEvents++; // same set as wasteReport — defined once, in core/ledger
    switch (e.type) {
      case "session.spawned":
        r.spawnedAt = e.ts;
        r.killedAt = null; // respawn supersedes an earlier kill
        if (e.parent) {
          r.parent = e.parent;
          this.spawnParent.add(e.session);
        }
        r.task = ((e.data as { task?: string } | undefined)?.task ?? r.task) as string | null;
        break;
      case "session.killed":
        r.killedAt = e.ts;
        break;
      case "session.state":
        r.stateChurn++;
        break;
      case "input.sent":
        r.inputsSent++;
        break;
      case "exec.done":
        r.execs++;
        break;
      case "session.meta": {
        const d = (e.data ?? {}) as Omit<SessionMeta, "ts">;
        r.meta = { ...d, ts: e.ts };
        // meta.parent is the only lineage an adopted session has (no spawn event, no tmux options), and the LATEST
        // census is the one that counts — the parent it names, or none at all. Until 2026-10-13 (an earlier build)
        // this read `if (!r.parent && d.parent) r.parent = d.parent;` — the FIRST census won — so a session whose
        // census said A and later B had meta.parent B, latestSessionMeta() B, and here A, which /api/history served;
        // a census that withdrew the parent left A standing. A parent from a real spawn row stays authoritative.
        if (!this.spawnParent.has(e.session)) r.parent = d.parent ?? null;
        break;
      }
    }
    this.rollups.set(e.session, r);
  }

  sessions(force = false): SessionRollup[] {
    this.refresh(force);
    return [...this.rollups.values()];
  }

  /** Most-recent events, newest last. Optionally filtered to one session. */
  events(session?: string, limit = 120, force = false): LedgerEvent[] {
    this.refresh(force);
    const src = session ? this.recent.filter((e) => e.session === session) : this.recent;
    return src.slice(-limit);
  }

  /** Waste ranking: errors first, then churn — same contract as analytics/status.wasteReport. */
  waste(limit = 10, force = true): SessionRollup[] {
    // default force=true: the dashboard shows waste next to freshly-mutated state, so the
    // 1s scan limiter would make the two panels disagree
    return this.sessions(force)
      .sort((a, b) => b.errorEvents - a.errorEvents || b.stateChurn - a.stateChurn || b.events - a.events)
      .slice(0, limit);
  }
}
