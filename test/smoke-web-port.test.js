/**
 * test/smoke-web.sh asks the OS for every dashboard port it binds (TMUX-177; gate G1 — a suite that reds on a clean tree
 * for a reason outside the tree is a suite nobody trusts).
 *
 * The smoke rolled ONE base from bash's own generator — 20000 plus an offset below 20000 — and bound six dashboards at
 * fixed offsets from it (PORT, +7, +9, +11, +13, +17). Each daemon's CLI scans twenty ports forward (src/web/server.ts
 * findFreePort) and gives up with `no free port in A..A+19`, so a base whose window sat inside a block of squatters red
 * the run at step 1 with "no dashboard banner". Measured 2026-09-29 (scratch/ga-fire-2026-09-29-16Z/, the 230th GA fire):
 * 127.0.0.1:24282..24304 — twenty-three consecutive loopback ports — held by twenty-three `serena start-mcp-server`
 * processes, one per Claude Code session on the host, the block growing by one per session; four bases per daemon put
 * its whole window inside, so six daemons gave up to 24 fatal bases of 20,000 (≈0.1 % of runs, rising). The same class
 * red the node harness that day (TMUX-176, test/helpers/built-web.js), whose card named this script as "not this card"
 * so it would be carded, not fixed silently. Reproduced deterministically on the parent 635971b
 * (scratch/ga-fire-2026-09-29-20Z/red-parent.log): bash's generator is seedable and BASH_ENV is sourced before a
 * non-interactive script runs, so `RANDOM=177` in a BASH_ENV file forced the roll to 25690; twenty listeners planted at
 * 25690..25709 → `WEB-SMOKE FAIL: no dashboard banner`, `no free port in 25690..25709 on 127.0.0.1`, EXIT=1. The fixed
 * script on the same plant and seed: WEB-SMOKE PASS (29/29), every daemon's port outside the block (green-fixed.log).
 *
 * The contract, each a check that FAILS if the property is removed — over the script's TEXT and its two helpers run in
 * bash (the smoke itself is minutes long and is `npm test`'s own step, not this file's):
 *   (a) drift guard: the script names bash's generator (`RANDOM`) nowhere; free_port() binds 127.0.0.1:0 through node;
 *       PORT falls back to free_port() when SMOKE_WEB_PORT is unset; and every `--port` a dashboard is STARTED with
 *       (`web --port`, start_web) is the main daemon's "$PORT" or one of five "$(pick_port N)" — the only arithmetic
 *       left is the two remote-bind refusal probes at PORT+1, which bind nothing (the doctor's --port names a daemon
 *       already up: a client's word, not a bind);
 *   (b) free_port() as the script defines it, run in bash: ten draws, each an integer above 1023 and bindable at once — a
 *       draw another socket took first (EADDRINUSE, and that code alone) is redrawn, at most EXTRA_DRAWS times across the
 *       case, and any other refusal reds at once naming its code (TMUX-193; the paragraph below);
 *   (c) pick_port() as the script defines it: with SMOKE_WEB_PORT set and PORT=B the offsets 7/9/11/13/17 are B+7…B+17 —
 *       the fixed layout TMUX-77's port-squatter regression run reproduces; with SMOKE_WEB_PORT unset the offset is not
 *       arithmetic at all (PORT=1, offset 7 is not 8) but an OS port above 1023, bindable at once.
 *
 * FAIL-first on the parent 635971b (scratch/ga-fire-2026-09-29-20Z/red-suite.log — this file run against a `git archive`
 * copy of the parent's test/), 0 of 3: (a) `the smoke rolls a base from bash's generator again`, (b) `the smoke defines
 * no free_port() to run`, (c) `the smoke defines no pick_port()/free_port() to run`.
 *
 * (b) RE-BINDS a port after free_port() released it in a bash child, and between that close() and this process's listen()
 * the port is anyone's: under node --test the suite's files run at once, every dashboard fixture binds on loopback and
 * every loopback request draws its source port from the same ephemeral range. The 258th GA fire's coverage read 3
 * (2026-10-02 00:23Z, scratch/ga-fire-2026-10-02-00Z/cov-3.log) lost one draw of ten to `listen EADDRINUSE: address
 * already in use 127.0.0.1:40013` after 544 ms — the first red of this case in the 395 coverage reads the record held
 *. free_port() had done its job (the OS considered the port free); another socket was handed it first. So the
 * collision is the premise's race and the case now absorbs it: tenBound() redraws on EADDRINUSE ALONE, at most EXTRA_DRAWS
 * more across the ten (the bound named in its red), still ends with ten ports that bound, reds at once on any other code
 * (EACCES, EADDRNOTAVAIL, …) naming it, keeps the shape check on every draw, the redrawn included, and the case prints its
 * redraw count (0 on a quiet host). Four controls drive the same tenBound() with a planted bind, because on a quiet host (b)
 * alone only ever sees the OS say yes: (b1) one EADDRINUSE then the OS → ten bound ports after exactly one redraw;
 * (b2) EACCES, and a throw with no code at all → red naming it, no redraw; (b3) EADDRINUSE on every bind → red naming the count and the bound, on
 * exactly EXTRA_DRAWS collisions → ten bound ports at the bound; (b4) a planted redraw of 80 after one collision → red at
 * the shape check, before any bind. FAIL-first on planted copies of this tree (scratch/ga-fire-2026-10-02-04Z/red/):
 * the redraw removed (every refusal reds at once) → (b1), (b3) and (b4) red, 4/7; the code discrimination removed (any
 * refusal earns a redraw) → (b2) red alone, 6/7; the bound off by one → (b3) red alone, 6/7; the shape check on the batch
 * draws only → (b4) red alone, 6/7; the parent 85ad5c1's file 3/3 with no control to red; the working tree 7/7 twice, (b)
 * at 0 redraws. The file's own row read 100.00 / 98.31 / 100.00 alone, its one untaken branch definition()'s miss — the
 * parent's own, not this card's.
 *
 * Run: node --test test/smoke-web-port.test.js   (bash + node; no build, no tmux, no home)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "smoke-web.sh");
const text = readFileSync(SCRIPT, "utf8");
const OFFSETS = [7, 9, 11, 13, 17]; // the five later dashboards, in script order
const PROBE = /--port \$\(\(PORT\+1\)\) --host 192\.0\.2\.1\b/; // the remote-bind refusal probes: they bind nothing
const PICK = /--port "\$\(pick_port (\d+)\)"/;
/** The most redraws (b) allows across its ten: one collision in 395 reads × 10 draws is the measured rate; five
 *  in one case is a host that is not quiet, or a free_port() that no longer asks the OS. */
