/**
 * A lexicon the operator NAMED and the tool cannot read is refused — exit 78 (EX_CONFIG) at the CLI, one line, before
 * any verb acts; the MCP server refuses to start (test/mcp.test.js) — never silently the shipped defaults (TMUX-112;
 * gates G2 the lexicon header calls silent non-redaction "the reason this is a GA blocker", G1 0 tests named a lexicon
 * that was named and cannot be read, G6 the header, README:178 and VERSIONING item 1 said "a malformed lexicon" and "no
 * lexicon file means the defaults" with no word for a named file that is not there).
 *
 * Measured 2026-09-15 22:2xZ on 85d3ba7 and again 2026-09-16 00:2xZ on bc8b2ea (scratch/ga-fire-2026-09-16-00Z/
 * lexicon-probe/probe-bc8b2ea.log, supplement-bc8b2ea.log): loadLexicon wrapped readFileSync in one bare
 * `catch { return {}; }`, meant for the absent default, so `--lexicon <probe>/nope/lex.json status`,
 * `TMUX_AGENT_LEXICON=<the same> status`, `--lexicon <a directory> status` and `--lexicon <a 000 file> status` each
 * exited 0 with the fleet printed and the defaults in force — watch, exec, calibrate alike — while a file that was not
 * JSON was refused (78, one line) and doctor alone read `"loaded": false`, exit 0. The consequence, with one redact
 * rule PRB-[a-z0-9]{12} → [PRB-REDACTED]: readable, `exec vp-ok "echo PRB-aaaaaaaaaaaa"` printed [PRB-REDACTED] and
 * the exec.done row held "echo [PRB-REDACTED]"; the same file at mode 000, exec printed PRB-bbbbbbbbbbbb and the row
 * held it plain, send's input.sent preview "echo PRB-cccccccccccc" plain, TMUX_AGENT_LEXICON on a missing path alike;
 * 0 ledger rows about the lexicon.
 *
 * Black-box through the built CLI like test/spawn-cwd.test.js: the contract is the exit code, the streams and what did
 * NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the suite. Each
 * line a check that FAILS if the property is removed:
 *   (a) --lexicon on a path that does not exist, on a directory, on a 000-mode file (skipped, named, when this user can
 *       read one — root), and TMUX_AGENT_LEXICON on the missing path → 78, one stderr line
 *       `lexicon config error: <source> "<path as given>": cannot be read — <reason in words> (<code>)`, nothing on
 *       stdout — status, doctor, calibrate, watch, exec and send alike, before the verb looks for its session; no ledger
 *       row, no capture log, no tmux server started — RED on bc8b2ea: exit 0, the fleet printed, doctor's loaded:false;
 *   (b) the redaction property, the load-bearing case: with the rule file readable, exec NAME "echo PRB-…" prints
 *       [PRB-REDACTED] and the exec.done row holds "echo [PRB-REDACTED]"; with the same file at mode 000, and via
 *       TMUX_AGENT_LEXICON on a missing path, exec and send refuse with 78 and NO ledger row holds the plain shape —
 *       the ledger grep is the check — and the text never reached the pane — RED on bc8b2ea: exit 0, the rows plain;
 *   (c) the controls, green before and after: a readable --lexicon FILE loads (doctor.lexicon.loaded true), the absent
 *       default is the shipped vocabulary (doctor and status exit 0, the session listed), and a file that is not JSON
 *       is still 78 with its own one line;
 *   (d) TMUX-226 (measured 2026-10-13 on cd44cf1, scratch/ga-fire-2026-10-13-20Z/probe-parent-cd44cf1.log): a lexicon.json
 *       at the default path that is a symbolic link whose target is missing reads ENOENT, and the loader took every ENOENT
 *       at the default path as the absent file — the shipped vocabulary, the operator's redact rules not applied, exit 0.
 *       The entry is present, so it is refused on every verb with the line that names the link and its target —
 *       `default path "<home>/lexicon.json": cannot be read — a symbolic link to "<target>", which does not exist (ENOENT)`
 *       — and the same words for a link named by --lexicon; a link whose target exists loads as the file it points to
 *       (doctor.lexicon.loaded true) — RED on cd44cf1: exit 0, doctor loaded:false.
 *
 * Run: node --test test/lexicon-unreadable.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
// A refusal is one process start; a red run (the verb acting, ~1 s) still ends inside the bound.
const BOUND_MS = 5_000;
// A spawn that is meant to succeed: new-session, the hasSession poll, set-option, pipe-pane.
const SPAWN_MS = 20_000;
// A verb that talks to the pane (exec's wait-for, doctor's dashboard probe, status's capture).
const VERB_MS = 30_000;

function socket() {
  return `ta-lexunread-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
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
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** The pane's text as tmux holds it (raw — redaction is on the served path, never here). */
function pane(sock, name) {
  try {
    return execFileSync("tmux", ["-L", sock, "capture-pane", "-p", "-t", `=${name}:`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}
/** Two identical non-empty captures 500 ms apart: the shell has drawn its prompt and stopped (test/smoke.sh wait_quiet). */
async function paneSettled(sock, name) {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const cur = pane(sock, name);
    if (cur.trim() && cur === prev) return true;
    prev = cur;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
/**
 * exec, re-tried while the TUI guard still names the host's pty wrapper as the pane's foreground (kiro-cli-term on the
 * dev host while the nested shell is still starting — TMUX-97/99): a bounded wait for the prompt, not a timed shot.
 */
async function execAtPrompt(args, env) {
  let r;
  for (let i = 0; i < 12; i++) {
    r = await cli(args, env, VERB_MS);
    if (r.code === 0 || !/foreground process/.test(r.stderr)) return r;
    await new Promise((res) => setTimeout(res, 500));
  }
  return r;
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
/** A refusal is exit 78, nothing on stdout, exactly one stderr line: the source, the path as given, the reason in words. */
function assertRefused(r, source, p, reason, label) {
  assert.equal(r.code, 78, `${label} exited ${r.code}, want 78 (EX_CONFIG) — on bc8b2ea the named lexicon was silently the defaults (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `lexicon config error: ${source} ${JSON.stringify(p)}: cannot be read — ${reason}`, `${label}: the source, the path as given and the OS reason in words`);
}

test("a --lexicon / TMUX_AGENT_LEXICON path the tool cannot read is refused with exit 78 on every verb, before anything acts", async (t) => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-lexunread-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const missing = join(T, "nope", "lex.json");
  const locked = join(T, "locked.json");
  writeFileSync(locked, '{"version":1}');
  chmodSync(locked, 0o000);
  const skip000 = canRead(locked);
  if (skip000) t.diagnostic("000-mode case skipped: this user can read a 000 file (running as root?)");
  const ok = join(T, "ok.json");
  writeFileSync(ok, '{"version":1}');
  const bad = join(T, "bad.json");
  writeFileSync(bad, "{ not json");
  // a symbolic link whose target is missing: named, and at the default path under its own home
  const target = join(T, "moved-dotfiles", "lex.json"); // never created
  const dangling = join(T, "dangling.json");
  symlinkSync(target, dangling);
  const linkHome = join(T, "link-home");
  mkdirSync(linkHome);
  symlinkSync(target, join(linkHome, "lexicon.json"));
  const DANGLING = `a symbolic link to ${JSON.stringify(target)}, which does not exist (ENOENT)`;
  const cases = [
    [["--lexicon", missing], {}, "--lexicon", missing, "no such file or directory (ENOENT)", "--lexicon <missing>"],
    [[], { TMUX_AGENT_LEXICON: missing }, "TMUX_AGENT_LEXICON", missing, "no such file or directory (ENOENT)", "TMUX_AGENT_LEXICON=<missing>"],
    [["--lexicon", T], {}, "--lexicon", T, "is a directory, not a file (EISDIR)", "--lexicon <a directory>"],
    ...(skip000 ? [] : [[["--lexicon", locked], {}, "--lexicon", locked, "permission denied for this user (EACCES)", "--lexicon <000 file>"]]),
    [["--lexicon", dangling], {}, "--lexicon", dangling, DANGLING, "--lexicon <a symbolic link whose target is missing>"],
    [[], { TMUX_AGENT_HOME: linkHome }, "default path", join(linkHome, "lexicon.json"), DANGLING, "$TMUX_AGENT_HOME/lexicon.json a symbolic link whose target is missing"],
  ];
  // every verb, including the ones that would otherwise look for a session that does not exist: the lexicon is judged first
  const verbs = [["status"], ["doctor"], ["calibrate"], ["watch", "lexu-never", "--idle-secs", "1"], ["exec", "lexu-never", "true"], ["send", "lexu-never", "echo hi"]];
  try {
    for (const [flags, extra, source, p, reason, label] of cases) {
      for (const verb of verbs) {
        const r = await cli(["--socket", S, ...flags, ...verb], { ...env, ...extra });
        assertRefused(r, source, p, reason, `${label} ${verb.join(" ")}`);
      }
    }
    // nothing acted under the unloaded rule set: no ledger row, no capture log, no server on the socket
    assert.deepEqual(ledger(home), [], "a refused lexicon still ledgered something");
    assert.deepEqual(ledger(linkHome), [], "a refused default-path link still ledgered something under its home");
    assert.equal(existsSync(join(home, "logs")) ? readdirSync(join(home, "logs")).length : 0, 0, "a refused lexicon started a capture log");
    assert.ok(serverAbsent(S), `a refusal started a tmux server on ${S}`);
    // (c) the controls: a readable named file loads; the absent default is the shipped vocabulary; not-JSON is still 78
    let r = await cli(["--socket", S, "--lexicon", ok, "doctor"], env, VERB_MS);
    assert.equal(r.code, 0, `doctor --lexicon <readable> exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(JSON.parse(r.stdout).lexicon.loaded, true, "a readable --lexicon FILE no longer loads");
    r = await cli(["--socket", S, "doctor"], env, VERB_MS);
    assert.equal(r.code, 0, `doctor with the absent default exited ${r.code}: ${r.stderr.slice(0, 200)} — the absent default must stay the shipped vocabulary`);
    assert.equal(JSON.parse(r.stdout).lexicon.loaded, false, "the absent default reads as loaded");
    // a symbolic link whose target exists is the file it points to (TMUX-226's control): the linked lexicon loads
    const liveLinkHome = join(T, "live-link-home");
    mkdirSync(liveLinkHome);
    symlinkSync(ok, join(liveLinkHome, "lexicon.json"));
    r = await cli(["--socket", S, "doctor"], { TMUX_AGENT_HOME: liveLinkHome }, VERB_MS);
    assert.equal(r.code, 0, `doctor under a default-path link to a readable lexicon exited ${r.code}: ${r.stderr.slice(0, 200)} — a working link must load as the file it points to`);
    assert.equal(JSON.parse(r.stdout).lexicon.loaded, true, "a default-path link to a readable lexicon no longer loads as that file");
    r = await cli(["--socket", S, "--lexicon", bad, "status"], env);
    assert.equal(r.code, 78, `--lexicon <not JSON> status exited ${r.code}, want 78 (the control that was already refused on bc8b2ea)`);
    assert.equal(r.stdout, "", "--lexicon <not JSON> status wrote to stdout");
    const lines = r.stderr.trim().split("\n");
    assert.equal(lines.length, 1, `--lexicon <not JSON>: one line, not a stack trace: ${r.stderr}`);
    assert.match(lines[0], /^lexicon config error: .*bad\.json: not valid JSON — /, `--lexicon <not JSON>: its own line, unchanged: ${lines[0]}`);
  } finally {
    killServerSync(S);
    chmodSync(locked, 0o600);
    rmSync(T, { recursive: true, force: true });
  }
});

test("the redaction property: a readable rule file redacts exec's command in the ledger; the same file unreadable refuses the verb and no row holds the plain shape", async (t) => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-lexredact-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const rule = join(T, "rule.json");
  writeFileSync(rule, JSON.stringify({ version: 1, redact: [{ name: "probe-shape", pattern: "PRB-[a-z0-9]{12}", replacement: "[PRB-REDACTED]" }] }));
  const missing = join(T, "nope", "lex.json");
  const name = `lexu-${process.pid}`;
  const PLAIN = /PRB-[a-z0-9]{12}/;
  try {
    let r = await cli(["--socket", S, "spawn", name, "--cwd", T, "--parent", "lexu-test"], env, SPAWN_MS);
    assert.equal(r.code, 0, `spawn ${name} exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.ok(await paneSettled(S, name), "test setup: the spawned pane never settled at a prompt");
    // the control: readable, the rule applies to exec's stdout and to the exec.done row
    r = await execAtPrompt(["--socket", S, "--lexicon", rule, "exec", name, "echo PRB-aaaaaaaaaaaa"], env);
    assert.equal(r.code, 0, `exec under the readable rule file exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /\[PRB-REDACTED\]/, `the readable rule did not apply to exec's output: ${r.stdout}`);
    assert.doesNotMatch(r.stdout, PLAIN, `the plain shape reached exec's stdout under a readable rule: ${r.stdout}`);
    const done = ledger(home).filter((e) => e.type === "exec.done");
    assert.equal(done.length, 1, `one exec.done row for the control, got ${done.length}`);
    assert.equal(done[0].data.command, "echo [PRB-REDACTED]", `the exec.done row does not hold the redacted command: ${JSON.stringify(done[0].data)}`);
    // the absent default: the session is listed, exit 0 — the control for "absent stays the shipped vocabulary"
    r = await cli(["--socket", S, "status"], env, VERB_MS);
    assert.equal(r.code, 0, `status with the absent default exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, new RegExp(`^${name}\\t`, "m"), `status did not list ${name}: ${r.stdout.slice(0, 200)}`);
    // the same file at mode 000, and the variable on a missing path: refused, nothing typed, nothing ledgered
    chmodSync(rule, 0o000);
    const skip000 = canRead(rule);
    if (skip000) t.diagnostic("000-mode half skipped: this user can read a 000 file (running as root?); the missing-path half still runs");
    const attempts = [
      ...(skip000
        ? []
        : [
            [["--lexicon", rule], {}, "--lexicon", rule, "permission denied for this user (EACCES)", "exec", "echo PRB-bbbbbbbbbbbb"],
            [["--lexicon", rule], {}, "--lexicon", rule, "permission denied for this user (EACCES)", "send", "echo PRB-cccccccccccc"],
          ]),
      [[], { TMUX_AGENT_LEXICON: missing }, "TMUX_AGENT_LEXICON", missing, "no such file or directory (ENOENT)", "exec", "echo PRB-dddddddddddd"],
      [[], { TMUX_AGENT_LEXICON: missing }, "TMUX_AGENT_LEXICON", missing, "no such file or directory (ENOENT)", "send", "echo PRB-eeeeeeeeeeee"],
    ];
    for (const [flags, extra, source, p, reason, verb, text] of attempts) {
      r = await cli(["--socket", S, ...flags, verb, name, text], { ...env, ...extra });
      assertRefused(r, source, p, reason, `${verb} ${name} "${text}" under ${source}=${p}`);
    }
    await new Promise((res) => setTimeout(res, 500)); // a send that DID reach the pane would have echoed by now
    const rows = ledger(home);
    const leaked = rows.filter((e) => PLAIN.test(JSON.stringify(e)));
    assert.deepEqual(leaked, [], `ledger rows hold the shape in plain text (on bc8b2ea the exec.done and input.sent rows did): ${JSON.stringify(leaked).slice(0, 400)}`);
    assert.equal(rows.filter((e) => e.type === "exec.done").length, 1, "a refused exec still produced an exec.done row");
    const text = pane(S, name);
    for (const shape of ["PRB-bbbbbbbbbbbb", "PRB-cccccccccccc", "PRB-dddddddddddd", "PRB-eeeeeeeeeeee"]) {
      assert.equal(text.includes(shape), false, `a refused verb still typed ${shape} into the pane`);
    }
  } finally {
    chmodSync(rule, 0o600);
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
