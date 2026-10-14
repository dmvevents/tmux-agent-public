/**
 * An answer computed over a TRUNCATED window says so — `waste` and MCP `waste-report` (TMUX-128,
 * gate G3 "failure modes observable" on the tool's own analytics).
 *
 * TMUX-90 bound the ledger's footprint by gzip-archiving a day file older than `keepDays` to
 * `ledger/archive/events-YYYY-MM-DD.ndjson.gz` — never deleting — and made one deliberate rule:
 * readers see LIVE days only, so an archived day is out of the analytics window by definition. That
 * rule is right and this card does not touch it. What no surface did was say it had applied.
 * TMUX-103 taught this same verb that a window it cannot READ is refused, never silently ignored
 * (`--since yesterday` exits 64 naming the flag) — so the verb refused a window it could not parse
 * and silently mis-answered a window whose data it had declined to open. Measured 2026-09-18 on the
 * pushed 98032f7 dist (scratch/ga-fire-2026-09-18-10Z/waste-probe/{probe.sh,probe-98032f7.log}):
 * on a home with 0 live day files and 1 archived day, `waste` and `waste --since <that day>` both
 * answered rc 0, stdout 0 bytes, stderr 0 bytes — byte-identical to a home with an empty ledger and
 * no archive at all, the words `archive`, `window` and the day's own date occurring 0 times in every
 * answer; MCP answered `{"content":[{"type":"text","text":"[]"}]}`, one block, isError false, to
 * both. Plain `doctor` on that very home printed `"archiveFiles": 1, "archiveBytes": 177` beside
 * `"files": 0` — the verdict was already computed one surface over.
 *
 * The contract, each case a check that FAILS if the property is removed (throwaway homes, planted
 * archives read back with gunzipSync, every CLI run bounded so a red cannot hang the suite):
 *   (a) CONTROL, live days and NO archive: the CLI prints its rows and NO `waste:` line; MCP answers
 *       exactly ONE block. A fix that always warns fails here.
 *   (b) CONTROL, `--since` strictly AFTER the newest archived day with that archive present: no
 *       `waste:` line — those days are outside the window the caller asked for.
 *   (c) THE GAP: a home with 0 live days and 2 archived days. rc stays 0 and stdout is byte-identical
 *       to the empty home's (nothing that parses stdout breaks), plus EXACTLY ONE stderr line naming
 *       how many archived days were excluded and their oldest→newest range. RED on the parent, which
 *       printed nothing at all.
 *   (d) the window that NAMES one archived day (`--since 2026-08-04T00:00:00Z`, the newer of the two)
 *       excludes the older: the line counts ONE day and names that day — an all-or-nothing filter fails.
 *   (e) MCP additively, by TMUX-125's route: TWO content blocks, `content[0].text` byte-identical to
 *       the empty home's `[]`, `isError` still false.
 *   (f) (iii) live days AND an archive, no `--since`: the line IS printed and stdout is byte-identical
 *       to (a)'s rows — no row added, none reordered.
 *   (g) TMUX-103's refusal is untouched: `--since yesterday` on the archive home still exits 64 with
 *       its one `--since:` line and NO note (a window that was never read cannot be reported on).
 *   (h) ONE wording: (c)'s MCP note is byte-identical to (c)'s CLI line minus its `waste: ` prefix —
 *       one exported helper, the shape `unknownAgentNote()` gave the mailbox and
 *       `serverGoneNote()` the fleet, so the two surfaces cannot drift.
 *   (i) no archive is ever READ: the built reader carries no gunzip/zlib at all — the note counts the
 *       names present under archive/, it does not decompress them. test/ledger-retention.test.js's
 *       "readers see live days only" case passes unmodified and is what reds if a fix starts reading
 *       archives instead of naming them.
 *   (j) the tool surface is unchanged: the same 13 tool names, `waste-report` still among them.
 *
 * FAIL-first on the parent d94e0ba dist (scratch/ga-fire-2026-09-18-12Z/red-parent-d94e0ba.log).
 *
 * Run: node --test test/waste-archived-window.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { callTool, toolsList } from "./helpers/mcp-contract.js";
import { plantTwoDays, ALL_SESSIONS } from "./helpers/waste-fixture.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** A waste read is one process start over a handful of small files — it answers at once or it is broken. */
const BOUND_MS = 20_000;
/** The 13 tools the surface has advertised since TMUX-107 — this card adds none (VERSIONING item 5). */
const TOOL_COUNT = 13;
/** Two archived days, older than the fixture's live days (2026-09-12/13) so no window can confuse them. */
const ARCHIVED = ["2026-08-03", "2026-08-04"];
/** Strictly after the newer archived day ends: (b)'s window, which those days are genuinely outside of. */
const AFTER_ARCHIVE = "2026-08-05T00:00:00Z";
/** Names the NEWER archived day only — (d)'s window, which the older day is outside of. */
const NAMES_NEWER = "2026-08-04T00:00:00Z";

