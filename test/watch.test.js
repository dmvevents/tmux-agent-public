/**
 * `watch` and the notification path — GA card TMUX-9.
 *
 * These had ZERO test references. `watch` is what an operator relies on to learn a session went
 * stuck, and the Slack sink is how that reaches them; shipping the untested version of exactly
 * that path would be the wrong thing to leave unverified.
 *
 * Black-box on purpose: driven through the built CLI and a real HTTP receiver, because the
 * contract that matters is the documented exit codes and an actual POST — not internals. (It
 * also keeps this file off `src/bin/tmux-agent.ts`, which another session is editing.)
 *
 * Every case that starts a tmux server or makes a home tears it down in `finally`: a red
 * here used to leave its `ta-watch-*` server, socket and `/tmp/ta-watch-*` home on the host.
 *
 * Run: node --test test/watch.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { killServerSync } from "./helpers/kill-server.js";
import { quietServer } from "./helpers/quiet-server.js";
import { waitForShell } from "./helpers/wait-shell.js";

// Resolved from this file's own directory, never the cwd: see test/dist-from-file.test.js.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist/bin/tmux-agent.js");

function socket() {
  return `ta-watch-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
function home() {
  return mkdtempSync(join(tmpdir(), "ta-watch-"));
}
function cli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Minimal webhook receiver: proves the sink really POSTs rather than silently no-op'ing. */
function receiver() {
  const hits = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      hits.push({ method: req.method, contentType: req.headers["content-type"], body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}/hook`, hits, close: () => srv.close() }));
  });
}

/**
 * The classifier's view of a pane — monitor.ts snapshot(): the last six non-empty, right-trimmed lines of the
 * capture — so what the BLOCKED setup accepts is the very tail `watch` is about to judge (the lexicon test's tailOf).
 */
const tailOf = (pane) => pane.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6);
/**
 * The PAINTED menu: the line printf drew, anchored. A line that merely CONTAINS "❯ 1." is not it — the echo of the
 * paint command itself does, and on 2026-10-13 12:24Z that echo was all the pane held.
 */
const MENU = /^\s*❯\s*1\. Yes\s+2\. No$/;
const menuPainted = (tail) => tail.some((l) => MENU.test(l));
/** The same flags as Tmux.capturePane (`-p -J`, 40 lines), so the setup's tails compare like-for-like with the snapshot's. */
const capturePane = (S, sess) => execFileSync("tmux", ["-L", S, "capture-pane", "-p", "-J", "-t", `=${sess}:`, "-S", "-40"], { encoding: "utf8" });
/** Two identical non-blank captures 500 ms apart whose tail satisfies `ok` → that pane; null after `tries` captures. */
async function settled(capture, ok, tries) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = capture();
    if (cur.trim() && cur === prev && ok(tailOf(cur))) return cur;
    prev = cur;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test("watch: exits 2 when the session is GONE (documented contract)", async () => {
  const H = home();
  try {
    const r = await cli(["--socket", socket(), "watch", "no-such-session"], { TMUX_AGENT_HOME: H });
    assert.equal(r.code, 2, `GONE must exit 2, got ${r.code}`);
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.equal(out.state, "GONE");
  } finally {
    rmSync(H, { recursive: true, force: true });
  }
});

test("watch: exits 0 on idle and POSTs to the configured webhook", async () => {
  const H = home();
  const S = socket();
  const rec = await receiver();
  try {
    await cli(["--socket", S, "spawn", "w-idle", "--cwd", "/tmp", "--parent", "watchtest"], { TMUX_AGENT_HOME: H });
    // a freshly-spawned shell sits at its prompt: idle almost immediately
    const r = await cli(["--socket", S, "watch", "w-idle", "--idle-secs", "3"], {
      TMUX_AGENT_HOME: H,
      TMUX_AGENT_SLACK_WEBHOOK: rec.url,
    });
    assert.equal(r.code, 0, `idle must exit 0, got ${r.code} (${r.stderr.slice(0, 200)})`);
    assert.equal(rec.hits.length >= 1, true, "the sink must actually POST");
    assert.equal(rec.hits[0].method, "POST");
    assert.match(rec.hits[0].contentType ?? "", /application\/json/);
    const payload = JSON.parse(rec.hits[0].body);
    assert.match(payload.text, /w-idle/, "notification names the session");
    assert.match(payload.text, /idle/i, "notification says why it fired");
  } finally {
    rec.close();
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("watch: a notify.sent event is ledgered so the alert is auditable", async () => {
  const H = home();
  const S = socket();
  const rec = await receiver();
  try {
    await cli(["--socket", S, "spawn", "w-led", "--cwd", "/tmp", "--parent", "watchtest"], { TMUX_AGENT_HOME: H });
    await cli(["--socket", S, "watch", "w-led", "--idle-secs", "3"], { TMUX_AGENT_HOME: H, TMUX_AGENT_SLACK_WEBHOOK: rec.url });
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = join(H, "ledger");
    const lines = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n")).filter(Boolean);
    const notif = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "notify.sent");
    assert.ok(notif.length >= 1, "notify.sent must be recorded");
    assert.equal(notif.at(-1).data.ok, true, "a successful POST records ok:true");
    assert.equal(notif.at(-1).data.sink, "slack");
  } finally {
    rec.close();
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("watch: an unreachable webhook degrades without failing the watch", async () => {
  const H = home();
  const S = socket();
  try {
    await cli(["--socket", S, "spawn", "w-bad", "--cwd", "/tmp", "--parent", "watchtest"], { TMUX_AGENT_HOME: H });
    // port 1 is never listening: the sink must record the failure, not throw into the caller
    const r = await cli(["--socket", S, "watch", "w-bad", "--idle-secs", "3"], {
      TMUX_AGENT_HOME: H,
      TMUX_AGENT_SLACK_WEBHOOK: "http://127.0.0.1:1/nope",
    });
    assert.equal(r.code, 0, "a broken notifier must not change the watch verdict");
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = join(H, "ledger");
    const lines = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n")).filter(Boolean);
    const notif = lines.map((l) => JSON.parse(l)).filter((e) => e.type === "notify.sent");
    assert.ok(notif.length >= 1, "a failed send is still ledgered");
    assert.equal(notif.at(-1).data.ok, false, "failure is recorded as ok:false, not silently dropped");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("watch: with no webhook configured it falls back to the console sink", async () => {
  const H = home();
  const S = socket();
  try {
    await cli(["--socket", S, "spawn", "w-con", "--cwd", "/tmp", "--parent", "watchtest"], { TMUX_AGENT_HOME: H });
    const r = await cli(["--socket", S, "watch", "w-con", "--idle-secs", "3"], {
      TMUX_AGENT_HOME: H,
      TMUX_AGENT_SLACK_WEBHOOK: "",
    });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[notify\]/, "console sink announces on stderr");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

/**
 * BLOCKED → exit 3. The pane is painted with a claude-code-style menu prompt — the built-in profile classifies that as
 * BLOCKED — and `watch` must come back 3 at once rather than sit out its idle window.
 *
 * Three disciplines the setup keeps, each the lesson of a red on a clean tree:
 *   - the pane is a BARE shell on a quiet server (quietServer, TMUX-170) and nothing is typed until it presents a shell
 *     to exec's own guard (waitForShell, TMUX-158). `spawn` returns on has-session alone, and the host's login shell
 *     was still sourcing its rc files when the paint command arrived: TMUX-41 (2026-08-25) watched the rc noise push
 *     the painted menu out of the classifier's six-line tail, TMUX-202 (2026-10-13) watched the line swallowed outright;
 *   - the paint is accepted only when a line that IS the menu — anchored — sits in a tail that has stopped changing
 *     (two identical captures 500 ms apart; the lexicon test's idiom), never a line that merely contains "❯ 1.". On
 *     2026-10-13 12:24Z the typed command was echoed and never ran; `includes("❯ 1.")` read that echo as the menu,
 *     `watch` started, the shell then drew its banner, warnings and prompt, the echo left the tail, and every poll for
 *     30 s read IDLE — exit 0 on the clean 54563c0 tree (scratch/ga-fire-2026-10-13-12Z/leftover-w-blk-pane.txt; the
 *     fixture case below carries that pane);
 *   - the teardown is in `finally`: that red left its server, socket and home behind.
 */
test("watch: reports BLOCKED/ERROR with exit 3 so a supervisor can branch on it", async () => {
  const H = home();
  const S = socket();
  quietServer(S);
  try {
    const sp = await cli(["--socket", S, "spawn", "w-blk", "--cwd", "/tmp", "--parent", "watchtest"], { TMUX_AGENT_HOME: H });
    assert.equal(sp.code, 0, `test setup: spawn exited ${sp.code}: ${sp.stderr.slice(0, 200)}`);
    await waitForShell(S, "w-blk", { home: H });
    const capture = () => capturePane(S, "w-blk");
    // paint onto a cleared pane — a real TUI menu sits at the pane bottom — and accept only a settled tail with the
    // menu on an anchored line; a late line from the shell repaints the pane and the next attempt paints again
    let painted = null;
    for (let i = 0; i < 3 && painted === null; i++) {
      execFileSync("tmux", ["-L", S, "send-keys", "-t", "=w-blk:", "clear; printf '\\n❯ 1. Yes  2. No\\n'", "Enter"], { stdio: "ignore" });
      painted = await settled(capture, menuPainted, 20);
    }
    assert.ok(painted !== null, `test setup: the menu never sat on an anchored line of a settled tail. Pane:\n${capture().slice(-400)}`);
    const r = await cli(["--socket", S, "watch", "w-blk", "--idle-secs", "30"], { TMUX_AGENT_HOME: H, TMUX_AGENT_SLACK_WEBHOOK: "" });
    assert.equal(r.code, 3, `BLOCKED/ERROR must exit 3, got ${r.code}. Pane at the verdict:\n${capture().slice(-400)}`);
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.ok(["BLOCKED", "ERROR"].includes(out.state), `state was ${out.state}`);
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

/**
 * The 2026-10-13 12:24Z pane, verbatim: the paint command echoed on row 1 and never run, the host's kiro-cli
 * banner and ble.sh warnings, then a bare prompt. The setup's old check — `includes("❯ 1.")` over the same six-line
 * tail — read the echo alone as painted; the anchored marker must not, and must still accept the menu printf draws on
 * a cleared pane. The control asserts the fixture really carries the substring the old check accepted, so loosening
 * the marker back to a substring reds this case.
 */
test("watch: the BLOCKED case's paint check refuses the echo of its own paint command — the 2026-10-13 12:24Z pane as the fixture", () => {
  const ECHO = "clear; printf '\\n❯ 1. Yes  2. No\\n'";
  const PANE_12Z = [
    ECHO,
    "",
    "A new version of kiro-cli is available: 2.30.0",
    "Run kiro-cli update to update to the new version",
    "",
    "ble.sh: insane environment: $USER is empty.  Please consider checking the",
    "  terminal's settings or setting export USER=$(id -un) in your .bash_profile.",
    "ble.sh: modified USER=ubuntu",
    "user@build-host:/tmp$ ",
  ].join("\n");
  // the control: the echo alone — the pane as the setup saw it at +1.5 s — carries the substring the old check accepted
  assert.ok(tailOf(`${ECHO}\n`).some((l) => l.includes("❯ 1.")), "control: the echo alone carries the substring the old check accepted");
  assert.equal(menuPainted(tailOf(`${ECHO}\n`)), false, "the echo of the paint command must not read as the painted menu");
  assert.equal(menuPainted(tailOf(`bash-5.2$ ${ECHO}\n`)), false, "the command on the prompt line, typed and not yet run, is not the menu either");
  // the pane `watch` then read for 30 s: seven non-empty lines, the echo seventh-from-last and out of the classifier's six
  assert.equal(tailOf(PANE_12Z).length, 6, "the fixture's tail is the classifier's six lines");
  assert.ok(!tailOf(PANE_12Z).some((l) => l.includes("❯ 1.")), "in the 12:24Z pane the echo is already out of the six-line tail");
  assert.equal(menuPainted(tailOf(PANE_12Z)), false, "the 12:24Z pane must not read as the painted menu");
  // what printf draws on a cleared pane, under the bare shell's prompt and under the host's
  assert.equal(menuPainted(tailOf("\n❯ 1. Yes  2. No\nbash-5.2$ \n")), true, "the painted menu on a cleared bare-shell pane");
  assert.equal(menuPainted(tailOf("\n❯ 1. Yes  2. No\nuser@build-host:/tmp$ \n")), true, "the painted menu under the host's prompt");
});

/**
 * The idle WINDOW, not just the idle EXIT. Every other `watch --idle-secs N` in the suite uses N <= 3 — one
 * poll — so the first poll that found the line unchanged was also the poll that fired, and the contract that `watch`
 * sits out a window before deciding was never driven: a `watch` that fired on the first unchanged poll regardless of
 * N passed every case here. With N = 6 and the verb's 3 s poll, the first unchanged poll falls INSIDE the window
 * (`Date.now() - idleSince > idleSecs * 1000` is false at ~3 s) and the exit comes a poll later, so the lifetime of the
 * process is the window's own length or more; a fire inside the window reads ~3 s and fails the bound below.
 *
 * The pane is a BARE shell (test/helpers/quiet-server.js, TMUX-170): the host's login profile repaints the prompt for
 * seconds after spawn and every repaint restarts the window — what this case measures is the window, not the host's
 * rc files. Measured on 7f8934c (scratch/ga-fire-2026-10-01-14Z/): 6,225 ms to exit 0 with `idle 6s`; a snapshot
 * costs ~0.18 s, so the inside-the-window poll lands at ~3.2 s with 2.8 s to spare.
 *
 * Why it matters to the coverage headline too: V8 reports the `&& s.state === "IDLE"` arm and the idle body as ranges
 * of their own only when their count differs from the else-arm's, and until this case that depended on how many polls a
 * control's pane spent repainting its prompt (two reads of five on 7b92cc9 read dist/bin/tmux-agent.js at 71.00
 * instead of 71.57 for exactly that reason — scratch/ga-fire-2026-10-01-14Z/v8trace-{1,3}.log). Here the else-arm is
 * entered at least twice and the body once, every run.
 */
test("watch: the idle window is honoured — a poll that finds the line unchanged inside --idle-secs does not fire; the exit comes once the window has elapsed", async () => {
  const H = home();
  const S = socket();
  quietServer(S);
  try {
    const sp = await cli(["--socket", S, "spawn", "w-win", "--cwd", "/tmp", "--parent", "watchtest"], { TMUX_AGENT_HOME: H });
    assert.equal(sp.code, 0, `test setup: spawn exited ${sp.code}: ${sp.stderr.slice(0, 200)}`);
    const t0 = Date.now();
    const r = await cli(["--socket", S, "watch", "w-win", "--idle-secs", "6"], { TMUX_AGENT_HOME: H, TMUX_AGENT_SLACK_WEBHOOK: "" });
    const elapsed = Date.now() - t0;
    assert.equal(r.code, 0, `idle must exit 0, got ${r.code} (${r.stderr.slice(0, 200)})`);
    assert.equal(JSON.parse(r.stdout.trim().split("\n").pop()).state, "IDLE", "the snapshot printed is the idle one");
    assert.match(r.stderr, /idle 6s/, "the console sink names the window that fired");
    assert.ok(elapsed >= 6000, `watch exited after ${elapsed} ms with a 6 s window — it fired on a poll inside the window`);
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});
