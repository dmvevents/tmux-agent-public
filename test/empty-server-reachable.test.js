/**
 * A tmux server that is ALIVE with zero sessions is not a dead one (TMUX-119, gate G3 "failure modes observable").
 *
 * TMUX-87/115/116/117 taught the fleet to say the tmux server is dead in tmux's own words. This file is the inverse
 * guard: the same signal used to fire on a server that is UP. Measured 2026-09-17 on the ea6f2ab dist
 * (scratch/ga-fire-2026-09-17-02Z): a server kept alive with zero sessions (`set -g exit-empty off`, its last session
 * killed) answered `display-message -p '#{version}'` with `3.4` and held its pid, while `list-panes -a` failed with
 * `no current target` — tmux's way of saying there is nothing to list, not that it is gone. `listFleetReachable()` ran
 * the sessions and panes listings in one `Promise.all` and read ANY TmuxError from either as a dead server, so
 * `listFleetReachable()` answered `{"reachable":false,"error":"no current target"}`, `status` printed `status: tmux
 * server UNREACHABLE on <socket> — no current target`, `status.json.tmux.reachable` was false, and that same field is
 * what `/api/fleet.tmux` gives the dashboard's red banner and `/api/health` gives `doctor`: the operator was told to
 * restart a server that is up. On the same stderr string `listPanesBySession()` — a method of `Tmux`, a DECLARED
 * public export (VERSIONING item 6), whose own doc-comment promises it swallows a dead server to an empty fleet —
 * threw an uncaught `TmuxError`, while `hasSessionChecked()` got it right (`no current target` is not `isNoServer`),
 * which is exactly why the fleet surface and the per-session surfaces disagreed about one server.
 *
 * The contract, measured against REAL tmux (a throwaway socket and home — the operator's fleet is never touched —
 * because the value under test IS tmux's own wording, which no fake can be trusted to reproduce):
 *   (1) the state is SET UP, not hoped for: `display-message -p '#{version}'` on the socket must exit 0 after the last
 *       session is killed. The host's DEFAULT config cannot hold this state (`exit-empty` on kills the empty server),
 *       so a run whose server did not survive FAILS here — an unset-up case must never pass;
 *   (2) `listPanesBySession()` resolves to an empty Map and does not throw, while raw `list-panes -a` on the same
 *       socket still fails with `no current target` (the state under test is the one that used to throw);
 *   (3) `listFleetReachable()` → `{reachable: true, error: null, sessions: [], panes.size: 0}`;
 *   (4) `Monitor.fleetReport().tmux.reachable` is true, and the `publishStatus()`-written `status.json.tmux.reachable`
 *       is true with `error: null` — the file the collector and MCP `fleet-status` read;
 *   (5) the built CLI `status` exits 0 and prints NO `tmux server UNREACHABLE` line for that socket;
 *   (6) the control lives HERE, in the same file: after `kill-server` — polled until tmux itself says "no server",
 *       because `kill-server` is not synchronous (TMUX-116/f1a60d9) — `listFleetReachable().reachable` is false
 *       carrying tmux's own "no server running on …" words, `status.json.tmux` flips back, and the `status` stderr line
 *       IS present. So the fix cannot be "stop reporting unreachable".
 * Every CLI run is bounded so a red cannot hang the suite.
 *
 * FAIL-first on the parent 2e2543d dist: (2) "listPanesBySession() threw where its own comment promises an empty
 * fleet: TmuxError: tmux list-panes failed: no current target", (3) reachable false with "no current target", (5) the
 * UNREACHABLE line present for a server that had just answered display-message. Output on TMUX-119.
 *
 * Run: node --test test/empty-server-reachable.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Monitor } from "../dist/core/monitor.js";
import { Tmux } from "../dist/core/tmux.js";
import { Ledger } from "../dist/core/ledger.js";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** `status` reaches its verdict in one fleet read: one process start and a couple of tmux calls that answer at once. */
const BOUND_MS = 15_000;

