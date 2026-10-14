/**
 * A freshly spawned pane is not immediately at a shell prompt, and exec's guard is RIGHT to refuse until it is
 * (TMUX-121, gate G1 — "the suite is green" is the correctness gate's evidence, and it was not, on the machine
 * the release is cut from).
 *
 * The window. On a host whose shell init starts a pty wrapper — kiro-cli-term here, `script` / `asciinema rec` /
 * `expect` elsewhere — the pane's own process becomes the wrapper and the shell the keystrokes will reach appears
 * one pty DOWN a moment later. Until that nested shell exists the deepest foreground process under the pane is
 * the wrapper, so `exec` refuses by name, exactly as TMUX-97/99 taught it to: a keystroke in that window would be
 * eaten by the wrapper. Measured 2026-09-17 on the c0012ef dist against the shipped `foregroundProgram()`
 * (scratch/ga-fire-2026-09-17-10Z/fgprobe/probe-c0012ef.log) — the answer OSCILLATES: shell at t=0.01s,
 * "kiro-cli-term" at t=0.66s, shell again from t=1.32s, with `ps` showing the pane pid as the wrapper
 * (pgid == tpgid) and a nested bash one level below it. smoke.sh step 3 exec'd straight after spawn/send and so
 * raced a ~0.7 s window: `npm test` was red on 2 of 2 runs this fire and 2 of 5 on 2026-09-16, while CI — whose
 * shells load no wrapper — stayed 13/13 green on the same commit (run 35200400114). A check that fails for the
 * checker's reasons is worse than no check, so the pane's readiness became a precondition to WAIT for.
 *
 * The contract, measured against REAL tmux on a throwaway socket and home (the operator's fleet is never
 * touched) because the value under test is what the process table says about a live pane, which no fake can be
 * trusted to reproduce. The window is created on demand rather than hoped for: `sleep N; exec bash` puts a
 * non-shell in the pane's own process for N seconds and then execs a shell into the SAME pid — measured to make
 * the guard read "sleep" then null (fgprobe/window-recipe.log), on any host with `sleep` and a shell:
 *   (a) the pane held by a non-shell is REFUSED by name — the control the whole card rests on. It is green on the
 *       parent too: that is what makes it a control, and it is why the fix may not be "make exec wait";
 *   (b) `test/helpers/wait-shell.sh` exits 0 within its bound on that same pane, and the `exec` that follows
 *       returns its marker — the wait clears the window;
 *   (c) a pane held by a real pager makes the wait exit non-zero within ~its bound, NAMING what holds it — so the
 *       wait can never degrade into a silent skip of the thing the caller meant to test;
 *   (d) the wait stays inside the grammar macOS CI's bash 3.2 has: no `bc`, no `date +%N`, no associative arrays.
 * Every CLI run is bounded so a red cannot hang the suite.
 *
 * FAIL-first on the parent c0012ef dist: (b), (c) and (d) red — test/helpers/wait-shell.sh does not exist there
 * ("bash: test/helpers/wait-shell.sh: No such file or directory", rc 127) — with (a) green, and the behavioural
 * red beside them: step 3's shape (spawn, then exec with no wait) against the deterministic window pane,
 * refused. Output on TMUX-121.
 *
 * The bound was not a bound (TMUX-124, case (e)). The wait checked its bound only BETWEEN attempts, and an
 * attempt is an `exec` — bounded by execSync's own default of 120 s. So (b) itself went red on this host on
 * 2 of 2 full-suite runs at 18:23Z, with the signature that made it undiagnosable: "killed after 40000 ms"
 * on a 30 s bound, stdout AND stderr empty, the assertion blaming a wait that had not given up — the
 * caller's timeout had killed it mid-attempt. xtrace inside the suite named the attempt: number 13, started
 * at s=5 — the handoff instant — and never returned (scratch/ga-fire-2026-09-17-18Z/wsprobe/suite-xtrace.log).
 *   (e) the bound is a bound: a pane at a shell that can never RUN the injected script (no `sh` on its PATH,
 *       so exec's rc file never appears) makes the wait give up INSIDE its bound — wall clock measured — and
 *       name the attempt it cut. Its control comes first: exec must be ALLOWED into that pane and block, or
 *       the case would pass on a fast refusal without testing the bound. FAIL-first on parent f79656d: the
 *       wait was still running at 40 s on a 6 s bound with stdout and stderr empty, rc 137
 *       (wsprobe/bound-parent-f79656d.log) — the suite red's signature, on demand.
 *
 * The bound's spending was not itemised (TMUX-146, cases (c)/(e)/(f)). `npm test` on the clean 6b16055
 * tree at 2026-09-21 10:23Z was 460 of 461 with (b) red — "within 30s (17 attempts) — attempt 17 cut at
 * 4s still inside exec" — and that red is NOT reproduced on demand: 3/3 green isolated runs of this file,
 * 461/461 on a full unit run, 30/30 green probes of (b)'s own recipe against the real helper (12–13
 * attempts, 5–7 s), host load ~1.1 on 96 cores (scratch/ga-fire-2026-09-21-10Z/probe/). What the line
 * could not say is what the bound was SPENT on: only the last cut was kept, so 1 cut out of 17 attempts
 * and 16 read identically, and they have different causes. The give-up now counts cuts apart from
 * refusals, and the two panes whose outcome is deterministic drive the two ends — (c)'s pager refuses
 * every attempt, (e)'s no-`sh` pane completes none. The third input that red carried was the host's own
 * shell: a bare `exec bash` in a tmux pane is INTERACTIVE, so it sourced ~/.bashrc (366 lines here, ble.sh
 * at :307 — a key-REPLAY layer between tmux's keystrokes and the prompt that would run them — and the
 * kiro-cli hooks at :3 and :227), which nothing in (a) or (b) wanted to measure.
 *   (f) the shell (a)/(b) hand off to loads NO init, in both directions: a planted throwaway-HOME rc that
 *       touches a marker is not sourced by that pane, while the same recipe minus the flags does source it
 *       (the positive control first, so an absent marker is evidence about the flags and not the plant),
 *       and the init-free pane is then proven LIVE — an absent marker under a dead shell would be the same
 *       observation and no evidence. Stated limit: no case here drives the give-up's preference for the
 *       last REFUSAL over the last attempt, because neither deterministic pane mixes a refusal and a cut.
 *
 *   (g) waitForShell — the JS wrapper the CLI-driven unit files now wait through (positional-count,
 *       unknown-flags, versioning-contract) — clears a transiently-held pane (an immediate exec refused
 *       first, the control) and THROWS an Error carrying the helper's own stderr for a pager-held one, so
 *       a caller can neither type into a held pane nor forget the assertion;
 *   (h) a drift guard: the five files that type into a fresh pane reach exec's OWN guard before the
 *       first keystroke — the four CLI files through waitForShell, exec-timeout through its in-process
 *       waitForPrompt — green here on the ship tree, red on the 5f1de3e parent whose files typed on the
 *       watch --idle-secs exit / a quiet-capture loop alone and went red under host load; watch's BLOCKED
 *       case joined on 2026-10-13, having typed at spawn's return — has-session, not a shell.
 *
 * The cut could not say what HELD the pane (TMUX-161, cases (c)/(e)/(i)). Three `npm run test:coverage` reads
 * of six on the clean 62d7536 tree (2026-09-23 20Z, scratch/ga-fire-2026-09-23-20Z/wedge-giveups.log) lost
 * test/positional-count.test.js:102 to "(4 attempts, 4 cut, 0 refused) — attempt 4 cut at 4s still inside
 * exec (the pane took the injected line, nothing completed it); no attempt was refused" — the all-cuts
 * shape TMUX-146 itemised and said it could not reproduce, now 3 of 6 in the suite. Every attempt the guard
 * allowed it allowed because it saw a shell; the pane then drew something; neither was kept, so a shell
 * still in its login rc, a key-replaying line editor, the host's pty wrapper and a wedged `tmux wait-for`
 * all read the same. The give-up now quotes, for the LAST cut, what test/helpers/pane-holder.js read the
 * instant after it: the SHIPPED guard's own answer (`the guard saw a shell` / `the guard saw "less"`), the
 * processes under the pane by comm in tree order (`bash > kiro-cli-term > bash` tells a wrapped shell from
 * a bare one), and the pane's last non-empty line, 120 chars, through the shipped `redact` — a pane line is
 * operator output and THREAT-MODEL's read-boundary rule applies to a diagnostic as it does to a dashboard
 * cell. (e) asserts the three fields on the all-cuts pane; (c) asserts the all-refusals pane carries none of
 * them (its bound was spent refusing, and a cut clause there would be invented); (i) plants an AWS-key-shaped
 * prompt as the pane's last line and asserts the die shows `[REDACTED_AWS_KEY]` and never the planted key.
 *
 * (f)'s teardown raced its own shells (TMUX-158 follow-up). CI run 35829350278 on 906da72 (ubuntu-latest,
 * node 20) had every assertion of (f) green and its `finally` red: `ENOTEMPTY: directory not empty, rmdir
 * '/tmp/ta-ready-rc-quiet-…'`. The two rc dirs are the two shells' HOME, and an interactive bash writes
 * `$HOME/.bash_history` on its way out of the SIGHUP that `kill-server` hands it — measured on this host,
 * the file lands in the QUIET dir 5 ms after kill-server (scratch/ga-fire-2026-09-23-08Z/rcprobe-1.log) —
 * while the case removed those dirs in the very next statement. Killing is a signal, not a state (TMUX-116,
 * TMUX-129): the pane pids are now read while tmux still knows them, and after kill-server the teardown WAITS
 * for both shells to be gone before their HOME goes, asserting it. So that the wait is exercised on every run
 * rather than only on a slow runner, the planted rc also holds its shell 300 ms on exit (`trap 'sleep 0.3'
 * EXIT`, run by bash on SIGHUP — measured 1014 ms for a 1 s trap, rcprobe2-1.log): remove the wait and the
 * assertion names the control's pid every time, not once in thirty CI cells.
 *
 * TMUX-170 (2026-09-28): four of twelve `npm run test:coverage` reads on the clean 3762586 tree lost a CLI-driven case
 * to the wait's 20 s give-up reading `kiro-cli-term(S) > bash(S); its last line read "<the bare prompt>"` — the host's pty
 * wrapper AND the shell under it both ASLEEP, the injected line drawn nowhere, and the STAT letter TMUX-167 added unable
 * to say which of the two had stopped reading. Three more cases:
 *   (j) the give-up ATTRIBUTES such a cut by the pty that holds the unread line — the pane's own pty names the WRAPPER,
 *       a nested pty the SHELL (test/helpers/pane-holder.js: wait channels, FIONREAD per pty, the last three lines) —
 *       red-first on a REAL python3 pty wrapper with each process SIGSTOPped in turn, the control stopping neither;
 *   (k) the FIX: the CLI's `spawn` lands on the bare handoff shell when its server is quiet (test/helpers/quiet-server.js),
 *       proven under a planted login profile that installs such a wrapper, against a control server that is not quiet;
 *   (l) the drift guard that the three CLI-driven files quiet their server BEFORE they spawn.
 *
 * TMUX-195 (2026-10-02): `npm test` red on the clean 8375fb6 tree at the WEB smoke's step 3 — `refusing exec in web-child:
 * foreground process is "kiro-cli-term"` — the TMUX-121 window in the one smoke file TMUX-121 did not touch: test/smoke-web.sh
 * exec'd web-child straight after its spawn with only the dashboard start between them (once in 484 fire runs; CI's shells
 * load no wrapper). The step now waits the way test/smoke.sh:147 does, and:
 *   (m) the drift guard that BOTH smoke scripts wait for the pane to present a shell BEFORE their first exec into it, and
 *       that the wait's give-up is fatal — red on the parent's test/smoke-web.sh, red with the wait moved below the exec.
 *       Since TMUX-196 the same guard covers a `send`: test/smoke-web.sh step 23 pasted its 200 MB node allocation into
 *       mem-probe straight after the spawn, and the 2026-10-02 16:24Z run (one in 476) lost the line to the wrapper's
 *       window — echoed, `sent+verified`, never run — with the step reading it 12 s later as a missing process.
 *       Since TMUX-231 it covers test/smoke.sh step 11's two fresh panes, race-a and race-b, whose concurrent sends went
 *       in with no wait. (The step's CI misses on tmux 3.2a — `race-b lost its own input` 16:36Z on 92f59a6, `race-a`
 *       17:06Z on a2192f0, 2026-10-13 — were a buffer deleted from under a concurrent send, test/paste-buffer-cleanup.test.js;
 *       the waits are the rule every send site keeps, not that fix.)
 *
 * TMUX-200 (2026-10-13): a GA fire's hygiene census read one `ta-ready-<pid>-*` server, its socket and its home 458 s after a
 * GREEN 591/591 run — (g)'s held-js pager pane, ppid 1, alive since 06:55:48Z — and the card filed on it said the case had
 * passed while its teardown left the server behind. It had not: that server belonged to a DIFFERENT run, the suite the same
 * fire stopped with TaskStop at 06:55:52.449Z (its transcript) — the home's last ledgered refusal is stamped 06:55:52.475Z
 * and no attempt followed — while the green run's chain was launched 38 s after the server started. The harness SIGTERMs
 * every descendant of a stopped task, node:test installs no listener for that signal in a file's subprocess, so the file
 * died where it stood, its `finally` never ran, and the daemonised server — re-parented to init, no descendant — stayed.
 * Reproduced on demand by SIGTERMing `node --test` on this file while (g)'s pager holds its pane
 * (scratch/ga-fire-2026-10-13-08Z/attrib/). Three changes, and the case that holds them to their claim:
 *   - every server name is remembered from socket()'s draw and every directory from tempDir(), until cleanup() releases it;
 *   - cleanup() CHECKS its own verdict — tmux must refuse the name, no socket file may stand at the path tmux names, the
 *     home must be gone — so a teardown that leaves a server reds the case that ran it, naming the socket, and the file's
 *     after() hook reds (after tearing it down) for any name a case never released;
 *   - SIGTERM, SIGINT and SIGHUP tear down everything still held before the process exits 128 + the signal's number
 *     (test/helpers/signal-teardown.js). SIGKILL cannot be caught: that path stays the runner's hygiene line.
 *   (n) a child runs THIS file with only its hold case selected — a pane a pager holds, mid-case — and each of the three
 *       signals, sent to that child alone, leaves no server, no socket file and no home, read in tmux's own words before
 *       the exit status the helper promises. Red on the file without the signal teardown, naming the socket.
 *
 * Run: node --test test/exec-ready-wait.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";
import { onSignalTeardown, TEARDOWN_SIGNALS } from "./helpers/signal-teardown.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const WAIT = join(ROOT, "test", "helpers", "wait-shell.sh");
/** exec is one guard read plus one injection round trip; the wait's own bound is passed per call. */
const BOUND_MS = 40_000;
/** Wide enough that a loaded CI runner cannot close the window before the case looks at it. */
const WINDOW_S = 5;
/** (e)'s wait bound, and the ceiling it must stay under: BOUND_S + the helper's 5 s attempt bound + CI slack. */
const BOUND_S = 6;
const CEILING_MS = 20_000;
/** (e)'s control: long enough that a blocking exec is unmistakable, far short of execSync's 120 s default. */
const CONTROL_MS = 6_000;
/**
 * The shell (a) and (b) hand off TO. `--norc --noprofile` is load-bearing, not tidiness:
 * a bare `exec bash` in a tmux pane is INTERACTIVE, so it sources the operator's own `~/.bashrc` —
 * 366 lines here, ble.sh at :307 and the kiro-cli pre/post hooks at :3 and :227 — and ble.sh is a
 * key-REPLAY layer that sits between tmux's keystrokes and the prompt that would run them. That is
 * the one input (a)/(b) had which nothing in the case wanted to measure, and case (f) below holds
 * these flags to their claim in both directions. Case (e) has always started its shell this way.
 */
