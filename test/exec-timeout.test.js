/**
 * exec's timeout path on a REAL isolated tmux.
 *
 * The fake-tmux exec cases in orchestrator.test.js answer `wait-for` instantly, so they never see
 * what the driver does to the one tmux verb that blocks by design. Measured 2026-09-13 on 5744c54
 * (scratch/ga-fire-2026-09-13-12Z/exec-timeout-probe/): the driver killed `wait-for` at its fixed
 * 5 s per-call timeout, swallowed the kill, and only THEN started the caller's timeoutMs poll — so
 * the real bound was 5 s + timeoutMs, `sleep 6` at timeoutMs=2000 came back exitCode 0 after 6.5 s,
 * and when the bound was finally hit the tool unlinked its temp files while the pane still ran the
 * script, whose last lines re-created `.exec-<id>.rc` (mode 664, the pane shell's umask) in the
 * cleaned home and ledgered nothing after `input.sent`. These cases drive that path end to end:
 * the bound, the terminal ledger event, the empty home, the 0600 pane-side files, and no false
 * timeout for a command that finishes in time. All four were RED on 997c08b.
 *
 * Run: node --test test/exec-timeout.test.js   (needs `npm run build` and a tmux binary)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tmux, paneTarget } from "../dist/core/tmux.js";
import { Ledger } from "../dist/core/ledger.js";
import { Policy } from "../dist/core/policy.js";
import { Orchestrator, foregroundProgram } from "../dist/core/orchestrator.js";
import { killServerSync } from "./helpers/kill-server.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const HOME = tempHome("ta-exto-");
process.env.TMUX_AGENT_HOME = HOME;
const SOCKET = `ta-exto-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
const NAME = "exto1";
const tmux = new Tmux({ socket: SOCKET });
const ledger = new Ledger(join(HOME, "ledger"));
const orch = new Orchestrator(tmux, ledger, new Policy(), "exto-test");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const execFiles = () => readdirSync(HOME).filter((f) => f.startsWith(".exec-"));
const events = (type) =>
  readFileSync(ledger.path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === type);

/**
 * Hold until the pane is back at a shell prompt — read the way exec's own TUI guard reads it, and
 * required twice in a row so the gap between `sleep` exiting and the script's last lines running
 * (when the deepest foreground process is briefly `sh` itself) cannot pass for a prompt.
 */
async function waitForPrompt(ms, what) {
  const deadline = Date.now() + ms;
  let quiet = 0;
  while (Date.now() < deadline) {
    const info = await tmux.paneInfo(NAME);
    quiet = !info.dead && (await foregroundProgram(info.currentCmd, info.pid)) === null ? quiet + 1 : 0;
    if (quiet >= 2) return;
    await sleep(200);
  }
  assert.fail(`timeout: ${what}`);
}

before(async () => {
  await orch.spawn({ name: NAME, cwd: tmpdir(), parent: "exto-test" });
  // Never type into a pane that is still drawing: host init files run on isolated sockets too (a
  // line editor that REPLAYS keys buffered during init, a pty wrapper around the shell) — borrowed
  // from wait_quiet() in test/smoke.sh. Two identical non-empty captures 500 ms apart = settled.
  let prev = "";
  let quiet = false;
  for (let i = 0; i < 40; i++) {
    const cur = await tmux.capturePane(NAME, 40).catch(() => "");
    if (cur.trim().length > 0 && cur === prev) { quiet = true; break; }
    prev = cur;
    await sleep(500);
  }
  assert.ok(quiet, "test setup: the fresh shell never went quiet (20 s)");
  // Quiet is NOT guard-ready: a pane can be idle while its deepest foreground process is
  // still the host's pty wrapper (kiro-cli-term) or a still-running login rc, and every execSync case
  // below would be refused there — RIGHTLY. waitForPrompt asks exec's own guard directly
  // (foregroundProgram() === null, twice), in-process — an `exec … true` through the CLI would add the
  // exec.done row the (113)/(115) cases count. Measured on the 5f1de3e dist, case 112 went red here under load.
  await waitForPrompt(20_000, "the spawned pane never presented a shell to exec's guard (20 s)");
});

after(() => {
  killServerSync(SOCKET); // kill-server, wait until tmux says the server is gone, unlink its socket file
  removeTempHomes(); // and the HOME every exec file above landed in
});

