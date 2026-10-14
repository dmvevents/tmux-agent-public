/**
 * The running build is observable (TMUX-92, gate G3 "failure modes observable").
 *
 * Measured 2026-09-12 (nineteenth fire) on this host's own dashboard daemon: started 2026-08-26 on
 * build 37239eb and still serving 16 days later while HEAD had moved 47 commits — four of them G3
 * fixes the daemon did not run. Nothing in the product said so: /api/health had
 * no version or commit, its `uptimeSec` was the HOST's uptime, `doctor` printed only
 * lexicon.version, and there was no --version. "Shipped" and "running" diverged invisibly; the
 * divergence was established from ps, `git log --until` and the key set of a JSON response — none
 * of which a stranger would do.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   1. `npm run build` leaves dist/build.json — version = package.json, commit = the tree's HEAD
 *      (null outside a git tree), builtAt a recent ISO instant.
 *   2. `buildStatus()` is stale iff the on-disk stamp differs from the loaded one (commit OR
 *      builtAt — a rebuild at the same commit is still code this process is not running); an
 *      unreadable stamp on disk is "cannot judge", never stale. `describeBuildPair()` words the
 *      pair for every surface, and rides the status as `words`: equal commits with different build
 *      times name both times, never the same string twice.
 *   3. A stale build is a warn-only H3 `build` rule through the existing transition machinery:
 *      exactly one health.warning, silence while steady, exactly one health.recovered.
 *   4. The BUILT server on a temp home (loopback, token) serves /api/health.build with the loaded
 *      stamp, its own process start (processUptimeSec < the host's uptimeSec) and stale=false; a
 *      stamp rewritten under it flips stale and raises the alert within one tick; restoring it
 *      clears both. Runs from a COPY of dist/ so the repo's own stamp is never touched while the
 *      other suites read it.
 *   5. `tmux-agent --version` prints the stamp and exits 0 without touching tmux or the home;
 *      `doctor` carries the same block.
 *   6. The harness's stopWeb() returns only once the daemon is GONE, so the six teardowns that
 *      remove a daemon's home right after it cannot race its last writes (the ENOTEMPTY CI run
 *      35966537723 attempt 1 lost); a daemon that ignores SIGTERM is SIGKILLed inside a named bound.
 *
 * FAIL-first on HEAD d883296: no dist/build.json, no dist/core/build.js, /api/health has no `build`
 * key, --version is an unknown flag — red on every test (output on TMUX-92).
 *
 * Run: node --test test/build-stamp.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// copyTree/startWeb/stopWeb are shared with test/doctor-dashboard.test.js — see helpers/built-web.js
import { copyTree, startWeb, stopWeb } from "./helpers/built-web.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const STAMP_PATH = join(ROOT, "dist", "build.json");
const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const G = 1024 ** 3;

/** Import a built module by path — dynamic, so each test reports its own failure on an unbuilt tree. */
const built = (rel) => import(pathToFileURL(join(ROOT, "dist", rel)).href);

const readStamp = () => JSON.parse(readFileSync(STAMP_PATH, "utf8"));
const gitHead = () => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // not a git tree (tarball install) — the stamp must then say null too
  }
};

/** Captures every emitted event; returns it, like the real Ledger. */
class FakeLedger {
  events = [];
  emit(e) { this.events.push(e); return e; }
}
const vitals = () => ({
  sampledAt: new Date().toISOString(),
  mode: "proc",
  mem: { totalBytes: 100 * G, availableBytes: 50 * G },
  swap: { totalBytes: 8 * G, freeBytes: 8 * G },
  load: [1, 1, 1],
  uptimeSec: 1000,
  disk: [{ path: "/", totalBytes: 1000 * G, freeBytes: 500 * G }],
});
const stamp = (commit, builtAt = "2026-09-12T00:00:00.000Z") => ({ version: "0.1.0", commit, builtAt });

/** Every event in every live day file under <home>/ledger. */
function events(home) {
  const dir = join(home, "ledger");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /^events-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f));
  } catch {
    return [];
  }
  return files.flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
const ruleEvents = (home, type) => events(home).filter((e) => e.type === type && e.data?.rule === "build");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll `pred` until truthy or `ms` elapses; returns the last value (so the caller can show it). */
async function until(pred, ms, every = 200) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    last = await pred();
    if (last || Date.now() > end) return last;
    await sleep(every);
  }
}

