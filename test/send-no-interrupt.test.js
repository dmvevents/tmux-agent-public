/**
 * send never interrupts an active agent — the pre-paste C-c is SHELL-only.
 *
 * pasteText() sent C-c to the pane before EVERY paste: right for a shell (it aborts the stale
 * line-editor state ble.sh leaves as `-- MULTILINE --`, where Enter inserts a newline and every later
 * injection silently never runs — THREAT-MODEL finding 4), and a SIGINT into the running turn of an
 * agent TUI (Claude Code, Codex) that owns the pane. Every send/sendVerified caller — CLI `send`, MCP
 * `send-input`, the dashboard's /api/send, spawn's launch command — inherited it, and the hub driving
 * a supervising campaign (2026-09-27) had to build its own single-paste, no-interrupt helper to direct a
 * fleet safely: the product's core promise failing on its primary use case. The clear now asks exec's
 * own guard, foregroundProgram(): a shell at its prompt is cleared, any other program receives no
 * signal, and `input.sent` records which path was taken as `cleared`.
 *
 * Cases, on a REAL isolated tmux:
 *   (1) a pane whose own process is a fixture TUI (python3: draws a prompt, records every SIGINT to a
 *       file, stays in the foreground) — sendVerified lands the text, the file records ZERO signals,
 *       input.sent says cleared:false;
 *   (2) the control: a raw C-c into that same pane lands ONE recorded signal — the zero in (1) was a
 *       measurement, not a fixture that records nothing;
 *   (3) a spawned SHELL left in a continuation state (an open quote, ble.sh's MULTILINE on this host,
 *       bash's `> ` on CI) — sendVerified still clears it, the command RUNS, input.sent says cleared:true
 *       (the regression the C-c exists for, made executable);
 *   (4) execSync's own verify:false input.sent carries cleared too — one key, every path.
 * FAIL-first on the parent 43f3f11 dist: (1) red with one recorded SIGINT, (3) and (4) red with no
 * `cleared` key; (2) green on both, as a control must be.
 *
 * Run: node --test test/send-no-interrupt.test.js   (needs `npm run build`, a tmux binary and python3)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tmux, paneTarget } from "../dist/core/tmux.js";
import { Ledger } from "../dist/core/ledger.js";
import { Policy } from "../dist/core/policy.js";
import { Orchestrator, foregroundProgram } from "../dist/core/orchestrator.js";
import { killServerSync } from "./helpers/kill-server.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const HAVE_PY = spawnSync("python3", ["-c", "import signal, sys"], { stdio: "ignore" }).status === 0;

const HOME = tempHome("ta-sni-");
process.env.TMUX_AGENT_HOME = HOME;
const SOCKET = `ta-sni-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
const AGENT = "sni-agent"; // the pane whose OWN process is the fixture TUI — no shell anywhere under it
const SHELL = "sni-shell"; // a spawned shell pane, the way every operator session starts
const tmux = new Tmux({ socket: SOCKET });
const ledger = new Ledger(join(HOME, "ledger"));
const orch = new Orchestrator(tmux, ledger, new Policy(), "sni-test");

const FIXTURE = join(HOME, "agent-tui.py");
const SIG = join(HOME, "agent.sigint.log"); // one line per SIGINT the fixture received
const RX = join(HOME, "agent.received.log"); // one line per input line the fixture read

/**
 * The fixture TUI: a prompt, a SIGINT handler that writes a line per signal (PEP 475 restarts the
 * interrupted read, so the program survives to record the next one — like a real agent's turn does not),
 * and an echo of every line it reads. No readline import: the tty stays in cooked mode with echo, so the
 * pasted text is drawn where sendVerified's capture-pane verification looks for it.
 */
