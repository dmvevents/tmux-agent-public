/**
 * The CPU verdict needs a SUSTAINED change, not one 30 s sample (TMUX-89, gates G3/KR4).
 *
 * Measured on this host's own ledger (2026-09-10, 22 sessions unattended since 2026-08-26):
 * 30,964 events, every one `session.state via:"cpu"`, 93.1 % of them A→B→A within 120 s at the
 * 30 s health tick. The idle heartbeat of the CLIs we run reads 0.90 jiffies/s one window and 0.37
 * the next (the p50s at flip time) and the old single-sample compare against 0.75 flipped on 83 %
 * of ticks — `waste` ranked the fleet by flap count and `/api/timeline` drew 30-second stripes.
 * Figures and the reproducible measurement: scratch/ga-fire-2026-09-11b/ (see its README).
 *
 * These tests script the tracker's samples (the `sample` seam on ActivityTracker — timestamps and
 * cumulative jiffies both scripted, so nothing here sleeps or reads /proc) and drive two levels:
 * the tracker's `busy` verdict directly, and `Monitor.fleetFast` with a fake Tmux + recording
 * Ledger exactly as test/fleet-tmux-down.test.js does, so the ledger event count is the thing
 * asserted. The contract:
 *   1. The production signature is silenced: 40 windows alternating 0.90 / 0.37 → at most ONE
 *      `session.state` after the baseline pass (the initial verdict), and zero verdict flips.
 *   2. Responsiveness survives (the check that fails if hysteresis is over-done): a sustained
 *      change 0.3 → 20.0 or 20.0 → 0.3 is reported within 2 samples (≤ 60 s) with exactly one event.
 *   3. `cpuPerSec` on every snapshot is that window's RAW rate — only the verdict is smoothed.
 *   4. No fake certainty: the first pass is UNKNOWN and not ledgered; a pid that disappears between
 *      samples reads null, not IDLE, and a process reusing its number inherits no verdict.
 *   5. The hold band cannot pin a session at WORKING: after real work, the idle heartbeat
 *      (0.37 / 0.90 / 0.37 …) still reaches IDLE, and exactly once.
 *
 * FAIL-first (output on TMUX-89): against HEAD's dist the tracker has no `sample` seam, so the
 * "samples drawn from the scripted source" guard goes red (a test that silently read the real
 * /proc would prove nothing — vacuity is a failure here, never a pass). With the seam added and
 * the verdict logic left as on HEAD, test 1 goes red with 39 events and 39 flips.
 *
 * Run: node --test test/activity-hysteresis.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityTracker } from "../dist/core/activity.js";
import { Monitor } from "../dist/core/monitor.js";

const PID = 4242;
const TICK_MS = 30_000; // the dashboard's health tick (src/web/server.ts) — the cadence that aliased

/**
 * A scripted /proc: call 0 is the baseline; call k (k ≥ 1) advances the clock one tick and adds
 * rates[k-1] × 30 jiffies, so the tracker's per-window rate is exactly rates[k-1]. A rate of
 * `null` makes the pid vanish for that call (no entry — the shape sampleCpu produces for an
 * exited process). `calls` proves the tracker actually drew from here.
 */
function scripted(rates, pid = PID) {
  let k = 0;
  let jiffies = 1000;
  const t0 = 1_700_000_000_000;
  const fn = () => {
    const at = t0 + k * TICK_MS;
    const byPid = new Map();
    if (k === 0) byPid.set(pid, { jiffies, rssBytes: 50e6 });
    else {
      const r = rates[k - 1];
      if (r !== null) {
        jiffies += r * (TICK_MS / 1000);
        byPid.set(pid, { jiffies, rssBytes: 50e6 });
      }
    }
    k++;
    fn.calls = k;
    return { at, byPid };
  };
  fn.calls = 0;
  return fn;
}

/** Drive the tracker alone: returns the per-window verdicts (after the baseline pass). */
function verdicts(rates) {
  const sample = scripted(rates);
  const t = new ActivityTracker({ sample });
  t.update([PID]); // baseline
  const out = [];
  for (let i = 0; i < rates.length; i++) out.push(t.update([PID]).get(PID));
  assert.equal(sample.calls, rates.length + 1, "samples must be drawn from the scripted source — otherwise this test proves nothing");
  return out;
}

