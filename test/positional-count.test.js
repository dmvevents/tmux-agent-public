/**
 * Every verb's positional count is judged against one table before any verb runs — too few or too many
 * is refused with exit 64, the verb and the argument named in the usage header's own words (TMUX-106;
 * gates G1 no test named a verb with too few or too many positionals, G3 a phantom session, a silent
 * no-op and an unasked Enter on a CLI whose stance is "failures are loud", G6 the header and README are
 * true only when the operator types every argument).
 *
 * src/bin/tmux-agent.ts declares each verb's positionals in its header (lines 5-18). Until 2026-09-15 the
 * dispatch read them as rest[0], rest[1] with no count check. Measured 2026-09-14 20:2xZ on 34c9f04 and
 * 2026-09-15 00:2xZ on d8439ce (scratch/ga-fire-2026-09-15-00Z/mispos-probe/run1-d8439ce.log,
 * run2-d8439ce.log): `spawn --cwd /tmp` with the name forgotten printed `spawned undefined`, exit 0 — a
 * session literally named undefined, listed by status and lineage (assertName's regex coerces undefined
 * to the string, which it accepts); a bare `kill` then printed `killed undefined`, exit 0; a bare `watch`
 * blocked on it in silence (rc=124 at the bound) — on a clean fleet it reported `undefined → GONE`, exit
 * 2, the code a supervisor reads as "the session died"; `exec NAME` ran `true` and exited 0 with nothing
 * printed; `exec NAME echo A B` unquoted ran `echo` alone and dropped A B; a bare `log` printed
 * `<home>/logs/undefined.log`; `msg send a` and a bare `msg recv` died in Node's words (`The "path"
 * argument must be of type string`); `status -json FILE` wrote no file, exit 0; `send NAME "echo M"
 * -no-enter` (one dash) reported sent+verified and pressed Enter — the command ran.
 *
 * Black-box through the built CLI like test/unknown-flags.test.js: the contract is the exit code, the
 * streams and what did NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a
 * red run cannot hang the suite. The contract, each line a check that FAILS if the property is removed:
 *   (a) `spawn --cwd D` → 64 naming <name>; no session undefined on the socket; the home absent — RED
 *       on d8439ce: spawned undefined, exit 0, the home created;
 *   (b) `exec X` → 64 naming "command" — RED: exit 0, nothing printed;
 *   (c) `exec X echo A B` → 64 naming "A" as a third argument with the quoting hint; the pane untouched
 *       — RED: exit 0, empty output;
 *   (d) a bare `watch` → 64 within the bound, no GONE on stdout, no notify — RED: GONE exit 2 / rc=124;
 *   (e) a bare `kill` → 64; the control session still alive — RED: killed undefined;
 *   (f) a bare `log` → 64 — RED: undefined.log, exit 0;
 *   (g) `msg send a`, `msg send`, `msg recv` → 64 naming the missing arguments — RED: Node's words;
 *   (h) `status -json FILE` → 64 naming -json and --json; FILE absent — RED: exit 0, no file;
 *   (i) `send X "echo M" -no-enter` → 64 naming -no-enter and --no-enter; the pane never sees M — RED:
 *       Enter pressed; `send X` with no text → 64 naming "text" before the pane is touched (on d8439ce
 *       tmux refused it by accident: paste-buffer failed, exit 1); an extra positional on a verb that
 *       takes none or one (`status X extra`, `kill X other`) → 64 naming the first extra as typed;
 *   (j) the controls, green on d8439ce and on the fix alike: the quoted exec prints both words; `send
 *       … --no-enter` still types without Enter; `msg send a b subject` with no body is delivered and
 *       received; `msg` alone and a bad verb keep exit 64 with the usage line; `--version` answers first;
 *   (k) the table cannot drift from the header: each header line's arity decides how its verb is driven
 *       (bare when it needs arguments, one extra when it takes none — no real invocation ever runs) and
 *       the usage the refusal ends with must be that header line verbatim; every verb the usage line
 *       names must have a header line.
 *
 * Run: node --test test/positional-count.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { waitForShell } from "./helpers/wait-shell.js";
import { quietServer } from "./helpers/quiet-server.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const SRC = join(ROOT, "src", "bin", "tmux-agent.ts");
// The card's bound: a refusal is one process start; on d8439ce a bare `watch` sat here until timeout(1) killed it.
const BOUND_MS = 5_000;

function socket() {
  return `ta-poscount-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** Session names on the isolated socket; a socket whose server never started has none. */
