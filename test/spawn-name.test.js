/**
 * The session NAME a verb acts on is judged before anything is touched — `spawn <name>`, and every other verb whose
 * first positional the header calls `<name>` (`send`, `exec`, `watch`, `kill`, `log`) — through the driver's one
 * exported rule, `assertName` in src/core/tmux.ts (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`): exit 64 at the CLI, one
 * stderr line naming the verb, the value as typed and the rule; isError over MCP (test/mcp.test.js) (TMUX-109; gates
 * G1 no test named a spawn of a name the tool cannot use — 3 lines named `invalid session name`, all the driver's own
 * unit cases; G3 a supervisor's `watch` read a typo as a death; G6 the header promised `spawn <name>` and the tool
 * refused the name in tmux's words, exit 1, after making the home).
 *
 * Measured 2026-09-15 14:2xZ on 296272c (scratch/ga-fire-2026-09-15-14Z/name-probe-parent/probe-296272c.log; the
 * sixty-first fire's name-probe-4975ca9.log agrees): `assertName` was reached only through `sessionTarget`/`paneTarget`,
 * and `hasSession` swallows its throw in a bare `catch {}`, so the name went into `new-session -s` unjudged — after the
 * CLI had built the Orchestrator, whose constructor mkdirs the 0700 home. `spawn 'vp bad' --cwd /tmp` printed `tmux
 * new-session failed: Command failed: …`, exit 1 — and the session `vp bad` was on the socket anyway, one the tool could
 * not then address (`kill`/`send`/`exec 'vp bad'` → `invalid session name`, exit 1); `spawn '' --cwd /tmp` (one
 * positional, so TMUX-106's count check passes) failed `invalid session:`, exit 1; `spawn ../evil --cwd /tmp` failed
 * `invalid session name: "../evil"`, exit 1 — thrown uncaught from the post-`hasSession` set-option, AFTER tmux had made
 * a session named `__/evil` (tmux rewrites `.` and `:` to `_`), which stayed; `watch 'vp bad' --idle-secs 1` printed
 * `{"state":"GONE"}` and exited 2 — the code a supervising script reads as "the session died"; `log 'vp bad'` printed
 * `<home>/logs/vp bad.log`, exit 0, and `log ../evil` printed `<home>/evil.log` — outside logs/. In every case the 0700
 * home (and logs/) had been created by the refused verb.
 *
 * Black-box through the built CLI like test/spawn-cwd.test.js: the contract is the exit code, the streams and what
 * did NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the suite.
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) a name with a space, the empty name, a traversal, a leading dash and a 65-character name on `spawn` → 64,
 *       one stderr line `spawn: invalid session name: "<as typed>" (alnum start, [A-Za-z0-9._-], <=64)`, nothing on
 *       stdout; no tmux server ever started on the socket; the not-yet-existing home still absent (no logs/, no
 *       ledger row, no capture log); a --cmd on a refused spawn never runs — RED on 296272c: exit 1 in tmux's words
 *       or from the uncaught throw, a server started, `vp bad` and `__/evil` on it, the home created;
 *   (b) the same name on `kill`, `send`, `exec`, `watch` and `log` → 64 in the same shape, the verb named — RED on
 *       296272c: kill/send/exec exit 1 from the uncaught throw, watch exit 2 GONE, log exit 0 with a path, the home
 *       created every time;
 *   (c) the controls, green before and after: a valid name spawns (exit 0, `spawned <name>`); a refusal beside the
 *       SAME, existing home and running server births no session — not the typed one and not tmux's rewrite of it —
 *       no capture log, no ledger row, and the live session is untouched;
 *   (d) one rule, not two: src/core/tmux.ts exports `assertName`, its throw is a `SessionNameError`, the CLI's line
 *       is `<verb>: ` + that error's own message for the same value, and the rule still accepts every valid name.
 *
 * Run: node --test test/spawn-name.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const TMUX = pathToFileURL(join(ROOT, "dist", "core", "tmux.js")).href;
const RULE = "(alnum start, [A-Za-z0-9._-], <=64)";
// A refusal is one process start; a red run (the parent's new-session plus its 20×50 ms hasSession poll, ~1.5 s)
// still ends inside the bound.
const BOUND_MS = 5_000;
// A spawn that is meant to succeed: new-session, the hasSession poll, set-option, pipe-pane.
const SPAWN_MS = 20_000;
// The names the rule refuses, each a different clause of it: the space, the empty string (passes TMUX-106's count
// check — one positional is present), the traversal tmux would rewrite to __/evil, a non-alnum start, one over the length.
const BAD = ["vp bad", "", "../evil", "-leading", "a".repeat(65)];
// The other verbs whose first positional the header calls <name>, with the rest of their shape.
const NAME_VERBS = [
  ["kill", []],
  ["send", ["hello"]],
  ["exec", ["true"]],
  ["watch", ["--idle-secs", "1"]],
  ["log", []],
];

function socket() {
  return `ta-spawnname-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
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
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** A refusal is exit 64, nothing on stdout, exactly one stderr line: the verb, the value as typed, the rule. */
function assertRefused(r, verb, value, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `${verb}: invalid session name: ${JSON.stringify(value)} ${RULE}`, `${label}: the verb, the value as typed and the rule`);
}

