/**
 * foregroundProgram — the exec TUI guard's eyes, read through a pty wrapper.
 *
 * `execSync` refuses to type into a pane whose foreground is not a shell, because a command
 * line typed into vim/less/a REPL is swallowed as application input and the caller blocks to
 * the full timeout with no diagnostic. The guard used to read ONE process level: tmux's
 * `pane_current_command` plus the pane process's direct children. Behind a pty wrapper —
 * kiro-cli-term on the dev host, `script`, `asciinema rec`, `expect`, a shell-named launcher
 * anywhere — the real shell sits on a nested pty and a resident pager is a GRANDCHILD the
 * guard never saw: measured 2026-09-13 on 0e3c4e0, the guard passed, exec typed its script
 * line into `less` (which opened its search prompt on the `/` in the path) and threw the
 * 10 s timeout at 15.7 s with less still resident; at the default it had not returned in 120 s.
 *
 * TMUX-97's tree walk fixed that — but ran SECOND. Whatever non-shell name tmux reported was
 * returned before the walk, and on Linux that name is argv0 of the process owning the pane's
 * own tty: for a wrapper that does not spoof it (`script`, `expect`, `asciinema rec` → `python3`)
 * the guard named the wrapper while the shell inside sat at its prompt. Measured 2026-09-13 on
 * 8aeae42: `script -q /dev/null` as the pane command → exec refused as "script" in 75 ms, a
 * human's line into the same pane answered; a pager under that shell refused as "script", not
 * "less". Now the walk decides whenever the process table contains the pane pid.
 *
 * These tests build that chain FOR REAL — python3's pty module plays the pty proxy, `sh -i` is
 * the shell on the nested pty, `less` is started from that shell — and resolve from the
 * WRAPPER's pid, which is exactly what tmux's pane_pid is on such a host. The test reads the
 * process tree itself (one `ps` pass) to know when less is there and when it is gone, so the
 * resolver under test never vouches for itself. Watched red on 0e3c4e0 + the export alone:
 * `null !== 'less'`; and on 6c8dc3a with the wrapper's name as tmux would report it:
 * `{ underPager: 'script', atPrompt: 'script' }` where `{ underPager: 'less', atPrompt: null }` was due.
 *
 * Run: node --test test/foreground.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { foregroundProgram, commName } from "../dist/core/orchestrator.js";

const have = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
const HAVE_CHAIN =
  have("python3") && have("less") && spawnSync("python3", ["-c", "import pty"], { stdio: "ignore" }).status === 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await sleep(100);
  }
  return false;
}

// Descendants of `root` whose comm basename is `name`, from one ps pass — the test's OWN
// reading of the tree, independent of the code under test.
function descendantsNamed(root, name) {
  const parent = new Map();
  const comm = new Map();
  for (const line of execFileSync("ps", ["-eo", "pid=,ppid=,comm="], { encoding: "utf8" }).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    parent.set(Number(m[1]), Number(m[2]));
    comm.set(Number(m[1]), m[3].split("/").pop());
  }
  const out = [];
  for (const pid of parent.keys()) {
    let p = pid;
    let hops = 0;
    while (parent.has(p) && p !== root && hops++ < 200) p = parent.get(p);
    if (p === root && pid !== root && comm.get(pid) === name) out.push(pid);
  }
  return out;
}

// Wrapper → program, for real. The wrapper's stdin/stdout are pipes (no tty of its own — like a
// pane whose pty proxy talks to tmux); the program gets a fresh pty from pty.spawn. LESS is
// cleared so no inherited -F/-X quits the pager on a short file; LINES/COLUMNS give the
// nested pty a size (pty.spawn copies none when its stdin is not a tty).
function startPty(argv) {
  const py = spawn("python3", ["-c", `import pty, sys; sys.exit(pty.spawn(${JSON.stringify(argv)}))`], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "xterm", LINES: "24", COLUMNS: "80", LESS: "", LESSOPEN: "", ENV: "", PS1: "$ " },
  });
  py.stdout.on("data", () => {}); // drain — a full pipe would stall the wrapper
  py.stderr.on("data", () => {});
  return py;
}
const startWrappedShell = () => startPty(["sh", "-i"]);

// `bye` is what the program on the pty needs to quit (`exit\n` for a shell, `q` for less).
async function stopPty(py, bye) {
  if (py.exitCode !== null) return;
  try {
    py.stdin.write(bye);
  } catch {
    /* already closed */
  }
  if (!(await until(() => py.exitCode !== null, 3000))) py.kill("SIGKILL");
}