const HANDOFF_SHELL = "bash --norc --noprofile";
/** (f)'s poll: generous enough that a loaded runner cannot make an absent marker look like a suppressed one. */
const MARKER_MS = 5_000;
/**
 * python3 with the pty module — the REAL pty wrapper (j) and (k) build, as test/foreground.test.js does: `pty.spawn` is a
 * pure proxy between the pane's pty and a nested one, which is what kiro-cli-term, `script` and `expect` are. Resolved
 * to a path so a login shell's own PATH (k plants one) cannot lose it.
 */
const PY = (() => {
  try {
    return String(execFileSync("sh", ["-c", "command -v python3"], { stdio: ["ignore", "pipe", "ignore"] })).trim();
  } catch {
    return "";
  }
})();
const HAVE_PTY = PY !== "" && spawnSync(PY, ["-c", "import pty"], { stdio: "ignore" }).status === 0;
/** A wrapper around the handoff shell, for a pane command or a profile line: python3 proxies the pane's pty to a nested one. */
const WRAPPED_SHELL = `${PY} -c "import pty,sys; sys.exit(pty.spawn(['bash','--norc','--noprofile']))"`;

/**
 * What this process still holds: every server name it has drawn and every throwaway directory it has made,
 * from the draw — before tmux is asked for anything — until cleanup() has VERIFIED the server gone. A case's `finally`
 * is its teardown, and a `finally` never runs in a process killed mid-case; the signal teardown and the after() hook
 * below work from this record instead.
 */
