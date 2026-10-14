/**
 * The tmux server's death reaches the collector's file and the operator's verb (TMUX-116, gate G3 "failure modes
 * observable").
 *
 * TMUX-87 put the death on /api/fleet, in the ledger and through the notify sink; TMUX-115 carried it to /api/health
 * and doctor. Two CONSUMER surfaces still did not carry it — the ones README sends a collector and an agent to.
 * Measured 2026-09-16 on 1c4ae7f (scratch/ga-fire-2026-09-16-14Z/status-probe/probe-1c4ae7f.log): three seconds after
 * `tmux kill-server`, with the daemon's own tick having ledgered `fleet.tmux` and two GONE, `status --json` exited 0
 * and wrote a file IDENTICAL in every key but generatedAt to the one a socket no server ever ran on gets —
 * `{ v, generatedAt, sessions: [] }` — and its one stderr line was the socket-mismatch hint ("a collector is watching
 * another tmux server. Try --default-server"): written for the mismatch, satisfied exactly by a
 * dead server, because the daemon's own fleet.tmux / GONE rows are what keep the ledger fresh. publishStatus and the
 * verb both read monitor.fleet() = tmux.listSessions(), which swallows a dead server into [] on purpose (nickgnd#9:
 * spawn must start before a server exists); neither touched listFleetReachable(), the listing /api/fleet rides.
 *
 * The contract, on the BUILT CLI (`status --json FILE`; exit code 0 in every case — the fact rides the file):
 *   (a) a socket no server has ever run on: the file carries top-level `tmux` = { reachable:false, since, error,
 *       checkedAt } with tmux's own words (`error connecting to …/<socket> (No such file or directory)`), `since`
 *       equal to `checkedAt` (a one-shot process has observed no transition and invents none), sessions [] — and
 *       stderr holds `status: tmux server UNREACHABLE on <socket> — <error>`, never the --default-server hint;
 *   (b) a live socket with one session: reachable:true, error null, since === checkedAt, the session listed, no
 *       UNREACHABLE line and no hint (a fleet that answers with sessions needs neither);
 *   (c) the same socket after kill-server — dead, not never-started, the ledger fresh from the spawn (the exact
 *       misdiagnosis case): reachable:false, `no server running on …/<socket>`, sessions [], the UNREACHABLE line
 *       and NOT the hint; the string "no server" is in the file;
 *   (d) neither dead run ledgers anything: no fleet.tmux row ever (the first observation stays a baseline) and the
 *       row count unchanged across (c) — a cron's `status` every minute on a dead server writes no rows.
 * Every run is bounded so a red cannot hang the suite; the kill in (c) is waited for, not assumed (see untilServerAbsent).
 *
 * FAIL-first on the parent 1d863d7 dist: (a) "status.json has no tmux key"; (c) the same, and the stderr carries
 * `--default-server`. Output on TMUX-116.
 *
 * Run: node --test test/status-tmux-down.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// A status on a socket with no server is one process start and two tmux execs that fail fast; a red run that hangs
// (a listing that waits on a dead socket) ends inside the bound too.
const BOUND_MS = 10_000;
// A run that reaches a live server: a spawn (new-session, the hasSession poll, set-option, pipe-pane) or a status
// that captures every pane.
const LIVE_MS = 25_000;

function socket() {
  return `ta-stdown-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed…" when the bound fired — a hang, not an answer. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** True when no tmux server exists on the socket at all — not "no sessions", the server itself is not there. */
