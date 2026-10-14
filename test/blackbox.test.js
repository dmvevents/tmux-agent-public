/**
 * Crash forensics — H4 of the health epic (TMUX-55, docs/HEALTH-CRASH-OBSERVABILITY.md).
 * The refactor-breakable contracts:
 *   - suspected ONLY when the heartbeat predates the current boot AND no clean-shutdown
 *     marker is at/after it — a server that was merely killed (host stayed up) is NOT a
 *     host crash, and a clean stop before a reboot is NOT a crash;
 *   - the ring is size-capped and survives rotation (tail() reads across generations);
 *   - a torn final line (exactly what a crash produces) is skipped, never a parse throw;
 *   - first run ever (no heartbeat) is silent.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { utimesSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Blackbox } from "../dist/core/blackbox.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const G = 1e9;
const vitals = (availG, ts = new Date().toISOString()) => ({
  sampledAt: ts,
  mode: "proc",
  mem: { totalBytes: 100 * G, availableBytes: availG * G },
  swap: { totalBytes: 8 * G, freeBytes: 8 * G },
  load: [1, 1, 1],
  uptimeSec: 1000,
  disk: [],
});
const rows = [
  { session: "hog", rssBytes: 30 * G },
  { session: "quiet", rssBytes: 1 * G },
  { session: "mac", rssBytes: null },
];

function home() { return tempHome("ta-bb-"); }
after(() => removeTempHomes()); // every home this file made, once its last test has run
/** move a black-box file's mtime into the past (seconds ago) */
function age(h, file, secsAgo) {
  const t = (Date.now() - secsAgo * 1000) / 1000;
  utimesSync(join(h, "health", file), t, t);
}

test("blackbox: record → tail round-trips, top sorted by rss, null rss excluded", () => {
  const bb = new Blackbox(home());
  bb.record(vitals(50), rows);
  bb.record(vitals(49), rows);
  const t = bb.tail(2);
  assert.equal(t.length, 2);
  assert.equal(t[1].mem.availableBytes, 49 * G);
  assert.deepEqual(t[1].top.map((x) => x.session), ["hog", "quiet"], "sorted desc, null rss absent");
});

test("blackbox: first run ever — no heartbeat, not suspected", () => {
  const bb = new Blackbox(home());
  const chk = bb.checkUncleanShutdown(Date.now() - 3600_000);
  assert.equal(chk.suspected, false);
  assert.equal(chk.lastHeartbeatAt, null);
});

test("blackbox: heartbeat predating boot with NO clean marker = suspected, with the last snapshot", () => {
  const h = home();
  const bb = new Blackbox(h);
  bb.record(vitals(12), rows); // the pre-crash world: 12G available, hog on top
  age(h, "heartbeat", 7200); // heartbeat 2h ago...
  const bootMs = Date.now() - 600_000; // ...host booted 10min ago
  const chk = bb.checkUncleanShutdown(bootMs);
  assert.equal(chk.suspected, true);
  assert.equal(chk.lastSnapshot.top[0].session, "hog", "the black box names the top consumer");
  assert.equal(chk.lastSnapshot.mem.availableBytes, 12 * G);
});

test("blackbox: clean shutdown before the reboot = NOT suspected", () => {
  const h = home();
  const bb = new Blackbox(h);
  bb.record(vitals(50), rows);
  bb.markCleanShutdown(); // stop we chose, AFTER the last heartbeat
  age(h, "heartbeat", 7200);
  age(h, "clean-shutdown", 7100); // marker newer than heartbeat
  const chk = bb.checkUncleanShutdown(Date.now() - 600_000);
  assert.equal(chk.suspected, false, "a clean stop is not a crash");
});

test("blackbox: heartbeat NEWER than boot (server killed, host stayed up) = NOT suspected", () => {
  const h = home();
  const bb = new Blackbox(h);
  bb.record(vitals(50), rows);
  const chk = bb.checkUncleanShutdown(Date.now() - 3600_000); // booted 1h ago, heartbeat just now
  assert.equal(chk.suspected, false, "kill -9 of the daemon is not a HOST crash");
});

test("blackbox: ring rotates at the cap and tail() reads across generations", () => {
  const h = home();
  const bb = new Blackbox(h, 2048); // tiny cap to force rotation
  for (let i = 0; i < 30; i++) bb.record(vitals(50 - i * 0.5, new Date(Date.now() + i * 1000).toISOString()), rows);
  const t = bb.tail(30);
  assert.ok(t.length >= 10, `expected a healthy tail across generations, got ${t.length}`);
  const live = readFileSync(join(h, "health", "snapshots.ndjson"), "utf8");
  assert.ok(live.length <= 4096, "live ring stays near the cap");
});

test("blackbox: a torn final line (crash mid-append) is skipped, not a throw", () => {
  const h = home();
  const bb = new Blackbox(h);
  bb.record(vitals(50), rows);
  appendFileSync(join(h, "health", "snapshots.ndjson"), '{"ts":"2026-08-26T19:'); // torn
  const t = bb.tail(5);
  assert.equal(t.length, 1, "the intact snapshot survives; the torn line is dropped");
});

test("blackbox: noteCrash persists and lastCrash serves it back", () => {
  const bb = new Blackbox(home());
  assert.equal(bb.lastCrash(), null);
  bb.record(vitals(9), rows);
  const chk = bb.checkUncleanShutdown(Date.now() + 60_000); // force: boot 'after' heartbeat
  assert.equal(chk.suspected, true);
  bb.noteCrash(chk);
  const last = bb.lastCrash();
  assert.equal(last.suspected, true);
  assert.equal(last.lastSnapshot.top[0].session, "hog");
  assert.match(last.detectedAt, /^\d{4}-/);
});