const held = { socks: new Set(), dirs: new Set() };
function socket() {
  const name = `ta-ready-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  held.socks.add(name);
  return name;
}
/** mkdtempSync under os.tmpdir(), remembered in `held` so that a process killed mid-case still removes it. */
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  held.dirs.add(dir);
  return dir;
}
function run(cmd, args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const cli = (args, env, timeout) => run(process.execPath, [BIN, ...args], env, timeout);
const wait = (sock, sess, bound, env) => run("bash", [WAIT, sock, sess, String(bound)], { CLI_BIN: BIN, ...env });

function tmuxRaw(sock, args) {
  try {
    return { rc: 0, out: String(execFileSync("tmux", ["-L", sock, ...args], { stdio: ["ignore", "pipe", "pipe"] })).trim() };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim() };
  }
}
/** The pane's own process as tmux names it — the reading the depth walk overrules. */
function paneCmd(sock, sess) {
  return tmuxRaw(sock, ["list-panes", "-a", "-F", "#{session_name} #{pane_current_command}"]).out
    .split("\n").filter((l) => l.startsWith(`${sess} `)).map((l) => l.slice(sess.length + 1))[0] ?? "";
}
/** A pane whose own process is `command`, on a socket of our own. Returns the throwaway home. */
function pane(sock, sess, command) {
  const home = tempDir("ta-ready-home-");
  const { rc, out } = tmuxRaw(sock, ["new-session", "-d", "-s", sess, command]);
  assert.equal(rc, 0, `tmux could not create the pane the case needs: ${out}`);
  // Precondition, asserted rather than assumed: tmux must actually hold the session (new-session exits
  // before the server can answer for it — the race spawn() itself polls out).
  let sessions = "";
  for (let i = 0; i < 40; i++) {
    sessions = tmuxRaw(sock, ["list-sessions", "-F", "#S"]).out;
    if (sessions.split("\n").includes(sess)) break;
    execFileSync("sleep", ["0.1"]);
  }
  assert.ok(sessions.split("\n").includes(sess), `the case was not set up: tmux lists "${sessions}", not ${sess}`);
  return home;
}
function cleanup(sock, home) {
  killServerSync(sock); // kill-server, wait until tmux says the server is gone, unlink its socket file
  if (home) rmSync(home, { recursive: true, force: true });
  // CHECKED, not trusted: tmux must refuse the name, no socket file may stand where tmux says the server
  // would listen, and the home must be gone. A teardown that leaves any of the three reds the case that ran it, naming
  // the socket — instead of surfacing in a GA fire's hygiene census, attributed to whatever ran last.
  const left = leftBehind(sock, home);
  assert.equal(left, null, `the teardown of ${sock} left ${left} behind`);
  held.socks.delete(sock);
  if (home) held.dirs.delete(home);
}
/**
 * What `sock` (and `home`) still leave on the host, in tmux's own words — null when nothing: the name is refused, no
 * socket file stands at the path the refusal names, the home is gone. A refusal that names no path is not a verdict.
 */
function leftBehind(sock, home) {
  const r = tmuxRaw(sock, ["list-sessions", "-F", "#S"]);
  if (r.rc === 0) return `a live server (sessions: ${r.out.split("\n").filter(Boolean).join(", ") || "none"})`;
  const m = /(?:no server running on |error connecting to )(\S+)/.exec(r.out);
  if (!m) return `a server whose refusal names no path ("${r.out}")`;
  if (existsSync(m[1])) return `its socket file ${m[1]}`;
  if (home && existsSync(home)) return `its home ${home}`;
  return null;
}
/**
 * Tear down everything `held` still names — each server through killServerSync, each directory that still exists
 * removed — and return what was still there: the names whose socket file the kill removed (a server that outlived its
 * case), the directories, and any teardown that threw. A name already gone costs one refused tmux call.
 */
function teardownHeld() {
  const found = [];
  for (const sock of [...held.socks]) {
    try {
      if (killServerSync(sock).removed) found.push(sock);
    } catch (e) {
      found.push(`${sock} (${e.message})`);
    }
    held.socks.delete(sock);
  }
  for (const dir of [...held.dirs]) {
    if (existsSync(dir)) {
      found.push(dir);
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (e) {
        found.push(`${dir} (${e.message})`);
      }
    }
    held.dirs.delete(dir);
  }
  return found;
}
// Killed mid-case — TaskStop's SIGTERM, a Ctrl-C, a dropped terminal — this process still takes what it holds with it,
// and says what that was; the helper then exits 128 + the signal's number (test/helpers/signal-teardown.js).
onSignalTeardown((signal) => {
  const found = teardownHeld();
  process.stderr.write(`exec-ready-wait: ${signal} mid-case — tore down ${found.length ? found.join(", ") : "nothing (no server was live)"}\n`);
});
// Finished, whatever the verdicts: a case whose teardown never ran or did not verify leaves its name in `held`, and the
// file reds naming it — after taking it away, so the host is clean even when the file is not green.
after(() => {
  const found = teardownHeld();
  assert.deepEqual(found, [], `a case's teardown left these behind (torn down by the file's after() hook): ${found.join(", ")}`);
});
/** The pane processes tmux holds on `sock` — read BEFORE kill-server, after which tmux no longer knows them. */
function panePids(sock) {
  return tmuxRaw(sock, ["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").filter((l) => /^\d+$/.test(l)).map(Number);
}
/**
 * The subset of `pids` still alive after waiting up to `ms` for all of them to be gone (empty = all gone).
 * `kill-server` returns once the server has been told; each pane's shell then exits on its OWN clock — an
 * interactive bash writing `$HOME/.bash_history` first — so a HOME removed in the next statement is a race
 * (TMUX-116/129, and (f)'s own ENOTEMPTY on CI run 35829350278). Bounded, so a wedged shell cannot hang the suite.
 */
async function untilGone(pids, ms = 5_000) {
  const alive = () => pids.filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } });
  const t0 = Date.now();
  let left = alive();
  while (left.length > 0 && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 50));
    left = alive();
  }
  return left;
}
/**
 * Every process under `root` (root first) in tree order from ONE ps pass — the case's OWN reading of the tree, so the
 * helper under test never vouches for itself: {pid, ppid, tty, comm}, comm the basename without a login dash.
 */
function treeUnder(root) {
  const rows = new Map();
  for (const line of execFileSync("ps", ["-eo", "pid=,ppid=,tty=,comm="], { encoding: "utf8" }).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (m) rows.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), tty: m[3], comm: (m[4].split("/").pop() ?? "").replace(/^-/, "") });
  }
  const out = [];
  const walk = (pid, depth) => {
    const r = rows.get(pid);
    if (!r || depth > 50) return;
    out.push(r);
    for (const k of rows.values()) if (k.ppid === pid) walk(k.pid, depth + 1);
  };
  walk(root, 0);
  return out;
}
const showTree = (tree) => tree.map((r) => `${r.comm}(${r.pid}, ${r.tty})`).join(" > ");
/** The pane process's own command line as ps prints it. */
function paneArgs(pid) {
  return String(execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" })).trim();
}

test("(a) a pane held by a non-shell is refused BY NAME — the control the wait rests on", async () => {
  const sock = socket();
  const sess = "ready-refused";
  let home;
  try {
    home = pane(sock, sess, `sleep ${WINDOW_S}; exec ${HANDOFF_SHELL}`);
    const r = await cli(["--socket", sock, "exec", sess, "echo marker-42"], { TMUX_AGENT_HOME: home });
    assert.notEqual(r.code, 0, `exec was allowed into a pane a non-shell holds (stdout: ${r.stdout.trim()})`);
    assert.match(
      r.stderr,
      /foreground process is "[^"]+", not a shell/,
      `the refusal does not name the program holding the pane (stderr: ${r.stderr.trim()})`,
    );
    assert.ok(!/marker-42/.test(r.stdout), `the injected command ran anyway: ${r.stdout.trim()}`);
    if (process.platform === "linux") {
      // The name is the DEPTH walk's answer, not tmux's: tmux reports the pane's own process (a shell
      // running our compound command) while the keystrokes would reach its `sleep` child. Asserted on
      // linux only — macOS's `ps` comm is a full path and its pane_current_command reads differently.
      assert.match(r.stderr, /foreground process is "sleep"/, `stderr: ${r.stderr.trim()}`);
      assert.match(paneCmd(sock, sess), /^(-?bash|-?sh|-?zsh|-?dash)$/, "tmux should be naming the pane's own shell here");
    }
  } finally {
    cleanup(sock, home);
  }
});

test("(b) the wait clears the window, and the exec that follows lands", async () => {
  const sock = socket();
  const sess = "ready-waits";
  let home;
  try {
    home = pane(sock, sess, `sleep ${WINDOW_S}; exec ${HANDOFF_SHELL}`);
    const w = await wait(sock, sess, 30, { TMUX_AGENT_HOME: home });
    assert.equal(w.code, 0, `the wait gave up on a pane that does present a shell (stderr: ${w.stderr.trim()})`);
    assert.match(w.stdout.trim(), /^ready after \d+ attempt\(s\)$/, `the wait says nothing usable: "${w.stdout.trim()}"`);
    const r = await cli(["--socket", sock, "exec", sess, "echo marker-$((6*7))"], { TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `exec failed after the wait said the pane was ready (stderr: ${r.stderr.trim()})`);
    assert.match(r.stdout, /marker-42/, `exec returned no output after the wait (stdout: ${r.stdout.trim()})`);
  } finally {
    cleanup(sock, home);
  }
});

test("(c) a pane that never presents a shell fails LOUD, naming what holds it", async () => {
  const sock = socket();
  const sess = "ready-pager";
  let home;
  try {
    // /etc/passwd, not /etc/hostname: the latter does not exist on macOS, where less then exited at once
    // and left step 12 demanding a refusal from a plain shell (smoke.sh step 12's own history).
    home = pane(sock, sess, "less /etc/passwd");
    let cmd = "";
    for (let i = 0; i < 50; i++) {
      cmd = paneCmd(sock, sess);
      if (/less$/.test(cmd)) break;
      execFileSync("sleep", ["0.1"]);
    }
    assert.match(cmd, /less$/, `the case was not set up: the pager never took the pane (pane_current_command: "${cmd}")`);
    const w = await wait(sock, sess, 2, { TMUX_AGENT_HOME: home });
    assert.notEqual(w.code, 0, `the wait passed a pane a pager holds — it would silently skip what it guards (stdout: ${w.stdout.trim()})`);
    assert.match(w.stderr, /never presented a shell to exec's guard within 2s/, `stderr: ${w.stderr.trim()}`);
    assert.match(w.stderr, /less/, `the failure does not name what holds the pane (stderr: ${w.stderr.trim()})`);
    // The pager refuses every attempt, so this pane is the all-REFUSALS end of the count.
    // A bound spent refusing and a bound spent on a wedged pane used to read identically; here the
    // line must say zero were cut, and must quote the refusal rather than merely mention the program.
    assert.match(
      w.stderr,
      /\(\d+ attempts, 0 cut, \d+ refused\)/,
      `the give-up does not count refusals apart from cuts (stderr: ${w.stderr.trim()})`,
    );
    assert.match(
      w.stderr,
      /last refusal: [^\n]*foreground process is "[^"]*less[^"]*", not a shell/,
      `the give-up does not quote the refusal the guard actually printed (stderr: ${w.stderr.trim()})`,
    );
    // TMUX-161: what held the pane is read after a CUT, and this bound was spent refusing — a cut clause
    // here would be invented. The other end of the count carries the fields; see (e).
    assert.doesNotMatch(
      w.stderr,
      /the guard saw|the pane ran|its last line read/,
      `an all-refusals give-up carries a cut clause it did not earn (stderr: ${w.stderr.trim()})`,
    );
  } finally {
    cleanup(sock, home);
  }
});

test("(d) the wait stays inside macOS CI's bash 3.2 grammar", () => {
  const src = readFileSync(WAIT, "utf8");
  const body = src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  // Each of these has cost this repo a red macOS CI leg before: `bc` is not installed there, BSD `date`
  // has no %N, and bash 3.2 has no associative arrays (test/smoke.sh carries the same rule).
  assert.ok(!/\bbc\b/.test(body), "wait-shell.sh calls bc — not installed on macOS CI runners");
  assert.ok(!/%N/.test(body), "wait-shell.sh uses date +%N — BSD date has no nanoseconds");
  assert.ok(!/declare\s+-A|mapfile|readarray/.test(body), "wait-shell.sh uses bash 4 grammar — macOS CI runs bash 3.2");
});

test("(e) the wait's bound is a bound: an attempt that cannot complete is cut, and the give-up names it", async () => {
  const sock = socket();
  const sess = "ready-no-sh";
  let home;
  try {
    // A pane that IS at a shell — so exec's guard allows the injection — and yet can never RUN the
    // script execSync generates: `sh` is not on its PATH, so the rc file exec proves completion with
    // never appears and exec waits out its own 120 s default. Deterministic, unlike the ~0.7 s handoff
    // window (a)/(b) create, which is why the bound is measured here and not there.
    home = pane(sock, sess, "env PATH=/nonexistent /bin/bash --norc --noprofile");
    // CONTROL, asserted before the gap: exec is ALLOWED into this pane and BLOCKS. If the guard
    // refused it (as it rightly does for the pager in (c)) the wait would exit on a fast refusal and
    // the bound below would be green without ever having been tested.
    const blocked = await cli(["--socket", sock, "exec", sess, "true"], { TMUX_AGENT_HOME: home }, CONTROL_MS);
    assert.ok(
      !/not a shell/.test(blocked.stderr),
      `the guard refused this pane, so the case cannot say anything about the bound (stderr: ${blocked.stderr.trim()})`,
    );
    assert.equal(
      blocked.code,
      `killed after ${CONTROL_MS} ms`,
      `exec did not block on a pane that cannot run the script — the case's premise is gone (stdout: ${blocked.stdout.trim()}, stderr: ${blocked.stderr.trim()})`,
    );

    const started = Date.now();
    const w = await wait(sock, sess, BOUND_S, { TMUX_AGENT_HOME: home });
    const elapsed = Date.now() - started;
    assert.notEqual(w.code, 0, `the wait passed a pane that can never run the injected line (stdout: ${w.stdout.trim()})`);
    // The reason this case exists: until TMUX-124 one attempt outlived the whole bound, and the CALLER's
    // timeout killed the wait — which is why the red that filed this card carried no diagnostic at all.
    // The harness bound here (BOUND_MS) is far above the ceiling so a red is the wait's doing, not ours.
    assert.ok(
      elapsed <= CEILING_MS,
      `the wait ran ${(elapsed / 1000).toFixed(1)}s on a ${BOUND_S}s bound — one attempt outlived the bound (rc ${w.code}, stderr: ${w.stderr.trim()})`,
    );
    assert.match(w.stderr, new RegExp(`never presented a shell to exec's guard within ${BOUND_S}s`), `stderr: ${w.stderr.trim()}`);
    assert.match(w.stderr, /attempt \d+ cut at \d+s still inside exec/, `the give-up does not say an attempt was cut (stderr: ${w.stderr.trim()})`);
    // The other end of the count: this pane takes every line and completes none, so EVERY
    // attempt is cut. The backreference is the assertion — cuts must equal the attempt total, which
    // is what distinguishes a wedged pane from one that refused some of the time.
    assert.match(
      w.stderr,
      /\((\d+) attempts, \1 cut, 0 refused\)/,
      `the give-up does not say every attempt was cut on a pane that completes nothing (stderr: ${w.stderr.trim()})`,
    );
    assert.match(
      w.stderr,
      /no attempt was refused/,
      `the give-up leaves the refusal clause ambiguous where there were none (stderr: ${w.stderr.trim()})`,
    );
    // TMUX-161: a cut now says what HELD the pane, read the instant after the kill — the guard's own
    // reading (a shell here, which is why the line was injected at all), the processes under the pane
    // (this pane is a bare bash: no wrapper, no nested shell) and its last drawn line, quoted. Three
    // coverage reads of six on the clean 62d7536 tree lost positional-count's case to
    // "(4 attempts, 4 cut, 0 refused)" and the line could name no cause; this is the line that now can.
    assert.match(
      w.stderr,
      /nothing completed it; the guard saw a shell;/,
      `the give-up does not say what the guard saw at the cut (stderr: ${w.stderr.trim()})`,
    );
    assert.match(
      w.stderr,
      /the pane ran [^;]*bash/,
      `the give-up does not list the processes under the pane (stderr: ${w.stderr.trim()})`,
    );
    assert.match(
      w.stderr,
      /its last line read "[^"]*"/,
      `the give-up does not quote the pane's last line (stderr: ${w.stderr.trim()})`,
    );
  } finally {
    cleanup(sock, home);
  }
});

