/**
 * Append-only NDJSON event ledger — the single source of truth for what happened.
 *
 * Everything downstream (analytics, log learners, status.json, audit review) consumes THIS,
 * not pane scrollback. One event = one line = one atomic append. Schema is versioned and
 * deliberately flat so a learner can mine it without transformation.
 */
import { appendFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_RETENTION, LedgerRetention, SweepResult, sweepLedger } from "./ledger-retention.js";
import { redact } from "./redact.js";

export type EventType =
  | "session.spawned"
  | "session.adopted"
  | "session.killed"
  | "session.state" // state classification changed
  | "fleet.tmux" // tmux server reachability changed — one event per transition, data.to reachable|unreachable
  | "input.sent" // audit: every keystroke/paste we inject; data: { chars, enter, preview, attempt | verified:false, cleared } — cleared is whether the pre-paste C-c was sent: true = the pane was at a shell prompt and its stale line was cleared, false = a program (an agent TUI) owned the pane and nothing was interrupted
  | "input.verified" // two-step verify outcome
  | "exec.done" // sync exec completed
  | "exec.timeout" // sync exec hit its timeoutMs before the rc file appeared — the terminal event of that exec; data: { id, timeoutMs, elapsedMs, command, holder } — holder names what held the pane at the bound: the guard's reading, the process chain with each state letter, the redacted last line
  | "message.sent"
  | "message.received"
  | "trigger.fired" // watch trigger (idle/error/pattern/exit)
  | "notify.sent"
  | "capture.rotated"
  | "capture.stalled" // pipe-pane divergence: pane advanced while the log stayed static
  | "control.denied" // a refused action, one event per refusal: policy on any surface (data.reason "read-only surface" | "deny-list" | "allow-list"), exec's "dead pane" and "foreground program" guards, kill's "owned by another actor", the MCP server's own read-only refusal, the dashboard's origin guard; boundary.ts also files process-level faults here (data.boundary)
  | "session.meta" // lineage/verdict enrichment from a census or supervisor (latest wins)
  | "health.warning" // host/session threshold crossed (H3) — one event per STATE TRANSITION
  | "health.critical"
  | "health.recovered"
  | "health.prediction" // trend projects memory exhaustion (H5) — names the culprit session(s)
  | "host.crash-suspected" // heartbeat predates boot with no clean-shutdown marker (H4)
  | "ledger.archived"; // retention sweep moved day files into ledger/archive/ — one per sweep that moved something; data: { files, deleted, bytesBefore, bytesAfter }

export interface LedgerEvent {
  v: 1;
  ts: string; // ISO-8601 UTC
  type: EventType;
  session?: string;
  parent?: string; // lineage: who owns this session
  actor?: string; // who did it (supervisor id / mcp client / cli user)
  data?: Record<string, unknown>;
}

/**
 * What "error events" means wherever the ledger is aggregated — the `waste` report's `errors`
 * column (CLI verb, MCP `waste-report`, the dashboard's table; README "Status & analytics"). One
 * predicate, consumed by both readers (analytics/status.wasteReport and analytics/ledger-index),
 * so they cannot drift apart: before this, each counted `session.state → ERROR` alone, and a session
 * refused three times, timed out once and mistyped once read errors=0 below a session that had
 * flapped once. An event is an error when it records an action failing or being refused:
 *   - session.state whose data.to is ERROR — the classifier's verdict on the pane
 *   - control.denied — a refusal, on any surface, for any reason
 *   - exec.timeout — the exec never produced its rc
 *   - input.verified with data.ok === false — the keystrokes did not land as typed
 * Not errors: success events (exec.done — the command's own rc is the agent's verdict, not the
 * tool's; input.verified ok:true; session.state to any other state, leaving ERROR included;
 * input.sent; spawn/adopt/kill) and the host/capture axis (health.*, capture.stalled, fleet.tmux,
 * host.crash-suspected, ledger.archived) — those describe the host or the tool, not the session's work.
 */
export function isErrorEvent(ev: LedgerEvent): boolean {
  switch (ev.type) {
    case "session.state":
      return (ev.data as { to?: string } | undefined)?.to === "ERROR";
    case "control.denied":
    case "exec.timeout":
      return true;
    case "input.verified":
      return (ev.data as { ok?: boolean } | undefined)?.ok === false;
    default:
      return false;
  }
}

