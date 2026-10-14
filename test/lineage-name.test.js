/**
 * The two LINEAGE values a session is born with — `--parent`, and the actor (`--actor`, else `TMUX_AGENT_ACTOR`) — are
 * judged before anything is touched, through the driver's one exported rule, `assertName` in src/core/tmux.ts
 * (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`): exit 64 at the CLI, one stderr line naming the source, the value as typed and
 * the rule; isError over MCP (test/mcp.test.js); the MCP server refusing to start under an actor it cannot use (TMUX-110;
 * gates G1 no test named a `--parent` or `--actor` the tool cannot use — 48 in the suites, scripts and README, every one
 * valid; G3 `kill` refused every other actor in the words of an owner no session can bear; G6 the header calls each "a
 * name" and the ledger's public envelope carries both).
 *
 * Measured 2026-09-15 16:3xZ on e254450 (scratch/ga-fire-2026-09-15-16Z/parent-actor-probe/probe-e254450.log,
 * supplement-e254450.log): `actor = flag("actor") ?? process.env.TMUX_AGENT_ACTOR ?? "cli"` went straight into `new
 * Orchestrator(…, actor)` and `parent: flag("parent") ?? actor` straight into the spec; `Orchestrator.spawn` wrote both to
 * tmux (`@agent_parent` / `@agent_owner`) and to the `session.spawned` row, every later event carried the actor, and
 * `kill`'s ownership check compared the strings. `--actor ../who spawn vp-bad --cwd /tmp --parent 'not a name!'` printed
 * `spawned vp-bad`, exit 0 — so did `--actor 'who am i' … --parent 'x y'`, a 65-character `--parent` and
 * `TMUX_AGENT_ACTOR=../env-who`; `lineage` showed `vp-bad parent=not a name! owner=../who`; the ledger row carried
 * `"parent":"not a name!","actor":"../who"`; `kill vp-bad` by the default actor was refused `owned by ../who`, exit 1,
 * and `--actor ../who kill vp-bad` was allowed; `doctor --parent 'not a name!,../who'` gave each the verdict "expected to
 * be a live tmux session". A parent no session can bear is ORPHANED by construction (src/core/engagement.ts).
 *
 * Black-box through the built CLI like test/spawn-name.test.js: the contract is the exit code, the streams and what
 * did NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the suite.
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) a space, a traversal and a 65-character value on `--parent` (spawn) → 64, one stderr line
 *       `--parent: invalid session name: "<as typed>" (alnum start, [A-Za-z0-9._-], <=64)`, nothing on stdout; no tmux
 *       server ever started on the socket; the not-yet-existing home still absent (no logs/, no ledger row); a --cmd on a
 *       refused spawn never runs — RED on e254450: exit 0, `spawned`, the session born with the value in its lineage;
 *   (b) the same values on `--actor` → `--actor: invalid session name: …`, and through `TMUX_AGENT_ACTOR` →
 *       `TMUX_AGENT_ACTOR: invalid session name: …` — on `spawn`, and on a verb that never spawns (`lineage`, `kill`),
 *       because every verb's Orchestrator is built with the actor — RED on e254450: exit 0 everywhere;
 *   (c) the controls, green before and after: a valid `--parent` and `--actor` spawn and land in `lineage` as typed; the
 *       actor from `TMUX_AGENT_ACTOR` lands as the owner; the flag wins over the variable; the defaults (`cli`, the
 *       parent defaulting to the actor) are unchanged; beside the SAME home and running server a refused value births
 *       nothing, writes no row, and the live session stands;
 *   (d) `doctor --parent A,B` judges each name — 64 naming `--parent` and the first unusable name as typed — while a
 *       valid list keeps its verdicts, exit 0 — RED on e254450: a verdict for a name no session can bear;
 *   (e) one rule, not two: the CLI's line is `<source>: ` + `SessionNameError`'s own message for the same value, and
 *       `assertName(value, source)` builds that line itself — the CLI has no second copy of the words.
 *
 * Run: node --test test/lineage-name.test.js   (needs `npm run build` first)
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
// The values the rule refuses, each a different clause of it: the space (the empty value is judgeFlags' refusal,
// TMUX-105), the traversal, one over the length.
const BAD = ["not a name!", "../who", "p".repeat(65)];

function socket() {
  return `ta-lineage-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    // TMUX_AGENT_ACTOR is unset unless the case sets it: this test's own environment must not be the actor
    const clean = { ...process.env };
    delete clean.TMUX_AGENT_ACTOR;
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...clean, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
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
/** A refusal is exit 64, nothing on stdout, exactly one stderr line: the source, the value as typed, the rule. */
function assertRefused(r, source, value, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `${source}: invalid session name: ${JSON.stringify(value)} ${RULE}`, `${label}: the source, the value as typed and the rule`);
}
/** The `lineage` row for one session: { parent, owner } as the tool reads them back from tmux. */
function lineageOf(stdout, name) {
  const row = stdout.split("\n").find((l) => l.startsWith(`${name}\t`));
  assert.ok(row, `lineage has no row for ${name}: ${stdout}`);
  const field = (k) => row.split("\t").find((f) => f.startsWith(`${k}=`))?.slice(k.length + 1);
  return { parent: field("parent"), owner: field("owner") };
}