test("(i) the pane's last line reaches the give-up through the shipped redaction — a planted key shape is not quoted", async () => {
  const sock = socket();
  const sess = "ready-secret";
  let home;
  // AKIA + 16 uppercase alphanumerics: the first built-in rule in src/core/redact.ts. Assembled here so this
  // file never holds the shape whole — a scanner reading the suite must not find a key-looking token in it.
  const planted = `${"AKIA"}${"ABCDEFGH"}${"IJKLMNOP"}`;
  try {
    // The same no-`sh` pane as (e), with the key shape as its PROMPT: after the failed injection bash
    // redraws that prompt, so it is the pane's last non-empty line at the cut and the die must quote it —
    // redacted. Put it anywhere else and it is not the last line; drop the redaction and the key is.
    home = pane(sock, sess, `env PATH=/nonexistent PS1='${planted}$ ' /bin/bash --norc --noprofile`);
    const w = await wait(sock, sess, BOUND_S, { TMUX_AGENT_HOME: home });
    assert.notEqual(w.code, 0, `the wait passed a pane that can never run the injected line (stdout: ${w.stdout.trim()})`);
    assert.match(w.stderr, /its last line read "[^"]*\[REDACTED_AWS_KEY\]/, `the die does not quote the redacted prompt (stderr: ${w.stderr.trim()})`);
    assert.ok(!w.stderr.includes(planted), `the planted key shape reached the die unredacted (stderr: ${w.stderr.trim()})`);
  } finally {
    cleanup(sock, home);
  }
});

