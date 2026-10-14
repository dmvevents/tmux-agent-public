/**
 * Two arms of `/api/fleet` that no process in the suite owned, driven on purpose in ONE process.
 *
 * dist/web/server.js's branches column read 70.09 / 69.49 / 69.30 / 68.70 across coverage reads of one tree with its
 * uncovered-line set byte-identical — 82/117, 82/118, 79/114 and 79/115 branches (scratch/ga-fire-2026-10-01-18Z/
 * v8diff-1-3-server.log, v8shapes-{1,3}-get.log, v8fragile-3-server.log; the 70.09/69.49 pair attributed by the 253rd fire,
 * scratch/ga-fire-2026-10-01-14Z/v8diff-1-2-server.log). Two mechanisms, neither a case:
 *   1. The `: ""` arm of the tmux.unreachable alert's detail (src/web/server.ts:419, `f.tmux.error ? ` (${…})` : ""`) was
 *      covered by NO process: the real Tmux always hands an unreachable poll a non-empty error (`e.stderr || e.message ||
 *      "tmux unreachable"`, src/core/tmux.ts listFleetReachable), so every dashboard child that rendered the alert took
 *      the truthy arm, and the arm was a zero range in those children and elided in the ones whose tmux stayed up. Node's
 *      coverage merge keeps a zero range only through an unbroken chain of exact-offset or containment matches in dump
 *      directory order — the ±1 on the branch total (117 ↔ 118).
 *   2. The single-flight cache's `get` closure (src/web/server.ts singleFlight: a TTL hit, an in-flight join, a fresh
 *      computation) ran ten times in the dashboard child test/fleet-tmux-down.test.js starts with a 1 s health tick, and
 *      how those ten split between the three arms depended on the race between the tick, the 2 s TTL and the test's own
 *      requests (5/2/3 in one read, 4/3/3 in the next). V8 coalesces adjacent blocks whose counts are equal, so the
 *      REPORTED range boundaries changed with the split — three ranges present in one read's merge and absent from the
 *      next's (the ±3 on both columns, 82/117 ↔ 79/114), and `return inflight;` left to the merge-order lottery whenever
 *      no process covered it on its own.
 * A covered range survives the merge in every order, so one process that takes each arm with the counts that produce every
 * boundary the suite has reported pins the row: here 14 calls to `get` split 7 hits / 3 joins / 4 fresh — hits equal to
 * non-hits (so the hit-return and its continuation coalesce as the driver's did) and joins unequal to fresh (so the join
 * and the fresh computation stay apart) — and the alert is rendered with a truthy AND a null error.
 *
 * In-process: startWeb() takes its Monitor and Tmux as parameters, so a scripted fake Monitor whose poll takes 200 ms (a
 * second request issued alongside a fresh one lands inside that window and JOINS — the real Monitor's tmux execs are what
 * made joins possible in the driver) serves `{ reachable, since, error }` exactly as TmuxStatus admits it (error is
 * `string | null`), and the fake Tmux lists nothing. The health tick is set to 600 s so only its startup run calls the cache;
 * the dashboard's own files (ledger, blackbox, web-token) land in a throwaway home.
 *   (a) reachable: a fresh poll and a concurrent joiner, then two hits, all served from one computation — no
 *       tmux.unreachable alert;
 *   (b) unreachable with tmux's words: the flip is seen only once the TTL has expired (a hit inside it still serves the
 *       reachable value — the seventh hit), then fresh + join + two hits carry the synthesised crit alert with ` (<error>)`
 *       in its detail;
 *   (c) unreachable with a null error: fresh + join + two hits, the detail ends at the timestamp — not `(null)`;
 *   and exactly four fresh computations polled the Monitor (plus the one priming poll): every other request was a hit or a join.
 * FAIL-first (scratch/ga-fire-2026-10-01-18Z/red/): a dist copy whose detail always appends ` (${f.tmux.error})` renders
 * `(null)` in (c) and is red; a copy whose cache TTL is 0 serves no hit, so the Monitor is polled 14 times and the count
 * assert is red; the unmutated copy is green.
 *
 * Run: node --test test/web-fleet-arms.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Ledger } from "../dist/core/ledger.js";
import { Policy } from "../dist/core/policy.js";
import { startWeb, findFreePort } from "../dist/web/server.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes()); // the one home this file makes

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SINCE = "2026-10-01T18:00:00.000Z"; // a fixed transition time, so the detail text is asserted whole
const WORDS = "no server running on /tmp/tmux-1000/ta-191"; // tmux's words, as listFleetReachable would hand them on
const POLL_MS = 200; // the fake poll's duration — the window a concurrent request must land in to join
const TTL_MS = 2000; // fleet()'s singleFlight TTL (src/web/server.ts) — a request inside it is a hit, outside it a fresh computation

/**
 * A Monitor that answers fleetFast() with whatever `verdict` holds at the time of the poll, after POLL_MS, and counts its polls.
 * tmuxStatus() is /api/health's — not requested here.
 */
