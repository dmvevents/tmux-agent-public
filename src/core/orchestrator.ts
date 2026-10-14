/**
 * Orchestration: spawn/adopt/kill with parent→child lineage, verified input, sync exec,
 * durable capture. The supervisor-grade layer no existing tmux MCP tool ships.
 *
 * Lineage lives IN tmux (session user-options @agent_parent/@agent_task/@agent_owner), so it
 * survives our process dying and is queryable by anything that can run `tmux show-options`.
 * No orphans: spawn() requires a parent ("user" counts); kill refuses sessions we don't own
 * unless policy says otherwise.
 */
import { mkdirSync, writeFileSync, unlinkSync, readFileSync, chmodSync, statSync, accessSync, constants } from "node:fs";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Tmux, paneTarget, sessionTarget, assertName } from "./tmux.js";
import { Ledger } from "./ledger.js";
import { redact } from "./redact.js";
import { Policy, PolicyDenied, type Action } from "./policy.js";
import { rotateIfNeeded } from "./rotate.js";

export interface SpawnSpec {
  name: string;
  cwd: string; // the directory the session is born in — judged by assertCwd, resolved against the caller's own
  command?: string; // launched via send-keys after shell ready (survivable shell wrapper)
  parent: string; // REQUIRED — the no-orphans rule
  task?: string;
  env?: Record<string, string>;
}

/** A directory the session cannot be born in — the reason in words and the value as typed; the CLI turns it into exit 64, MCP into isError. */
export class CwdError extends Error {
  constructor(reason: "no such directory" | "not a directory" | "cannot enter", dir: unknown) {
    super(`--cwd: ${reason} ${JSON.stringify(dir)} — give a directory`);
    this.name = "CwdError";
  }
}

/**
 * The one judgement of the directory a session is born in, before a tmux server, the home or the ledger is touched.
 * Until 2026-09-15 (measured on an earlier build) `spec.cwd` went
 * straight into `new-session -c`; tmux chdir()s in the server and on failure falls back to $HOME in silence, so a
 * typo of a repo path, a file and a 000-mode directory each printed `spawned X`, exit 0, the shell — and any launch
 * command — in $HOME, `status` reading IDLE and the session.spawned row recording the value as typed; a relative
 * value was left to tmux to resolve, the row holding the relative text either way. Resolved FIRST, against this
 * process's own directory — the caller's, at the CLI — so the pane lands where the caller stood and the ledger holds
 * the directory the pane has; then it must exist, be a directory and be enterable by this user (X_OK, what chdir
 * needs — root enters anything). Never a mkdir: what the operator mistyped is not created. Returns the absolute path
 * tmux is given. The CLI judges the same value through this function before constructing the class, so a refusal
 * there leaves no home; spawn() judges it again for a caller that builds a spec directly, and over MCP that throw IS
 * the isError reply (src/mcp/server.ts catches it).
 */
export function assertCwd(dir: unknown): string {
  if (typeof dir !== "string" || dir === "") throw new CwdError("no such directory", dir);
  const abs = resolve(dir);
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // ENOTDIR: a component of the path is a file — nothing of that name can be a directory either
    throw new CwdError(code === "ENOENT" || code === "ENOTDIR" ? "no such directory" : "cannot enter", dir);
  }
  if (!st.isDirectory()) throw new CwdError("not a directory", dir);
  try {
    accessSync(abs, constants.X_OK);
  } catch {
    throw new CwdError("cannot enter", dir);
  }
  return abs;
}

/**
 * What sendVerified() throws for a text with nothing in it — empty, or whitespace only — before the policy gate and
 * before any tmux call: a typed no-op. Nothing is pasted, nothing submitted, nothing ledgered. Until
 * 2026-10-13 (an earlier build) an empty text pasted nothing, verified by definition (`needle.length === 0`) and submitted
 * Enter into the pane. The CLI maps it to exit 64 (EX_USAGE) beside its other refused values; over MCP it is the
 * isError reply; the dashboard's /api/send answers it as an error.
 */
export class EmptyTextError extends Error {
  constructor() {
    super("send: nothing to send — the text is empty or whitespace only");
    this.name = "EmptyTextError";
  }
}

/**
 * What `spawn()` throws when the session was created but its launch command did not land: sendVerified()
 * answered false — the paste showed nowhere in the pane and the one retry over a traceless pane showed nothing either,
 * or it left a trace and was not retried — and until 2026-10-13 (an earlier build) `if (spec.command) await
 * this.sendVerified(...)` dropped that boolean: spawn returned true, filed session.spawned, and the CLI printed
 * `spawned <name>` with exit 0 while the shell sat at its prompt with nothing running (the review's probe: two
 * input.verified ok:false rows, one session.spawned, created:true). The session is KEPT — a shell at its prompt is the
 * diagnosis, and nothing is killed on the caller's behalf — and `session` names it; the session.spawned row filed just
 * before the throw says `commandDelivered: false`. Over MCP the throw is the isError reply; the CLI exits 1 with this
 * message. A module export like EmptyTextError, not a root one: VERSIONING item 6's closure is unchanged.
 */
export class SpawnDeliveryError extends Error {
  constructor(public readonly session: string) {
    super(`spawn: ${session} was created but its command did not land — the shell is kept for diagnosis; the session.spawned row says commandDelivered:false`);
    this.name = "SpawnDeliveryError";
  }
}

/** The text a send must carry: at least one non-blank character. */
function assertText(text: string): void {
  if (typeof text !== "string" || text.trim().length === 0) throw new EmptyTextError();
}

/** One pane line as the verification compares it: runs of blanks collapsed, ends trimmed. */
const normLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * The non-empty normalized lines of `after` that `before` did not have — a MULTISET difference: a line
 * already on screen once that appears twice now counts once, a line changed in place counts as new, and a line that
 * was there all along — a stale echo of the same text — counts for nothing. This is what "the paste landed" is judged
 * on: the pane captured just before the paste against the pane captured after it, never the whole screen.
 */