const EXTRA_DRAWS = 5;

/** The one-line definition `name(){ … }` as the script spells it, or undefined — the parent defined neither. */
function definition(name) {
  const m = text.match(new RegExp(`^${name}\\(\\)\\{.*\\}$`, "m"));
  return m ? m[0] : undefined;
}

/** Run `body` in a fresh non-interactive bash with the script's helper definitions in scope; stdout, trimmed. */
function bash(defs, body, env) {
  return execFileSync("bash", ["-c", `set -euo pipefail\n${defs.join("\n")}\n${body}`], { env, encoding: "utf8", timeout: 20000 }).trim();
}

/** Prove the OS considers `port` free right now: bind it on loopback, then release it. */
function bindable(port) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

/** One more draw, in bash as the case draws its first ten — the redraw (b) spends on a collision. */
function one(fp, env) { return Number(bash([fp], "free_port", env)); }

/** The shape every draw must have, the redrawn included: an integer above 1023 that the OS hands out. */
function wellShaped(p) { assert.ok(Number.isInteger(p) && p > 1023 && p < 65536, `not a port the OS hands out: ${p}`); }

/**
 * Ten ports free_port() handed out that the OS then bound. Between the bash child's close() and this process's listen()
 * a port is anyone's, so EADDRINUSE on the re-bind is the OS's collision and not free_port()'s fault: that code ALONE earns
 * a redraw, at most `extra` of them across the case; any other refusal (EACCES, EADDRNOTAVAIL, …) is a red at once that
 * names the code. `bind` and `redraw` are injectable so the controls can drive both arms and the bound on a quiet host.
 */
async function tenBound(fp, env, { bind = bindable, redraw = () => one(fp, env), extra = EXTRA_DRAWS } = {}) {
  const queue = bash([fp], "for i in 1 2 3 4 5 6 7 8 9 10; do free_port; done", env).split("\n").map(Number);
  assert.equal(queue.length, 10, `ten draws: ${queue}`);
  const ports = [];
  let redraws = 0;
  while (ports.length < 10) {
    const p = queue.length > 0 ? queue.shift() : redraw();
    wellShaped(p);
    let refused;
    try {
      await bind(p);
    } catch (e) {
      refused = e;
    }
    if (refused === undefined) {
      ports.push(p);
      continue;
    }
    assert.equal(
      refused?.code,
      "EADDRINUSE",
      `free_port() said ${p} but the OS would not bind it: ${refused?.code ?? refused} — only EADDRINUSE is a collision this case redraws on`,
    );
    redraws += 1;
    assert.ok(
      redraws <= extra,
      `free_port() handed out ${redraws} ports in a row that another socket took first — more than the ${extra} extra draws this case allows: the host is not quiet, or free_port() no longer asks the OS`,
    );
  }
  return { ports, redraws };
}