function fakeMonitor() {
  return {
    verdict: { reachable: true, since: SINCE, error: null },
    polls: 0,
    async fleetFast() {
      this.polls++;
      await pause(POLL_MS);
      return { sessions: [], tmux: { ...this.verdict } };
    },
    tmuxStatus() { return null; },
  };
}
/** The two listings the fleet view reads around the poll — an empty server. */
const fakeTmux = { async listSessionsDetailed() { return []; }, async listSessions() { return []; } };

test("/api/fleet: the cache's three arms and the unreachable alert's two detail arms, all taken in one process", async () => {
  const home = tempHome("ta-web-arms-");
  const monitor = fakeMonitor();
  const port = await findFreePort(17391, "127.0.0.1");
  // the server reads orch.home on this path (ledger + mailbox dirs, thresholds, black box, host vitals); orch.sendVerified is
  // POST /api/send's, not requested here
  const server = startWeb({ home }, monitor, fakeTmux, new Ledger(`${home}/ledger`), new Policy(), { port, host: "127.0.0.1", token: "t-191", healthTickMs: 600_000 });
  const get = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/fleet?token=t-191`);
    assert.equal(r.status, 200, `/api/fleet → ${r.status}`);
    return r.json();
  };
  const unreachableAlert = (body, detail) => {
    assert.equal(body.tmux.reachable, false);
    assert.equal(body.alerts.filter((a) => a.kind === "tmux.unreachable").length, 1, `one synthesised alert, got ${JSON.stringify(body.alerts)}`);
    assert.deepEqual(body.alerts[0], { rule: "tmux", kind: "tmux.unreachable", sev: "crit", since: SINCE, value: "unreachable", detail }, "the alert is prepended, whole");
  };
  try {
    await once(server, "listening");
    // the startup health tick computed the fleet once: the priming poll, then the real one — wait for both, then for the TTL
    const t0 = Date.now();
    while (monitor.polls < 2) { assert.ok(Date.now() - t0 < 10_000, `startup tick never polled twice (polls=${monitor.polls})`); await pause(50); }
    await pause(TTL_MS + 300);

    // (a) reachable — fresh + join, then two hits
    const [a1, a2] = await Promise.all([get(), get()]);
    for (const b of [a1, a2, await get(), await get()]) {
      assert.equal(b.tmux.reachable, true);
      assert.equal(b.tmux.since, SINCE);
      assert.ok(b.alerts.every((a) => a.kind !== "tmux.unreachable"), `no tmux.unreachable while reachable: ${JSON.stringify(b.alerts)}`);
    }
    assert.equal(monitor.polls, 3, "(a): one fresh computation polled; the joiner and the hits did not");

    // (b) the server died with tmux's words — a hit inside the TTL still serves (a)'s value; after it, fresh + join + two hits
    monitor.verdict = { reachable: false, since: SINCE, error: WORDS };
    assert.equal((await get()).tmux.reachable, true, "inside the TTL the cached verdict is served — the flip waits for the TTL, by design");
    await pause(TTL_MS + 300);
    const [b1, b2] = await Promise.all([get(), get()]);
    for (const b of [b1, b2, await get(), await get()]) unreachableAlert(b, `tmux server unreachable since ${SINCE} (${WORDS})`);
    assert.equal(monitor.polls, 4, "(b): one fresh computation polled");

    // (c) unreachable with NO error — the detail ends at the timestamp, never `(null)`
    monitor.verdict = { reachable: false, since: SINCE, error: null };
    await pause(TTL_MS + 300);
    const [c1, c2] = await Promise.all([get(), get()]);
    for (const b of [c1, c2, await get(), await get()]) unreachableAlert(b, `tmux server unreachable since ${SINCE}`);
    assert.equal(monitor.polls, 5, "(c): one fresh computation polled — 14 cache calls in all: 4 fresh (one the tick's), 3 joins, 7 hits");
  } finally {
    server.closeAllConnections(); // keep-alive sockets would hold close() open
    await new Promise((r) => server.close(r));
  }
});
