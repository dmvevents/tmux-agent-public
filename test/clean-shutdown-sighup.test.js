/**
 * A signalled stop is never a host crash — the black box marker on SIGHUP (TMUX-171; H4 of
 * docs/HEALTH-CRASH-OBSERVABILITY.md).
 *
 * Measured on this host 2026-09-28 (scratch/ga-fire-2026-09-28-18Z/): at 16:50:06Z logind logged
 * "Power key pressed short" and systemd stopped every user session scope; the tmux server tore its
 * panes down and the dashboard daemon — `sh -c "cd … && node … web --port 7337; exec bash"`, the
 * same pgid and tty as its sh — took the pty's SIGHUP. Its handlers were SIGINT and SIGTERM only
 * (/proc/<pid>/status SigCgt 0000000108004602: bit 0 clear), so node's default disposition killed it
 * at once and health/clean-shutdown kept the previous day's 19:45:21Z. The 17:14:37Z start found a
 * heartbeat (16:50:04.868Z) older than the boot with no marker after it and ledgered
 * host.crash-suspected — for a power-off the box's own header promises stays silent. 367 of 397 GB
 * were free: there was no crash to name.
 *
 * The contract, each a check that FAILS if the property is removed:
 *   (a) the BUILT daemon, sent SIGHUP after its first heartbeat, exits BY SIGHUP (the disposition
 *       the pane relies on is kept — no reload semantics) and its home holds health/clean-shutdown,
 *       written at/after the start and no older than the heartbeat it must vouch for;
 *   (b) a Blackbox on that home with the boot forced after the heartbeat — the 16:50Z shape — is
 *       NOT a suspected crash;
 *   (c) control: SIGTERM through the harness's stopWeb() still writes the marker (the path the fix
 *       must not disturb).
 *
 * FAIL-first on 1ce791a (red-a-parent.log): (a) exit by SIGHUP with NO marker, (b) suspected true;
 * (c) green.
 *
 * Run: node --test test/clean-shutdown-sighup.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// copyTree/startWeb/stopWeb are the built-daemon harness shared with test/build-stamp.test.js — see helpers/built-web.js
import { copyTree, startWeb, stopWeb, STOP_BOUND_MS } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Import a built module by path — dynamic, so the case reports its own failure on an unbuilt tree. */
const built = (rel) => import(pathToFileURL(join(ROOT, "dist", rel)).href);

const tree = copyTree(); // a COPY of dist/: the repo's own stamp is read by every other suite running in parallel
after(() => { rmSync(tree, { recursive: true, force: true }); removeTempHomes(); }); // every home this file made

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll `fn` until it returns a truthy value or `ms` elapse — null on timeout, never a throw. */
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}

/** Start the built daemon on a fresh home with a 1 s tick and wait for its first heartbeat — the black box's record(). */
async function startedWithHeartbeat(prefix) {
  const home = tempHome(prefix);
  const startedAt = Date.now();
  const { child } = await startWeb(tree, home, { TMUX_AGENT_HEALTH_TICK_MS: "1000" });
  const hb = join(home, "health", "heartbeat");
  const seen = await until(() => existsSync(hb), 10_000);
  assert.ok(seen, `no heartbeat under ${home}/health within 10 s of the banner — the fixture never ticked, so no verdict below would mean anything`);
  return { home, child, startedAt, hb };
}

/** Signal `child` and wait for its exit inside stopWeb()'s bound; a daemon that will not die is SIGKILLed and the case fails by name. */
async function exitAfter(child, sig) {
  const exited = once(child, "exit"); // subscribed BEFORE the signal, so a fast exit cannot be missed
  child.kill(sig);
  let timer;
  const inBound = await Promise.race([exited.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), STOP_BOUND_MS); })]);
  clearTimeout(timer);
  if (!inBound) {
    child.kill("SIGKILL");
    await exited;
    assert.fail(`the daemon (pid ${child.pid}) did not exit within ${STOP_BOUND_MS} ms of ${sig} — SIGKILLed`);
  }
}

test("(a) SIGHUP: the daemon exits BY the signal and leaves health/clean-shutdown, written at/after the start and no older than the heartbeat", async () => {
  const { home, child, startedAt, hb } = await startedWithHeartbeat("ta-sighup-a-");
  const hbMtime = statSync(hb).mtimeMs;
  await exitAfter(child, "SIGHUP");
  assert.equal(child.signalCode, "SIGHUP", `the daemon must still die BY SIGHUP — the pane's hangup is not a reload (exitCode ${child.exitCode}, signalCode ${child.signalCode})`);
  const marker = join(home, "health", "clean-shutdown");
  assert.ok(existsSync(marker), `no clean-shutdown marker after SIGHUP — the hangup killed the daemon before anything recorded a stop we chose (health/: ${readdirSync(join(home, "health")).join(", ")})`);
  const text = readFileSync(marker, "utf8").trim();
  const at = Date.parse(text);
  assert.ok(Number.isFinite(at) && at >= startedAt - 1000, `marker instant ${text} is not from this run (started ${new Date(startedAt).toISOString()})`);
  assert.ok(statSync(marker).mtimeMs >= hbMtime, "the marker is OLDER than the heartbeat it must vouch for — checkUncleanShutdown() would still call this a crash");
});

test("(b) the 16:50Z shape: a heartbeat older than the boot with the SIGHUP marker after it is NOT a suspected crash", async () => {
  const { home, child } = await startedWithHeartbeat("ta-sighup-b-");
  await exitAfter(child, "SIGHUP");
  const { Blackbox } = await built("core/blackbox.js");
  const chk = new Blackbox(home).checkUncleanShutdown(Date.now() + 60_000); // boot forced AFTER the heartbeat: the host went down and came back
  assert.ok(chk.lastHeartbeatAt, "the check saw no heartbeat at all — the fixture is stale and this verdict would be vacuous");
  const marker = join(home, "health", "clean-shutdown");
  assert.equal(chk.suspected, false, `a hangup-stopped daemon reads as a HOST CRASH (lastHeartbeatAt ${chk.lastHeartbeatAt}) — the marker that would clear it is ${existsSync(marker) ? "present but older than the heartbeat" : "absent"}`);
});

test("(c) control — SIGTERM through stopWeb() still writes the marker: the path the fix must not disturb", async () => {
  const { home, child } = await startedWithHeartbeat("ta-sighup-c-");
  await stopWeb(child);
  assert.equal(child.signalCode, "SIGTERM", `SIGTERM's exit changed shape (exitCode ${child.exitCode}, signalCode ${child.signalCode})`);
  assert.ok(existsSync(join(home, "health", "clean-shutdown")), "SIGTERM no longer writes the clean-shutdown marker");
});
