/**
 * Safe tmux invocation core.
 *
 * Every tmux call in this codebase goes through exec() below. Three rules, each paid for
 * by a production incident somewhere:
 *
 *  1. argv-only spawn (execFile, never a shell string). The mindshare tmux MCP server
 *     interpolated tool args into `exec("tmux ...")` and shipped a command-injection RCE
 *     (nickgnd/tmux-mcp#43). Structurally impossible here.
 *  2. Exact-match targets. Session verbs take "=name"; pane-grain verbs take "=name:" —
 *     the bare form prefix-matches (kill "wrk_A" can hit "wrk_AB") and the wrong grain
 *     fails SILENTLY (took down a 62-session fleet, mixpeek/amux tmux.rs).
 *  3. Per-call timeout. tmux answers in milliseconds; anything slower means the server is
 *     wedged and we want the error, not the hang. The one verb that blocks BY DESIGN is
 *     `wait-for`: execSync passes its caller's remaining bound as the per-call override, so
 *     the fixed default never sits in front of a timeout the caller chose (before
 *     that, every exec bound was silently 5 s longer than asked).
 */
import { execFile } from "node:child_process";
import { redact } from "./redact.js";

export interface TmuxOpts {
  /**
   * Dedicated socket name (tmux -L). Default "tmux-agent" isolates us from the human's server. A value given is judged
   * by assertSocketName at construction — `defaultServer` exempts nothing typed.
   */
  socket?: string;
  /** Absolute socket path (tmux -S). Wins over `socket` when set. */
  socketPath?: string;
  /** Per-call timeout ms. */
  timeoutMs?: number;
  /** Use the caller's default tmux server (no -L/-S). Opt-in, for adopting human sessions. */
  defaultServer?: boolean;
}

export class TmuxError extends Error {
  constructor(msg: string, public readonly args: string[], public readonly stderr: string) {
    super(msg);
  }
}

/**
 * "The tmux server is simply not running" — the start-before-a-server case (nickgnd#9) and a
 * killed server both report it, and both listers below swallow it to an empty fleet. Kept as one
 * predicate so the swallowing methods and the reachability-aware fleet poll (listFleetReachable)
 * agree on what "gone" looks like, matched against tmux's OWN stderr — never pane text.
 */
function isNoServer(e: unknown): e is TmuxError {
  // "File name too long": the -L name's path (/tmp/tmux-<uid>/<name>, or under TMUX_TMPDIR) does not fit a Unix socket's
  // 108 bytes, so no server can answer there — reported like a server that is not running; until then it was
  // tmux's raw error and exit 1 where README promised one UNREACHABLE line and exit 0.
  return e instanceof TmuxError && /no server|No such file|File name too long/i.test(e.stderr);
}

/**
 * "There is nothing to list" — the OPPOSITE of isNoServer, and the reason this predicate exists
 * separately. A server kept alive with zero sessions (`set -g exit-empty off`, the warm
 * socket a long-lived fleet operator keeps) answers `display-message` with its version and holds its
 * pid, and `list-sessions` succeeds with rc 0 and no rows — but `list-panes -a` needs a CURRENT
 * target and there is none, so tmux fails it with "no current target". The server ANSWERED: it is
 * alive and simply empty. Measured 2026-09-17 on an earlier build, where isNoServer alone made that state
 * indistinguishable from death — listPanesBySession() threw where its own comment promises an empty
 * fleet, and listFleetReachable() reported reachable:false with "no current target", so `status`,
 * status.json, the dashboard's red banner and doctor all told the operator to restart a server that
 * was up. Matched against tmux's OWN stderr, like isNoServer — never pane text.
 */
function isNothingToList(e: unknown): e is TmuxError {
  return e instanceof TmuxError && /no current target/i.test(e.stderr);
}

export function sessionTarget(name: string): string {
  assertName(name);
  return `=${name}`;
}
/** Pane-grain target ("=name:" — trailing colon is load-bearing; see header). */
export function paneTarget(name: string, window = "", pane = ""): string {
  assertName(name);
  return `=${name}:${window}${pane ? "." + pane : ""}`;
}
/**
 * A session name the tool cannot use — the value as typed and the rule, after the SOURCE when the caller names one
 * (`--parent`, `--actor`, `TMUX_AGENT_ACTOR`: the lineage values); the CLI turns it into exit 64, MCP into
 * isError. The line is built here, once, so the CLI has no second copy of the words.
 */
