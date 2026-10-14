/**
 * The mailbox's footprint reaches the surfaces the ledger's reaches (TMUX-123, gate G3 "failure modes
 * observable") — `/api/health`, the H3 rule set behind `/api/fleet.alerts`, and doctor, agreeing.
 *
 * Measured 2026-09-17 16:2xZ on the pushed `e9c499c` dist (scratch/ga-fire-2026-09-17-16Z/mbsurf-probe/
 * {probe.mjs,probe-e9c499c.log}), on ONE throwaway home holding three planted unread messages — two to
 * `gamma`, one to the one-character-wrong `bteta` — and a fourth to `beta` that WAS collected: TMUX-120
 * had put the mailbox's footprint on `doctor` (`mailbox.pending=3`, `pendingAgents=["bteta","gamma"]`,
 * controls 8/8 green) and there it stopped. `GET /api/health` on that same home carried `ledger`
 * ({files:1,bytes:725,…}) and **no mail key at all** — top-level keys `build,disk,lastCrash,ledger,load,
 * mem,mode,prediction,sampledAt,swap,tmux,uptimeSec` — so the payload the dashboard polls every tick,
 * and every consumer of it, could not see three messages rotting one directory from the ledger bytes it
 * did report. Nor could the banner: the H3 rules mentioned the ledger 3× (`ledgerWarnBytes`) and the
 * mailbox 0× (`grep` on `dist/core/healthwatch.js` lines, not paths), so mail nobody collected for a
 * month raised nothing where a ledger that grew raised `health.warning`.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) `/api/health.mailbox` carries `mailboxFootprint()`'s keys and its numbers MOVE: 3 unread with
 *       `pendingAgents ["bteta","gamma"]`, then 1 and `["bteta"]` once `gamma` collects, then 0 — a
 *       hard-coded key cannot pass;
 *   (b) a home that has never sent a message answers zeros, and the read does NOT create the root
 *       (`mailboxFootprint()`'s documented "an absent root is an empty footprint, never an error");
 *   (c) doctor's `mailbox` block and `/api/health.mailbox` agree key by key on one home, `dir` excepted
 *       (doctor names the directory it reports on; `/api/health` reports the ledger's footprint without
 *       one either) — with the comparator itself shown to FAIL on a planted one-key difference, so its
 *       verdict is not vacuous;
 *   (d) the H3 rule is on the AGE of uncollected mail, not the count: `mailboxOldestPendingWarnHours`
 *       (health.json, 0 disabling it, 24 h by default) raises exactly ONE `health.warning{rule:mailbox}`
 *       whose detail NAMES the agents holding the mail, plus the matching `/api/fleet.alerts` entry, and
 *       it CLEARS with one `health.recovered` when the mail is read;
 *   (e) the control that stops (d) from being an always-on alarm: mail that has just arrived raises NO
 *       event and NO alert, on the live surface and in the pure rule — and neither does a 0 threshold,
 *       nor a caller that passes no footprint at all (the CLI's one-shot paths);
 *   (f) path-independence: every assertion is on parsed JSON, and the home path is asserted to contain
 *       neither "mail" nor "inbox", so a path value can never answer for a report (TMUX-120's own trap).
 *
 * FAIL-first on the parent `0f7804e`, whose dist was built from `git archive` into
 * scratch/ga-fire-2026-09-17-20Z/red (logs red-parent-0f7804e.log): every case red —
 * `DEFAULT_THRESHOLDS.mailboxOldestPendingWarnHours` undefined, a 6th argument to `evaluateHealth()`
 * ignored, and `/api/health` carrying no `mailbox` key.
 *
 * doctor is asked with `--port` on a loopback port nothing listens on: this suite must never reach the
 * operator's own dashboard, and a missing daemon is a report, not a failure.
 *
 * Run: node --test test/mailbox-surface.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// copyTree/startWeb/stopWeb are shared with test/build-stamp.test.js — see helpers/built-web.js
import { copyTree, startWeb, stopWeb, ROOT } from "./helpers/built-web.js";

import { evaluateHealth, HealthWatcher, DEFAULT_THRESHOLDS, loadThresholds } from "../dist/core/healthwatch.js";
import { mailboxFootprint } from "../dist/adapters/messaging/mailbox.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const G = 1e9;
const HOUR = 3600_000;

const vitals = () => ({
  sampledAt: new Date().toISOString(),
  mode: "proc",
  mem: { totalBytes: 100 * G, availableBytes: 50 * G },
  swap: { totalBytes: 8 * G, freeBytes: 8 * G },
  load: [1, 1, 1],
  uptimeSec: 1000,
  disk: [{ path: "/", totalBytes: 1000 * G, freeBytes: 500 * G }],
});

/** Captures every emitted event; returns it, like the real Ledger. */
class FakeLedger {
  events = [];
  emit(e) { this.events.push(e); return e; }
}