function flips(seq) {
  let n = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i].busy !== null && seq[i - 1].busy !== null && seq[i].busy !== seq[i - 1].busy) n++;
  return n;
}

/** Captures every emitted event, like the real Ledger (mirrors test/fleet-tmux-down.test.js). */
function fakeLedger() {
  const events = [];
  return {
    events,
    emit(ev) {
      const full = { v: 1, ts: new Date().toISOString(), ...ev };
      events.push(full);
      return full;
    },
    states() {
      return events.filter((e) => e.type === "session.state");
    },
  };
}

/** One reachable session whose pane belongs to PID — the only shape fleetFast reads. */
function fakeTmux(name = "s1") {
  return {
    async listFleetReachable() {
      return {
        reachable: true,
        error: null,
        sessions: [{ name, parent: null, owner: null, task: null, created: 0, activity: 0, attached: false, windows: 1 }],
        panes: new Map([[name, { pid: PID, currentCmd: "node", cwd: "/tmp", dead: false }]]),
      };
    },
  };
}

/** Drive fleetFast once per sample (baseline + one per rate); returns snapshots and the ledger. */
async function drive(rates) {
  const home = mkdtempSync(join(tmpdir(), "ta-hyst-"));
  try {
    const led = fakeLedger();
    const sample = scripted(rates);
    const m = new Monitor(fakeTmux(), led, home);
    m.activity = new ActivityTracker({ sample });
    const snaps = [];
    const counts = []; // session.state events ledgered so far, after each poll — lets a test bound one PHASE
    for (let i = 0; i <= rates.length; i++) {
      snaps.push((await m.fleetFast()).sessions[0]);
      counts.push(led.states().length);
    }
    assert.equal(sample.calls, rates.length + 1, "fleetFast must draw its samples from the scripted source — otherwise this test proves nothing");
    return { snaps, led, counts };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const PRODUCTION_SIGNATURE = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.9 : 0.37));

test("hysteresis: the measured 0.90/0.37 heartbeat yields at most one session.state across 40 windows (was 39)", async () => {
  const v = verdicts(PRODUCTION_SIGNATURE);
  assert.equal(flips(v), 0, `verdict must not flip on the idle heartbeat; flips=${flips(v)} seq=${v.map((x) => x.busy).join(",")}`);

  const { snaps, led } = await drive(PRODUCTION_SIGNATURE);
  const states = led.states();
  assert.ok(states.length <= 1, `at most one session.state after the baseline pass, got ${states.length}: ${states.map((e) => `${e.data.from}→${e.data.to}`).join(" ")}`);
  const seen = new Set(snaps.slice(1).map((s) => s.state));
  assert.ok(!(seen.has("WORKING") && seen.has("IDLE")), `fleet rows must not alternate WORKING/IDLE on the heartbeat: ${[...seen].join(",")}`);
});

test("hysteresis: cpuPerSec stays the RAW per-window rate — only the verdict is smoothed", async () => {
  const { snaps } = await drive(PRODUCTION_SIGNATURE);
  assert.equal(snaps[0].cpuPerSec, null, "baseline pass has no rate");
  for (let i = 0; i < PRODUCTION_SIGNATURE.length; i++) {
    assert.equal(snaps[i + 1].cpuPerSec, PRODUCTION_SIGNATURE[i], `window ${i + 1} must report its own raw rate`);
  }
});