test("a --parent or actor the tool cannot use is refused with exit 64, before a server or the home exists", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-lineage-")));
  const S = socket();
  const home = join(T, "home"); // never created by a refusal
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (a) --parent on spawn: each refused, the value as typed — the name and the directory are valid, so the parent is the only fault
    for (const value of BAD) {
      const r = await cli(["--socket", S, "spawn", "vl-ok", "--cwd", T, "--parent", value], env);
      assertRefused(r, "--parent", value, `spawn vl-ok --cwd <T> --parent ${JSON.stringify(value)}`);
    }
    // a --cmd on a refused spawn never runs
    const marker = join(T, "cmd-ran");
    let r = await cli(["--socket", S, "spawn", "vl-ok", "--cwd", T, "--parent", "not a name!", "--cmd", `touch ${marker}`], env);
    assertRefused(r, "--parent", "not a name!", 'spawn vl-ok --cwd <T> --parent "not a name!" --cmd "touch …"');
    assert.equal(existsSync(marker), false, "the launch command of a refused spawn ran");
    // (b) --actor, on spawn and on verbs that never spawn — every verb's Orchestrator is built with the actor
    for (const value of BAD) {
      r = await cli(["--socket", S, "--actor", value, "spawn", "vl-ok", "--cwd", T], env);
      assertRefused(r, "--actor", value, `--actor ${JSON.stringify(value)} spawn vl-ok --cwd <T>`);
    }
    r = await cli(["--socket", S, "--actor", "../who", "kill", "vl-ok"], env);
    assertRefused(r, "--actor", "../who", '--actor "../who" kill vl-ok (on e254450: the actor a kill was judged AS)');
    r = await cli(["--socket", S, "lineage", "--actor", "who am i"], env);
    assertRefused(r, "--actor", "who am i", 'lineage --actor "who am i"');
    // the variable, when the flag is absent: named as the source
    for (const value of BAD) {
      r = await cli(["--socket", S, "spawn", "vl-ok", "--cwd", T], { ...env, TMUX_AGENT_ACTOR: value });
      assertRefused(r, "TMUX_AGENT_ACTOR", value, `TMUX_AGENT_ACTOR=${JSON.stringify(value)} spawn vl-ok --cwd <T>`);
    }
    r = await cli(["--socket", S, "lineage"], { ...env, TMUX_AGENT_ACTOR: "" });
    assertRefused(r, "TMUX_AGENT_ACTOR", "", "TMUX_AGENT_ACTOR= (set, empty) lineage (on e254450: an owner named nothing)");
    // (d) doctor --parent: each comma-separated name judged, the first unusable one named as typed
    r = await cli(["--socket", S, "doctor", "--parent", "ok-boss,not a name!,../who"], env);
    assertRefused(r, "--parent", "not a name!", 'doctor --parent "ok-boss,not a name!,../who" (on e254450: a verdict for each)');
    // nothing was touched: no server on the socket, no home (so no logs/, no ledger row), nothing in the temp dir
    assert.ok(serverAbsent(S), `a refusal started a tmux server on ${S} (sessions: ${sessions(S).join(", ") || "none"})`);
    assert.equal(existsSync(home), false, "a refusal created the home before the lineage was judged (on e254450 the constructor's mkdirSync ran, and the session was born)");
    assert.deepEqual(readdirSync(T), [], `a refusal left something in the temp dir: ${readdirSync(T).join(", ")}`);
    // (e) one rule: the driver's exported check builds the CLI's line itself when given the source, and the plain message otherwise
    const tmux = await import(TMUX);
    assert.equal(typeof tmux.assertName, "function", "src/core/tmux.ts exports no assertName — the CLI has no one rule to judge a name through");
    for (const value of BAD) {
      const plain = `invalid session name: ${JSON.stringify(value)} ${RULE}`;
      assert.throws(() => tmux.assertName(value), (e) => e instanceof tmux.SessionNameError && e.message === plain, `assertName(${JSON.stringify(value)}): the driver's plain message`);
      for (const source of ["--parent", "--actor", "TMUX_AGENT_ACTOR"]) {
        assert.throws(() => tmux.assertName(value, source), (e) => e instanceof tmux.SessionNameError && e.message === `${source}: ${plain}`, `assertName(${JSON.stringify(value)}, ${JSON.stringify(source)}): the CLI's line is not the driver's`);
      }
    }
    for (const ok of ["boss", "my-supervisor", "a.b_c-1", "A" + "a".repeat(63), "0"]) assert.doesNotThrow(() => tmux.assertName(ok, "--parent"), `assertName rejects a valid name ${JSON.stringify(ok)}`);
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});

