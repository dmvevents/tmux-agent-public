/**
 * The tmux server's death reaches the surface that answers "who owns whom" (TMUX-127, gate G3 "failure modes
 * observable").
 *
 * TMUX-87/115/116/117 taught seven pull surfaces to say whether the tmux server is reachable in tmux's own words —
 * `status`'s stderr line, `status.json.tmux`, `/api/fleet.tmux`, `/api/health.tmux`, `doctor.dashboard.tmux`, MCP
 * `fleet-status` and `watch`'s exit-2 reason — and TMUX-119 added the inverse guard that an ALIVE server with zero
 * sessions must not read as a dead one. The lineage surface went through none of that series, and it is the one a
 * supervising agent reads FIRST. Measured 2026-09-18 on the pushed 2515d02 dist
 * (scratch/ga-fire-2026-09-18-06Z/lineage-probe/{probe.sh,probe-2515d02.log}): an alive-with-zero-sessions server and
 * a polled-until-GONE one answered lineage BYTE-IDENTICALLY — CLI rc 0 with 0 bytes of stdout and an empty stderr,
 * the socket named 0 times; MCP `{"content":[{"type":"text","text":"[]"}]}`, one block, isError false — while
 * `status.json.tmux` read true vs false across the same two states. `Orchestrator.lineage()` was
 * `tmux.listSessions()`, whose catch turns "no server" into `[]` on purpose (nickgnd#9), and the MCP tool was
 * `run: () => orch.lineage()` and nothing else.
 *
 * The contract, measured against REAL tmux on a throwaway socket and home (the operator's fleet is never touched —
 * the value under test IS tmux's own wording, which no fake can be trusted to reproduce):
 *   (a) CONTROL, one live session: the CLI prints its row and NO `lineage:` line; MCP answers exactly ONE block
 *       whose array holds it. A fix that always warns fails here.
 *   (b) CONTROL, a server ALIVE with zero sessions (TMUX-119's recipe: `exit-empty off`, the last session killed,
 *       the state ASSERTED via `display-message -p '#{version}'` — a run whose server did not survive FAILS rather
 *       than skips): the CLI's stderr carries no `lineage:` line, and MCP answers exactly ONE block, `[]`.
 *   (c) the server killed and POLLED until tmux itself says "no server" (kill-server is not synchronous —
 *       TMUX-116): the CLI exits 0 with the same empty stdout as (b) — nothing that parses rows breaks — plus
 *       exactly ONE stderr line, naming the socket and tmux's own words; MCP answers TWO blocks, isError false,
 *       `content[0].text` byte-identical to (b)'s `[]`, the second naming the socket.
 *   (d) ONE wording: (c)'s MCP note is byte-identical to (c)'s CLI line minus its `lineage: ` prefix, and to what
 *       `status` prints on the same dead socket minus its own `status: ` prefix. One exported helper
 *       (`serverGoneNote`), so the three surfaces cannot drift into three phrasings of one fact.
 *   (e) the tool surface is unchanged: the same 13 tool names, and `list-lineage` still among them.
 * Every CLI run is bounded so a red cannot hang the suite.
 *
 * FAIL-first on the parent ca66835 dist (scratch/ga-fire-2026-09-18-08Z/red-parent-ca66835.log): (c) "the CLI said
 * nothing about a dead server: stderr """ — with (a) and (b) green in the same run, and the parent's own lineage
 * cases (test/lineage-name.test.js, test/mcp.test.js) green beside them.
 *
 * Run: node --test test/lineage-tmux-down.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { callTool, toolsList } from "./helpers/mcp-contract.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** A lineage read on a dead or empty server is one process start and a couple of tmux calls that answer at once. */
const BOUND_MS = 15_000;
/** A run that reaches a live server: a spawn (new-session, the hasSession poll, set-option, pipe-pane). */
const LIVE_MS = 25_000;
/** The 13 tools the surface has advertised since TMUX-107 — this card adds none (VERSIONING item 5). */
const TOOL_COUNT = 13;

