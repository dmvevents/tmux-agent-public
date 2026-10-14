/**
 * Every `--flag` in argv is judged against the declared sets before any verb runs — an undeclared
 * name, or a declared value flag with no value, is refused with exit 64 (TMUX-105; gates G1 no test
 * named an undeclared flag, G3 four silent failure shapes on a CLI whose stance is "failures are
 * loud", G6 the usage header and README are true only for a correctly spelled flag).
 *
 * src/bin/tmux-agent.ts declares VALUE_FLAGS and BOOL_FLAGS. Until 2026-09-14 positionals() treated
 * any `--x` in neither set as a flag that takes a value and skipped the argument after it, and
 * flag()/has() read argv by exact name — so a mistyped flag was never refused: the verb ran with the
 * flag's default and the next argument was swallowed. Measured 2026-09-14 16:3xZ on 19f8663 and
 * 18:3xZ on ed161e6 (scratch/ga-fire-2026-09-14-18Z/unknownflag-probe/run1-ed161e6.log):
 * `status --jsn FILE` exited 0, wrote no file and published to the default path; `spawn … --prent P
 * --tsk T` spawned with parent=cli and no task; `watch … --idle-sec 2` swallowed the 2 and was still
 * blocking, silent, when the 8 s bound killed it; `send … "echo M" --no-entr` reported sent+verified
 * and pressed Enter — the command ran; `send --no-entr X "text"` swallowed the session name and
 * refused the text as an invalid session name, the typo unnamed; `--lexicon` (VERSIONING.md item 1)
 * and `--out` (README.md:154) were in neither set and parsed only through that branch.
 *
 * Black-box through the built CLI like test/numeric-flags.test.js: the contract is the exit code,
 * the streams and what did NOT happen. Every run is bounded by its own execFile timeout so a red run
 * cannot hang the suite. The contract, each line a check that FAILS if the property is removed:
 *   (a) `status --jsn FILE` → 64, one stderr line naming --jsn as typed and --json as the nearest
 *       declared name, FILE absent, nothing on stdout — RED on ed161e6: exit 0, the default path;
 *   (b) `spawn X --cwd D --prent P` → 64 and no session X on the socket afterwards — RED: spawned;
 *   (c) `send X "echo M" --no-entr` → 64 and the pane never sees M — RED: Enter pressed, M echoed;
 *   (d) `watch X --idle-sec 2` → 64 within the bound — RED: killed at the bound;
 *   (e) `send --no-entr X "text"` → 64 naming --no-entr, not the text as a session name — RED;
 *   (f) a typo with no declared name near it is still refused, named as typed, with no guess;
 *   (g) a declared value flag as the last argument or with an empty value → 64 naming the flag and
 *       the accepted form — `status --json`, `--json ""`, `spawn … --cwd`, `watch … --idle-secs`; and
 *       `waste --since` in parseSince's own words — RED on ed161e6 for --json and --cwd: exit 0;
 *   (h) every refusal comes before any file: a TMUX_AGENT_HOME that does not exist is still absent;
 *   (i) the controls: `--no-enter` still types without Enter; `calibrate --out FILE` writes FILE
 *       (0600); `doctor --lexicon FILE` names FILE as the path it loaded; the argument after a
 *       declared value flag is its value whatever it looks like (`doctor --parent --prent` exits 0
 *       with a verdict for "--prent"); `--version` answers before anything is constructed; a bare
 *       `--help` keeps exit 64 with the usage line (TMUX-94 owns a real one) — on ed161e6 and on the
 *       fix alike, the control test is green on both builds.
 *
 * Run: node --test test/unknown-flags.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { waitForShell } from "./helpers/wait-shell.js";
import { quietServer } from "./helpers/quiet-server.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
// The card's bound: a refusal is one process start; on ed161e6 `watch --idle-sec 2` sat here until timeout(1) killed it.
const BOUND_MS = 5_000;

function socket() {
  return `ta-unkflag-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
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

/** A refusal is exit 64, nothing on stdout, and exactly one stderr line that starts with the flag as typed. */
function assertRefused(r, re, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.match(lines[0], re, `${label}: ${lines[0]}`);
  assert.doesNotMatch(lines[0], /\.js:\d+|status\.json →/, `${label}: a stack trace or the default path, not a refusal: ${lines[0]}`);
}