/** A refusal as net hands one back: an Error carrying the syscall's code. */
function refusal(code, port) { return Object.assign(new Error(`listen ${code}: planted refusal 127.0.0.1:${port}`), { code }); }

/** A bind that refuses its first `codes.length` calls with those codes in order, then answers as `then` does (the OS, by default). */
function planted(codes, then = bindable) {
  let i = 0;
  return (port) => (i < codes.length ? Promise.reject(refusal(codes[i++], port)) : then(port));
}

/** `fn` with a call count on it, so a control can say how often tenBound() asked for a redraw. */
function counting(fn) {
  const c = (...args) => { c.calls += 1; return fn(...args); };
  c.calls = 0;
  return c;
}

/** The case's own redraw — one more free_port() in bash — wrapped to count its calls. */
function redrawOf(fp) { return counting(() => one(fp, unpinned())); }

/** An environment without the pin — a SMOKE_WEB_PORT inherited from the caller would turn every pick into arithmetic. */
function unpinned() { const e = { ...process.env }; delete e.SMOKE_WEB_PORT; return e; }

test("(a) drift guard: the smoke names bash's generator nowhere, free_port() asks the OS, PORT falls back to it, and every dashboard's --port is the OS's word or the pinned layout", () => {
  assert.equal((text.match(/RANDOM/g) ?? []).length, 0, "the smoke rolls a base from bash's generator again");
  const fp = definition("free_port");
  assert.ok(fp, "the smoke defines no free_port() — nothing asks the OS for a port");
  assert.match(fp, /node -e '.*createServer\(\).*\.listen\(0,\s*"127\.0\.0\.1"/, "free_port() does not bind 127.0.0.1:0 through node");
  assert.ok(definition("pick_port"), "the smoke defines no pick_port() — the later dashboards cannot ask the OS");
  assert.match(text, /^PORT=\$\{SMOKE_WEB_PORT:-\$\(free_port\)\}$/m, "PORT does not fall back to free_port() when SMOKE_WEB_PORT is unset");
  // the lines that START a dashboard: the `web` verb followed by --port, and start_web; the doctor's --port is a
  // client's and binds nothing (its actor names, web-smoke29, are not the verb)
  const sites = text.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /(?:^|\s)web\s+--port\s|\bstart_web\s.*--port\s/.test(l) && !/^\s*#/.test(l));
  assert.equal(sites.filter(([, l]) => PROBE.test(l)).length, 2, `the two refusal probes at PORT+1: ${JSON.stringify(sites.map(([n]) => n))}`);
  const picks = sites.filter(([, l]) => PICK.test(l)).map(([, l]) => Number(l.match(PICK)[1]));
  assert.deepEqual(picks, OFFSETS, "the five later dashboards are not each asked for through pick_port(), in script order");
  const stray = sites.filter(([, l]) => !PROBE.test(l) && !PICK.test(l) && !/--port "\$PORT"/.test(l));
  assert.deepEqual(stray, [], "a dashboard is started at a port that is neither the OS's word nor the main daemon's");
});

test(`(b) free_port() as the script defines it hands out a loopback port the OS has just released — ten draws, each above 1023 and bindable at once; a port another socket took first (EADDRINUSE alone) is redrawn, at most ${EXTRA_DRAWS} times`, async (t) => {
  const fp = definition("free_port");
  assert.ok(fp, "the smoke defines no free_port() to run");
  const { ports, redraws } = await tenBound(fp, unpinned());
  assert.equal(ports.length, 10, `ten ports that bound: ${ports}`);
  t.diagnostic(`free_port(): ten ports bound after ${redraws} redraw(s) on EADDRINUSE (bound ${EXTRA_DRAWS}) — ${ports.join(" ")}`);
});

test("(b1) the collision arm — a planted EADDRINUSE on the first bind costs exactly one redraw and the case still ends with ten bound ports", async () => {
  const fp = definition("free_port");
  assert.ok(fp, "the smoke defines no free_port() to run");
  const redraw = redrawOf(fp);
  const { ports, redraws } = await tenBound(fp, unpinned(), { bind: planted(["EADDRINUSE"]), redraw });
  assert.equal(ports.length, 10, `ten ports that bound: ${ports}`);
  assert.deepEqual([redraws, redraw.calls], [1, 1], "one planted collision must cost exactly one redraw — no more, no fewer");
});

test("(b2) the refusal arm — a code that is not EADDRINUSE, or a throw with no code at all, reds the case at once naming it, and earns no redraw", async () => {
  const fp = definition("free_port");
  assert.ok(fp, "the smoke defines no free_port() to run");
  const redraw = redrawOf(fp);
  const atOnce = (named) => (e) => {
    assert.equal(e?.code, "ERR_ASSERTION", `the red must be this file's assertion, not a raw refusal: ${e?.code}`);
    assert.match(e.message, named, "the red must name what the bind answered with");
    assert.doesNotMatch(e.message, /extra draws/, "a refusal that is no collision must not be counted against the bound");
    return true;
  };
  await assert.rejects(tenBound(fp, unpinned(), { bind: planted(["EACCES"]), redraw }), atOnce(/would not bind it: EACCES/));
  // a throw with no code at all is no collision either — the red falls back to the error itself
  await assert.rejects(
    tenBound(fp, unpinned(), { bind: () => Promise.reject(new Error("planted: a throw with no code")), redraw }),
    atOnce(/would not bind it: Error: planted: a throw with no code/),
  );
  assert.equal(redraw.calls, 0, "a refusal that is no collision must not earn a redraw");
});

test(`(b3) the bound — EADDRINUSE on every bind exhausts the ${EXTRA_DRAWS} extra draws and reds naming the count; exactly ${EXTRA_DRAWS} collisions still end with ten bound ports`, async () => {
  const fp = definition("free_port");
  assert.ok(fp, "the smoke defines no free_port() to run");
  await assert.rejects(
    tenBound(fp, unpinned(), { bind: (port) => Promise.reject(refusal("EADDRINUSE", port)) }),
    (e) => {
      assert.equal(e?.code, "ERR_ASSERTION", `the red must be this file's assertion, not a raw refusal: ${e?.code}`);
      assert.match(e.message, new RegExp(`handed out ${EXTRA_DRAWS + 1} ports in a row .* more than the ${EXTRA_DRAWS} extra draws`), "the red must name the count and the bound");
      return true;
    },
  );
  const { ports, redraws } = await tenBound(fp, unpinned(), { bind: planted(Array(EXTRA_DRAWS).fill("EADDRINUSE")) });
  assert.deepEqual([ports.length, redraws], [10, EXTRA_DRAWS], "exactly the bound many collisions must still end with ten bound ports");
});

test("(b4) the shape check holds on a redraw too — a planted redraw of 80 after one collision reds at the shape, before any bind", async () => {
  const fp = definition("free_port");
  assert.ok(fp, "the smoke defines no free_port() to run");
  const bound = [];
  await assert.rejects(
    tenBound(fp, unpinned(), { bind: planted(["EADDRINUSE"], (port) => { bound.push(port); return bindable(port); }), redraw: () => 80 }),
    { code: "ERR_ASSERTION", message: /not a port the OS hands out: 80/ },
  );
  assert.equal(bound.includes(80), false, "80 must never reach a bind — the shape check comes first");
});

test("(c) pick_port() as the script defines it: TMUX-77's fixed layout while SMOKE_WEB_PORT is set, the OS's word when it is not", async () => {
  const defs = [definition("free_port"), definition("pick_port")];
  assert.ok(defs[0] && defs[1], "the smoke defines no pick_port()/free_port() to run");
  const B = 26100;
  const pinned = bash(defs, `PORT=${B}; for o in ${OFFSETS.join(" ")}; do pick_port $o; done`, { ...unpinned(), SMOKE_WEB_PORT: String(B) }).split("\n").map(Number);
  assert.deepEqual(pinned, OFFSETS.map((o) => B + o), "with SMOKE_WEB_PORT pinned the later dashboards do not keep the fixed offsets");
  const free = Number(bash(defs, "PORT=1; pick_port 7", unpinned()));
  assert.notEqual(free, 8, "with SMOKE_WEB_PORT unset pick_port() still does arithmetic on PORT");
  assert.ok(Number.isInteger(free) && free > 1023 && free < 65536, `not a port the OS hands out: ${free}`);
  assert.equal(await bindable(free), true, `pick_port() said ${free} but the OS would not bind it`);
});