function sessions(sock) {
  try {
    return execFileSync("tmux", ["-L", sock, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
function pane(sock, name) {
  return execFileSync("tmux", ["-L", sock, "capture-pane", "-p", "-t", name], { encoding: "utf8" });
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — the parent's hang. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** A refusal is exit 64, nothing on stdout, and exactly one stderr line that starts with the verb or the token as typed. */
function assertRefused(r, re, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.match(lines[0], re, `${label}: ${lines[0]}`);
  assert.doesNotMatch(lines[0], /\.js:\d+|status\.json →|"path" argument|paste-buffer/, `${label}: a stack trace, the default path or tmux's words, not a refusal: ${lines[0]}`);
}

test("a verb given too few or too many positionals is refused with exit 64 naming the argument, before anything is touched", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-poscount-"));
  const S = socket();
  let n = 0;
  const never = () => join(H, `never-${n++}`);
  try {
    // The control pane is a BARE shell: the server is started with `bash --norc --noprofile` as its
    // default-command before the CLI spawns on it, so no login profile, pty wrapper or line editor of the host's sits
    // between tmux's keystrokes and the prompt — the wedge four of twelve coverage reads hit on 2026-09-28.
    quietServer(S);
    const sp = await cli(["--socket", S, "spawn", "pc-idle", "--cwd", "/tmp", "--parent", "positional-count-test", "--task", "control"], { TMUX_AGENT_HOME: H }, 30_000);
    assert.equal(sp.code, 0, `test setup: spawn exited ${sp.code}: ${sp.stderr}`);
    // Nothing is typed until the pane presents a shell to exec's OWN guard: a fresh pane's
    // deepest foreground process is briefly the host's pty wrapper (kiro-cli-term) or a still-running
    // login rc, and exec refuses an injection there — RIGHTLY. The watch `--idle-secs` exit is not that
    // question (an idle pane can still be wrapper-held; measured on the 5f1de3e dist this file's own
    // exec control went red under load), so it stays only as the `watch <name> --idle-secs N` control
    // below; readiness is the guard's own no-op `exec … true`, and waitForShell THROWS if it never comes.
    await waitForShell(S, "pc-idle", { home: H });
    const ready = await cli(["--socket", S, "watch", "pc-idle", "--idle-secs", "3"], { TMUX_AGENT_HOME: H, TMUX_AGENT_SLACK_WEBHOOK: "" }, 30_000);
    assert.equal(ready.code, 0, `test setup: the control shell never went idle: ${ready.stderr.slice(0, 200)}`);

    // (a) the name forgotten: no session named undefined is born, the home is not created on the way
    let r = await cli(["--socket", S, "spawn", "--cwd", "/tmp"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^spawn: needs <name> — tmux-agent spawn <name> --cwd DIR \[--cmd "\.\.\."\] \[--parent WHO\] \[--task T\]$/, "spawn --cwd /tmp");
    assert.deepEqual(sessions(S), ["pc-idle"], "spawn --cwd /tmp: a session was created before the count was judged (on d8439ce one named undefined was born)");

    // (b) the command forgotten: never `true`, never success for a command nobody typed
    r = await cli(["--socket", S, "exec", "pc-idle"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^exec: needs "command" — tmux-agent exec <name> "command"$/, "exec pc-idle");

    // (c) the command unquoted: the first dropped word is named, with the quoting hint; the pane untouched
    r = await cli(["--socket", S, "exec", "pc-idle", "echo", "PC_UNQ_A", "PC_UNQ_B"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^exec: "PC_UNQ_A" is a third argument — quote the command as one string: tmux-agent exec <name> "command"$/, "exec pc-idle echo PC_UNQ_A PC_UNQ_B");
    assert.equal(pane(S, "pc-idle").includes("echo"), false, "exec unquoted: something reached the pane (on d8439ce `echo` alone ran)");

    // (d) a bare watch: refused inside the bound, no GONE, no notify — the verb a supervising script blocks on
    r = await cli(["--socket", S, "watch"], { TMUX_AGENT_HOME: never(), TMUX_AGENT_SLACK_WEBHOOK: "" });
    assertRefused(r, /^watch: needs <name> — tmux-agent watch <name> \[--idle-secs N\] \[--profile NAME\]$/, "watch (bare)");
    assert.doesNotMatch(r.stderr, /GONE|\[notify\]/, "a bare watch reported a state for the session named undefined");

    // (e) a bare kill: nothing killed
    r = await cli(["--socket", S, "kill"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^kill: needs <name> — tmux-agent kill <name> \[--force\]$/, "kill (bare)");
    assert.deepEqual(sessions(S), ["pc-idle"], "kill (bare): the control session is gone");

    // (f) a bare log: no path to undefined.log
    r = await cli(["--socket", S, "log"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^log: needs <name> — tmux-agent log <name>$/, "log (bare)");

    // (g) msg with missing fields: the missing arguments named, in the header's words, not Node's
    r = await cli(["--socket", S, "msg", "send", "pc-a"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^msg send: needs <to> <subject> — tmux-agent msg send <from> <to> <subject> \[body\.\.\.\]$/, "msg send pc-a");
    r = await cli(["--socket", S, "msg", "send"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^msg send: needs <from> <to> <subject> — tmux-agent msg send/, "msg send (bare)");
    r = await cli(["--socket", S, "msg", "recv"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^msg recv: needs <agent> — tmux-agent msg recv <agent>$/, "msg recv (bare)");

    // (h) a single-dash flag is not a positional: named as typed with the two-dash hint; no file written
    const dash = join(H, "dash.json");
    r = await cli(["--socket", S, "status", "-json", dash], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^-json: one dash is not a flag — did you mean --json\?$/, "status -json FILE");
    assert.equal(existsSync(dash), false, "status -json FILE: the file was written");

    // (i) -no-enter after the text: the one thing the operator asked it not to do does not happen
    r = await cli(["--socket", S, "send", "pc-idle", "echo PC_DASH", "-no-enter"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^-no-enter: one dash is not a flag — did you mean --no-enter\?$/, 'send pc-idle "echo PC_DASH" -no-enter');
    await new Promise((res) => setTimeout(res, 1000));
    assert.equal(pane(S, "pc-idle").includes("PC_DASH"), false, "send … -no-enter: the text reached the pane (on d8439ce Enter was pressed and the command ran)");
    // the text forgotten: refused by name before the pane is touched (on d8439ce tmux refused it by accident)
    r = await cli(["--socket", S, "send", "pc-idle"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^send: needs "text" — tmux-agent send <name> "text" \[--no-enter\]$/, "send pc-idle (no text)");
    // an extra positional on a verb that takes none, or one: the first extra as typed
    r = await cli(["--socket", S, "status", "pc-idle", "extra"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^status: "pc-idle" is an extra argument — tmux-agent status \[--json FILE\] \[--profile NAME\]$/, "status pc-idle extra");
    r = await cli(["--socket", S, "kill", "pc-idle", "other"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^kill: "other" is an extra argument — tmux-agent kill <name> \[--force\]$/, "kill pc-idle other");
    assert.deepEqual(sessions(S), ["pc-idle"], "kill pc-idle other: the session was killed before the count was judged");

    // none of the refusals touched the home
    for (let i = 0; i < n; i++) assert.equal(existsSync(join(H, `never-${i}`)), false, `refusal ${i} created the home directory before the count was judged`);

    // (j) the controls: every documented shape keeps its meaning
    r = await cli(["--socket", S, "exec", "pc-idle", "echo PC_UNQ_A PC_UNQ_B"], { TMUX_AGENT_HOME: H }, 30_000);
    assert.equal(r.code, 0, `the quoted exec (the control) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /PC_UNQ_A PC_UNQ_B/, "the quoted exec did not print both words");
    r = await cli(["--socket", S, "send", "pc-idle", "echo PC_CTRL_NOENTER", "--no-enter"], { TMUX_AGENT_HOME: H }, 30_000);
    assert.equal(r.code, 0, `send --no-enter (the control) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /sent\+verified/, "the control's send was not verified");
    assert.equal(pane(S, "pc-idle").includes("PC_CTRL_NOENTER"), true, "the control's text did not reach the pane");
    r = await cli(["--socket", S, "msg", "send", "pc-a", "pc-b", "subject-only"], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 0, `msg send a b subject (no body — [body...] is zero or more words) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    r = await cli(["--socket", S, "msg", "send", "pc-a", "pc-b", "hello", "body", "words"], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 0, `msg send a b hello body words exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    r = await cli(["--socket", S, "msg", "recv", "pc-b"], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 0, `msg recv pc-b exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    const got = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(got.map((m) => [m.subject, m.body]), [["subject-only", ""], ["hello", "body words"]], "the two messages did not round-trip as sent");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("msg alone and a bad verb keep the usage line, --version answers first, and every refusal's usage is a line of the header — the table cannot drift", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-poscount-hdr-"));
  const S = socket();
  try {
    // `msg` alone, `msg other` and a verb the CLI does not know: the usage line, exit 64, as before
    for (const args of [["msg"], ["msg", "other"], ["frobnicate"]]) {
      const r = await cli(["--socket", S, ...args], { TMUX_AGENT_HOME: H });
      assert.equal(r.code, 64, `${args.join(" ")} exited ${r.code}, want 64`);
      assert.match(r.stderr, /^usage: tmux-agent </, `${args.join(" ")}: the usage line`);
    }
    // --version answers before anything is constructed
    const neverV = join(H, "never-version");
    const v = await cli(["--version"], { TMUX_AGENT_HOME: neverV });
    assert.equal(v.code, 0, `--version exited ${v.code}: ${v.stderr}`);
    assert.match(v.stdout, /^\d+\.\d+\.\d+ \(/, "the build stamp");
    assert.equal(existsSync(neverV), false, "--version created the home");

    // (k) the header is the spec: one ` *   tmux-agent <verb> <args…> [flags]  # note` line per verb. Its
    // arity decides how each verb is driven so that no real invocation ever runs — a verb that needs
    // arguments is run bare, one that takes none is run with one extra — and the usage the refusal ends
    // with must be that header line verbatim: one source for the header and the message. Every verb
    // the usage line names must have a header line (`msg` is its two sub-verbs).
    const src = readFileSync(SRC, "utf8");
    const header = src.split("\n").filter((l) => l.startsWith(" *   tmux-agent ")).map((l) => l.slice(" *   ".length).split("  #")[0].trimEnd());
    assert.ok(header.length >= 14, `the header declares ${header.length} verbs`);
    const usageLine = src.match(/usage: tmux-agent <([^>]+)>/);
    assert.ok(usageLine, "the usage line names the verbs");
    for (const v of usageLine[1].split("|")) {
      const want = v === "msg" ? ["tmux-agent msg send ", "tmux-agent msg recv "] : [`tmux-agent ${v} `, `tmux-agent ${v}`];
      assert.ok(header.some((h) => want.some((w) => h === w.trimEnd() || h.startsWith(w))), `${v}: named by the usage line, no header line declares its positionals`);
    }
    for (const [i, line] of header.entries()) {
      const tokens = line.split(" ").slice(1); // drop "tmux-agent"
      const verbWords = tokens[0] === "msg" ? tokens.slice(0, 2) : tokens.slice(0, 1);
      const args = [];
      for (const t of tokens.slice(verbWords.length)) {
        if (!/^(<[^>]+>|"[^"]+")$/.test(t)) break;
        args.push(t);
      }
      const verb = verbWords.join(" ");
      const never = join(H, `never-hdr-${i}`);
      const probe = args.length > 0 ? verbWords : [...verbWords, "pc-extra"];
      const r = await cli(["--socket", S, ...probe], { TMUX_AGENT_HOME: never, TMUX_AGENT_SLACK_WEBHOOK: "" });
      assert.equal(r.code, 64, `${probe.join(" ")} exited ${r.code}, want 64 — the header says ${verb} takes ${args.length}, the table disagrees (stderr: ${r.stderr.slice(0, 160)})`);
      assert.equal(r.stdout, "", `${probe.join(" ")} wrote to stdout`);
      assert.equal(existsSync(never), false, `${probe.join(" ")}: the refusal created the home`);
      const usage = r.stderr.trim().split(" — ").pop();
      assert.equal(usage, line, `${verb}: the refusal's usage is not the header line — the table has drifted from src/bin/tmux-agent.ts:5-18`);
    }
    assert.deepEqual(sessions(S), [], "a refusal started a tmux server");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});