// ---------------------------------------------------------------------------------------------
// 1. the build writes its stamp
// ---------------------------------------------------------------------------------------------
test("build: npm run build leaves dist/build.json — package version, the tree's HEAD, a recent builtAt", () => {
  assert.ok(existsSync(STAMP_PATH), "dist/build.json missing — `npm run build` must write the stamp after tsc");
  const s = readStamp();
  assert.equal(s.version, PKG.version, "stamp version must be package.json's");
  const age = Date.now() - Date.parse(s.builtAt);
  assert.ok(Number.isFinite(age) && age >= 0 && age < 6 * 3600_000, `builtAt ${s.builtAt} is not a recent ISO instant (age ${age} ms)`);
  const head = gitHead();
  if (head) assert.equal(s.commit, head, `stamp commit ${s.commit} is not this tree's HEAD ${head} — dist/ was built from another commit; run npm run build`);
  else assert.equal(s.commit, null, "outside a git tree the commit must be null, never invented");
});

// ---------------------------------------------------------------------------------------------
// 2 + 3. pure: stale verdict, and the H3 `build` rule through the transition machinery
// ---------------------------------------------------------------------------------------------
test("build: buildStatus is stale iff the on-disk stamp differs (commit OR builtAt); no stamp on disk cannot be judged", async () => {
  const { buildStatus } = await built("core/build.js");
  const running = stamp("aaaaaaa");
  const same = buildStatus(running, stamp("aaaaaaa"));
  assert.equal(same.stale, false);
  assert.deepEqual(same.onDisk, { commit: "aaaaaaa", builtAt: "2026-09-12T00:00:00.000Z" });
  assert.equal(same.version, "0.1.0");
  assert.ok(Number.isFinite(Date.parse(same.startedAt)) && Math.abs(Date.now() - process.uptime() * 1000 - Date.parse(same.startedAt)) < 2000, "startedAt is THIS process's start, not the host's");
  assert.equal(same.processUptimeSec, Math.round(process.uptime()));
  assert.equal(buildStatus(running, stamp("bbbbbbb")).stale, true, "a different commit on disk is stale");
  assert.equal(buildStatus(running, stamp("aaaaaaa", "2026-09-12T01:00:00.000Z")).stale, true, "a rebuild at the same commit is still code this process is not running");
  assert.equal(buildStatus(running, null).stale, false, "an unreadable stamp on disk is 'cannot judge', never a false alarm");
  assert.equal(buildStatus(running, null).onDisk, null);
  // an unstamped start (tsc without the stamp step) that later sees a stamp appear IS stale
  assert.equal(buildStatus({ version: "0.1.0", commit: null, builtAt: null }, stamp("ccccccc")).stale, true);
});

test("build: describeBuildPair — equal commits with different build times name both times, never the same string twice; different commits are describeBuild's words byte for byte; an unstamped side keeps today's words; buildStatus carries the pair as words", async () => {
  const { buildStatus, describeBuild, describeBuildPair } = await built("core/build.js");
  assert.equal(typeof describeBuildPair, "function", "dist/core/build.js exports no describeBuildPair — one describeBuild() a side reads `runs 278d5d0 but dist/ now holds 278d5d0` on a same-commit rebuild");
  // measured live 2026-09-24 02:24Z: the daemon on 278d5d0, dist/ rebuilt at 278d5d0 by a test run
  const a = { commit: "278d5d0", builtAt: "2026-09-23T22:23:43.000Z" };
  const same = describeBuildPair(a, { commit: "278d5d0", builtAt: "2026-09-24T02:23:41.000Z" });
  assert.deepEqual(same, { running: "278d5d0 built 2026-09-23T22:23:43.000Z", onDisk: "278d5d0 rebuilt 2026-09-24T02:23:41.000Z" });
  assert.notEqual(same.running, same.onDisk);
  // a same-commit rebuild where the running side never recorded its time still cannot read the same twice
  assert.deepEqual(describeBuildPair({ commit: "278d5d0", builtAt: null }, a), { running: "278d5d0 built at an unknown time", onDisk: "278d5d0 rebuilt 2026-09-23T22:23:43.000Z" });
  // different commits: describeBuild's words, byte for byte
  const other = { commit: "feedbee", builtAt: "2026-09-24T02:23:41.000Z" };
  assert.deepEqual(describeBuildPair(a, other), { running: describeBuild(a), onDisk: describeBuild(other) });
  assert.deepEqual(describeBuildPair(a, other), { running: "278d5d0", onDisk: "feedbee" });
  // an unstamped side (tarball install; dist/build.json unreadable) keeps today's words
  assert.deepEqual(describeBuildPair({ commit: null, builtAt: "2026-09-23T22:23:43.000Z" }, { commit: null, builtAt: "2026-09-24T02:23:41.000Z" }), { running: "built 2026-09-23T22:23:43.000Z", onDisk: "built 2026-09-24T02:23:41.000Z" });
  assert.deepEqual(describeBuildPair(a, null), { running: "278d5d0", onDisk: "unknown" });
  // identical stamps read the same on both sides — there is nothing to tell apart, and nothing alarms
  assert.deepEqual(describeBuildPair(a, { ...a }), { running: "278d5d0", onDisk: "278d5d0" });
  // buildStatus carries the pair for the strip; the verdict is untouched — equal commits with a moved builtAt is still stale
  const s = buildStatus({ version: "0.1.0", ...a }, { version: "0.1.0", commit: "278d5d0", builtAt: "2026-09-24T02:23:41.000Z" });
  assert.equal(s.stale, true, "a rebuild at the same commit is still code this process is not running");
  assert.deepEqual(s.words, same);
  assert.deepEqual(buildStatus({ version: "0.1.0", ...a }, null).words, { running: "278d5d0", onDisk: "unknown" });
});

