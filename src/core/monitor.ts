/**
 * State classification + watch triggers.
 *
 * Classification is PROFILE-driven: the generic core knows only universal signals
 * (pane exists, process alive, output growing). What "working" vs "idle" vs "stuck at a
 * menu" looks like for a given agent CLI lives in an AgentProfile — our claude-code
 * profile encodes the heuristics we ran a 26-session fleet on; add your own for other CLIs.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { Tmux } from "./tmux.js";
import { ActivityTracker, sampleCpu } from "./activity.js";
import { Ledger } from "./ledger.js";
import { CaptureWatchdog } from "./watchdog.js";
import { LexiconConfig, LexiconProfile, compilePattern } from "./lexicon.js";
import { redact } from "./redact.js";

export type SessionState = "WORKING" | "IDLE" | "BLOCKED" | "ERROR" | "DEAD" | "GONE" | "UNKNOWN";

export interface AgentProfile {
  name: string;
  /** classify from the last N non-empty pane lines (LIVE tail only — whole-scrollback grep gives stale false-positives) */
  classify(tail: string[]): SessionState | null;
  /** optional context-pressure extractor, 0..100 */
  contextPct?(tail: string[]): number | null;
}

export const genericShellProfile: AgentProfile = {
  name: "generic-shell",
  classify: () => null, // no opinion; core signals decide
};

/**
 * A profile name this Monitor does not hold — the value as typed and the names that WOULD have been accepted, after
 * the argument. `profileName` is a covered parameter on four Monitor signatures (snapshot, fleet,
 * fleetReport, fleetFast's opts). Until 2026-09-22 (measured on an earlier build)
 * an unknown or misspelled name — "no-such-profile", or "Acme" for a lexicon profile
 * named "acme" — silently fell back to the auto chain: the caller received auto's verdict labelled with whichever
 * profile spoke, byte-identical to the unnamed call, and no field on a Snapshot told the two apart, so a supervisor
 * asking for a profile by the name README's table prints and misspelling it could not learn so. The refusal is the
 * package's idiom for a bad argument (SessionNameError, SocketNameError, AgentNameError, SinceError, OutPathError);
 * names are exact. The CLI (`status --profile`, `watch --profile`) and the MCP server (`profile` on
 * session-status and fleet-status) pass the name through; the dashboard still passes none.
 */
export class ProfileNameError extends Error {
  constructor(name: unknown, held: readonly string[]) {
    super(`unknown profile name: ${JSON.stringify(name)} (this Monitor holds: ${held.join(", ")})`);
    this.name = "ProfileNameError";
  }
}

/**
 * The profile `name` names among `profiles`, or ProfileNameError — the ONE rule for a profile name, so the CLI's
 * `--profile` judge (which must refuse before a home's ledger sees a verdict, and therefore judges with the chain the
 * lexicon resolved rather than through a Monitor call) and Monitor.namedProfile cannot disagree about which names
 * are held. Names are exact: "Acme" is not "acme".
 */
export function assertProfileName(name: string, profiles: readonly AgentProfile[]): AgentProfile {
  const found = profiles.find((p) => p.name === name);
  if (!found) throw new ProfileNameError(name, profiles.map((p) => p.name));
  return found;
}

/**
 * Build an AgentProfile from a lexicon entry — the escape hatch that makes "agnostic" true.
 *
 * The three built-in profiles below are the CLIs WE run. When a live `codex` sat on a blocking
 * update prompt and reported IDLE (it draws `›` where Claude Code draws `❯`), we could fix it by
 * writing a profile in this file. An adopter with a fourth CLI could not: they had to fork.
 * `lexicon.json` closes that, and these profiles are tried BEFORE the built-ins so an adopter can
 * also CORRECT one of ours against their fork of a CLI.
 *
 * Precedence within a profile is ERROR > BLOCKED > WORKING > IDLE, matching the built-ins: a CLI
 * erroring every turn looks idle but is permanently stuck, so ERROR has to outrank everything.
 */
