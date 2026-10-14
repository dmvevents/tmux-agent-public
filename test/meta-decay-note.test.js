/**
 * Census enrichment that has aged out of the live ledger window is SAID, not silently blank — `lineage` and `status`
 * print one stderr line, MCP `fleet-status` carries the same words in a second content block (TMUX-208, the C5 half).
 *
 * The rule this card keeps: `session.meta` rows are read from live day files only (TMUX-90, retention rule 2 — "an
 * archived day is out of the analytics window by definition"), so a census older than `keepDays` is gzipped under
 * ledger/archive and the rows it enriched read `-` / blank. That decay is right — a month-old verdict is not a current
 * one, and nothing here resurrects it. What no surface did was say it had applied: on the fleet host the 2026-08-25
 * census reached 0 of 31 sessions through `lineage` once its day file was archived, while the verb's own comment still
 * called census meta "the lineage source for the (typical) adopted fleet". The shape is TMUX-128's (`waste` over a
 * truncated window): ONE exported wording, the CLI behind its verb prefix on stderr, MCP in content[1] by TMUX-125's
 * additive route, stdout and exit codes untouched, and no archive ever opened — the note is computed from NAMES (the
 * archived days present, the listed sessions with no live meta).
 *
 * Black-box through the built CLI and MCP server on a quiet isolated tmux server with ONE adopted session (a bare
 * `tmux new-session`: no options, no spawn row). Each check FAILS if the property is removed (RED on 91d9233 quoted in
 * the messages):
 *   (a) CONTROL — a live census row, no archive: `lineage` prints the meta's parent and NO `lineage:` line; `status`
 *       prints no decay line; MCP `fleet-status` answers exactly ONE content block. A fix that always warns fails here.
 *   (b) THE GAP — the census row only in an archived day (gzipped as the sweep leaves it, read back to prove the plant),
 *       a live day with no meta: `lineage` prints `parent=-` for the session (the decay, pinned as the rule) and EXACTLY
 *       ONE stderr line, `lineage: ` + the note, naming 1 session and the archived day; `status` prints the same words
 *       behind `status: `; MCP `fleet-status` carries them as content[1] with content[0] still the usual reply; the
 *       lineage stdout is byte-identical to (c)'s — no row added, none changed. RED on 91d9233: no such line anywhere.
 *   (c) CONTROL — no archive and no meta: silent on every surface; the honest empty answer.
 *   (d) ONE wording: (b)'s MCP block equals (b)'s `lineage:` line minus its prefix — one exported helper, so the two
 *       surfaces cannot drift (the shape `archivedWindowNote` gave `waste`).
 *   (e) nothing is opened: an "archive" that is not valid gzip at all is counted by its name and the note is the same —
 *       the "readers see live days only" rule and the gunzip-free built reader are untouched.
 *
 * Run: npm run build && node --test test/meta-decay-note.test.js   (needs a tmux binary)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { callTool } from "./helpers/mcp-contract.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";
import { quietServer } from "./helpers/quiet-server.js";
import { killServerSync } from "./helpers/kill-server.js";

after(() => removeTempHomes());

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const BOUND_MS = 30_000;
const ARCHIVED_DAY = "2026-08-25";
const LIVE_DAY = "2026-10-01";

const socket = () => `ta-mdecay-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const metaRow = (day, session, data) => JSON.stringify({ v: 1, ts: `${day}T10:00:00.000Z`, type: "session.meta", session, data }) + "\n";
const otherRow = (day) => JSON.stringify({ v: 1, ts: `${day}T09:00:00.000Z`, type: "session.state", session: "someone-else", data: { from: "IDLE", to: "WORKING", via: "cpu" } }) + "\n";
/** A home whose ledger has a live day (with or without the census row) and, optionally, an archived day holding it. */
function home({ liveMeta, archivedMeta, garbageArchive }, session) {
  const h = tempHome("ta-mdecay-");
  const dir = join(h, "ledger");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `events-${LIVE_DAY}.ndjson`), otherRow(LIVE_DAY) + (liveMeta ? metaRow(LIVE_DAY, session, { repo: "org/lib", verdict: "KEEP", parent: "census" }) : ""));
  if (archivedMeta || garbageArchive) {
    mkdirSync(join(dir, "archive"), { recursive: true, mode: 0o700 });
    const gz = join(dir, "archive", `events-${ARCHIVED_DAY}.ndjson.gz`);
    if (garbageArchive) {
      writeFileSync(gz, Buffer.from("this is not gzip at all"), { mode: 0o600 });
    } else {
      const body = otherRow(ARCHIVED_DAY) + metaRow(ARCHIVED_DAY, session, { repo: "org/lib", verdict: "KEEP", parent: "census" });
      writeFileSync(gz, gzipSync(body), { mode: 0o600 });
      assert.equal(String(gunzipSync(readFileSync(gz))), body, "precondition: the planted archive does not read back as what was written");
    }
  }
  return h;
}
const noteLines = (stderr, verb) => stderr.split("\n").filter((l) => l.startsWith(`${verb}: `) && /census enrichment/.test(l));
const decayLines = (stderr) => stderr.split("\n").filter((l) => /census enrichment/.test(l));

