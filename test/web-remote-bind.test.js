/**
 * The dashboard's loopback decision is made BEFORE any socket is opened, and off loopback only a
 * typed --token counts (TMUX-102; gates G2 the posture sentence, G1 the guard's token half had 0
 * tests, G6 README:134-135 was stronger than the code).
 *
 * README.md:134-135 is the posture in one sentence: "Binds 127.0.0.1; any other host is refused
 * unless you pass both --dangerously-allow-remote and --token." Measured 2026-09-14 06:3xZ on
 * af231ba and 08:2xZ on 4f3e93d (scratch/ga-fire-2026-09-14-08Z/remote-bind-probe/run1-4f3e93d.log):
 * the guard was startWeb's first statement, but startWeb ran THIRD in the web verb — after
 * findFreePort had listen()ed on the requested host up to twenty times and after resolveToken had
 * read or minted the stored web-token. Three consequences: smoke-web's step 6 (--host 0.0.0.0) was
 * green while a probe socket had listened on all interfaces for one round-trip; `--dangerously-
 * allow-remote` with no --token passed the guard on the auto-generated token, where the README says
 * refused; and nothing in test/ named the flag, so deleting the "requires --token" throw left the
 * suite green.
 *
 * Every case here targets 192.0.2.1 — TEST-NET-1 (RFC 5737), on no interface anywhere, and with the
 * kernel's ip_nonlocal_bind default of 0 a bind on it can only fail. So a RED run cannot open a
 * listener, and the port finder's answer to a probe on it is the tell that a socket was attempted
 * before the refusal: `listen EADDRNOTAVAIL`, named at once since TMUX-180 (the finder scans past
 * EADDRINUSE alone now); `no free port` — EADDRNOTAVAIL twenty times — before it. BIND_ATTEMPTED
 * matches both, so a guard demoted to second place cannot pass on the finder's wording. Never
 * 0.0.0.0 here: on that host a guard that runs second still prints "refusing to bind" — after the
 * bind — and the test would pass on the bug.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) --host 192.0.2.1 with no override → exit non-zero, output says "refusing to bind" and never
 *       "no free port" (RED on 4f3e93d: the finder ran first and its message is all there is);
 *   (b) --dangerously-allow-remote --no-token → "requires --token", never "no free port" (RED on
 *       4f3e93d: same);
 *   (c) --dangerously-allow-remote with a web-token already in the home → "requires --token": the
 *       stored token serves loopback only, off loopback it must be typed (RED on 4f3e93d twice over —
 *       the finder ran first, and had it not, resolveToken's token would have passed the guard); the
 *       planted token is in neither stream;
 *   (d) startWeb from dist/web/server.js with { host: "192.0.2.1", allowRemote: true, token:
 *       undefined } throws synchronously with "requires --token", and with allowRemote unset throws
 *       "refusing to bind" — RED when either throw is removed (the stub orchestrator has no home, so
 *       a run past the guard dies on a TypeError before any listen; on this host a listen would meet
 *       EADDRNOTAVAIL anyway);
 *   (e) the override still exists: --dangerously-allow-remote --token <value> reaches the port
 *       finder, whose first probe on an unbindable host meets EADDRNOTAVAIL — named at once since
 *       TMUX-180, `tmux-agent web: listen EADDRNOTAVAIL on 192.0.2.1:<port> — …`, exit 71 (until
 *       then twenty probes and `no free port … on 192.0.2.1`, exit 1) — a guard that refused
 *       everything would pass (a)–(d) and fail here; the typed token is in neither stream.
 * Loopback's unchanged behaviour (auto-token, --no-token, forward port scan) is what every other
 * built-dashboard suite and test/smoke-web.sh exercise on 127.0.0.1.
 *
 * Run: node --test test/web-remote-bind.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

/** TEST-NET-1: routable nowhere, assigned to no interface — a bind on it can only fail. */
const HOST = "192.0.2.1";
const PORT = 47391;
const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const tmpHome = (tag) => tempHome(`ta-remote-bind-${tag}-`);
after(() => removeTempHomes()); // every home this file made, once its last test has run