export function profileFromLexicon(spec: LexiconProfile): AgentProfile {
  /**
   * Flags are `im`, and the `m` is load-bearing.
   *
   * Patterns are matched against the pane tail JOINED with newlines, so without `m` a `^` anchors
   * to the start of the whole tail rather than each line — meaning `^\s*»\s*\d+\.` matched only
   * when the prompt happened to be the FIRST line of the tail. Caught by macOS CI, where a 60-char
   * runner hostname in the shell prompt pushed the marker off line 1: state came back IDLE while
   * the pane plainly showed a blocking prompt. That is the exact class of silent failure this
   * whole feature exists to remove, reintroduced by a missing flag.
   *
   * The built-in aider profile already used `/im` for the same reason; the lexicon path did not,
   * so a user-written pattern was strictly weaker than an equivalent built-in one.
   */
  const compile = (pats: string[] | undefined, key: string) =>
    (pats ?? []).map((p, i) => compilePattern(p, "im", `profile "${spec.name}".${key}[${i}]`));
  const rules: Array<[SessionState, RegExp[]]> = [
    ["ERROR", compile(spec.error, "error")],
    ["BLOCKED", compile(spec.blocked, "blocked")],
    ["WORKING", compile(spec.working, "working")],
    ["IDLE", compile(spec.idle, "idle")],
  ];
  const ctxRe = spec.contextPct ? compilePattern(spec.contextPct, "", `profile "${spec.name}".contextPct`) : null;
  return {
    name: spec.name,
    classify(tail) {
      const t = tail.join("\n");
      for (const [state, res] of rules) {
        if (res.some((re) => re.test(t))) return state;
      }
      return null;
    },
    contextPct: ctxRe
      ? (tail) => {
          const m = tail.join("\n").match(ctxRe);
          if (!m?.[1]) return null;
          const n = Number(m[1]);
          if (!Number.isFinite(n)) return null;
          // some CLIs report context REMAINING (codex) rather than used (claude-code)
          const pct = spec.contextPctInverted ? 100 - n : n;
          return Math.max(0, Math.min(100, pct));
        }
      : undefined,
  };
}

/**
 * The profile chain a Monitor should use: lexicon profiles first (so they can override ours),
 * then the built-ins, then generic-shell as the no-opinion floor. `replaceProfiles: true` drops
 * the built-ins for an operator who wants only their own vocabulary.
 */
export function resolveProfiles(cfg: LexiconConfig = {}): AgentProfile[] {
  const user = (cfg.profiles ?? []).map(profileFromLexicon);
  if (cfg.replaceProfiles) return [...user, genericShellProfile];
  return [...user, claudeCodeProfile, codexProfile, aiderProfile, genericShellProfile];
}

export const claudeCodeProfile: AgentProfile = {
  name: "claude-code",
  classify(tail) {
    const t = tail.join("\n");
    // ERROR outranks all: CLI erroring every turn looks "idle" but is permanently stuck
    if (/API Error|safeguards flagged|rate.?limit(ed)?/i.test(t)) return "ERROR";
    // NOTE: do NOT match a bare "tokens" — Claude Code's IDLE footer reads
    // "new task? /clear to save 130.3k tokens" and would false-positive as WORKING.
    if (/esc to interrupt|✻|✶|✽|⚒|Compacting|running (stop hooks|scheduled)|↓\s*[\d.]+k?\s*tokens/i.test(t)) return "WORKING";
    if (/❯\s*1\.|Enter to select|Tab\/Arrow|awaiting|should I proceed|y\/n/i.test(t)) return "BLOCKED";
    return null;
  },
  contextPct(tail) {
    // Claude Code's status line writes the context figure two ways: `ctx:71%`, and — with the status-line plugin the
    // fleet runs — a bar before the number, `ctx:[#######---]71%`. Measured 2026-10-13 14:00Z on the live fleet
    // 19 of 31 panes carried the token, every one in the bar form, and `ctx:(\d+)%` read null on all of
    // them — the dashboard's ctx badge and its ≥80 tier had nothing to show. The bar is optional and opaque here: any
    // run of non-`]` glyphs between the colon and the number, whatever the plugin draws it with. Fixtures:
    // test/fixtures/live-tails-2026-10-13.json via test/profiles.test.js. Note that this extractor is consulted only
    // for a pane this profile CLAIMED (inspect/peekProfiles below) — an idle Claude pane is a separate change.
    const m = tail.join("\n").match(/ctx:(?:\[[^\]]*\])?(\d+)%/);
    return m ? Number(m[1]) : null;
  },
};