/** A footprint in the shape `mailboxFootprint()` returns, with the oldest unread message `hoursAgo` old. */
const pressure = (pending, agents, hoursAgo) => ({
  agents: agents.length,
  pending,
  pendingBytes: pending * 200,
  pendingAgents: [...agents].sort(),
  oldestPending: pending > 0 ? new Date(Date.now() - hoursAgo * HOUR).toISOString() : null,
});

const mailboxAlerts = (alerts) => alerts.filter((a) => a.rule === "mailbox");

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

/** A loopback port nothing listens on (bound once, released) — doctor's probe must find it refused. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createTcpServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** (f) a home whose PATH contains neither "mail" nor "inbox" — asserted, not just intended. */
function home(tag) {
  const h = mkdtempSync(join(tmpdir(), `ta-mbsurf-${tag}-`));
  for (const word of ["mail", "inbox"]) {
    assert.ok(!h.includes(word), `test setup: the home path must not contain ${JSON.stringify(word)} — a path value could then answer for a report (${h})`);
  }
  return h;
}

/** The CLI on `h`, synchronously; msg and doctor touch no tmux server, the socket is hygiene. */
function cli(args, h) {
  return execFileSync(process.execPath, [BIN, "--socket", `ta-mbsurf-${process.pid}`, ...args], {
    env: { ...process.env, TMUX_AGENT_HOME: h },
    encoding: "utf8",
    timeout: 20_000,
  });
}

/** Every event in every live day file under <home>/ledger, filtered to one type + rule. */
function ruleEvents(h, type, rule) {
  const dir = join(h, "ledger");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /^events-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f));
  } catch {
    return [];
  }
  return files
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
    .filter((e) => e.type === type && e.data?.rule === rule);
}

/** Backdate every unread file in `agent`'s inbox by `hours` — mail nobody came back for. */
function age(h, agent, hours) {
  const inbox = join(h, "mailbox", agent, "inbox");
  const when = new Date(Date.now() - hours * HOUR);
  const files = readdirSync(inbox).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, `nothing to age in ${agent}'s inbox`);
  for (const f of files) utimesSync(join(inbox, f), when, when);
  return when;
}

/** Assert two footprint blocks agree key by key — (c). Throws on the first difference, naming it. */
function sameFootprint(got, want, label) {
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), `${label}: the two surfaces report different KEYS`);
  for (const k of Object.keys(want).sort()) {
    assert.deepEqual(got[k], want[k], `${label}: ${k} disagrees — ${JSON.stringify(got[k])} vs ${JSON.stringify(want[k])}`);
  }
}

