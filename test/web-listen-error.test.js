/**
 * A dashboard listen() that fails for any reason but EADDRINUSE exits non-zero, naming the code, host and port — never
 * exit 0 with no banner (TMUX-179; gate G3 — failure modes observable — and the sibling of TMUX-178's "the banner is
 * the truth": a supervisor that watches exit codes must be told when there is no socket). A RUNNING daemon's error
 * stays the boundary's: recorded, and the dashboard keeps serving.
 *
 * Measured 2026-09-30 02:38Z (235th GA fire, scratch/ga-fire-2026-09-30-02Z/probe-179.log, the built 53a3489 CLI in a
 * temp home): startWeb's server.on("error") handler (src/web/server.ts) exited 75 on EADDRINUSE and rethrew anything
 * else. The rethrow left emit("error") before once(server, "listening")'s own rejection listener ran, so it surfaced as
 * an uncaughtException; the process boundary (src/core/boundary.ts — record it, keep serving — installed by the web verb
 * just before startWeb) wrote `[web] uncaughtException: listen EACCES …` to the ledger and stderr and kept the process
 * alive; the web verb's readiness wait stayed pending, a pending promise holds nothing open, the loop drained and node
 * exited 0. EACCES planted → exit 0 after 1,245 ms, no banner; the real path `--strict-port --dangerously-allow-remote
 * --token <typed> --host 192.0.2.1` → exit 0 after 1,241 ms, `listen EADDRNOTAVAIL` — a success code on a failure. Now
 * the handler prints ONE line, `tmux-agent web: listen <CODE> on <host>:<port> — <reason>`, and exits 71 (EX_OSERR)
 * while the socket is not yet listening; once it is, an error (accept EMFILE under fd pressure) is rethrown to the
 * boundary as before — the review lane of the fix caught that exiting there would take a live dashboard down.
 *
 * The contract, each a check that FAILS if the property is removed:
 *   (a) EACCES planted on the dashboard's listen() — test/fixtures/fail-listen.cjs via NODE_OPTIONS=--require; the
 *       finder's probes pass through and the fixture's log proves the plant bit (and names the port it bit on): exit 71
 *       inside the bound, the one stderr line names EACCES and 127.0.0.1:<port>, NO banner, NO `uncaughtException`, and
 *       the temp home's ledger holds ZERO control.denied events from actor web (the parent's held one per failed listen);
 *   (b) the real path, nothing planted: --strict-port --dangerously-allow-remote --token <typed> --host 192.0.2.1
 *       (TEST-NET-1, on no machine; --strict-port skips the finder — until TMUX-180 the finder treated every probe error
 *       as "busy" and exited 1 with `no free port`; case (f) is the same path through it now) → exit 71 naming
 *       EADDRNOTAVAIL and 192.0.2.1:<port>, no banner, ledger clean;
 *   (c) the handled sibling unchanged: the port HELD by this suite, --strict-port → exit 75 with today's message;
 *   (d) control, nothing planted: the banner, then ONE no-retry fetch on it → 200 (TMUX-178's (c) shape);
 *   (e) a RUNNING daemon's error is not an exit: the fixture binds normally and emits `accept EMFILE` 300 ms after
 *       `listening` — the daemon still answers one fetch 200, its process is alive, and the ledger holds exactly ONE
 *       control.denied from actor web (the boundary's record of the rethrow).
 *
 * The same failure ONE flag away: without --strict-port the web verb runs findFreePort (src/web/server.ts)
 * first, and until 2026-09-30 its probe handler advanced on ANY error — twenty EACCES probes on 80..99 gave up with `no
 * free port in 80..99 on 127.0.0.1`, exit 1 through main()'s catch, EACCES named nowhere: port pressure blamed for a
 * permission error, an operator sent looking for a squatter (measured on the built 755b006 CLI, 237th GA fire,
 * scratch/ga-fire-2026-09-30-06Z/probe-finder.log: 20 listen() calls in 81 ms; `--host 192.0.2.1` with both remote
 * flags, 20 EADDRNOTAVAIL in 83 ms; the same two under --strict-port, one listen() and exit 71). Now only EADDRINUSE
 * moves the scan on; anything else rejects at once and the verb prints the one line above and exits 71. Each case
 * counts the CLI's listen() calls through test/fixtures/count-listen.cjs (a preload that plants nothing unless asked):
 *   (f) nothing planted, --dangerously-allow-remote --token <typed> --host 192.0.2.1, NO --strict-port → exit 71 naming
 *       EADDRNOTAVAIL and 192.0.2.1:<port> after ONE listen(), never `no free port`;
 *   (g) --no-token --port 80, NO --strict-port → exit 71 naming EACCES and 127.0.0.1:<port> after ONE listen(), never
 *       `no free port` — the kernel's own refusal where it refuses this user the port (a Linux runner as a normal user,
 *       ip_unprivileged_port_start 1024), the fixture's EACCES on an OS-released port where it does not (macOS grants any
 *       user the low ports since 10.14; root; a container at 0) or a service owns 80 — the diagnostic says which;
 *   (h) the designed case unchanged: the port HELD here → `port <p> busy — using <q>`, the banner on q > p, one fetch there
 *       200, the first probe error EADDRINUSE on p and no other code scanned past;
 *   (i) EADDRINUSE is still the one error that scans: twenty consecutive ports HELD from p → exit 1 with the finder's own
 *       `no free port in p..p+19 on 127.0.0.1`, twenty listen() calls, every probe error EADDRINUSE, no banner.
 *   (j) the fixture's plant on EVERY lane: (g)'s plant arm runs only where the kernel grants this user port 80,
 *       and no lane the suite runs on does — both CI OS lanes and the release host refuse it, so the plant branch of
 *       test/fixtures/count-listen.cjs (lines 40–46) had been measured once, by hand, and a plant that stopped biting
 *       would have reddened nothing. Here EACCES is planted on the finder's probe at an OS-released port unconditionally
 *       → exit 71 naming EACCES and 127.0.0.1:<port> with the fixture's own reason (`planted by count-listen.cjs`), the
 *       count log exactly the probe's listen() and its planted refusal, ONE listen(), no banner, never `no free port`.
 *
 * FAIL-first on the parent 5cdc831 (this suite against the parent's own dist/, scratch/ga-fire-2026-09-30-04Z/
 * red-parent.log), 2 of 4 red: (a) `exit 0 after 1239 ms` with stderr `[web] uncaughtException: listen EACCES: planted by
 * fail-listen.cjs 127.0.0.1:<port>` and ONE control.denied from actor web in the ledger — the fixture's log showing the
 * finder's probe passed through and the dashboard's listen planted; (b) `exit 0 after 1239 ms`, `listen EADDRNOTAVAIL:
 * address not available 192.0.2.1:<port>`, one control.denied; (c) exit 75 after 82 ms and (d) 200 in 33 ms green, as
 * the card predicted. (e) was watched red on the fix's FIRST cut (red-e-firstcut.log), whose handler exited 71 on every
 * error: the daemon died 71 on the planted accept error — the finding that added the `server.listening` guard.
 *
 * FAIL-first for (f)–(i) on the parent 374d33e (this file against the parent's own dist, built at the 12:23Z preflight;
 * scratch/ga-fire-2026-09-30-12Z/red-parent.log), 2 of 4 red as the card predicted: (f) `no free port in 32931..32950 on
 * 192.0.2.1` after 20 listen() calls, every probe error EADDRNOTAVAIL; (g) the kernel's EACCES on 80, then `no free port
 * in 80..99 on 127.0.0.1` after 20 calls; (h) and (i) green — the designed case and the give-up are what the fix keeps.
 * On the fix (green-fix.log): (f) one listen(), exit 71 in 75 ms; (g) one listen(), exit 71 in 73 ms; (h) held 36315 →
 * `busy — using 36316`, the banner there, one fetch 200 in 7 ms; (i) 20 calls, exit 1 in 79 ms.
 *
 * FAIL-first for (j) (scratch/ga-fire-2026-10-01-00Z/red-noplant.log): this file beside a copy of the fixture with its plant
 * branch deleted (count-listen.cjs lines 39–46, the whole `if (plant && probe)` block; the tree's own dist, every other
 * test/ file identical) — the probe reached the kernel and bound the released port (`listen 34697 … request-listeners=0`),
 * the dashboard followed it onto the same port (`listen 34697 … request-listeners=1`), the banner PRINTED and the daemon
 * was SIGKILLed at the 5 s bound (exit null after 5012 ms): RED on the log's second line, 0/1. On the shipped fixture
 * (control-plant.log) 1/1: exit 71 after 71 ms, banner none, the log exactly the probe and its planted refusal.
 *
 * Run: node --test test/web-listen-error.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// copyTree/freePort/startWeb/stopWeb are the built-daemon harness shared with test/web-banner-listening.test.js — see helpers/built-web.js
import { copyTree, freePort, startWeb, stopWeb } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(TEST_DIR, "fixtures", "fail-listen.cjs");
/** How long a failed bind has to EXIT (the card's criterion 3: "within 5 s") — stated once, named in the failure. */
const EXIT_BOUND_MS = 5_000;
/** After SIGKILL at the bound, how long the streams get to drain before the result is reported without them. */
const DRAIN_MS = 1_000;
/** Case (e): how long after `listening` the fixture emits the running daemon's accept error, and how long the suite waits for it. */
const ACCEPT_AFTER_MS = 300;
const ACCEPT_WAIT_MS = 5_000;
/** The two codes startWeb's handler exits with — the source states each once (src/web/server.ts), this file pins them. */
const EX_OSERR = 71;
const EX_TEMPFAIL = 75;
const BANNER = /dashboard: http:\/\//;