test("a session name the tool cannot use is refused with exit 64 on every <name> verb, before a server or the home exists", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-spawnname-")));
  const S = socket();
  const home = join(T, "home"); // never created by a refusal
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (a) spawn: each refused, the value as typed — the directory is a real one, so the name is the only fault
    for (const value of BAD) {
      const r = await cli(["--socket", S, "spawn", value, "--cwd", T], env);
      assertRefused(r, "spawn", value, `spawn ${JSON.stringify(value)} --cwd <T>`);
    }
    // a --cmd on a refused spawn never runs
    const marker = join(T, "cmd-ran");
    let r = await cli(["--socket", S, "spawn", "vp bad", "--cwd", T, "--cmd", `touch ${marker}`], env);
    assertRefused(r, "spawn", "vp bad", 'spawn "vp bad" --cwd <T> --cmd "touch …"');
    assert.equal(existsSync(marker), false, "the launch command of a refused spawn ran");
    // (b) the other <name> verbs: the same rule, the verb named — on 296272c kill/send/exec exited 1 from the uncaught
    // throw, watch exited 2 (GONE — "the session died"), log exited 0 with a path, each after making the home
    for (const [verb, args] of NAME_VERBS) {
      r = await cli(["--socket", S, verb, "vp bad", ...args], env);
      assertRefused(r, verb, "vp bad", `${verb} "vp bad" ${args.join(" ")}`.trim());
    }
    r = await cli(["--socket", S, "log", "../evil"], env);
    assertRefused(r, "log", "../evil", 'log "../evil" (on 296272c: a path outside logs/, exit 0)');
    // nothing was touched: no server on the socket, no home (so no logs/, no ledger row, no capture log), nothing in the temp dir
    assert.ok(serverAbsent(S), `a refusal started a tmux server on ${S} (sessions: ${sessions(S).join(", ") || "none"})`);
    assert.equal(existsSync(home), false, "a refusal created the home before the name was judged (on 296272c the constructor's mkdirSync ran first)");
    assert.deepEqual(readdirSync(T), [], `a refusal left something in the temp dir: ${readdirSync(T).join(", ")}`);
    // (d) one rule: the driver's exported check, a typed error, the CLI's words after the verb; every valid shape still accepted
    const tmux = await import(TMUX);
    assert.equal(typeof tmux.assertName, "function", "src/core/tmux.ts exports no assertName — the CLI has no one rule to judge a name through");
    for (const value of BAD) {
      assert.throws(() => tmux.assertName(value), (e) => e instanceof tmux.SessionNameError && e.name === "SessionNameError" && e.message === `invalid session name: ${JSON.stringify(value)} ${RULE}`, `assertName(${JSON.stringify(value)}): the driver's line is not the CLI's`);
    }
    for (const ok of ["vp-ok", "a.b_c-1", "A" + "a".repeat(63), "0"]) assert.doesNotThrow(() => tmux.assertName(ok), `assertName rejects a valid name ${JSON.stringify(ok)}`);
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});

test("beside a running server and an existing home, a refused name births nothing — not the typed name, not tmux's rewrite of it — and the live session stands", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-spawnname-live-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (c) the control: a valid name spawns, and the home is made by the accepted verb
    let r = await cli(["--socket", S, "spawn", "vp-ok", "--cwd", T, "--parent", "name-test"], env, SPAWN_MS);
    assert.equal(r.code, 0, `spawn vp-ok --cwd <T> exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(r.stdout, "spawned vp-ok\n", `the spawn's one stdout line: ${r.stdout}`);
    assert.ok(existsSync(home), "test setup: the accepted spawn must have made the home");
    // the refusals, against the SAME home and server: the space, and the traversal tmux would have rewritten to __/evil
    r = await cli(["--socket", S, "spawn", "vp bad", "--cwd", T, "--parent", "name-test"], env);
    assertRefused(r, "spawn", "vp bad", 'spawn "vp bad" --cwd <T> (home exists, server running)');
    r = await cli(["--socket", S, "spawn", "../evil", "--cwd", T, "--parent", "name-test"], env);
    assertRefused(r, "spawn", "../evil", 'spawn "../evil" --cwd <T> (home exists, server running)');
    r = await cli(["--socket", S, "kill", "vp bad"], env);
    assertRefused(r, "kill", "vp bad", 'kill "vp bad" (home exists, server running)');
    assert.deepEqual(sessions(S), ["vp-ok"], `the sessions on ${S} are not exactly the one valid spawn (on 296272c "vp bad" and "__/evil" were born by the refused spawns)`);
    // no capture log for a refused name — under logs/ or, for the traversal, beside it
    assert.deepEqual(readdirSync(join(home, "logs")).filter((f) => f !== "vp-ok.log"), [], `a refused spawn started a capture log: ${readdirSync(join(home, "logs")).join(", ")}`);
    assert.equal(existsSync(join(home, "evil.log")), false, "a traversal name reached the capture-log path beside logs/");
    // the ledger: one session.spawned — the valid spawn — and no row of any type for a refused name
    const rows = ledger(home);
    assert.deepEqual(rows.filter((e) => e.type === "session.spawned").map((e) => e.session), ["vp-ok"], "session.spawned rows are not exactly the valid spawn");
    assert.deepEqual(rows.filter((e) => e.session === "vp bad" || e.session === "../evil").map((e) => e.type), [], "a refused name reached the ledger");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
