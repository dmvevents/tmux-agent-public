/**
 * `doctor` sees the running daemon (TMUX-93, gate G3 "failure modes observable").
 *
 * Measured 2026-09-12 04:26Z on this host (scratch/ga-fire-2026-09-12-04Z/: doctor-raw.txt beside
 * live-measurements.txt, same minute): the operator's dashboard — pid 828683, up 16 d on build
 * 37239eb at the web verb's default port, its token in the same home — served /api/health with no
 * `build` key, while `doctor` on that disk printed `build.commit dcba589` and not a word about the
 * daemon. TMUX-92's stale alarm runs INSIDE the daemon, so a daemon older than the stamp can never
 * raise it: the observable that says "restart" only existed after the restart. doctor is the verb
 * the README sends a stranger to; it reported the disk as if it were the product.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) no listener on the port → dashboard.reachable false, stale null, exit 0 — a missing daemon
 *       is a report, never a failure;
 *   (b) the built dashboard (token on) from a COPY of dist/ → reachable, its build is the on-disk
 *       stamp, stale false; the token is in neither stdout nor stderr;
 *   (c) the copy's dist/build.json rewritten → stale true NOW (disk vs the daemon's word, no wait
 *       for the daemon's own tick), onDisk carries the new commit;
 *   (d) a loopback stub answering with the 2026-08-26 key set (no build) → reachable, build null,
 *       stale null, reason names "predates the build stamp" and the on-disk commit; the request
 *       carried the home's token as a Bearer header;
 *   (e) a home whose web-token does not match (or has none) → the 401 path: reachable, build null,
 *       reason names unauthorized and the token file; neither token appears in the output;
 *   (f) the probe's host is the literal 127.0.0.1 — asserted on the dist/ source: no flag, no env,
 *       and doctor passes the module no host;
 *   (g) a listener that never answers → reachable false within the timeout, reason names it —
 *       doctor must not hang on a wedged daemon;
 *   (h) the verdict is the CLI's own: a daemon build that differs from THIS dist/ is stale even
 *       when the daemon says stale:false; one that matches is not; a daemon saying stale:true is;
 *   (i) TMUX-115 — `dashboard.tmux` is the daemon's own /api/health.tmux (`{ reachable, since, error,
 *       checkedAt }`, its last fleet poll), null when the daemon does not report it, and `reason`
 *       ends with one clause: `; tmux server UNREACHABLE since <since> (<error>)`, `; tmux server
 *       reachable`, or `; tmux status not reported by this daemon`. Asserted on the built dashboard
 *       in (b) (a live session on its socket → reachable + clause), on the 2026-08-26 stub in (d)
 *       (null + not-reported clause) and against stubs for all three clauses. Exit code unchanged.
 *       Measured 2026-09-16 on 854c572: after kill-server the daemon's tick had ledgered fleet.tmux
 *       and paged within 3 s while doctor said "dashboard runs the build on disk" and nothing else.
 *
 * FAIL-first on HEAD 8e4dc96 (dist built from it): doctor has no `dashboard` key — (a) fails at
 * its first assertion; (f) fails on a missing dist/core/dashboard-probe.js (output on TMUX-93).
 * FAIL-first for (i) on the parent 1da4d6c dist: `dashboard has no tmux block` in (b), the reason
 * without a clause in (d), `dashboard.tmux` undefined against the stubs (output on TMUX-115).
 *
 *   (j) a stamp rewritten under the daemon at the SAME commit (new builtAt) → stale true and the reason
 *       names both build times, never `runs X and dist/ has X` — the alarm's common shape on a host where
 *       every `npm test` rebuilds dist/ at HEAD (TMUX-162; the parent 80f97bb read exactly that).
 * Run: node --test test/doctor-dashboard.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, copyTree, startWeb, stopWeb } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const readStamp = (tree = ROOT) => JSON.parse(readFileSync(join(tree, "dist", "build.json"), "utf8"));
const tmpHome = (tag) => mkdtempSync(join(tmpdir(), `ta-doctor-${tag}-`));

/**
 * Run `doctor --port <port>` from `tree`'s build on `home`: { status, stdout, stderr, doctor }.
 * Async on purpose: the stubs below live in THIS process, and a spawnSync would block the event
 * loop they answer from — every stub test then reads as "a listener that never answers".
 */