test("build: a stale build is exactly one warn-only health.warning{rule:build}, steady is silent, restoring is one health.recovered", async () => {
  const { buildStatus } = await built("core/build.js");
  const { evaluateHealth, HealthWatcher, DEFAULT_THRESHOLDS } = await built("core/healthwatch.js");
  const running = stamp("aaaaaaa");
  const fresh = buildStatus(running, stamp("aaaaaaa"));
  const stale = buildStatus(running, stamp("bbbbbbb"));
  assert.deepEqual(evaluateHealth(vitals(), [], DEFAULT_THRESHOLDS, null, fresh), [], "a fresh build raises nothing");
  const breaches = evaluateHealth(vitals(), [], DEFAULT_THRESHOLDS, null, stale);
  assert.deepEqual(breaches.map((a) => [a.rule, a.sev]), [["build", "warn"]], "stale is a warn, never a crit — the restart is the operator's call");
  assert.match(breaches[0].detail, /aaaaaaa/, "the detail names what is running");
  assert.match(breaches[0].detail, /bbbbbbb/, "the detail names what is on disk");
  assert.match(breaches[0].detail, /restart/i, "the detail names the remedy");
  assert.deepEqual(evaluateHealth(vitals(), [], DEFAULT_THRESHOLDS, null, null), [], "callers without a stamp are simply not judged on it");

  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  w.observe(vitals(), [], DEFAULT_THRESHOLDS, null, stale); // → warning
  w.observe(vitals(), [], DEFAULT_THRESHOLDS, null, stale); // steady — NO second event
  assert.deepEqual(ledger.events.map((e) => [e.type, e.data.rule, e.data.from]), [["health.warning", "build", "ok"]], `saw: ${JSON.stringify(ledger.events)}`);
  w.observe(vitals(), [], DEFAULT_THRESHOLDS, null, fresh); // restored (or restarted) → recovered
  w.observe(vitals(), [], DEFAULT_THRESHOLDS, null, fresh);
  assert.deepEqual(ledger.events.map((e) => [e.type, e.data.rule]), [["health.warning", "build"], ["health.recovered", "build"]]);
});