test("valid lineage values spawn and land as typed; beside a running server a refused value births nothing and the live session stands", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-lineage-live-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (c) the controls: the flag, the variable, the flag over the variable, the defaults — each lands in lineage as typed
    let r = await cli(["--socket", S, "--actor", "flag-boss", "spawn", "vl-flag", "--cwd", T, "--parent", "flag-parent"], env, SPAWN_MS);
    assert.equal(r.code, 0, `--actor flag-boss spawn vl-flag --parent flag-parent exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(r.stdout, "spawned vl-flag\n", `the spawn's one stdout line: ${r.stdout}`);
    r = await cli(["--socket", S, "spawn", "vl-env", "--cwd", T], { ...env, TMUX_AGENT_ACTOR: "env-boss" }, SPAWN_MS);
    assert.equal(r.code, 0, `TMUX_AGENT_ACTOR=env-boss spawn vl-env exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    r = await cli(["--socket", S, "--actor", "flag-boss", "spawn", "vl-both", "--cwd", T], { ...env, TMUX_AGENT_ACTOR: "env-boss" }, SPAWN_MS);
    assert.equal(r.code, 0, `--actor flag-boss (over TMUX_AGENT_ACTOR=env-boss) spawn vl-both exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    r = await cli(["--socket", S, "spawn", "vl-default", "--cwd", T], env, SPAWN_MS);
    assert.equal(r.code, 0, `spawn vl-default (no actor, no parent) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.ok(existsSync(home), "test setup: the accepted spawns must have made the home");
    r = await cli(["--socket", S, "lineage"], env, SPAWN_MS);
    assert.equal(r.code, 0, `lineage exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.deepEqual(lineageOf(r.stdout, "vl-flag"), { parent: "flag-parent", owner: "flag-boss" }, "the flag values, as typed");
    assert.deepEqual(lineageOf(r.stdout, "vl-env"), { parent: "env-boss", owner: "env-boss" }, "the variable is the actor, and the parent's default");
    assert.deepEqual(lineageOf(r.stdout, "vl-both"), { parent: "flag-boss", owner: "flag-boss" }, "the flag wins over the variable");
    assert.deepEqual(lineageOf(r.stdout, "vl-default"), { parent: "cli", owner: "cli" }, "the defaults are unchanged");
    // doctor's verdicts for a valid list are unchanged: exit 0, each name judged by the engagement rule
    r = await cli(["--socket", S, "doctor", "--parent", "flag-boss,env-boss"], env, SPAWN_MS);
    assert.equal(r.code, 0, `doctor --parent flag-boss,env-boss exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.deepEqual(Object.keys(JSON.parse(r.stdout).parents.verdicts).sort(), ["env-boss", "flag-boss"], "a valid --parent list keeps its verdicts");
    // the refusals, against the SAME home and server: nothing born, no row, the live sessions untouched
    r = await cli(["--socket", S, "spawn", "vl-bad", "--cwd", T, "--parent", "not a name!"], env);
    assertRefused(r, "--parent", "not a name!", 'spawn vl-bad --parent "not a name!" (home exists, server running)');
    r = await cli(["--socket", S, "--actor", "../who", "spawn", "vl-bad", "--cwd", T], env);
    assertRefused(r, "--actor", "../who", '--actor "../who" spawn vl-bad (home exists, server running)');
    r = await cli(["--socket", S, "--actor", "../who", "kill", "vl-flag"], env);
    assertRefused(r, "--actor", "../who", '--actor "../who" kill vl-flag (home exists, server running)');
    assert.deepEqual(sessions(S).sort(), ["vl-both", "vl-default", "vl-env", "vl-flag"], `the sessions on ${S} are not exactly the four valid spawns (on e254450 vl-bad was born with the value in its lineage)`);
    assert.equal(existsSync(join(home, "logs", "vl-bad.log")), false, "a refused spawn started a capture log");
    const rows = ledger(home);
    assert.deepEqual(rows.filter((e) => e.type === "session.spawned").map((e) => e.session).sort(), ["vl-both", "vl-default", "vl-env", "vl-flag"], "session.spawned rows are not exactly the valid spawns");
    assert.deepEqual(rows.filter((e) => e.actor === "../who" || e.parent === "not a name!").map((e) => e.type), [], "a refused lineage value reached the ledger's audit envelope");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