/** One adopted session on a quiet server; runs `lineage`, `status` and MCP fleet-status against the given home. */
async function surfaces(S, h, session) {
  const env = { TMUX_AGENT_HOME: h, TMUX_AGENT_SOCKET: S };
  const lineage = await cli(["--socket", S, "lineage"], env);
  assert.equal(lineage.code, 0, `lineage exited ${lineage.code}: ${lineage.stderr.slice(0, 300)}`);
  const status = await cli(["--socket", S, "status"], env);
  assert.equal(status.code, 0, `status exited ${status.code}: ${status.stderr.slice(0, 300)}`);
  const mcp = await callTool("fleet-status", {}, env);
  assert.ok(Array.isArray(mcp.content) && mcp.content.length >= 1, `fleet-status answered ${JSON.stringify(mcp).slice(0, 300)}`);
  assert.notEqual(mcp.isError, true, `fleet-status answered isError: ${JSON.stringify(mcp).slice(0, 300)}`);
  const row = lineage.stdout.split("\n").find((l) => l.startsWith(`${session}\t`));
  assert.ok(row, `no lineage row for ${session}: ${JSON.stringify(lineage.stdout)}`);
  return { lineage, status, mcp, row };
}
function oneSession(S, name) {
  quietServer(S);
  execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", name, "-c", "/tmp"], { stdio: "ignore" });
}

test("census enrichment that aged out of the live window is said on lineage, status and MCP fleet-status — and only then", async () => {
  const S = socket();
  const session = `md-adopted-${process.pid}`;
  try {
    oneSession(S, session);
    // (a) control: the census row is live
    const a = await surfaces(S, home({ liveMeta: true }, session), session);
    assert.match(a.row, /\tparent=census\t/, `(a) the live census row's parent is not served: ${a.row}`);
    assert.deepEqual(decayLines(a.lineage.stderr), [], `(a) lineage warned with the census live: ${JSON.stringify(a.lineage.stderr)}`);
    assert.deepEqual(decayLines(a.status.stderr), [], `(a) status warned with the census live: ${JSON.stringify(a.status.stderr)}`);
    assert.equal(a.mcp.content.length, 1, `(a) fleet-status carries ${a.mcp.content.length} blocks with the census live`);
    // (c) control first (its stdout is (b)'s byte reference): no archive, no meta
    const c = await surfaces(S, home({}, session), session);
    assert.match(c.row, /\tparent=-\t/, `(c) a session nobody enriched should read parent=-: ${c.row}`);
    assert.deepEqual(decayLines(c.lineage.stderr), [], `(c) lineage warned with no archive at all: ${JSON.stringify(c.lineage.stderr)}`);
    assert.deepEqual(decayLines(c.status.stderr), [], `(c) status warned with no archive at all: ${JSON.stringify(c.status.stderr)}`);
    assert.equal(c.mcp.content.length, 1, `(c) fleet-status carries ${c.mcp.content.length} blocks with no archive`);
    // (b) the gap: the census row lives only in an archived day
    const b = await surfaces(S, home({ archivedMeta: true }, session), session);
    assert.match(b.row, /\tparent=-\t/, `(b) an archived census row must NOT be served (readers see live days only): ${b.row}`);
    assert.equal(b.lineage.stdout, c.lineage.stdout, "(b) the archive changed lineage's stdout — nothing parsing the rows may break");
    const bl = noteLines(b.lineage.stderr, "lineage");
    assert.equal(bl.length, 1, `(b) lineage printed ${bl.length} decay line(s), want exactly one — on 91d9233 the census aged out in silence (stderr: ${JSON.stringify(b.lineage.stderr)})`);
    assert.match(bl[0], /1 session carries no census enrichment/, `(b) the line does not count the one session: ${bl[0]}`);
    assert.match(bl[0], new RegExp(`1 archived day \\(${ARCHIVED_DAY}\\)`), `(b) the line does not name the archived day: ${bl[0]}`);
    const sl = noteLines(b.status.stderr, "status");
    assert.equal(sl.length, 1, `(b) status printed ${sl.length} decay line(s), want exactly one (stderr: ${JSON.stringify(b.status.stderr)})`);
    assert.equal(sl[0].slice("status: ".length), bl[0].slice("lineage: ".length), "(b) status and lineage do not share the one wording");
    assert.equal(b.mcp.content.length, 2, `(b) fleet-status carries ${b.mcp.content.length} block(s), want the reply plus the note`);
    assert.doesNotThrow(() => JSON.parse(b.mcp.content[0].text), "(b) content[0] is no longer the JSON reply every client parses");
    // (d) one wording
    assert.equal(b.mcp.content[1].text, bl[0].slice("lineage: ".length), "(d) the MCP note and the CLI line are two wordings of one fact");
    // (e) nothing is opened: a garbage archive is counted by its name alone
    const e = await surfaces(S, home({ garbageArchive: true }, session), session);
    const el = noteLines(e.lineage.stderr, "lineage");
    assert.equal(el.length, 1, `(e) an archive that is not gzip changed the verdict — something tried to read it (stderr: ${JSON.stringify(e.lineage.stderr)})`);
    assert.equal(el[0], bl[0], "(e) the note depends on the archive's bytes — it must come from names only");
  } finally {
    killServerSync(S);
  }
});