const PY = `import signal, sys
sig_path, rx_path = sys.argv[1], sys.argv[2]
def on_int(signum, frame):
    with open(sig_path, "a") as f:
        f.write("SIGINT %d\\n" % signum)
signal.signal(signal.SIGINT, on_int)
sys.stdout.write("agent-tui ready\\n")
sys.stdout.flush()
while True:
    sys.stdout.write("agent> ")
    sys.stdout.flush()
    line = sys.stdin.readline()
    if line == "":
        break
    with open(rx_path, "a") as f:
        f.write(line)
    sys.stdout.write("got: " + line)
    sys.stdout.flush()
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []);
const sentEvents = (session) =>
  readFileSync(ledger.path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "input.sent" && e.session === session);
const lastSent = (session) => {
  const evs = sentEvents(session);
  assert.ok(evs.length > 0, `no input.sent event for ${session} in the ledger`);
  return evs[evs.length - 1];
};

async function until(pred, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await sleep(150);
  }
  assert.fail(`timeout (${ms} ms): ${what}`);
}

/** What exec's guard — and now send's — reads for a pane: null for a shell, else the program's name. */
async function guardReads(name) {
  const info = await tmux.paneInfo(name);
  if (info.dead) return "(dead pane)";
  return foregroundProgram(info.currentCmd, info.pid);
}

/**
 * Hold until the pane is at a shell prompt the way exec's guard reads it, twice in a row (TMUX-158:
 * quiet is not guard-ready — the host's pty wrapper can still be the deepest foreground process).
 */
async function waitForPrompt(name, ms, what) {
  let quiet = 0;
  await until(async () => {
    quiet = (await guardReads(name)) === null ? quiet + 1 : 0;
    return quiet >= 2;
  }, ms, what);
}

/** Two identical non-empty captures 500 ms apart — the settle discipline of test/smoke.sh's wait_quiet(). */
async function waitQuiet(name, ms, what) {
  let prev = "";
  await until(async () => {
    const cur = await tmux.capturePane(name, 40).catch(() => "");
    const settled = cur.trim().length > 0 && cur === prev;
    prev = cur;
    if (!settled) await sleep(350);
    return settled;
  }, ms, what);
}

before(async () => {
  if (HAVE_PY) {
    writeFileSync(FIXTURE, PY, { mode: 0o600 });
    // Multiple trailing words make tmux execvp the program itself — the pane's own process IS the TUI,
    // no shell and no pty wrapper anywhere under it, exactly `tmux new-session … 'less f'`'s shape.
    await tmux.exec(["new-session", "-d", "-s", AGENT, "-x", "120", "-y", "30", "python3", FIXTURE, SIG, RX]);
    await until(async () => /agent> /.test(await tmux.capturePane(AGENT, 10).catch(() => "")), 10_000, "the fixture TUI never drew its prompt");
    // Precondition, read by the same function the product asks: the pane is a PROGRAM, not a shell.
    const fg = await guardReads(AGENT);
    assert.ok(fg !== null && fg !== "(dead pane)", `test setup: the guard reads the fixture pane as ${JSON.stringify(fg)}, not as a program`);
  }
  await orch.spawn({ name: SHELL, cwd: tmpdir(), parent: "sni-test" });
  await waitQuiet(SHELL, 20_000, "the fresh shell never went quiet");
  await waitForPrompt(SHELL, 20_000, "the spawned pane never presented a shell to exec's guard");
});

after(() => {
  killServerSync(SOCKET); // both panes' server: wait until tmux says it is gone, unlink its socket file
  removeTempHomes(); // the HOME holding the fixture, its two logs and the ledger
});

test(
  "(1) sendVerified into a pane a PROGRAM owns delivers no SIGINT: the text lands, the fixture records zero signals, input.sent says cleared:false",
  { skip: !HAVE_PY && "needs python3" },
  async (t) => {
    assert.deepEqual(lines(SIG), [], "the fixture recorded a SIGINT before anything was sent");
    const ok = await orch.sendVerified(AGENT, "hello from the operator", { enter: true });
    assert.equal(ok, true, "sendVerified did not verify the text landed in the TUI's input line");
    await until(() => lines(RX).some((l) => l === "hello from the operator"), 5_000, `the fixture never read the line; received: ${JSON.stringify(lines(RX))}`);
    const sigs = lines(SIG);
    t.diagnostic(`fixture received ${JSON.stringify(lines(RX))}; SIGINTs recorded: ${sigs.length}`);
    assert.deepEqual(sigs, [], `the pre-paste C-c reached the agent: ${sigs.length} SIGINT recorded (${sigs.join("; ")})`);
    const d = lastSent(AGENT).data;
    assert.equal(d.cleared, false, `input.sent must say the pane was NOT cleared: ${JSON.stringify(d)}`);
    assert.equal(d.attempt, 0, "the verified path landed on its first attempt");
  },
);

test(
  "(2) control — the fixture DOES record a SIGINT when one is sent: a raw C-c into the same pane lands one line",
  { skip: !HAVE_PY && "needs python3" },
  async (t) => {
    const before = lines(SIG).length;
    await tmux.exec(["send-keys", "-t", paneTarget(AGENT), "C-c"]);
    await until(() => lines(SIG).length === before + 1, 5_000, `a raw C-c recorded nothing (${before} → ${lines(SIG).length}) — the fixture cannot see signals and (1) proved nothing`);
    t.diagnostic(`raw C-c: SIGINTs ${before} → ${lines(SIG).length}; last line ${JSON.stringify(lines(SIG).at(-1))}`);
    assert.equal((await tmux.paneInfo(AGENT)).dead, false, "the fixture died of the control signal — its handler did not hold");
  },
);

test("(3) sendVerified into a SHELL left in a continuation state still clears it — the command RUNS — and input.sent says cleared:true", async (t) => {
  // An unterminated quote: ble.sh (this host) enters `-- MULTILINE --` where Enter inserts a newline;
  // plain bash (CI) draws its `> ` continuation prompt. Either way the next paste lands INSIDE the open
  // quote unless the pane is cleared first — the state THREAT-MODEL finding 4 was written about.
  await tmux.exec(["send-keys", "-t", paneTarget(SHELL), "echo 'sni-open", "Enter"]);
  await until(async () => /sni-open/.test(await tmux.capturePane(SHELL, 20).catch(() => "")), 5_000, "the open-quote line never appeared in the shell pane");
  await waitQuiet(SHELL, 10_000, "the shell never settled in its continuation state");
  // `sni-$((40+2))` prints `sni-42` — a token the typed line itself never contains, so the OUTPUT proves the run.
  const ok = await orch.sendVerified(SHELL, "echo sni-$((40+2))", { enter: true });
  assert.equal(ok, true, "sendVerified did not verify the text landed in the shell");
  let seen = "";
  await until(async () => {
    seen = await tmux.capturePane(SHELL, 40).catch(() => "");
    return /^sni-42\s*$/m.test(seen);
  }, 5_000, `the command never ran — the continuation state was not cleared; pane read:\n${seen}`);
  const d = lastSent(SHELL).data;
  t.diagnostic(`shell pane ran the pasted command; input.sent data ${JSON.stringify(d)}`);
  assert.equal(d.cleared, true, `input.sent must say the shell pane WAS cleared: ${JSON.stringify(d)}`);
});

test("(4) execSync's own verify:false input.sent carries cleared too — one key on every send path", async () => {
  await waitForPrompt(SHELL, 15_000, "the shell was not back at its prompt for exec");
  const r = await orch.execSync(SHELL, "true", 15_000);
  assert.equal(r.exitCode, 0);
  const d = lastSent(SHELL).data;
  assert.equal(d.verified, false, `exec's input.sent is the verify:false path: ${JSON.stringify(d)}`);
  assert.equal(d.cleared, true, `exec's input.sent must record the clear: ${JSON.stringify(d)}`);
});
