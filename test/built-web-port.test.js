/**
 * The built-daemon harness asks the OS for its port and survives a squatted window (TMUX-176; gate G1 — a suite that
 * reds on a clean tree for a reason outside the tree is a suite nobody trusts).
 *
 * Measured 2026-09-29 16:23Z on the clean 6b8dc30 tree (scratch/ga-fire-2026-09-29-16Z/npm-test-pre.log): `npm test`
 * 540/541 — test/versioning-contract.test.js's daemon case red with `web exited early (1): no free port in
 * 24283..24302 on 127.0.0.1`. helpers/built-web.js asked for a dice roll (21000 plus a random offset below 15000) and drew
 * 24283; the CLI's findFreePort (src/web/server.ts) scans twenty ports and gives up; `ss -ltnp` showed
 * 127.0.0.1:24282..24304 — twenty-three consecutive ports — held by twenty-three `serena start-mcp-server` processes,
 * one per Claude Code session on the host (each new session binds the next port up, so the block GROWS). Four of the
 * 15,000 bases (24282..24285) put the whole window inside the block; the suite makes sixteen startWeb() calls per run, so
 * ≈0.4 % of clean-tree runs red, rising with every session. The file re-run alone drew another base and passed 97/97: a
 * flake with a deterministic cause. Three siblings (doctor-dashboard, mailbox-surface, mailbox-observable) already ask the
 * OS — `listen(0, "127.0.0.1")` — for "a loopback port nothing listens on"; the harness was the one spawner that rolled dice.
 *
 * The contract, each a check that FAILS if the property is removed:
 *   (a) freePort() hands out a loopback port the OS has just released — 25 draws, each an integer > 0 and bindable at once;
 *   (b) the 16:23Z shape, planted: twenty consecutive loopback ports are held from a base B and the first pick is forced to
 *       B — startWeb() resolves on a SECOND pick, its banner port outside the block, `picks` = [B, <the second>], and the
 *       daemon answers /api/health;
 *   (c) the bound is a bound: a pick that lands in the block every time is refused after PICK_ATTEMPTS picks, the give-up
 *       naming the count and every window (`B..B+19` PICK_ATTEMPTS times) and carrying the picks and each child's exit —
 *       every child had exited before its window was read, so no daemon is left behind;
 *   (d) control: nothing planted, the default pick — one pick, the banner's port is the pick (or the CLI's forward scan
 *       from it, should a stranger take the port in the gap), /api/health 200;
 *   (e) drift guard over the helper's text: it names the dice (`Math.random`) nowhere and `pickPort = freePort` once — the
 *       OS's word is the default, not an option a caller must remember.
 *
 * FAIL-first on the parent 6b8dc30 (scratch/ga-fire-2026-09-29-16Z/red-parent.log — this suite run against a `git archive`
 * copy of the parent's test/ with its dist beside it), 0 of 5: (a) `exports no freePort()`, (b) `resolved with no picks (port
 * 34680) — the helper ignored the injected pick and rolled its own`, (c) `exports no PICK_ATTEMPTS — the bound is not stated`,
 * (d) `picks undefined`, (e) `rolls dice for a port again`. And the day's own message reproduced against the parent's helper
 * (repro-parent.log): the block planted at the port its dice were forced to → `web exited early (1): no free port in
 * 22246..22265 on 127.0.0.1`; the shipped helper on the same plant (repro-shipped.log) resolved with picks = [21805, 35203].
 *
 * Run: node --test test/built-web-port.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// A namespace import on purpose: a helper without the new exports reds the CASE that needs them, not this file's load.
import * as builtWeb from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const HELPER = join(TEST_DIR, "helpers", "built-web.js");
const { copyTree, startWeb, stopWeb } = builtWeb;
const WIDTH = 20; // the CLI finder's window (src/web/server.ts findFreePort, tries = 20)

const tree = copyTree(); // a COPY of dist/: the repo's own stamp is read by every other suite running in parallel
after(() => { rmSync(tree, { recursive: true, force: true }); removeTempHomes(); }); // every home this file made

/** Bind 127.0.0.1:port and resolve the server (the caller closes it), or reject with the OS's own error. */
function hold(port) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}
const release = (servers) => Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
const inBlock = (port, base) => port >= base && port < base + WIDTH;
/** The plant's own probe for an OS-released port — independent of the helper under test, so a parent without freePort() still plants. */
const osPort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/**
 * GET /api/health on `port` until it answers or `ms` elapse. The CLI prints its banner in the tick it calls listen(), so a
 * single fetch right behind the banner can be refused — measured here: the control red once with `fetch failed` 85 ms in.
 */
async function health(port, ms = 5_000) {
  const end = Date.now() + ms;
  let last = "no attempt";
  while (Date.now() < end) {
    try { return await fetch(`http://127.0.0.1:${port}/api/health`); } catch (e) { last = e.cause?.code ?? e.message; }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`/api/health on ${port} never answered within ${ms} ms (last: ${last})`);
}

/**
 * Hold WIDTH consecutive loopback ports from a base the OS just released — the 2026-09-29 block, planted. A base whose run
 * is already broken by a stranger is released and drawn again (bounded), so the plant is real when this returns.
 */