/**
 * OpenAI Codex CLI (codex-cli 0.14x). Built from REAL captured pane text, not invented strings:
 * driving a live `codex` through tmux-agent showed it parked on a blocking update prompt
 * ("› 1. Update now  2. Skip  ... Press enter to continue") which the claude-code profile read as
 * IDLE — a supervisor would never learn the session was waiting on a human. Codex uses "›" where
 * Claude Code uses "❯", which is exactly the kind of per-CLI detail a profile exists to hold.
 *
 * Anchored to codex's OWN rendering, never to English a pane might contain. Until 2026-10-13
 * (an earlier build) the BLOCKED rule also fired on the bare word `approve` and the WORKING rule on `thinking|working`:
 * measured on the live fleet at 14:00Z, three Claude Code panes read codex.WORKING because their status line
 * carries the mode word `thinking` between pipes, and a bash prompt after a finished `codex exec` read
 * codex.BLOCKED because the review's closing prose said `approved with nits` — a false BLOCKED on a shell —
 * while the only true hit was a real `› 3.` menu. The chain asks profiles in order and the first with an
 * opinion speaks, so a generic word in THIS profile mislabels every pane the claude-code profile declined.
 * The anchors that remain are things only codex draws: its menu glyph before a numbered item, its
 * `Press enter to continue`, `(y/n)` and `Allow command?` lines, its braille spinner, `Esc to interrupt`.
 * Fixtures: test/fixtures/live-tails-2026-10-13.json (the tails, scrubbed) via test/profiles.test.js.
 */
export const codexProfile: AgentProfile = {
  name: "codex",
  classify(tail) {
    const t = tail.join("\n");
    if (/error:|failed to|rate.?limit(ed)?|unauthorized|stream error/i.test(t)) return "ERROR";
    // blocking prompts: numbered menus with either arrow glyph, y/n, and Codex's own question — never a bare
    // `approve`, which a shell's scrollback says whenever a review was approved
    if (/(^|\s)[›❯>]\s*\d+\.\s|Press enter to continue|\(y\/n\)|Allow command\?/i.test(t)) return "BLOCKED";
    // Codex draws a braille spinner while it works and "Esc to interrupt" beside it; the words `thinking` and
    // `working` are not codex's — Claude Code's status line carries `thinking` as its mode
    if (/Esc to interrupt|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/i.test(t)) return "WORKING";
    return null;
  },
  contextPct(tail) {
    // codex reports context as "context left: NN%" in recent versions; absent otherwise
    const m = tail.join("\n").match(/context (?:left|remaining)[:\s]+(\d+)%/i);
    return m ? 100 - Number(m[1]) : null;
  },
};

/**
 * aider — line-oriented, no TUI. Its prompt is the signal; a diff awaiting confirmation blocks.
 * NOTE: aider is not installed on the dev host, so this profile is written from its documented
 * prompts and is marked BEST-EFFORT in the README until someone runs it for real.
 */
export const aiderProfile: AgentProfile = {
  name: "aider",
  classify(tail) {
    const t = tail.join("\n");
    if (/^\s*(Error|Traceback|APIError|RateLimitError)/im.test(t)) return "ERROR";
    if (/\(Y\)es\/\(N\)o|Apply edit|Add .* to the chat\?|\[Y\/n\]/i.test(t)) return "BLOCKED";
    if (/^\s*(Thinking|Applying edit|Committing|Running)/im.test(t)) return "WORKING";
    return null;
  },
};