test("execSync: timeoutMs is the wall-clock bound — 500 ms rejects in well under the driver's 5 s", async (t) => {
  const t0 = Date.now();
  // `sleep 6` outlives 5 s + 500 ms, so the parent could not call it a success either way: it threw at
  // ~5.9 s (the driver's wait-for kill ran BEFORE the bound started). A `sleep 3` was worse there —
  // it finished inside the hidden 5 s and came back exitCode 0 after 4.9 s (RED log, this fire).
  await assert.rejects(() => orch.execSync(NAME, "sleep 6", 500), /execSync timeout/);
  const elapsed = Date.now() - t0;
  t.diagnostic(`execSync(sleep 6, timeoutMs=500) rejected after ${elapsed} ms`); // the number, on green too
  // The budget is timeoutMs + the send + one poll tick + the holder read (TMUX-167: bounded at 750 ms,
  // ~60 ms measured here — two `ps` passes and one capture-pane); 2.25 s leaves room for a slow CI
  // runner while staying a full 3 s away from the defect.
  assert.ok(elapsed < 2_250, `rejected after ${elapsed} ms — the driver's per-call timeout must not precede the bound`);
});

test("execSync: a timed-out exec ledgers ONE terminal exec.timeout with id/timeoutMs/elapsedMs/command", () => {
  const evs = events("exec.timeout");
  assert.equal(evs.length, 1, `exec.timeout events: ${evs.length}`);
  const d = evs[0].data;
  assert.equal(evs[0].session, NAME);
  assert.match(String(d.id), /^ta[0-9a-z]+$/);
  assert.equal(d.timeoutMs, 500);
  assert.ok(typeof d.elapsedMs === "number" && d.elapsedMs >= 500 && d.elapsedMs < 1_500, `elapsedMs=${d.elapsedMs}`);
  assert.equal(d.command, "sleep 6");
  assert.equal(events("exec.done").length, 0, "a timed-out exec must not also be reported done");
});

test("execSync: nothing is left in the home once the timed-out command finishes on its own", async () => {
  // the pane is still running `sleep 6`; the script's last lines are what used to re-create the rc file
  await waitForPrompt(15_000, "the timed-out command never returned the pane to its prompt");
  await sleep(300); // give a straggling `printf > rc` its chance to leak
  assert.deepEqual(execFiles(), [], "exec temp files left in the home after the pane's script finished");
});

test("execSync: a command that finishes inside the bound resolves (no false timeout) and its pane-side file is 0600", async () => {
  const p = orch.execSync(NAME, "sleep 1; echo ok", 3_000);
  // the pane shell creates .exec-<id>.out when the command starts; it lives in a 0700 home but
  // must itself be private — before TMUX-98 it took the pane shell's umask (664 on the dev host)
  let out = null;
  for (let i = 0; i < 60 && !out; i++) {
    out = execFiles().find((f) => f.endsWith(".out")) ?? null;
    if (!out) await sleep(50);
  }
  assert.ok(out, "the running command's .out file never appeared in the home");
  assert.equal((statSync(join(HOME, out)).mode & 0o777).toString(8), "600", `${out} mode`);
  const r = await p;
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /ok/);
  assert.deepEqual(execFiles(), []);
  assert.equal(events("exec.done").length, 1);
  assert.equal(events("exec.timeout").length, 1, "the earlier timeout is the only exec.timeout");
});

/**
 * The deepest shell under the pane — the process exec's guard reads as "a shell" — from one portable
 * `ps` pass (pid=,ppid=,comm=; comm normalised the way commName() does: basename, no login dash).
 * Returns { pid, comm } or null. The test's OWN reading, so the case does not lean on the code under test.
 */
function deepestShell(panePid) {
  const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "ash"]);
  const out = execFileSync("ps", ["-eo", "pid=,ppid=,comm="], { encoding: "utf8", timeout: 3000 });
  const kids = new Map();
  const comm = new Map();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    comm.set(Number(m[1]), (m[3].split("/").pop() ?? "").replace(/^-/, ""));
    if (!kids.has(Number(m[2]))) kids.set(Number(m[2]), []);
    kids.get(Number(m[2])).push(Number(m[1]));
  }
  let best = null;
  const walk = (p, depth, seen) => {
    if (seen.has(p)) return;
    seen.add(p);
    if (SHELLS.has(comm.get(p)) && (best === null || depth > best.depth)) best = { pid: p, comm: comm.get(p), depth };
    for (const k of kids.get(p) ?? []) walk(k, depth + 1, seen);
  };
  walk(panePid, 0, new Set());
  return best;
}

