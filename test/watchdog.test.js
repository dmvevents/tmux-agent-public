/**
 * Pipe-stall watchdog — GA card TMUX-14.
 *
 * Verified failure mode: pipe-pane silently stalls (alternate-screen bursts), the durable log
 * goes dead, and nothing errors — which defeats the product's main promise. The headline test
 * FORCES that exact stall against a real tmux server (stop the pipe behind the orchestrator's
 * back), then proves the watchdog detects the divergence, ledgers capture.stalled, and re-arms
 * so the log grows again. The unit tests pin the guard-rails: cold-start grace, the 2-strike
 * rule, the re-arm cap, and recovery refunding that cap.
 *
 * Run: node --test test/watchdog.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tmux } from "../dist/core/tmux.js";
import { Ledger } from "../dist/core/ledger.js";
import { Policy } from "../dist/core/policy.js";
import { Orchestrator } from "../dist/core/orchestrator.js";
import { CaptureWatchdog } from "../dist/core/watchdog.js";
import { killServerSync } from "./helpers/kill-server.js";

function home() {
  return mkdtempSync(join(tmpdir(), "ta-wd-"));
}
function socket() {
  return `ta-wd-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
function logSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return -1;
  }
}
async function waitFor(cond, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(150);
  }
  assert.fail(`timeout: ${what}`);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** In-memory ledger stand-in for the unit tests — the payloads are what's asserted. */