function doctor(home, port, tree = ROOT) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(tree, "dist", "bin", "tmux-agent.js"), "--socket", `ta-doctor-none-${process.pid}`, "doctor", "--port", String(port)], {
      env: { ...process.env, TMUX_AGENT_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.once("error", reject);
    p.once("close", (status) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* asserted by the caller */ }
      resolve({ status, stdout, stderr, doctor: parsed });
    });
  });
}

/** A loopback port nothing listens on (bound once, released) — the probe must find it refused. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createTcpServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** A loopback HTTP stub standing in for a daemon; every request's url + headers are recorded. */
function stub(handler) {
  return new Promise((resolve, reject) => {
    const requests = [];
    const s = createServer((req, res) => { requests.push({ url: req.url, headers: req.headers }); handler(req, res); });
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve({
      port: s.address().port,
      requests,
      close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }),
    }));
  });
}
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
/** /api/health as the 2026-08-26 build served it — the key set measured live, no `build`, no `ledger`. */
const OLD_HEALTH = () => ({ disk: [], lastCrash: null, load: [0, 0, 0], mem: { totalBytes: 1, availableBytes: 1 }, mode: "proc", prediction: null, sampledAt: new Date().toISOString(), swap: { totalBytes: 0, freeBytes: 0 }, uptimeSec: 1 });

