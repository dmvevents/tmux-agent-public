/**
 * The dashboard banner prints only once the socket accepts, and names the port the socket is bound to (TMUX-178;
 * gate G3 — "the banner is the truth", of readiness now as well as of the port).
 *
 * Measured 2026-09-29 (230th GA fire, scratch/ga-fire-2026-09-29-16Z/new-suite-green.log): src/bin/tmux-agent.ts
 * printed `tmux-agent dashboard: http://<host>:<port>/` in the tick startWeb() returned, and startWeb
 * (src/web/server.ts) calls server.listen() — asynchronous — and returns at once, so the URL was announced before
 * `listening`. test/built-web-port.test.js's control issued ONE fetch(/api/health) on the banner line and got
 * `fetch failed` 85 ms after it; the harnesses (helpers/built-web.js's health poll, test/smoke-web.sh's 20 × 0.5 s
 * loop) hid the race behind bounds, which stay — a bound is a bound. The race is 85 ms wide and not reproducible on
 * demand, so the FAIL-first here is planted: test/fixtures/defer-listen.cjs, preloaded into the built CLI with
 * NODE_OPTIONS=--require, defers every real listen() by 300 ms (and, asked to, binds port 0 in place of the port
 * requested) — the banner of a CLI that prints before readiness now precedes it by 300 ms every time, and one
 * no-retry fetch is refused every time.
 *
 * The contract, each a check that FAILS if the property is removed:
 *   (a) readiness, planted: listen() deferred 300 ms; on the FIRST banner line exactly ONE fetch(/api/health), no
 *       retry → 200; the fixture's log shows the deferral bit (a `deferMs=300` line per listen);
 *   (b) the socket's own word, planted: this suite HOLDS a loopback port H and asks the CLI for it while the fixture
 *       binds 0 in its place — the OS cannot hand out a held port, so the daemon's socket is on some Q ≠ H; the banner
 *       is not H, it is the port the fixture saw bound last, and one no-retry fetch on it is ANSWERED by the daemon.
 *       Answered, not 200: the daemon's Host guard (src/web/server.ts checkBrowserOrigin) compares the request's port
 *       to the one it was asked for — H — and refuses Q with 403 `does not match the bound port H`. The product never
 *       separates those two (listen(H) binds H or exits 75); only this plant does, and the 403 is the daemon speaking
 *       on the banner's port. A client sent to H instead reaches this suite's holder, which drops the connection —
 *       fast, never a hang — so a banner that names the requested port fails here at once;
 *   (c) control, nothing planted: one no-retry fetch on the first banner line → 200 — the shape the card measured.
 *
 * FAIL-first on the parent a47c78c (this suite against the parent's own dist/, scratch/ga-fire-2026-09-30-00Z/
 * red-parent.log), 0 of 3: (a) `one fetch on the banner line → ECONNREFUSED after 25 ms — the banner preceded
 * readiness` with the fixture's log showing both listens deferred 300 ms; (b) `the banner names the REQUESTED port
 * 44787 — held by this suite` while the fixture saw 41639 bound; (c) the unplanted control itself — `ECONNREFUSED`
 * 2 ms after the banner, the card's 85 ms race landing on the first try.
 *
 * Run: node --test test/web-banner-listening.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// copyTree/startWeb/stopWeb are the built-daemon harness shared with test/built-web-port.test.js — see helpers/built-web.js
import { copyTree, startWeb, stopWeb } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(TEST_DIR, "fixtures", "defer-listen.cjs");
const DEFER_MS = 300;

const tree = copyTree(); // a COPY of dist/: the repo's own stamp is read by every other suite running in parallel
after(() => { rmSync(tree, { recursive: true, force: true }); removeTempHomes(); }); // every home this file made

/**
 * The fixture's environment for one daemon: preloaded via NODE_OPTIONS (APPENDED — a coverage run's own options
 * stay), its log inside `home` so the teardown that removes the home removes it.
 */
function planted(home, { deferMs = DEFER_MS, portZero = false } = {}) {
  return {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${FIXTURE}`].filter(Boolean).join(" "),
    TA_DEFER_LISTEN_MS: String(deferMs),
    TA_LISTEN_PORT_ZERO: portZero ? "1" : "0",
    TA_DEFER_LISTEN_LOG: join(home, "defer-listen.log"),
  };
}
const fixtureLog = (home) => (existsSync(join(home, "defer-listen.log")) ? readFileSync(join(home, "defer-listen.log"), "utf8").trim().split("\n") : []);

/** ONE GET /api/health on `port`, no retry: the request a client makes when it takes the banner at its word. */
async function oneFetch(port) {
  const t0 = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    return { status: r.status, body: (await r.text()).slice(0, 160), ms: Date.now() - t0 };
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

test("(a) readiness, planted — every listen() deferred 300 ms: ONE fetch on the first banner line, no retry, is 200", async (t) => {
  const home = tempHome("ta-banner-a-");
  let child = null;
  try {
    const r = await startWeb(tree, home, planted(home), ["--no-token"]);
    child = r.child;
    const got = await oneFetch(r.port);
    const log = fixtureLog(home);
    assert.ok(log.some((l) => l.includes(`deferMs=${DEFER_MS}`)), `the fixture never bit — no listen() was deferred (log: ${JSON.stringify(log)})`);
    t.diagnostic(`banner port ${r.port}; one fetch → ${got.status ?? got.error} in ${got.ms} ms; fixture: ${log.join(" | ")}`);
    assert.equal(got.status, 200, `one fetch on the banner line → ${got.status ?? got.error} after ${got.ms} ms — the banner preceded readiness`);
  } finally {
    await stopWeb(child);
  }
});

test("(b) the socket's own word, planted — the requested port is HELD here and the fixture binds 0 in its place: the banner names the bound port, and one fetch on it reaches the daemon", async (t) => {
  const hold = await holdPort();
  const home = tempHome("ta-banner-b-");
  let child = null;
  try {
    const r = await startWeb(tree, home, planted(home, { deferMs: 0, portZero: true }), ["--no-token"], { pickPort: () => hold.port });
    child = r.child;
    const got = await oneFetch(r.port);
    const log = fixtureLog(home);
    const bound = log.filter((l) => l.startsWith("bound=")).map((l) => Number(l.slice("bound=".length)));
    assert.ok(log.some((l) => l.includes("asked=0")), `the fixture never bit — no listen() was rewritten to port 0 (log: ${JSON.stringify(log)})`);
    t.diagnostic(`requested ${hold.port} (held); banner ${r.port}; bound per fixture ${JSON.stringify(bound)}; one fetch → ${got.status ?? got.error} in ${got.ms} ms${got.body ? ` (${got.body})` : ""}`);
    assert.notEqual(r.port, hold.port, `the banner names the REQUESTED port ${hold.port} — held by this suite, so nothing of the daemon's is bound there`);
    assert.equal(r.port, bound.at(-1), `the banner names ${r.port}; the socket the fixture saw bound last is ${bound.at(-1)}`);
    // The daemon answers on the banner's port — 403 under this plant (see the header): its Host guard was told H.
    assert.ok(typeof got.status === "number", `one fetch on the banner's port ${r.port} reached no daemon (${got.error} after ${got.ms} ms)`);
  } finally {
    await stopWeb(child);
    await hold.close();
  }
});

test("(c) control — nothing planted: ONE fetch on the first banner line, no retry, is 200", async (t) => {
  const home = tempHome("ta-banner-c-");
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