function socket() {
  return `ta-lin-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed…" when the bound fired — a hang, not an answer. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Raw tmux, rc and its own words together — the wording is the evidence, so it is never thrown away. */
function tmuxRaw(sock, args) {
  try {
    return { rc: 0, out: String(execFileSync("tmux", ["-L", sock, ...args], { stdio: ["ignore", "pipe", "pipe"] })).trim() };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim() };
  }
}
/** True when no tmux server exists on the socket at all — not "no sessions", the server itself is not there. */
function serverAbsent(sock) {
  const { rc, out } = tmuxRaw(sock, ["list-sessions"]);
  return rc !== 0 && /no server running|error connecting/.test(out);
}
/** The FIXTURE kill — raw, so the dead server's socket file stays for the "no server running on <path>" words the cases read; the teardown is killServerSync(). */
function killServer(sock) {
  tmuxRaw(sock, ["kill-server"]);
}
/**
 * `kill-server` returns before the server has finished exiting — on one CI cell of run 35123625508 the very next
 * `list-sessions` still reached it. A dead server is the state under test, so wait for it, bounded.
 */
async function untilServerAbsent(sock, ms = 5000) {
  const t0 = Date.now();
  while (!serverAbsent(sock)) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}
/**
 * (b)'s state: one server, zero sessions, still alive. `exit-empty off` is set while a session still holds the
 * server up (the option cannot be set on a server that is not there) — TMUX-119's recipe. Returns the version tmux
 * answered with, the proof the server survived; a server that did not survive fails here rather than skipping.
 */
function emptyLiveServer(sock) {
  const name = `linkeep-${process.pid}`;
  execFileSync("tmux", ["-L", sock, "new-session", "-d", "-s", name, "-c", "/tmp"], { stdio: "ignore" });
  execFileSync("tmux", ["-L", sock, "set-option", "-g", "exit-empty", "off"], { stdio: "ignore" });
  execFileSync("tmux", ["-L", sock, "kill-session", "-t", `=${name}`], { stdio: "ignore" });
  const version = tmuxRaw(sock, ["display-message", "-p", "#{version}"]);
  assert.equal(
    version.rc,
    0,
    `precondition: the server on ${sock} did not survive its last session (display-message rc=${version.rc}: ${JSON.stringify(version.out)}) ` +
      "— the live-but-session-less state was never set up, so (b) would not be a test of it (exit-empty off is required; the host default kills the empty server)",
  );
  const sessions = tmuxRaw(sock, ["list-sessions", "-F", "#{session_name}"]);
  assert.equal(sessions.out, "", `precondition: the server must have ZERO sessions (got ${JSON.stringify(sessions.out)})`);
  return version.out;
}
/** The `lineage:` lines of a CLI stderr — the verdict only, never the noise a verb prints beside it. */
function verdictLines(stderr) {
  return stderr.split("\n").filter((l) => l.startsWith("lineage: "));
}

test("lineage carries the tmux server's verdict: a polled-until-GONE server is one stderr line and a second MCP block in tmux's own words, while a live server — with sessions or with none — is neither, and the rows and exit code are unchanged", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-lin-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: S };
  const name = `lin-${process.pid}`;
  try {
    assert.ok(serverAbsent(S), `the throwaway socket ${S} already has a server`);

    // (a) CONTROL: one live session — the row prints, the array has it, and nothing warns
    const sp = await cli(["--socket", S, "spawn", name, "--cwd", "/tmp", "--parent", "lin-test", "--task", "lineage"], env, LIVE_MS);
    assert.equal(sp.code, 0, `spawn exited ${sp.code}: ${sp.stderr.slice(0, 300)}`);
    const a = await cli(["--socket", S, "lineage"], env, LIVE_MS);
    assert.equal(a.code, 0, `(a) lineage on a live socket exited ${a.code}: ${a.stderr.slice(0, 300)}`);
    assert.match(a.stdout, new RegExp(`^${name}\tparent=lin-test\t`, "m"), `(a) the row for the live session is missing: ${JSON.stringify(a.stdout)}`);
    assert.deepEqual(verdictLines(a.stderr), [], `(a) a live server with a session was called unreachable: ${JSON.stringify(a.stderr)}`);
    const aMcp = await callTool("list-lineage", {}, { ...env });
    assert.equal(aMcp.isError, undefined, `(a) list-lineage on a live socket is an error: ${JSON.stringify(aMcp)}`);
    assert.equal(aMcp.content.length, 1, `(a) a live server with a session carries no note — blocks: ${JSON.stringify(aMcp.content)}`);
    const aRows = JSON.parse(aMcp.content[0].text);
    assert.ok(Array.isArray(aRows) && aRows.some((r) => r.name === name), `(a) the array is not the fleet: ${aMcp.content[0].text.slice(0, 200)}`);

    // (b) CONTROL: the server ALIVE with zero sessions — the state TMUX-119 exists for
    killServer(S);
    assert.ok(await untilServerAbsent(S), "kill-server left a server on the socket before (b) was set up");
    const version = emptyLiveServer(S);
    assert.match(version, /^\d/, `(b) precondition: display-message answered ${JSON.stringify(version)}, not a version`);
    const b = await cli(["--socket", S, "lineage"], env, LIVE_MS);
    assert.equal(b.code, 0, `(b) lineage on a live-but-empty socket exited ${b.code}: ${b.stderr.slice(0, 300)}`);
    assert.equal(b.stdout, "", `(b) no rows on a server with no sessions: ${JSON.stringify(b.stdout)}`);
    assert.deepEqual(verdictLines(b.stderr), [], `(b) a server that answered display-message ${version} was called unreachable — the TMUX-119 regression: ${JSON.stringify(b.stderr)}`);
    const bMcp = await callTool("list-lineage", {}, { ...env });
    assert.equal(bMcp.content.length, 1, `(b) an alive server with zero sessions must carry exactly one block — blocks: ${JSON.stringify(bMcp.content)}`);
    assert.equal(bMcp.content[0].text, "[]", `(b) the empty tree's bytes: ${JSON.stringify(bMcp.content[0].text)}`);

    // (c) the same socket after kill-server, polled until tmux itself says the server is gone
    killServer(S);
    assert.ok(await untilServerAbsent(S), "kill-server left a server on the socket after 5 s");
    const c = await cli(["--socket", S, "lineage"], env);
    assert.equal(c.code, 0, `(c) lineage on a dead socket exited ${c.code} — the exit code is unchanged (VERSIONING item 1): ${c.stderr.slice(0, 300)}`);
    assert.equal(c.stdout, b.stdout, `(c) stdout must be what an empty fleet prints, byte for byte: ${JSON.stringify([c.stdout, b.stdout])}`);
    const cLines = verdictLines(c.stderr);
    assert.equal(cLines.length, 1, `(c) the CLI said nothing about a dead server, or said it twice — stderr: ${JSON.stringify(c.stderr)} (on ca66835: rc 0, stdout 0 bytes, stderr "")`);
    assert.ok(cLines[0].includes(S), `(c) the line does not name the socket: ${JSON.stringify(cLines[0])}`);
    assert.match(cLines[0], /no server running on .*\//, `(c) the line must carry tmux's OWN words, not our paraphrase: ${JSON.stringify(cLines[0])}`);
    assert.ok(serverAbsent(S), "(c) a lineage read on a dead socket started a tmux server");
    const cMcp = await callTool("list-lineage", {}, { ...env });
    assert.equal(cMcp.isError, undefined, `(c) the note is additive, not an error: ${JSON.stringify(cMcp)}`);
    assert.equal(cMcp.content.length, 2, `(c) a dead server must carry the array AND exactly one note — blocks: ${JSON.stringify(cMcp.content)} (on ca66835: one block, "[]")`);
    assert.equal(cMcp.content[0].text, bMcp.content[0].text, `(c) content[0] must be byte-identical to the live-empty answer every client already parses: ${JSON.stringify([cMcp.content[0].text, bMcp.content[0].text])}`);
    assert.ok(cMcp.content[1].text.includes(S), `(c) the note does not name the socket: ${JSON.stringify(cMcp.content[1].text)}`);

    // (d) ONE wording: the MCP note, this verb's line and `status`'s line are one string behind three prefixes
    const note = cMcp.content[1].text;
    assert.equal(note, cLines[0].slice("lineage: ".length), `(d) the MCP note and the CLI's line for one dead server must be one wording: ${JSON.stringify([note, cLines[0]])}`);
    const st = await cli(["--socket", S, "status"], env);
    const stLine = st.stderr.split("\n").find((l) => l.startsWith("status: ")) ?? "";
    assert.equal(stLine.slice("status: ".length), note, `(d) lineage must print what status prints, not a second phrasing of it: ${JSON.stringify([stLine, note])}`);

    // (e) the tool surface itself is unchanged — no new tool carries the verdict
    const tools = await toolsList({ ...env });
    assert.equal(tools.length, TOOL_COUNT, `(e) the tool count changed: ${tools.sort().join(", ")}`);
    assert.ok(tools.includes("list-lineage"), `(e) list-lineage is gone from tools/list: ${tools.sort().join(", ")}`);
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