function socket() {
  return `ta-empty-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed…" when the bound fired — a hang, not an answer. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Raw tmux, rc and its own words together — the wording is the evidence, so it is never thrown away. */
function tmuxRaw(sock, args) {
  try {
    return { rc: 0, out: String(execFileSync("tmux", ["-L", sock, ...args], { stdio: ["ignore", "pipe", "pipe"] })).trim() };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim() };
  }
}
/** True when no tmux server exists on the socket at all — not "no sessions", the server itself is not there. */
function serverAbsent(sock) {
  const { rc, out } = tmuxRaw(sock, ["list-sessions"]);
  return rc !== 0 && /no server running|error connecting/.test(out);
}
/** The FIXTURE kill — raw, so the dead server's socket file stays for the "no server running on <path>" words the cases read; the teardown is killServerSync(). */
function killServer(sock) {
  tmuxRaw(sock, ["kill-server"]);
}
/**
 * `kill-server` returns before the server has finished exiting — on one CI cell of run 35123625508 the very next
 * `list-sessions` still reached it. A dead server is the state under test, so wait for it, bounded.
 */
async function untilServerAbsent(sock, ms = 5000) {
  const t0 = Date.now();
  while (!serverAbsent(sock)) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
/**
 * The state under test: one server, zero sessions, still alive. `exit-empty off` is set while a session still holds
 * the server up (the option cannot be set on a server that is not there) and is what a long-lived fleet operator sets
 * to keep a warm socket. Returns the version string tmux answered with — the proof the server survived (criterion 1);
 * a server that did not survive fails the assertion rather than skipping the case.
 */
function emptyLiveServer(sock) {
  const name = `keepme-${process.pid}`;
  execFileSync("tmux", ["-L", sock, "new-session", "-d", "-s", name, "-c", "/tmp"], { stdio: "ignore" });
  execFileSync("tmux", ["-L", sock, "set-option", "-g", "exit-empty", "off"], { stdio: "ignore" });
  execFileSync("tmux", ["-L", sock, "kill-session", "-t", `=${name}`], { stdio: "ignore" });
  const version = tmuxRaw(sock, ["display-message", "-p", "#{version}"]);
  assert.equal(
    version.rc,
    0,
    `precondition: the server on ${sock} did not survive its last session (display-message rc=${version.rc}: ${JSON.stringify(version.out)}) ` +
      "— the live-but-session-less state was never set up, so nothing below would be a test of it (exit-empty off is required; the host default kills the empty server)",
  );
  const sessions = tmuxRaw(sock, ["list-sessions", "-F", "#{session_name}"]);
  assert.equal(sessions.rc, 0, `precondition: list-sessions must answer rc 0 on a live server (got rc=${sessions.rc}: ${JSON.stringify(sessions.out)})`);
  assert.equal(sessions.out, "", `precondition: the server must have ZERO sessions (got ${JSON.stringify(sessions.out)})`);
  return version.out;
}

test("a live tmux server with zero sessions is reachable: listPanesBySession() resolves to an empty fleet where it used to throw, listFleetReachable() and fleetReport() say reachable, and the kill-server control still says unreachable in tmux's own words", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-empty-")));
  const S = socket();
  const tmux = new Tmux({ socket: S });
  const monitor = new Monitor(tmux, new Ledger(join(T, "ledger")), T);
  try {
    assert.ok(serverAbsent(S), `the throwaway socket ${S} already has a server`);

    // (1) the state under test, asserted into existence
    const version = emptyLiveServer(S);
    assert.match(version, /^\d/, `precondition: display-message answered ${JSON.stringify(version)}, not a tmux version`);

    // (2) the lister keeps the promise its own comment makes — and the raw call still fails, so this IS that state
    const raw = tmuxRaw(S, ["list-panes", "-a", "-F", "#{session_name}"]);
    assert.notEqual(raw.rc, 0, `(2) list-panes -a succeeded on a session-less server (${JSON.stringify(raw.out)}) — the state that used to throw was not reached`);
    assert.match(raw.out, /no current target/, `(2) the state under test is tmux's "no current target"; got ${JSON.stringify(raw.out)}`);
    const panes = await tmux.listPanesBySession().then((m) => m, (e) => e);
    assert.ok(panes instanceof Map, `(2) listPanesBySession() threw where its own comment promises an empty fleet: ${panes}`);
    assert.equal(panes.size, 0, `(2) a server with no sessions has no panes: ${JSON.stringify([...panes.keys()])}`);

    // (3) the fleet poll's verdict: the SESSIONS listing answered, so the server is up
    const fleet = await tmux.listFleetReachable();
    assert.equal(fleet.reachable, true, `(3) a server that answered display-message with ${version} was called unreachable: ${JSON.stringify({ reachable: fleet.reachable, error: fleet.error })}`);
    assert.equal(fleet.error, null, `(3) a reachable server carries no error: ${JSON.stringify(fleet.error)}`);
    assert.deepEqual(fleet.sessions, [], `(3) the empty server listed sessions: ${JSON.stringify(fleet.sessions.map((s) => s.name))}`);
    assert.equal(fleet.panes.size, 0, `(3) the empty server listed panes: ${JSON.stringify([...fleet.panes.keys()])}`);

    // (4) the consumer surfaces' listing (status.json, MCP fleet-status) — its verdict is the same one
    const report = await monitor.fleetReport();
    assert.equal(report.tmux.reachable, true, `(4) fleetReport() called a live server unreachable: ${JSON.stringify(report.tmux)}`);
    assert.equal(report.tmux.error, null, `(4) a reachable report carries no error: ${JSON.stringify(report.tmux.error)}`);
    assert.deepEqual(report.sessions, [], `(4) the empty server produced snapshots: ${JSON.stringify(report.sessions.map((s) => s.session))}`);

    // (6) control: a server that is REALLY dead is still unreachable, in tmux's own words — the fix is not "stop reporting"
    killServer(S);
    assert.ok(await untilServerAbsent(S), "(6) kill-server left a server on the socket after 5 s");
    const dead = await tmux.listFleetReachable();
    assert.equal(dead.reachable, false, `(6) a killed server was called reachable — the signal is gone, not fixed: ${JSON.stringify({ reachable: dead.reachable, error: dead.error })}`);
    assert.match(String(dead.error), /no server running on .*\//, `(6) the error must be tmux's own words, not ours: ${JSON.stringify(dead.error)}`);
    assert.ok(String(dead.error).includes(S), `(6) the error names the socket: ${JSON.stringify(dead.error)}`);
    assert.equal((await tmux.listPanesBySession()).size, 0, "(6) the swallow of a dead server (nickgnd#9) is unchanged");
    assert.equal((await monitor.fleetReport()).tmux.reachable, false, "(6) fleetReport() must still carry a dead server's verdict");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});