test("hysteresis: a sustained rise 0.3 → 20.0 is WORKING within 2 samples with exactly one event", async () => {
  const rates = [0.3, 0.3, 0.3, 0.3, 0.3, 20, 20, 20, 20, 20];
  const { snaps, led, counts } = await drive(rates);
  const before = counts[5]; // events ledgered during the idle phase: the initial verdict (null→IDLE) is allowed — one
  assert.ok(before <= 1, `idle phase must produce at most the initial verdict, got ${before}`);
  assert.equal(snaps[5].state, "IDLE", "the idle phase reads IDLE");
  // snaps[6] is the first 20.0 window, snaps[7] the second: WORKING must appear by the second
  assert.equal(snaps[7].state, "WORKING", `WORKING within 2 samples of the change; got ${snaps.slice(6).map((s) => s.state).join(",")}`);
  for (const s of snaps.slice(7)) assert.equal(s.state, "WORKING", "stays WORKING while the load is sustained");
  const transitions = led.states().filter((e) => e.data.to === "WORKING");
  assert.equal(transitions.length, 1, `exactly one →WORKING event, got ${transitions.length}`);
  assert.equal(led.states().length, before + 1, "no other events fired around the change");
});

test("hysteresis: a sustained fall 20.0 → 0.3 is IDLE within 2 samples with exactly one event", async () => {
  const rates = [20, 20, 20, 20, 20, 0.3, 0.3, 0.3, 0.3, 0.3];
  const { snaps, led, counts } = await drive(rates);
  assert.equal(snaps[5].state, "WORKING", "the busy phase reads WORKING");
  const before = counts[5]; // events ledgered during the busy phase: the initial verdict only
  assert.ok(before <= 1, `busy phase must produce at most the initial verdict, got ${before}`);
  assert.equal(snaps[7].state, "IDLE", `IDLE within 2 samples of the change; got ${snaps.slice(6).map((s) => s.state).join(",")}`);
  for (const s of snaps.slice(7)) assert.equal(s.state, "IDLE", "stays IDLE while quiet");
  const transitions = led.states().filter((e) => e.data.to === "IDLE");
  assert.equal(transitions.length, 1, `exactly one →IDLE event, got ${transitions.length}`);
  assert.equal(led.states().length, before + 1, "no other events fired around the change");
});

test("hysteresis: the hold band cannot pin a finished session at WORKING — the heartbeat still reaches IDLE, once", async () => {
  // real work, then the CLI returns to its prompt: 0.37 / 0.90 alternation (the measured heartbeat)
  const rates = [20, 20, 20, 20, 20, ...Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0.37 : 0.9))];
  const { snaps, led, counts } = await drive(rates);
  assert.equal(snaps[5].state, "WORKING");
  assert.ok(counts[5] <= 1, `busy phase must produce at most the initial verdict, got ${counts[5]}`);
  const tail = snaps.slice(6).map((s) => s.state);
  const firstIdle = tail.indexOf("IDLE");
  assert.ok(firstIdle >= 0 && firstIdle < 4, `IDLE must be reached within 4 heartbeat windows; got ${tail.join(",")}`);
  for (const s of tail.slice(firstIdle)) assert.equal(s, "IDLE", `once idle, the heartbeat must not flip it back: ${tail.join(",")}`);
  assert.equal(led.states().filter((e) => e.data.to === "IDLE").length, 1, "exactly one →IDLE event");
  assert.equal(led.states().filter((e) => e.data.from === "IDLE" && e.data.to === "WORKING").length, 0, "no IDLE→WORKING flap after settling");
});

test("hysteresis: no fake certainty — first pass is UNKNOWN and unledgered; a vanished pid reads null and inherits no verdict", async () => {
  const { snaps, led } = await drive([]);
  assert.equal(snaps[0].state, "UNKNOWN", "one sample is a baseline, not a classification");
  assert.equal(led.states().length, 0, "the baseline pass is not a state change");

  // WORKING, then the process disappears for one window, then a reading inside the hold band:
  // a stale WORKING verdict carried across the gap would read WORKING here; a fresh process reads null.
  const v = verdicts([20, 20, null, 0.9]);
  assert.equal(v[1].busy, true, "sustained load reads busy");
  assert.equal(v[2].busy, null, "a pid absent from the sample has no verdict (null, not IDLE)");
  assert.equal(v[2].jiffiesPerSec, null, "no delta to measure while absent");
  assert.equal(v[3].busy, null, "a process reusing the pid starts from UNKNOWN — no verdict is inherited across the gap");
});