/** No tmux server is ever reached by this verb; the name is a throwaway so a stray call cannot find the fleet. */
const SOCKET = `ta-warch-${process.pid}`;

function listing(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * 5 events for a session that exists only in history, 2 of them errors — gzipped exactly as a
 * retention sweep leaves it, then read back with gunzipSync so a mis-planted run FAILS
 * here rather than passing as "nothing in the window".
 */
function plantArchive(ledgerDir, days) {
  mkdirSync(join(ledgerDir, "archive"), { recursive: true, mode: 0o700 });
  for (const day of days) {
    const session = `ghost-${day}`;
    const rows = [
      [`${day}T04:00:01.000Z`, "session.spawned", { cwd: "/tmp" }],
      [`${day}T04:00:02.000Z`, "control.denied", { action: "kill", reason: "read-only surface" }],
      [`${day}T04:00:03.000Z`, "session.state", { from: "WORKING", to: "ERROR", via: "cpu" }],
      [`${day}T04:00:04.000Z`, "exec.timeout", { id: "x", timeoutMs: 1000, elapsedMs: 1002, command: "sleep 5" }],
      [`${day}T04:00:05.000Z`, "input.sent", { bytes: 4 }],
    ];
    const body = rows.map(([ts, type, data]) => JSON.stringify({ v: 1, ts, type, session, actor: "fixture", data })).join("\n") + "\n";
    const gz = join(ledgerDir, "archive", `events-${day}.ndjson.gz`);
    writeFileSync(gz, gzipSync(body), { mode: 0o600 });
    assert.equal(String(gunzipSync(readFileSync(gz))), body, `precondition: the planted archive ${day} does not read back as what was written`);
  }
}

/** A home with the ledger layout each case needs, its preconditions ASSERTED before anything reads it. */
function home(root, label, { live, archive }) {
  const h = join(root, label);
  const ledger = join(h, "ledger");
  mkdirSync(ledger, { recursive: true });
  if (live) plantTwoDays(ledger);
  if (archive) plantArchive(ledger, archive);
  const liveFiles = listing(ledger).filter((f) => f.endsWith(".ndjson"));
  const archives = listing(join(ledger, "archive")).filter((f) => f.endsWith(".ndjson.gz"));
  assert.equal(liveFiles.length, live ? 2 : 0, `precondition ${label}: live day files are ${JSON.stringify(liveFiles)}`);
  assert.equal(archives.length, archive ? archive.length : 0, `precondition ${label}: archived days are ${JSON.stringify(archives)}`);
  return h;
}

/** { code, stdout, stderr }; code is the string "killed…" when the bound fired — a hang, not an answer. */
function cli(h, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, "waste", ...args],
      { cwd: ROOT, env: { ...process.env, TMUX_AGENT_HOME: h, TMUX_AGENT_SOCKET: SOCKET }, timeout: BOUND_MS, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        resolve({ code: err ? (err.killed ? `killed after ${BOUND_MS} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
/** The verb's own verdict lines — never the noise anything else may print beside them. */
function noteLines(stderr) {
  return stderr.split("\n").filter((l) => l.startsWith("waste: "));
}
const mcp = (h) => callTool("waste-report", {}, { TMUX_AGENT_HOME: h, TMUX_AGENT_SOCKET: SOCKET });

test("waste over a truncated window says so: archived days inside the window asked for are counted and dated on stderr and in a second MCP block, while a home with no archive — or a window past it — is silent, and the rows, stdout bytes and exit code are unchanged", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-warch-")));
  try {
    const liveOnly = home(T, "live-only", { live: true, archive: null });
    const empty = home(T, "empty", { live: false, archive: null });
    const archiveOnly = home(T, "archive-only", { live: false, archive: ARCHIVED });
    const both = home(T, "live-and-archive", { live: true, archive: ARCHIVED });

    // (a) CONTROL: live days, no archive — the rows print and nothing warns
    const a = await cli(liveOnly, []);
    assert.equal(a.code, 0, `(a) waste on a live-only home exited ${a.code}: ${a.stderr.slice(0, 300)}`);
    assert.deepEqual(
      a.stdout.trim().split("\n").map((l) => l.split("\t")[0]),
      ALL_SESSIONS,
      `(a) the planted rows are not what printed: ${JSON.stringify(a.stdout)}`,
    );
    assert.deepEqual(noteLines(a.stderr), [], `(a) a home with no archive at all was told its window was truncated: ${JSON.stringify(a.stderr)}`);
    const aMcp = await mcp(liveOnly);
    assert.equal(aMcp.content.length, 1, `(a) a home with no archive carries no note — blocks: ${JSON.stringify(aMcp.content)}`);

    // (b) CONTROL: a window strictly after the newest archived day — those days are outside it
    const b = await cli(both, ["--since", AFTER_ARCHIVE]);
    assert.equal(b.code, 0, `(b) waste --since ${AFTER_ARCHIVE} exited ${b.code}: ${b.stderr.slice(0, 300)}`);
    assert.deepEqual(
      noteLines(b.stderr),
      [],
      `(b) archived days ending before --since ${AFTER_ARCHIVE} are outside the window the caller asked for, so there is nothing to report: ${JSON.stringify(b.stderr)}`,
    );

    // the empty home is the answer (c) must stay byte-identical to on stdout
    const e = await cli(empty, []);
    assert.equal(e.code, 0, `waste on an empty home exited ${e.code}: ${e.stderr.slice(0, 300)}`);
    assert.equal(e.stdout, "", `an empty ledger prints no rows: ${JSON.stringify(e.stdout)}`);
    assert.deepEqual(noteLines(e.stderr), [], `an empty home with no archive has nothing to report: ${JSON.stringify(e.stderr)}`);
    const eMcp = await mcp(empty);
    assert.equal(eMcp.content.length, 1, `an empty home carries exactly one block: ${JSON.stringify(eMcp.content)}`);
    assert.equal(eMcp.content[0].text, "[]", `the empty answer's bytes: ${JSON.stringify(eMcp.content[0].text)}`);

    // (c) THE GAP: 0 live days, 2 archived days inside the window
    const c = await cli(archiveOnly, []);
    assert.equal(c.code, 0, `(c) waste on an archived-history home exited ${c.code} — the exit code is unchanged (VERSIONING item 1): ${c.stderr.slice(0, 300)}`);
    assert.equal(c.stdout, e.stdout, `(c) stdout must be byte-identical to the empty home's — no row is invented: ${JSON.stringify([c.stdout, e.stdout])}`);
    const cLines = noteLines(c.stderr);
    assert.equal(
      cLines.length,
      1,
      `(c) the verb said nothing about the ${ARCHIVED.length} archived days it did not read, or said it twice — stderr: ${JSON.stringify(c.stderr)} (on 98032f7: rc 0, stdout 0 bytes, stderr 0 bytes, identical to an empty ledger)`,
    );
    assert.match(cLines[0], /\b2 archived days\b/, `(c) the line must say HOW MANY days were excluded: ${JSON.stringify(cLines[0])}`);
    assert.ok(
      cLines[0].includes(`${ARCHIVED[0]}→${ARCHIVED[1]}`),
      `(c) the line must date the range it excluded, oldest→newest: ${JSON.stringify(cLines[0])}`,
    );
    assert.equal(cLines[0].trim().split("\n").length, 1, `(c) one line, not a stack trace: ${JSON.stringify(cLines[0])}`);

    // (d) a window that names the NEWER archived day excludes the older one — the filter is per day
    const d = await cli(archiveOnly, ["--since", NAMES_NEWER]);
    assert.equal(d.code, 0, `(d) waste --since ${NAMES_NEWER} exited ${d.code}: ${d.stderr.slice(0, 300)}`);
    assert.equal(d.stdout, e.stdout, `(d) stdout must still be the empty answer: ${JSON.stringify(d.stdout)}`);
    const dLines = noteLines(d.stderr);
    assert.equal(dLines.length, 1, `(d) a window naming an archived day on disk must be reported: ${JSON.stringify(d.stderr)}`);
    assert.match(dLines[0], /\b1 archived day\b/, `(d) only the day inside --since ${NAMES_NEWER} counts, not both: ${JSON.stringify(dLines[0])}`);
    assert.ok(dLines[0].includes(ARCHIVED[1]), `(d) the line must name the day it excluded: ${JSON.stringify(dLines[0])}`);
    assert.ok(!dLines[0].includes(ARCHIVED[0]), `(d) the older day is outside this window and must not be claimed: ${JSON.stringify(dLines[0])}`);

    // (e) MCP additively (TMUX-125's route): the array's bytes unchanged, the verdict in a second block
    const cMcp = await mcp(archiveOnly);
    assert.equal(cMcp.isError, undefined, `(e) the note is additive, not an error: ${JSON.stringify(cMcp)}`);
    assert.equal(
      cMcp.content.length,
      2,
      `(e) an archived-history home must carry the array AND exactly one note — blocks: ${JSON.stringify(cMcp.content)} (on 98032f7: one block, "[]")`,
    );
    assert.equal(
      cMcp.content[0].text,
      eMcp.content[0].text,
      `(e) content[0] must be byte-identical to the answer every client already parses: ${JSON.stringify([cMcp.content[0].text, eMcp.content[0].text])}`,
    );

    // (f) live days AND an archive: the note is printed and the rows are untouched
    const f = await cli(both, []);
    assert.equal(f.code, 0, `(f) waste on a live+archive home exited ${f.code}: ${f.stderr.slice(0, 300)}`);
    assert.equal(f.stdout, a.stdout, `(f) the live rows must print byte-identically to (a) — none added, none reordered: ${JSON.stringify([f.stdout, a.stdout])}`);
    assert.equal(noteLines(f.stderr).length, 1, `(f) live rows do not excuse the archived days: ${JSON.stringify(f.stderr)}`);
    assert.equal(noteLines(f.stderr)[0], cLines[0], `(f) one wording for one fact, live rows or not: ${JSON.stringify([noteLines(f.stderr)[0], cLines[0]])}`);

    // (g) TMUX-103's refusal path is untouched: a window never read is never reported on
    const g = await cli(archiveOnly, ["--since", "yesterday"]);
    assert.equal(g.code, 64, `(g) an unreadable --since still exits 64 (EX_USAGE), got ${g.code}: ${JSON.stringify(g.stderr)}`);
    assert.equal(g.stdout, "", `(g) a refused window prints no rows: ${JSON.stringify(g.stdout)}`);
    assert.match(g.stderr, /^--since: cannot read "yesterday" — give /, `(g) the refusal keeps its one line: ${JSON.stringify(g.stderr)}`);
    assert.deepEqual(noteLines(g.stderr), [], `(g) a window that was never read cannot be reported truncated: ${JSON.stringify(g.stderr)}`);

    // (h) ONE wording: the MCP note is the CLI's line behind its prefix, never a second phrasing
    assert.equal(
      cMcp.content[1].text,
      cLines[0].slice("waste: ".length),
      `(h) the MCP note and the CLI's line for one truncated window must be one string from one helper: ${JSON.stringify([cMcp.content[1].text, cLines[0]])}`,
    );

    // the archives are still there, byte for byte: naming history is not consuming it
    for (const day of ARCHIVED) {
      const gz = join(archiveOnly, "ledger", "archive", `events-${day}.ndjson.gz`);
      assert.match(String(gunzipSync(readFileSync(gz))), new RegExp(`"session":"ghost-${day}"`), `the archive for ${day} was disturbed by a read`);
    }
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("waste's note counts archived days without ever reading one, and adds no tool: the built reader carries no gunzip and the surface still advertises 13 tools", async () => {
  // TMUX-90's live-only rule is deliberate and unchanged — this card names the archived days, it does
  // not decompress them. A fix that started reading archives would red test/ledger-retention.test.js's
  // "readers see live days only" case; this is the cheaper, direct statement of the same bound.
  const reader = readFileSync(join(ROOT, "dist", "analytics", "status.js"), "utf8");
  for (const forbidden of ["gunzip", "node:zlib", 'require("zlib")']) {
    assert.equal(
      reader.split(forbidden).length - 1,
      0,
      `dist/analytics/status.js contains ${forbidden}: the reader is decompressing history instead of naming it (TMUX-90's live-only rule)`,
    );
  }
  const tools = await toolsList({ TMUX_AGENT_SOCKET: SOCKET });
  assert.equal(tools.length, TOOL_COUNT, `the tool count changed: ${tools.sort().join(", ")}`);
  assert.ok(tools.includes("waste-report"), `waste-report is gone from tools/list: ${tools.sort().join(", ")}`);
});
