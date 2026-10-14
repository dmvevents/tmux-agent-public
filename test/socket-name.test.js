/**
 * The SOCKET the tool talks to — `--socket NAME`, else `TMUX_AGENT_SOCKET` — is the one global value every verb reads,
 * and the whole isolation story (README "Isolated by default", THREAT-MODEL's socket control) rests on it. Since TMUX-113
 * it is judged before anything is touched, through the driver's one exported rule, `assertSocketName` in
 * src/core/tmux.ts (`^[A-Za-z0-9._-]+$` — a -L name is a file name under tmux's socket directory: no `/`, no whitespace,
 * no shell metacharacter, one character or more): exit 64 at the CLI, one stderr line naming the source, the value as
 * typed and the rule; the MCP server refusing to start with the same line (test/mcp.test.js). TMUX-104 to TMUX-112 moved
 * every other value the CLI reads into one named refusal before anything is touched; the socket name was the last one
 * judged late (gates G1 no test named the exit code, the source, the home, `watch`'s GONE or the MCP server's startup
 * under a socket the tool cannot use; G3 `watch` reported a refusal as the session dying; G6 the header did not name it).
 *
 * Measured 2026-09-16 02:2xZ on 7b1e542 (scratch/ga-fire-2026-09-16-02Z/socket-probe/probe-7b1e542.log,
 * supplement-7b1e542.log, web-7b1e542.log): `Tmux.socketArgs()` alone held the rule and threw a bare
 * `Error("unsafe socket name: …")` at the FIRST tmux call, so `--socket ../x status`, `--socket 'a b'`, `--socket 'a;b'`,
 * `TMUX_AGENT_SOCKET=../x` and `TMUX_AGENT_SOCKET=` (set, empty) each exited 1 in the driver's words — no source, no rule
 * — with the 0700 home already made (`ledger/`, `logs/`); `spawn`, `lineage`, `calibrate`, `exec`, `send`, `kill` the
 * same; `waste`, `log`, `msg send` / `msg recv` and `doctor` ran to completion, exit 0, rows written, no word about the
 * socket; `watch vp-sock --idle-secs 1` printed `{"state":"GONE",…}`, exit 2 — the code a supervising script reads as
 * "the session died" — and wrote a notify.sent row, because hasSession's bare catch swallowed the throw; `--socket ../x
 * --default-server status` never looked at the value (socketArgs returns [] first) and read the operator's own server;
 * the dashboard under `--socket ../x` served `{"error":"unsafe socket name: ../x"}` on /api/fleet to the bound.
 *
 * Black-box through the built CLI like test/lineage-name.test.js: the contract is the exit code, the streams and what
 * did NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the suite.
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) `--socket` with a traversal, whitespace and a shell metacharacter, on `status`, `spawn`, `lineage`, `doctor`,
 *       `waste`, `log`, `msg send`, `msg recv`, `calibrate` — and with `--default-server` typed too — → 64, one stderr
 *       line `--socket: invalid socket name: "<as typed>" ([A-Za-z0-9._-], 1 or more)`, nothing on stdout; the
 *       not-yet-existing home still absent (no ledger row, no mailbox) — RED on 7b1e542: exit 1 for the tmux verbs
 *       with the home made, exit 0 for the rest, and exit 0 reading the default server;
 *   (b) the variable, when the flag is absent → `TMUX_AGENT_SOCKET: invalid socket name: …`; set-but-empty is a socket
 *       named nothing, refused like any other — RED on 7b1e542: exit 1 in the driver's words;
 *   (c) `watch X --idle-secs 1` under the refused socket → 64 inside the bound, no GONE line, no notify.sent row (no
 *       home at all) — RED on 7b1e542: exit 2, `"state":"GONE"` on stdout, the row written;
 *   (d) `web --port P` under the refused socket → 64, no listener on P — RED on 7b1e542: served to the bound;
 *   (e) the controls, green before and after: a safe `--socket` runs `status` to exit 0 and makes the home; the flag
 *       wins over the variable (a bad variable under a good flag is not refused); `--socket ''` stays judgeFlags'
 *       refusal in its own words;
 *   (f) one rule, not two: `assertSocketName(value, source)` builds the CLI's line itself; `new Tmux({ socket })`
 *       throws `SocketNameError` at construction — `defaultServer` or not — so no driver exists whose hasSession could
 *       swallow the throw; which wins for a VALID pair is unchanged (`socketArgs()` is [] under defaultServer).
 *
 * Run: node --test test/socket-name.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const TMUX = pathToFileURL(join(ROOT, "dist", "core", "tmux.js")).href;
const RULE = "([A-Za-z0-9._-], 1 or more)";
// A refusal is one process start; a red run on 7b1e542 (the driver's throw at the first tmux call) ends inside it too,
// and a red `watch` (its 1 s idle bound plus the GONE report) as well.
const BOUND_MS = 5_000;
// A run meant to reach tmux: `status` on a socket whose server does not exist yet starts none and lists nothing.
const STATUS_MS = 20_000;
// The values the rule refuses, each a different clause of it: the traversal (a `/`), whitespace, a shell metacharacter.
// The empty FLAG value is judgeFlags' refusal; the empty VARIABLE is this rule's, in (b).
const BAD = ["../x", "a b", "a;b"];

function socket() {
  return `ta-sockname-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed…" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    // this test's own environment must not be the socket, the actor or the server under test
    const clean = { ...process.env };
    delete clean.TMUX_AGENT_SOCKET;
    delete clean.TMUX_AGENT_DEFAULT_SERVER;
    delete clean.TMUX_AGENT_ACTOR;
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...clean, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** True when nothing accepts a connection on 127.0.0.1:port (ECONNREFUSED); false when something answers. */
function listenerAbsent(port) {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(false); });
    s.once("error", () => resolve(true));
  });
}
/** A refusal is exit 64, nothing on stdout, exactly one stderr line: the source, the value as typed, the rule. */
function assertRefused(r, source, value, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `${source}: invalid socket name: ${JSON.stringify(value)} ${RULE}`, `${label}: the source, the value as typed and the rule`);
}

