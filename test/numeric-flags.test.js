/**
 * Numeric flags are read once and refused before anything is touched — `watch --idle-secs` and
 * `web --port` (TMUX-104; gates G1 a load-bearing demo path whose failure mode had no test, G3 a
 * silent hang where README says failures are loud, G6 README.md:50 and VERSIONING item 1's `0 idle`
 * true only for a well-formed value).
 *
 * README.md:50 is step 4 of the 5-minute demo: `tmux-agent watch worker-1 --idle-secs 60`;
 * src/bin/tmux-agent.ts:9 documents `watch <name> [--idle-secs N]`; VERSIONING.md item 1 declares
 * `watch` exits 0 on idle. Until 2026-09-14 the verb did `Number(flag("idle-secs") ?? 30)` and took
 * the idle exit on `Date.now() - idleSince > idleSecs * 1000`. `Number()` returns NaN for anything it
 * cannot read and every comparison with NaN is false — so a mistyped value could never take the exit
 * the README promises. Measured 2026-09-14 12:3xZ on 62f787d and 14:3xZ on caa6810
 * (scratch/ga-fire-2026-09-14-14Z/numflag-probe/run1-caa6810.log): `--idle-secs 3` exited 0 in 3.2 s;
 * `3O` (the letter), `30s` and `abc` printed nothing on either stream and were still blocking when
 * timeout(1) killed them at 20 s; an empty value is `Number("") === 0` and fired at once as `idle 0s`,
 * `-5` as `idle -5s`; `--idle-secs` as the last argument silently took the default. On the same reader
 * `web --port abc`, `70000` and `12.5` exited 1 with Node's own `options.port should be >= 0 and
 * < 65536` and no flag named. Every `--idle-secs` a test passed was 3 or 30; every `--port` a test
 * passed was a shell variable holding a free port.
 *
 * Black-box through the built CLI like test/watch.test.js, because the contract is the exit code and
 * the streams. Every run is bounded by its own execFile timeout so a red run cannot hang the suite —
 * on the parent the bound is what goes red. The contract, each line a check that FAILS if the property
 * is removed:
 *   (a) the control: `--idle-secs 3` on a spawned shell exits 0 with the IDLE snapshot (stays green);
 *   (b) `3O`, `30s`, `abc` and `12.5` are refused with exit 64 within the bound — RED on caa6810,
 *       where the bound killed them;
 *   (c) an empty value, `0` and `-5` are refused — RED on caa6810: exit 0 as `idle 0s` / `idle -5s`;
 *   (d) `--idle-secs` as the last argument is refused — RED on caa6810: the default applied silently;
 *   (e) each refusal is one stderr line naming the flag, the value (or that none was given) and the
 *       accepted form, with nothing on stdout;
 *   (f) the refusal comes BEFORE any file: a TMUX_AGENT_HOME that does not exist is still absent
 *       afterwards — RED on caa6810, where the orchestrator created it on its way to the hang;
 *   (g) `web --port abc`, `70000`, `12.5`, `0`, an empty value and the flag as the last argument are
 *       refused with exit 64 naming `--port` and the range, and Node's `options.port` text never
 *       appears — RED on caa6810 (exit 1 with Node's text; a listener for the empty value);
 *   (h) `doctor --port abc` is unchanged: exit 0 and `dashboard.reason` names the invalid port —
 *       doctor is a report, so its bad-port answer stays a value in the block.
 *
 * Run: node --test test/numeric-flags.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
// The card's bound: a refusal is one process start; the parent sat here until timeout(1) killed it.
const BOUND_MS = 5_000;
const IDLE_FORM = /whole number of seconds .*such as 60/;
const PORT_FORM = /port between 1 and 65535/;

function socket() {
  return `ta-numflag-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — the parent's hang. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** The one message every refusal gives: the flag first, the rejected value (or that none was given), the form. */
