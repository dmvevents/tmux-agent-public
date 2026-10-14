/**
 * `spawn --cwd DIR` is judged before anything is touched: the value is resolved to an absolute path against the
 * CALLER's directory, then refused — exit 64 at the CLI (isError over MCP: test/mcp.test.js) — when it does not
 * exist, is not a directory, or cannot be entered by this user (TMUX-108; gates G1 no test named a --cwd that is
 * not a directory — 38 --cwd lines in test/, 29 of them /tmp; G3 a supervisor learned nothing until the workload
 * failed for the wrong reason; G6 the header promised `--cwd DIR` and VALUE_FORMS said "a directory").
 *
 * Measured 2026-09-15 08:2xZ on 3b9b838 (scratch/ga-fire-2026-09-15-08Z/cwd-probe/run1c-3b9b838.log,
 * run2b-3b9b838-mcp.log): `cwd: flag("cwd") ?? process.cwd()` went straight into `new-session … -c`; tmux 3.4
 * chdir()s in the server and on failure falls back to $HOME in silence. `spawn cp-typo --cwd /srv/example/tmux-agnet`
 * (a typo of this repo's path) printed `spawned cp-typo`, exit 0, the shell in /srv/example (list-panes -a -F and
 * /proc/<pane_pid>/cwd agree), `status` reading IDLE, `exec cp-typo pwd` → /srv/example, the ledger's session.spawned
 * row recording `"cwd":"/srv/example/tmux-agnet"`; a file (/etc/hostname) and a 000-mode directory did the same; with
 * `--cmd "pwd > FILE"` the launch command ran and the file read /srv/example — the README's step 1 then step 2 in the
 * wrong tree; a relative `--cwd scratch` landed in /srv/example/tmux-agent/scratch from the repo and in $HOME from
 * /tmp — tmux resolves a relative -c against the CLIENT's directory when it exists there and falls back to $HOME when
 * it does not (verified directly on this fire, scratch/ga-fire-2026-09-15-10Z/relcwd-probe/probe.log: the card's
 * "server's cwd" reading was wrong; the server's own directory plays no part) — the ledger holding "scratch" both
 * times; on a not-yet-existing home the verb created the home, the row and the capture log. The one value refused
 * was the empty one.
 *
 * Black-box through the built CLI like test/positional-count.test.js: the contract is the exit code, the streams and
 * what did NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the
 * suite. The contract, each line a check that FAILS if the property is removed:
 *   (a) a path that does not exist, a file, a path through a file, a 000-mode directory (skipped, named, when this
 *       user can enter one — root) and a relative name that does not exist → 64, one stderr line `--cwd: <reason>
 *       "<as typed>" — give a directory`, nothing on stdout; no tmux server ever started on the socket; the
 *       not-yet-existing home still absent (no ledger row, no capture log); a --cmd on a refused spawn never runs —
 *       RED on 446a7d2: exit 0, `spawned X`, the server started, the shell in $HOME, the home created;
 *   (b) the relative case: the isolated server is started from <T>/server FIRST (so a rule that resolved against
 *       the server would be caught), the CLI runs from <T>/caller with `--cwd proj` → the pane's directory is
 *       <T>/caller/proj (read the way the driver reads it, list-panes -a -F) and the ledger row holds that ABSOLUTE
 *       path — RED on 446a7d2: the pane already landed there (tmux's own client-relative resolution), the ledger
 *       row held "proj"; a relative name that does not exist was $HOME, exit 0, and is (a)'s refusal;
 *   (c) the controls, green before and after: an absolute --cwd and the absent flag (the caller's own directory)
 *       land where they always did; a refusal against the SAME, existing home and running server births no
 *       session, no capture log and no session.spawned row;
 *   (d) one rule, not two: the CLI's line is the orchestrator's exported assertCwd's own message for the same value,
 *       and its return is the resolved path tmux is given.
 *
 * Run: node --test test/spawn-cwd.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const ORCH = pathToFileURL(join(ROOT, "dist", "core", "orchestrator.js")).href;
// A refusal is one process start; a red run (the parent's spawn, ~1 s) still ends inside the bound.
const BOUND_MS = 5_000;
// A spawn that is meant to succeed: new-session, the hasSession poll, set-option, pipe-pane.
const SPAWN_MS = 20_000;

function socket() {
  return `ta-spawncwd-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — a hang, not a refusal. `cwd` is where the caller stands. */