// ---------------------------------------------------------------------------------------------
// (d) + (e) pure: the rule is on AGE, and its off switches are real
// ---------------------------------------------------------------------------------------------
test("mailbox: the H3 rule warns on the AGE of uncollected mail, never on the count", () => {
  const t = DEFAULT_THRESHOLDS;
  assert.ok(
    typeof t.mailboxOldestPendingWarnHours === "number" && t.mailboxOldestPendingWarnHours > 0,
    `mailboxOldestPendingWarnHours must ship with a default that judges something, got ${JSON.stringify(t.mailboxOldestPendingWarnHours)}`,
  );
  const hours = t.mailboxOldestPendingWarnHours;

  // (e) the control FIRST: three messages that arrived seconds ago are a fleet talking, not a failure
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, pressure(3, ["bteta", "gamma"], 0.01))), [], "mail that has just arrived must raise nothing — the rule would otherwise alarm on every send");
  // and a LOT of fresh mail is still fresh: the count is not the signal
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, pressure(500, ["gamma"], 0.5))), [], "500 messages half an hour old must still raise nothing — the rule is on age");

  // the same three, now past the threshold
  const alerts = mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, pressure(3, ["bteta", "gamma"], hours + 6)));
  assert.deepEqual(alerts.map((a) => [a.rule, a.sev]), [["mailbox", "warn"]], "uncollected mail past the threshold is exactly one warn — the read is the operator's move, never a crit");
  assert.match(alerts[0].detail, /bteta/, "the detail must NAME the agents holding the mail — the one-character-wrong recipient is the measured failure");
  assert.match(alerts[0].detail, /gamma/, "the detail must name every agent holding mail");
  assert.match(alerts[0].detail, /mailboxOldestPendingWarnHours/, "the detail names the knob that fixes it, as the ledger rule names ledgerKeepDays");
  assert.match(alerts[0].value, /3 unread/, `the value carries the measured count beside the age: ${alerts[0].value}`);

  // (e) the off switches
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], { ...t, mailboxOldestPendingWarnHours: 0 }, null, null, pressure(3, ["gamma"], 240))), [], "0 disables the rule, it does not warn on every message");
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, null)), [], "a caller with no footprint (the CLI's one-shot paths) is not judged on it");
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t)), [], "an absent argument is not judged either");
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, pressure(0, [], 0))), [], "an empty mailbox with nothing pending raises nothing");
  // a clock that puts the oldest message in the future is not an alert (nor a NaN comparison)
  assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, { pending: 1, pendingAgents: ["gamma"], oldestPending: "not-a-date" })), [], "an unparseable oldestPending cannot be judged, so it must not warn");
});

test("mailbox: health.json overrides mailboxOldestPendingWarnHours, and a bad value falls back", () => {
  const h = home("cfg");
  try {
    writeFileSync(join(h, "health.json"), JSON.stringify({ thresholds: { mailboxOldestPendingWarnHours: 2 } }));
    assert.equal(loadThresholds(h).mailboxOldestPendingWarnHours, 2, "health.json must be able to tighten the wait an operator considers a failure");
    const t = loadThresholds(h);
    assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, pressure(1, ["gamma"], 3))).map((a) => a.rule), ["mailbox"], "3 h of unread mail is a failure at a 2 h threshold");
    assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], t, null, null, pressure(1, ["gamma"], 1))), [], "1 h is still inside the configured wait");
    writeFileSync(join(h, "health.json"), JSON.stringify({ thresholds: { mailboxOldestPendingWarnHours: "soon" } }));
    assert.equal(loadThresholds(h).mailboxOldestPendingWarnHours, DEFAULT_THRESHOLDS.mailboxOldestPendingWarnHours, "a non-numeric override falls back to the default, as every other threshold does");
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});

test("mailbox: one health.warning per transition, and reading the mail is the recovery", () => {
  const t = DEFAULT_THRESHOLDS;
  const old = pressure(2, ["gamma"], t.mailboxOldestPendingWarnHours + 1);
  const collected = pressure(0, [], 0);
  const ledger = new FakeLedger();
  const w = new HealthWatcher(ledger);
  w.observe(vitals(), [], t, null, null, pressure(2, ["gamma"], 0.01)); // fresh — nothing
  w.observe(vitals(), [], t, null, null, old); // → warning
  w.observe(vitals(), [], t, null, null, old); // steady — NO second event
  assert.deepEqual(ledger.events.map((e) => [e.type, e.data.rule, e.data.from]), [["health.warning", "mailbox", "ok"]], `saw: ${JSON.stringify(ledger.events)}`);
  w.observe(vitals(), [], t, null, null, collected); // the agent collected → recovered
  w.observe(vitals(), [], t, null, null, collected);
  assert.deepEqual(ledger.events.map((e) => [e.type, e.data.rule]), [["health.warning", "mailbox"], ["health.recovered", "mailbox"]], "a warning with no closure leaves the operator asking whether it is still true");
});