export function linesAdded(before: string, after: string): string[] {
  const have = new Map<string, number>();
  for (const l of before.split("\n").map(normLine)) if (l) have.set(l, (have.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of after.split("\n").map(normLine)) {
    if (!l) continue;
    const n = have.get(l) ?? 0;
    if (n > 0) have.set(l, n - 1);
    else added.push(l);
  }
  return added;
}

export class Orchestrator {
  readonly home: string;
  private pasteSeq = 0;
  constructor(
    readonly tmux: Tmux,
    readonly ledger: Ledger,
    readonly policy: Policy,
    readonly actor = "tmux-agent",
  ) {
    // The actor is the owner every session this instance spawns is recorded under, the name every ledger row carries
    // and the string kill's ownership check compares — a name by the driver's rule, judged before the home is made.
    // Until 2026-09-15 (measured on an earlier build) `--actor
    // ../who` and `TMUX_AGENT_ACTOR=../env-who` went straight in: the owner in tmux's @agent_owner and the audit
    // envelope, every other actor's kill refused `owned by ../who`. The CLI and the MCP server judge the value first,
    // naming its source (exit 64 / exit 78); this throw is defence in depth for an embedder constructing the class.
    assertName(actor, "actor");
    this.home = process.env.TMUX_AGENT_HOME ?? join(homedir(), ".tmux-agent");
    // 0700: pane logs contain RAW terminal bytes (pipe-pane does not redact), so on a
    // multi-user host the directory itself must not be traversable by other UIDs.
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    mkdirSync(join(this.home, "logs"), { recursive: true, mode: 0o700 });
    try { chmodSync(this.home, 0o700); } catch { /* pre-existing, best effort */ }
  }

  /**
   * The audit event a refusal exists to leave. policy.ts:5 promises "every refusal is an auditable
   * event (caller logs control.denied)", and the caller is HERE, once, for every surface: the CLI,
   * the dashboard and the MCP server all reach a mutating verb through this class. Measured
   * 2026-09-13 on an earlier build: of ten refusal paths — the TUI and dead-pane guards,
   * read-only / deny-list / allow-list on every verb, MCP's read-only refusal, kill's ownership
   * check — only kill's wrote an event, so an operator whose read-only policy was turning an agent
   * away saw errors=0 in waste and an empty timeline. `reason` is the short cause the timeline
   * shows; `message` is the text the caller is thrown; the throw itself is unchanged. Returns the
   * error so a refusal reads `throw this.refused(...)`.
   */
  private refused(action: Action, session: string, reason: string, err: Error, extra: Record<string, unknown> = {}): Error {
    this.ledger.emit({ type: "control.denied", session, actor: this.actor, data: { action, reason, ...extra, message: err.message } });
    return err;
  }

  /** Policy gate for a mutating verb: assertAllowed's refusal is ledgered here, then rethrown as-is. */
  private gate(action: Action, session: string): void {
    try {
      this.policy.assertAllowed(action, session, this.actor);
    } catch (e) {
      throw this.refused(action, session, e instanceof PolicyDenied ? e.reason : "policy", e as Error);
    }
  }

  /**
   * Idempotent spawn: existing live session with this name = no-op (returns false). A launch command that did not land
   * is SpawnDeliveryError after the session.spawned row is filed with `commandDelivered: false`; the session is kept.
   */
  async spawn(spec: SpawnSpec): Promise<boolean> {
    // the name, the parent, then the directory: a value the session cannot be born under, of or in is a usage error,
    // refused before policy is consulted or a server is asked anything. Until
    // 2026-09-15 the name was judged only by tmux — hasSession below swallows assertName's throw — so `spawn 'vp bad'`
    // reached new-session and `../evil` was born as tmux's `__/evil` before the set-option that finally threw; the
    // parent was judged by nobody — `parent: "not a name!"` landed in @agent_parent and the session.spawned row, a
    // child ORPHANED by construction (engagement.ts: no session can bear that name). Over MCP each throw IS the
    // isError reply, in the CLI's words. The resolved path is what tmux and the ledger get.
    assertName(spec.name);
    assertName(spec.parent, "--parent");
    const cwd = assertCwd(spec.cwd);
    this.gate("spawn", spec.name);
    if (await this.tmux.hasSession(spec.name)) return false;

    const args = ["new-session", "-d", "-s", spec.name, "-c", cwd, "-x", "220", "-y", "50"];
    for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
    await this.tmux.exec(args);

    // Do not return until the server can actually answer for it. tmux's new-session exits
    // before the session is fully queryable, so a caller that immediately asks for status
    // gets GONE — verified over MCP, where spawn-session returned {created:true} and the very
    // next session-status said GONE.
    for (let i = 0; i < 20; i++) {
      if (await this.tmux.hasSession(spec.name)) break;
      await sleep(50);
    }

    // history-limit only applies at window creation — set globally on OUR socket so every
    // window this server creates gets it (verified footgun: live set-option does nothing).
    await this.tmux.exec(["set-option", "-g", "history-limit", "50000"]).catch(() => {});

    // lineage as tmux user options — survives us
    await this.tmux.exec(["set-option", "-t", paneTarget(spec.name), "@agent_parent", spec.parent]);
    await this.tmux.exec(["set-option", "-t", paneTarget(spec.name), "@agent_owner", this.actor]);
    if (spec.task) await this.tmux.exec(["set-option", "-t", paneTarget(spec.name), "@agent_task", spec.task]);

    // durable capture BEFORE the workload starts: pipe-pane (byte-faithful) through redaction
    await this.startCapture(spec.name);

    // The launch command's delivery is part of the spawn's answer. Until 2026-10-13 (an earlier build) the boolean
    // sendVerified() returns was dropped here — `if (spec.command) await this.sendVerified(...)` — so with every paste
    // dropped the probe read two input.verified ok:false rows, then session.spawned, created:true, and the CLI printed
    // `spawned <name>` with exit 0: a supervisor read "spawned" and moved on while the shell sat at its prompt. The row
    // now says commandDelivered — true, false, or null when there was no command to deliver — and a false is
    // SpawnDeliveryError once the row is filed: the session is kept, the caller decides.
    const commandDelivered = spec.command ? await this.sendVerified(spec.name, spec.command, { enter: true }) : null;

    // Redacted like every other text the ledger keeps: a launch command carries the credentials the agent
    // starts with, a task is operator prose — both were stored verbatim and re-served by LedgerIndex.events() and the
    // dashboard's history/timeline until 2026-10-13 (an earlier build). Whole strings, not previews: no cut applies here.
    this.ledger.emit({
      type: "session.spawned",
      session: spec.name,
      parent: spec.parent,
      actor: this.actor,
      data: { cwd, command: spec.command === undefined ? null : redact(spec.command), task: spec.task === undefined ? null : redact(spec.task), commandDelivered },
    });
    if (commandDelivered === false) throw new SpawnDeliveryError(spec.name);
    return true;
  }

  /**
   * Durable log via pipe-pane. `cat >> file` keeps it dependency-free; redaction runs at
   * read/analysis time too, but we pre-filter obvious secrets with sed-free stream (cat only —
   * heavier redaction happens in the analyzer; pane logs stay chmod 600).
   * NOTE (verified): a repeat pipe-pane REPLACES the pipe, and `-o` TOGGLES it off — so
   * re-arm must be stop (bare pipe-pane) then start.
   */
  async startCapture(name: string): Promise<string> {
    const file = join(this.home, "logs", `${name}.log`);
    // size-cap before (re)arming so a long-lived lane can't fill the disk
    if (rotateIfNeeded(file, { maxBytes: Number(process.env.TMUX_AGENT_LOG_MAX_BYTES ?? 64 * 1024 * 1024) })) {
      this.ledger.emit({ type: "capture.rotated", session: name, actor: this.actor, data: { file } });
    }
    writeFileSync(file, "", { flag: "a", mode: 0o600 });
    // mode in writeFileSync only applies on CREATE — an existing 0644 log (older run,
    // different umask, or created by the `cat >>` in pipe-pane) would stay world-readable.
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
    await this.tmux.exec(["pipe-pane", "-t", paneTarget(name)]).catch(() => {}); // stop any existing
    await this.tmux.exec(["pipe-pane", "-t", paneTarget(name), `cat >> '${file.replace(/'/g, "'\\''")}'`]);
    return file;
  }

  /**
   * Verified two-step send — the Enter race, solved:
   *   capture-pane (the pane BEFORE the paste) → load-buffer(stdin) → paste-buffer (immune to send-keys arg
   *   mangling on parens/quotes) → capture-pane again → VERIFY the text is in the lines the paste ADDED → THEN
   *   send Enter.
   * The verification is of THIS paste: the needle — the first 40 whitespace-collapsed characters of the
   * text — must appear in the multiset difference of the pane's non-empty normalized lines, after minus before
   * (linesAdded). A prompt a line editor redraws in place with the text counts as new; a line that was already on
   * screen does not, even when it is the same command sent earlier, and an identical second copy counts once.
   * Until 2026-10-13 (an earlier build) one capture AFTER the paste was searched whole for the needle — `landed =
   * needle.length === 0 || flat.includes(needle)` over the last 30 lines — so a re-send whose first 40 characters
   * were still in scrollback, or a text sharing them with an earlier command, read as landed with the paste dropped
   * and Enter went in (the input.sent row said attempt:0); an empty text landed by definition. On a failed
   * verification nothing is typed: no Enter, and no C-u — until then the retry path wiped whatever the RECIPIENT had
   * on its input line (an agent's half-typed reply, a shell's pending command) before pasting again. The pane is
   * looked at twice, 400 ms apart, before a paste is called dropped (a shell's echo lags on a loaded host), and one
   * more paste is attempted only when the pane shows no trace of the text at all, so nothing that did land can be
   * doubled; otherwise the send returns false and the caller decides. An empty or whitespace-only text is EmptyTextError
   * before the policy gate and before any tmux call: nothing pasted, submitted or ledgered
   * (test/verified-delivery.test.js). Every send is an audit event, and its input.sent row says whether the pane
   * was cleared first (a shell) or left uninterrupted (a program). The row's preview is redact()ed
   * BEFORE the 120-char cut (the order monitor.ts learned for lastLine): until 2026-10-13
   * (an earlier build) it was `redact(text.slice(0, 120))`, and a key whose tail straddled the cut was sliced below its
   * pattern and survived in the row as a partial — `AKIAFAKEFAKEFAKEFAK`, AKIA + 15 of the 16 the AWS shape needs.
   * The exec.done / exec.timeout `command` (200 chars) had the same order.
   */
  async sendVerified(
    name: string,
    text: string,
    opts: { enter?: boolean; retries?: number; verify?: boolean } = {},
  ): Promise<boolean> {
    // a text with nothing in it is a usage error, refused before policy is consulted — there is nothing to audit
    assertText(text);
    this.gate("send", name);
    const enter = opts.enter ?? true;
    const retries = opts.retries ?? 1;
    // execSync proves completion via its rc file, so it does not need pane verification —
    // and must not fail on a redraw-mangled echo of a long generated wrapper.
    if (opts.verify === false) {
      const { cleared } = await this.pasteText(name, text);
      await sleep(150);
      if (enter) await this.submitLine(name);
      this.ledger.emit({
        type: "input.sent",
        session: name,
        actor: this.actor,
        data: { chars: text.length, enter, verified: false, cleared, preview: redact(text).slice(0, 120) },
      });
      return true;
    }

    // Normalize both sides: tmux joins wrapped lines (-J) but shells with line-editors (ble.sh, zsh-autosuggest)
    // redraw the prompt and re-space, so a raw compare gives false negatives. Collapse whitespace and match a short
    // distinctive slice — in what the paste ADDED, never anywhere on the screen.
    const compact = normLine(text);
    const needle = compact.slice(0, 40);
    // the text's opening: a pane that shows this much of it took SOMETHING, and a second paste could double it
    const trace = compact.slice(0, 8);
    for (let attempt = 0; attempt <= retries; attempt++) {
      const before = await this.tmux.capturePane(name, 30);
      const { cleared } = await this.pasteText(name, text);
      // The echo of a paste can lag on a loaded host (the smoke's concurrent-send step at load 87 on 2026-10-13):
      // look twice, 400 ms apart, before calling the paste dropped — a second paste over a late first one would
      // double the text, and there is no C-u to undo it any more.
      let added = "";
      for (let look = 0; look < 2 && !added.includes(needle); look++) {
        await sleep(400);
        added = linesAdded(before, await this.tmux.capturePane(name, 30)).join(" ");
      }
      if (added.includes(needle)) {
        if (enter) await this.submitLine(name);
        this.ledger.emit({
          type: "input.sent",
          session: name,
          actor: this.actor,
          data: { chars: text.length, enter, attempt, cleared, preview: redact(text).slice(0, 120) },
        });
        return true;
      }
      this.ledger.emit({ type: "input.verified", session: name, actor: this.actor, data: { attempt, ok: false } });
      // Nothing is typed into a pane whose paste did not verify — no Enter, no C-u: the recipient's input line is
      // theirs. A paste that left a trace is not retried either (it would double what landed); only a pane that
      // shows none of the text gets the next attempt.
      if (added.includes(trace)) return false;
    }
    return false;
  }

  /**
   * Submit the current input line. C-j is an explicit "accept-line" in ble.sh (whose own
   * hint reads "C-j: run") and is byte-identical to a newline for plain readline shells and
   * TUIs, so it is the safest universal submit.
   */
  private async submitLine(name: string): Promise<void> {
    await this.tmux.exec(["send-keys", "-t", paneTarget(name), "C-j"]);
  }

  /**
   * PROVEN RACE (2026-08-25): a fixed buffer name + fixed temp file meant two concurrent
   * sends clobbered each other — session B's text was pasted into session A's pane while B
   * received nothing. For an orchestrator that types into terminals this is the worst class
   * of bug (a command lands in the wrong place). Every paste now gets a unique buffer name
   * and a unique temp file, and both are deleted after use.
   *
   * Returns whether the pre-paste C-c was sent — `cleared` on the caller's input.sent row.
   */
  private async pasteText(name: string, text: string): Promise<{ cleared: boolean }> {
    /**
     * A pane with NO output yet is a shell still sourcing its init files, and SIGINT there
     * lands before bash installs its interrupt handler — it kills the shell, and tmux
     * destroys the session with it (verified 2026-08-26 via tmux -vv server log: spawn→send
     * back-to-back, `window_lost_pane` 90ms after new-session; smoke step 11 died this way).
     * First output — the prompt — means init is done and the C-c below is safe. Cap the
     * wait so a shell with an empty PS1 degrades to the old behavior instead of hanging.
     */
    for (let i = 0; i < 30; i++) {
      const seen = await this.tmux.capturePane(name, 5).catch(() => "");
      if (seen.trim().length > 0) break;
      await sleep(100);
    }
    /**
     * Clear stale line-editor state BEFORE pasting — when the pane is at a SHELL. A pane can be
     * left in an unterminated or continuation state by whatever ran before us (verified: rapid
     * prior send-keys left ble.sh in "-- MULTILINE --", where Enter inserts a newline instead of
     * executing, so every later injection silently never ran). C-c aborts the current line in
     * bash/zsh/ble.sh/fish alike and is a no-op on an already-empty prompt.
     *
     * But C-c is a SIGINT to whatever owns the pane's tty, and until this check it went before EVERY
     * paste: into an agent TUI (Claude Code, Codex) it interrupts the running turn — found
     * 2026-09-27 while supervising a fleet of agents, where the supervisor had to build its own no-interrupt paste
     * to direct the fleet safely, while every caller of sendVerified (CLI send, MCP send-input,
     * /api/send, spawn's launch command) inherited the interrupt. So the clear asks exec's own
     * guard, foregroundProgram(): the deepest foreground process under the pane. A shell → C-c as
     * before; any other program → no signal, the text lands as that program's input; a pane that
     * cannot be read is not one we interrupt. Which path was taken is `cleared` on the input.sent
     * row, so an operator can see whether a pane was treated as a shell or as an agent
     * (test/send-no-interrupt.test.js).
     */
    const cleared = await this.paneAtShell(name);
    if (cleared) {
      await this.tmux.exec(["send-keys", "-t", paneTarget(name), "C-c"]).catch(() => {});
      await sleep(80);
    }
    const uniq = `ta-${process.pid.toString(36)}-${(this.pasteSeq++).toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
    let tmp: string | null = null;
    /**
     * The buffer is ours to delete only while it can still be in the server: set or loaded, and not yet deleted by the
     * paste's own -d. Until 2026-10-13 (an earlier build) a belt-and-braces `delete-buffer -b <uniq>` ran in `finally` after EVERY
     * paste, naming a buffer -d had already deleted — and tmux through 3.3a answers an unknown -b name on delete-buffer by
     * deleting the NEWEST buffer instead (cmd-set-buffer.c: `if (pb == NULL) pb = paste_get_top(&bufname)`; 3.4 refuses it,
     * "unknown buffer: <name>"). Under two concurrent sends on 3.2a that delete landed between the other send's set-buffer
     * and its paste-buffer and took its buffer, and that send failed `paste-buffer … no buffer <name>` with nothing pasted:
     * CI's tmux-versions (3.2a) job lost test/smoke.sh step 11 twice on 2026-10-13, the replay lost 13 of 160 panes under a
     * built 3.2a and 0 of 160 under 3.4 (test/paste-buffer-cleanup.test.js). A paste that fails because the
     * buffer is already gone leaves nothing of ours to delete either; a paste that fails for another reason (the pane is
     * gone) leaves the buffer in the server, and that one is still removed.
     */
    let inServer = false;
    try {
      if (text.length < 512 && !text.includes("\n")) {
        await this.tmux.exec(["set-buffer", "-b", uniq, text]);
      } else {
        tmp = join(this.home, `.paste-${uniq}`);
        writeFileSync(tmp, text, { mode: 0o600 });
        await this.tmux.exec(["load-buffer", "-b", uniq, tmp]);
      }
      inServer = true;
      // -d deletes the buffer once it is written to the pane
      await this.tmux.exec(["paste-buffer", "-d", "-b", uniq, "-t", paneTarget(name)]);
      inServer = false;
    } catch (e) {
      if (/no buffer/i.test(e instanceof Error ? e.message : String(e))) inServer = false;
      throw e;
    } finally {
      if (tmp) try { unlinkSync(tmp); } catch { /* already gone */ }
      if (inServer) await this.tmux.exec(["delete-buffer", "-b", uniq]).catch(() => {});
    }
    return { cleared };
  }

  /**
   * send's clear gate: true when the pane's deepest foreground process is a shell — the
   * reading exec's guard makes before it injects, so the two surfaces cannot disagree about what a
   * pane is. A dead pane, or one that cannot be read, is false: the paste that follows reports its
   * own failure, and nothing was signalled on the way.
   */
  private async paneAtShell(name: string): Promise<boolean> {
    try {
      const info = await this.tmux.paneInfo(name);
      if (info.dead) return false;
      return (await foregroundProgram(info.currentCmd, info.pid)) === null;
    } catch {
      return false;
    }
  }

  /**
   * Synchronous exec in a session's pane: unique per-command marker (fixes the fixed-marker
   * collision class) + `tmux wait-for` so the CALLER blocks, no client polling. `timeoutMs` is the
   * wall-clock bound on the whole call; on expiry it rejects, ledgers `exec.timeout`, and leaves
   * nothing in the home even though the pane goes on running the command.
   */
  async execSync(name: string, command: string, timeoutMs = 120_000): Promise<{ exitCode: number; output: string }> {
    this.gate("exec", name);
    // The bound starts HERE — guard, injection and the wait all count — not when the driver
    // happens to hand `wait-for` back.
    const started = Date.now();
    const deadline = started + timeoutMs;

    /**
     * Fail FAST when the pane is not at a shell prompt. exec injects a command line; if the
     * pane is running a TUI (vim, less, a REPL) the text is swallowed as application input
     * and we would block to the full timeout with no diagnostic. An agent calling this over
     * MCP cannot inspect the pane itself, so the guard has to live here.
     * The generated script is `sh`-only (POSIX), so a non-POSIX interactive shell (fish,
     * csh) is fine — we exec `sh <file>`, we do not rely on the pane shell's syntax.
     */
    try {
      const info = await this.tmux.paneInfo(name);
      if (info.dead) throw this.refused("exec", name, "dead pane", new Error(`pane for ${name} is dead`));
      const fg = await foregroundProgram(info.currentCmd, info.pid);
      if (fg) {
        /**
         * One read cannot tell a TUI from a utility that will be gone before the typed line could reach
         * it. A login shell runs its rc files' helpers in its own foreground group — measured
         * 2026-10-13 at host load 25–29 on a pane spawned the way the suite spawns one: `brew shellenv`'s
         * `ps -p $$ -c -o comm=` for 121–124 ms, a terminal-integration CLI's `init bash` hook for 18–680 ms, `dirname`/`awk`/
         * `sed`/`uname` for 3–8 ms each, in the first 0.06–1.95 s after spawn, while the pane already
         * showed stable text — and the 2026-10-02 gates read `ps` and then that CLI's hook there and refused
         * an exec the pane would have answered. A pager,
         * editor or agent TUI is still there on a second look; a helper is not. So a non-shell on the first
         * read is confirmed by one more read after GUARD_REREAD_MS, and the refusal names what the
         * SECOND read saw — a TUI costs one extra read before its refusal, nothing else changes.
         */
        await sleep(GUARD_REREAD_MS);
        const again = await this.tmux.paneInfo(name);
        if (again.dead) throw this.refused("exec", name, "dead pane", new Error(`pane for ${name} is dead`));
        const still = await foregroundProgram(again.currentCmd, again.pid);
        if (still) {
          throw this.refused("exec", name, "foreground program", new Error(
            `refusing exec in ${name}: foreground process is "${still}", not a shell — ` +
              `input would be consumed by that program. Use send-input if that is intended.`,
          ), { program: still, ...(still !== fg ? { first: fg } : {}) });
        }
      }
    } catch (e) {
      if (e instanceof Error && /refusing exec|is dead/.test(e.message)) throw e;
      // paneInfo failed for another reason (session vanished) — let the normal path report it
    }
    const id = `ta${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
    const outFile = join(this.home, `.exec-${id}.out`);
    const rcFile = join(this.home, `.exec-${id}.rc`);

    /**
     * Output comes from a FILE, never from the pane.
     *
     * Parsing pane text for command output cannot be made reliable: scrollback interleaves
     * unrelated lines, `capture-pane -J` rejoins wrapped lines, and line-editors like ble.sh
     * redraw the prompt so the same text appears repeatedly. An earlier byte-offset version
     * returned 55 lines of unrelated scrollback as "the output"; a marker-slicing version
     * still tripped over the redraw. Redirecting to a temp file makes the result exact and
     * independent of anything the terminal does to the display.
     */
    /**
     * The command goes into a SCRIPT FILE and we send one short line that runs it.
     *
     * Why: a long inline wrapper exceeds the pane width, and interactive line editors
     * (ble.sh, zsh) then see a truncated/unterminated quote and drop into multiline
     * continuation — Enter inserts a newline and the command NEVER RUNS (verified: pane
     * showed "-- MULTILINE --", no rc file, exec hung to timeout). Keeping the injected
     * line short and quote-free sidesteps every line-editor quirk, and the script file
     * also means `command` is never re-parsed by our own quoting.
     */
    const scriptFile = join(this.home, `.exec-${id}.sh`);
    const socketArgs = this.tmux.socketArgs().join(" ");
    writeFileSync(
      scriptFile,
      [
        "#!/bin/sh",
        // 0600 for everything the pane side writes into the home: the redirect below used to take
        // the pane shell's umask (664 on the dev host) inside our 0700 home
        "umask 077",
        `( ${command} ) > ${shq(outFile)} 2>&1`,
        `printf '%s' $? > ${shq(rcFile)}`,
        // Signal only while the tool is still waiting. On a timeout the tool unlinks this script
        // FIRST, so a command that outlives its bound finds it gone, removes what it just wrote
        // instead of leaving an rc file in a cleaned home, and wakes no abandoned channel. Write-
        // then-check here plus script-before-rc unlinking there leaves no interleaving in which
        // the rc file survives: the script skips its rm only if the script still existed, i.e.
        // before the tool's sweep began — and that sweep removes the rc file after the script.
        `if [ -e ${shq(scriptFile)} ]; then tmux ${socketArgs} wait-for -S ${id}; else rm -f ${shq(rcFile)} ${shq(outFile)}; fi`,
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    const wrapped = ` sh ${shq(scriptFile)}`; // leading space keeps it out of shell history

    const sent = await this.sendVerified(name, wrapped, { enter: true, verify: false });
    if (!sent) {
      try { unlinkSync(scriptFile); } catch { /* ignore */ }
      throw new Error(`could not inject command into ${name}`);
    }

    // wait-for blocks until the pane signals — the one tmux verb that outlives the driver's
    // per-call timeout by design, so it runs under what is LEFT of the caller's bound. Before
    // this fix it ran under the fixed 5 s default, the kill was swallowed here, and the poll below
    // then started its own full timeoutMs: every bound was 5 s longer than asked (measured: 2 s
    // threw at 7.4 s, 10 s at 15.7 s), and a command that finished inside that hidden window was
    // reported a success.
    await this.tmux.exec(["wait-for", id], { timeoutMs: Math.max(1, deadline - Date.now()) }).catch(() => {});
    // the rc file is the completion proof; one read past the deadline catches a command that
    // finished in the last tick
    let rc: string | null = null;
    for (;;) {
      try {
        rc = readFileSync(rcFile, "utf8").trim();
        if (rc.length) break;
      } catch {
        /* not written yet */
      }
      const left = deadline - Date.now();
      if (left <= 0) break;
      await sleep(Math.min(300, left));
    }
    let output = "";
    try {
      output = redact(readFileSync(outFile, "utf8"));
    } catch {
      /* command produced no output */
    }
    // script FIRST — the generated script checks for it before it signals or cleans up after itself
    try { unlinkSync(scriptFile); } catch { /* ignore */ }
    try { unlinkSync(rcFile); } catch { /* ignore */ }
    try { unlinkSync(outFile); } catch { /* ignore */ }

    if (rc === null || !rc.length) {
      // elapsedMs is the exec's own elapsed at the bound — measured BEFORE the holder read below, so
      // it stays the number the bound promised and the read's cost is visible as the difference.
      const elapsedMs = Date.now() - started;
      // What held the pane. Until this line a timed-out exec said only its bound, and a
      // slow command, a wedged pane and a shell whose keys never arrived read identically: the
      // 2026-09-27 14:23Z in-suite failure on a clean tree was the third — the guard saw a shell at its
      // drawn prompt, the pane took the line, and the pty wrapper above the shell forwarded nothing
      // for 18 s — and only the test helper could say so. The read is bounded (HOLDER_READ_MS) and
      // runs after the deadline, so the call returns inside timeoutMs + that bound.
      const holder = await describePaneHolder(this.tmux, name);
      // the terminal event of a timed-out exec — without it the ledger ended at input.sent and
      // the timeline could not tell a timed-out exec from one still running
      this.ledger.emit({
        type: "exec.timeout",
        session: name,
        actor: this.actor,
        data: { id, timeoutMs, elapsedMs, command: redact(command).slice(0, 200), holder },
      });
      throw new Error(`execSync timeout in ${name} after ${timeoutMs}ms — the pane took the line and nothing completed it: ${holder}`);
    }
    const exitCode = Number(rc);
    this.ledger.emit({
      type: "exec.done",
      session: name,
      actor: this.actor,
      data: { exitCode, id, command: redact(command).slice(0, 200) },
    });
    return { exitCode, output };
  }

  /** Kill with ownership check: we only kill what we (or our children) own, unless policy overrides. */
  async kill(name: string, force = false): Promise<void> {
    this.gate("kill", name);
    if (!force) {
      const owner = await this.getOption(name, "@agent_owner");
      if (owner && owner !== this.actor) {
        // the one refusal that always ledgered; its {action, owner} keys are kept for existing readers
        throw this.refused("kill", name, "owned by another actor",
          new Error(`refusing to kill ${name}: owned by ${owner} (use force+policy to override)`), { owner });
      }
    }
    await this.tmux.exec(["kill-session", "-t", sessionTarget(name)]);
    this.ledger.emit({ type: "session.killed", session: name, actor: this.actor, data: { force } });
  }

  async getOption(name: string, key: string): Promise<string | null> {
    try {
      const { stdout } = await this.tmux.exec(["show-options", "-t", paneTarget(name), "-v", key]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async lineage(): Promise<Array<{ name: string; parent: string | null; task: string | null; owner: string | null }>> {
    return (await this.lineageReport()).rows;
  }

  /**
   * The lineage tree WITH the server's own verdict beside it. `rows` is exactly what `lineage()` has
   * always returned — the CLI prints the same lines and MCP `list-lineage` the same array — and `tmux` is why an
   * empty tree is empty: a dead or absent server, or a fleet that genuinely has no sessions. Without it both
   * surfaces answered "no lineage" to either state, which is what the other seven pull surfaces stopped doing in
   * earlier changes; the swallow in `listSessions()` stays for every other caller.
   */
  async lineageReport(): Promise<{
    tmux: { reachable: boolean; error: string | null };
    rows: Array<{ name: string; parent: string | null; task: string | null; owner: string | null }>;
  }> {
    const { reachable, error, sessions } = await this.tmux.listSessionsReachable();
    const rows = await Promise.all(
      sessions.map(async (s) => ({
        name: s.name,
        parent: await this.getOption(s.name, "@agent_parent"),
        // the option is read back as set and redacted here — `lineage`, MCP list-lineage and status.json's task
        // all come through this row; the tmux option itself is the operator's and is never rewritten
        task: redactOption(await this.getOption(s.name, "@agent_task")),
        owner: await this.getOption(s.name, "@agent_owner"),
      })),
    );
    return { tmux: { reachable, error }, rows };
  }
}

/** A tmux user option's value through redact(), null kept null — the read boundary for @agent_task. */
const redactOption = (v: string | null): string | null => (v === null ? null : redact(v));

const SHELL_CMDS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "ash", "busybox", "login"]);

/**
 * Program name as the shell-or-not check wants it, from whatever `ps -o comm=` printed: Linux gives
 * the executable's name (`bash`); macOS/BSD give what the process was invoked as — a full path
 * (`/usr/bin/less`) or, for a login shell, argv0 with its leading dash (`-bash`, `-zsh`). The dash
 * cost the first push of the descendant walk all three macOS CI legs: the pane's own shell at its prompt was the
 * deepest foreground row, read as "-bash", and every exec was refused.
 */
export function commName(raw: string): string {
  return (raw.trim().split("/").pop() ?? "").replace(/^-/, "");
}

/**
 * One process-table row as `ps -eo pid=,ppid=,pgid=,tpgid=,stat=,comm=` reports it; `comm` via commName().
 * `stat` is ps's state column as printed (`Ss+`, `T`, `R<`); describePaneHolder() quotes its first letter so a
 * STOPPED shell or wrapper is named as stopped. The guard itself does not read it.
 */
interface ProcRow {
  pid: number;
  ppid: number;
  pgid: number;
  tpgid: number;
  stat: string;
  comm: string;
}

/**
 * Name of the non-shell program occupying the pane, or null if it is at a shell prompt.
 *
 * Three readings, most authoritative first:
 *
 *  1. One `ps` pass over the process table, walked from the pane pid through EVERY descendant.
 *     The program the user's keystrokes would reach is the deepest descendant that is the
 *     foreground process group of its own controlling tty (pgid == tpgid). Depth is the point:
 *     a pty wrapper between the pane and the shell — a terminal-integration CLI's wrapper, `script`,
 *     `asciinema rec`, `expect`, a shell-named launcher — puts the real shell on a NESTED pty,
 *     so a pager started there is a grandchild on a different tty. `pane_current_command` reads
 *     the wrapper (whose argv0 says `bash`), the direct children are one more shell, and the
 *     one-level guard passed while exec typed its script line into `less` and blocked to the
 *     full timeout (measured 2026-09-13: 15.7 s at timeoutMs=10000, not back in 120 s
 *     at the default). The same rule keeps a wrapper→shell chain sitting at its prompt out of
 *     the refusal: the deepest foreground process is that shell, so the answer is null.
 *     The walk decides whenever the table contains the pane pid — whatever tmux reports.
 *     tmux's name is argv0 of the process group owning the pane's OWN tty, so a
 *     wrapper that does not spoof it (`script`, `expect`, `asciinema rec` → `python3`, a nested
 *     `screen`) is named while the shell the keystrokes reach sits at its prompt one pty down:
 *     measured 2026-09-13 on an earlier build, with that name read first, `script -q /dev/null` as the
 *     pane command was refused as "script" in 75 ms (a human's line into the pane answered),
 *     `asciinema rec` as "python3", and a pager under that shell as the WRAPPER's name. A pane
 *     whose own process is the TUI (`tmux new-session … 'less f'`) is its own deepest
 *     foreground row and is still refused by name.
 *  2. tmux's `pane_current_command`, when it names a non-shell — the answer only when the table
 *     cannot see the pane (`ps` missing or unusable, pid unknown or absent, no foreground row
 *     under it). Authoritative on Linux for the process that owns the pane's OWN tty — but NOT
 *     portable: on macOS it reports the shell even while a child program owns the terminal (CI
 *     caught this — the TUI guard passed on ubuntu and failed on all three macOS legs), and on
 *     Linux it is the wrapper's name in the case above.
 *  3. Otherwise the original one-level reading: the pane process's direct children via `pgrep -P`,
 *     first non-shell name wins. Never throws — a guard that fails for its own reasons must let
 *     exec proceed as before, not block it.
 */
export async function foregroundProgram(currentCmd: string, panePid: number): Promise<string | null> {
  if (panePid > 0) {
    const table = await processTable();
    const root = table.get(panePid);
    if (root) {
      const fg = deepestForeground(table, root);
      if (fg) return SHELL_CMDS.has(fg.comm) ? null : fg.comm;
    }
  }
  if (currentCmd && !SHELL_CMDS.has(currentCmd)) return currentCmd;
  if (!panePid || panePid <= 0) return null;
  return firstNonShellChild(panePid);
}

/**
 * How long execSync's TUI guard waits before its confirming read when the first read names a non-shell
 * — longer than the rc-time helpers measured on a development host (3–124 ms, see execSync), short
 * enough that a real TUI's refusal is still prompt.
 */
export const GUARD_REREAD_MS = 100;
/** Bound on the WHOLE of describePaneHolder()'s read: a diagnostic must never hold the wait it serves. */
export const HOLDER_READ_MS = 750;
/** The pane's last drawn line is quoted at most this long, after redaction. */
const HOLDER_LINE_CUT = 120;

/**
 * One line naming what holds a pane RIGHT NOW — for execSync's timeout and for the suite's
 * wait-shell give-up (test/helpers/pane-holder.js), which imports this so the helper's die and
 * the product's error cannot drift. Three facts, each read the way the product reads it:
 *
 *  1. what exec's guard sees — foregroundProgram(), the same call execSync makes before it injects:
 *     `the guard saw a shell` or `the guard saw "less"`;
 *  2. every process under the pane by comm with its ps STAT letter, in tree order — `wrapper(S) >
 *     bash(T)`. The letter is what the 2026-09-27 14:23Z in-suite red could not give: the guard had
 *     seen a shell at its drawn prompt, the pane took the injected line and for 18 s nothing completed
 *     it — a shell, or the pty wrapper above
 *     it, that has stopped reading looks exactly like one that is about to, until its state is read;
 *  3. the pane's last non-empty drawn line, redacted at this read boundary (THREAT-MODEL's rule applies
 *     to a diagnostic as it does to a dashboard cell) and cut to HOLDER_LINE_CUT chars.
 *
 * Never throws; a failed read is worded as such in place of the fact it could not read. The whole read
 * races `boundMs` — execSync calls it after its own deadline has passed, so every millisecond here is
 * an overrun of the bound the caller asked for (the bound is honest; this keeps it so).
 */
export async function describePaneHolder(tmux: Tmux, name: string, boundMs = HOLDER_READ_MS): Promise<string> {
  const firstLine = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
  const read = (async () => {
    let info: { pid: number; currentCmd: string };
    try {
      info = await tmux.paneInfo(name);
    } catch (e) {
      return `the pane could not be read: ${firstLine(e)}`;
    }
    let guard: string;
    try {
      const fg = await foregroundProgram(info.currentCmd, info.pid);
      guard = fg === null ? "the guard saw a shell" : `the guard saw "${fg}"`;
    } catch (e) {
      guard = `the guard could not read the pane: ${firstLine(e)}`;
    }
    const [tree, last] = await Promise.all([
      processTable().then((table) => processChain(table, info.pid)),
      tmux.capturePane(name).then(
        (text) => {
          const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
          if (lines.length === 0) return "(the pane is blank)";
          return JSON.stringify(redact(lines[lines.length - 1]).slice(0, HOLDER_LINE_CUT));
        },
        (e) => `(pane unreadable: ${firstLine(e)})`,
      ),
    ]);
    return `${guard}; the pane ran ${tree}; its last line read ${last}`;
  })();
  let timer: NodeJS.Timeout | undefined;
  const cut = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`the pane could not be read inside ${boundMs} ms`), boundMs);
  });
  try {
    return await Promise.race([read, cut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Every descendant of `pid` (pid included) as `comm(S)` — comm by commName(), S the first letter of ps's
 * STAT — joined " > " down a chain and ", " across siblings: `wrapper(S) > script(T) > bash(S)`.
 * An empty table (ps missing) or a pid past the table says so in its place.
 */
function processChain(table: Map<number, ProcRow>, pid: number): string {
  if (table.size === 0) return "(ps unreadable)";
  if (!table.has(pid)) return `(pane pid ${pid} is not in the process table)`;
  const kids = new Map<number, ProcRow[]>();
  for (const row of table.values()) {
    const list = kids.get(row.ppid);
    if (list) list.push(row);
    else kids.set(row.ppid, [row]);
  }
  const seen = new Set<number>();
  const render = (row: ProcRow): string => {
    const name = `${row.comm}(${row.stat.charAt(0) || "?"})`;
    if (seen.has(row.pid)) return name; // pid reuse inside one snapshot cannot loop us
    seen.add(row.pid);
    const below = (kids.get(row.pid) ?? []).map(render);
    if (below.length === 0) return name;
    if (below.length === 1) return `${name} > ${below[0]}`;
    return `${name} > (${below.join(", ")})`;
  };
  return render(table.get(pid) as ProcRow);
}

/** The whole process table in one `ps` pass, keyed by pid; empty when ps is missing or unusable. */
function processTable(): Promise<Map<number, ProcRow>> {
  return new Promise((resolve) => {
    const rows = new Map<number, ProcRow>();
    try {
      execFile(
        "ps",
        ["-eo", "pid=,ppid=,pgid=,tpgid=,stat=,comm="],
        { timeout: 3000, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) return resolve(rows);
          for (const line of stdout.split("\n")) {
            // tpgid is -1 (Linux) or 0 (BSD) for a process with no controlling tty; stat never holds a
            // space; comm may hold spaces ("tmux: server") and is a full path on macOS.
            const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
            if (!m) continue;
            const pid = Number(m[1]);
            rows.set(pid, { pid, ppid: Number(m[2]), pgid: Number(m[3]), tpgid: Number(m[4]), stat: m[5], comm: commName(m[6]) });
          }
          resolve(rows);
        },
      );
    } catch {
      resolve(rows);
    }
  });
}

/**
 * Deepest descendant of `root` (root included) that is the foreground process group of its own
 * controlling tty — the process whose input the next keystroke would be. Ties at one depth go to
 * the process-group leader (a pipeline is named by its head), else the row seen first.
 */
function deepestForeground(table: Map<number, ProcRow>, root: ProcRow): ProcRow | null {
  const kids = new Map<number, ProcRow[]>();
  for (const row of table.values()) {
    const list = kids.get(row.ppid);
    if (list) list.push(row);
    else kids.set(row.ppid, [row]);
  }
  let best: ProcRow | null = null;
  let bestDepth = -1;
  const seen = new Set<number>();
  const queue: Array<[ProcRow, number]> = [[root, 0]];
  while (queue.length) {
    const [row, depth] = queue.shift() as [ProcRow, number];
    if (seen.has(row.pid)) continue; // pid reuse inside one snapshot cannot loop us
    seen.add(row.pid);
    if (row.tpgid > 0 && row.tpgid === row.pgid) {
      const leaderBeatsNonLeader = best !== null && row.pid === row.pgid && best.pid !== best.pgid;
      if (depth > bestDepth || (depth === bestDepth && leaderBeatsNonLeader)) {
        best = row;
        bestDepth = depth;
      }
    }
    for (const kid of kids.get(row.pid) ?? []) queue.push([kid, depth + 1]);
  }
  return best;
}

/** The original one-level reading: first non-shell among the pane process's DIRECT children. */
async function firstNonShellChild(panePid: number): Promise<string | null> {
  const kids = await new Promise<string[]>((resolve) => {
    try {
      execFile("pgrep", ["-P", String(panePid)], { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(stdout.trim().split(/\s+/).filter(Boolean));
      });
    } catch {
      resolve([]);
    }
  });
  for (const pid of kids) {
    const comm = await new Promise<string>((resolve) => {
      try {
        execFile("ps", ["-o", "comm=", "-p", pid], { timeout: 3000 }, (err, stdout) => resolve(err ? "" : stdout.trim()));
      } catch {
        resolve("");
      }
    });
    const base = commName(comm);
    if (base && !SHELL_CMDS.has(base)) return base;
  }
  return null;
}

/** POSIX single-quote escaping for a path embedded in a generated script. */
function shq(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
