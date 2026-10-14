/**
 * A GONE session says WHY (TMUX-117, gate G3 "failure modes observable").
 *
 * TMUX-87 put the tmux server's death on `/api/fleet`, in the ledger and through the notify sink; TMUX-115 carried it
 * to `/api/health` and `doctor`; TMUX-116 to `status.json`, MCP `fleet-status` and the `status` verb. One level down,
 * the three PER-SESSION surfaces — the `watch` verb (what a supervising script blocks on, exit 2 by VERSIONING item 1),
 * MCP `session-status` and `/api/session/<name>` — all read `Monitor.snapshot()`, which answered GONE off
 * `hasSession()` alone. Measured 2026-09-16 on the f1a60d9 dist (scratch/ga-fire-2026-09-16-18Z/gone-probe): a session
 * someone killed on a live server and a whole server that had died under a live session produced replies differing in
 * NO key or value but `session` and `at`, and the string "no server" appeared 0 times in either, while
 * `status.json.tmux` and `/api/fleet.tmux` already said `reachable:false` with tmux's own words.
 *
 * The contract, measured against REAL tmux (a throwaway socket, the driver's own stderr — never a fake, because the
 * value being asserted IS tmux's wording):
 *   (a) a socket no server has ever run on: `state: "GONE"` and `reason` a string in tmux's words naming the socket
 *       (`error connecting to …/<socket> (No such file or directory)`);
 *   (b) a live session on that socket: not GONE, `reason` null — the healthy path carries no reason and pays no
 *       extra exec (the presence check is the one that already ran);
 *   (c) a name that does not exist on a LIVE server: GONE with `reason` null — the server answered, the session is
 *       simply absent, and that is NOT the server's death;
 *   (d) the same socket after `kill-server`, asked about a session that was alive: GONE with `reason` in tmux's words
 *       (`no server running on …/<socket>`) — so (c) and (d), byte-identical but for `session`/`at` before this card,
 *       now differ in `reason`;
 *   (e) the read ledgers no `fleet.tmux` and does not move the poll state `tmuxStatus()` reports: a `watch` loop on a
 *       dead server writes no transition row, `fleetFast()` stays the one owner (the GONE `session.state` row
 *       `snapshot()` has always emitted for a session it had seen is unchanged);
 *   (f) on the BUILT CLI, `watch <name>` on a socket with no server exits 2 (item 1, unchanged), prints its GONE JSON
 *       with the reason, and prints one stderr line `watch: tmux server UNREACHABLE on <socket> — <error>`; a name
 *       absent from a LIVE server exits 2 with no such line — the supervising script's two cases told apart.
 * Every CLI run is bounded so a red cannot hang the suite.
 *
 * FAIL-first on the parent 34d9785 dist: (a) "the GONE snapshot has no reason key — keys: at,classifiedBy,contextPct,
 * cpuPerSec,lastLine,logBytes,rssBytes,session,state"; (f) the same, and stderr holds no UNREACHABLE line. Output on
 * TMUX-117.
 *
 * Run: node --test test/gone-reason.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Monitor } from "../dist/core/monitor.js";
import { Tmux } from "../dist/core/tmux.js";
import { Ledger } from "../dist/core/ledger.js";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** A watch that reaches its verdict on the first poll: one process start and a couple of tmux calls that fail fast. */
const BOUND_MS = 15_000;