test("execSync: a pane that takes the line and never completes it — its shell STOPPED at its prompt — times out NAMING what held the pane, in the error and in exec.timeout", async (t) => {
  // The shape of the 2026-09-27 14:23Z in-suite red on clean f50cbed (scratch/ga-fire-2026-09-27-14Z/
  // npm-test-preflight.log): exec's guard saw a shell at its drawn prompt, the pane took the injected
  // line, and for 18 s nothing completed it — the host's pty wrapper above that shell had stopped
  // forwarding keys. The product's own timeout said only its bound. Planted portably here one level
  // up: SIGSTOP the shell the guard reads. It is still the foreground process group of its tty (the
  // guard still says shell), its comm is still the shell's, and it reads nothing — the identical fact.
  const info = await tmux.paneInfo(NAME);
  // The shell we stop is never tmux's DIRECT child: tmux SIGCONTs a stopped pane process at once
  // (server_child_stopped, every stop signal but SIGTTIN/SIGTTOU). CI run 36327152172 on f6b4a26 —
  // all six test cells: the pane's root process IS the shell there, the stop lasted one tick, `true`
  // ran and execSync RESOLVED in 585 ms ("Missing expected rejection"); on this host the shell sits
  // under the pty wrapper kiro-cli-term, out of tmux's sight, and the case was green. So the pane is
  // handed to a NON-job-control `sh -c` — no WUNTRACED, it never learns of the stop; an interactive
  // shell would take the terminal back and read the keys itself — whose child is the interactive bash
  // the guard reads. The `; exit` keeps sh from exec-optimising a lone command into bash in sh's pid.
  await waitForPrompt(15_000, "the pane was not at its prompt before the handoff");
  await tmux.exec(["send-keys", "-t", paneTarget(NAME), "exec sh -c 'bash --norc --noprofile; exit'", "Enter"]);
  // …and SETTLED: the same bash pid on two reads 300 ms apart, at least one level below the pane's own
  // process. Read once, the pick can be a transient `sh <script>` in its last tick (it exited between
  // the read and the SIGSTOP: `kill ESRCH`, first run of this case).
  let shell = null;
  for (let i = 0; i < 40 && !shell; i++) {
    const a = deepestShell(info.pid);
    await sleep(300);
    const b = deepestShell(info.pid);
    if (a && b && a.pid === b.pid && a.comm === "bash" && a.pid !== info.pid && a.depth >= 1) shell = b;
  }
  assert.ok(shell, `test setup: no settled bash below the pane's own process ${info.pid} within 12 s (a direct child would be SIGCONTed by tmux)`);
  const before = events("exec.timeout").length;
  process.kill(shell.pid, "SIGSTOP");
  let err = null;
  const t0 = Date.now();
  try {
    await assert.rejects(() => orch.execSync(NAME, "true", 1_500), (e) => { err = e; return true; });
  } finally {
    process.kill(shell.pid, "SIGCONT");
  }
  const elapsed = Date.now() - t0;
  t.diagnostic(`execSync(true, timeoutMs=1500) into a stopped ${shell.comm} rejected after ${elapsed} ms: ${err.message}`);
  // The three facts test/helpers/pane-holder.js reads at a cut, now from the product itself — plus each
  // process's ps STAT, so a STOPPED shell (or wrapper) is named as stopped: `bash(T)`, not `bash`.
  const prefix = "execSync timeout in exto1 after 1500ms — the pane took the line and nothing completed it: ";
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}the guard saw a shell; the pane ran [^;]*${shell.comm}\\(T[^)]*\\)[^;]*; its last line read "`);
  assert.match(err.message, re, `the timeout does not name what held the pane: ${err.message}`);
  // The bound stays a bound: the holder read is itself bounded (750 ms), so the call returns inside
  // timeoutMs + that bound + the send and one poll tick. 3 s leaves room for a slow CI runner.
  assert.ok(elapsed < 3_000, `rejected after ${elapsed} ms — the diagnostic read must not hold the wait it serves`);
  const evs = events("exec.timeout");
  assert.equal(evs.length, before + 1, `exec.timeout events: ${evs.length}, want ${before + 1}`);
  const d = evs[evs.length - 1].data;
  assert.equal(typeof d.holder, "string", `exec.timeout data has no holder: ${JSON.stringify(d)}`);
  assert.equal(prefix + d.holder, err.message, "the ledger's holder and the error's holder are one string");
  // elapsedMs is the exec's own elapsed at the bound, measured BEFORE the holder read
  assert.ok(d.elapsedMs >= 1_500 && d.elapsedMs < 2_000, `elapsedMs=${d.elapsedMs}`);
  assert.equal(d.command, "true");
  // SIGCONT replays the buffered line: the pane runs `sh <script>` whose file the timeout already
  // unlinked, prints its complaint and is back at its prompt with nothing left in the home.
  await waitForPrompt(15_000, "the pane never returned to its prompt after SIGCONT");
  await sleep(300);
  assert.deepEqual(execFiles(), [], "exec temp files left in the home after the stopped shell resumed");
});