test("`status` on a live tmux server with zero sessions exits 0 with no UNREACHABLE line and writes status.json.tmux.reachable true; the same verb after kill-server prints the line and flips the file back", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-emptycli-")));
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const S = socket();
  const UNREACHABLE = new RegExp(`^status: tmux server UNREACHABLE on ${S} — (.+)$`, "m");
  try {
    assert.ok(serverAbsent(S), `the throwaway socket ${S} already has a server`);
    const version = emptyLiveServer(S);

    // (5) the operator's own surface: no alarm about a server that is up
    const live = await cli(["--socket", S, "status"], env);
    assert.equal(live.code, 0, `(5) status exited ${live.code}, want 0: ${live.stderr.slice(0, 300)}`);
    assert.ok(!UNREACHABLE.test(live.stderr), `(5) a server that answered display-message with ${version} was reported UNREACHABLE: ${JSON.stringify(live.stderr)}`);

    // (4) the file half — publishStatus()'s own write, what the collector and MCP fleet-status read
    const st = JSON.parse(readFileSync(join(home, "status.json"), "utf8"));
    assert.equal(st.tmux.reachable, true, `(4) status.json called a live server unreachable: ${JSON.stringify(st.tmux)}`);
    assert.equal(st.tmux.error, null, `(4) a reachable status.json carries no error: ${JSON.stringify(st.tmux.error)}`);
    assert.equal(st.sessions.length, 0, `(4) the empty server published sessions: ${JSON.stringify(st.sessions.map((s) => s.session))}`);

    // (6) control on the same surface: the fleet's worst signal still fires when the server is really gone
    killServer(S);
    assert.ok(await untilServerAbsent(S), "(6) kill-server left a server on the socket after 5 s");
    const gone = await cli(["--socket", S, "status"], env);
    assert.equal(gone.code, 0, `(6) status exited ${gone.code}, want 0 (the exit code is a fleet the verb could describe): ${gone.stderr.slice(0, 300)}`);
    const line = gone.stderr.match(UNREACHABLE);
    assert.ok(line, `(6) stderr lacks the UNREACHABLE line for a genuinely dead server: ${JSON.stringify(gone.stderr)}`);
    assert.match(line[1], /no server running on .*\//, `(6) the line must carry tmux's own words: ${JSON.stringify(line[1])}`);
    const st2 = JSON.parse(readFileSync(join(home, "status.json"), "utf8"));
    assert.equal(st2.tmux.reachable, false, `(6) status.json must flip back for a dead server: ${JSON.stringify(st2.tmux)}`);
    assert.equal(st2.tmux.error, line[1], "(6) the line's words are the file's words");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