/**
 * Run the built `web` verb against HOST from `home`; resolve with { code, out } once it exits (it
 * must — a dashboard cannot come up on this host). Both streams are merged, and any token URL is
 * redacted before it can reach an assertion message, as in helpers/built-web.js.
 */
function web(home, args) {
  return new Promise((resolve) => {
    const p = spawn(
      process.execPath,
      [BIN, "--socket", `ta-remote-bind-${process.pid}`, "--actor", "remote-bind-test", "web", "--port", String(PORT), "--host", HOST, ...args],
      { env: { ...process.env, TMUX_AGENT_HOME: home }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.stderr.on("data", (d) => { out += String(d); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 20_000);
    p.once("exit", (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/token=\S+/g, "token=<redacted>") }); });
  });
}

const REFUSED = /refusing to bind 192\.0\.2\.1: loopback only/;
const NEEDS_TOKEN = /--dangerously-allow-remote requires --token/;
/** The finder's two answers to a probe on TEST-NET-1 — before and since TMUX-180 — either one the tell that a socket was attempted. */
const BIND_ATTEMPTED = /no free port|listen EADDRNOTAVAIL/;

test("(a) a non-loopback --host is refused before any socket is opened", async () => {
  const r = await web(tmpHome("a"), []);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, REFUSED, r.out);
  assert.doesNotMatch(r.out, BIND_ATTEMPTED, `a bind was attempted before the refusal: ${r.out}`);
});

test("(b) --dangerously-allow-remote --no-token is refused: the override requires a token", async () => {
  const r = await web(tmpHome("b"), ["--dangerously-allow-remote", "--no-token"]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, NEEDS_TOKEN, r.out);
  assert.doesNotMatch(r.out, BIND_ATTEMPTED, `a bind was attempted before the refusal: ${r.out}`);
});

test("(c) the stored web-token does not satisfy the override — off loopback the token must be typed", async () => {
  const home = tmpHome("c");
  const planted = "planted-web-token-never-printed";
  writeFileSync(join(home, "web-token"), planted + "\n", { mode: 0o600 });
  const r = await web(home, ["--dangerously-allow-remote"]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, NEEDS_TOKEN, r.out);
  assert.doesNotMatch(r.out, BIND_ATTEMPTED, `a bind was attempted before the refusal: ${r.out}`);
  assert.doesNotMatch(r.out, new RegExp(planted), "the stored token leaked into the output");
});

test("(d) startWeb itself refuses synchronously, so a caller that bypasses the CLI cannot bind remotely", async () => {
  const { startWeb } = await import(pathToFileURL(join(ROOT, "dist", "web", "server.js")).href);
  // stubs: the guard must throw before any of them is touched — a run past it dies on a TypeError,
  // which is the wrong error, and this test's red
  const stub = {};
  assert.throws(() => startWeb(stub, stub, stub, stub, stub, { port: PORT, host: HOST, allowRemote: true, token: undefined }), NEEDS_TOKEN);
  assert.throws(() => startWeb(stub, stub, stub, stub, stub, { port: PORT, host: HOST, allowRemote: false, token: "typed" }), REFUSED);
});

test("(e) the documented override still exists: both flags with a typed token reach the port finder", async () => {
  const typed = "typed-token-never-printed";
  const r = await web(tmpHome("e"), ["--dangerously-allow-remote", "--token", typed]);
  assert.notEqual(r.code, 0, r.out);
  assert.equal(r.code, 71, `exit ${r.code}, not 71 (EX_OSERR) — the finder's first probe on an unbindable host is named, not scanned past: ${r.out}`);
  assert.match(r.out, /^tmux-agent web: listen EADDRNOTAVAIL on 192\.0\.2\.1:47391 — \S/m, r.out);
  assert.doesNotMatch(r.out, /no free port/, `the finder scanned past EADDRNOTAVAIL and blamed port pressure: ${r.out}`);
  assert.doesNotMatch(r.out, REFUSED, r.out);
  assert.doesNotMatch(r.out, NEEDS_TOKEN, r.out);
  assert.doesNotMatch(r.out, new RegExp(typed), "the typed token leaked into the output");
});