function serverAbsent(sock) {
  try {
    execFileSync("tmux", ["-L", sock, "list-sessions"], { stdio: ["ignore", "pipe", "pipe"] });
    return false;
  } catch (e) {
    return /no server running|error connecting/.test(String(e.stderr));
  }
}
/** The FIXTURE kill — raw, so the dead server's socket file stays for the "no server running on <path>" words the cases read; the teardown is killServerSync(). */
function killServer(sock) {
  try {
    execFileSync("tmux", ["-L", sock, "kill-server"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}
/**
 * `kill-server` returns before the server has finished exiting: on the ubuntu-22 CI cell of run 35123625508 the very next
 * `list-sessions` still reached it and the (c) precondition read "kill-server left a server on the socket" while five other
 * cells and three local runs passed. Poll the socket until tmux itself says "no server", bounded — a dead server is the
 * state under test, so the test waits for it rather than assuming the kill was synchronous.
 */
async function untilServerAbsent(sock, ms = 5000) {
  const t0 = Date.now();
  while (!serverAbsent(sock)) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** The file `status --json` wrote, its tmux block asserted to the contract's shape; returns the parsed file. */
function readStatus(file, label) {
  assert.ok(existsSync(file), `${label}: status --json wrote nothing`);
  const s = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(s.v, 1, `${label}: v is ${s.v} — the tmux block is additive, v stays 1`);
  assert.ok(Array.isArray(s.sessions), `${label}: sessions is not an array`);
  assert.ok("tmux" in s, `${label}: status.json has no tmux key — keys: ${Object.keys(s).join(",")} (on 1d863d7 a dead server and a socket no server ever ran on wrote the same three keys)`);
  assert.deepEqual(Object.keys(s.tmux).sort(), ["checkedAt", "error", "reachable", "since"], `${label}: tmux block keys`);
  assert.match(s.tmux.checkedAt, ISO, `${label}: checkedAt is not an ISO stamp: ${s.tmux.checkedAt}`);
  assert.match(s.tmux.since, ISO, `${label}: since is not an ISO stamp: ${s.tmux.since}`);
  assert.equal(s.tmux.since, s.tmux.checkedAt, `${label}: a one-shot process has observed no transition — since must equal checkedAt (${s.tmux.since} vs ${s.tmux.checkedAt})`);
  return s;
}
const UNREACHABLE = (sock) => new RegExp(`^status: tmux server UNREACHABLE on ${sock} — (.+)$`, "m");

test("status --json carries the tmux server's verdict in its file and on stderr: a dead or absent server is reachable:false in tmux's words, never the socket-mismatch hint; a live one reachable:true", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-stdown-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const name = `stdown-${process.pid}`;
  try {
    assert.ok(serverAbsent(S), `the throwaway socket ${S} already has a server`);

    // (a) no server has ever run on the socket — the start-before-a-server case the swallow exists for
    const a = await cli(["--socket", S, "status", "--json", join(T, "never.json")], env);
    assert.equal(a.code, 0, `(a) status --json on a never-started socket exited ${a.code}: ${a.stderr.slice(0, 300)}`);
    const never = readStatus(join(T, "never.json"), "(a) never-started");
    assert.equal(never.tmux.reachable, false, "(a) a socket no server ever ran on is not a reachable fleet");
    assert.ok(typeof never.tmux.error === "string" && never.tmux.error.includes(S), `(a) error must be tmux's own words naming the socket: ${JSON.stringify(never.tmux.error)}`);
    assert.deepEqual(never.sessions, [], "(a) no sessions on a socket with no server");
    assert.equal(a.stdout, "", `(a) no fleet lines for an empty fleet: ${JSON.stringify(a.stdout)}`);
    const aLine = a.stderr.match(UNREACHABLE(S));
    assert.ok(aLine, `(a) stderr lacks the UNREACHABLE line naming the socket: ${JSON.stringify(a.stderr)}`);
    assert.equal(aLine[1], never.tmux.error, "(a) the line's words are the file's words");
    assert.ok(!a.stderr.includes("--default-server"), `(a) an absent server was diagnosed as a socket mismatch: ${JSON.stringify(a.stderr)}`);
    assert.match(a.stderr, /^status\.json → /m, "(a) the status.json → line still names the file");
    assert.ok(serverAbsent(S), "(a) a status read started a tmux server");
    assert.equal(ledger(home).filter((e) => e.type === "fleet.tmux").length, 0, "(a) a one-shot status must not ledger a fleet.tmux transition (the first observation is a baseline)");

    // (b) a live socket with one session, spawned through the CLI so the ledger is fresh
    const sp = await cli(["--socket", S, "spawn", name, "--cwd", "/tmp", "--parent", "stdown-test"], env, LIVE_MS);
    assert.equal(sp.code, 0, `spawn exited ${sp.code}: ${sp.stderr.slice(0, 300)}`);
    const b = await cli(["--socket", S, "status", "--json", join(T, "live.json")], env, LIVE_MS);
    assert.equal(b.code, 0, `(b) status --json on the live socket exited ${b.code}: ${b.stderr.slice(0, 300)}`);
    const live = readStatus(join(T, "live.json"), "(b) live");
    assert.equal(live.tmux.reachable, true, `(b) a live server is reachable: ${JSON.stringify(live.tmux)}`);
    assert.equal(live.tmux.error, null, "(b) a reachable server carries no error");
    assert.ok(live.sessions.some((s) => s.session === name), `(b) the file is not the fleet: ${live.sessions.map((s) => s.session).join(",")}`);
    assert.ok(b.stdout.includes(name), `(b) the fleet line is missing: ${JSON.stringify(b.stdout)}`);
    assert.ok(!/UNREACHABLE/.test(b.stderr), `(b) a live server was called unreachable: ${JSON.stringify(b.stderr)}`);
    assert.ok(!b.stderr.includes("--default-server"), `(b) a fleet with sessions got the socket-mismatch hint: ${JSON.stringify(b.stderr)}`);

    // (c) kill the server: dead, not never-started, and the ledger fresh — the case the hint misdiagnosed
    killServer(S);
    assert.ok(await untilServerAbsent(S), "kill-server left a server on the socket after 5 s");
    const rowsBefore = ledger(home).length;
    const c = await cli(["--socket", S, "status", "--json", join(T, "dead.json")], env);
    assert.equal(c.code, 0, `(c) status --json after kill-server exited ${c.code}: ${c.stderr.slice(0, 300)}`);
    const dead = readStatus(join(T, "dead.json"), "(c) after kill-server");
    assert.equal(dead.tmux.reachable, false, "(c) a killed server is not a reachable fleet");
    assert.match(String(dead.tmux.error), /no server running on .*\//, `(c) error must be tmux's own words: ${JSON.stringify(dead.tmux.error)}`);
    assert.ok(dead.tmux.error.includes(S), `(c) error names the socket: ${JSON.stringify(dead.tmux.error)}`);
    assert.deepEqual(dead.sessions, [], "(c) no sessions on a dead server");
    assert.ok(readFileSync(join(T, "dead.json"), "utf8").includes("no server"), "(c) the string \"no server\" is not in the file (on 1c4ae7f: 0 times)");
    assert.equal(c.stdout, "", `(c) no fleet lines for a dead server: ${JSON.stringify(c.stdout)}`);
    const cLine = c.stderr.match(UNREACHABLE(S));
    assert.ok(cLine, `(c) stderr lacks the UNREACHABLE line naming the socket: ${JSON.stringify(c.stderr)}`);
    assert.equal(cLine[1], dead.tmux.error, "(c) the line's words are the file's words");
    assert.ok(!c.stderr.includes("--default-server"), `(c) a dead server was diagnosed as a socket mismatch — the hint fired on 0 sessions + a fresh ledger (on 1c4ae7f: "Try --default-server"): ${JSON.stringify(c.stderr)}`);
    assert.match(c.stderr, /^status\.json → /m, "(c) the status.json → line still names the file");
    assert.ok(serverAbsent(S), "(c) a status read on a dead socket started a tmux server");

    // (d) the dead run wrote nothing to the ledger
    const rows = ledger(home);
    assert.equal(rows.length, rowsBefore, `(d) a status on a dead server added ${rows.length - rowsBefore} ledger row(s): ${JSON.stringify(rows.slice(rowsBefore).map((e) => e.type))}`);
    assert.equal(rows.filter((e) => e.type === "fleet.tmux").length, 0, "(d) a one-shot status must never ledger fleet.tmux — the daemon's poll owns that row");

    // the never-started and the dead file are no longer shape-identical to a healthy empty fleet: both say so
    for (const [label, s] of [["never", never], ["dead", dead]]) assert.equal(s.tmux.reachable, false, `${label}: sessions [] with reachable false is a dead or absent server — the verdict the collector reads`);
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
