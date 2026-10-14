/**
 * Health thresholds → events — H3 of the health epic (TMUX-54,
 * docs/HEALTH-CRASH-OBSERVABILITY.md). The refactor-breakable contracts:
 *   - events fire on STATE TRANSITIONS only (a steady breach is ONE event, not one per poll —
 *     spam trains operators to ignore the ledger);
 *   - recovery is an event (`health.recovered`), so a warning always has a closure;
 *   - notify fires only for crit entries and crit recoveries;
 *   - a session with rssBytes null (no /proc) is never judged;
 *   - malformed health.json falls back to defaults loudly instead of crashing the daemon.
 * End-to-end (forced-low thresholds → ledger + notify over a real server) is
 * test/smoke-web.sh step 24.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateHealth, HealthWatcher, DEFAULT_THRESHOLDS, loadThresholds, retentionFromThresholds } from "../dist/core/healthwatch.js";
import { ledgerFootprint } from "../dist/core/ledger-retention.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";
after(() => removeTempHomes()); // every home this file made, once its last test has run

const G = 1e9;
const vitals = (availG, { totalG = 100, swapUsedPct = 0, diskFreeG = 500 } = {}) => ({
  sampledAt: new Date().toISOString(),
  mode: "proc",
  mem: { totalBytes: totalG * G, availableBytes: availG * G },
  swap: { totalBytes: 8 * G, freeBytes: 8 * G * (1 - swapUsedPct / 100) },
  load: [1, 1, 1],
  uptimeSec: 1000,
  disk: [{ path: "/", totalBytes: 1000 * G, freeBytes: diskFreeG * G }],
});

class FakeLedger {
  events = [];
  emit(e) { this.events.push(e); return e; }
}

test("healthwatch: evaluate — each rule trips at its threshold with the right severity", () => {
  // healthy host: nothing
  assert.deepEqual(evaluateHealth(vitals(50), []), []);
  // mem: 8% available = warn, 4% = crit (defaults 10/5)
  assert.deepEqual(evaluateHealth(vitals(8), []).map((a) => [a.rule, a.sev]), [["mem", "warn"]]);
  assert.deepEqual(evaluateHealth(vitals(4), []).map((a) => [a.rule, a.sev]), [["mem", "crit"]]);
  // swap 95% used = crit
  assert.ok(evaluateHealth(vitals(50, { swapUsedPct: 95 }), []).some((a) => a.rule === "swap" && a.sev === "crit"));
  // disk 4GB free = crit (default 5GB)
  assert.ok(evaluateHealth(vitals(50, { diskFreeG: 4 }), []).some((a) => a.rule === "disk:/" && a.sev === "crit"));
  // one session at 30% of RAM = warn, 45% = crit (defaults 25/40); null rss never judged
  const w = evaluateHealth(vitals(50), [{ session: "hog", rssBytes: 30 * G }, { session: "mac", rssBytes: null }]);
  assert.deepEqual(w.map((a) => [a.rule, a.sev, a.session]), [["session:hog", "warn", "hog"]]);
  const c = evaluateHealth(vitals(50), [{ session: "hog", rssBytes: 45 * G }]);
  assert.deepEqual(c.map((a) => [a.rule, a.sev]), [["session:hog", "crit"]]);
});

test("healthwatch: ok→warn→warn→crit→ok emits exactly warning, critical, recovered — in order", () => {
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  w.observe(vitals(50), []); // ok — nothing
  w.observe(vitals(8), []);  // → warn
  w.observe(vitals(8), []);  // steady — NO second event
  w.observe(vitals(4), []);  // → crit
  w.observe(vitals(50), []); // → recovered
  assert.deepEqual(
    ledger.events.map((e) => e.type),
    ["health.warning", "health.critical", "health.recovered"],
    `saw: ${JSON.stringify(ledger.events.map((e) => [e.type, e.data]))}`,
  );
  assert.equal(ledger.events[1].data.from, "warn", "crit event records what it escalated from");
  assert.equal(ledger.events[2].data.from, "crit", "recovery records what it recovered from");
});

test("healthwatch: notify fires only for crit entry and crit recovery, never for warn", () => {
  const calls = [];
  const w = new HealthWatcher(new FakeLedger(), (title, body) => calls.push(title + "|" + body));
  w.observe(vitals(8), []);  // warn — silent
  assert.equal(calls.length, 0);
  w.observe(vitals(4), []);  // crit — notify
  assert.equal(calls.length, 1);
  assert.match(calls[0], /CRITICAL: mem/);
  w.observe(vitals(4), []);  // steady crit — silent
  assert.equal(calls.length, 1);
  w.observe(vitals(50), []); // recovery from crit — notify
  assert.equal(calls.length, 2);
  assert.match(calls[1], /recovered: mem/);
});

test("healthwatch: current always mirrors the latest breach set for /api consumers", () => {
  const w = new HealthWatcher(new FakeLedger());
  w.observe(vitals(4), []);
  assert.equal(w.current.length, 1);
  assert.equal(w.current[0].sev, "crit");
  w.observe(vitals(50), []);
  assert.deepEqual(w.current, []);
});

test("healthwatch: loadThresholds — absent file = defaults; overrides merge; malformed = defaults, not a crash", () => {
  const empty = tempHome("ta-hw-");
  assert.deepEqual(loadThresholds(empty), DEFAULT_THRESHOLDS);

  const withFile = tempHome("ta-hw-");
  writeFileSync(join(withFile, "health.json"), JSON.stringify({ thresholds: { memAvailWarnPct: 20, junk: 9, diskFreeCritBytes: -5 } }));
  const t = loadThresholds(withFile);
  assert.equal(t.memAvailWarnPct, 20, "valid override applied");
  assert.equal(t.diskFreeCritBytes, DEFAULT_THRESHOLDS.diskFreeCritBytes, "negative value rejected");
  assert.equal(t.memAvailCritPct, DEFAULT_THRESHOLDS.memAvailCritPct, "untouched keys stay default");

  const broken = tempHome("ta-hw-");
  writeFileSync(join(broken, "health.json"), "{not json");
  assert.deepEqual(loadThresholds(broken), DEFAULT_THRESHOLDS, "malformed file falls back");
});

// ---------------------------------------------------------------------------------------------
// TMUX-90: the ledger's own footprint is an H3 rule — the tool must notice when IT is the thing
// filling the disk. Measured 2026-09-11: 62.9 MB of ledger in 18 days on this host with no rule,
// no number on /api/health, and rotate.ts guarding only the 8 KB of capture logs.
// ---------------------------------------------------------------------------------------------
test("healthwatch: ledger thresholds ship with the documented defaults and map onto the Ledger's retention", () => {
  assert.equal(DEFAULT_THRESHOLDS.ledgerKeepDays, 30, "archive after 30 days by default");
  assert.equal(DEFAULT_THRESHOLDS.ledgerDeleteAfterDays, 0, "0 = never delete: archive is the bound, deletion is an opt-in");
  assert.equal(DEFAULT_THRESHOLDS.ledgerWarnBytes, 256 * 1024 * 1024, "warn at 256 MiB of live day files");
  assert.deepEqual(retentionFromThresholds({ ...DEFAULT_THRESHOLDS, ledgerKeepDays: 7, ledgerDeleteAfterDays: 90 }), { keepDays: 7, deleteAfterDays: 90 });
  const home = tempHome("ta-hw-");
  writeFileSync(join(home, "health.json"), JSON.stringify({ thresholds: { ledgerKeepDays: 14, ledgerWarnBytes: 1e6 } }));
  const t = loadThresholds(home);
  assert.equal(t.ledgerKeepDays, 14, "health.json overrides the retention like every other threshold");
  assert.equal(t.ledgerWarnBytes, 1e6);
  assert.equal(t.ledgerDeleteAfterDays, 0, "deletion stays off unless asked for");
});

test("healthwatch: ledger rule — over ledgerWarnBytes is exactly one health.warning, steady is silent, removing the files is health.recovered; 0 disables the rule", () => {
  const dir = mkdtempSync(join(tmpdir(), "ta-hw-ledger-"));
  const day = (ago) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
  for (const ago of [1, 2, 3]) writeFileSync(join(dir, `events-${day(ago)}.ndjson`), JSON.stringify({ v: 1, ts: `${day(ago)}T00:00:00Z`, type: "session.state", session: "s", data: { pad: "x".repeat(4000) } }) + "\n");
  const fp = ledgerFootprint(dir);
  assert.ok(fp.bytes > 12_000 && fp.files === 3, `precondition: three planted day files, got ${JSON.stringify(fp)}`);
  const t = { ...DEFAULT_THRESHOLDS, ledgerWarnBytes: 10_000 };

  // pure evaluation: the rule trips on the live footprint, warn-only (the disk rule covers the emergency tier)
  assert.deepEqual(evaluateHealth(vitals(50), [], t, fp).map((a) => [a.rule, a.sev]), [["ledger", "warn"]]);
  assert.match(evaluateHealth(vitals(50), [], t, fp)[0].detail, /ledgerKeepDays/, "the detail names the knob that fixes it");
  assert.deepEqual(evaluateHealth(vitals(50), [], DEFAULT_THRESHOLDS, fp), [], "12 KB is nowhere near the 256 MiB default");
  assert.deepEqual(evaluateHealth(vitals(50), [], { ...t, ledgerWarnBytes: 0 }, fp), [], "ledgerWarnBytes 0 disables the rule, it does not warn on every byte");
  assert.deepEqual(evaluateHealth(vitals(50), [], t), [], "no footprint given (CLI callers) → no judgement");

  // transitions: one warning, silence while steady, recovery once the files are gone
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  w.observe(vitals(50), [], t, ledgerFootprint(dir)); // → warn
  w.observe(vitals(50), [], t, ledgerFootprint(dir)); // steady — NO second event
  assert.deepEqual(ledger.events.map((e) => [e.type, e.data.rule]), [["health.warning", "ledger"]], `saw: ${JSON.stringify(ledger.events)}`);
  rmSync(dir, { recursive: true, force: true });
  w.observe(vitals(50), [], t, ledgerFootprint(dir)); // files removed → recovered
  assert.deepEqual(ledger.events.map((e) => e.type), ["health.warning", "health.recovered"]);
  assert.equal(ledger.events[1].data.rule, "ledger");
});

test("healthwatch: build rule — a rebuild at the SAME commit names both build times and the two sides never read the same; a different commit keeps the commit-only words byte for byte; an unstamped side keeps today's words", async () => {
  const { buildStatus } = await import("../dist/core/build.js");
  // measured live 2026-09-24 02:24:06.800Z: the daemon on 278d5d0 built 22:23:43Z, dist/ rebuilt at 278d5d0 by
  // the 02:23Z test run, and the alarm read "running 278d5d0, disk has 278d5d0 — restart to pick it up"
  const running = { version: "0.1.0", commit: "278d5d0", builtAt: "2026-09-23T22:23:43.000Z" };
  const stamp = (commit, builtAt) => ({ version: "0.1.0", commit, builtAt });
  const alertFor = (onDisk) => {
    const a = evaluateHealth(vitals(50), [], DEFAULT_THRESHOLDS, null, buildStatus(running, onDisk));
    assert.deepEqual(a.map((x) => [x.rule, x.sev]), [["build", "warn"]], `want exactly the warn-only build rule, saw ${JSON.stringify(a)}`);
    return a[0];
  };
  const sides = (detail) => {
    const m = /^dashboard runs build (.+) but dist\/ now holds (.+) — restart tmux-agent web to pick it up$/.exec(detail);
    assert.ok(m, `detail is not the build sentence: ${detail}`);
    return [m[1], m[2]];
  };

  // the same commit, rebuilt: the verdict is stale (buildStatus's own rule — commit OR builtAt), the words name both times
  const same = alertFor(stamp("278d5d0", "2026-09-24T02:23:41.000Z"));
  const [left, right] = sides(same.detail);
  assert.notEqual(left, right, `the two sides read the same — a restart that would run the same commit: ${same.detail}`);
  assert.equal(same.value, "running 278d5d0 built 2026-09-23T22:23:43.000Z, disk has 278d5d0 rebuilt 2026-09-24T02:23:41.000Z");
  assert.equal(same.detail, "dashboard runs build 278d5d0 built 2026-09-23T22:23:43.000Z but dist/ now holds 278d5d0 rebuilt 2026-09-24T02:23:41.000Z — restart tmux-agent web to pick it up");

  // a different commit: the commit-only words, byte for byte what the rule said before TMUX-162
  const moved = alertFor(stamp("feedbee", "2026-09-24T02:23:41.000Z"));
  assert.equal(moved.value, "running 278d5d0, disk has feedbee");
  assert.equal(moved.detail, "dashboard runs build 278d5d0 but dist/ now holds feedbee — restart tmux-agent web to pick it up");

  // an unstamped side keeps today's words: a tarball install compares builtAt alone; a stamp appearing under an unstamped start
  const tarball = evaluateHealth(vitals(50), [], DEFAULT_THRESHOLDS, null, buildStatus({ version: "0.1.0", commit: null, builtAt: "2026-09-23T22:23:43.000Z" }, stamp(null, "2026-09-24T02:23:41.000Z")));
  assert.equal(tarball[0]?.value, "running built 2026-09-23T22:23:43.000Z, disk has built 2026-09-24T02:23:41.000Z");
  const appeared = evaluateHealth(vitals(50), [], DEFAULT_THRESHOLDS, null, buildStatus({ version: "0.1.0", commit: null, builtAt: null }, stamp("278d5d0", "2026-09-24T02:23:41.000Z")));
  assert.equal(appeared[0]?.value, "running unknown, disk has 278d5d0");

  // controls: identical stamps and an unreadable disk stamp raise nothing — the verdict is untouched
  assert.deepEqual(evaluateHealth(vitals(50), [], DEFAULT_THRESHOLDS, null, buildStatus(running, stamp("278d5d0", "2026-09-23T22:23:43.000Z"))), []);
  assert.deepEqual(evaluateHealth(vitals(50), [], DEFAULT_THRESHOLDS, null, buildStatus(running, null)), []);
});