function assertRefusal(stderr, flagName, value, form, label) {
  const lines = stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${stderr}`);
  const msg = lines[0];
  assert.match(msg, new RegExp(`^--${flagName}: `), `${label}: the message names the flag first: ${msg}`);
  if (value === undefined || value.trim() === "") assert.match(msg, /no value given/, `${label}: an empty value is named as such: ${msg}`);
  else assert.ok(msg.includes(JSON.stringify(value)), `${label}: the rejected value is quoted: ${msg}`);
  assert.match(msg, form, `${label}: the accepted form is shown: ${msg}`);
  assert.doesNotMatch(msg, /options\.port|RangeError|\.js:\d+/, `${label}: Node's own error text, not the CLI's refusal: ${msg}`);
}

const argLabel = (verb, flagName, v) => `${verb} --${flagName} ${v.length ? JSON.stringify(v[0]) : "(as the last argument)"}`;

test("watch --idle-secs: the control exits 0 on a spawned shell; unreadable, empty, zero, negative and valueless flags are refused with exit 64 before the home exists", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-numflag-"));
  const S = socket();
  try {
    const sp = await cli(["--socket", S, "spawn", "nf-idle", "--cwd", "/tmp", "--parent", "numflag-test"], { TMUX_AGENT_HOME: H }, 30_000);
    assert.equal(sp.code, 0, `test setup: spawn exited ${sp.code}: ${sp.stderr}`);

    // (a) the control — a fresh shell sits at its prompt: idle within one 3 s poll (watch.test.js:73-75)
    const ok = await cli(["--socket", S, "watch", "nf-idle", "--idle-secs", "3"], { TMUX_AGENT_HOME: H, TMUX_AGENT_SLACK_WEBHOOK: "" }, 30_000);
    assert.equal(ok.code, 0, `watch --idle-secs 3 exited ${ok.code}: ${ok.stderr.slice(0, 200)}`);
    assert.equal(JSON.parse(ok.stdout.trim().split("\n").pop()).state, "IDLE", "the control's snapshot is the idle one");
    assert.match(ok.stderr, /idle 3s/, "the console sink names the seconds that fired");

    // (b)(c)(d)(e)(f) — each against a home that does not exist yet: the refusal must precede Orchestrator's mkdir
    const cases = [["3O"], ["30s"], ["abc"], ["12.5"], [""], ["0"], ["-5"], []];
    for (const [i, v] of cases.entries()) {
      const never = join(H, `never-${i}`);
      const label = argLabel("watch nf-idle", "idle-secs", v);
      const r = await cli(["--socket", S, "watch", "nf-idle", "--idle-secs", ...v], { TMUX_AGENT_HOME: never, TMUX_AGENT_SLACK_WEBHOOK: "" });
      assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) — on caa6810 the unreadable values hung to the bound and the empty/negative ones exited 0 as "idle 0s" (stdout: ${JSON.stringify(r.stdout.slice(0, 160))})`);
      assert.equal(r.stdout, "", `${label} printed a snapshot it should have refused before`);
      assertRefusal(r.stderr, "idle-secs", v[0], IDLE_FORM, label);
      assert.equal(existsSync(never), false, `${label}: the home directory was created before the flag was judged`);
    }
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("web --port: unreadable, out-of-range, fractional, zero, empty and valueless values are refused with exit 64 naming --port, and Node's options.port text never appears", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-numflag-web-"));
  const S = socket();
  try {
    // --strict-port so a parent that reads 0 or the default does not scan for a neighbour of a live dashboard
    const cases = [["abc"], ["70000"], ["12.5"], ["0"], [""], []];
    for (const [i, v] of cases.entries()) {
      const never = join(H, `never-${i}`);
      const label = argLabel("web --no-token --strict-port", "port", v);
      const r = await cli(["--socket", S, "web", "--no-token", "--strict-port", "--port", ...v], { TMUX_AGENT_HOME: never });
      assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) — on caa6810 this was exit 1 with Node's options.port text (stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
      assert.equal(r.stdout, "", `${label} wrote to stdout`);
      assertRefusal(r.stderr, "port", v[0], PORT_FORM, label);
      assert.equal(existsSync(never), false, `${label}: the home directory was created before the flag was judged`);
    }
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("doctor --port abc stays a report: exit 0 and dashboard.reason names the invalid port, nothing probed (TMUX-93 contract, left as-is by TMUX-104)", async () => {
  const H = mkdtempSync(join(tmpdir(), "ta-numflag-doctor-"));
  const S = socket();
  try {
    const r = await cli(["--socket", S, "doctor", "--port", "abc"], { TMUX_AGENT_HOME: H }, 20_000);
    assert.equal(r.code, 0, `doctor --port abc exited ${r.code}: ${r.stderr}`);
    const doctor = JSON.parse(r.stdout);
    assert.equal(doctor.dashboard.reachable, false);
    assert.match(doctor.dashboard.reason, /invalid port NaN — nothing probed/, "doctor's bad-port answer is a value in the block, as TMUX-93 shipped it");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});
