/**
 * `tmux-agent help [verb]` and `tmux-agent --help` answer from SHAPES and VALUE_FORMS — the data the CLI already holds
 * to refuse a bad call — on stdout, exit 0, before anything is constructed (TMUX-212; the cold-start's first point of
 * confusion).
 *
 * Measured 2026-10-13 by two independent cold-start rehearsals on 3ebb7a8 / e757b28: a stranger whose port 7337 was
 * taken ran `tmux-agent --help` and got the usage line on stderr, exit 64 — `usage: tmux-agent <spawn|…|web> ... (see
 * source header)` — and found `--port` only by grepping the planning docs; no flag reference existed anywhere a user could
 * reach, and `--help` was the one flag judgeFlags let through, to that same refusal. The CLI holds every verb's shape
 * (SHAPES) and every value flag's form in the words its refusal uses (VALUE_FORMS); `help` prints them.
 *
 * Each check FAILS if the property is removed (RED on 396cb03 quoted in the messages):
 *   (1) `help` → exit 0, stdout one usage line per verb — the set of verbs printed equals the verbs the binary
 *       dispatches (`case "x":` labels in dist/bin/tmux-agent.js), both directions — nothing on stderr;
 *   (2) `help web` → exit 0, the verb's usage line, then one line per flag it takes with the flag's form in the
 *       refusal's words (`--port  a port between 1 and 65535`); `help spawn` names --cwd, --cmd, --parent, --task;
 *   (3) `--help` (the stranger's path) → exit 0 and the same text as `help`, stdout;
 *   (4) `help nosuch` → exit 64, one stderr line naming the verb and listing the real ones, nothing on stdout;
 *       `help spawn extra` → exit 64 (one verb at a time);
 *   (5) nothing is touched: a TMUX_AGENT_HOME that does not exist still does not exist afterwards, and no tmux
 *       server is started on the socket named — help answers before the home, the ledger or tmux.
 *
 * Run: npm run build && node --test test/help.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const BOUND_MS = 10_000;

function cli(args, env = {}) {
  return new Promise((resolve) => {
    const clean = { ...process.env };
    delete clean.TMUX_AGENT_SOCKET;
    delete clean.TMUX_AGENT_DEFAULT_SERVER;
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...clean, ...env }, timeout: BOUND_MS, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${BOUND_MS} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** The verbs the binary dispatches — the same observable the versioning and README contracts read. */
function dispatched() {
  const bin = readFileSync(BIN, "utf8");
  return [...new Set([...bin.matchAll(/^\s*case "([a-z]+)":/gm)].map((m) => m[1]))].sort();
}
/** The verbs a help text names: the first word after `tmux-agent` on every usage line (`msg send` counts as msg). */
function namedBy(stdout) {
  return [...new Set([...stdout.matchAll(/^\s*tmux-agent ([a-z]+)/gm)].map((m) => m[1]))].sort();
}
function serverAbsent(sock) {
  try {
    execFileSync("tmux", ["-L", sock, "list-sessions"], { stdio: ["ignore", "pipe", "pipe"] });
    return false;
  } catch (e) {
    return /no server running|error connecting/.test(String(e.stderr));
  }
}

test("(1) `help` lists one usage line per dispatched verb on stdout, exit 0 — the set equals the binary's verb switch both ways", async () => {
  const r = await cli(["help"]);
  assert.equal(r.code, 0, `help exited ${r.code}, want 0 — on 396cb03 it was the usage line on stderr and exit 64 (stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stderr, "", `help wrote to stderr: ${r.stderr}`);
  const named = namedBy(r.stdout);
  assert.deepEqual(named, dispatched(), `help names ${JSON.stringify(named)}; the binary dispatches ${JSON.stringify(dispatched())}`);
});

test("(2) `help <verb>` prints that verb's usage and each of its flags with the form the refusal uses", async () => {
  let r = await cli(["help", "web"]);
  assert.equal(r.code, 0, `help web exited ${r.code}: ${r.stderr.slice(0, 200)}`);
  assert.match(r.stdout, /^\s*tmux-agent web \[--port 7337\] \[--host 127\.0\.0\.1\]/m, `help web lacks web's usage line: ${r.stdout}`);
  assert.match(r.stdout, /--port\s+a port between 1 and 65535/, `help web does not explain --port in the refusal's words: ${r.stdout}`);
  assert.match(r.stdout, /--host\s+a host address, such as 127\.0\.0\.1/, `help web does not explain --host: ${r.stdout}`);
  assert.equal(namedBy(r.stdout).join(","), "web", `help web named other verbs: ${namedBy(r.stdout)}`);
  r = await cli(["help", "spawn"]);
  assert.equal(r.code, 0, `help spawn exited ${r.code}: ${r.stderr.slice(0, 200)}`);
  for (const f of ["cwd", "cmd", "parent", "task"]) assert.match(r.stdout, new RegExp(`--${f}\\s+\\S`), `help spawn does not explain --${f}: ${r.stdout}`);
  assert.match(r.stdout, /--cwd\s+a directory/, "help spawn: --cwd's form");
  // the global flags every verb takes are listed once, so a stranger finds --socket and --default-server here too
  assert.match(r.stdout, /--socket\s+a tmux socket name/, `help spawn does not list the global --socket: ${r.stdout}`);
});

test("(3) `--help` is `help`: exit 0, the same text on stdout", async () => {
  const [a, b] = await Promise.all([cli(["--help"]), cli(["help"])]);
  assert.equal(a.code, 0, `--help exited ${a.code}, want 0 — on 396cb03 the stranger got exit 64 and 'see source header' (stderr: ${JSON.stringify(a.stderr.slice(0, 160))})`);
  assert.equal(a.stderr, "", `--help wrote to stderr: ${a.stderr}`);
  assert.equal(a.stdout, b.stdout, "--help and help print different texts");
});

test("(4) `help nosuch` and `help spawn extra` are refused: exit 64, one stderr line, nothing on stdout", async () => {
  let r = await cli(["help", "nosuch"]);
  assert.equal(r.code, 64, `help nosuch exited ${r.code}, want 64`);
  assert.equal(r.stdout, "", "help nosuch printed on stdout");
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `one line: ${r.stderr}`);
  assert.match(lines[0], /^help: no such verb "nosuch" \(the verbs are: .*\) — tmux-agent help \[verb\]$/, `the line names the verb, lists the real ones and ends with help's own usage: ${lines[0]}`);
  for (const v of dispatched()) assert.ok(lines[0].includes(v), `the refusal does not list ${v}: ${lines[0]}`);
  r = await cli(["help", "spawn", "extra"]);
  assert.equal(r.code, 64, `help spawn extra exited ${r.code}, want 64 (one verb at a time)`);
  assert.equal(r.stdout, "", "help spawn extra printed on stdout");
});

test("(5) help touches nothing: no home is created, no tmux server is started", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-help-")));
  const home = join(T, "never-home");
  const sock = `ta-help-${process.pid}`;
  try {
    for (const args of [["help"], ["--help"], ["help", "status"], ["--socket", sock, "help", "web"]]) {
      const r = await cli(args, { TMUX_AGENT_HOME: home });
      assert.equal(r.code, 0, `${args.join(" ")} exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    }
    assert.equal(existsSync(home), false, "help created the home");
    assert.ok(serverAbsent(sock), `help started a tmux server on ${sock}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});