// ---------------------------------------------------------------------------------------------
// (a) (b) (c) (d) (e) the BUILT server, end to end, on a tree copy with a 1 s tick
// ---------------------------------------------------------------------------------------------
test("mailbox: /api/health.mailbox moves with the mail, agrees with doctor key by key, and its age raises one clearing alert", async () => {
  const tree = copyTree();
  const h = home("home");
  const dashboardless = await freePort(); // doctor probes THIS, never the operator's dashboard
  let child = null;
  let port = 0;
  try {
    ({ child, port } = await startWeb(tree, h, { TMUX_AGENT_HEALTH_TICK_MS: "1000" }));
    const token = readFileSync(join(h, "web-token"), "utf8").trim(); // never printed
    const health = async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/health?token=${encodeURIComponent(token)}`);
      assert.equal(r.status, 200, `/api/health → ${r.status}`);
      return r.json();
    };
    const alerts = async () => {
      const r = await fetch(`http://127.0.0.1:${port}/api/fleet?token=${encodeURIComponent(token)}`);
      assert.equal(r.status, 200, `/api/fleet → ${r.status}`);
      return mailboxAlerts((await r.json()).alerts ?? []);
    };

    // (b) a home that has never sent a message: zeros, and the reporting did not create the root
    const empty = await health();
    assert.ok(empty.mailbox, `/api/health has no mailbox key — unread mail is on no surface the dashboard polls (keys: ${Object.keys(empty).sort().join(",")})`);
    assert.deepEqual(empty.mailbox, { agents: 0, pending: 0, pendingBytes: 0, pendingAgents: [], oldestPending: null }, "an absent mailbox root is an empty footprint, never an error");
    assert.equal(existsSync(join(h, "mailbox")), false, "reporting on the mailbox must not CREATE it — a home that never sent a message has no mailbox root (TMUX-120's rule, on this surface)");
    assert.deepEqual(await alerts(), [], "an empty mailbox raises no alert");

    // three messages nobody collects: two to gamma, one to the one-character-wrong bteta. beta's is
    // sent AND collected — the control that a mailbox which did its job is not counted as pending.
    for (const [to, subject] of [["gamma", "s1"], ["gamma", "s2"], ["bteta", "for-beta"], ["beta", "for-beta"]]) {
      cli(["msg", "send", "alpha", to, subject, "body"], h);
    }
    cli(["msg", "recv", "beta"], h);

    // (a) the numbers moved, on the payload the dashboard polls
    const planted = await health();
    assert.equal(planted.mailbox.pending, 3, `/api/health.mailbox.pending is ${planted.mailbox.pending} with three unread messages on disk, want 3`);
    assert.deepEqual(planted.mailbox.pendingAgents, ["bteta", "gamma"], `the orphan must be nameable here too: ${JSON.stringify(planted.mailbox.pendingAgents)}`);
    assert.equal(planted.mailbox.agents, 3, `mailbox.agents is ${planted.mailbox.agents}, want 3 (gamma, bteta, beta — a collected mailbox is still a mailbox)`);
    assert.ok(planted.mailbox.pendingBytes > 0, `mailbox.pendingBytes is ${planted.mailbox.pendingBytes} with three messages on disk`);
    assert.match(String(planted.mailbox.oldestPending), /^\d{4}-\d{2}-\d{2}T/, `mailbox.oldestPending must date the oldest unread message: ${planted.mailbox.oldestPending}`);

    // (e) on the live surface: mail that just arrived raises nothing, through two ticks
    await sleep(2500);
    assert.deepEqual(await alerts(), [], "three messages seconds old raised an alert — the rule must be on age, or every send pages the operator");
    assert.deepEqual(ruleEvents(h, "health.warning", "mailbox"), [], "a health.warning{rule:mailbox} reached the ledger for mail that had just arrived");

    // (c) doctor and /api/health, key by key, on this one home
    const doc = JSON.parse(cli(["doctor", "--port", String(dashboardless)], h));
    const { dir, ...docMailbox } = doc.mailbox;
    assert.equal(dir, join(h, "mailbox"), `doctor.mailbox.dir names the directory reported on: ${dir}`);
    const served = (await health()).mailbox;
    sameFootprint(served, docMailbox, "/api/health.mailbox vs doctor.mailbox");
    // the comparator is not vacuous: it must FAIL on one planted key
    assert.throws(
      () => sameFootprint({ ...served, pending: served.pending + 1 }, docMailbox, "planted"),
      /pending disagrees/,
      "the key-by-key comparison passed a planted difference — its verdict above would mean nothing",
    );
    assert.throws(
      () => sameFootprint(served, { ...docMailbox, extra: 1 }, "planted"),
      /different KEYS/,
      "the key-set comparison passed an extra key — a surface could drop one and still pass",
    );
    // the same walk against the ledger's footprint, the surface that has met this standard since
    // TMUX-90 — the positive control that this parity is achievable at all. KEYS only: the daemon
    // appends to the ledger between the two reads (its own health events), so its bytes legitimately
    // move, where nothing writes to the mailbox behind our back.
    const { dir: ledgerDir, retention, ...docLedger } = doc.ledger;
    assert.ok(ledgerDir && retention, "doctor.ledger still carries its dir and its retention block");
    assert.deepEqual(
      Object.keys((await health()).ledger).sort(),
      Object.keys(docLedger).sort(),
      "doctor and /api/health disagree on the LEDGER footprint's keys — the standard this card copies is itself broken",
    );

    // (d) the mail rots: 6 h past the default threshold, and the tick must say so
    const backdated = age(h, "gamma", DEFAULT_THRESHOLDS.mailboxOldestPendingWarnHours + 6);
    age(h, "bteta", DEFAULT_THRESHOLDS.mailboxOldestPendingWarnHours + 3);
    const aged = await until(async () => {
      const got = (await health()).mailbox.oldestPending;
      return got && Math.abs(Date.parse(got) - backdated.getTime()) <= 1000 ? got : null;
    }, 4000);
    assert.ok(aged, `/api/health.mailbox.oldestPending did not follow the file mtimes to ${backdated.toISOString()} — the age is read from disk, not from a cache`);
    const alert = await until(async () => (await alerts())[0], 6000);
    assert.ok(alert, "no mailbox alert on /api/fleet.alerts within a tick of the mail passing the threshold — the banner cannot see it");
    assert.equal(alert.sev, "warn", `the mailbox alert is warn-only, got ${alert.sev}`);
    assert.match(alert.detail, /gamma/, `the alert must name the agents holding the mail: ${alert.detail}`);
    assert.match(alert.detail, /bteta/, `the alert must name the orphan: ${alert.detail}`);
    const warned = await until(async () => (ruleEvents(h, "health.warning", "mailbox").length ? true : null), 4000);
    assert.ok(warned, "no health.warning{rule:mailbox} reached the ledger");

    // (a) again: gamma collects, so the count drops — while bteta's mail is still rotting, so the
    // alert must STAY. A rule that cleared here would be counting, not aging.
    cli(["msg", "recv", "gamma"], h);
    const dropped = await health();
    assert.equal(dropped.mailbox.pending, 1, `mailbox.pending is ${dropped.mailbox.pending} after gamma collected, want 1 — a hard-coded key would not move`);
    assert.deepEqual(dropped.mailbox.pendingAgents, ["bteta"], `pendingAgents after gamma collected: ${JSON.stringify(dropped.mailbox.pendingAgents)}`);
    await sleep(2500);
    assert.equal((await alerts()).length, 1, "the alert cleared while the typo'd recipient's mail was still uncollected");
    assert.equal(ruleEvents(h, "health.warning", "mailbox").length, 1, "the steady breach re-fired — one event per transition, never one per tick");

    // (d) the closure: the last unread message is read, so the alert clears with one recovery
    cli(["msg", "recv", "bteta"], h);
    const collected = await health();
    assert.equal(collected.mailbox.pending, 0, `mailbox.pending is ${collected.mailbox.pending} after every inbox was collected, want 0`);
    assert.equal(collected.mailbox.oldestPending, null, "oldestPending must be null with nothing pending");
    const cleared = await until(async () => ((await alerts()).length === 0 ? true : null), 6000);
    assert.ok(cleared, "the mailbox alert is still on /api/fleet.alerts after every message was read");
    const recovered = await until(async () => (ruleEvents(h, "health.recovered", "mailbox").length ? true : null), 4000);
    assert.ok(recovered, "no health.recovered{rule:mailbox} — a warning with no closure leaves the operator asking whether it is still true");

    // (e) the closing control: new mail moves the count back up and raises NOTHING, because it is new
    cli(["msg", "send", "alpha", "gamma", "s3", "body"], h);
    const fresh = await health();
    assert.equal(fresh.mailbox.pending, 1, `mailbox.pending is ${fresh.mailbox.pending} after one new send, want 1`);
    assert.ok(statSync(join(h, "mailbox", "gamma", "inbox", readdirSync(join(h, "mailbox", "gamma", "inbox"))[0])).mtimeMs > Date.now() - 60_000, "the new message is genuinely fresh on disk");
    await sleep(2500);
    assert.deepEqual(await alerts(), [], "new mail raised the alert again — the rule must judge the age, not the count");
    assert.equal(ruleEvents(h, "health.warning", "mailbox").length, 1, `warnings for rule mailbox: want exactly 1 for the whole run, saw ${ruleEvents(h, "health.warning", "mailbox").length}`);
    assert.equal(ruleEvents(h, "health.recovered", "mailbox").length, 1, "exactly one health.recovered{rule:mailbox}");
  } finally {
    await stopWeb(child); // killing is a signal, not a state: the daemon is gone before its home is
    rmSync(tree, { recursive: true, force: true });
    rmSync(h, { recursive: true, force: true });
  }
});