// ---------------------------------------------------------------------------------------------
// (a) nothing listening
// ---------------------------------------------------------------------------------------------
test("doctor: no dashboard on the port → dashboard.reachable false, build null, stale null, exit 0 — a missing daemon is a report, not a failure", async () => {
  const home = tmpHome("none");
  const port = await freePort();
  try {
    const r = await doctor(home, port);
    assert.equal(r.status, 0, `doctor exited ${r.status}: ${r.stderr}`);
    assert.ok(r.doctor?.dashboard, `doctor has no dashboard key — keys: ${Object.keys(r.doctor ?? {}).join(",")}`);
    const d = r.doctor.dashboard;
    assert.equal(d.url, `http://127.0.0.1:${port}/api/health`);
    assert.equal(d.reachable, false);
    assert.equal(d.build, null);
    assert.equal(d.stale, null, "stale cannot be judged without a daemon — null, never false");
    assert.match(d.reason, new RegExp(`no dashboard on 127\\.0\\.0\\.1:${port}`));
    const s = readStamp();
    assert.deepEqual(d.onDisk, { commit: s.commit, builtAt: s.builtAt }, "onDisk is still reported — it is what a restart would run");
    assert.equal(d.tmux, null, "no daemon answered — no tmux verdict to report, null");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (b) + (c) the real built dashboard, token on, from a tree copy
// ---------------------------------------------------------------------------------------------
test("doctor: the built dashboard (token on) → reachable, build = the on-disk stamp, stale false, token never printed, its tmux server reachable + the clause; a stamp rewritten under it → stale true NOW, onDisk the new commit", async () => {
  const tree = copyTree();
  const home = tmpHome("live");
  const sock = `ta-built-${process.pid}`; // the socket helpers/built-web.js starts the dashboard on
  let child = null;
  try {
    // a live session on the dashboard's socket, so its fleet poll finds a REACHABLE server
    execFileSync("tmux", ["-L", sock, "new-session", "-d", "-s", "doctor-live", "-c", "/tmp"], { stdio: "ignore" });
    const running = readStamp(tree);
    const started = await startWeb(tree, home);
    child = started.child;
    const token = readFileSync(join(home, "web-token"), "utf8").trim(); // never printed
    assert.ok(token.length >= 16, "the dashboard did not write a token into the home");

    const fresh = await doctor(home, started.port, tree);
    assert.equal(fresh.status, 0, `doctor exited ${fresh.status}: ${fresh.stderr}`);
    const d = fresh.doctor?.dashboard;
    assert.ok(d, "no dashboard block");
    assert.equal(d.reachable, true, `not reachable: ${JSON.stringify(d)}`);
    assert.ok(d.build, `no daemon build block: ${JSON.stringify(d)}`);
    assert.deepEqual(Object.keys(d.build).sort(), ["builtAt", "commit", "processUptimeSec", "startedAt", "version"], "dashboard.build is the daemon's five stamp fields — the verdict lives once, at dashboard.stale");
    assert.equal(d.build.version, running.version);
    assert.equal(d.build.commit, running.commit);
    assert.equal(d.build.builtAt, running.builtAt);
    assert.ok(Number.isFinite(Date.parse(d.build.startedAt)) && Date.now() - Date.parse(d.build.startedAt) < 60_000, `startedAt ${d.build.startedAt} is not the daemon's recent start`);
    assert.equal(typeof d.build.processUptimeSec, "number");
    assert.deepEqual(d.onDisk, { commit: running.commit, builtAt: running.builtAt });
    assert.equal(d.stale, false, `a fresh daemon reported stale=${d.stale}: ${d.reason}`);
    assert.match(d.reason, /runs the build on disk/);
    assert.ok(!fresh.stdout.includes(token) && !fresh.stderr.includes(token), "the web token leaked into doctor's output");
    // (i) the daemon's own tmux verdict, and the reason's last clause
    assert.ok(d.tmux, `dashboard has no tmux block — keys: ${Object.keys(d).join(",")}`);
    assert.equal(d.tmux.reachable, true, `the daemon's fleet poll found no server on its socket: ${JSON.stringify(d.tmux)}`);
    assert.equal(d.tmux.error, null);
    assert.ok(Number.isFinite(Date.parse(d.tmux.since)) && Number.isFinite(Date.parse(d.tmux.checkedAt)), `since/checkedAt are not instants: ${JSON.stringify(d.tmux)}`);
    assert.match(d.reason, /; tmux server reachable$/, `the reason does not end with the tmux clause: ${d.reason}`);

    // (c) the operator pulled and rebuilt under the running daemon: same version, new commit
    writeFileSync(join(tree, "dist", "build.json"), JSON.stringify({ ...running, commit: "feedbee", builtAt: new Date().toISOString() }));
    const stale = await doctor(home, started.port, tree);
    assert.equal(stale.status, 0, "a stale daemon must not make doctor exit non-zero — a report, not a gate");
    const s = stale.doctor.dashboard;
    assert.equal(s.reachable, true);
    assert.equal(s.stale, true, `stale not reported after the stamp moved: ${JSON.stringify(s)}`);
    assert.equal(s.onDisk.commit, "feedbee", "onDisk is what dist/build.json says NOW");
    assert.equal(s.build.commit, running.commit, "the daemon's running stamp does not move — only onDisk does");
    assert.match(s.reason, /restart/i, "the reason names the remedy");
    assert.match(s.reason, /feedbee/, "the reason names what is on disk");
    assert.match(s.reason, /; tmux server reachable$/, "the stale verdict keeps the tmux clause at the end");
    assert.ok(!stale.stdout.includes(token) && !stale.stderr.includes(token), "the web token leaked into doctor's output");
  } finally {
    await stopWeb(child); // killing is a signal, not a state: the daemon is gone before its home is
    killServerSync(sock); // and its socket file, once tmux says the server is gone
    rmSync(tree, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (d) a daemon older than the stamp — what this host's own dashboard serves today
// ---------------------------------------------------------------------------------------------
test("doctor: a daemon that predates the stamp (2026-08-26 key set, no build) → reachable, build null, stale null, reason names it + the on-disk commit; the probe sends the home's token as Bearer", async () => {
  const home = tmpHome("old");
  const token = `doctor-test-token-${process.pid}`;
  writeFileSync(join(home, "web-token"), `${token}\n`, { mode: 0o600 });
  const s = await stub((req, res) => json(res, 200, OLD_HEALTH()));
  try {
    const r = await doctor(home, s.port);
    assert.equal(r.status, 0, `doctor exited ${r.status}: ${r.stderr}`);
    const d = r.doctor.dashboard;
    assert.equal(d.reachable, true, `a daemon that answers is reachable: ${JSON.stringify(d)}`);
    assert.equal(d.build, null, "a daemon without a build key has no build to report — null, never invented");
    assert.equal(d.stale, null, "cannot compare what the daemon never said — null, not false");
    assert.match(d.reason, /predates the build stamp/);
    assert.match(d.reason, new RegExp(String(readStamp().commit)), "the reason names what a restart would pick up");
    assert.match(d.reason, /restart/i);
    assert.equal(d.tmux, null, "a daemon that reports no tmux key has no verdict — null, never invented");
    assert.match(d.reason, /; tmux status not reported by this daemon$/, `the reason does not say the daemon is silent on tmux: ${d.reason}`);
    assert.equal(s.requests.length, 1, "exactly one probe request");
    assert.equal(s.requests[0].url, "/api/health");
    assert.equal(s.requests[0].headers.authorization, `Bearer ${token}`, "the home's token rides as a Bearer header");
    assert.ok(!r.stdout.includes(token) && !r.stderr.includes(token), "the web token leaked into doctor's output");
  } finally {
    await s.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (h) the stale rule, pinned against stubs so it cannot merely parrot the daemon
// ---------------------------------------------------------------------------------------------
test("doctor: the verdict is the CLI's own — a daemon build that differs from THIS dist/ is stale even when the daemon says stale:false; one that matches is not; a daemon saying stale:true is", async () => {
  const home = tmpHome("rule");
  const disk = readStamp();
  const oldStamp = { commit: "0ldc0de", builtAt: "2026-08-26T19:35:11.000Z" };
  let block = { version: disk.version, ...oldStamp, startedAt: "2026-08-26T19:35:11.000Z", processUptimeSec: 1414261, onDisk: oldStamp, stale: false };
  const s = await stub((req, res) => json(res, 200, { ...OLD_HEALTH(), build: block }));
  try {
    const old = await (await doctor(home, s.port)).doctor.dashboard;
    assert.equal(old.reachable, true);
    assert.equal(old.build.commit, "0ldc0de");
    assert.equal(old.stale, true, `daemon runs 0ldc0de, disk has ${disk.commit} — must be stale: ${JSON.stringify(old)}`);
    assert.match(old.reason, /0ldc0de/);
    assert.match(old.reason, new RegExp(String(disk.commit)));
    assert.match(old.reason, /restart/i);
    block = { ...block, commit: disk.commit, builtAt: disk.builtAt };
    const same = await (await doctor(home, s.port)).doctor.dashboard;
    assert.equal(same.stale, false, `daemon and disk agree — must not be stale: ${JSON.stringify(same)}`);
    assert.match(same.reason, /runs the build on disk/);
    block = { ...block, stale: true }; // the daemon's own dist/ moved under it, whatever ours says
    const said = await (await doctor(home, s.port)).doctor.dashboard;
    assert.equal(said.stale, true, "a daemon that says stale:true is stale — the CLI agrees rather than recomputing differently");
    assert.match(said.reason, /restart/i);
  } finally {
    await s.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (i) the daemon's tmux verdict, pinned against stubs so the three clauses cannot drift
// ---------------------------------------------------------------------------------------------
test("doctor: dashboard.tmux is the daemon's /api/health.tmux — unreachable → the UNREACHABLE clause with since + error; reachable → the reachable clause; null (no poll yet) → not reported; the build verdict and exit code untouched", async () => {
  const home = tmpHome("tmux");
  const disk = readStamp();
  const build = { version: disk.version, commit: disk.commit, builtAt: disk.builtAt, startedAt: "2026-09-16T10:30:48.003Z", processUptimeSec: 3, onDisk: { commit: disk.commit, builtAt: disk.builtAt }, stale: false };
  let tmux = { reachable: false, since: "2026-09-16T10:30:54.087Z", error: "no server running on /tmp/tmux-1000/ta-probe", checkedAt: "2026-09-16T10:30:57.092Z" };
  const s = await stub((req, res) => json(res, 200, { ...OLD_HEALTH(), build, tmux }));
  try {
    const down = await doctor(home, s.port);
    assert.equal(down.status, 0, "a dead tmux server must not make doctor exit non-zero — a report, not a gate");
    const d = down.doctor.dashboard;
    assert.deepEqual(d.tmux, tmux, "dashboard.tmux is the daemon's object, field for field");
    assert.equal(d.stale, false, "the build verdict is untouched by the tmux one");
    assert.ok(d.reason.endsWith("; tmux server UNREACHABLE since 2026-09-16T10:30:54.087Z (no server running on /tmp/tmux-1000/ta-probe)"), `reason: ${d.reason}`);
    assert.match(d.reason, /^dashboard runs the build on disk/, "the build sentence still leads");

    tmux = { reachable: true, since: "2026-09-16T10:30:57.091Z", error: null, checkedAt: "2026-09-16T10:31:00.000Z" };
    const up = (await doctor(home, s.port)).doctor.dashboard;
    assert.deepEqual(up.tmux, tmux);
    assert.ok(up.reason.endsWith("; tmux server reachable"), `reason: ${up.reason}`);

    tmux = null; // the daemon has the key but has not polled yet
    const none = (await doctor(home, s.port)).doctor.dashboard;
    assert.equal(none.tmux, null);
    assert.ok(none.reason.endsWith("; tmux status not reported by this daemon"), `reason: ${none.reason}`);
  } finally {
    await s.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (e) the 401 path — wrong token, and no token file at all
// ---------------------------------------------------------------------------------------------
test("doctor: a home whose web-token does not match the daemon's → 401 path: reachable, build null, stale null, reason names unauthorized + the token file, no token printed; no token file → says missing", async () => {
  const tree = copyTree();
  const homeA = tmpHome("auth-a");
  const homeB = tmpHome("auth-b");
  const homeC = tmpHome("auth-c");
  let child = null;
  try {
    const started = await startWeb(tree, homeA);
    child = started.child;
    const tokenA = readFileSync(join(homeA, "web-token"), "utf8").trim();
    const tokenB = `wrong-token-${process.pid}`;
    writeFileSync(join(homeB, "web-token"), `${tokenB}\n`, { mode: 0o600 });
    const r = await doctor(homeB, started.port, tree);
    assert.equal(r.status, 0, "unauthorized must not make doctor exit non-zero");
    const d = r.doctor.dashboard;
    assert.equal(d.reachable, true, `a 401 is a daemon answering — reachable: ${JSON.stringify(d)}`);
    assert.equal(d.build, null);
    assert.equal(d.stale, null);
    assert.match(d.reason, /unauthorized/i);
    assert.match(d.reason, /web-token/, "the reason names the file the operator would look at");
    assert.match(d.reason, /does not match/, "a present token that was refused: say it may not match, not which cause it is");
    for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes(tokenA) && !out.includes(tokenB), "a token leaked into doctor's output");

    const none = await doctor(homeC, started.port, tree);
    assert.equal(none.status, 0);
    const n = none.doctor.dashboard;
    assert.equal(n.reachable, true);
    assert.equal(n.build, null);
    assert.match(n.reason, /unauthorized/i);
    assert.match(n.reason, /missing/, "no token file in this home: say so");
    assert.ok(!none.stdout.includes(tokenA) && !none.stderr.includes(tokenA), "the daemon's token leaked into doctor's output");
  } finally {
    await stopWeb(child); // killing is a signal, not a state: the daemon is gone before its home is
    rmSync(tree, { recursive: true, force: true });
    for (const h of [homeA, homeB, homeC]) rmSync(h, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (f) loopback is a literal, not a setting
// ---------------------------------------------------------------------------------------------
test("doctor: the probe's host is the literal 127.0.0.1 — no flag or env reaches it (dist/ source), and doctor passes the probe no host", () => {
  const probe = join(ROOT, "dist", "core", "dashboard-probe.js");
  assert.ok(existsSync(probe), "dist/core/dashboard-probe.js missing — the probe module is not built");
  const src = readFileSync(probe, "utf8");
  assert.match(src, /host:\s*"127\.0\.0\.1"/, "the request's host option must be the literal loopback address");
  assert.match(src, /http:\/\/127\.0\.0\.1:\$\{/, "the reported url must be built on the literal loopback address");
  assert.doesNotMatch(src, /process\.env/, "the probe module reads no environment variable");
  assert.doesNotMatch(src, /process\.argv|flag\(/, "the probe module reads no CLI flag");
  const cli = readFileSync(join(ROOT, "dist", "bin", "tmux-agent.js"), "utf8");
  const call = /probeDashboard\(([^)]*)\)/.exec(cli);
  assert.ok(call, "doctor does not call probeDashboard");
  assert.doesNotMatch(call[1], /host/i, `doctor passes a host to the probe: ${call[0]}`);
});

// ---------------------------------------------------------------------------------------------
// (g) a wedged daemon must not wedge doctor
// ---------------------------------------------------------------------------------------------
test("doctor: a listener that never answers → reachable false within the timeout, reason names it — doctor does not hang on a wedged daemon", async () => {
  const home = tmpHome("hang");
  const s = await stub(() => { /* accept, never respond */ });
  try {
    const t0 = Date.now();
    const r = await doctor(home, s.port);
    const took = Date.now() - t0;
    assert.equal(r.status, 0, `doctor exited ${r.status}: ${r.stderr}`);
    const d = r.doctor.dashboard;
    assert.equal(d.reachable, false);
    assert.equal(d.build, null);
    assert.equal(d.stale, null);
    assert.match(d.reason, /timed out/i);
    assert.ok(took < 8000, `doctor took ${took} ms against a silent listener — the probe's timeout is not bounding it`);
  } finally {
    await s.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (j) a rebuild at the SAME commit under the daemon — the alarm's common shape on a host where
//     every `npm test` rebuilds dist/ at HEAD
// ---------------------------------------------------------------------------------------------
test("doctor: a stamp rewritten under the built dashboard at the SAME commit (new builtAt) → stale true, the reason names both build times and never `runs X and dist/ has X`", async () => {
  const tree = copyTree();
  const home = tmpHome("rebuilt");
  let child = null;
  try {
    const running = readStamp(tree);
    const started = await startWeb(tree, home);
    child = started.child;
    // measured live 2026-09-24 02:24Z: the daemon on 278d5d0 built 22:23:43Z, dist/ rebuilt at 278d5d0 by the 02:23Z test run
    const rebuiltAt = new Date(Date.parse(running.builtAt) + 60_000).toISOString();
    writeFileSync(join(tree, "dist", "build.json"), JSON.stringify({ ...running, builtAt: rebuiltAt }));
    const r = await doctor(home, started.port, tree);
    assert.equal(r.status, 0, `doctor exited ${r.status}: ${r.stderr}`);
    const d = r.doctor?.dashboard;
    assert.ok(d && d.reachable, `not reachable: ${JSON.stringify(d)}`);
    assert.equal(d.stale, true, `a rebuild at the same commit is code the daemon is not running — must be stale: ${JSON.stringify(d)}`);
    assert.deepEqual(d.onDisk, { commit: running.commit, builtAt: rebuiltAt }, "onDisk is what dist/build.json says NOW");
    assert.equal(d.build.builtAt, running.builtAt, "the daemon's running stamp does not move — only onDisk does");
    const m = /^dashboard runs (.+) and dist\/ has (.+) — restart to pick up;/.exec(d.reason);
    assert.ok(m, `the reason is not the stale sentence: ${d.reason}`);
    assert.notEqual(m[1], m[2], `the two sides of the reason read the same — a restart that would run the same commit: ${d.reason}`);
    assert.equal(m[1], `${running.commit} built ${running.builtAt}`, `the running side names its build time: ${d.reason}`);
    assert.equal(m[2], `${running.commit} rebuilt ${rebuiltAt}`, `the on-disk side names its rebuild time: ${d.reason}`);
    assert.match(d.reason, /; tmux (server|status) /, `the tmux clause still ends the reason: ${d.reason}`);
  } finally {
    await stopWeb(child); // killing is a signal, not a state: the daemon is gone before its home is
    rmSync(tree, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