export interface Snapshot {
  session: string;
  state: SessionState;
  contextPct: number | null;
  logBytes: number | null;
  /** RSS of the pane's whole process tree (H2, health epic) — null when /proc is unavailable
   * or the process vanished mid-scan; NEVER a faked zero */
  rssBytes: number | null;
  /** CPU rate from the fleet poll delta; null on the deep path (single sample, no baseline) */
  cpuPerSec: number | null;
  /** the pane's last non-empty line, redacted (core/redact.ts) and then cut to 160 chars; "" for a GONE */
  lastLine: string;
  at: string;
  /**
   * Which profile actually decided this state, or null when NO profile had an opinion and the
   * state came from core signals alone.
   *
   * Why this is on the wire: `IDLE` from a profile that recognised an idle prompt and `IDLE`
   * from "nobody could classify this, so we defaulted" are the same value with completely
   * different meanings. That ambiguity IS the codex bug generalised — a live `codex` parked on a
   * blocking prompt reported IDLE and looked healthy. We fixed it for codex by writing a
   * profile; an adopter with an unprofiled CLI still gets confident-looking IDLE with no hint
   * that the tool is guessing. Surfacing the classifier lets the dashboard say "unclassified"
   * instead of pretending to know.
   */
  classifiedBy: string | null;
  /**
   * WHY a session is GONE, in tmux's own words — "no server running on /tmp/tmux-1000/<socket>",
   * "error connecting to … (No such file or directory)" — and null on every other state, and on a
   * GONE the server itself answered (the session is simply absent).
   *
   * Why this is on the wire: GONE alone conflates the two failures a supervisor must handle
   * differently. One session died → restart that session. The tmux SERVER died → every session in
   * the charter is gone and the socket needs a server before any restart can work. Measured
   * 2026-09-16 on an earlier build: a killed session and a dead server produced snapshots differing in NO
   * key or value but `session` and `at` on all three per-session surfaces (`watch`, MCP
   * session-status, /api/session), while /api/fleet.tmux and status.json.tmux already carried the
   * verdict — the same ambiguity the server-reachability check removed, one level down.
   */
  reason: string | null;
}

/**
 * Whether the tmux server is answering, from the fleet poll. `since` is when
 * the current reachable-state began; `error` is the tmux stderr while unreachable, else null. An
 * unreachable server and an idle one are otherwise the same empty `sessions[]` — this is how the
 * dashboard tells them apart.
 */
export interface TmuxStatus {
  reachable: boolean;
  since: string;
  error: string | null;
}

export class Monitor {
  private lastState = new Map<string, SessionState>();
  /** CPU-based activity: tmux's own activity timestamps do not move on pane output (verified).
   *  Public so a test can substitute a tracker with scripted samples (test/activity-hysteresis.test.js);
   *  production never reassigns it. */
  activity = new ActivityTracker();
  /** pipe-stall watchdog — optional because only surfaces with an Orchestrator can re-arm.
   *  Fed from snapshot() (which already holds pane text); fleetFast has no pane text, so
   *  fleet-scale polling stays O(1) and the deep-inspect/watch paths carry the guard. */
  watchdog?: CaptureWatchdog;
  /**
   * Fires once per tmux reachability TRANSITION (never per poll) — the seam the dashboard uses to
   * reuse its notify sink without giving the Monitor a sink of its own (mirrors `watchdog?`).
   * Set by startWeb(); unset on the CLI paths, which must not page on tmux death.
   */
  onTmuxTransition?: (status: TmuxStatus) => void;
  /** tmux reachability across polls: null = not yet observed (first poll is a baseline, no event) */
  private tmuxReachable: boolean | null = null;
  private tmuxSince = new Date().toISOString();
  /** session names present at the last reachable poll — closed with one GONE each when tmux dies */
  private lastReachableSessions: string[] = [];
  /**
   * The last fleetFast poll's tmux verdict, kept for the surfaces that do not poll.
   * Measured 2026-09-16 on an earlier build: the daemon's own H3 tick had ledgered `fleet.tmux` and paged
   * within 3 s of a kill-server, while /api/health — the documented monitoring integration point —
   * and `doctor` kept answering as if nothing had happened; only /api/fleet carried the status.
   * null until the first poll (the baseline); `checkedAt` is the time of the most recent poll,
   * reachable or not, so a consumer can tell a dead tick from a live one.
   */
  private lastTmuxStatus: (TmuxStatus & { checkedAt: string }) | null = null;
  constructor(
    private readonly tmux: Tmux,
    private readonly ledger: Ledger,
    private readonly home: string,
    private readonly profiles: AgentProfile[] = [claudeCodeProfile, codexProfile, aiderProfile, genericShellProfile],
  ) {}

