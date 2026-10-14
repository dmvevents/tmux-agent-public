/**
 * `spawn --cmd` whose launch command never landed is a typed failure, not a success: the session is created and KEPT
 * for diagnosis, the `session.spawned` row says `commandDelivered: false`, and the caller gets `SpawnDeliveryError`
 * naming the session.
 *
 * Measured 2026-10-13 on 3ebb7a8 by the review (spawn-delivery-probe) and reproduced on 806756e with a fake whose pane
 * never echoes a paste: `Orchestrator.spawn()` ran `if (spec.command) await this.sendVerified(...)` and dropped the
 * boolean — with both pastes dropped it recorded two `input.verified ok:false` rows, then one `session.spawned`, returned
 * `created: true`, and the CLI printed `spawned <name>` with exit 0 while the configured startup command had not landed.
 * A supervisor read "spawned" and moved on; the shell sat at its prompt with nothing running.
 *
 * Each check FAILS if the property is removed (RED on 806756e quoted in the messages):
 *   (1) every paste dropped → spawn() rejects with SpawnDeliveryError whose message names the session and says the shell
 *       is kept; `new-session` was issued and `kill-session` was NOT (the shell stays for diagnosis); the ledger holds
 *       exactly one `session.spawned` row for the session, with `commandDelivered: false`, beside the `input.verified
 *       ok:false` rows the failed sends filed — RED: resolved `true`, no `commandDelivered` key;
 *   (2) the control: a pane that echoes the paste → spawn() resolves true and the row says `commandDelivered: true`;
 *   (3) no command → resolves true, `commandDelivered: null` (nothing was to deliver; null, not a faked true);
 *   (4) the CLI, against a REAL pane whose login profile turns the pty's echo off and holds the shell (so the paste
 *       shows nowhere and sendVerified() answers false): `spawn --cmd` exits 1 with one stderr line naming the kept
 *       session, prints no `spawned`, and the session still exists — RED: exit 0, `spawned sd-cli` on stdout.
 *   The class is exported from the orchestrator module (like EmptyTextError — not from the root, VERSIONING item 6's
 *   closure is unchanged) and carries `session`, the handle a caller branches on.
 *
 * Run: npm run build && node --test test/spawn-command-delivery.test.js   (case 4 needs a tmux binary)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { killServerSync } from "./helpers/kill-server.js";

import { Orchestrator } from "../dist/core/orchestrator.js";
import { Policy } from "../dist/core/policy.js";
import { Ledger } from "../dist/core/ledger.js";
import { ROOT } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const ORCH_JS = pathToFileURL(join(ROOT, "dist", "core", "orchestrator.js")).href;
const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const CMD = "claude --dangerously-skip-permissions";
const HAVE_TMUX = spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The built CLI as a subprocess: { code, stdout, stderr }; a run the bound cuts reads as code 1. */
function cli(args, env, timeout) {
  return new Promise((res) =>
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, encoding: "utf8" }, (err, stdout, stderr) =>
      res({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }),
    ),
  );
}
function tmuxRaw(sock, args) {
  try {
    return { rc: 0, out: String(execFileSync("tmux", ["-L", sock, ...args], { stdio: ["ignore", "pipe", "pipe"] })).trim() };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim() };
  }
}

