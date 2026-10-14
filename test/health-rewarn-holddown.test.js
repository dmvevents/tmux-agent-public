/**
 * A rule that has just recovered is not re-warned inside its hold-down — the H3 transition machinery gains
 * one piece of hysteresis, per rule, after a `health.recovered`.
 *
 * Measured 2026-10-13 on the fleet host by the review (C7): 12 `health.warning` / `health.recovered` rows for the
 * `swap` rule between 03:56Z and 04:11Z, the host hovering at the 50 % threshold — a crossing every tick, each pair a
 * notify's worth of ledger. `HealthWatcher.apply()` filed on every transition with no hysteresis: the two hard rules it
 * keeps (events on STATE TRANSITIONS only; recovery is an event) are right and are kept here — a steady breach is still
 * one event, a recovery still closes a warning — but a value that oscillates across one threshold IS a sequence of
 * transitions, and the ledger's rule 1 ("event spam trains operators to ignore the ledger") was being broken by the
 * letter of rule 1.
 *
 * The hold-down: after `health.recovered` for a rule, a new WARNING for that rule inside `rewarnHoldDownMinutes` is not
 * filed and not notified; the breach is still what is true now (`current` carries it, the banner shows it) and nothing
 * is announced, so the quiet re-breach leaves no un-closed warning behind either. A CRITICAL is never held — it is
 * filed from `ok` (nothing was announced in between) and notified. The window is per rule and is measured from the
 * recovery; once it has elapsed a breach warns again. `0` disables it (the parent's behaviour). The default is 10
 * minutes, in `health.json`'s thresholds like every other knob, documented in docs/HEALTH-CRASH-OBSERVABILITY.md.
 *
 * `apply()` is driven directly with a fake clock (the production tick calls apply(), not observe()). Each check FAILS if
 * the property is removed (RED on 91d9233 quoted in the messages):
 *   (1) the C7 series — swap crosses the threshold on every 30 s tick for 12 ticks (6 breaches, 6 clears) under the
 *       default hold-down: exactly [health.warning, health.recovered] — RED: 12 events;
 *   (2) the window: a breach after the hold-down has elapsed is a second warning, its clear a second recovery;
 *   (3) a crit inside the hold-down is filed (from "ok") and notified — safety is never muted;
 *   (4) per rule: another rule's first warning inside swap's hold-down is filed;
 *   (5) hold-down 0 disables it: the series yields 12 events — the opt-out, and the parent's behaviour as a control;
 *   (6) `current` carries the suppressed breach while the ledger stays quiet — the live view is what is true now;
 *   (7) the knob: `DEFAULT_THRESHOLDS.rewarnHoldDownMinutes` is 10, `loadThresholds` takes an override from
 *       health.json, `observe()` passes the thresholds' value through, and docs/HEALTH-CRASH-OBSERVABILITY.md names the
 *       key and its default.
 *
 * Run: npm run build && node --test test/health-rewarn-holddown.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HealthWatcher, DEFAULT_THRESHOLDS, loadThresholds } from "../dist/core/healthwatch.js";
import { ROOT } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const TICK = 30_000;
const HOLD = 10 * 60_000;
const T0 = Date.parse("2026-10-13T03:56:00Z");
class FakeLedger {
  events = [];
  emit(e) {
    this.events.push(e);
    return e;
  }
}
const swapWarn = { rule: "swap", sev: "warn", value: "51% used", detail: "swap in use (51%)" };
const swapCrit = { rule: "swap", sev: "crit", value: "95% used", detail: "swap in use (95%)" };
const memWarn = { rule: "mem", sev: "warn", value: "8.0% available", detail: "host memory low" };
const types = (ledger) => ledger.events.map((e) => e.type);
/** The C7 series: the breach set alternates between [swap warn] and [] on every tick, for `ticks` ticks from T0. */
function drive(w, ticks, holdDownMs, extra = () => []) {
  for (let i = 0; i < ticks; i++) w.apply([...(i % 2 === 0 ? [swapWarn] : []), ...extra(i)], { holdDownMs, now: T0 + i * TICK });
}

test("(1) the C7 series under the default hold-down: one warning, one recovered, no re-warn inside it", () => {
  const ledger = new FakeLedger();
  const notes = [];
  const w = new HealthWatcher(ledger, (t, b) => notes.push([t, b]));
  drive(w, 12, HOLD);
  assert.deepEqual(
    types(ledger),
    ["health.warning", "health.recovered"],
    `a value crossing the threshold on every tick filed ${ledger.events.length} events — on 91d9233 every transition was an event: ${JSON.stringify(types(ledger))}`,
  );
  assert.equal(ledger.events[0].data.rule, "swap");
  assert.equal(ledger.events[1].data.rule, "swap");
  assert.deepEqual(notes, [], "a warning never notifies — and a held one must not either");
});

test("(2) the window: a breach after the hold-down has elapsed is a second warning; its clear a second recovery", () => {
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  drive(w, 12, HOLD); // ends at T0 + 11 ticks (5.5 min): [warning, recovered]
  // the recovery was filed at tick 1 (T0 + 30 s); inside its window a breach stays quiet…
  w.apply([swapWarn], { holdDownMs: HOLD, now: T0 + TICK + HOLD - 1 });
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered"], "a breach one millisecond inside the window was filed");
  w.apply([], { holdDownMs: HOLD, now: T0 + TICK + HOLD });
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered"], "the clear of a held breach filed a recovery nothing had announced");
  // …and once the window has elapsed, the next breach is a warning again, from ok
  w.apply([swapWarn], { holdDownMs: HOLD, now: T0 + TICK + HOLD + TICK });
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered", "health.warning"], "a breach after the window did not warn — the hold-down must be a window, not a mute");
  assert.equal(ledger.events[2].data.from, "ok", `the re-warn after the window escalates from ok (nothing was announced in between), got ${ledger.events[2].data.from}`);
  w.apply([], { holdDownMs: HOLD, now: T0 + TICK + HOLD + 2 * TICK });
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered", "health.warning", "health.recovered"]);
});