export class SessionNameError extends Error {
  constructor(name: unknown, source?: string) {
    super(`${source ? `${source}: ` : ""}invalid session name: ${JSON.stringify(name)} (alnum start, [A-Za-z0-9._-], <=64)`);
    this.name = "SessionNameError";
  }
}
/**
 * The one judgement of a session name, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Every target this driver builds passes
 * through it; so does every `<name>` a CLI verb reads — before the home or a server is touched — and
 * Orchestrator.spawn's spec before new-session; and the two lineage values as well — `--parent`, and the
 * actor every verb's Orchestrator is built with — because a parent no session can bear is an orphan by construction and
 * an owner the rule refuses is one every other actor's `kill` is turned away in the words of. Until 2026-09-15 (measured
 * on an earlier build) it was reached only through sessionTarget/paneTarget,
 * and hasSession below swallows its throw with every other, so `spawn 'vp bad'` went into `new-session -s` unjudged and
 * `spawn ../evil` had tmux make a session named `__/evil` (tmux rewrites `.` and `:` to `_`) before the set-option
 * that finally threw. Exported so the CLI judges through this rule and not a second copy (the mailbox's
 * assertAgentName carries the same expression verbatim, by its own header). `source`, when given, opens the line.
 */
export function assertName(name: string, source?: string): void {
  // typeof first: RegExp.test coerces a non-string, and the pattern accepts the string "undefined" — a
  // caller that forgot the name (as the CLI once did) would otherwise create a session so named
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new SessionNameError(name, source);
  }
}

/**
 * A socket name the tool cannot use — the value as typed and the rule, after the SOURCE when the caller names one
 * (`--socket`, `TMUX_AGENT_SOCKET`); the CLI turns it into exit 64, the MCP server into exit 78 at startup.
 * The line is built here, once, so neither has a second copy of the words.
 */
export class SocketNameError extends Error {
  constructor(name: unknown, source?: string) {
    super(`${source ? `${source}: ` : ""}invalid socket name: ${JSON.stringify(name)} ([A-Za-z0-9._-], 1 or more)`);
    this.name = "SocketNameError";
  }
}
/**
 * The one judgement of a socket name (tmux -L), `^[A-Za-z0-9._-]+$`: a -L name is a file name under tmux's socket
 * directory — no `/`, no whitespace, no shell metacharacter (the value is interpolated into the exec script the
 * orchestrator generates, so `TMUX_AGENT_SOCKET=';rm -rf ~'` would be RCE-by-own-env), one character or more. It is the
 * one global value every verb reads and the whole isolation story rests on. Until 2026-09-16 (measured on an earlier build)
 * socketArgs below held the rule alone and threw a bare Error at the FIRST
 * tmux call: exit 1 in the driver's words, no source named, the 0700 home already made; hasSession's catch swallowed it,
 * so `watch` under `--socket ../x` reported the session GONE (exit 2, a notify.sent row); the verbs that never call
 * tmux ran to completion; the MCP server started and advertised 13 tools that all answered isError. Exported so the CLI
 * and the MCP server judge through this rule before anything is touched, and the constructor judges a given
 * `opts.socket` so no driver exists around a socket it cannot use — `defaultServer` exempts nothing typed. `source`,
 * when given, opens the line. typeof first, as assertName.
 */
export function assertSocketName(name: unknown, source?: string): void {
  if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/.test(name)) throw new SocketNameError(name, source);
}

/**
 * How a surface names the server the caller asked for — the CLI's `--socket`/`TMUX_AGENT_SOCKET` value, or the
 * default name the driver would use, or the words for "whatever tmux server this shell would talk to". One copy
 * so the CLI's UNREACHABLE lines and the MCP server's note name one socket the same way.
 */
export function socketLabel(opts: { socket?: string; defaultServer?: boolean }): string {
  return opts.defaultServer ? "the default socket" : (opts.socket ?? "tmux-agent");
}

/**
 * The ONE wording for "the fleet's server is not there", in tmux's own words — printed by `status`,
 * by `watch` and by `lineage`, each behind its own verb prefix, and
 * carried verbatim by MCP `list-lineage` in a second content block. A literal in each place is four wordings
 * of one fact, and they drift: test/lineage-tmux-down.test.js holds the CLI line and the MCP note equal.
 */
export function serverGoneNote(label: string, error: string | null): string {
  return `tmux server UNREACHABLE on ${label} — ${error}`;
}

export class Tmux {
  constructor(private readonly opts: TmuxOpts = {}) {
    // a name given is a name judged, defaultServer or not; the default is never given here, and socketPath
    // (-S) keeps its own check in socketArgs — no CLI flag reaches it
    if (opts.socket !== undefined) assertSocketName(opts.socket);
  }

  socketArgs(): string[] {
    if (this.opts.defaultServer) return [];
    // These values are interpolated into the generated exec script, so they must not be
    // able to carry shell metacharacters (TMUX_AGENT_SOCKET=';rm -rf ~' would otherwise
    // become RCE-by-own-env — a footgun rather than a trust-boundary crossing, but free
    // to close).
    if (this.opts.socketPath) {
      if (!/^[A-Za-z0-9._\/-]+$/.test(this.opts.socketPath)) throw new Error(`unsafe socket path: ${this.opts.socketPath}`);
      return ["-S", this.opts.socketPath];
    }
    const s = this.opts.socket ?? "tmux-agent";
    assertSocketName(s);
    return ["-L", s];
  }