test("a --socket or TMUX_AGENT_SOCKET the tool cannot use is refused with exit 64 on every verb, before the home, a ledger row or a server exists", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-sockname-")));
  const home = join(T, "home"); // never created by a refusal
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (a) the flag, each refused value, on the verbs that call tmux and on the verbs that never do — the value as typed
    for (const value of BAD) {
      let r = await cli(["--socket", value, "status"], env);
      assertRefused(r, "--socket", value, `--socket ${JSON.stringify(value)} status`);
      r = await cli(["--socket", value, "spawn", "vs-ok", "--cwd", T], env);
      assertRefused(r, "--socket", value, `--socket ${JSON.stringify(value)} spawn vs-ok --cwd <T>`);
    }
    const verbs = [
      ["lineage"], ["doctor"], ["waste"], ["log", "vs-ok"], ["calibrate"], ["kill", "vs-ok"], ["exec", "vs-ok", "true"], ["send", "vs-ok", "hello"],
      ["msg", "send", "vs-a", "vs-b", "hello", "body"], ["msg", "recv", "vs-b"],
    ];
    for (const verb of verbs) {
      const r = await cli(["--socket", "../x", ...verb], env);
      assertRefused(r, "--socket", "../x", `--socket "../x" ${verb.join(" ")} (on 7b1e542: ${/^(doctor|waste|log|msg)$/.test(verb[0]) ? "exit 0, the verb run to completion" : "exit 1 in the driver's words, the home made"})`);
    }
    // --default-server typed as well: a name typed is a name judged (on 7b1e542 socketArgs returned [] first and the
    // operator's own server was read, exit 0)
    let r = await cli(["--socket", "../x", "--default-server", "status"], env);
    assertRefused(r, "--socket", "../x", '--socket "../x" --default-server status');
    // (b) the variable, when the flag is absent: named as the source; set-but-empty is a socket named nothing
    for (const value of BAD) {
      r = await cli(["lineage"], { ...env, TMUX_AGENT_SOCKET: value });
      assertRefused(r, "TMUX_AGENT_SOCKET", value, `TMUX_AGENT_SOCKET=${JSON.stringify(value)} lineage`);
    }
    r = await cli(["status"], { ...env, TMUX_AGENT_SOCKET: "" });
    assertRefused(r, "TMUX_AGENT_SOCKET", "", "TMUX_AGENT_SOCKET= (set, empty) status (on 7b1e542: `unsafe socket name: ` exit 1)");
    r = await cli(["--default-server", "status"], { ...env, TMUX_AGENT_SOCKET: "../x" });
    assertRefused(r, "TMUX_AGENT_SOCKET", "../x", 'TMUX_AGENT_SOCKET="../x" --default-server status');
    // (c) watch: a refusal, not a session state — no GONE line, no notify.sent row, inside the bound
    r = await cli(["--socket", "../x", "watch", "vs-ok", "--idle-secs", "1"], env);
    assertRefused(r, "--socket", "../x", '--socket "../x" watch vs-ok --idle-secs 1 (on 7b1e542: exit 2, {"state":"GONE"} and a notify.sent row)');
    assert.equal(r.stdout.includes("GONE"), false, `watch under a refused socket reported the session GONE: ${r.stdout}`);
    // (d) web: no listener is ever opened
    const port = 20000 + Math.floor(Math.random() * 20000);
    r = await cli(["--socket", "../x", "web", "--port", String(port), "--no-token"], env);
    assertRefused(r, "--socket", "../x", `--socket "../x" web --port ${port} --no-token (on 7b1e542: served to the bound)`);
    assert.equal(await listenerAbsent(port), true, `web under a refused socket left a listener on 127.0.0.1:${port}`);
    // nothing was touched: no home (so no ledger row, no notify.sent, no mailbox), nothing in the temp dir
    assert.equal(existsSync(home), false, "a refusal created the home before the socket name was judged (on 7b1e542 the constructor's mkdirSync ran first)");
    assert.deepEqual(ledger(home), [], "a refusal wrote a ledger row");
    assert.deepEqual(readdirSync(T), [], `a refusal left something in the temp dir: ${readdirSync(T).join(", ")}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("a safe socket runs as before, the flag wins over the variable, the empty flag stays judgeFlags' refusal; one rule — the driver judges a given socket at construction", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-sockname-ok-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (e) the controls
    let r = await cli(["--socket", S, "status"], env, STATUS_MS);
    assert.equal(r.code, 0, `--socket ${S} status exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.ok(existsSync(home), "a safe socket's status did not make the home");
    r = await cli(["--socket", S, "status"], { ...env, TMUX_AGENT_SOCKET: "../x" }, STATUS_MS);
    assert.equal(r.code, 0, `--socket ${S} over TMUX_AGENT_SOCKET="../x": the flag must win, exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    r = await cli(["--socket", "", "status"], env);
    assert.equal(r.code, 64, `--socket '' status exited ${r.code}, want 64`);
    assert.equal(r.stderr.trim(), "--socket: no value given — give a tmux socket name (the -L name)", `the empty flag value is judgeFlags' refusal, not this rule's: ${r.stderr}`);
    // (f) one rule: the driver's exported check builds the CLI's line itself when given the source, and the plain message otherwise
    const tmux = await import(TMUX);
    assert.equal(typeof tmux.assertSocketName, "function", "src/core/tmux.ts exports no assertSocketName — the CLI has no one rule to judge a socket name through");
    for (const value of ["../x", "a b", "a;b", ""]) {
      const plain = `invalid socket name: ${JSON.stringify(value)} ${RULE}`;
      assert.throws(() => tmux.assertSocketName(value), (e) => e instanceof tmux.SocketNameError && e.message === plain, `assertSocketName(${JSON.stringify(value)}): the driver's plain message`);
      for (const source of ["--socket", "TMUX_AGENT_SOCKET"]) {
        assert.throws(() => tmux.assertSocketName(value, source), (e) => e instanceof tmux.SocketNameError && e.message === `${source}: ${plain}`, `assertSocketName(${JSON.stringify(value)}, ${JSON.stringify(source)}): the CLI's line is not the driver's`);
      }
      assert.throws(() => new tmux.Tmux({ socket: value }), (e) => e instanceof tmux.SocketNameError && e.message === plain, `new Tmux({ socket: ${JSON.stringify(value)} }) was built — a driver exists whose hasSession would swallow the throw`);
      assert.throws(() => new tmux.Tmux({ socket: value, defaultServer: true }), (e) => e instanceof tmux.SocketNameError, `new Tmux({ socket: ${JSON.stringify(value)}, defaultServer: true }) was built — defaultServer exempted a name typed`);
    }
    for (const ok of ["tmux-agent", "a.b_c-d", "0", S]) assert.doesNotThrow(() => tmux.assertSocketName(ok, "--socket"), `assertSocketName rejects a valid name ${JSON.stringify(ok)}`);
    assert.deepEqual(new tmux.Tmux({ socket: S, defaultServer: true }).socketArgs(), [], "which wins for a valid pair is unchanged: defaultServer still answers []");
    assert.deepEqual(new tmux.Tmux({ socket: S }).socketArgs(), ["-L", S], "a valid socket still reaches -L");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