function cli(args, env, timeout = BOUND_MS, cwd = ROOT) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Session names on the isolated socket; a socket whose server never started has none. */
function sessions(sock) {
  try {
    return execFileSync("tmux", ["-L", sock, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
/** True when no tmux server exists on the socket at all — not "no sessions", the server itself was never started. */
function serverAbsent(sock) {
  try {
    execFileSync("tmux", ["-L", sock, "list-sessions"], { stdio: ["ignore", "pipe", "pipe"] });
    return false;
  } catch (e) {
    return /no server running|error connecting/.test(String(e.stderr));
  }
}
/** The pane's directory the way the driver reads it (src/core/tmux.ts: `list-panes -a -F`), or null. */
function panePath(sock, name) {
  try {
    const out = execFileSync("tmux", ["-L", sock, "list-panes", "-a", "-F", "#{session_name}\t#{pane_current_path}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n")) {
      const [s, p] = line.split("\t");
      if (s === name) return p;
    }
  } catch {
    /* no server */
  }
  return null;
}
async function panePathSettled(sock, name) {
  for (let i = 0; i < 30; i++) {
    const p = panePath(sock, name);
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** A refusal is exit 64, nothing on stdout, exactly one stderr line: --cwd, the reason in words, the value as typed, what it takes. */
function assertRefused(r, reason, value, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `--cwd: ${reason} ${JSON.stringify(value)} — give a directory`, `${label}: the flag, the reason in words, the value as typed and what it takes`);
}

test("spawn --cwd that is not a directory this user can enter is refused with exit 64, before a server or the home exists", async (t) => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-spawncwd-")));
  const S = socket();
  const home = join(T, "home"); // never created by a refusal
  const env = { TMUX_AGENT_HOME: home };
  const nosuch = join(T, "tmux-agnet"); // the shape of the measured typo: one letter off a path that exists
  const file = join(T, "afile");
  writeFileSync(file, "not a directory\n");
  const locked = join(T, "locked");
  mkdirSync(locked, { mode: 0o000 });
  const relNosuch = `no-such-rel-${process.pid}`;
  // root can enter a 000 directory (accessSync X_OK passes), so the case would be a false red there — skip it, named
  let canEnterLocked = true;
  try {
    accessSync(locked, constants.X_OK);
  } catch {
    canEnterLocked = false;
  }
  if (canEnterLocked) t.diagnostic("000-mode case skipped: this user can enter a 000 directory (running as root?)");
  const cases = [
    [nosuch, "no such directory", "cwd-nosuch"],
    [file, "not a directory", "cwd-file"],
    [join(file, "x"), "no such directory", "cwd-through-file"],
    ...(canEnterLocked ? [] : [[locked, "cannot enter", "cwd-locked"]]),
  ];
  try {
    // (a) each refused, the value as typed
    for (const [value, reason, name] of cases) {
      const r = await cli(["--socket", S, "spawn", name, "--cwd", value], env);
      assertRefused(r, reason, value, `spawn ${name} --cwd ${value}`);
    }
    // a relative name that does not exist — named as typed, not as resolved
    let r = await cli(["--socket", S, "spawn", "cwd-rel-nosuch", "--cwd", relNosuch], env, BOUND_MS, T);
    assertRefused(r, "no such directory", relNosuch, `(cd <T> && spawn cwd-rel-nosuch --cwd ${relNosuch})`);
    // a --cmd on a refused spawn never runs: on 3b9b838 it ran in $HOME (the marker file read /srv/example)
    const marker = join(T, "cmd-ran");
    r = await cli(["--socket", S, "spawn", "cwd-cmd", "--cwd", nosuch, "--cmd", `touch ${marker}`], env);
    assertRefused(r, "no such directory", nosuch, `spawn cwd-cmd --cwd ${nosuch} --cmd "touch …"`);
    assert.equal(existsSync(marker), false, "the launch command of a refused spawn ran (in $HOME)");
    // nothing was touched: no server on the socket, no home (so no ledger row, no capture log), nothing beside the plants
    assert.ok(serverAbsent(S), `a refusal started a tmux server on ${S} (sessions: ${sessions(S).join(", ") || "none"})`);
    assert.equal(existsSync(home), false, "a refusal created the home before the directory was judged (on 3b9b838 the home, the row and the capture log were created)");
    assert.deepEqual(readdirSync(T).sort(), ["afile", "locked"], `a refusal left something in the temp dir: ${readdirSync(T).join(", ")}`);
    // (d) one rule: the orchestrator's exported check, the CLI's exact words, the resolved path returned
    const orch = await import(ORCH);
    assert.equal(typeof orch.assertCwd, "function", "src/core/orchestrator.ts exports no assertCwd — the CLI has no one rule to judge --cwd through");
    for (const [value, reason] of [...cases, [relNosuch, "no such directory"], ["", "no such directory"]]) {
      assert.throws(() => orch.assertCwd(value), (e) => e instanceof orch.CwdError && e.name === "CwdError" && e.message === `--cwd: ${reason} ${JSON.stringify(value)} — give a directory`, `assertCwd(${JSON.stringify(value)}): the orchestrator's line is not the CLI's`);
    }
    assert.equal(orch.assertCwd(T), T, "a directory resolves to itself");
    assert.equal(orch.assertCwd("."), process.cwd(), "a relative value resolves against the caller's directory");
  } finally {
    killServerSync(S);
    chmodSync(locked, 0o700);
    rmSync(T, { recursive: true, force: true });
  }
});

test("a relative --cwd lands where the caller stood, not where the tmux server did, and the ledger holds the directory the pane has", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-spawncwd-rel-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const serverDir = join(T, "server");
  const caller = join(T, "caller");
  const proj = join(caller, "proj");
  mkdirSync(serverDir);
  mkdirSync(proj, { recursive: true });
  try {
    // the server is born FIRST, from a directory that is not the caller's, so a resolution against the server's
    // directory — or none — would be caught; tmux's own is against the client's, $HOME when it has no such name
    execFileSync("tmux", ["-L", S, "-f", "/dev/null", "new-session", "-d", "-s", "anchor"], { cwd: serverDir, stdio: "ignore" });
    assert.equal(await panePathSettled(S, "anchor"), serverDir, "test setup: the server's own session must stand in <T>/server");
    // (b) the relative case, from <T>/caller
    let r = await cli(["--socket", S, "spawn", "cwd-rel", "--cwd", "proj", "--parent", "cwd-test"], env, SPAWN_MS, caller);
    assert.equal(r.code, 0, `(cd <T>/caller && spawn cwd-rel --cwd proj) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(r.stdout, "spawned cwd-rel\n", `the spawn's one stdout line: ${r.stdout}`);
    assert.equal(await panePathSettled(S, "cwd-rel"), proj, "the pane is not in <T>/caller/proj — the relative --cwd was not resolved against the caller's directory");
    // (c) the controls: an absolute --cwd from elsewhere, and the absent flag — the caller's own directory
    r = await cli(["--socket", S, "spawn", "cwd-abs", "--cwd", proj, "--parent", "cwd-test"], env, SPAWN_MS, ROOT);
    assert.equal(r.code, 0, `spawn cwd-abs --cwd <T>/caller/proj exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(await panePathSettled(S, "cwd-abs"), proj, "an absolute --cwd no longer lands where it says");
    r = await cli(["--socket", S, "spawn", "cwd-default", "--parent", "cwd-test"], env, SPAWN_MS, caller);
    assert.equal(r.code, 0, `(cd <T>/caller && spawn cwd-default) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(await panePathSettled(S, "cwd-default"), caller, "the absent flag no longer means the caller's own directory");
    // a refusal against the SAME, existing home and running server: nothing born, nothing captured, nothing ledgered
    const nope = join(T, "nope");
    r = await cli(["--socket", S, "spawn", "cwd-bad", "--cwd", nope, "--parent", "cwd-test"], env);
    assertRefused(r, "no such directory", nope, "spawn cwd-bad --cwd <T>/nope (home exists, server running)");
    assert.deepEqual(sessions(S).sort(), ["anchor", "cwd-abs", "cwd-default", "cwd-rel"], `the sessions on ${S} are not exactly the anchor and the three spawns (a refusal birthed one?)`);
    assert.equal(existsSync(join(home, "logs", "cwd-bad.log")), false, "a refused spawn started a capture log");
    // the ledger: one session.spawned per spawn, each holding the ABSOLUTE directory the pane has — none for the refusal
    const spawned = ledger(home).filter((e) => e.type === "session.spawned").map((e) => [e.session, e.data.cwd]);
    assert.deepEqual(spawned, [["cwd-rel", proj], ["cwd-abs", proj], ["cwd-default", caller]], "session.spawned rows are not the three spawns with the resolved directory (on 446a7d2 the relative row held \"proj\" and a bad --cwd had a row)");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