function socket() {
  return `ta-goner-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
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
/** Every ledger row under the home, oldest first. */
function ledgerRows(home) {
  const dir = join(home, "ledger");
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort()
      .flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  } catch {
    return [];
  }
}
/** The snapshot's reason, asserted to exist as a key at all — the whole gap was that it did not. */
function reasonOf(snap, label) {
  assert.ok("reason" in snap, `${label}: the snapshot has no reason key — keys: ${Object.keys(snap).sort().join(",")} (on 34d9785 a killed session and a dead server were the same nine keys)`);
  return snap.reason;
}

test("Monitor.snapshot() tells a session that is simply absent from a tmux server that did not answer: GONE carries tmux's own words in reason, null when the server answered", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-goner-")));
  const S = socket();
  const alive = `goner-${process.pid}`;
  const tmux = new Tmux({ socket: S });
  const monitor = new Monitor(tmux, new Ledger(join(T, "ledger")), T);
  try {
    assert.ok(serverAbsent(S), `the throwaway socket ${S} already has a server`);

    // (a) no server has ever run on the socket
    const never = await monitor.snapshot(alive);
    assert.equal(never.state, "GONE", `(a) a socket with no server has no sessions: ${JSON.stringify(never)}`);
    const neverWhy = reasonOf(never, "(a) never-started");
    assert.ok(typeof neverWhy === "string" && neverWhy.includes(S), `(a) reason must be tmux's own words naming the socket: ${JSON.stringify(neverWhy)}`);
    assert.match(neverWhy, /no server running|error connecting/, `(a) reason must be tmux's wording, not ours: ${JSON.stringify(neverWhy)}`);

    // (b) a live session: the healthy path carries no reason
    execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", alive, "-c", "/tmp"], { stdio: "ignore" });
    const live = await monitor.snapshot(alive);
    assert.notEqual(live.state, "GONE", `(b) a live session read as GONE: ${JSON.stringify(live)}`);
    assert.equal(reasonOf(live, "(b) live"), null, `(b) a session that exists has no reason to explain: ${JSON.stringify(live.reason)}`);

    // (c) a name that does not exist on a server that ANSWERED — absent, not dead
    const absent = await monitor.snapshot(`${alive}-nosuch`);
    assert.equal(absent.state, "GONE", `(c) an absent session is GONE: ${JSON.stringify(absent)}`);
    assert.equal(reasonOf(absent, "(c) absent on a live server"), null, `(c) the server answered — an absent session must not be reported as the server's death: ${JSON.stringify(absent.reason)}`);

    // (d) the server dies under a session that was alive
    const rowsBefore = ledgerRows(T).length;
    killServer(S);
    assert.ok(await untilServerAbsent(S), "kill-server left a server on the socket after 5 s");
    const dead = await monitor.snapshot(alive);
    assert.equal(dead.state, "GONE", `(d) a session on a dead server is GONE: ${JSON.stringify(dead)}`);
    const deadWhy = reasonOf(dead, "(d) after kill-server");
    assert.match(String(deadWhy), /no server running on .*\//, `(d) reason must be tmux's own words: ${JSON.stringify(deadWhy)}`);
    assert.ok(deadWhy.includes(S), `(d) reason names the socket: ${JSON.stringify(deadWhy)}`);

    // the gap itself: (c) and (d) were the same answer but for session/at. Now they differ, and in reason.
    const differing = Object.keys({ ...absent, ...dead })
      .filter((k) => k !== "session" && k !== "at")
      .filter((k) => JSON.stringify(absent[k]) !== JSON.stringify(dead[k]));
    assert.ok(differing.includes("reason"), `an absent session and a dead server differ in [${differing.join(",")}] — reason is not among them (on 34d9785: NONE, the two were indistinguishable)`);

    // (e) a read is not a poll: no transition row, and the poll state is untouched
    const rows = ledgerRows(T);
    assert.equal(rows.filter((e) => e.type === "fleet.tmux").length, 0, "(e) a per-session read must never ledger fleet.tmux — the daemon's poll owns that row");
    assert.equal(monitor.tmuxStatus(), null, "(e) a snapshot must not publish a poll verdict — tmuxStatus() is fleetFast()'s to set");
    const added = rows.slice(rowsBefore).map((e) => `${e.type}:${e.data?.to ?? ""}`);
    assert.deepEqual(added, ["session.state:GONE"], `(e) the dead-server read added ${JSON.stringify(added)} — only the GONE transition snapshot() has always emitted for a session it had seen`);
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});

test("watch on a socket with no tmux server exits 2 AND says the server is unreachable; an absent session on a live server exits 2 with no such line", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-gonerw-")));
  const S = socket();
  const env = { TMUX_AGENT_HOME: join(T, "home") };
  const name = `gonerw-${process.pid}`;
  const UNREACHABLE = new RegExp(`^watch: tmux server UNREACHABLE on ${S} — (.+)$`, "m");
  try {
    assert.ok(serverAbsent(S), `the throwaway socket ${S} already has a server`);

    // (f1) no server: the supervising script's "restart it" case must not look like one dead session
    const nosrv = await cli(["--socket", S, "watch", name], env);
    assert.equal(nosrv.code, 2, `(f1) watch on a socket with no server exited ${nosrv.code}, want 2 (VERSIONING item 1, unchanged): ${nosrv.stderr.slice(0, 300)}`);
    const snap = JSON.parse(nosrv.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}");
    assert.equal(snap.state, "GONE", `(f1) watch printed ${JSON.stringify(snap.state)}`);
    const why = reasonOf(snap, "(f1) watch JSON");
    assert.ok(typeof why === "string" && why.includes(S), `(f1) the JSON carries no reason naming the socket: ${JSON.stringify(why)}`);
    const line = nosrv.stderr.match(UNREACHABLE);
    assert.ok(line, `(f1) stderr lacks the UNREACHABLE line naming the socket: ${JSON.stringify(nosrv.stderr)} (on 34d9785 watch's whole output said neither "server" nor "tmux")`);
    assert.equal(line[1], why, "(f1) the line's words are the JSON's words");

    // (f2) a live server, an absent name: one session died — NOT the server
    execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", `${name}-live`, "-c", "/tmp"], { stdio: "ignore" });
    const gone = await cli(["--socket", S, "watch", name], env);
    assert.equal(gone.code, 2, `(f2) watch on an absent session exited ${gone.code}, want 2: ${gone.stderr.slice(0, 300)}`);
    const goneSnap = JSON.parse(gone.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}");
    assert.equal(reasonOf(goneSnap, "(f2) watch JSON"), null, `(f2) the server answered — the JSON must carry no reason: ${JSON.stringify(goneSnap.reason)}`);
    assert.ok(!UNREACHABLE.test(gone.stderr), `(f2) a live server was called unreachable: ${JSON.stringify(gone.stderr)}`);
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