test("an undeclared --flag is refused with exit 64 naming it as typed, before any verb runs — status, spawn, send, watch", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-unkflag-"));
  const S = socket();
  let n = 0;
  const never = () => join(H, `never-${n++}`);
  try {
    // The control pane is a BARE shell: see test/helpers/quiet-server.js — the host's login profile,
    // pty wrapper and line editor are routed out of a pane whose shell this file never measured.
    quietServer(S);
    const sp = await cli(["--socket", S, "spawn", "uf-idle", "--cwd", "/tmp", "--parent", "unknown-flags-test", "--task", "control"], { TMUX_AGENT_HOME: H }, 30_000);
    assert.equal(sp.code, 0, `test setup: spawn exited ${sp.code}: ${sp.stderr}`);
    // Nothing is typed until the pane presents a shell to exec's OWN guard: a fresh pane's
    // deepest foreground process is briefly the host's pty wrapper (kiro-cli-term) or a still-running
    // login rc, and exec refuses an injection there — RIGHTLY. The watch `--idle-secs` exit is not that
    // question (an idle pane can still be wrapper-held), so it stays only as the control; readiness is
    // the guard's own no-op `exec … true`, and waitForShell THROWS if it never comes.
    await waitForShell(S, "uf-idle", { home: H });
    const ready = await cli(["--socket", S, "watch", "uf-idle", "--idle-secs", "3"], { TMUX_AGENT_HOME: H, TMUX_AGENT_SLACK_WEBHOOK: "" }, 30_000);
    assert.equal(ready.code, 0, `test setup: the control shell never went idle: ${ready.stderr.slice(0, 200)}`);

    // (a) a mistyped value flag: no file, no default path, the nearest declared name offered
    const typo = join(H, "typo.json");
    let r = await cli(["--socket", S, "status", "--jsn", typo], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^--jsn: unknown flag — did you mean --json\?/, "status --jsn FILE");
    assert.equal(existsSync(typo), false, "status --jsn FILE: the file was written");

    // (b) a mistyped lineage flag: no session is born with the wrong parent
    r = await cli(["--socket", S, "spawn", "uf-child", "--cwd", "/tmp", "--prent", "unknown-flags-test"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^--prent: unknown flag — did you mean --parent\?/, "spawn uf-child --cwd /tmp --prent P");
    assert.equal(sessions(S).includes("uf-child"), false, "spawn --prent: the session was created before the flag was judged (on ed161e6 it was born with parent=cli)");

    // (c) a mistyped boolean flag after the positionals: the one thing the operator asked it not to do
    r = await cli(["--socket", S, "send", "uf-idle", "echo UF_TYPO_ENTER", "--no-entr"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^--no-entr: unknown flag — did you mean --no-enter\?/, 'send uf-idle "echo UF_TYPO_ENTER" --no-entr');
    await new Promise((res) => setTimeout(res, 1000));
    assert.equal(pane(S, "uf-idle").includes("UF_TYPO_ENTER"), false, "send --no-entr: the text reached the pane (on ed161e6 Enter was pressed and the command ran)");

    // (d) a mistyped value flag on the verb a supervising script blocks on: refused inside the bound
    r = await cli(["--socket", S, "watch", "uf-idle", "--idle-sec", "2"], { TMUX_AGENT_HOME: never(), TMUX_AGENT_SLACK_WEBHOOK: "" });
    assertRefused(r, /^--idle-sec: unknown flag — did you mean --idle-secs\?/, "watch uf-idle --idle-sec 2");

    // (e) a mistyped boolean flag before the positionals: the typo is named, not the swallowed session name
    r = await cli(["--socket", S, "send", "--no-entr", "uf-idle", "echo UF_SWALLOWED"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^--no-entr: unknown flag — did you mean --no-enter\?/, 'send --no-entr uf-idle "echo UF_SWALLOWED"');
    assert.doesNotMatch(r.stderr, /invalid session name/, "send --no-entr X: the swallowed session name was refused instead of the typo");
    assert.equal(pane(S, "uf-idle").includes("UF_SWALLOWED"), false, "send --no-entr X text: the text reached the pane");

    // (f) no declared name within reach: named as typed, no guess
    r = await cli(["--socket", S, "status", "--bogus-flag-xyz"], { TMUX_AGENT_HOME: never() });
    assertRefused(r, /^--bogus-flag-xyz: unknown flag/, "status --bogus-flag-xyz");
    assert.doesNotMatch(r.stderr, /did you mean/, "a far-off typo must not be matched to a declared flag");

    // (h) none of the refusals touched the home
    for (let i = 0; i < n; i++) assert.equal(existsSync(join(H, `never-${i}`)), false, `refusal ${i} created the home directory before the flag was judged`);

    // (i) the correctly spelled flag keeps its meaning: typed, verified, no Enter
    const ok = await cli(["--socket", S, "send", "uf-idle", "echo UF_CTRL_NOENTER", "--no-enter"], { TMUX_AGENT_HOME: H }, 30_000);
    assert.equal(ok.code, 0, `send --no-enter (the control) exited ${ok.code}: ${ok.stderr.slice(0, 200)}`);
    assert.match(ok.stdout, /sent\+verified/, "the control's send was not verified");
    assert.equal(pane(S, "uf-idle").includes("UF_CTRL_NOENTER"), true, "the control's text did not reach the pane");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("a declared value flag with no value is refused naming the flag and the accepted form; --since keeps parseSince's words", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-unkflag-value-"));
  const S = socket();
  try {
    const cases = [
      [["status", "--json"], /^--json: no value given — give a file path/, "status --json (as the last argument)"],
      [["status", "--json", ""], /^--json: no value given — give a file path/, 'status --json ""'],
      [["spawn", "uf-x", "--cwd"], /^--cwd: no value given — give a directory/, "spawn uf-x --cwd (as the last argument)"],
      [["watch", "uf-x", "--idle-secs"], /^--idle-secs: no value given — give a whole number of seconds .*such as 60/, "watch uf-x --idle-secs (as the last argument)"],
      [["waste", "--since"], /^--since: no value given — give an ISO-8601 time such as 2026-08-18T00:00:00Z/, "waste --since (as the last argument)"],
    ];
    for (const [i, [args, re, label]] of cases.entries()) {
      const never = join(H, `never-${i}`);
      const r = await cli(["--socket", S, ...args], { TMUX_AGENT_HOME: never, TMUX_AGENT_SLACK_WEBHOOK: "" });
      assertRefused(r, re, label);
      assert.equal(existsSync(never), false, `${label}: the home directory was created before the flag was judged`);
    }
    assert.deepEqual(sessions(S), [], "spawn uf-x --cwd: a session was created before the flag was judged");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("the controls: --out and --lexicon are declared and still work, a value flag's next argument is its value, --version and --help unchanged", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-unkflag-ctrl-"));
  const S = socket();
  try {
    const draft = join(H, "draft.json");
    let r = await cli(["--socket", S, "calibrate", "--out", draft], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 0, `calibrate --out FILE exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(existsSync(draft), true, "calibrate --out FILE wrote nothing (README.md:154)");
    assert.equal(statSync(draft).mode & 0o777, 0o600, "the draft is not 0600");
    assert.ok(JSON.parse(readFileSync(draft, "utf8")), "the draft is not the JSON report");
    assert.match(r.stderr, /calibration draft written to /, "the draft's path was not announced");

    const lex = join(H, "lex.json");
    writeFileSync(lex, JSON.stringify({ version: 1 }));
    r = await cli(["--socket", S, "doctor", "--lexicon", lex], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 0, `doctor --lexicon FILE exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    const doctor = JSON.parse(r.stdout);
    assert.equal(doctor.lexicon.path, lex, "doctor --lexicon FILE did not load FILE (VERSIONING.md item 1 declares the flag)");
    assert.equal(doctor.lexicon.loaded, true);

    // the argument after a declared value flag is its value whatever it looks like — unchanged. Since TMUX-110 that
    // value is judged as a parent NAME (a leading dash fails the rule), so the proof the token was read as the value is
    // the refusal's shape: `--parent: invalid session name: "--prent"`, never `--prent: unknown flag`.
    r = await cli(["--socket", S, "doctor", "--parent", "--prent"], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 64, `doctor --parent --prent exited ${r.code}, want 64: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stderr, /^--parent: invalid session name: "--prent" /, `the value after --parent was judged as a flag instead of read as the value: ${r.stderr.slice(0, 200)}`);

    // --version answers before anything is constructed
    const neverV = join(H, "never-version");
    r = await cli(["--version"], { TMUX_AGENT_HOME: neverV });
    assert.equal(r.code, 0, `--version exited ${r.code}: ${r.stderr}`);
    assert.match(r.stdout, /^\d+\.\d+\.\d+ \(/, "the build stamp");
    assert.equal(existsSync(neverV), false, "--version created the home");

    // a bare --help is the help text, exit 0, before anything is constructed (TMUX-212; until then it reached the usage
    // line with exit 64 — "see source header" — which two cold-start rehearsals named as their first confusion). Still the
    // control this case needs: a flag judgeFlags lets through is answered, not refused as unknown.
    const neverH = join(H, "never-help-home");
    r = await cli(["--help"], { TMUX_AGENT_HOME: neverH });
    assert.equal(r.code, 0, `--help exited ${r.code}, want 0: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /^\s*tmux-agent spawn <name>/m, "the help text lists the verbs");
    assert.equal(r.stderr, "", `--help wrote to stderr: ${r.stderr}`);
    assert.equal(existsSync(neverH), false, "--help created the home");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});