test("(3) a crit inside the hold-down is filed from ok and notified — safety is never held", () => {
  const ledger = new FakeLedger();
  const notes = [];
  const w = new HealthWatcher(ledger, (t, b) => notes.push([t, b]));
  w.apply([swapWarn], { holdDownMs: HOLD, now: T0 });
  w.apply([], { holdDownMs: HOLD, now: T0 + TICK }); // recovered → the window opens
  w.apply([swapWarn], { holdDownMs: HOLD, now: T0 + 2 * TICK }); // held
  w.apply([swapCrit], { holdDownMs: HOLD, now: T0 + 3 * TICK }); // NOT held
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered", "health.critical"], `want warning, recovered, then the critical alone (the held warning files nothing): ${JSON.stringify(types(ledger))}`);
  assert.equal(ledger.events[2].data.from, "ok", `the crit escalates from ok — the held warning was never announced — got ${ledger.events[2].data.from}`);
  assert.equal(notes.length, 1, `the crit did not notify (${notes.length} notifications)`);
  assert.match(notes[0][0], /CRITICAL: swap/);
  w.apply([], { holdDownMs: HOLD, now: T0 + 4 * TICK });
  assert.equal(types(ledger).at(-1), "health.recovered", "the crit's clear is a recovery");
  assert.equal(ledger.events.at(-1).data.from, "crit");
  assert.equal(notes.length, 2, "a crit recovery notifies, as it always did");
});

test("(4) the hold-down is per rule: another rule's first warning inside swap's window is filed", () => {
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  drive(w, 4, HOLD, (i) => (i === 3 ? [memWarn] : [])); // tick 3: swap clear (held window), mem's first breach
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered", "health.warning"], `want swap's warning and recovery, then mem's warning alone (swap's held re-breach files nothing): ${JSON.stringify(types(ledger))}`);
  assert.equal(ledger.events[2].data.rule, "mem", `the third event is not mem's warning: ${JSON.stringify(ledger.events[2].data)}`);
});

test("(5) hold-down 0 disables it — the C7 series yields its 12 events, the parent's behaviour as the opt-out", () => {
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  drive(w, 12, 0);
  assert.equal(ledger.events.length, 12, `with the hold-down off every transition is an event, got ${ledger.events.length}`);
  assert.deepEqual([...new Set(types(ledger))].sort(), ["health.recovered", "health.warning"]);
});

test("(6) `current` carries a held breach — the live view says what is true now while the ledger stays quiet", () => {
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  w.apply([swapWarn], { holdDownMs: HOLD, now: T0 });
  w.apply([], { holdDownMs: HOLD, now: T0 + TICK });
  const held = w.apply([swapWarn], { holdDownMs: HOLD, now: T0 + 2 * TICK });
  assert.deepEqual(w.current.map((a) => a.rule), ["swap"], "a held breach vanished from `current` — the banner would read calm over a breached host");
  assert.deepEqual(held.map((a) => a.rule), ["swap"], "apply() returns the breach set it was given");
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered"], "the held breach reached the ledger");
});

test("(7) the knob: default 10 minutes, overridable in health.json, passed through by observe(), named in the design doc", () => {
  assert.equal(DEFAULT_THRESHOLDS.rewarnHoldDownMinutes, 10, `the default hold-down is ${DEFAULT_THRESHOLDS.rewarnHoldDownMinutes}, want 10 — on 91d9233 the key did not exist`);
  const home = tempHome("ta-hold-");
  writeFileSync(join(home, "health.json"), JSON.stringify({ thresholds: { rewarnHoldDownMinutes: 3 } }));
  assert.equal(loadThresholds(home).rewarnHoldDownMinutes, 3, "health.json cannot set the hold-down");
  assert.equal(loadThresholds(tempHome("ta-hold-none-")).rewarnHoldDownMinutes, 10, "an absent file keeps the default");
  // observe() carries the thresholds' hold-down into apply(): the C7 series through observe() with swap at 51 % / 0 %
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  const G = 1e9;
  const vitals = (swapUsedPct) => ({
    sampledAt: new Date().toISOString(),
    mode: "proc",
    mem: { totalBytes: 100 * G, availableBytes: 50 * G },
    swap: { totalBytes: 8 * G, freeBytes: 8 * G * (1 - swapUsedPct / 100) },
    load: [1, 1, 1],
    uptimeSec: 1000,
    disk: [{ path: "/", totalBytes: 1000 * G, freeBytes: 500 * G }],
  });
  for (let i = 0; i < 12; i++) w.observe(vitals(i % 2 === 0 ? 51 : 0), [], DEFAULT_THRESHOLDS, null, null, null, T0 + i * TICK);
  assert.deepEqual(types(ledger), ["health.warning", "health.recovered"], `observe() does not apply the thresholds' hold-down: ${JSON.stringify(types(ledger))}`);
  const doc = readFileSync(join(ROOT, "docs", "HEALTH-CRASH-OBSERVABILITY.md"), "utf8");
  assert.match(doc, /rewarnHoldDownMinutes/, "docs/HEALTH-CRASH-OBSERVABILITY.md does not name the hold-down key");
  assert.match(doc, /Added 2026-10-13/, "docs/HEALTH-CRASH-OBSERVABILITY.md does not record when the hold-down was added");
});