test("(f) the shell (a) and (b) hand off to loads NO init — the operator's own rc is out of the measurement", async () => {
  const sock = socket();
  let home;
  const rcs = {};
  let lateShells = [];
  try {
    // One planted rc per pane, each writing its own marker, so neither pane can answer for the other.
    // The rc is a THROWAWAY home: the operator's ~/.bashrc is read by nothing here and written by
    // nothing ever. What is measured is whether the handoff shell reads the rc of the HOME it is given.
    // The rc's second line holds the shell that sources it 300 ms on exit, so the teardown's wait below is
    // exercised on every run (see the header's teardown paragraph); the quiet pane never sources it.
    for (const key of ["quiet", "control"]) {
      rcs[key] = tempDir(`ta-ready-rc-${key}-`);
      execFileSync("bash", ["-c", `printf ': > %s/sourced\\ntrap '"'"'sleep 0.3'"'"' EXIT\\n' "$1" > "$1/.bashrc"`, "_", rcs[key]]);
    }
    home = pane(sock, "ready-noinit", `exec env HOME=${rcs.quiet} ${HANDOFF_SHELL}`);
    tmuxRaw(sock, ["new-session", "-d", "-s", "ready-init", `exec env HOME=${rcs.control} bash -i`]);

    // The CONTROL comes first: an interactive shell — the same recipe minus the two flags — DOES source
    // the plant. Without this the absence below would be evidence about the plant, not about the flags.
    let sourced = false;
    for (let i = 0; i < MARKER_MS / 100; i++) {
      sourced = existsSync(join(rcs.control, "sourced"));
      if (sourced) break;
      execFileSync("sleep", ["0.1"]);
    }
    assert.ok(sourced, "the plant never fired for a plain `bash -i`, so this case can say nothing about the flags");
    assert.ok(
      !existsSync(join(rcs.quiet, "sourced")),
      `the handoff shell sourced the rc of its home — "${HANDOFF_SHELL}" is not keeping the host's init out of (a)/(b)`,
    );

    // And the quiet shell is a LIVE one, not a pane that failed to start: exec must reach it. An
    // absent marker under a dead shell would be the same file-system observation and no evidence.
    const w = await wait(sock, "ready-noinit", 15, { TMUX_AGENT_HOME: home });
    assert.equal(w.code, 0, `the init-free pane never became ready (stderr: ${w.stderr.trim()})`);
    const r = await cli(["--socket", sock, "exec", "ready-noinit", "echo marker-$((6*7))"], { TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `exec failed on the init-free pane (stderr: ${r.stderr.trim()})`);
    assert.match(r.stdout, /marker-42/, `exec returned no output from the init-free pane (stdout: ${r.stdout.trim()})`);
  } finally {
    // The rc dirs are the shells' HOME and bash writes `.bash_history` there on its way out of kill-server's
    // SIGHUP (the header's teardown paragraph): read the pane pids while tmux still knows them, kill, WAIT for
    // the shells to be gone, and only then remove — with maxRetries as the second line of defence 1b862bf
    // also kept. The verdict is asserted AFTER this block so a red case keeps its own reason.
    const pids = panePids(sock);
    cleanup(sock, home);
    lateShells = await untilGone(pids);
    for (const dir of Object.values(rcs)) rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  assert.deepEqual(
    lateShells,
    [],
    `pane shell(s) ${lateShells.join(", ")} still alive 5 s after kill-server — the rc dirs were removed under a live shell`,
  );
});

test("(g) waitForShell clears a transiently-held pane and THROWS naming a permanently-held one", async () => {
  // The JS wrapper the CLI-driven unit files now wait through. Imported HERE, inside the case, so that on
  // a parent tree without test/helpers/wait-shell.js the window control below still runs and reds for its
  // own reason before the missing module does — a top-level import would be a whole-file load error that
  // masks (a)'s control.
  const { waitForShell } = await import("./helpers/wait-shell.js");

  // Positive: a pane that is a non-shell for WINDOW_S then execs a shell into the SAME pid. An exec fired
  // immediately is refused (the control the wait rests on); waitForShell then resolves once the shell is
  // up, returning the helper's own ready line; and the exec that follows returns its marker.
  const sockA = socket();
  let homeA;
  try {
    homeA = pane(sockA, "ready-js", `sleep ${WINDOW_S}; exec ${HANDOFF_SHELL}`);
    const refused = await cli(["--socket", sockA, "exec", "ready-js", "echo marker-42"], { TMUX_AGENT_HOME: homeA });
    assert.notEqual(refused.code, 0, `exec was allowed into a pane the sleep still holds (stdout: ${refused.stdout.trim()})`);
    assert.match(
      refused.stderr,
      /foreground process is "[^"]+", not a shell/,
      `the pre-wait exec did not refuse by name (stderr: ${refused.stderr.trim()})`,
    );

    const line = await waitForShell(sockA, "ready-js", { home: homeA, bound: 15 });
    assert.match(line, /ready after \d+ attempt/, `waitForShell resolved without the helper's own ready line (got: "${line}")`);

    const r = await cli(["--socket", sockA, "exec", "ready-js", "echo marker-$((6*7))"], { TMUX_AGENT_HOME: homeA });
    assert.equal(r.code, 0, `exec failed after waitForShell said ready (stderr: ${r.stderr.trim()})`);
    assert.match(r.stdout, /marker-42/, `the post-wait exec returned no output (stdout: ${r.stdout.trim()})`);
  } finally {
    cleanup(sockA, homeA);
  }

  // Negative: a pane a real pager holds forever never presents a shell, and waitForShell must THROW — an
  // Error carrying the helper's own stderr, which NAMES what holds the pane — so a caller can neither type
  // into it nor mistake a held pane for a ready one. (c) proves the shell script does this; this proves the
  // JS wrapper surfaces it as a rejection rather than swallowing the non-zero exit.
  const sockB = socket();
  let homeB;
  try {
    homeB = pane(sockB, "held-js", "less /etc/passwd");
    let cmd = "";
    for (let i = 0; i < 50; i++) {
      cmd = paneCmd(sockB, "held-js");
      if (/less$/.test(cmd)) break;
      execFileSync("sleep", ["0.1"]);
    }
    assert.match(cmd, /less$/, `the case was not set up: the pager never took the pane (pane_current_command: "${cmd}")`);
    await assert.rejects(
      () => waitForShell(sockB, "held-js", { home: homeB, bound: BOUND_S }),
      (e) => {
        assert.match(e.message, /never presented a shell to exec's guard/, `the throw did not carry the helper's verdict (message: ${e.message})`);
        assert.match(e.message, /less/, `the throw did not name what holds the pane (message: ${e.message})`);
        return true;
      },
      "waitForShell resolved for a pane a pager holds forever — a caller would type into it",
    );
  } finally {
    cleanup(sockB, homeB);
  }
});

test("(h) the five files that type into a fresh pane reach exec's guard before the first keystroke (TMUX-158 drift guard)", () => {
  // If any of these reverts to typing on the watch --idle-secs exit or a quiet-capture loop ALONE, the
  // 5f1de3e-class red returns under host load (489/495); watch's BLOCKED case typed at spawn's return (has-session,
  // not a shell) and on 2026-10-13 read the echo of its own swallowed line as the painted menu. Each must
  // reach exec's OWN guard first: the four CLI-driven files through waitForShell (this file's wrapper), exec-timeout through its in-process
  // waitForPrompt (foregroundProgram === null, twice) — an `exec … true` there would add the exec.done row
  // its (113)/(115) cases count. This case reds on the parent, whose files carry none of these needles.
  const guards = [
    ["positional-count.test.js", 'waitForShell(S, "pc-idle"'],
    ["unknown-flags.test.js", 'waitForShell(S, "uf-idle"'],
    ["versioning-contract.test.js", "waitForShell(sock, name"],
    ["watch.test.js", 'waitForShell(S, "w-blk"'],
    ["exec-timeout.test.js", "waitForPrompt(20_000"],
  ];
  for (const [file, needle] of guards) {
    const src = readFileSync(join(ROOT, "test", file), "utf8");
    assert.ok(src.includes(needle), `${file} no longer waits for exec's guard before typing — expected \`${needle}\``);
  }
});

test(
  "(j) a cut on a SLEEPING wrapper and shell is attributed by the pty that holds the unread line — wrapper vs nested shell",
  { skip: !HAVE_PTY && "needs python3 with the pty module" },
  async () => {
    const sock = socket();
    const sess = "ready-wedge";
    let home;
    let wrapper = 0;
    let shell = 0;
    let pids = [];
    try {
      // The recipe: tmux → its `bash -c` → python3 (a REAL pty proxy) → `bash --norc --noprofile` on a NESTED pty. The
      // `; exit` keeps the pane's own shell from exec-ing python3 into its place: the wrapper must be a GRANDCHILD of
      // tmux, because tmux SIGCONTs a stopped direct pane child within a tick (TMUX-167's f6b4a26, red on six CI cells).
      home = pane(sock, sess, `${WRAPPED_SHELL}; exit`);
      const root = panePids(sock)[0];
      // The wrapper and its shell are found by pty TOPOLOGY, never by name: the wrapper is the process whose child
      // sits on a DIFFERENT tty, the shell is that child. macOS's python3 reports its comm as `Python` (CI run
      // 36365192969, red on all three macOS cells for a name match), and kiro-cli-term calls itself `bash`.
      let tree = [];
      let py;
      let sh;
      for (let i = 0; i < 100; i++) {
        tree = treeUnder(root);
        sh = tree.find((r) => r.comm === "bash" && tree.some((q) => q.pid === r.ppid && q.tty !== r.tty));
        py = sh && tree.find((q) => q.pid === sh.ppid);
        if (sh) break;
        execFileSync("sleep", ["0.1"]);
      }
      assert.ok(py && sh, `the case was not set up: no wrapper > nested shell under the pane (tree: ${showTree(tree)})`);
      assert.notEqual(py.pid, root, `the wrapper is the pane's own process — tmux would SIGCONT it (tree: ${showTree(tree)})`);
      wrapper = py.pid;
      shell = sh.pid;
      pids = [root, wrapper, shell];

      // CONTROL, stopping neither: the wait finds the nested shell and says so — there is no give-up, so no clause.
      const ok = await wait(sock, sess, 15, { TMUX_AGENT_HOME: home });
      assert.equal(ok.code, 0, `the unstopped wrapper pane never presented a shell (stderr: ${ok.stderr.trim()})`);
      assert.doesNotMatch(`${ok.stdout}\n${ok.stderr}`, /attributed to/, `the control carries an attribution it did not earn: ${ok.stdout.trim()} ${ok.stderr.trim()}`);

      // The WRAPPER stopped: the guard still sees the nested shell at its prompt (it is the deepest foreground process,
      // stopped or not), so every attempt is allowed and CUT — the 22:23Z shape — and the line tmux wrote sits on the
      // pane's own pty, where only the wrapper reads. That, not the STAT letter, is what names it.
      process.kill(wrapper, "SIGSTOP");
      const w1 = await wait(sock, sess, BOUND_S, { TMUX_AGENT_HOME: home });
      assert.notEqual(w1.code, 0, `the wait passed a pane whose wrapper is stopped (stdout: ${w1.stdout.trim()})`);
      assert.match(w1.stderr, /\((\d+) attempts, \1 cut, 0 refused\)/, `a stopped wrapper should cut every attempt (stderr: ${w1.stderr.trim()})`);
      assert.match(
        w1.stderr,
        new RegExp(`attributed to the WRAPPER \\S+\\(pid ${wrapper}\\): [1-9]\\d* B unread on the pane's pty /dev/`),
        `the give-up does not attribute the cut to the stopped wrapper by the pane's pty (stderr: ${w1.stderr.trim()})`,
      );
      assert.doesNotMatch(w1.stderr, /attributed to the nested SHELL/, `the give-up blames the shell for the wrapper's stop (stderr: ${w1.stderr.trim()})`);
      assert.match(w1.stderr, new RegExp(`wchan [^;]*\\S+\\(${wrapper}\\)=\\S+`), `the give-up carries no wait channel for the wrapper (stderr: ${w1.stderr.trim()})`);
      assert.match(w1.stderr, /the pane's last three lines read "/, `the give-up does not quote the pane's last three lines (stderr: ${w1.stderr.trim()})`);
      process.kill(wrapper, "SIGCONT");
      // Continued, the wrapper drains what tmux wrote into the shell and the pane is ready again: the stop was all
      // that was wrong with it, which is what makes the attribution above a cause and not a coincidence.
      const again = await wait(sock, sess, 15, { TMUX_AGENT_HOME: home });
      assert.equal(again.code, 0, `the pane did not recover once its wrapper was continued (stderr: ${again.stderr.trim()})`);

      // The SHELL stopped: the wrapper forwards the line onto the nested pty, where nothing reads it.
      process.kill(shell, "SIGSTOP");
      const w2 = await wait(sock, sess, BOUND_S, { TMUX_AGENT_HOME: home });
      assert.notEqual(w2.code, 0, `the wait passed a pane whose shell is stopped (stdout: ${w2.stdout.trim()})`);
      assert.match(
        w2.stderr,
        new RegExp(`attributed to the nested SHELL \\S+\\(pid ${shell}\\): [1-9]\\d* B unread on the nested pty /dev/`),
        `the give-up does not attribute the cut to the stopped shell by its nested pty (stderr: ${w2.stderr.trim()})`,
      );
      assert.doesNotMatch(w2.stderr, /attributed to the WRAPPER/, `the give-up blames the wrapper for the shell's stop (stderr: ${w2.stderr.trim()})`);
      process.kill(shell, "SIGCONT");
    } finally {
      // A stopped process takes kill-server's SIGHUP only once continued: continue both, kill, wait, then SIGKILL stragglers.
      for (const p of [wrapper, shell]) {
        if (p) try { process.kill(p, "SIGCONT"); } catch { /* already gone */ }
      }
      cleanup(sock, home);
      for (const p of await untilGone(pids)) {
        try { process.kill(p, "SIGKILL"); } catch { /* already gone */ }
      }
    }
  },
);

test(
  "(k) the CLI's spawn lands on a BARE shell when its server is quiet — under a login profile that installs a pty wrapper",
  { skip: !HAVE_PTY && "needs python3 with the pty module" },
  async () => {
    // Imported INSIDE the case: on the parent tree the module is absent, the quiet socket then behaves exactly like the
    // control, and the case reds for the reason the card names — a wrapped pane — rather than for a missing file.
    let quietServer = () => {};
    try {
      ({ quietServer } = await import("./helpers/quiet-server.js"));
    } catch {
      /* parent tree */
    }
    const socks = { control: socket(), quiet: socket() };
    const homes = [];
    const seen = {};
    try {
      for (const [key, sock] of Object.entries(socks)) {
        // The plant: a login profile that execs a REAL pty wrapper around the handoff shell — what the release host's
        // profile does with kiro-cli-term, reproduced on any host. The server is started here with bash as its login
        // shell and that profile as the panes' HOME (tmux gives new panes its global environment), exactly as the CLI
        // would then find it; the quiet server gets quietServer() on top, the control does not.
        const profile = tempDir(`ta-ready-profile-${key}-`);
        homes.push(profile);
        writeFileSync(join(profile, ".bash_profile"), `exec ${WRAPPED_SHELL}\n`);
        const prep = tmuxRaw(sock, ["start-server", ";", "set-option", "-s", "exit-empty", "off", ";", "set-option", "-g", "default-shell", "/bin/bash", ";", "set-environment", "-g", "HOME", profile]);
        assert.equal(prep.rc, 0, `the ${key} server could not be prepared: ${prep.out}`);
        if (key === "quiet") quietServer(sock);
        const home = tempDir("ta-ready-home-");
        homes.push(home);
        const sp = await cli(["--socket", sock, "spawn", `ready-${key}`, "--cwd", ROOT, "--parent", "exec-ready-wait", "--task", "k"], { TMUX_AGENT_HOME: home }, 30_000);
        assert.equal(sp.code, 0, `spawn on the ${key} server failed: ${sp.stderr.trim()}`);
        const w = await wait(sock, `ready-${key}`, 20, { TMUX_AGENT_HOME: home });
        assert.equal(w.code, 0, `the ${key} pane never presented a shell (stderr: ${w.stderr.trim()})`);
        const root = panePids(sock)[0];
        const tree = treeUnder(root);
        seen[key] = { tree: showTree(tree), args: paneArgs(root), ttys: new Set(tree.map((r) => r.tty)).size };
      }
      // CONTROL first: the plant really installs a wrapper — a SECOND pty under the pane is a pty proxy's signature,
      // whatever the proxy calls itself (`Python` on macOS, `python3` on Linux, `bash` for kiro-cli-term) — or the
      // bare pane below would be evidence about the plant, not about the server.
      assert.ok(
        seen.control.ttys >= 2,
        `the planted profile installed no pty wrapper on the control server (tree: ${seen.control.tree}) — the case can say nothing about the quiet one`,
      );
      // The quiet server: the handoff shell itself is the pane's own process, alone, on the pane's own pty. No login
      // shell ran, so the profile that would have installed the wrapper was never read.
      assert.match(
        seen.quiet.args,
        /bash --norc --noprofile$/,
        `the CLI-spawned pane on the quiet server is not the bare handoff shell — its own process is "${seen.quiet.args}" (tree: ${seen.quiet.tree})`,
      );
      assert.ok(
        seen.quiet.ttys === 1,
        `the CLI-spawned pane on the quiet server still runs under a wrapper (a second pty under the pane): ${seen.quiet.tree}`,
      );
    } finally {
      const pids = Object.values(socks).flatMap((s) => panePids(s));
      for (const s of Object.values(socks)) cleanup(s, undefined);
      await untilGone(pids);
      for (const h of homes) rmSync(h, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  },
);

test("(l) the three CLI-driven files quiet their server BEFORE they spawn (TMUX-170 drift guard)", () => {
  // Revert any of these to spawning on a server the CLI starts itself and the pane is the host's login shell again —
  // wrapper, line editor and all — and the 4-of-12 wedge of 2026-09-28 is back on the release host, invisible to CI.
  const sites = [
    ["positional-count.test.js", "quietServer(S);", '"spawn", "pc-idle"'],
    ["unknown-flags.test.js", "quietServer(S);", '"spawn", "uf-idle"'],
    ["versioning-contract.test.js", "quietServer(sock);", '"spawn", name'],
  ];
  for (const [file, needle, spawnSite] of sites) {
    const src = readFileSync(join(ROOT, "test", file), "utf8");
    const at = src.indexOf(needle);
    const sp = src.indexOf(spawnSite);
    assert.ok(sp >= 0, `${file}: its CLI spawn site moved — expected \`${spawnSite}\``);
    assert.ok(at >= 0, `${file} no longer starts its server quiet — expected \`${needle}\` before \`${spawnSite}\``);
    assert.ok(at < sp, `${file} quiets its server AFTER the CLI spawn — the pane has already run the login shell`);
  }
});

test("(m) both smoke scripts wait for the pane to present a shell BEFORE their first keystroke into it — exec or send — and the wait is fatal (TMUX-195/196/231 drift guard)", () => {
  // test/smoke.sh has waited at step 3 and at step 12's recovery exec since TMUX-121; test/smoke-web.sh step 3 did not, and
  // lost the 2026-10-02 14:24Z run to `refusing exec in web-child: foreground process is "kiro-cli-term"` — once in 484 fire
  // runs, invisible to CI (its shells load no wrapper). Each site must wait on the SAME session its exec types into, the wait
  // must come BEFORE that exec (a wait placed after it waits for nothing), and its give-up must be fatal (`|| die`): a wait
  // whose give-up is swallowed would exec into the held pane anyway, and the step would die without naming the cause.
  // Red on the parent 8375fb6, whose smoke-web.sh carries no wait; the two smoke.sh sites are the controls, green since TMUX-121.
  // A `send` is the same keystroke into the same window: the paste is echoed by the pty whether or not a shell
  // will ever run it, so `sent+verified` cannot stand in for the wait — step 23's row is red on the parent aa61454.
  // Step 11's two fresh panes are the sixth site and the only one with two shells to wait for (TMUX-231; its CI misses
  // on tmux 3.2a were a buffer deleted from under a concurrent send, fixed in pasteText — the waits are the rule every
  // send site keeps). The two rows below are red on the parent a2192f0, which waits for neither.
  const sites = [
    ["smoke.sh", 'wait-shell.sh "$SOCKET" smoke-child', "$CLI exec smoke-child"],
    ["smoke.sh", 'wait-shell.sh "$SOCKET" tui-test', '$CLI exec tui-test "echo RECOVERED"'],
    ["smoke.sh", 'wait-shell.sh "$SOCKET" race-a', '$CLI send race-a "echo RACE_AAAA"'],
    ["smoke.sh", 'wait-shell.sh "$SOCKET" race-b', '$CLI send race-b "echo RACE_BBBB"'],
    ["smoke-web.sh", 'wait-shell.sh "$SOCKET" web-child', "$CLI exec web-child"],
    ["smoke-web.sh", 'wait-shell.sh "$SOCKET" mem-probe', "$CLI send mem-probe"],
  ];
  for (const [file, needle, typeSite] of sites) {
    const src = readFileSync(join(ROOT, "test", file), "utf8");
    const at = src.indexOf(needle);
    const ex = src.indexOf(typeSite);
    assert.ok(ex >= 0, `${file}: its exec/send site moved — expected \`${typeSite}\``);
    assert.ok(at >= 0, `${file} no longer waits for the pane to present a shell — expected \`${needle}\` before \`${typeSite}\``);
    assert.ok(at < ex, `${file} waits AFTER its first exec/send into that pane — the keystroke has already raced the guard`);
    assert.match(src.slice(at, ex), /\|\|\s*die /, `${file}: the wait's give-up is not fatal — a held pane would be typed into anyway`);
  }
});

/** (n)'s child is THIS file, run directly with only its hold case selected and TA_READY_HOLD naming the marker it writes. */
const THIS_FILE = join(ROOT, "test", "exec-ready-wait.test.js");
const HOLD = process.env.TA_READY_HOLD;
/** The hold case's own bound — the signal is meant to end it long before; a parent that died must not strand it. */
const HOLD_MS = 60_000;

/** The marker the hold child writes once its pane is held — null if the child ended first or `ms` passed. */
async function heldMarker(marker, child, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child.exitCode !== null || child.signalCode !== null) return null;
    try {
      return JSON.parse(readFileSync(marker, "utf8"));
    } catch {
      /* not written yet, or written in part */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
/** `p`, or `fallback` once `ms` have passed — a child that will not close must not hold the case past its own bound. */
const within = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

test("(n) a process killed mid-case takes its tmux server with it — SIGTERM, SIGINT and SIGHUP each tear down the held pane's server, socket and home", async () => {
  // The 06:55:52Z shape on demand: a child runs THIS file with only its hold case selected, that case holds a pane a pager
  // owns — mid-case, its `finally` not reached — and the child alone receives the signal. One child per signal. What is
  // asserted first is the host, read in tmux's own words; the exit status and the child's own report come after it.
  const dir = tempDir("ta-ready-hold-");
  try {
    for (const signal of TEARDOWN_SIGNALS) {
      const marker = join(dir, `${signal}.json`);
      const env = { ...process.env, TA_READY_HOLD: marker };
      delete env.NODE_TEST_CONTEXT; // inherited, it makes the child skip the file and exit 0 having run nothing
      const child = spawn(process.execPath, ["--test-reporter=tap", "--test-name-pattern=^\\(n-hold\\)", THIS_FILE], {
        cwd: ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { out += d; });
      const closed = new Promise((resolve) => child.on("close", (code, sig) => resolve({ code, sig })));
      let hold = null;
      try {
        hold = await heldMarker(marker, child, 20_000);
        assert.ok(hold, `the hold child never held a pane within 20 s:\n${out}`);
        assert.equal(hold.pid, child.pid, `the hold case ran in pid ${hold.pid}, not in the child ${child.pid} the signal goes to`);
        assert.match(leftBehind(hold.sock, hold.home) ?? "", /^a live server \(sessions: held-n\)$/, `the case was not set up: no live held-n pane on ${hold.sock}`);
        child.kill(signal);
        const { code, sig } = await within(closed, 15_000, { code: "none within 15 s", sig: null });
        const left = leftBehind(hold.sock, hold.home);
        assert.equal(left, null, `${signal} mid-case left ${left} on ${hold.sock} — the server outlived the process that made it`);
        assert.equal(code, 128 + constants.signals[signal], `the child did not exit as killed by ${signal} (code ${code}, signal ${sig}):\n${out}`);
        assert.match(out, new RegExp(`exec-ready-wait: ${signal} mid-case — tore down ${hold.sock}`), `the child did not say what it tore down:\n${out}`);
      } finally {
        // Whatever the verdict, nothing of the child's outlives this case.
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await within(closed, 5_000, null);
        if (hold) {
          killServerSync(hold.sock);
          rmSync(hold.home, { recursive: true, force: true });
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (HOLD) {
  // (n)'s child, registered only there — a normal run's counts are unchanged. Its `finally` is the one a signal skips.
  test("(n-hold) a pane a pager holds mid-case, until this process is signalled — (n)'s child", async () => {
    const sock = socket();
    let home;
    try {
      home = pane(sock, "held-n", "less /etc/passwd");
      writeFileSync(HOLD, JSON.stringify({ pid: process.pid, sock, home }));
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS)); // the signal is meant to end this process first
      assert.fail(`(n-hold) was never signalled within ${HOLD_MS} ms — its parent is gone`);
    } finally {
      cleanup(sock, home);
    }
  });
}