async function squatBlock(tries = 25) {
  for (let i = 0; i < tries; i++) {
    const base = await osPort();
    const held = [];
    try {
      for (let p = base; p < base + WIDTH; p++) held.push(await hold(p));
      return { base, held };
    } catch {
      await release(held);
    }
  }
  throw new Error(`could not hold ${WIDTH} consecutive loopback ports in ${tries} draws — too crowded a host to plant the shape`);
}

test("(a) freePort() hands out a loopback port the OS has just released — 25 draws, each an integer > 0 and bindable at once", async () => {
  assert.equal(typeof builtWeb.freePort, "function", "helpers/built-web.js exports no freePort() — the harness still rolls dice for its port");
  for (let i = 1; i <= 25; i++) {
    const port = await builtWeb.freePort();
    assert.ok(Number.isInteger(port) && port > 0, `draw ${i}: ${port} is not a port`);
    const s = await hold(port); // the OS said free; a bind must agree
    await release([s]);
  }
});

test("(b) the 16:23Z shape planted — twenty ports held from B, the first pick forced to B: startWeb() resolves on a second pick outside the block, picks = [B, p2], the daemon answers", async () => {
  const { base, held } = await squatBlock();
  const home = tempHome("ta-bwport-b-");
  let child = null;
  try {
    let calls = 0;
    const pickPort = () => (++calls === 1 ? base : osPort());
    const r = await startWeb(tree, home, {}, ["--no-token"], { pickPort });
    child = r.child;
    assert.ok(Array.isArray(r.picks), `startWeb() resolved with no picks (port ${r.port}) — the helper ignored the injected pick and rolled its own`);
    assert.equal(r.picks[0], base, `the first pick was ${r.picks[0]}, not the forced ${base}`);
    assert.equal(r.picks.length, 2, `picks ${JSON.stringify(r.picks)}: expected exactly one re-pick after the squatted window ${base}..${base + WIDTH - 1}`);
    assert.ok(!inBlock(r.picks[1], base), `the second pick ${r.picks[1]} landed inside the planted block ${base}..${base + WIDTH - 1}`);
    assert.ok(!inBlock(r.port, base), `the banner's port ${r.port} is inside the planted block ${base}..${base + WIDTH - 1}`);
    const h = await health(r.port);
    assert.equal(h.status, 200, `/api/health on the re-picked port ${r.port} → ${h.status}`);
  } finally {
    await stopWeb(child);
    await release(held);
  }
});

test("(c) the bound is a bound: a pick that lands in the block every time is refused after PICK_ATTEMPTS picks, the give-up naming the count and each window, every child exited", async () => {
  const { base, held } = await squatBlock();
  const home = tempHome("ta-bwport-c-");
  try {
    assert.equal(typeof builtWeb.PICK_ATTEMPTS, "number", "helpers/built-web.js exports no PICK_ATTEMPTS — the bound is not stated");
    const N = builtWeb.PICK_ATTEMPTS;
    let calls = 0;
    const outcome = await startWeb(tree, home, {}, ["--no-token"], { pickPort: () => { calls++; return base; } })
      .then((r) => stopWeb(r.child).then(() => ({ resolved: r })), (e) => ({ error: e }));
    assert.ok(outcome.error, `startWeb() resolved (port ${outcome.resolved?.port}, picks ${JSON.stringify(outcome.resolved?.picks)}) on a fully squatted window — it rolled its own port instead of asking the pick`);
    const { error } = outcome;
    assert.equal(calls, N, `pickPort was asked ${calls} times; the bound is ${N}`);
    assert.match(error.message, new RegExp(`after ${N} picks`), `the give-up does not name the bound: ${error.message}`);
    const window = `${base}..${base + WIDTH - 1}`;
    const named = error.message.split(window).length - 1;
    assert.equal(named, N, `the give-up names the window ${window} ${named} times, not ${N}: ${error.message}`);
    assert.deepEqual(error.picks, Array(N).fill(base), "the give-up carries every pick");
    assert.deepEqual(error.exits, Array(N).fill(1), `every child exited 1 on the finder's give-up before its window was read — got ${JSON.stringify(error.exits)}`);
  } finally {
    await release(held);
  }
});

test("(d) control — nothing planted, the default pick: one pick, the banner's port is the pick, /api/health 200", async () => {
  const home = tempHome("ta-bwport-d-");
  let child = null;
  try {
    const r = await startWeb(tree, home, {}, ["--no-token"]);
    child = r.child;
    assert.ok(Array.isArray(r.picks) && r.picks.length === 1, `picks ${JSON.stringify(r.picks)}: the control took more than one pick, or none`);
    // Equal in every measured run; a stranger taking the OS's port in the gap moves the banner up the CLI's window, never out of it.
    assert.ok(r.port >= r.picks[0] && r.port < r.picks[0] + WIDTH, `the banner's port ${r.port} is not the pick ${r.picks[0]} nor inside its ${WIDTH}-port scan`);
    const h = await health(r.port);
    assert.equal(h.status, 200, `/api/health → ${h.status}`);
  } finally {
    await stopWeb(child);
  }
});

test("(e) drift guard — the helper's text names the dice nowhere and `pickPort = freePort` once: the OS's word is the default pick", () => {
  const text = readFileSync(HELPER, "utf8");
  assert.doesNotMatch(text, /Math\.random/, "helpers/built-web.js rolls dice for a port again — the 2026-09-29 class (a squatted window reds a clean tree)");
  assert.equal(text.split("pickPort = freePort").length - 1, 1, "the helper's default pick is not freePort");
});
