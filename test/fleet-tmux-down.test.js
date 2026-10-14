/**
 * tmux-server death is observable from the fleet poll (TMUX-87, gate G3 "failure modes observable").
 *
 * The one failure a tmux layer must surface is the tmux server dying under it. Measured on HEAD
 * 9cd786c (eleventh fire): after `tmux kill-server`, `/api/fleet` returned `sessions: []`,
 * `alerts: []`, no ledger event and no `GONE` — byte-for-byte what a healthy fleet with zero
 * sessions returns. `Monitor.fleetFast` (src/core/monitor.ts) listed sessions and emitted
 * `session.state` only for sessions it could see; the `GONE` transition lived only in the
 * per-session `snapshot()` path the dashboard poll never takes. An unreachable server and an
 * empty server were the same `[]`.
 *
 * These are UNIT tests of the fleet-poll transition machine, driven by a fake `Tmux` whose
 * `listFleetReachable()` reports reachability the way the real one does — from whether the tmux
 * listing threw (socket gone), NEVER by string-matching pane text. A fake `Ledger` captures the
 * emitted events. The contract:
 *   1. `fleetFast()` returns `{ sessions, tmux: { reachable, since, error } }`.
 *   2. On the reachable→unreachable transition: exactly one `fleet.tmux {to:"unreachable"}` and
 *      exactly one `session.state {to:"GONE"}` per session seen in the last reachable poll.
 *   3. A second failing poll emits NOTHING new (events fire on transitions, never per poll).
 *   4. On recovery: exactly one `fleet.tmux {to:"reachable"}`.
 *   5. The optional `onTmuxTransition` hook (how the dashboard reuses its notify sink) fires
 *      exactly once per transition, never per poll.
 *   6. `tmuxStatus()` hands the LAST poll's verdict to a caller that does not poll, without a tmux
 *      exec: null before the first poll; then `{ reachable, since, error, checkedAt }` —
 *      reachable/since/error exactly what that poll returned, checkedAt the time of the poll itself,
 *      advancing on a poll that changes nothing (a dead tick is told from a live one by that clock).
 *   7. The BUILT server serves that object as /api/health.tmux, kept fresh by its own health tick:
 *      reachable:true with the same `since` /api/fleet.tmux carries; after `tmux kill-server`, with
 *      NOTHING requesting /api/fleet, /api/health.tmux flips to reachable:false within a few ticks.
 *      Measured 2026-09-16 on 854c572: the tick had ledgered fleet.tmux and paged within 3 s while
 *      /api/health — the documented monitoring integration point — served eleven keys and no tmux.
 *
 * FAIL-first on HEAD (before the src change): `fleetFast()` resolves to an ARRAY, so
 * `result.tmux` is `undefined` and the reachability assert throws; and zero `GONE` events are
 * emitted on the kill — red on both counts. Output on TMUX-87.
 * FAIL-first for 6–7 on the parent 1da4d6c dist: `Monitor has no tmuxStatus()`; `/api/health has no
 * tmux key`. Output on TMUX-115.
 *   8. `fleetReport()` is the listing the two CONSUMER surfaces read (status.json, MCP fleet-status;
 *      TMUX-116): the per-session snapshots plus the SAME verdict shape, built on listFleetReachable()
 *      — reachable:false with tmux's words when the listing threw. It never ledgers: no fleet.tmux, no
 *      GONE, and it does not move the poll state tmuxStatus() reports. `since` is the Monitor's
 *      transition time when it has observed the current state (the daemon), else `checkedAt` — a
 *      one-shot process invents no history.
 * FAIL-first for 8 on the parent 1d863d7 dist: `Monitor has no fleetReport()`. Output on TMUX-116.
 *
 * Run: node --test test/fleet-tmux-down.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Monitor } from "../dist/core/monitor.js";
// the built dashboard on a throwaway home, shared with test/build-stamp.test.js and test/doctor-dashboard.test.js
import { ROOT, startWeb, stopWeb } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Captures every emitted event; returns it, like the real Ledger. */
function fakeLedger() {
  const events = [];
  return {
    events,
    emit(ev) {
      const full = { v: 1, ts: new Date().toISOString(), ...ev };
      events.push(full);
      return full;
    },
    count(type, toValue) {
      return events.filter((e) => e.type === type && (toValue === undefined || e.data?.to === toValue)).length;
    },
  };
}