  /**
   * What the most recent fleetFast poll said about the tmux server, without a tmux exec: the same
   * `reachable` / `since` / `error` /api/fleet served for that poll, plus `checkedAt` — the time of
   * the poll itself. null before the first poll. The dashboard serves this on /api/health so a
   * scraper, and `doctor` through it, learns of the server's death from the daemon's own tick
   * rather than from a browser happening to poll /api/fleet.
   */
  tmuxStatus(): (TmuxStatus & { checkedAt: string }) | null {
    return this.lastTmuxStatus ? { ...this.lastTmuxStatus } : null;
  }

  /**
   * A profile pass that OBSERVES and reports but changes nothing: each named session's last six pane lines
   * through the profile chain — the verdict snapshot() would give — with no ledger row filed and no transition
   * bookkeeping moved. The dashboard's health tick runs it over the whole fleet so the fast rows can carry the last
   * deep verdict beside their CPU one and say which they show. `state` is null when no profile had an opinion (the
   * caller keeps its CPU verdict and says so); a session whose pane cannot be read is absent from the map, never a
   * faked entry. Measured 2026-10-13 14:00Z on the live fleet: the fast path called 26 of 31 sessions WORKING where the
   * classifier said 8, and a codex menu waiting on a human read IDLE on every poll until a human clicked it. Why not
   * snapshot(): it files a session.state row on every change and moves lastState, the same bookkeeping the fast path's
   * `via: "cpu"` rows come from — two classifiers writing one state machine would alternate on every disagreeing
   * session each tick, the churn an earlier fix removed. One pane read per session, sequential, so a 31-pane
   * fleet costs the tick 31 execs and nothing else.
   */
  async peekProfiles(names: string[]): Promise<Map<string, { state: SessionState | null; classifiedBy: string | null; contextPct: number | null; at: string }>> {
    const out = new Map<string, { state: SessionState | null; classifiedBy: string | null; contextPct: number | null; at: string }>();
    for (const name of names) {
      let pane: string;
      try {
        pane = await this.tmux.capturePane(name, 40);
      } catch {
        continue; // gone, or the server is: no entry rather than a verdict nobody read
      }
      const tail = pane.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6);
      const profile = this.profiles.find((p) => p.classify(tail) !== null);
      const state = profile ? profile.classify(tail) : null;
      const spoke = state !== null && profile !== undefined && profile.name !== "generic-shell";
      out.set(name, {
        state: spoke ? state : null,
        classifiedBy: spoke ? profile.name : null,
        contextPct: spoke ? profile.contextPct?.(tail) ?? null : null,
        at: new Date().toISOString(),
      });
    }
    return out;
  }

  /**
   * The profile `profileName` names, judged BEFORE any tmux call so the refusal precedes the driver like every other
   * argument refusal in the package; undefined when no name was given, and the auto chain decides. Every public
   * method that takes the name judges it first — an empty fleet is refused too, because the name is an argument,
   * not something a session happened to need.
   */
  private namedProfile(profileName: string | undefined): AgentProfile | undefined {
    if (profileName === undefined) return undefined;
    return assertProfileName(profileName, this.profiles);
  }

  async snapshot(session: string, profileName?: string): Promise<Snapshot> {
    const named = this.namedProfile(profileName);
    const at = new Date().toISOString();
    // The presence check carries its own failure: a server that never answered says so in its stderr, and
    // that is the difference between "restart this session" and "there is no server to restart it on". Same one exec
    // as hasSession() — the live path pays nothing, and the GONE path invents nothing tmux did not say.
    const { present, unreachable } = await this.tmux.hasSessionChecked(session);
    if (!present) {
      // emit the final transition once, then forget the session: a later spawn reusing this
      // name must not be compared against the dead session's state.
      const prev = this.lastState.get(session);
      if (prev !== undefined && prev !== "GONE") {
        this.ledger.emit({ type: "session.state", session, data: { from: prev, to: "GONE" } });
      }
      this.lastState.delete(session);
      return { session, state: "GONE", contextPct: null, logBytes: null, rssBytes: null, cpuPerSec: null, lastLine: "", at, classifiedBy: null, reason: unreachable };
    }
    const [pane, info] = await Promise.all([this.tmux.capturePane(session, 40), this.tmux.paneInfo(session)]);
    // a failed re-arm must never break status reporting — the stall event is already ledgered
    if (this.watchdog) await this.watchdog.observe(session, pane).catch(() => {});
    const lines = pane.split("\n").map((l) => l.trimEnd()).filter(Boolean);
    const tail = lines.slice(-6);
    const lastLine = tail[tail.length - 1] ?? "";

    let state: SessionState | null = info.dead ? "DEAD" : null;
    // a named profile answers alone — even with no opinion (IDLE / classifiedBy null), which is how a caller can
    // tell an honoured name from an ignored one; unnamed, the first profile with an opinion speaks
    const profile = named ?? this.profiles.find((p) => p.classify(tail) !== null) ?? genericShellProfile;
    if (!state) state = profile.classify(tail);
    // Record whether a profile actually spoke. `profile` is non-null either way (generic-shell is
    // the floor), so identity is not the test — having produced a state is.
    const classifiedBy = state !== null && profile.name !== "generic-shell" ? profile.name : null;

    // core signal fallback: durable-log growth over a short window = WORKING
    let logBytes: number | null = null;
    try {
      logBytes = statSync(join(this.home, "logs", `${session}.log`)).size;
    } catch {
      /* no capture */
    }
    if (!state) state = "IDLE";

    const ctx = profile.contextPct?.(tail) ?? null;
    // memory rides the deep path too: one /proc pass for this session's tree (H2). A missing
    // entry (no /proc, or the process died mid-scan) stays null — never a faked zero.
    const mem = info.pid > 0 ? sampleCpu([info.pid]).byPid.get(info.pid) : undefined;
    const snap: Snapshot = {
      session, state, contextPct: ctx, logBytes,
      rssBytes: mem?.rssBytes ?? null, cpuPerSec: null,
      // Redacted at the producer, BEFORE the cut. This is the one pane read built to be forwarded — the
      // body of every `watch` notification, a field of every status.json record and of the MCP status replies — and
      // until 2026-09-23 it was the one read path redact() never saw: a key-shaped last line reached a loopback
      // webhook raw while capture-pane, read-log and the ledger redacted it.
      // Redact first: a key whose tail straddles column 160 would otherwise be cut below its
      // pattern and survive as a partial. The profiles above read the RAW tail on purpose — a blocked-prompt
      // pattern must match what the pane shows, not what we publish (test/lastline-redaction.test.js pins both).
      lastLine: redact(lastLine).slice(0, 160), at, classifiedBy,
      reason: null, // only a GONE has a cause to explain
    };

    const prev = this.lastState.get(session);
    if (prev !== state) {
      this.lastState.set(session, state);
      this.ledger.emit({ type: "session.state", session, data: { from: prev ?? null, to: state, ctx } });
    }
    return snap;
  }

  async fleet(profileName?: string): Promise<Snapshot[]> {
    this.namedProfile(profileName); // before listing: listSessions() swallows a dead server into [], which must not hide a bad name
    const sessions = await this.tmux.listSessions();
    return Promise.all(sessions.map((s) => this.snapshot(s.name, profileName)));
  }

  /**
   * The listing the CONSUMER surfaces read — status.json (the collector's file) and MCP fleet-status (the agent's
   * tool) — carrying its own verdict on the server it listed. fleet() above rides listSessions(), which
   * swallows a dead server into [] on purpose (spawn must start before a server exists, nickgnd#9), so both surfaces
   * published `sessions: []` for a dead server — identical in every key but generatedAt to a socket no server ever
   * ran on — while the daemon's own poll had ledgered fleet.tmux and paged within 3 s (measured 2026-09-16).
   * This rides listFleetReachable() instead: the same per-session snapshots fleet() gives (deep
   * classification through snapshot()) plus `tmux` in the /api/health shape — reachable:false with tmux's own words
   * when the listing threw. It is a READ, not a poll: no fleet.tmux, no GONE, and the poll state tmuxStatus()
   * reports is untouched — a cron's `status` every minute on a dead server writes no rows, and fleetFast stays the
   * one owner of the transition. `since` is the Monitor's transition time when its polls have observed the state
   * being reported (the daemon serving both), else `checkedAt` — a one-shot process has observed no transition and
   * invents none. listSessions()'s swallow stays as it is.
   */
  async fleetReport(profileName?: string): Promise<{ sessions: Snapshot[]; tmux: TmuxStatus & { checkedAt: string } }> {
    this.namedProfile(profileName); // judged before the listing, as fleet() does
    const { reachable, error, sessions } = await this.tmux.listFleetReachable();
    const checkedAt = new Date().toISOString();
    const since = this.tmuxReachable === reachable ? this.tmuxSince : checkedAt;
    const snaps = await Promise.all(sessions.map((s) => this.snapshot(s.name, profileName)));
    return { sessions: snaps, tmux: { reachable, since, error: reachable ? null : error, checkedAt } };
  }

  /**
   * CHEAP fleet view — 2 tmux execs total regardless of fleet size (vs 5 per session).
   * Used by the dashboard/status polling path. Trade-off: no per-session pane regex, so
   * state comes from process + activity signals; `deep` upgrades chosen sessions only.
   *
   *   CPU delta of the pane's process tree -> WORKING / IDLE   (see core/activity.ts:
   *     tmux's session_activity only moves on client attach and window_activity does not
   *     move on pane output — both verified, both would mislabel every detached lane).
   *     The verdict carries hysteresis: a flip needs a sustained change across two
   *     decisive samples, never one 30 s window — a CLI's idle heartbeat straddles any single
   *     threshold and flapped on 83 % of ticks before.
   *   pane_dead -> DEAD ; first poll -> UNKNOWN (baseline, never a false "idle")
   * A session whose CLI is erroring every turn still LOOKS idle here — that is why the
   * dashboard deep-inspects the selected session and why ERROR detection stays in profiles.
   */
  async fleetFast(opts: { idleAfterSecs?: number; deep?: string[]; profileName?: string } = {}): Promise<{ sessions: Snapshot[]; tmux: TmuxStatus }> {
    // judged before the listing AND before the transition bookkeeping below, so a refused poll changes no state;
    // the name only reaches a profile on `deep` sessions, but it is judged as an argument either way
    this.namedProfile(opts.profileName);
    const { reachable, error, sessions, panes } = await this.tmux.listFleetReachable();

    // --- tmux reachability transition ---------------------------------------------
    // A dead tmux server and an idle one both list zero sessions; without this the dashboard
    // cannot tell them apart, `watch`/notify has nothing to fire on, and every vanished session's
    // span stays open forever (waste overstated). Events fire on TRANSITIONS only — bounded ledger
    // growth is itself a resource-bounds property — and that holds only because the CPU verdict below flips on
    // SUSTAINED change (activity.ts hysteresis): a transition-only ledger fed by a
    // classifier that transitioned on noise was 31k events/day, 100 % of ledger volume.
    const nowIso = new Date().toISOString();
    const prevReach = this.tmuxReachable;
    if (prevReach === null) {
      this.tmuxSince = nowIso; // first observation is a baseline, not a transition — no event
    } else if (prevReach !== reachable) {
      this.tmuxSince = nowIso;
      this.ledger.emit({
        type: "fleet.tmux",
        data: { from: prevReach ? "reachable" : "unreachable", to: reachable ? "reachable" : "unreachable", since: nowIso, error },
      });
      if (!reachable) {
        // close the span of every session seen while the server was up — exactly one GONE each,
        // the event snapshot() already emits, so timeline/waste stop counting them as live.
        for (const name of this.lastReachableSessions) {
          const prev = this.lastState.get(name);
          if (prev === "GONE") continue;
          this.ledger.emit({ type: "session.state", session: name, data: { from: prev ?? null, to: "GONE" } });
          this.lastState.delete(name);
        }
        this.lastReachableSessions = [];
      }
      this.onTmuxTransition?.({ reachable, since: nowIso, error: reachable ? null : error });
    }
    this.tmuxReachable = reachable;
    const tmux: TmuxStatus = { reachable, since: this.tmuxSince, error: reachable ? null : error };
    this.lastTmuxStatus = { ...tmux, checkedAt: nowIso }; // for /api/health and doctor

    const deep = new Set(opts.deep ?? []);
    const out: Snapshot[] = [];

    // one /proc pass for the whole fleet; compares against the previous poll
    const pids = [...panes.values()].map((p) => p.pid).filter((p) => p > 0);
    const cpu = this.activity.update(pids);

    for (const s of sessions) {
      if (deep.has(s.name)) {
        out.push(await this.snapshot(s.name, opts.profileName));
        continue;
      }
      const pane = panes.get(s.name);
      const act = pane ? cpu.get(pane.pid) : undefined;
      const state: SessionState = pane?.dead
        ? "DEAD"
        : act?.busy === true
          ? "WORKING"
          : act?.busy === false
            ? "IDLE"
            : "UNKNOWN"; // first poll = baseline, not a false "idle"
      let logBytes: number | null = null;
      try {
        logBytes = statSync(join(this.home, "logs", `${s.name}.log`)).size;
      } catch {
        /* no capture */
      }
      const snap: Snapshot = {
        session: s.name,
        state,
        contextPct: null, // needs pane text; filled in on deep-inspect
        logBytes,
        rssBytes: act?.rssBytes ?? null,
        cpuPerSec: act?.jiffiesPerSec ?? null,
        lastLine: pane ? `${pane.currentCmd}${act?.jiffiesPerSec != null ? ` (cpu ${act.jiffiesPerSec}/s)` : ""}` : "",
        at: new Date().toISOString(),
        // The fast path reads no pane text at all (that is what makes it O(1) in tmux calls), so
        // no profile ran. Honest null rather than a claim: fleet rows say "unclassified" until a
        // human selects the session and the deep path gives a profile something to read.
        classifiedBy: null,
        // this loop only runs over sessions the server just LISTED, so there is no death to explain;
        // the poll's verdict on the server itself rides `tmux` beside these rows
        reason: null,
      };
      const prev = this.lastState.get(s.name);
      // The first poll is a CPU baseline (busy === null -> UNKNOWN); that is not a state
      // CHANGE and must not be ledgered, or every server restart inflates stateChurn by one
      // per session and pollutes the waste report.
      const baselinePass = state === "UNKNOWN" && prev === undefined;
      if (prev !== state && !baselinePass) {
        this.lastState.set(s.name, state);
        this.ledger.emit({ type: "session.state", session: s.name, data: { from: prev ?? null, to: state, via: "cpu", cpu: act?.jiffiesPerSec ?? null } });
      }
      out.push(snap);
    }
    // remember who was live while the server answered, so the next unreachable poll can close them
    if (reachable) this.lastReachableSessions = sessions.map((s) => s.name);
    return { sessions: out, tmux };
  }
}