/**
 * The `data` fields that carry text an operator or an agent typed — `input.sent.preview`, `exec.done` /
 * `exec.timeout` `command`, `session.spawned` `command` and `task`, and `message.sent` `subject` —
 * passed through redact() once more, for a row
 * written before its producer redacted first. Every producer now redacts BEFORE its cut, so a NEW row needs
 * nothing from this; a row from before 2026-10-13 may hold a whole shape in `session.spawned` (stored
 * verbatim) or in a preview short enough that the cut left the shape intact — those are served redacted by every reader
 * that goes through LedgerIndex (the dashboard's `/api/events`, the session detail's event list, `/api/timeline`'s
 * marks, the rollup's `task` on `/api/history` and `/api/fleet`). A legacy row holding only the FRAGMENT a cut left
 * (`AKIAFAKEFAKEFAKEFAK`) carries nothing a pattern can match: that is what moving the redaction before the cut fixes
 * at the source, not something a read-side pass can repair. The bytes on disk are never rewritten; the row object is
 * copied, never mutated in place; every other field is byte-for-byte what was filed, and the schema is unchanged.
 */
export function redactEventText(ev: LedgerEvent): LedgerEvent {
  const d = ev.data;
  if (!d) return ev;
  let out: Record<string, unknown> | null = null;
  for (const key of ["preview", "command", "task", "subject"]) {
    const v = d[key];
    if (typeof v !== "string") continue;
    const r = redact(v);
    if (r === v) continue;
    out ??= { ...d };
    out[key] = r;
  }
  return out ? { ...ev, data: out } : ev;
}

export class Ledger {
  readonly dir: string;
  /**
   * Retention the day-rollover sweep applies (ledger-retention.ts). The CLI and MCP
   * entry points set it from health.json; an embedder that constructs a Ledger directly gets the
   * defaults — archive after 30 days, never delete.
   */
  retention: LedgerRetention = DEFAULT_RETENTION;
  private sweptDay: string | null = null;
  /**
   * The day file is resolved PER WRITE, not once at construction. A long-running process
   * (the dashboard runs for days) would otherwise keep appending to the file for the day it
   * started — events silently land under the wrong date forever, and daily rotation never
   * happens. Verified 2026-08-25.
   */
  constructor(dir?: string) {
    this.dir = dir ?? join(process.env.TMUX_AGENT_HOME ?? join(homedir(), ".tmux-agent"), "ledger");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  private fileFor(ts: string): string {
    return join(this.dir, `events-${ts.slice(0, 10)}.ndjson`);
  }
  emit(ev: Omit<LedgerEvent, "v" | "ts">): LedgerEvent {
    const full: LedgerEvent = { v: 1, ts: new Date().toISOString(), ...ev };
    const f = this.fileFor(full.ts);
    const isNew = !existsSync(f);
    appendFileSync(f, JSON.stringify(full) + "\n");
    if (isNew) {
      // event previews can contain unredacted novel secret shapes; never world-readable
      try { chmodSync(f, 0o600); } catch { /* best effort */ }
      // the first write of a new day is the retention trigger: yesterday's file has just closed
      this.sweep();
    }
    return full;
  }
  /**
   * Archive day files older than `retention.keepDays`. At most once per UTC day per
   * process unless forced: the first write of a new day triggers it, and the dashboard's health
   * tick calls it too, so a daemon over a quiet fleet — which may write nothing for hours — still
   * bounds its history. Ledgers one `ledger.archived` per sweep that moved something; a sweep that
   * finds nothing is silent. Never throws into the writer's path. `now` is a test seam.
   */
  sweep(force = false, now = new Date()): SweepResult | null {
    const today = now.toISOString().slice(0, 10);
    if (!force && this.sweptDay === today) return null;
    this.sweptDay = today;
    const r = sweepLedger(this.dir, this.retention, now);
    if (r.archived.length || r.deleted.length) {
      this.emit({ type: "ledger.archived", data: { files: r.archived, deleted: r.deleted, bytesBefore: r.bytesBefore, bytesAfter: r.bytesAfter } });
    }
    return r;
  }
  /** Current day's file (recomputed on access, for the same reason). */
  get path(): string {
    return this.fileFor(new Date().toISOString());
  }
}
