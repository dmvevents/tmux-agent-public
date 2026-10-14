/**
 * Harness integration: machine-readable fleet state. Supervisors, Kanban boards, and
 * dashboards consume status.json — nobody should have to attach to tmux to know what's up.
 * Plus the waste-report: "which sessions burned the most time this week, and why" straight
 * off the ledger (no transformation step — acceptance criterion for the log learner too).
 */
import { accessSync, constants, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Monitor, Snapshot } from "../core/monitor.js";
import { isErrorEvent, LedgerEvent } from "../core/ledger.js";
import { Orchestrator } from "../core/orchestrator.js";
import { archivedDays } from "../core/ledger-retention.js";
import { SessionMeta } from "./ledger-index.js";

/** A day file covers one whole UTC day — the span `archivedDaysInWindow` compares a `since` against. */
const DAY_MS = 86_400_000;

/**
 * Latest `session.meta` enrichment per session, one-shot scan (CLI-shaped; the long-running
 * dashboard uses LedgerIndex's incremental cursor instead). Files sort lexicographically by
 * date and lines are append-ordered, so the last event seen IS the latest.
 */
export function latestSessionMeta(ledgerDir: string): Map<string, SessionMeta> {
  const out = new Map<string, SessionMeta>();
  let files: string[] = [];
  try {
    files = readdirSync(ledgerDir).filter((f) => f.endsWith(".ndjson")).sort();
  } catch {
    return out; // no ledger yet = no enrichment
  }
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(join(ledgerDir, f), "utf8");
    } catch {
      continue; // archived by a retention sweep between readdir and read: out of the window
    }
    for (const line of text.split("\n")) {
      if (!line.includes("session.meta")) continue; // cheap pre-filter before JSON.parse
      let ev: LedgerEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type !== "session.meta" || !ev.session) continue;
      out.set(ev.session, { ...(ev.data as Omit<SessionMeta, "ts">), ts: ev.ts });
    }
  }
  return out;
}

/**
 * A file the operator pointed a write at that the tool cannot write — the source, the value as typed and the reason in
 * words. The CLI turns the judgement into exit 64 and a write that still fails into exit 1; over MCP the throw is the
 * isError reply.
 */
export class OutPathError extends Error {
  constructor(source: string, value: unknown, reason: string) {
    super(`${source}: cannot write ${JSON.stringify(value)} — ${reason}`);
    this.name = "OutPathError";
  }
}

/**
 * The one judgement of a file a verb WRITES to — `status --json FILE`, `calibrate --out FILE` — before the fleet is read,
 * a pane captured, the home made or a tmux server touched. Earlier changes moved every value the CLI
 * reads into a named refusal; these two were judged by nobody but the operating system, at the end. Until 2026-09-16
 * (measured on an earlier build) the value went straight into writeFileSync after
 * the work: the throw escaped to the CLI's top-level catch — exit 1, the code VERSIONING reserves for "the tool broke",
 * the flag unnamed, Node's own `ENOENT: no such file or directory, open '…'`; for `status` the fleet had been read (2
 * session.state rows) and the fleet lines the operator asked for never reached stdout, because the print loop follows
 * the publish; for `calibrate` 40 lines of every session's pane had been captured and redacted and the draft was lost
 * with the write; in both the 0700 home was made first. A supervisor reading exit 1 could not tell a mistyped directory
 * from a broken tool. Resolved FIRST against this process's own directory — the caller's, at the CLI — as assertCwd
 * resolves --cwd. A path that is not there yet needs a parent that exists, is a directory and is one this user can write
 * and enter (W_OK | X_OK — what creating an entry needs); a path that exists must not be a directory and must be
 * writable by this user (W_OK) — an existing non-regular file (/dev/stdout) stays allowed, and its parent's mode is not
 * consulted (replacing a file's content needs no write on /dev). Never a mkdir: what the operator mistyped is not
 * created. The reason is one of four, in words: `no such directory` (the parent, or a component of it, is not there —
 * ENOENT, or ENOTDIR on the parent), `not a directory` (the parent is a file), `is a directory`, `permission denied`.
 * Returns the absolute path the write is given. The CLI judges the value through this before anything is constructed;
 * publishStatus judges its outFile again before the fleet is read — defence in depth for an embedder, as spawn judges
 * --cwd again.
 */
