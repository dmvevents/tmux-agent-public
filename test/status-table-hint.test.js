/**
 * The `status` table cuts each session's last line at 80 characters; when it does, one stderr line says so and names
 * where the whole value is — status.json (TMUX-212; the cold-start rehearsal's fourth stumble: "status truncates the
 * column at ~80 chars with no pointer to the full value").
 *
 * Measured 2026-10-13 on 3ebb7a8 / 396cb03: `console.log(... ${s.lastLine.slice(0, 80)})` with nothing beside it — a
 * long last line (a path, a command, an error) simply ended mid-word, and the only way to learn the file held the rest
 * was to read the source. The cut is right (a table is for a glance); the silence about it is what the rehearsal hit.
 *
 * Each check FAILS if the property is removed (RED on 396cb03 quoted in the messages). On a real isolated tmux server:
 *   (1) a pane whose last line is longer than 80 characters → the table line ends after 80 of them and stderr carries
 *       ONE line `status: the table cuts each last line at 80 characters — status.json holds them whole` beside the
 *       `status.json → <file>` line — RED on 396cb03: no such line;
 *   (2) the control: a pane whose last line is short → the table line carries it whole and NO hint is printed — a hint
 *       printed always would be noise, not disclosure;
 *   (3) the file holds the whole line (the pointer points at something true).
 *
 * Run: npm run build && node --test test/status-table-hint.test.js   (needs a tmux binary)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";
import { quietServer } from "./helpers/quiet-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const BOUND_MS = 30_000;
const HINT = /^status: the table cuts each last line at 80 characters — status\.json holds them whole$/m;
const LONG = `marker-${"L".repeat(100)}-end`; // 111 characters: a last line the table must cut

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
const tmuxRaw = (sock, args) => execFileSync("tmux", ["-L", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/** The pane's last non-empty line, as the monitor reads it. */
function lastLine(sock, name) {
  const lines = tmuxRaw(sock, ["capture-pane", "-p", "-J", "-t", `=${name}:`]).split("\n").map((l) => l.trimEnd()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}
/** Paint `text` as the pane's last line and wait until the pane shows it last and has stopped changing. */
async function paint(sock, name, text) {
  tmuxRaw(sock, ["send-keys", "-t", `=${name}:`, `clear; printf '${text} '; sleep 60`, "Enter"]);
  let prev = null;
  for (let i = 0; i < 60; i++) {
    const cur = tmuxRaw(sock, ["capture-pane", "-p", "-J", "-t", `=${name}:`]);
    if (cur === prev && lastLine(sock, name) === text) return;
    prev = cur;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`test setup: ${name}'s last line never settled on the plant; pane ends: ${JSON.stringify(lastLine(sock, name))}`);
}

test("status: a last line longer than 80 characters is cut in the table and ONE stderr line points at status.json; a short one is printed whole with no hint", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-sthint-")));
  const home = join(T, "home");
  const S = `ta-sthint-${process.pid}`;
  const long = `sth-long-${process.pid}`;
  const short = `sth-short-${process.pid}`;
  try {
    quietServer(S);
    tmuxRaw(S, ["new-session", "-d", "-s", long, "-x", "200", "-y", "40"]);
    await paint(S, long, LONG);
    // (1) the cut and the hint
    let r = await cli(["--socket", S, "status", "--json", join(T, "a.json")], { TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `status exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    const row = r.stdout.split("\n").find((l) => l.startsWith(`${long}\t`));
    assert.ok(row, `no table row for ${long}: ${r.stdout.slice(0, 200)}`);
    const cell = row.split("\t").at(-1);
    assert.equal(cell, LONG.slice(0, 80), `the table's last column is not the first 80 characters: ${JSON.stringify(cell)}`);
    assert.match(r.stderr, HINT, `no hint that the column was cut (on 396cb03 the line ended mid-word in silence): ${JSON.stringify(r.stderr.slice(0, 300))}`);
    assert.equal(r.stderr.split("\n").filter((l) => HINT.test(l)).length, 1, "the hint is printed more than once");
    assert.match(r.stderr, /^status\.json → /m, "the status.json → line must still name the file");
    // (3) the pointer points at something true
    const rec = JSON.parse(readFileSync(join(T, "a.json"), "utf8")).sessions.find((s) => s.session === long);
    assert.ok(rec, "status.json has no record for the session");
    assert.ok(String(rec.lastLine).includes(LONG), `status.json does not hold the whole last line: ${JSON.stringify(rec.lastLine)}`);
    // (2) the control: a short last line, no hint
    tmuxRaw(S, ["kill-session", "-t", `=${long}`]);
    tmuxRaw(S, ["new-session", "-d", "-s", short, "-x", "200", "-y", "40"]);
    await paint(S, short, "short-marker");
    r = await cli(["--socket", S, "status", "--json", join(T, "b.json")], { TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `status (control) exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, new RegExp(`^${short}\\t.*\\tshort-marker$`, "m"), `the short last line is not printed whole: ${r.stdout.slice(0, 200)}`);
    assert.doesNotMatch(r.stderr, HINT, "the hint was printed although nothing was cut");
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