function freshHome() {
  const h = tempHome("ta-spawndel-");
  process.env.TMUX_AGENT_HOME = h;
  return h;
}
function rows(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/**
 * A FakeTmux for spawn: the pane shows a prompt; with `echo: true` a paste-buffer appends the buffered text (a shell
 * echoing the paste), with `echo: false` the pane never changes — every paste is dropped. Every verb is recorded.
 */
function fakeTmux({ echo }) {
  const calls = [];
  let pane = "$ ";
  let buffered = "";
  return {
    calls,
    socketArgs: () => ["-L", "test"],
    exec: async (args) => {
      calls.push(args);
      if (args[0] === "set-buffer") buffered = args[3] ?? "";
      if (args[0] === "paste-buffer" && echo) pane += `${buffered}\n$ `;
      if (args[0] === "show-options") return { stdout: "\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    hasSession: async () => false,
    capturePane: async () => pane,
    paneInfo: async () => ({ pid: 4_000_001, currentCmd: "bash", cwd: "/tmp", dead: false }),
    listSessions: async () => [],
    listSessionsReachable: async () => ({ reachable: true, error: null, sessions: [] }),
  };
}
const mkOrch = (tmux) => new Orchestrator(tmux, new Ledger(join(process.env.TMUX_AGENT_HOME, "ledger")), new Policy({}), "spawndel-test");
const issued = (tmux, verb) => tmux.calls.filter((c) => c[0] === verb).length;

test("(1) every paste dropped: spawn rejects with SpawnDeliveryError, keeps the shell, and the session.spawned row says commandDelivered:false", async () => {
  const home = freshHome();
  const mod = await import(ORCH_JS);
  assert.equal(typeof mod.SpawnDeliveryError, "function", "dist/core/orchestrator.js exports no SpawnDeliveryError — on 806756e spawn() dropped sendVerified()'s boolean and returned true");
  const tmux = fakeTmux({ echo: false });
  const orch = mkOrch(tmux);
  await assert.rejects(
    () => orch.spawn({ name: "sd-drop", cwd: home, parent: "sd-parent", command: CMD }),
    (e) => e instanceof mod.SpawnDeliveryError && e.session === "sd-drop" && /sd-drop/.test(e.message) && /kept|diagnos/i.test(e.message),
    "spawn resolved although the launch command never landed (on 806756e: created true, 'spawned' printed, exit 0)",
  );
  assert.equal(issued(tmux, "new-session"), 1, "the session was not created before the command was tried");
  assert.equal(issued(tmux, "kill-session"), 0, "the failed delivery killed the session — it must be kept for diagnosis");
  assert.ok(issued(tmux, "paste-buffer") >= 1, "no paste was attempted");
  const spawned = rows(home).filter((e) => e.type === "session.spawned" && e.session === "sd-drop");
  assert.equal(spawned.length, 1, `one session.spawned row, got ${spawned.length}`);
  assert.equal(spawned[0].data.commandDelivered, false, `the row does not say commandDelivered:false: ${JSON.stringify(spawned[0].data)}`);
  assert.equal(spawned[0].data.command, CMD, "the row still carries the command");
  assert.ok(rows(home).some((e) => e.type === "input.verified" && e.session === "sd-drop" && e.data?.ok === false), "the failed sends left no input.verified ok:false row");
});

test("(2) the control: a pane that echoes the paste → spawn resolves true and the row says commandDelivered:true", async () => {
  const home = freshHome();
  const tmux = fakeTmux({ echo: true });
  const created = await mkOrch(tmux).spawn({ name: "sd-ok", cwd: home, parent: "sd-parent", command: CMD });
  assert.equal(created, true);
  assert.equal(issued(tmux, "kill-session"), 0);
  const spawned = rows(home).filter((e) => e.type === "session.spawned" && e.session === "sd-ok");
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].data.commandDelivered, true, `a delivered command is not recorded as such: ${JSON.stringify(spawned[0].data)}`);
});

test("(3) no command: spawn resolves true and the row says commandDelivered:null — nothing was to deliver", async () => {
  const home = freshHome();
  const tmux = fakeTmux({ echo: false });
  const created = await mkOrch(tmux).spawn({ name: "sd-none", cwd: home, parent: "sd-parent" });
  assert.equal(created, true);
  assert.equal(issued(tmux, "paste-buffer"), 0, "a spawn without a command pasted something");
  const spawned = rows(home).filter((e) => e.type === "session.spawned" && e.session === "sd-none");
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].data.commandDelivered, null, `a spawn with no command must record null, not ${JSON.stringify(spawned[0].data.commandDelivered)}`);
  assert.equal(spawned[0].data.command, null);
});

test(
  "(4) the CLI: `spawn --cmd` whose command cannot land exits 1 naming the kept session, prints no `spawned`, and the session exists — a real pane held with echo off",
  { skip: !HAVE_TMUX && "needs a tmux binary" },
  async () => {
    // The plant (the exec-ready-wait (k) recipe): the server is started with bash as its login shell and a HOME whose
    // profile turns the pty's echo off and holds the shell, so the paste spawn sends shows nowhere — no echo, no shell to
    // redraw it — both looks and the one retry find no trace, and sendVerified() answers false.
    const sock = `ta-spawndel-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
    const profile = tempHome("ta-spawndel-profile-");
    writeFileSync(join(profile, ".bash_profile"), "stty -echo\nsleep 20\n");
    const home = freshHome();
    let pids = [];
    try {
      const prep = tmuxRaw(sock, ["start-server", ";", "set-option", "-s", "exit-empty", "off", ";", "set-option", "-g", "default-shell", "/bin/bash", ";", "set-environment", "-g", "HOME", profile]);
      assert.equal(prep.rc, 0, `test setup: the server could not be prepared: ${prep.out}`);
      const r = await cli(["--socket", sock, "spawn", "sd-cli", "--cwd", home, "--parent", "sd-parent", "--cmd", "echo HELLO_FROM_SPAWN"], { TMUX_AGENT_HOME: home }, 30_000);
      pids = tmuxRaw(sock, ["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").map(Number).filter(Boolean);
      assert.equal(tmuxRaw(sock, ["has-session", "-t", "=sd-cli"]).rc, 0, "the session does not exist after the spawn — it must be kept for diagnosis");
      assert.doesNotMatch(r.stdout, /spawned sd-cli/, `the CLI claimed success for a command that never landed — on 806756e it printed "spawned sd-cli" with exit 0 (stdout: ${r.stdout.trim()})`);
      assert.equal(r.code, 1, `exit ${r.code}, want 1 (stdout: ${r.stdout.trim()}; stderr: ${r.stderr.trim()})`);
      assert.match(r.stderr, /sd-cli was created but its command did not land/, `the stderr line does not name the kept session: ${r.stderr.trim()}`);
      assert.match(r.stderr, /kept/, `the stderr line does not say the shell is kept: ${r.stderr.trim()}`);
      const spawned = rows(home).filter((e) => e.type === "session.spawned" && e.session === "sd-cli");
      assert.equal(spawned.length, 1, `one session.spawned row, got ${spawned.length}`);
      assert.equal(spawned[0].data.commandDelivered, false, `the row does not say commandDelivered:false: ${JSON.stringify(spawned[0].data)}`);
    } finally {
      killServerSync(sock);
      // the held shell and its sleep take the server's SIGHUP; wait for them before the temp homes go
      for (let i = 0; i < 60 && pids.some((p) => { try { process.kill(p, 0); return true; } catch { return false; } }); i++) await sleep(50);
    }
  },
);