  /** `opts.timeoutMs` overrides the per-call timeout for this one invocation (rule 3's `wait-for` case). */
  exec(args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
    const full = [...this.socketArgs(), ...args];
    return new Promise((resolve, reject) => {
      execFile(
        "tmux",
        full,
        { timeout: opts.timeoutMs ?? this.opts.timeoutMs ?? 5000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new TmuxError(`tmux ${args[0]} failed: ${stderr || err.message}`, full, stderr ?? ""));
          else resolve({ stdout, stderr });
        },
      );
    });
  }

  async hasSession(name: string): Promise<boolean> {
    return (await this.hasSessionChecked(name)).present;
  }

  /**
   * The presence check WITH the reason it failed: `present` as hasSession(), plus `unreachable` — tmux's own
   * stderr when the server did not answer at all, null when it answered and the session is simply absent. Same one exec:
   * `has-session` on a dead or never-started server fails with "no server running on …" / "error connecting to …",
   * against "can't find session" from a server that answered, so the cause is already on the wire — the GONE snapshot
   * just threw it away (monitor.ts). Only tmux's OWN words count as unreachable (isNoServer, the predicate the fleet
   * poll uses): a timeout or any other failure stays null rather than inventing a verdict, so a surface can say the
   * server is dead only when the server said so.
   */
  async hasSessionChecked(name: string): Promise<{ present: boolean; unreachable: string | null }> {
    try {
      await this.exec(["has-session", "-t", sessionTarget(name)]);
      return { present: true, unreachable: null };
    } catch (e) {
      return { present: false, unreachable: isNoServer(e) ? (e.stderr || e.message).trim().slice(0, 200) : null };
    }
  }

  async listSessions(): Promise<Array<{ name: string; created: number; attached: boolean }>> {
    // no server yet = no sessions (start without a running tmux server; nickgnd#9)
    return (await this.listSessionsReachable()).sessions;
  }

  /**
   * The sessions AND whether the server answered — from the ONE exec the listing already makes. `listSessions()`
   * swallows a dead server into `[]` on purpose (nickgnd#9: `spawn` must work before a server exists) and that
   * swallow stays; a caller that must TELL an empty fleet from a dead one reads it here instead (for
   * `lineage`), the way `listFleetReachable()` does for the dashboard poll. The SESSIONS listing decides, as
   * there: rc 0 with no rows is a live server with nothing on it. Any other tmux failure propagates,
   * exactly as it did before this method existed — a wedged server is not a fleet of zero.
   */
  async listSessionsReachable(): Promise<{
    reachable: boolean;
    error: string | null;
    sessions: Array<{ name: string; created: number; attached: boolean }>;
  }> {
    try {
      const { stdout } = await this.exec([
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_created}\t#{session_attached}",
      ]);
      const sessions = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [name, created, attached] = l.split("\t");
          return { name, created: Number(created), attached: attached !== "0" };
        });
      return { reachable: true, error: null, sessions };
    } catch (e) {
      if (!isNoServer(e)) throw e;
      // tmux's own words, bounded as listFleetReachable bounds them — the value a surface prints
      const msg = (e.stderr || e.message || "tmux unreachable").trim();
      return { reachable: false, error: msg.slice(0, 200), sessions: [] };
    }
  }

  /**
   * FLEET SNAPSHOT IN ONE EXEC. The naive path (per-session capture + display-message +
   * 3× show-options) costs 5 subprocess spawns per session — 140 execs / 460ms on a
   * 28-session server, growing linearly. tmux can emit user options and activity directly
   * in a format string, so the whole fleet comes back in a single exec (~4ms measured).
   * Pane content is fetched only for the session a human is actually looking at.
   */
  private async sessionsDetailedOrThrow(): Promise<
    Array<{
      name: string;
      parent: string | null;
      owner: string | null;
      task: string | null;
      created: number;
      activity: number;
      attached: boolean;
      windows: number;
    }>
  > {
    const FMT = [
      "#{session_name}",
      "#{@agent_parent}",
      "#{@agent_owner}",
      "#{@agent_task}",
      "#{session_created}",
      "#{session_activity}",
      "#{session_attached}",
      "#{session_windows}",
    ].join("\t");
    const { stdout } = await this.exec(["list-sessions", "-F", FMT]);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, parent, owner, task, created, activity, attached, windows] = l.split("\t");
        return {
          name,
          parent: parent || null,
          owner: owner || null,
          // @agent_task is operator prose set verbatim at spawn (tmux is the operator's state, not a ledger); this
          // listing is where the dashboard's fleet rows and `calibrate` read it back, so it is redacted HERE — the
          // read boundary — like a pane capture. parent/owner are names judged by the session-name rule
          // and carry nothing a pattern could match.
          task: task ? redact(task) : null,
          created: Number(created) || 0,
          activity: Number(activity) || 0,
          attached: attached !== "0",
          windows: Number(windows) || 1,
        };
      });
  }

  async listSessionsDetailed(): Promise<
    Array<{ name: string; parent: string | null; owner: string | null; task: string | null; created: number; activity: number; attached: boolean; windows: number }>
  > {
    try {
      return await this.sessionsDetailedOrThrow();
    } catch (e) {
      if (isNoServer(e)) return []; // no server yet / server gone = no sessions (nickgnd#9)
      throw e;
    }
  }

  private async panesBySessionOrThrow(): Promise<Map<string, { pid: number; currentCmd: string; cwd: string; dead: boolean }>> {
    const FMT = ["#{session_name}", "#{pane_pid}", "#{pane_current_command}", "#{pane_current_path}", "#{pane_dead}"].join("\t");
    const out = new Map<string, { pid: number; currentCmd: string; cwd: string; dead: boolean }>();
    const { stdout } = await this.exec(["list-panes", "-a", "-F", FMT]);
    for (const l of stdout.trim().split("\n").filter(Boolean)) {
      const [name, pid, currentCmd, cwd, dead] = l.split("\t");
      if (!out.has(name)) out.set(name, { pid: Number(pid), currentCmd, cwd, dead: dead === "1" });
    }
    return out;
  }

  /**
   * All panes on the server in ONE exec, keyed by session (first pane wins for summary use). Both ways of having no
   * panes to list are the same empty Map: no server at all (nickgnd#9) and a live server with zero sessions, whose
   * `list-panes -a` has no current target to list (before this was handled it threw an uncaught TmuxError on the
   * second, against the promise this comment makes, on the warm socket a fleet operator keeps alive).
   */
  async listPanesBySession(): Promise<Map<string, { pid: number; currentCmd: string; cwd: string; dead: boolean }>> {
    try {
      return await this.panesBySessionOrThrow();
    } catch (e) {
      if (isNoServer(e) || isNothingToList(e)) return new Map();
      throw e;
    }
  }

  /**
   * Reachability-aware fleet listing for the dashboard poll. Unlike
   * listSessionsDetailed()/listPanesBySession() — which swallow a dead server to an empty fleet so
   * start-before-a-server and the survival path keep working — this reports
   * `reachable:false` with the tmux error when the listing throws, so the dashboard can tell a
   * dead tmux server ("is it broken?") from a genuinely idle one ("is it just quiet?").
   *
   * The SESSIONS listing decides: if it resolved, the server answered, so it is up — a live server with
   * zero sessions returns rc 0 and no rows there while `list-panes -a` fails with "no current target", and reading
   * that as death told the operator to restart a server that was up (measured). So the panes come through
   * the swallowing lister, whose empty Map is the right answer for "nothing to list". A failure of the sessions
   * listing is still unreachable in tmux's own words, and any OTHER tmux failure of the panes listing still is too (a
   * wedged server that times out is a failure mode); a non-tmux error propagates. Two execs — the poll stays O(1).
   */
  async listFleetReachable(): Promise<{
    reachable: boolean;
    error: string | null;
    sessions: Awaited<ReturnType<Tmux["listSessionsDetailed"]>>;
    panes: Awaited<ReturnType<Tmux["listPanesBySession"]>>;
  }> {
    try {
      const [sessions, panes] = await Promise.all([this.sessionsDetailedOrThrow(), this.listPanesBySession()]);
      return { reachable: true, error: null, sessions, panes };
    } catch (e) {
      if (!(e instanceof TmuxError)) throw e;
      const msg = (e.stderr || e.message || "tmux unreachable").trim();
      return { reachable: false, error: msg.slice(0, 200), sessions: [], panes: new Map() };
    }
  }

  async capturePane(name: string, lines = 200): Promise<string> {
    const { stdout } = await this.exec([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      paneTarget(name),
      "-S",
      `-${lines}`,
    ]);
    return stdout;
  }

  async paneInfo(name: string): Promise<{ pid: number; currentCmd: string; cwd: string; dead: boolean }> {
    const { stdout } = await this.exec([
      "display-message",
      "-p",
      "-t",
      paneTarget(name),
      "#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_dead}",
    ]);
    const [pid, currentCmd, cwd, dead] = stdout.trim().split("\t");
    return { pid: Number(pid), currentCmd, cwd, dead: dead === "1" };
  }
}