test("mailbox: the footprint the surfaces report is mailboxFootprint()'s own, on a home built by the CLI", () => {
  const h = home("fp");
  try {
    // the module and the surfaces must agree by construction, not by two hand-rolled counts
    assert.deepEqual(mailboxFootprint(join(h, "mailbox")), { agents: 0, pending: 0, pendingBytes: 0, pendingAgents: [], oldestPending: null }, "an absent root is an empty footprint");
    cli(["msg", "send", "alpha", "gamma", "s1", "body"], h);
    const fp = mailboxFootprint(join(h, "mailbox"));
    assert.equal(fp.pending, 1);
    assert.deepEqual(fp.pendingAgents, ["gamma"]);
    // the H3 rule consumes exactly this object — no adaptation, no second shape to drift
    assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], DEFAULT_THRESHOLDS, null, null, fp)), [], "a message just sent is not a failure");
    age(h, "gamma", DEFAULT_THRESHOLDS.mailboxOldestPendingWarnHours + 1);
    const rotting = mailboxFootprint(join(h, "mailbox"));
    assert.deepEqual(mailboxAlerts(evaluateHealth(vitals(), [], DEFAULT_THRESHOLDS, null, null, rotting)).map((a) => a.rule), ["mailbox"], "the real footprint of rotting mail must trip the real rule");
  } finally {
    rmSync(h, { recursive: true, force: true });
  }
});