test(
  "foregroundProgram: a pager behind a pty wrapper resolves to the pager, then to null once it exits",
  { skip: !HAVE_CHAIN && "needs python3 (pty module), sh and less" },
  async () => {
    const py = startWrappedShell();
    // What the guard says when tmux names the WRAPPER — `script`, `expect`, `asciinema rec`
    // (`python3`) do not spoof argv0 — read at both moments and judged together below, so one
    // failure shows both readings.
    const named = { underPager: undefined, atPrompt: undefined };
    try {
      py.stdin.write("less /etc/passwd\n");
      assert.ok(
        await until(() => descendantsNamed(py.pid, "less").length > 0, 10_000),
        "less never started under the wrapper — nothing to resolve",
      );
      // tmux names the wrapper's argv0 here (kiro-cli-term calls itself `bash`), so the pane
      // signal says "shell"; only a walk of the whole tree can see the pager two levels down.
      assert.equal(await foregroundProgram("bash", py.pid), "less");
      named.underPager = await foregroundProgram("script", py.pid);

      py.stdin.write("q");
      assert.ok(await until(() => descendantsNamed(py.pid, "less").length === 0, 10_000), "less did not exit on q");
      await sleep(250); // the shell reclaims its tty right after waitpid; give the prompt a beat
      // Wrapper → shell sitting at its prompt is NOT a TUI: refusing here would be the false
      // refusal that makes exec unusable on every wrapped host.
      assert.equal(await foregroundProgram("bash", py.pid), null);
      named.atPrompt = await foregroundProgram("script", py.pid);
      // The walk's answer is the guard's answer whatever tmux reports: the pager is named as
      // itself, not as the wrapper, and the shell at its prompt is not refused. Red on 6c8dc3a:
      // both readings were 'script' — the name tmux gave a `script -q` pane whose exec was
      // refused in 75 ms while a human's line into it was answered.
      assert.deepEqual(named, { underPager: "less", atPrompt: null });
    } finally {
      await stopPty(py, "exit\n");
    }
  },
);

test(
  "foregroundProgram: a pane whose own process is the TUI is refused by name, whatever tmux calls it",
  { skip: !HAVE_CHAIN && "needs python3 (pty module) and less" },
  async () => {
    // `tmux new-session … 'less /etc/hosts'`: no shell anywhere, the pane process itself owns
    // the tty. python's pty plays tmux and less is the pane process, so resolve from LESS's own
    // pid — the root row is its own deepest foreground. Keep-green under TMUX-99: putting the
    // walk first must not turn "the root is a TUI" into null.
    const py = startPty(["less", "/etc/passwd"]);
    try {
      assert.ok(await until(() => descendantsNamed(py.pid, "less").length > 0, 10_000), "less never started");
      const lessPid = descendantsNamed(py.pid, "less")[0];
      assert.equal(await foregroundProgram("less", lessPid), "less"); // Linux tmux names it
      assert.equal(await foregroundProgram("bash", lessPid), "less"); // macOS tmux names the shell; the walk decides
    } finally {
      await stopPty(py, "q");
    }
  },
);

test("commName: a BSD login shell's `-bash` and a full path both read as the bare program name", () => {
  // CI run 34752894063 on 1a3eb90: macOS `ps -o comm=` printed the pane's login shell as `-bash`,
  // the deepest foreground row at a prompt, and every exec was refused ("-bash" is not a shell).
  // Linux ps prints `bash` for the same process, so this is the only place the case is testable here.
  assert.equal(commName("-bash"), "bash");
  assert.equal(commName("-zsh"), "zsh");
  assert.equal(commName("/usr/bin/less"), "less");
  assert.equal(commName("  less \n"), "less");
  assert.equal(commName("tmux: server"), "tmux: server");
  assert.equal(commName(""), "");
});

test("foregroundProgram: tmux's non-shell reading decides only when the process table cannot see the pane", async () => {
  // Pane pid unknown (0) or in no ps row (a pid past any pid_max): there is no tree to walk, so
  // what tmux reports stands — the twin of the no-ps degrade path below. Before TMUX-99 this
  // reading came FIRST, and a pane tmux named `script` was refused with the shell inside it at
  // its prompt.
  assert.equal(await foregroundProgram("less", 0), "less");
  assert.equal(await foregroundProgram("vim", 0x7fffffff), "vim");
  assert.equal(await foregroundProgram("bash", 0x7fffffff), null);
});

test("foregroundProgram: with no ps or pgrep on PATH it degrades to today's answer and never throws", async () => {
  const empty = mkdtempSync(join(tmpdir(), "ta-nopath-"));
  const saved = process.env.PATH;
  process.env.PATH = empty;
  try {
    assert.equal(await foregroundProgram("vim", process.pid), "vim"); // tmux's signal still counts
    assert.equal(await foregroundProgram("bash", process.pid), null); // no tools → no refusal, no throw
  } finally {
    process.env.PATH = saved;
    rmSync(empty, { recursive: true, force: true }); // the empty PATH dir goes with the test
  }
});