export function assertOutPath(path: unknown, source: string): string {
  if (typeof path !== "string" || path === "") throw new OutPathError(source, path, "no such directory");
  const abs = resolve(path);
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // anything but "not there": a component this user cannot search — the 000 parent
    if (code !== "ENOENT" && code !== "ENOTDIR") throw new OutPathError(source, path, "permission denied");
    // nothing of that name yet: the parent decides
    const parent = dirname(abs);
    let pst;
    try {
      pst = statSync(parent);
    } catch (pe) {
      const pcode = (pe as NodeJS.ErrnoException).code;
      throw new OutPathError(source, path, pcode === "ENOENT" || pcode === "ENOTDIR" ? "no such directory" : "permission denied");
    }
    if (!pst.isDirectory()) throw new OutPathError(source, path, "not a directory");
    try {
      accessSync(parent, constants.W_OK | constants.X_OK);
    } catch {
      throw new OutPathError(source, path, "permission denied");
    }
    return abs;
  }
  if (st.isDirectory()) throw new OutPathError(source, path, "is a directory");
  try {
    accessSync(abs, constants.W_OK);
  } catch {
    throw new OutPathError(source, path, "permission denied");
  }
  return abs;
}

/** The OS reason in words with its code — what an operator acts on, not Node's `ENOSPC: no space left on device, write`. */
function writeFailure(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  const words: Record<string, string> = {
    ENOENT: "no such directory",
    ENOTDIR: "not a directory",
    EISDIR: "is a directory",
    EACCES: "permission denied",
    EPERM: "permission denied",
    ENOSPC: "no space left on device",
    EROFS: "read-only file system",
  };
  if (code && words[code]) return `${words[code]} (${code})`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * The one write to a file the operator named, after assertOutPath has passed it. The residual failure — the race between
 * the judgement and the write, a full disk (`/dev/full` is the deterministic case: the judgement passes a writable
 * character device, the write fails ENOSPC) — is the same `cannot write` line with the source, the path as given and the
 * OS reason in words, never Node's bare `…, open '…'` / `…, write`. It is not the operator's input (the judgement said
 * the write could be done), so the CLI lets the throw reach its top-level catch: exit 1, one line. Returns the absolute
 * path written.
 */
export function writeOutPath(path: string, source: string, data: string, mode?: number): string {
  const abs = resolve(path);
  try {
    writeFileSync(abs, data, mode === undefined ? undefined : { mode });
  } catch (e) {
    throw new OutPathError(source, path, writeFailure(e));
  }
  return abs;
}

export async function publishStatus(orch: Orchestrator, monitor: Monitor, outFile?: string, profileName?: string): Promise<string> {
  // The file is judged BEFORE the fleet is read: a FILE the tool cannot write costs no fleet read and no
  // capture, and an embedder gets the CLI's line — the CLI has judged its --json once already, as spawn judges --cwd
  // again. The default is the home's own status.json (inside the 0700 home the Orchestrator made); in the one line a
  // failed write of it produces it is named "default path", as loadLexicon names its default.
  const [source, file] = outFile === undefined ? ["default path", join(orch.home, "status.json")] : ["--json", outFile];
  assertOutPath(file, source);
  // The listing carries its own verdict on the server it listed: `tmux` below is the reachability of the
  // very listing that produced `sessions`, so `sessions: []` with reachable:false is a dead or absent server and with
  // reachable:true an idle fleet — before this, the two files were identical in every key but generatedAt.
  // `profileName` is the Monitor's own covered parameter, passed through untouched: named, every record's
  // state and classifiedBy are that profile's verdict — the file a collector reads must say what the table beside it
  // says — and the Monitor refuses an unknown name (ProfileNameError) before the fleet is listed, as it does for fleetReport().
  const [{ sessions: snaps, tmux }, lineage] = await Promise.all([monitor.fleetReport(profileName), orch.lineage()]);
  const byName = new Map(lineage.map((l) => [l.name, l]));
  const meta = latestSessionMeta(join(orch.home, "ledger"));
  const status = {
    v: 1,
    generatedAt: new Date().toISOString(),
    // additive (VERSIONING item 4): { reachable, since, error, checkedAt } — tmux's own words when unreachable
    tmux,
    sessions: snaps.map((s: Snapshot) => ({
      ...s,
      // tmux user-options are authoritative when present (set at spawn); census meta is the
      // fallback that gives ADOPTED sessions lineage at all
      parent: byName.get(s.session)?.parent ?? meta.get(s.session)?.parent ?? null,
      task: byName.get(s.session)?.task ?? null,
      owner: byName.get(s.session)?.owner ?? null,
      meta: meta.get(s.session) ?? null,
    })),
  };
  return writeOutPath(file, source, JSON.stringify(status, null, 2));
}

export interface WasteRow {
  session: string;
  events: number;
  errorEvents: number;
  stateChurn: number;
  inputsSent: number;
  killed: boolean;
  firstSeen: string;
  lastSeen: string;
}

/**
 * A `since` window the reader could not read. One message for every surface — the CLI
 * verb prints it and exits 64, the MCP tool returns it as `isError` — naming the flag, the rejected
 * value (or that none was given) and the form that is accepted: the README's own example.
 */
/** What `--since` takes, in the one wording every refusal of it uses — the CLI's flag judge included. */
export const SINCE_FORM = "an ISO-8601 time such as 2026-08-18T00:00:00Z";
export class SinceError extends Error {
  constructor(sinceIso: string) {
    super(
      sinceIso.trim() === ""
        ? `--since: no value given — give ${SINCE_FORM}`
        : `--since: cannot read ${JSON.stringify(sinceIso)} — give ${SINCE_FORM}`,
    );
    this.name = "SinceError";
  }
}

/**
 * The one reading of a `since` window, for the CLI verb and the MCP `waste-report` tool alike, so
 * the two surfaces cannot drift. `Date.parse` returns NaN for anything it cannot read and every
 * comparison with NaN is false — so until 2026-09-14 (measured on earlier builds) a mistyped
 * `--since yesterday` filtered nothing: the whole ledger came back with exit 0, indistinguishable
 * from "no window", on a flag README's 5-minute demo ends on. Anything `Date.parse` reads stays
 * valid (a date-only day, a value with an offset); a window that matches no event is not an error
 * — that is the caller's zero rows. Undefined means no window at all.
 */
export function parseSince(sinceIso: string | undefined): number {
  if (sinceIso === undefined) return 0;
  const since = sinceIso.trim() === "" ? NaN : Date.parse(sinceIso);
  if (Number.isNaN(since)) throw new SinceError(sinceIso);
  return since;
}

/** Aggregate the NDJSON ledger into a per-session waste/activity table. */
export function wasteReport(ledgerDir: string, sinceIso?: string): WasteRow[] {
  const since = parseSince(sinceIso); // refused BEFORE any day file is opened
  const rows = new Map<string, WasteRow>();
  // live day files only: archived days (ledger/archive/*.gz) are out of the window by definition
  for (const f of readdirSync(ledgerDir).filter((f) => f.endsWith(".ndjson")).sort()) {
    let text: string;
    try {
      text = readFileSync(join(ledgerDir, f), "utf8");
    } catch {
      continue; // archived between readdir and read
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let ev: LedgerEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (!ev.session || Date.parse(ev.ts) < since) continue;
      const r =
        rows.get(ev.session) ??
        ({ session: ev.session, events: 0, errorEvents: 0, stateChurn: 0, inputsSent: 0, killed: false, firstSeen: ev.ts, lastSeen: ev.ts } as WasteRow);
      r.events++;
      r.lastSeen = ev.ts;
      if (ev.type === "session.state") r.stateChurn++;
      if (isErrorEvent(ev)) r.errorEvents++; // the set is defined once, in core/ledger
      if (ev.type === "input.sent") r.inputsSent++;
      if (ev.type === "session.killed") r.killed = true;
      rows.set(ev.session, r);
    }
  }
  return [...rows.values()].sort((a, b) => b.errorEvents - a.errorEvents || b.stateChurn - a.stateChurn);
}

/**
 * The archived days that fall inside the window the caller asked for — what makes an answer TRUNCATED
 * rather than empty. A day file holds a whole UTC day, so it overlaps the window as soon as
 * its last instant does; a `since` at or after a day's end leaves that day genuinely outside the
 * question and it is not claimed. The window is read by the same `parseSince` every surface refuses
 * with, so an unreadable `--since` throws here too and is never reported on. No archive is opened:
 * this is the file NAMES, and the live-only reader rule above is unchanged.
 */
export function archivedDaysInWindow(ledgerDir: string, sinceIso?: string): string[] {
  const since = parseSince(sinceIso);
  return archivedDays(ledgerDir).filter((day) => Date.parse(`${day}T00:00:00Z`) + DAY_MS > since);
}

/**
 * The ONE wording for "the window you asked about includes history I did not read" — printed by `waste`
 * on stderr behind its own verb prefix and carried verbatim by MCP `waste-report` in a second content
 * block, the shape `unknownAgentNote` gave the mailbox and `serverGoneNote` the fleet.
 * A literal in each place is two wordings of one fact and they drift:
 * test/waste-archived-window.test.js holds the CLI line and the MCP note equal. Callers pass a
 * non-empty list — `archivedDaysInWindow` returning none IS the honest empty answer, which stays silent.
 */
/**
 * The ONE wording for "census enrichment may have aged out of the live window" — printed by `lineage` and
 * `status` on stderr behind their own verb prefixes and carried by MCP `fleet-status` in a second content block, the
 * route and shape of archivedWindowNote above. `session.meta` rows are read from live day files only (retention rule
 * 2), so a census older than keepDays is gzipped under ledger/archive and the rows it enriched read blank. That decay
 * is RIGHT — a month-old verdict is not a current one, and nothing here resurrects it — but until this it was silent:
 * on a development host the 2026-08-25 census reached 0 of 31 sessions through `lineage` once its day file was archived,
 * with the verb's own comment still calling census meta "the lineage source for the adopted fleet". The note is
 * computed from NAMES only — the archived days present and the listed sessions with no live meta — and no archive is
 * opened (the "readers see live days only" rule and test/ledger-retention.test.js are untouched). Null when there is
 * no archive, or when every listed session has live enrichment: silence is the honest empty answer.
 */
export function metaDecayNote(ledgerDir: string, sessions: string[], meta: Map<string, SessionMeta> = latestSessionMeta(ledgerDir)): string | null {
  const days = archivedDays(ledgerDir);
  const without = sessions.filter((name) => !meta.has(name)).length;
  if (days.length === 0 || without === 0) return null;
  const one = days.length === 1;
  const range = one ? days[0] : `${days[0]}→${days[days.length - 1]}`;
  return (
    `${without} session${without === 1 ? " carries" : "s carry"} no census enrichment in the live ledger window — ` +
    `${days.length} archived day${one ? "" : "s"} (${range}) ${one ? "is" : "are"} gzipped under ledger/archive unread, and a ` +
    `session.meta row there is not served: a parent, verdict or role a census gave reads blank until the census runs again`
  );
}

export function archivedWindowNote(days: string[]): string {
  const one = days.length === 1;
  const range = one ? days[0] : `${days[0]}→${days[days.length - 1]}`;
  return (
    `window truncated — ${days.length} archived day${one ? "" : "s"} (${range}) ${one ? "is" : "are"} inside it and ` +
    `${one ? "was" : "were"} NOT read: readers see live days only, and that history is gzipped under ledger/archive ` +
    `(doctor and /api/health count it as archiveFiles/archiveBytes)`
  );
}
