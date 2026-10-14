/**
 * A policy file the tool cannot use is refused — exit 78 (EX_CONFIG) at the CLI, one line, before any verb acts, and
 * before `web` binds; the MCP server refuses to start (the TMUX-204 case in test/mcp.test.js) — never silently the
 * permissive default (TMUX-204; THREAT-MODEL finding 11).
 *
 * Measured 2026-10-13 on e757b28: `Policy`'s constructor wrapped `JSON.parse(readFileSync(p))` in one bare
 * `catch { this.cfg = {}; }`, meant for the absent default, so `{"readOnly":true,}` (a trailing comma), a directory named
 * policy.json, a file this user could not read (mode 000), a path named by TMUX_AGENT_POLICY that did not exist, a JSON
 * array, and `{"readOnly":"yes"}` each built a Policy with `isReadOnly() === false` and `explain().source === "global
 * default"` — every mutating verb open on every surface, `status`/`doctor`/`web` exit 0 with nothing on stderr about the
 * file, `policy-status` reporting a permissive default the operator never wrote. The lexicon loader has refused exactly
 * this class since TMUX-112 (`loadLexicon`, exit 78); the file THREAT-MODEL finding 1 credits with saving the live
 * instance did not. Both wave-1 reviews reproduced it offline (B1; FM-01).
 *
 * Now the permissive `{}` is installed in exactly ONE case — nothing named and the default `$TMUX_AGENT_HOME/policy.json`
 * does not exist (v0.1.0 behaviour, unchanged). Every other failure is a `PolicyError`: a read failure names the source
 * (`TMUX_AGENT_POLICY`, `default path`), the path as given and the OS reason in words, the lexicon loader's own words;
 * a content failure names the path and what is wrong — not valid JSON, not a JSON object, a `readOnly` that is not a
 * boolean, a key that is not one of the four item-5 keys (a key beginning with `_` is a note), a surface that is not
 * web/mcp/cli, an action that is not one of the five, an allow/deny entry that is not an array of strings. The CLI
 * prints `policy config error: <message>` and exits 78 on every verb; the MCP server does the same before `initialize`
 * is answered.
 *
 * TMUX-226 (measured 2026-10-13 on cd44cf1, scratch/ga-fire-2026-10-13-20Z/probe-parent-cd44cf1.log): the one silent case was
 * read too widely. A `policy.json` at the default path that is a symbolic link whose target is missing — a dotfiles or /etc
 * checkout that has moved, a mount not yet there — reads ENOENT, and the loader took every ENOENT at the default path as
 * "no file": the Policy loaded with source "global default", `status` and `doctor` exit 0 with no word about the file, the
 * MCP server answered initialize `readOnly=false`. The entry is PRESENT, so it is not the absent default. Now, on ENOENT,
 * the loader lstats the path: a link that exists is refused naming the source, the link as given and its target —
 * `default path "<home>/policy.json": cannot be read — a symbolic link to "<target>", which does not exist (ENOENT)` —
 * and the same words for a link named by TMUX_AGENT_POLICY; a link whose target exists loads as the file it points to;
 * only a default path with no entry at all is the permissive default.
 *
 * Part (a) drives the built `Policy` in-process — the rule, table-driven, both halves of every refusal. Parts (b)–(d) are
 * black-box through the built CLI like test/lexicon-unreadable.test.js: the contract is the exit code, the streams and
 * what did NOT happen; every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the suite.
 * Each line a check that FAILS if the property is removed:
 *   (a) in-process: each refused shape is a PolicyError with the message above; the absent default is still permissive;
 *       the live per-surface shape with a `_note` key still loads; a valid read-only file still refuses all five actions
 *       — RED on e757b28: no PolicyError export, every shape loaded as the permissive default;
 *   (b) `status` under each refused shape, and `status`, `doctor`, `lineage`, `exec`, `send`, `kill`, `spawn` under a
 *       malformed and a missing file → 78, one stderr line `policy config error: …`, nothing on stdout, before the verb
 *       looks for its session; no ledger row, no capture log, no tmux server started — RED on e757b28: exit 0;
 *   (c) `web --port P` under a malformed file → 78, no listener on P — RED on e757b28: served, read-only off;
 *   (d) the controls, green before and after: the absent default runs `status` (exit 0) and `doctor` reads
 *       `policy.readOnly false, source "global default"`; a valid `{"readOnly":true}` still refuses `kill` with the
 *       read-only line and a `control.denied` row carrying `reason: "read-only surface"`, and `doctor` reads it as
 *       read-only hiding all five actions;
 *   (e) TMUX-226: a `policy.json` at the default path that is a symbolic link whose target is missing, and the same link
 *       named by TMUX_AGENT_POLICY, are refused in-process with the line that names the link and its target, and `status`
 *       under that home exits 78 with it; a link whose target exists loads as the file it points to (in-process, and
 *       `doctor` reads it read-only) — RED on cd44cf1: the Policy loaded with source "global default", status exit 0.
 *
 * Run: node --test test/policy-load.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const POLICY_JS = pathToFileURL(join(ROOT, "dist", "core", "policy.js")).href;
// A refusal is one process start; a red run (the verb acting, ~1 s) still ends inside the bound.
const BOUND_MS = 5_000;
// A verb that talks to tmux or the home: status's list-sessions on an empty socket, doctor's dashboard probe.
const VERB_MS = 30_000;
const ACTIONS = ["spawn", "send", "exec", "kill", "adopt"];
const SURFACES = "web, mcp or cli";
const ACTION_LIST = "spawn, send, exec, kill or adopt";
const NOTE = 'a key beginning with "_" is a note and is ignored';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function socket() {
  return `ta-policyload-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed…" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    // this test's own environment must not be the policy, the home or the socket under test
    const clean = { ...process.env };
    delete clean.TMUX_AGENT_POLICY;
    delete clean.TMUX_AGENT_HOME;
    delete clean.TMUX_AGENT_SOCKET;
    delete clean.TMUX_AGENT_DEFAULT_SERVER;
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...clean, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
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
/** True when nothing accepts on 127.0.0.1:port (ECONNREFUSED) — a listener the refused `web` must not have opened. */
function listenerAbsent(port) {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(false); });
    s.once("error", () => resolve(true));
  });
}
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** root reads a 000 file (accessSync R_OK passes), so that case would be a false red there — the caller skips it, named. */
function canRead(p) {
  try {
    accessSync(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
/** A refusal is exit 78, nothing on stdout, exactly one stderr line `policy config error: <message>`. */
function assertRefused(r, message, label) {
  assert.equal(r.code, 78, `${label} exited ${r.code}, want 78 (EX_CONFIG) — on e757b28 the file was silently the permissive default (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  const PREFIX = "policy config error: ";
  assert.ok(lines[0].startsWith(PREFIX), `${label}: the line does not open with ${JSON.stringify(PREFIX)}: ${lines[0]}`);
  const rest = lines[0].slice(PREFIX.length);
  if (message instanceof RegExp) assert.match(rest, message, `${label}: the CLI's line names the path and the reason`);
  else assert.equal(rest, message, `${label}: the source, the path as given and the reason in words`);
}
/** The shapes a policy file can be wrong in, each with the message the loader owes for it; `p` is the file's path. */
function contentCases(p) {
  return [
    ['{"readOnly":true,}', new RegExp(`^${esc(p)}: not valid JSON — `), "a trailing comma"],
    ["[]", `${p}: expected a JSON object`, "a JSON array"],
    ["null", `${p}: expected a JSON object`, "null"],
    ['"readOnly"', `${p}: expected a JSON object`, "a JSON string"],
    ["3", `${p}: expected a JSON object`, "a number"],
    ['{"readOnly":"yes"}', `${p}: readOnly must be true or false (got "yes")`, 'readOnly "yes"'],
    ['{"readOnly":1}', `${p}: readOnly must be true or false (got 1)`, "readOnly 1"],
    ['{"readonly":true}', `${p}: unknown key "readonly" — the keys are readOnly, surfaces, allow, deny; ${NOTE}`, "readonly (the case typo)"],
    ['{"readOnly":true,"comment":"x"}', `${p}: unknown key "comment" — the keys are readOnly, surfaces, allow, deny; ${NOTE}`, "an unknown key"],
    ['{"surfaces":[]}', `${p}: surfaces must be an object keyed by surface — ${SURFACES} (got an array)`, "surfaces an array"],
    ['{"surfaces":{"dashboard":{"readOnly":true}}}', `${p}: surfaces.dashboard is not a surface — ${SURFACES}`, "a surface that does not exist"],
    ['{"surfaces":{"web":true}}', `${p}: surfaces.web must be an object (got true)`, "a surface entry that is not an object"],
    ['{"surfaces":{"web":{"readOnly":1}}}', `${p}: surfaces.web.readOnly must be true or false (got 1)`, "a surface readOnly 1"],
    ['{"surfaces":{"web":{"readonly":true}}}', `${p}: surfaces.web: unknown key "readonly" — the keys are readOnly, allow, deny; ${NOTE}`, "a surface's readonly (the case typo)"],
    ['{"allow":["*"]}', `${p}: allow must be an object keyed by action — ${ACTION_LIST} (got an array)`, "allow an array"],
    ['{"allow":{"spwan":["*"]}}', `${p}: allow.spwan is not an action — ${ACTION_LIST}`, "an action that does not exist"],
    ['{"deny":{"send":"prod-*"}}', `${p}: deny.send must be an array of session-name patterns (got "prod-*")`, "a deny entry that is a string"],
    ['{"deny":{"send":["prod-*",3]}}', `${p}: deny.send[1] must be a string (got 3)`, "a pattern that is not a string"],
    ['{"surfaces":{"mcp":{"deny":{"kill":null}}}}', `${p}: surfaces.mcp.deny.kill must be an array of session-name patterns (got null)`, "a surface deny entry that is null"],
  ];
}

test("the loader: only the absent default is silently permissive — every other failure is a PolicyError naming the source, the path as given and the reason", async (t) => {
  const mod = await import(POLICY_JS);
  const { Policy } = mod;
  assert.equal(typeof mod.PolicyError, "function", "dist/core/policy.js exports no PolicyError — on e757b28 the constructor's one bare catch installed {} for every failure, so there was nothing to name a refusal with");
  const { PolicyError, PolicyDenied } = mod;
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-policy-load-")));
  const saved = { home: process.env.TMUX_AGENT_HOME, policy: process.env.TMUX_AGENT_POLICY };
  const setEnv = (home, policy) => {
    process.env.TMUX_AGENT_HOME = home;
    if (policy === undefined) delete process.env.TMUX_AGENT_POLICY;
    else process.env.TMUX_AGENT_POLICY = policy;
  };
  const file = (name, body) => {
    const p = join(T, name);
    writeFileSync(p, body);
    return p;
  };
  const thrown = (fn) => {
    try {
      return { value: fn() };
    } catch (e) {
      return { error: e };
    }
  };
  const absentHome = join(T, "absent-home"); // never created: the default path does not exist under it
  /** Build under (home, TMUX_AGENT_POLICY) and demand a PolicyError with exactly `message` (a RegExp matches). */
  const refused = (home, policy, message, label, surface = "cli") => {
    setEnv(home, policy);
    const got = thrown(() => new Policy(undefined, surface));
    assert.ok(
      got.error instanceof PolicyError,
      `${label}: want a PolicyError, got ${got.error ? `${got.error.constructor.name}: ${got.error.message}` : `no throw — isReadOnly() ${got.value.isReadOnly()}, explain().source ${JSON.stringify(got.value.explain().source)} (the permissive default, silently)`}`,
    );
    if (message instanceof RegExp) assert.match(got.error.message, message, `${label}: the path and the reason`);
    else assert.equal(got.error.message, message, `${label}: the source, the path as given and the reason in words`);
  };
  const missing = join(T, "nope", "policy.json");
  const dir = join(T, "adir");
  mkdirSync(dir);
  const locked = file("locked.json", '{"readOnly":true}');
  chmodSync(locked, 0o000);
  const skip000 = canRead(locked);
  if (skip000) t.diagnostic("000-mode cases skipped: this user can read a 000 file (running as root?)");
  const lockedHome = join(T, "locked-home");
  mkdirSync(lockedHome);
  writeFileSync(join(lockedHome, "policy.json"), '{"readOnly":true}');
  chmodSync(join(lockedHome, "policy.json"), 0o000);
  const dirHome = join(T, "dir-home");
  mkdirSync(join(dirHome, "policy.json"), { recursive: true });
  // a symbolic link whose target is missing: the entry exists, so it is not the absent default — at the default
  // path and under the variable; and one whose target exists, which is the file it points to
  const target = join(T, "moved-dotfiles", "policy.json"); // never created
  const linkHome = join(T, "link-home");
  mkdirSync(linkHome);
  symlinkSync(target, join(linkHome, "policy.json"));
  const danglingNamed = join(T, "dangling.json");
  symlinkSync(target, danglingNamed);
  const DANGLING = `cannot be read — a symbolic link to ${JSON.stringify(target)}, which does not exist (ENOENT)`;
  const liveLinkHome = join(T, "live-link-home");
  mkdirSync(liveLinkHome);
  symlinkSync(file("linked-ro.json", '{"readOnly":true}'), join(liveLinkHome, "policy.json"));
  try {
    // the read failures: the variable's path — does not exist, set-but-empty, a directory, unreadable
    refused(absentHome, missing, `TMUX_AGENT_POLICY ${JSON.stringify(missing)}: cannot be read — no such file or directory (ENOENT)`, "TMUX_AGENT_POLICY=<missing>");
    refused(absentHome, "", 'TMUX_AGENT_POLICY "": cannot be read — no such file or directory (ENOENT)', "TMUX_AGENT_POLICY= (set, empty)");
    refused(absentHome, dir, `TMUX_AGENT_POLICY ${JSON.stringify(dir)}: cannot be read — is a directory, not a file (EISDIR)`, "TMUX_AGENT_POLICY=<a directory>");
    if (!skip000) refused(absentHome, locked, `TMUX_AGENT_POLICY ${JSON.stringify(locked)}: cannot be read — permission denied for this user (EACCES)`, "TMUX_AGENT_POLICY=<000 file>");
    // the default path: present and unreadable, or a directory, is refused — only ABSENT is the permissive default
    refused(dirHome, undefined, `default path ${JSON.stringify(join(dirHome, "policy.json"))}: cannot be read — is a directory, not a file (EISDIR)`, "$TMUX_AGENT_HOME/policy.json a directory");
    if (!skip000) refused(lockedHome, undefined, `default path ${JSON.stringify(join(lockedHome, "policy.json"))}: cannot be read — permission denied for this user (EACCES)`, "$TMUX_AGENT_HOME/policy.json present at mode 000");
    // a symbolic link whose target is missing reads ENOENT like the absent file; the entry exists, so it is refused
    refused(linkHome, undefined, `default path ${JSON.stringify(join(linkHome, "policy.json"))}: ${DANGLING}`, "$TMUX_AGENT_HOME/policy.json a symbolic link whose target is missing");
    refused(absentHome, danglingNamed, `TMUX_AGENT_POLICY ${JSON.stringify(danglingNamed)}: ${DANGLING}`, "TMUX_AGENT_POLICY=<a symbolic link whose target is missing>");
    // the content failures, through the variable and through the default path alike
    for (const [body, message, label] of contentCases(join(T, "content.json"))) {
      refused(absentHome, file("content.json", body), message, `TMUX_AGENT_POLICY=<${label}>`);
    }
    const contentHome = join(T, "content-home");
    mkdirSync(contentHome);
    for (const [body, message, label] of contentCases(join(contentHome, "policy.json"))) {
      writeFileSync(join(contentHome, "policy.json"), body);
      refused(contentHome, undefined, message, `$TMUX_AGENT_HOME/policy.json <${label}>`);
    }
    // every surface refuses alike: the file is one, the surfaces read it
    for (const surface of ["web", "mcp", "cli"]) {
      refused(absentHome, file("surface.json", '{"readOnly":"yes"}'), `${join(T, "surface.json")}: readOnly must be true or false (got "yes")`, `surface ${surface}`, surface);
    }
    // the controls: the absent default is permissive, source "global default" (v0.1.0 behaviour, unchanged)
    setEnv(absentHome, undefined);
    const open = new Policy(undefined, "web");
    assert.equal(open.isReadOnly(), false, "the absent default is no longer permissive — the one silent case must stay silent");
    assert.equal(open.explain().source, "global default", "the absent default no longer reads as the global default");
    assert.equal(existsSync(absentHome), false, "building a Policy created the home — the loader must read, never write");
    // a symbolic link whose target exists is the file it points to (TMUX-226's control: a dotfiles checkout that IS there)
    setEnv(liveLinkHome, undefined);
    assert.equal(new Policy(undefined, "cli").isReadOnly(), true, "a symbolic link to a readable read-only file no longer loads as that file");
    // a valid read-only file still refuses all five actions with the read-only reason
    setEnv(absentHome, file("ro.json", '{"readOnly":true}'));
    const ro = new Policy(undefined, "cli");
    assert.equal(ro.isReadOnly(), true, "a valid {\"readOnly\":true} no longer reads as read-only");
    for (const a of ACTIONS) {
      const got = thrown(() => ro.assertAllowed(a, "x", "tester"));
      assert.ok(got.error instanceof PolicyDenied && got.error.reason === "read-only surface", `a read-only policy no longer refuses ${a}: ${got.error?.message ?? "no throw"}`);
    }
    // the per-surface shape as a live home carries it, with a `_note` key beside the rules: loads, web read-only, cli open
    const live = file("live.json", JSON.stringify({ surfaces: { web: { readOnly: true }, mcp: { readOnly: false }, cli: { readOnly: false } }, _note: "the dashboard observes only; MCP and the CLI are the writers" }));
    setEnv(absentHome, live);
    assert.equal(new Policy(undefined, "web").isReadOnly(), true, "the per-surface live shape no longer makes web read-only");
    assert.equal(new Policy(undefined, "web").explain().source, "surfaces.web", "the per-surface live shape no longer names surfaces.web as its source");
    assert.equal(new Policy(undefined, "cli").isReadOnly(), false, "the per-surface live shape made the CLI read-only");
    // allow/deny lists load and keep their meaning
    setEnv(absentHome, file("lists.json", JSON.stringify({ allow: { kill: ["worker-*"] }, deny: { send: ["prod-*"] }, surfaces: { mcp: { deny: { exec: ["*"] } } } })));
    const lists = new Policy(undefined, "cli");
    lists.assertAllowed("kill", "worker-3", "t");
    assert.ok(thrown(() => lists.assertAllowed("kill", "prod-db", "t")).error instanceof PolicyDenied, "a valid allow-list no longer scopes kill");
    assert.ok(thrown(() => lists.assertAllowed("send", "prod-web", "t")).error instanceof PolicyDenied, "a valid deny-list no longer refuses send");
    lists.assertAllowed("exec", "anything", "t");
    assert.ok(thrown(() => new Policy(undefined, "mcp").assertAllowed("exec", "anything", "t")).error instanceof PolicyDenied, "a valid per-surface deny-list no longer refuses exec on mcp");
    // a config object handed to the constructor is taken as before: no file is read for it
    setEnv(absentHome, file("ignored.json", "{ not json"));
    assert.equal(new Policy({ readOnly: true }, "cli").isReadOnly(), true, "an explicit cfg object no longer bypasses the file");
  } finally {
    if (saved.home === undefined) delete process.env.TMUX_AGENT_HOME;
    else process.env.TMUX_AGENT_HOME = saved.home;
    if (saved.policy === undefined) delete process.env.TMUX_AGENT_POLICY;
    else process.env.TMUX_AGENT_POLICY = saved.policy;
    chmodSync(locked, 0o600);
    chmodSync(join(lockedHome, "policy.json"), 0o600);
    rmSync(T, { recursive: true, force: true });
  }
});

test("a policy file the tool cannot use is refused with exit 78 on every verb and before web binds — nothing acts, nothing is ledgered, no server starts", async (t) => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-policy-cli-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const missing = join(T, "nope", "policy.json");
  const dir = join(T, "adir");
  mkdirSync(dir);
  const locked = join(T, "locked.json");
  writeFileSync(locked, '{"readOnly":true}');
  chmodSync(locked, 0o000);
  const skip000 = canRead(locked);
  if (skip000) t.diagnostic("000-mode case skipped: this user can read a 000 file (running as root?)");
  const bad = join(T, "bad.json");
  writeFileSync(bad, '{"readOnly":true,}');
  const badLine = new RegExp(`^${esc(bad)}: not valid JSON — `);
  const dirHome = join(T, "dir-home");
  mkdirSync(join(dirHome, "policy.json"), { recursive: true });
  const badHome = join(T, "bad-home");
  mkdirSync(badHome);
  writeFileSync(join(badHome, "policy.json"), '{"readOnly":"yes"}');
  const target = join(T, "moved-dotfiles", "policy.json"); // never created
  const linkHome = join(T, "link-home"); // the default path a symbolic link whose target is missing
  mkdirSync(linkHome);
  symlinkSync(target, join(linkHome, "policy.json"));
  try {
    // (b) every shape on status — the verb the card names — each refusal its own line
    const shapes = [
      [{ TMUX_AGENT_POLICY: missing }, `TMUX_AGENT_POLICY ${JSON.stringify(missing)}: cannot be read — no such file or directory (ENOENT)`, "TMUX_AGENT_POLICY=<missing>"],
      [{ TMUX_AGENT_POLICY: dir }, `TMUX_AGENT_POLICY ${JSON.stringify(dir)}: cannot be read — is a directory, not a file (EISDIR)`, "TMUX_AGENT_POLICY=<a directory>"],
      ...(skip000 ? [] : [[{ TMUX_AGENT_POLICY: locked }, `TMUX_AGENT_POLICY ${JSON.stringify(locked)}: cannot be read — permission denied for this user (EACCES)`, "TMUX_AGENT_POLICY=<000 file>"]]),
      [{ TMUX_AGENT_POLICY: bad }, badLine, "TMUX_AGENT_POLICY=<trailing comma>"],
      ...contentCases(join(T, "content.json")).map(([body, message, label]) => [{ TMUX_AGENT_POLICY: join(T, "content.json"), __body: body }, message, `TMUX_AGENT_POLICY=<${label}>`]),
      [{ TMUX_AGENT_HOME: dirHome }, `default path ${JSON.stringify(join(dirHome, "policy.json"))}: cannot be read — is a directory, not a file (EISDIR)`, "$TMUX_AGENT_HOME/policy.json a directory"],
      [{ TMUX_AGENT_HOME: badHome }, `${join(badHome, "policy.json")}: readOnly must be true or false (got "yes")`, "$TMUX_AGENT_HOME/policy.json readOnly \"yes\""],
      [{ TMUX_AGENT_HOME: linkHome }, `default path ${JSON.stringify(join(linkHome, "policy.json"))}: cannot be read — a symbolic link to ${JSON.stringify(target)}, which does not exist (ENOENT)`, "$TMUX_AGENT_HOME/policy.json a symbolic link whose target is missing"],
    ];
    for (const [extra, message, label] of shapes) {
      const { __body, ...vars } = extra;
      if (__body !== undefined) writeFileSync(join(T, "content.json"), __body);
      const r = await cli(["--socket", S, "status"], { ...env, ...vars });
      assertRefused(r, message, `${label} status`);
    }
    // every verb, including the ones that would otherwise look for a session that does not exist: the policy is judged first
    const verbs = [["status"], ["doctor"], ["lineage"], ["exec", "polu-never", "true"], ["send", "polu-never", "echo hi"], ["kill", "polu-never"], ["spawn", "polu-never", "--cwd", T]];
    for (const [extra, message, label] of [
      [{ TMUX_AGENT_POLICY: bad }, badLine, "TMUX_AGENT_POLICY=<trailing comma>"],
      [{ TMUX_AGENT_POLICY: missing }, `TMUX_AGENT_POLICY ${JSON.stringify(missing)}: cannot be read — no such file or directory (ENOENT)`, "TMUX_AGENT_POLICY=<missing>"],
    ]) {
      for (const verb of verbs) {
        const r = await cli(["--socket", S, ...verb], { ...env, ...extra });
        assertRefused(r, message, `${label} ${verb.join(" ")}`);
      }
    }
    // (c) web: refused before the port is bound — no listener, no banner
    const port = 20000 + Math.floor(Math.random() * 20000);
    const w = await cli(["--socket", S, "web", "--port", String(port), "--no-token"], { ...env, TMUX_AGENT_POLICY: bad });
    assertRefused(w, badLine, `TMUX_AGENT_POLICY=<trailing comma> web --port ${port} --no-token`);
    assert.equal(await listenerAbsent(port), true, `web under a refused policy left a listener on 127.0.0.1:${port}`);
    // nothing acted under the unloaded rules: no ledger row, no capture log, no server on the socket
    assert.deepEqual(ledger(home), [], "a refused policy still ledgered something");
    assert.equal(existsSync(join(home, "logs")) ? readdirSync(join(home, "logs")).length : 0, 0, "a refused policy started a capture log");
    assert.ok(serverAbsent(S), `a refusal started a tmux server on ${S}`);
    // (d) the controls: the absent default is permissive and runs; a valid read-only file still refuses the mutating verbs
    let r = await cli(["--socket", S, "status"], env, VERB_MS);
    assert.equal(r.code, 0, `status with the absent default exited ${r.code}: ${r.stderr.slice(0, 200)} — the absent default must stay permissive`);
    r = await cli(["--socket", S, "doctor"], env, VERB_MS);
    assert.equal(r.code, 0, `doctor with the absent default exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    let d = JSON.parse(r.stdout);
    assert.equal(d.policy.readOnly, false, "doctor reads the absent default as read-only");
    assert.equal(d.policy.source, "global default", `doctor names ${JSON.stringify(d.policy.source)} as the absent default's source`);
    const ro = join(T, "ro.json");
    writeFileSync(ro, '{"readOnly":true}');
    r = await cli(["--socket", S, "doctor"], { ...env, TMUX_AGENT_POLICY: ro }, VERB_MS);
    assert.equal(r.code, 0, `doctor under a valid read-only file exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    d = JSON.parse(r.stdout);
    assert.equal(d.policy.readOnly, true, "doctor does not read a valid {\"readOnly\":true} as read-only");
    assert.deepEqual([...d.policy.hiddenActions].sort(), [...ACTIONS].sort(), "a valid read-only file no longer hides all five actions");
    // a symbolic link whose target exists is the file it points to (TMUX-226's control): doctor reads the linked file as read-only
    const liveLinkHome = join(T, "live-link-home");
    mkdirSync(liveLinkHome);
    symlinkSync(ro, join(liveLinkHome, "policy.json"));
    r = await cli(["--socket", S, "doctor"], { TMUX_AGENT_HOME: liveLinkHome }, VERB_MS);
    assert.equal(r.code, 0, `doctor under a default-path link to a valid read-only file exited ${r.code}: ${r.stderr.slice(0, 200)} — a working link must load as the file it points to`);
    assert.equal(JSON.parse(r.stdout).policy.readOnly, true, "doctor does not read a default-path link to a valid {\"readOnly\":true} as read-only");
    r = await cli(["--socket", S, "kill", "polu-never"], { ...env, TMUX_AGENT_POLICY: ro }, VERB_MS);
    assert.notEqual(r.code, 0, "kill under a valid read-only policy exited 0");
    assert.notEqual(r.code, 78, "kill under a VALID read-only policy was refused as a config error — the file is valid, the verb is what read-only refuses");
    assert.match(r.stderr, /read-only/, `kill under a valid read-only policy did not say read-only: ${r.stderr.slice(0, 200)}`);
    const denied = ledger(home).filter((e) => e.type === "control.denied" && e.data?.action === "kill");
    assert.equal(denied.length, 1, `one control.denied row for the read-only kill, got ${denied.length}: ${JSON.stringify(ledger(home)).slice(0, 300)}`);
    assert.equal(denied[0].data.reason, "read-only surface", `the refusal's reason: ${JSON.stringify(denied[0].data)}`);
    assert.ok(serverAbsent(S), `the controls started a tmux server on ${S} — status and doctor on an empty socket must not`);
  } finally {
    killServerSync(S);
    chmodSync(locked, 0o600);
    rmSync(T, { recursive: true, force: true });
  }
});