function memLedger() {
  const events = [];
  return { events, emit: (e) => (events.push(e), e) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The acceptance test: force a REAL stall, prove detection + successful re-arm
// ─────────────────────────────────────────────────────────────────────────────
test("watchdog: forced pipe stall on real tmux → detected, ledgered, re-armed, log grows again", async () => {
  const H = home();
  process.env.TMUX_AGENT_HOME = H;
  const S = socket();
  const name = "wd1";
  const tmux = new Tmux({ socket: S });
  const ledger = new Ledger(join(H, "ledger"));
  const orch = new Orchestrator(tmux, ledger, new Policy(), "wd-test");
  const log = join(H, "logs", `${name}.log`);
  // send-keys is safe here only once the shell is at its prompt (host init files run on
  // isolated sockets too) — proven by the log having grown and then gone quiet
  const type = async (text) => {
    await tmux.exec(["send-keys", "-t", `=${name}:`, text, "Enter"]);
    await sleep(500); // let the pane render before it is fingerprinted
  };
  try {
    await orch.spawn({ name, cwd: "/tmp", parent: "wd-test" }); // spawn arms the capture pipe
    // pipe-pane only carries bytes produced AFTER it is armed. Shell-init noise covers that on
    // Linux, but a quiet shell (macOS runners: the prompt lands before the pipe arms, then
    // silence) leaves the log at 0 bytes forever — so generate the post-arm bytes ourselves.
    // sendVerified waits for the prompt (init done) before touching the pane, so this also
    // proves the shell is ready for the raw send-keys below.
    assert.equal(await orch.sendVerified(name, "echo capture-alive", { enter: true }), true,
      "verified send must land once the shell reaches its prompt");
    await waitFor(() => logSize(log) > 0, 15_000, "capture log never grew after a verified send");
    let settled = logSize(log);
    let lastChange = Date.now();
    await waitFor(() => {
      const now = logSize(log);
      if (now !== settled) {
        settled = now;
        lastChange = Date.now();
      }
      return Date.now() - lastChange > 1_200;
    }, 20_000, "shell init noise never went quiet");

    // FORCE the stall: a bare pipe-pane silently stops the pipe — the pane keeps working,
    // the log stops growing, and no error is raised anywhere. Exactly the field failure.
    await tmux.exec(["pipe-pane", "-t", `=${name}:`]);

    const led = memLedger();
    led.emit = (e) => (led.events.push(e), ledger.emit(e)); // assert payloads AND real ledgering
    const wd = new CaptureWatchdog(H, led, (s) => orch.startCapture(s), { graceMs: 0 });

    await wd.observe(name, await tmux.capturePane(name, 40)); // baseline
    await type("echo divergence-one");
    assert.equal(await wd.observe(name, await tmux.capturePane(name, 40)), false,
      "one divergence is strike 1, not yet a stall (could be a flush race)");
    await type("echo divergence-two");
    assert.equal(await wd.observe(name, await tmux.capturePane(name, 40)), true,
      "second consecutive divergence is the stall");
    const stalledEvents = led.events.filter((e) => e.type === "capture.stalled");
    assert.equal(stalledEvents.length, 1, "capture.stalled ledgered exactly once");
    assert.equal(stalledEvents[0].session, name);
    assert.equal(stalledEvents[0].data.exhausted, false);

    // successful re-arm: new pane output must land in the log again
    const before = logSize(log);
    await type("echo after-rearm-marker");
    await waitFor(() => logSize(log) > before, 10_000, "log did not grow after re-arm");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Guard-rails (no tmux needed — the log file and pane text are driven directly)
// ─────────────────────────────────────────────────────────────────────────────
function unitSetup(opts) {
  const H = home();
  mkdirSync(join(H, "logs"), { recursive: true });
  const log = join(H, "logs", "s.log");
  writeFileSync(log, "initial capture bytes");
  const led = memLedger();
  const rearms = [];
  const wd = new CaptureWatchdog(H, led, async (s) => (rearms.push(s), log), { graceMs: 0, ...opts });
  return { H, log, led, rearms, wd };
}

test("watchdog: cold-start grace suppresses divergence strikes", async () => {
  const { H, led, rearms, wd } = unitSetup({ graceMs: 60_000 });
  await wd.observe("s", "pane v1");
  assert.equal(await wd.observe("s", "pane v2"), false);
  assert.equal(await wd.observe("s", "pane v3"), false);
  assert.equal(led.events.length, 0, "no stall inside the grace window");
  assert.equal(rearms.length, 0);
  rmSync(H, { recursive: true, force: true });
});

test("watchdog: log growth resets the strike count", async () => {
  const { H, log, led, wd } = unitSetup();
  await wd.observe("s", "pane v1"); // baseline
  assert.equal(await wd.observe("s", "pane v2"), false, "strike 1");
  appendFileSync(log, "pipe delivered more bytes");
  assert.equal(await wd.observe("s", "pane v3"), false, "log grew — pipe alive, strikes reset");
  assert.equal(await wd.observe("s", "pane v4"), false, "back to strike 1, not a stall");
  assert.equal(led.events.length, 0);
  rmSync(H, { recursive: true, force: true });
});

test("watchdog: a quiet pane over a quiet log is idle, never a stall", async () => {
  const { H, led, wd } = unitSetup();
  await wd.observe("s", "same pane");
  for (let i = 0; i < 5; i++) assert.equal(await wd.observe("s", "same pane"), false);
  assert.equal(led.events.length, 0);
  rmSync(H, { recursive: true, force: true });
});

test("watchdog: re-arms are capped, exhaustion reported once, recovery refunds the budget", async () => {
  const { H, log, led, rearms, wd } = unitSetup({ maxReArms: 1 });
  let v = 0;
  const stall = async () => {
    await wd.observe("s", `pane v${++v}`); // strike 1
    return wd.observe("s", `pane v${++v}`); // strike 2 → stall
  };
  await wd.observe("s", "pane v0"); // baseline

  assert.equal(await stall(), true, "first stall re-arms");
  assert.equal(rearms.length, 1);

  assert.equal(await stall(), true, "second stall hits the cap");
  assert.equal(rearms.length, 1, "no re-arm beyond the cap");
  const stalled = led.events.filter((e) => e.type === "capture.stalled");
  assert.deepEqual(stalled.map((e) => e.data.exhausted), [false, true]);

  assert.equal(await stall(), false, "after giving up the watchdog stays quiet");
  assert.equal(led.events.filter((e) => e.type === "capture.stalled").length, 2);

  appendFileSync(log, "operator fixed the pipe by hand");
  await wd.observe("s", `pane v${++v}`); // log grew → full reset, budget refunded
  assert.equal(await stall(), true, "a genuine recovery earns a fresh re-arm budget");
  assert.equal(rearms.length, 2);
  rmSync(H, { recursive: true, force: true });
});

test("watchdog: adopted session without a capture log is ignored", async () => {
  const { H, led, rearms, wd } = unitSetup();
  assert.equal(await wd.observe("adopted", "pane v1"), false);
  assert.equal(await wd.observe("adopted", "pane v2"), false);
  assert.equal(led.events.length, 0);
  assert.equal(rearms.length, 0);
  rmSync(H, { recursive: true, force: true });
});
