/**
 * hostTop — the black box and the mem/swap crit events name the host's top processes, tmux or
 * not (TMUX-168, docs/HEALTH-CRASH-OBSERVABILITY.md H4 gap). Evidence that made this a card:
 * 2026-09-23 22:33:23Z `health.critical swap 100 %` (0→100 inside one 30 s tick), last heartbeat
 * 22:34:53Z, host down until 00:50:53Z — and crash-last.json's top list summed to under 6 G
 * across every tracked pane tree. The pressure was not ours, and the record could not say whose.
 *
 * Contracts a refactor can silently break: a process OUTSIDE any tmux tree is listed; rows are
 * names only (never argv — argv carries tokens); no /proc reads as [] not a throw; the snapshot
 * round-trips through the ring and crash-last.json while pre-2026-09-27 ring lines (no field)
 * still parse; a crit alert's hostTop reaches the ledger event and an alert without one adds no key.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import * as act from "../dist/core/activity.js";
import { Blackbox } from "../dist/core/blackbox.js";
import { HealthWatcher } from "../dist/core/healthwatch.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const HAS_PROC = existsSync("/proc/self/stat");
const G = 1e9;
const vitals = (availG) => ({
  sampledAt: new Date().toISOString(), mode: "proc",
  mem: { totalBytes: 100 * G, availableBytes: availG * G },
  swap: { totalBytes: 8 * G, freeBytes: 8 * G }, load: [1, 1, 1], uptimeSec: 1000, disk: [],
});
const rows = [{ session: "hog", rssBytes: 30 * G }, { session: "quiet", rssBytes: 1 * G }];
after(() => removeTempHomes());

/** a ~200 MB node child that is nobody's pane tree (plain child_process, no tmux) */
async function spawnHog(extraArgv = []) {
  const child = spawn(process.execPath, ["-e", "const a=Buffer.alloc(200000000,7);a[0]=1;setInterval(()=>{},1000)", "--", ...extraArgv], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    const got = act.sampleCpu([child.pid]).byPid.get(child.pid);
    if (got && got.rssBytes >= 180_000_000) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  return child;
}

test("hostTop: a ~200 MB process OUTSIDE any tmux tree is listed, with its rss, names only, sorted", { skip: !HAS_PROC }, async () => {
  const child = await spawnHog();
  try {
    const all = act.hostTopProcesses(500);
    const me = all.find((r) => r.pid === child.pid);
    assert.ok(me, "an outside-the-fleet process must appear in the host list");
    assert.ok(me.rssBytes >= 180_000_000, `rss on the row, saw ${me.rssBytes}`);
    assert.ok(typeof me.comm === "string" && me.comm.length > 0, "comm populated (node 24 says MainThread — fine)");
    for (const r of all) assert.deepEqual(Object.keys(r).sort(), ["comm", "pid", "rssBytes"], "names only — no argv/cmdline key");
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].rssBytes >= all[i].rssBytes, "sorted by rss desc");
    assert.ok(act.hostTopProcesses(8).length <= 8, "n caps the list");
  } finally { child.kill("SIGKILL"); }
});

test("hostTop: never argv — a child launched with a token in its argv leaks nothing (and IS present)", { skip: !HAS_PROC }, async () => {
  const child = await spawnHog(["--fake-token=SECRET_HOSTTOP_9f3a1"]);
  try {
    const all = act.hostTopProcesses(100000);
    assert.ok(all.some((r) => r.pid === child.pid), "the negative must not be vacuous: the child is listed");
    assert.ok(!JSON.stringify(all).includes("SECRET_HOSTTOP_9f3a1"), "argv must never reach a hostTop row");
  } finally { child.kill("SIGKILL"); }
});

test("hostTop: no /proc → [] — absent, never a throw", () => {
  assert.deepEqual(act.hostTopProcesses(8, "/nonexistent-proc-root"), []);
});

test("blackbox: record() carries hostTop; tail() and crash-last round-trip it; a pre-field ring line still parses", () => {
  const home = tempHome("ta-hosttop-");
  const bb = new Blackbox(home);
  const ht = [{ pid: 4242, comm: "python3", rssBytes: 150 * G }, { pid: 7, comm: "node", rssBytes: 2 * G }];
  bb.record(vitals(9), rows, ht);
  assert.deepEqual(bb.tail(1)[0].hostTop, ht, "the ring line carries the host list");
  // a line written by the pre-2026-09-27 daemon (no hostTop) sits in the same ring
  appendFileSync(join(home, "health", "snapshots.ndjson"), JSON.stringify({ ts: new Date().toISOString(), mem: vitals(9).mem, swapFreeBytes: 0, top: [] }) + "\n");
  const t = bb.tail(2);
  assert.equal(t.length, 2, "both lines parse");
  assert.equal(t[1].hostTop, undefined, "legacy line: field honestly absent");
  const chk = bb.checkUncleanShutdown(Date.now() + 60_000); // force: boot 'after' the heartbeat
  assert.equal(chk.suspected, true);
  bb.noteCrash(chk);
  assert.deepEqual(bb.lastCrash().lastSnapshot.hostTop, undefined, "lastSnapshot is the LAST line (the legacy one) — honest");
  bb.record(vitals(9), rows, ht);
  bb.noteCrash(bb.checkUncleanShutdown(Date.now() + 60_000));
  assert.deepEqual(bb.lastCrash().lastSnapshot.hostTop, ht, "crash-last.json names the top host processes");
});

test("healthwatch: a crit alert's hostTop reaches the ledger event; an alert without one adds no key", () => {
  const events = [];
  const w = new HealthWatcher({ emit: (e) => { events.push(e); return e; } });
  const ht = [{ pid: 4242, comm: "python3", rssBytes: 150 * G }];
  w.apply([{ rule: "swap", sev: "crit", value: "100% used", detail: "swap in use (100%)", hostTop: ht }]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data.hostTop, ht, "the swap crit names the culprit host-wide");
  const w2 = new HealthWatcher({ emit: (e) => { events.push(e); return e; } });
  w2.apply([{ rule: "mem", sev: "warn", value: "9% available", detail: "host memory low" }]);
  assert.ok(!("hostTop" in events[1].data), "no list → no key (a warn stays small)");
});