// ---------------------------------------------------------------------------------------------
// 4. the built server, end to end, on a tree copy with a 1 s tick
// ---------------------------------------------------------------------------------------------
test("build: /api/health.build serves the running stamp; a stamp rewritten under the server flips stale + one build warn within a tick; restoring clears both", async () => {
  const tree = copyTree();
  const home = mkdtempSync(join(tmpdir(), "ta-build-home-"));
  let child = null;
  let port = 0;
  try {
    const running = JSON.parse(readFileSync(join(tree, "dist", "build.json"), "utf8"));
    ({ child, port } = await startWeb(tree, home, { TMUX_AGENT_HEALTH_TICK_MS: "1000" }));
    const token = readFileSync(join(home, "web-token"), "utf8").trim(); // never printed
    const health = async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/health?token=${encodeURIComponent(token)}`);
      assert.equal(r.status, 200, `/api/health → ${r.status}`);
      return r.json();
    };
    const fleetAlerts = async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/fleet?token=${encodeURIComponent(token)}`);
      return (await r.json()).alerts ?? [];
    };

    const h = await health();
    assert.ok(h.build, `/api/health has no build key — keys: ${Object.keys(h).join(",")}`);
    assert.equal(h.build.version, PKG.version);
    assert.equal(h.build.commit, running.commit, "the running stamp is the one dist/ was started from");
    assert.equal(h.build.builtAt, running.builtAt);
    assert.equal(h.build.stale, false, "a fresh server is never stale");
    assert.deepEqual(h.build.onDisk, { commit: running.commit, builtAt: running.builtAt });
    const { describeBuild } = await built("core/build.js");
    assert.deepEqual(h.build.words, { running: describeBuild(running), onDisk: describeBuild(running) }, "the strip's two sides ride /api/health.build.words");
    assert.ok(Number.isFinite(Date.parse(h.build.startedAt)) && Date.now() - Date.parse(h.build.startedAt) < 60_000, `startedAt ${h.build.startedAt} is not this process's recent start`);
    assert.ok(typeof h.build.processUptimeSec === "number" && h.build.processUptimeSec < h.uptimeSec, `processUptimeSec ${h.build.processUptimeSec} must be the process's, below the host's ${h.uptimeSec}`);

    // the operator pulls and rebuilds under the running daemon: same version, new commit
    writeFileSync(join(tree, "dist", "build.json"), JSON.stringify({ ...running, commit: "feedbee", builtAt: new Date().toISOString() }));
    const stale = await until(async () => { const b = (await health()).build; return b.stale === true && b.onDisk?.commit === "feedbee" ? b : null; }, 6000);
    assert.ok(stale, "stale did not flip within 6 s of the on-disk stamp changing");
    assert.equal(stale.commit, running.commit, "the RUNNING stamp does not move — only onDisk does");
    assert.deepEqual(stale.words, { running: describeBuild(running), onDisk: "feedbee" }, "a different commit: the commit-only words on both sides");
    const alert = await until(async () => (await fleetAlerts()).find((a) => a.rule === "build"), 6000);
    assert.ok(alert && alert.sev === "warn", `no warn-only build alert on /api/fleet.alerts within a tick (got ${JSON.stringify(alert)})`);
    assert.match(alert.detail, /feedbee/);
    const warned = await until(async () => (ruleEvents(home, "health.warning").length ? true : null), 4000);
    assert.ok(warned, "no health.warning{rule:build} reached the ledger");

    // restore → recovered, alert gone, stale false; and steady state afterwards adds nothing
    writeFileSync(join(tree, "dist", "build.json"), JSON.stringify(running));
    const back = await until(async () => ((await health()).build.stale === false ? true : null), 6000);
    assert.ok(back, "stale did not clear within 6 s of restoring the stamp");
    const cleared = await until(async () => (!(await fleetAlerts()).some((a) => a.rule === "build") ? true : null), 6000);
    assert.ok(cleared, "build alert still on /api/fleet.alerts after the stamp was restored");
    await sleep(2500); // two more ticks
    assert.equal(ruleEvents(home, "health.warning").length, 1, `warnings for rule build: want exactly 1 (transition-only), saw ${JSON.stringify(ruleEvents(home, "health.warning"))}`);
    assert.equal(ruleEvents(home, "health.recovered").length, 1, "exactly one health.recovered{rule:build}");
  } finally {
    await stopWeb(child); // killing is a signal, not a state: the daemon is gone before its home is
    rmSync(tree, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// 6. the harness's own contract: stopWeb() returns only once the daemon is GONE
// ---------------------------------------------------------------------------------------------

/**
 * A stand-in for the built dashboard's exit path, planted so the wait is measurable on an unloaded
 * host too: it writes into `<home>/health` every millisecond from start (re-creating the directory
 * if the home is being removed under it, so a removal that overlaps a write cannot end clean), and
 * on SIGTERM keeps writing for ~200 ms before it drops a `clean-shutdown` marker and exits 0 — the shape of
 * src/web/server.ts's onStop (Blackbox.markCleanShutdown) with the race window widened from
 * microseconds to a fifth of a second. `ignoreTerm` plants the wedged daemon the bound exists for.
 * Resolves once the child has said it is running, so a SIGTERM cannot land before its handler is on.
 */
async function lingeringDaemon(home, { ignoreTerm = false } = {}) {
  const script = `
    const { mkdirSync, writeFileSync } = require("node:fs");
    const dir = process.env.TA_LINGER_HOME + "/health";
    let n = 0;
    const write = (name) => { try { mkdirSync(dir, { recursive: true }); writeFileSync(dir + "/" + name, "x"); } catch { /* the home may be going */ } };
    const tick = setInterval(() => write("w-" + (n++)), 1);
    process.on("SIGTERM", () => {
      if (${ignoreTerm}) return;
      setTimeout(() => { write("clean-shutdown"); clearInterval(tick); process.exit(0); }, 200);
    });
    process.stdout.write("ready\\n");
  `;
  const child = spawn(process.execPath, ["-e", script], { env: { ...process.env, TA_LINGER_HOME: home }, stdio: ["ignore", "pipe", "ignore"] });
  await once(child.stdout, "data");
  return child;
}

test("build: the harness's stopWeb() returns only once the daemon is GONE — a daemon still writing 200 ms after SIGTERM has exited, its last marker on disk, before the home is removed; one that ignores SIGTERM is SIGKILLed inside a bound the failure names; a never-started child is nothing to stop", async () => {
  // (a) the lingering daemon: the wait covers its whole tail, so the removal that follows finds nothing writing.
  // FAIL-first with stopWeb() reduced to `child.kill()` (the six teardowns' old shape): exitCode null, no marker.
  const home = mkdtempSync(join(tmpdir(), "ta-build-stop-"));
  try {
    const child = await lingeringDaemon(home);
    const t0 = Date.now();
    await stopWeb(child);
    const waited = Date.now() - t0;
    assert.equal(child.exitCode, 0, `stopWeb() returned while the daemon was still running (exitCode ${child.exitCode}, signalCode ${child.signalCode}) — the home would be removed under its writes`);
    assert.equal(child.signalCode, null, "a daemon that exits on SIGTERM by itself must not be SIGKILLed");
    assert.ok(waited >= 150, `stopWeb() returned after ${waited} ms — before the daemon's 200 ms tail, so it did not wait for the exit`);
    assert.ok(existsSync(join(home, "health", "clean-shutdown")), "the daemon's last write is not on disk — stopWeb() returned before the exit it claims to await");
    rmSync(home, { recursive: true, force: true }); // what the six teardowns do next: nothing is writing, so it throws nothing
    assert.equal(existsSync(home), false, "the home survived its removal — something re-created it after stopWeb() returned");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  // (b) the wedged daemon: SIGKILLed inside the bound, and the failure names the bound it missed.
  const wedged = mkdtempSync(join(tmpdir(), "ta-build-stop-wedged-"));
  try {
    const child = await lingeringDaemon(wedged, { ignoreTerm: true });
    await assert.rejects(stopWeb(child, { boundMs: 300 }), /did not exit within 300 ms of SIGTERM/,
      "a daemon that ignores SIGTERM must fail the case naming the bound — not hang the suite, not pass silently");
    assert.equal(child.signalCode, "SIGKILL", `the wedged daemon was not SIGKILLed (exitCode ${child.exitCode}, signalCode ${child.signalCode})`);
  } finally {
    rmSync(wedged, { recursive: true, force: true });
  }
  // (c) startWeb() rejected before it resolved: the teardown's `child` is null, and there is nothing to stop.
  await stopWeb(null);
});

// ---------------------------------------------------------------------------------------------
// 5. the CLI says it: --version (no tmux, no home writes) and doctor.build
// ---------------------------------------------------------------------------------------------
test("build: --version prints `<version> (<commit>, built <builtAt>)` and exits 0 without touching the home; doctor carries the same block", () => {
  const s = readStamp();
  const home = mkdtempSync(join(tmpdir(), "ta-build-cli-"));
  const env = { ...process.env, TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: `ta-build-none-${process.pid}` };
  try {
    const out = execFileSync(process.execPath, [BIN, "--version"], { env, encoding: "utf8" });
    assert.ok(out.startsWith(`${PKG.version} (`), `--version printed ${JSON.stringify(out)}, want it to start with "${PKG.version} ("`);
    assert.ok(out.includes(String(s.commit)) && out.includes(s.builtAt) && /built /.test(out), `--version does not carry the stamp: ${out.trim()}`);
    assert.deepEqual(readdirSync(home), [], "--version must not write into the home (no ledger/, no web-token) — it is answerable before anything is constructed");
    const doc = JSON.parse(execFileSync(process.execPath, [BIN, "doctor"], { env, encoding: "utf8" }));
    assert.deepEqual(doc.build, { version: s.version, commit: s.commit, builtAt: s.builtAt }, "doctor.build is the stamp this process loaded");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