/**
 * A fake tmux whose reachability is scripted per poll. `listFleetReachable()` is the ONLY method
 * fleetFast calls; a reachable step returns detailed sessions + a pane map, an unreachable step
 * returns `reachable:false` with an error string and empty collections — exactly the shape the
 * real Tmux produces when the `list-sessions` exec throws "no server running".
 */
function fakeTmux(script) {
  let i = 0;
  const detailed = (name) => ({ name, parent: null, owner: null, task: null, created: 0, activity: 0, attached: false, windows: 1 });
  const pane = () => ({ pid: 0, currentCmd: "bash", cwd: "/tmp", dead: false });
  return {
    polls: () => i,
    async listFleetReachable() {
      const step = script[Math.min(i, script.length - 1)];
      i++;
      if (step.reachable) {
        return {
          reachable: true,
          error: null,
          sessions: step.sessions.map(detailed),
          panes: new Map(step.sessions.map((n) => [n, pane()])),
        };
      }
      return { reachable: false, error: step.error ?? "no server running on /tmp/tmux-1000/ta", sessions: [], panes: new Map() };
    },
  };
}

test("fleetFast reports tmux reachability and closes vanished sessions with one GONE each on server death", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-fleet-down-"));
  try {
    const led = fakeLedger();
    const tmux = fakeTmux([
      { reachable: true, sessions: ["alpha", "beta"] }, // poll 1: healthy, two sessions
      { reachable: false, error: "no server running on ta" }, // poll 2: server killed
      { reachable: false }, // poll 3: still down
      { reachable: true, sessions: ["alpha"] }, // poll 4: recovered
    ]);
    const m = new Monitor(tmux, led, home);

    // poll 1 — baseline: reachable, no transition event, no GONE, no fabricated state
    const r1 = await m.fleetFast();
    assert.equal(r1.tmux.reachable, true, "poll 1 must report reachable");
    assert.equal(r1.tmux.error, null, "reachable poll carries no error");
    assert.equal(r1.sessions.length, 2, "poll 1 lists both sessions");
    assert.equal(led.count("fleet.tmux"), 0, "first observation is a baseline, not a transition");
    assert.equal(led.count("session.state", "GONE"), 0, "no GONE while reachable");

    // poll 2 — server died: one fleet.tmux{unreachable}, one GONE per session from poll 1
    const r2 = await m.fleetFast();
    assert.equal(r2.tmux.reachable, false, "poll 2 must report unreachable");
    assert.ok(typeof r2.tmux.error === "string" && r2.tmux.error.length > 0, "unreachable status carries the tmux error");
    assert.equal(r2.sessions.length, 0, "an unreachable server lists no sessions");
    assert.equal(led.count("fleet.tmux", "unreachable"), 1, "exactly one unreachable transition event");
    assert.equal(led.count("session.state", "GONE"), 2, "each session from the last reachable poll gets exactly one GONE");
    const gone = new Set(led.events.filter((e) => e.type === "session.state" && e.data?.to === "GONE").map((e) => e.session));
    assert.deepEqual([...gone].sort(), ["alpha", "beta"], "GONE names the sessions that vanished");

    // poll 3 — still down: transition-only, nothing new
    await m.fleetFast();
    assert.equal(led.count("fleet.tmux", "unreachable"), 1, "a second failing poll must NOT re-emit (transition-only)");
    assert.equal(led.count("session.state", "GONE"), 2, "no duplicate GONE on a repeat unreachable poll");

    // poll 4 — recovered: exactly one reachable transition
    const r4 = await m.fleetFast();
    assert.equal(r4.tmux.reachable, true, "poll 4 must report reachable again");
    assert.equal(led.count("fleet.tmux", "reachable"), 1, "exactly one recovery transition event");
    assert.equal(led.count("fleet.tmux"), 2, "two transitions total across the run (down, up)");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("onTmuxTransition fires exactly once per transition, never per poll (the dashboard notify hook)", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-fleet-down-"));
  try {
    const led = fakeLedger();
    const tmux = fakeTmux([
      { reachable: true, sessions: ["s1"] },
      { reachable: false },
      { reachable: false }, // steady breach — no notify
      { reachable: true, sessions: ["s1"] },
      { reachable: true, sessions: ["s1"] }, // steady healthy — no notify
    ]);
    const m = new Monitor(tmux, led, home);
    const seen = [];
    m.onTmuxTransition = (st) => seen.push(st.reachable);

    for (let p = 0; p < 5; p++) await m.fleetFast();

    assert.deepEqual(seen, [false, true], "hook fires once on the way down and once on the way back up, and not on steady polls");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// 6. the verdict for callers that do not poll — /api/health and, through it, doctor
// ---------------------------------------------------------------------------------------------
test("tmuxStatus() hands the last poll's verdict to a non-polling caller without a tmux exec: null before the first poll, then reachable/since/error as polled plus a checkedAt that advances every poll", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-fleet-down-"));
  try {
    const led = fakeLedger();
    const tmux = fakeTmux([
      { reachable: true, sessions: ["alpha"] }, // poll 1: healthy
      { reachable: false, error: "no server running on /tmp/tmux-1000/ta-115" }, // poll 2: killed
      { reachable: false, error: "no server running on /tmp/tmux-1000/ta-115" }, // poll 3: still down
      { reachable: true, sessions: ["alpha"] }, // poll 4: recovered
    ]);
    const m = new Monitor(tmux, led, home);

    assert.equal(typeof m.tmuxStatus, "function", "Monitor has no tmuxStatus()");
    assert.equal(m.tmuxStatus(), null, "before the first poll there is no verdict — null, never a fabricated reachable");
    assert.equal(tmux.polls(), 0, "asking for the status must not poll tmux");

    const r1 = await m.fleetFast();
    const s1 = m.tmuxStatus();
    assert.ok(s1, "no verdict after poll 1");
    assert.deepEqual(s1, { reachable: true, since: r1.tmux.since, error: null, checkedAt: s1.checkedAt }, "poll 1: the status IS the poll's tmux verdict, plus checkedAt");
    assert.match(s1.checkedAt, ISO);
    assert.ok(Date.now() - Date.parse(s1.checkedAt) < 5000, `checkedAt ${s1.checkedAt} is not the recent poll`);
    assert.equal(tmux.polls(), 1, "reading the status ran no extra poll");

    await pause(5); // distinct millisecond stamps
    const r2 = await m.fleetFast();
    const s2 = m.tmuxStatus();
    assert.equal(s2.reachable, false, "poll 2 (server killed): unreachable");
    assert.equal(s2.error, "no server running on /tmp/tmux-1000/ta-115", "the tmux error rides along");
    assert.equal(s2.since, r2.tmux.since, "since is the transition's, as /api/fleet serves it");
    assert.ok(s2.checkedAt > s1.checkedAt, `checkedAt did not advance: ${s1.checkedAt} → ${s2.checkedAt}`);

    await pause(5);
    await m.fleetFast(); // poll 3: still down — nothing changes but the clock
    const s3 = m.tmuxStatus();
    assert.equal(s3.reachable, false);
    assert.equal(s3.since, s2.since, "a steady poll keeps `since` (no new transition)");
    assert.ok(s3.checkedAt > s2.checkedAt, `a poll that changes nothing must still advance checkedAt (${s2.checkedAt} → ${s3.checkedAt}) — that is how a dead tick is told from a live one`);

    await pause(5);
    const r4 = await m.fleetFast();
    const s4 = m.tmuxStatus();
    assert.deepEqual({ reachable: s4.reachable, since: s4.since, error: s4.error }, r4.tmux, "poll 4 (recovered): the status is the poll's verdict again");
    assert.equal(s4.reachable, true);
    assert.ok(s4.checkedAt > s3.checkedAt, "checkedAt advances on recovery too");
    assert.equal(tmux.polls(), 4, "four polls, none of them from tmuxStatus()");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// 7. the built server: /api/health.tmux, fresh from the daemon's own tick, no /api/fleet poll needed
// ---------------------------------------------------------------------------------------------
test("the built server serves the Monitor's verdict as /api/health.tmux — reachable with /api/fleet's `since`; after kill-server, with nothing polling /api/fleet, its own tick flips it to unreachable", async () => {
  const sock = `ta-built-${process.pid}`; // the socket helpers/built-web.js starts the dashboard on
  const home = mkdtempSync(join(tmpdir(), "ta-fleet-down-web-"));
  let child = null;
  const until = async (fn, ms) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await pause(200);
    }
  };
  try {
    killServerSync(sock); // a server or socket file an earlier run left on this name — a no-op when there is none
    execFileSync("tmux", ["-L", sock, "new-session", "-d", "-s", "ta115-live", "-c", "/tmp"], { stdio: "ignore" });
    const started = await startWeb(ROOT, home, { TMUX_AGENT_HEALTH_TICK_MS: "1000" });
    child = started.child;
    const token = readFileSync(join(home, "web-token"), "utf8").trim(); // never printed
    const get = async (path) => {
      const r = await fetch(`http://127.0.0.1:${started.port}${path}?token=${encodeURIComponent(token)}`);
      assert.equal(r.status, 200, `${path} → ${r.status}`);
      return r.json();
    };

    // healthy: the key is there and it agrees with /api/fleet on the same poll
    const f = await get("/api/fleet");
    assert.equal(f.tmux?.reachable, true, `the fleet poll does not see the session: ${JSON.stringify(f.tmux)}`);
    const h = await get("/api/health");
    assert.ok(h.tmux, `/api/health has no tmux key — keys: ${Object.keys(h).join(",")}`);
    assert.equal(h.tmux.reachable, true);
    assert.equal(h.tmux.error, null);
    assert.equal(h.tmux.since, f.tmux.since, "the same poll's `since` on both surfaces");
    assert.match(h.tmux.checkedAt, ISO);
    assert.ok(Date.now() - Date.parse(h.tmux.checkedAt) < 10_000, `checkedAt ${h.tmux.checkedAt} is stale — the tick is not refreshing it`);

    // kill the server; from here NOTHING requests /api/fleet — the daemon's own 1 s tick must notice
    execFileSync("tmux", ["-L", sock, "kill-server"], { stdio: "ignore" });
    const down = await until(async () => { const t = (await get("/api/health")).tmux; return t && t.reachable === false ? t : null; }, 8000);
    assert.ok(down, "/api/health.tmux did not flip to reachable:false within 8 s of kill-server with nothing polling /api/fleet");
    assert.ok(typeof down.error === "string" && down.error.length > 0, "the unreachable verdict carries the tmux error");
    const later = await until(async () => { const t = (await get("/api/health")).tmux; return t.checkedAt > down.checkedAt ? t : null; }, 5000);
    assert.ok(later, "checkedAt stopped advancing while unreachable — the tick must keep polling");
    assert.equal(later.since, down.since, "a steady unreachable keeps the transition's since");
    const f2 = await get("/api/fleet");
    assert.equal(f2.tmux.reachable, false);
    assert.equal(f2.tmux.since, down.since, "/api/fleet and /api/health name the same transition");
  } finally {
    await stopWeb(child); // killing is a signal, not a state: the daemon is gone before its home is
    killServerSync(sock); // the FIXTURE kill above left a dead server's socket file; this is the teardown that removes it
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// 8. the listing the consumer surfaces read — status.json and MCP fleet-status
// ---------------------------------------------------------------------------------------------
test("fleetReport() carries the listing's own verdict beside the sessions, never ledgers, never moves the poll state; since is the observed transition when there is one, else checkedAt", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-fleet-down-"));
  try {
    const led = fakeLedger();
    // every step lists no sessions so no per-session snapshot() (and its tmux execs) runs — the verdict is the subject
    const tmux = fakeTmux([
      { reachable: false, error: "error connecting to /tmp/tmux-1000/ta-116 (No such file or directory)" }, // 1: report, never started
      { reachable: true, sessions: [] }, // 2: report, a server appeared — still no history to tell
      { reachable: true, sessions: [] }, // 3: fleetFast baseline (the daemon's first poll)
      { reachable: true, sessions: [] }, // 4: report while the poll state is reachable
      { reachable: false, error: "no server running on /tmp/tmux-1000/ta-116" }, // 5: fleetFast — the transition, one fleet.tmux
      { reachable: false, error: "no server running on /tmp/tmux-1000/ta-116" }, // 6: report — same state as observed
      { reachable: true, sessions: [] }, // 7: report — recovered before the poll saw it
    ]);
    const m = new Monitor(tmux, led, home);
    assert.equal(typeof m.fleetReport, "function", "Monitor has no fleetReport()");

    // 1 — a one-shot process on a socket no server ever ran on: the verdict, tmux's words, no history, no rows
    const r1 = await m.fleetReport();
    assert.deepEqual(Object.keys(r1).sort(), ["sessions", "tmux"], "the report is { sessions, tmux }");
    assert.deepEqual(r1.sessions, [], "an unreachable server lists no sessions");
    assert.deepEqual(Object.keys(r1.tmux).sort(), ["checkedAt", "error", "reachable", "since"], "the verdict has the /api/health shape");
    assert.equal(r1.tmux.reachable, false);
    assert.equal(r1.tmux.error, "error connecting to /tmp/tmux-1000/ta-116 (No such file or directory)", "tmux's own words ride the verdict");
    assert.match(r1.tmux.checkedAt, ISO);
    assert.equal(r1.tmux.since, r1.tmux.checkedAt, "no transition observed — since is the check itself, never an invented history");
    assert.equal(led.count("fleet.tmux"), 0, "a report never ledgers fleet.tmux");
    assert.equal(m.tmuxStatus(), null, "a report is not a poll — tmuxStatus() still has no verdict");

    // 2 — a server appeared between two reports: still no ledger row, still no history
    await pause(5);
    const r2 = await m.fleetReport();
    assert.equal(r2.tmux.reachable, true);
    assert.equal(r2.tmux.error, null, "a reachable verdict carries no error");
    assert.equal(r2.tmux.since, r2.tmux.checkedAt, "a report that flips has observed no transition of its own");
    assert.equal(led.count("fleet.tmux"), 0, "a flip between two reports is not a ledgered transition — the daemon's poll owns that row");
    assert.equal(led.events.length, 0, "a report writes no rows at all");

    // 3–4 — the daemon: a poll has observed the state; a report in the same state carries the poll's since
    await pause(5);
    const p3 = await m.fleetFast();
    await pause(5);
    const r4 = await m.fleetReport();
    assert.equal(r4.tmux.reachable, true);
    assert.equal(r4.tmux.since, p3.tmux.since, "the report carries the Monitor's own transition time when it has one");
    assert.ok(r4.tmux.checkedAt > r4.tmux.since, `checkedAt ${r4.tmux.checkedAt} is the report's clock, since ${r4.tmux.since} the poll's`);
    assert.deepEqual(m.tmuxStatus(), { ...p3.tmux, checkedAt: m.tmuxStatus().checkedAt }, "the report did not move the poll's verdict");
    assert.ok(m.tmuxStatus().checkedAt < r4.tmux.checkedAt, "the report did not advance the poll's checkedAt");

    // 5–6 — the poll sees the death (one fleet.tmux); a report agrees and names the same transition
    await pause(5);
    const p5 = await m.fleetFast();
    assert.equal(led.count("fleet.tmux", "unreachable"), 1, "the poll ledgers the transition, once");
    await pause(5);
    const r6 = await m.fleetReport();
    assert.equal(r6.tmux.reachable, false);
    assert.equal(r6.tmux.error, "no server running on /tmp/tmux-1000/ta-116");
    assert.equal(r6.tmux.since, p5.tmux.since, "the report names the poll's transition");
    assert.equal(led.count("fleet.tmux"), 1, "the report added no transition row");

    // 7 — recovered before the poll noticed: the report tells the truth it sees, with no history and no row
    await pause(5);
    const r7 = await m.fleetReport();
    assert.equal(r7.tmux.reachable, true);
    assert.equal(r7.tmux.since, r7.tmux.checkedAt, "a state the poll has not observed has no transition time — since is the check");
    assert.equal(led.count("fleet.tmux"), 1, "still one transition row: the recovery is the poll's to ledger");
    assert.equal(m.tmuxStatus().reachable, false, "the poll's verdict is untouched by the report — the next fleetFast ledgers the recovery");
    assert.equal(tmux.polls(), 7, "seven listings: five reports and two polls, nothing extra");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