const tree = copyTree(); // a COPY of dist/: the repo's own stamp is read by every other suite running in parallel
after(() => { rmSync(tree, { recursive: true, force: true }); removeTempHomes(); }); // every home this file made

/** The fixture's environment for one daemon: preloaded via NODE_OPTIONS (APPENDED — a coverage run's own options stay). */
function planted(home, code, { acceptAfterMs = 0 } = {}) {
  return {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${FIXTURE}`].filter(Boolean).join(" "),
    TA_FAIL_LISTEN_CODE: code,
    TA_FAIL_ACCEPT_AFTER_MS: String(acceptAfterMs),
    TA_FAIL_LISTEN_LOG: join(home, "fail-listen.log"),
  };
}
const fixtureLog = (home) => (existsSync(join(home, "fail-listen.log")) ? readFileSync(join(home, "fail-listen.log"), "utf8").trim().split("\n") : []);

/**
 * Run the built `web` verb from `tree` on `home` until it EXITS (helpers/built-web.js's argv, but its startWeb() resolves
 * on the banner, which these cases must never print) and resolve `{ code, signal, stdout, stderr, ms }` once both streams
 * have closed. A child still running at `boundMs` is SIGKILLed and reported with `signal` — the shape of the drained
 * loop's opposite failure, a daemon that served after a failed bind; its streams get DRAIN_MS to close, then the result
 * is reported with what arrived. Tokens are redacted from anything reported.
 */
function runToExit(home, env, args, { boundMs = EXIT_BOUND_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(tree, "dist", "bin", "tmux-agent.js"), "--socket", `ta-built-${process.pid}`, "--actor", "built-test", "web", ...args],
      { env: { ...process.env, TMUX_AGENT_HOME: home, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    const t0 = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;
    let drain = null;
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      clearTimeout(drain);
      const redact = (s) => s.replace(/token=\S+/g, "token=<redacted>");
      resolve({ code, signal, stdout: redact(stdout), stderr: redact(stderr), ms: Date.now() - t0 });
    };
    const bound = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, boundMs);
    child.once("exit", (code, signal) => { if (killed) drain = setTimeout(() => finish(code, signal), DRAIN_MS); });
    child.once("close", finish);
  });
}

/** stderr as the lines that are ABOUT the bind: node's own process warnings (and their `(Use \`node …\`)` hint) and the finder's `busy — using` line are not. */
const failureLines = (stderr) => stderr.trim().split("\n").filter((l) => l.length > 0 && !l.startsWith("(node:") && !l.startsWith("(Use `node") && !/ busy — using /.test(l));

/** Every control.denied event actor `web` wrote into `home`'s ledger — the boundary's record of a swallowed throw. */
function webDenials(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).flatMap((f) =>
    readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => e.type === "control.denied" && e.actor === "web"));
}

