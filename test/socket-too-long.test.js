/**
 * A `--socket` name whose path is longer than a Unix socket allows is a third shape of "the server did not answer", and
 * is reported as the other two are — `status: tmux server UNREACHABLE on <socket> — <tmux's words>`, exit 0, the fact
 * riding status.json — never tmux's raw error with exit 1 (TMUX-212; the cold-start rehearsal's second stumble).
 *
 * Measured 2026-10-13 by the cold-start rehearsal on 3ebb7a8 and reproduced on 396cb03: under a 113-character socket
 * path (`tmux -L` places the file under /tmp/tmux-<uid>/, and a deep TMUX_TMPDIR pushes the path past the 108-byte
 * limit) `status` printed tmux's own `list-sessions failed … error connecting to … (File name too long)` and exited 1
 * with no status.json line, against README's promise of one UNREACHABLE stderr line and exit 0 — which ENOENT ("No
 * such file or directory") and a killed server ("no server running") already kept. isNoServer() (src/core/tmux.ts)
 * matched only those two.
 *
 * Each check FAILS if the property is removed (RED on 396cb03 quoted in the messages):
 *   (1) `status --json FILE` under a 120-character socket name → exit 0, the UNREACHABLE line whose words are tmux's
 *       (`File name too long`), status.json written with tmux.reachable false and the same words in tmux.error,
 *       sessions [] — on 396cb03: exit 1, no file;
 *   (2) `watch X --idle-secs 1` under it → exit 2 with its own UNREACHABLE line; `lineage` → exit 0 with its line;
 *   (3) the controls, green before and after: ENOENT (a socket no server ever ran on) still reads UNREACHABLE and exit
 *       0, and a socket name the rule refuses (`a b`) is still exit 64 — the new shape joins the two, it replaces neither.
 *
 * Run: npm run build && node --test test/socket-too-long.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const BOUND_MS = 20_000;
/** A name the socket rule accepts ([A-Za-z0-9._-], 1 or more) whose path cannot fit a sockaddr_un. */
const LONG = `ta-toolong-${"x".repeat(110)}`;

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
const UNREACHABLE = (verb, sock) => new RegExp(`^${verb}: tmux server UNREACHABLE on ${sock} — (.+)$`, "m");

test("(1) status under a socket name whose path is too long: UNREACHABLE on stderr in tmux's words, exit 0, status.json carries reachable:false", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-toolong-")));
  const home = join(T, "home");
  const file = join(T, "status.json");
  try {
    const r = await cli(["--socket", LONG, "status", "--json", file], { TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `status exited ${r.code}, want 0 — on 396cb03 tmux's raw error and exit 1 (stderr: ${JSON.stringify(r.stderr.slice(0, 200))})`);
    assert.equal(r.stdout, "", `no fleet lines for an unreachable server: ${JSON.stringify(r.stdout)}`);
    const line = r.stderr.match(UNREACHABLE("status", LONG));
    assert.ok(line, `stderr lacks the UNREACHABLE line naming the socket: ${JSON.stringify(r.stderr.slice(0, 300))}`);
    assert.match(line[1], /File name too long/, `the line's words are not tmux's: ${line[1]}`);
    assert.match(r.stderr, /^status\.json → /m, "the status.json → line is missing — the fact must ride the file");
    assert.ok(existsSync(file), "status.json was not written");
    const s = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(s.tmux.reachable, false, "status.json.tmux.reachable is not false");
    assert.match(String(s.tmux.error), /File name too long/, `status.json.tmux.error: ${s.tmux.error}`);
    assert.deepEqual(s.sessions, [], "sessions must be empty for a server that did not answer");
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("(2) watch and lineage under the same socket report it the same way: watch exit 2 with its line, lineage exit 0 with its line", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-toolong2-")));
  const home = join(T, "home");
  try {
    const w = await cli(["--socket", LONG, "watch", "toolong-never", "--idle-secs", "1"], { TMUX_AGENT_HOME: home });
    assert.equal(w.code, 2, `watch exited ${w.code}, want 2 (gone/dead) — on 396cb03 the driver's raw error`);
    assert.match(w.stderr, UNREACHABLE("watch", LONG), `watch's stderr lacks its UNREACHABLE line: ${JSON.stringify(w.stderr.slice(0, 300))}`);
    const l = await cli(["--socket", LONG, "lineage"], { TMUX_AGENT_HOME: home });
    assert.equal(l.code, 0, `lineage exited ${l.code}, want 0: ${l.stderr.slice(0, 200)}`);
    assert.match(l.stderr, UNREACHABLE("lineage", LONG), `lineage's stderr lacks its UNREACHABLE line: ${JSON.stringify(l.stderr.slice(0, 300))}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("(3) controls: ENOENT still reads UNREACHABLE / exit 0, and a name the rule refuses is still exit 64", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-toolong3-")));
  const home = join(T, "home");
  const never = `ta-toolong-never-${process.pid}`;
  try {
    const a = await cli(["--socket", never, "status", "--json", join(T, "never.json")], { TMUX_AGENT_HOME: home });
    assert.equal(a.code, 0, `status on a never-started socket exited ${a.code}: ${a.stderr.slice(0, 200)}`);
    assert.match(a.stderr, UNREACHABLE("status", never), "the ENOENT shape no longer reads UNREACHABLE");
    const b = await cli(["--socket", "a b", "status"], { TMUX_AGENT_HOME: home });
    assert.equal(b.code, 64, `a socket name the rule refuses exited ${b.code}, want 64`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});