/** ONE GET /api/health on `port`, no retry: the request a client makes when it takes the banner at its word. */
async function oneFetch(port) {
  const t0 = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: null, error: e.cause?.code ?? e.message, ms: Date.now() - t0 };
  }
}

/** Bind 127.0.0.1:0 and KEEP it — a port the OS cannot hand out while held; every connection is dropped at once. */
function holdPort() {
  return new Promise((resolve, reject) => {
    const s = createServer((c) => c.destroy());
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve({ port: s.address().port, close: () => new Promise((r) => s.close(() => r())) }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The assertions (a) and (b) share: exited inside the bound with the named code, one line naming the bind, no banner, no swallowed throw. */
function assertFailedBind(t, r, home, { code, host, port }) {
  const where = `${host}:${port}`;
  const denials = webDenials(home);
  t.diagnostic(`exit ${r.code}${r.signal ? ` (${r.signal})` : ""} after ${r.ms} ms; stderr: ${JSON.stringify(failureLines(r.stderr))}; ledger control.denied from web: ${denials.length}`);
  assert.equal(r.signal, null, `the CLI was still running ${r.ms} ms after its bind failed (SIGKILLed at the ${EXIT_BOUND_MS} ms bound) — stderr so far: ${JSON.stringify(r.stderr)}`);
  assert.ok(!BANNER.test(r.stdout + r.stderr), `a banner printed for a socket that never bound: ${JSON.stringify(r.stderr)}`);
  assert.ok(!/uncaughtException/.test(r.stderr), `the throw reached the boundary — stderr: ${JSON.stringify(r.stderr)}`);
  assert.notEqual(r.code, 0, `exit 0 after ${r.ms} ms with stderr ${JSON.stringify(r.stderr)} — a success code on a failed bind`);
  assert.equal(r.code, EX_OSERR, `exit ${r.code}, not ${EX_OSERR} (EX_OSERR) — stderr: ${JSON.stringify(r.stderr)}`);
  const lines = failureLines(r.stderr);
  assert.equal(lines.length, 1, `expected ONE line about the bind, got ${lines.length}: ${JSON.stringify(lines)}`);
  assert.match(lines[0], new RegExp(`^tmux-agent web: listen ${code} on ${where.replace(/\./g, "\\.")} — \\S`), `the line does not name the code, host and port with a reason: ${JSON.stringify(lines[0])}`);
  assert.equal(r.stdout, "", `stdout was not empty: ${JSON.stringify(r.stdout)}`);
  assert.equal(denials.length, 0, `the ledger holds ${denials.length} control.denied from actor web — the boundary swallowed the bind error: ${JSON.stringify(denials.map((d) => d.data?.boundary?.message))}`);
}

test("(a) EACCES planted on the dashboard's listen(): exit 71 inside the bound, one line naming EACCES and 127.0.0.1:<port>, no banner, no uncaughtException, the ledger clean", async (t) => {
  const home = tempHome("ta-wle-a-");
  const requested = await freePort();
  const r = await runToExit(home, planted(home, "EACCES"), ["--no-token", "--port", String(requested)]);
  const log = fixtureLog(home);
  const plant = log.find((l) => l.includes("(http.Server: the dashboard) -> planted EACCES"));
  assert.ok(plant, `the fixture never bit — no dashboard listen() was planted (log: ${JSON.stringify(log)})`);
  // The port the handler names is the one the finder settled on — the requested one unless a stranger took it in the
  // gap between freePort() releasing it and the finder's probe — so it is read from the plant, never assumed.
  const port = Number(/listen requested=(\d+)/.exec(plant)[1]);
  t.diagnostic(`requested ${requested}, planted on ${port}; fixture: ${log.join(" | ")}`);
  assertFailedBind(t, r, home, { code: "EACCES", host: "127.0.0.1", port });
});

test("(b) the real path, nothing planted — --strict-port --dangerously-allow-remote --token <typed> --host 192.0.2.1: exit 71 naming EADDRNOTAVAIL and 192.0.2.1:<port>, no banner, the ledger clean", async (t) => {
  const home = tempHome("ta-wle-b-");
  const port = await freePort();
  const r = await runToExit(home, {}, ["--strict-port", "--dangerously-allow-remote", "--token", "wle-typed-not-the-stored-one", "--host", "192.0.2.1", "--port", String(port)]);
  assertFailedBind(t, r, home, { code: "EADDRNOTAVAIL", host: "192.0.2.1", port });
});

test("(c) the handled sibling unchanged — the port HELD here, --strict-port: exit 75 with today's message, no banner", async (t) => {
  const hold = await holdPort();
  const home = tempHome("ta-wle-c-");
  try {
    const r = await runToExit(home, {}, ["--no-token", "--strict-port", "--port", String(hold.port)]);
    t.diagnostic(`exit ${r.code}${r.signal ? ` (${r.signal})` : ""} after ${r.ms} ms; stderr: ${JSON.stringify(failureLines(r.stderr))}`);
    assert.equal(r.signal, null, `the CLI was still running ${r.ms} ms after EADDRINUSE`);
    assert.equal(r.code, EX_TEMPFAIL, `exit ${r.code}, not ${EX_TEMPFAIL} (EX_TEMPFAIL) — stderr: ${JSON.stringify(r.stderr)}`);
    assert.match(r.stderr, new RegExp(`^tmux-agent web: port ${hold.port} already in use on 127\\.0\\.0\\.1 — pick another with --port`, "m"), `today's EADDRINUSE message moved: ${JSON.stringify(r.stderr)}`);
    assert.ok(!BANNER.test(r.stdout + r.stderr), `a banner printed for a held port: ${JSON.stringify(r.stderr)}`);
    assert.equal(webDenials(home).length, 0, "the EADDRINUSE path wrote a control.denied");
  } finally {
    await hold.close();
  }
});

test("(d) control — nothing planted: the banner, then ONE fetch on it, no retry, is 200", async (t) => {
  const home = tempHome("ta-wle-d-");
  let child = null;
  try {
    const r = await startWeb(tree, home, {}, ["--no-token"]);
    child = r.child;
    const got = await oneFetch(r.port);
    t.diagnostic(`banner port ${r.port}; one fetch → ${got.status ?? got.error} in ${got.ms} ms`);
    assert.equal(got.status, 200, `one fetch on the banner line → ${got.status ?? got.error} after ${got.ms} ms`);
  } finally {
    await stopWeb(child);
  }
});

test("(e) a RUNNING daemon's error is the boundary's, not an exit — accept EMFILE planted 300 ms after listening: the daemon still answers 200, its process is alive, the ledger holds ONE control.denied from web", async (t) => {
  const home = tempHome("ta-wle-e-");
  let child = null;
  try {
    const r = await startWeb(tree, home, planted(home, "EMFILE", { acceptAfterMs: ACCEPT_AFTER_MS }), ["--no-token"]);
    child = r.child;
    const fired = () => fixtureLog(home).some((l) => l.includes("accept EMFILE emitted on the listening dashboard"));
    const t0 = Date.now();
    while (!fired() && Date.now() - t0 < ACCEPT_WAIT_MS) await sleep(50);
    const log = fixtureLog(home);
    assert.ok(fired(), `the fixture never bit — no accept error was emitted within ${ACCEPT_WAIT_MS} ms of listening (log: ${JSON.stringify(log)})`);
    await sleep(200); // the boundary's ledger write, or the exit this case forbids, lands
    const got = await oneFetch(r.port);
    const denials = webDenials(home);
    t.diagnostic(`banner port ${r.port}; accept EMFILE emitted; one fetch → ${got.status ?? got.error} in ${got.ms} ms; exitCode ${child.exitCode}; ledger control.denied from web: ${denials.length} (${denials.map((d) => d.data?.boundary?.message).join("; ")})`);
    assert.equal(child.exitCode, null, `the daemon exited ${child.exitCode} on a running server's accept error — the bind handler took a live dashboard down`);
    assert.equal(got.status, 200, `the daemon stopped answering after the accept error: ${got.status ?? got.error} after ${got.ms} ms`);
    assert.equal(denials.length, 1, `expected ONE control.denied from actor web (the boundary's record of the rethrow), got ${denials.length}`);
    assert.match(denials[0].data?.boundary?.message ?? "", /accept EMFILE/, `the recorded message is not the accept error: ${JSON.stringify(denials[0])}`);
  } finally {
    await stopWeb(child);
  }
});

// ---- TMUX-180: the same failure ONE flag away — through the default finder, not --strict-port ----------------------------

/** The counting fixture: one log line per listen() the built CLI makes; `plant` names a code the finder's probes meet instead of the kernel's answer. */
const COUNT_FIXTURE = join(TEST_DIR, "fixtures", "count-listen.cjs");
function counted(home, plant = "") {
  return {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${COUNT_FIXTURE}`].filter(Boolean).join(" "),
    TA_COUNT_LISTEN_LOG: join(home, "count-listen.log"),
    TA_COUNT_LISTEN_PLANT: plant,
  };
}
const countLog = (home) => (existsSync(join(home, "count-listen.log")) ? readFileSync(join(home, "count-listen.log"), "utf8").trim().split("\n").filter(Boolean) : []);
const listens = (log) => log.filter((l) => l.startsWith("listen "));
const probeErrors = (log) => log.filter((l) => l.startsWith("error "));
/** The finder's window (src/web/server.ts findFreePort, tries = 20) — test/built-web-port.test.js states the same number for the same reason. */
const FINDER_WIDTH = 20;
/** How long the designed case's daemon has to print its banner — the built-daemon harness's own bound (helpers/built-web.js). */
const BANNER_BOUND_MS = 20_000;
const BANNER_PORT = /dashboard: http:\/\/127\.0\.0\.1:(\d+)\//;

/**
 * Run the built `web` verb from `tree` on `home` until its BANNER — the daemon is returned live, with everything both
 * streams printed before it (the finder's `busy — using` line comes first) — or until it exits or `boundMs` passes
 * (SIGKILL, `timedOut`). Tokens are redacted from anything reported.
 */
function runToBanner(home, env, args, { boundMs = BANNER_BOUND_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(tree, "dist", "bin", "tmux-agent.js"), "--socket", `ta-built-${process.pid}`, "--actor", "built-test", "web", ...args],
      { env: { ...process.env, TMUX_AGENT_HOME: home, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let done = false;
    const redact = (s) => s.replace(/token=\S+/g, "token=<redacted>");
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve({ child, out: redact(out), ...v }); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ port: null, code: null, timedOut: true }); }, boundMs);
    const onData = (d) => { out += String(d); const m = BANNER_PORT.exec(out); if (m) finish({ port: Number(m[1]), code: null }); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => finish({ port: null, code }));
  });
}

/** Bind 127.0.0.1:port and resolve the server (the caller closes it), or reject with the OS's own error; every connection is dropped at once. */
const bind = (port) => new Promise((resolve, reject) => {
  const s = createServer((c) => c.destroy());
  s.once("error", reject);
  s.listen(port, "127.0.0.1", () => resolve(s));
});
const closeAll = (servers) => Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));

/**
 * Hold `width` consecutive loopback ports from a base the OS just released — the finder's whole window, in use. A base
 * whose run a stranger has already broken is released and drawn again (bounded), so the plant is real when this returns.
 */
async function holdBlock(width, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const first = await holdPort();
    const held = [];
    try {
      for (let p = first.port + 1; p < first.port + width; p++) held.push(await bind(p));
      return { base: first.port, release: async () => { await closeAll(held); await first.close(); } };
    } catch {
      await closeAll(held);
      await first.close();
    }
  }
  throw new Error(`could not hold ${width} consecutive loopback ports in ${tries} draws — too crowded a host to plant the shape`);
}

/**
 * What THIS host's kernel says to this user about port 80 — EACCES (a Linux runner as a normal user, ip_unprivileged_port_start
 * 1024: the plant case (g) wants, the kernel's own), or `bound` (macOS grants any user the low ports since 10.14; root has
 * them everywhere; a container whose ip_unprivileged_port_start is 0 hands them out), or another code (EADDRINUSE: a service
 * already owns it). One bare listen(), closed at once if it bound.
 */
function lowPortAnswer(port = 80) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", (e) => resolve({ code: e.code }));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve({ bound: true })));
  });
}

test("(f) the default finder, nothing planted — --dangerously-allow-remote --token <typed> --host 192.0.2.1, NO --strict-port: exit 71 naming EADDRNOTAVAIL and 192.0.2.1:<port> after ONE listen(), never `no free port`", async (t) => {
  const home = tempHome("ta-wle-f-");
  const port = await freePort();
  const r = await runToExit(home, counted(home), ["--dangerously-allow-remote", "--token", "wle-typed-not-the-stored-one", "--host", "192.0.2.1", "--port", String(port)]);
  const log = countLog(home);
  t.diagnostic(`listen() calls ${listens(log).length}, probe errors ${probeErrors(log).length}: ${log.join(" | ")}`);
  assert.ok(listens(log).length > 0, `the counting fixture never bit — no listen() was recorded (log: ${JSON.stringify(log)})`);
  assert.doesNotMatch(r.stderr, /no free port/, `the finder blamed port pressure for a host that is not on this machine: ${JSON.stringify(r.stderr)}`);
  assertFailedBind(t, r, home, { code: "EADDRNOTAVAIL", host: "192.0.2.1", port });
  assert.equal(listens(log).length, 1, `the finder made ${listens(log).length} listen() calls before giving its answer — one probe IS the answer: ${JSON.stringify(log)}`);
  assert.match(probeErrors(log)[0] ?? "", new RegExp(`^error ${port} 192\\.0\\.2\\.1 code=EADDRNOTAVAIL$`), `the one probe's error is not the kernel's EADDRNOTAVAIL on ${port}: ${JSON.stringify(log)}`);
});

test("(g) the default finder on a privileged port — web --no-token --port 80, NO --strict-port: exit 71 naming EACCES and 127.0.0.1:<port> after ONE listen(), never `no free port` (the kernel's own refusal where it refuses this user the port; the fixture's where it grants it)", async (t) => {
  const home = tempHome("ta-wle-g-");
  const kernel = await lowPortAnswer(80);
  // The property — one probe, the code named, exit 71 — is checked on every host: where the kernel refuses this user port
  // 80 the case runs on 80 with nothing planted; where it does not (or a service owns the port) the probe's listen() is
  // planted EACCES by the fixture on an OS-released port instead, and the diagnostic says which plant it was.
  const planted = kernel.code !== "EACCES";
  const port = planted ? await freePort() : 80;
  const r = await runToExit(home, counted(home, planted ? "EACCES" : ""), ["--no-token", "--port", String(port)]);
  const log = countLog(home);
  t.diagnostic(`kernel on 127.0.0.1:80 → ${kernel.bound ? "bound (granted to this user)" : kernel.code}; plant: ${planted ? `the fixture's EACCES on ${port}` : "the kernel's own, port 80"}; listen() calls ${listens(log).length}: ${log.join(" | ")}`);
  assert.ok(listens(log).length > 0, `the counting fixture never bit — no listen() was recorded (log: ${JSON.stringify(log)})`);
  if (planted) assert.ok(log.includes(`error ${port} 127.0.0.1 code=EACCES planted`), `the fixture never planted EACCES on the probe (log: ${JSON.stringify(log)})`);
  assert.doesNotMatch(r.stderr, /no free port/, `the finder blamed port pressure for a permission error: ${JSON.stringify(r.stderr)}`);
  assertFailedBind(t, r, home, { code: "EACCES", host: "127.0.0.1", port });
  assert.equal(listens(log).length, 1, `the finder made ${listens(log).length} listen() calls before giving its answer — one probe IS the answer: ${JSON.stringify(log)}`);
});

test("(h) the designed case unchanged — the port HELD here, no --strict-port: `port <p> busy — using <q>`, the banner on q > p, one fetch there 200, the first probe error EADDRINUSE on p and no other code scanned past", async (t) => {
  const hold = await holdPort();
  const home = tempHome("ta-wle-h-");
  let child = null;
  try {
    const r = await runToBanner(home, counted(home), ["--no-token", "--port", String(hold.port)]);
    child = r.child;
    const log = countLog(home);
    t.diagnostic(`held ${hold.port}; banner port ${r.port ?? "none"}${r.timedOut ? " (timed out)" : r.code !== null ? ` (exit ${r.code})` : ""}; log: ${log.join(" | ")}`);
    assert.ok(r.port !== null, `no banner: ${r.timedOut ? `still no banner after ${BANNER_BOUND_MS} ms` : `exit ${r.code}`} — output ${JSON.stringify(r.out)}`);
    assert.notEqual(r.port, hold.port, `the banner names the held port ${hold.port}`);
    assert.ok(r.port > hold.port, `the banner's port ${r.port} is not forward of the held ${hold.port}`);
    assert.match(r.out, new RegExp(`^tmux-agent web: port ${hold.port} busy — using ${r.port}$`, "m"), `the busy line does not name the held port and the banner's: ${JSON.stringify(r.out)}`);
    const got = await oneFetch(r.port);
    t.diagnostic(`one fetch on ${r.port} → ${got.status ?? got.error} in ${got.ms} ms`);
    assert.equal(got.status, 200, `one fetch on the banner's port → ${got.status ?? got.error} after ${got.ms} ms`);
    assert.match(probeErrors(log)[0] ?? "", new RegExp(`^error ${hold.port} 127\\.0\\.0\\.1 code=EADDRINUSE$`), `the first probe's error is not EADDRINUSE on the held ${hold.port}: ${JSON.stringify(log)}`);
    assert.ok(probeErrors(log).every((l) => / code=EADDRINUSE$/.test(l)), `a probe error other than EADDRINUSE was scanned past: ${JSON.stringify(probeErrors(log))}`);
  } finally {
    await stopWeb(child);
    await hold.close();
  }
});

test("(i) EADDRINUSE is still the one error that scans — twenty consecutive ports HELD from p, no --strict-port: exit 1 with the finder's `no free port in p..p+19 on 127.0.0.1`, twenty listen() calls, every probe error EADDRINUSE, no banner", async (t) => {
  const block = await holdBlock(FINDER_WIDTH);
  const home = tempHome("ta-wle-i-");
  const last = block.base + FINDER_WIDTH - 1;
  try {
    const r = await runToExit(home, counted(home), ["--no-token", "--port", String(block.base)]);
    const log = countLog(home);
    t.diagnostic(`held ${block.base}..${last}; exit ${r.code}${r.signal ? ` (${r.signal})` : ""} after ${r.ms} ms; listen() calls ${listens(log).length}, probe errors ${probeErrors(log).length}; stderr: ${JSON.stringify(failureLines(r.stderr))}`);
    assert.equal(r.signal, null, `the CLI was still running ${r.ms} ms into a fully held window (SIGKILLed at the ${EXIT_BOUND_MS} ms bound)`);
    assert.ok(!BANNER.test(r.stdout + r.stderr), `a banner printed inside a held window: ${JSON.stringify(r.stderr)}`);
    assert.equal(r.code, 1, `exit ${r.code}, not 1 — the scan's own give-up is main()'s catch and stays: ${JSON.stringify(r.stderr)}`);
    assert.match(r.stderr, new RegExp(`^no free port in ${block.base}\\.\\.${last} on 127\\.0\\.0\\.1$`, "m"), `the give-up moved: ${JSON.stringify(r.stderr)}`);
    assert.equal(listens(log).length, FINDER_WIDTH, `${listens(log).length} listen() calls, not ${FINDER_WIDTH} — the window moved: ${JSON.stringify(log)}`);
    assert.equal(probeErrors(log).length, FINDER_WIDTH, `${probeErrors(log).length} probe errors, not ${FINDER_WIDTH}: ${JSON.stringify(log)}`);
    assert.ok(probeErrors(log).every((l) => / code=EADDRINUSE$/.test(l)), `a probe error other than EADDRINUSE inside the held window: ${JSON.stringify(probeErrors(log))}`);
  } finally {
    await block.release();
  }
});

test("(j) the fixture's plant on EVERY lane — EACCES planted on the finder's probe at an OS-released port, no --strict-port: exit 71 naming EACCES and 127.0.0.1:<port> with the fixture's own reason, the count log exactly the probe's listen() and its planted refusal, ONE listen(), never `no free port`", async (t) => {
  const home = tempHome("ta-wle-j-");
  // (g) plants only where the kernel grants this user port 80, and no lane the suite runs on does — so the fixture's plant
  // branch (test/fixtures/count-listen.cjs, `if (plant && probe)`) had been measured once, by hand, until this case: the
  // plant is unconditional here, on a port the OS just released. The fixture answers before the kernel is asked, so no
  // stranger can take the port in the gap and the port in every line below is the one requested.
  const port = await freePort();
  const r = await runToExit(home, counted(home, "EACCES"), ["--no-token", "--port", String(port)]);
  const log = countLog(home);
  t.diagnostic(`planted the fixture's EACCES on ${port}; exit ${r.code}${r.signal ? ` (${r.signal})` : ""} after ${r.ms} ms; banner ${BANNER.test(r.stdout + r.stderr) ? "PRINTED" : "none"}; listen() calls ${listens(log).length}: ${log.join(" | ")}`);
  assert.ok(listens(log).length > 0, `the counting fixture never bit — no listen() was recorded (log: ${JSON.stringify(log)})`);
  assert.deepEqual(log, [`listen ${port} 127.0.0.1 request-listeners=0`, `error ${port} 127.0.0.1 code=EACCES planted`], `the log is not exactly the finder's one probe and the fixture's planted refusal of it: ${JSON.stringify(log)}`);
  assert.doesNotMatch(r.stderr, /no free port/, `the finder blamed port pressure for a planted permission error: ${JSON.stringify(r.stderr)}`);
  assertFailedBind(t, r, home, { code: "EACCES", host: "127.0.0.1", port });
  assert.equal(failureLines(r.stderr)[0], `tmux-agent web: listen EACCES on 127.0.0.1:${port} — planted by count-listen.cjs`, `the one line's reason is not the fixture's own — whatever refused the bind, it was not the plant: ${JSON.stringify(failureLines(r.stderr))}`);
  assert.equal(listens(log).length, 1, `the finder made ${listens(log).length} listen() calls before giving its answer — one probe IS the answer: ${JSON.stringify(log)}`);
});
