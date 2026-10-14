/**
 * The PER-SESSION ledger views say when the history behind them was archived — `/api/history` and
 * `/api/timeline/<session>` (TMUX-130, gate G3 "failure modes observable" and, for the timeline's
 * empty state, G6: until this card it said something untrue).
 *
 * TMUX-128 (642829e) gave the two waste surfaces that take a caller-named window — CLI `waste` and
 * MCP `waste-report` — one wording for "the window you asked about is truncated: N archived days are
 * inside it and were NOT read"; TMUX-129 (5ea8367) carried that same sentence onto `/api/fleet.notes`,
 * the dashboard's Top waste panel. Both scope bounds named the same leftover, twice: the two views an
 * operator reads PER SESSION read live days only too (LedgerIndex, by design — TMUX-90). Measured
 * 2026-09-18 on the pushed 1b862bf dist, driving the BUILT dashboard on a throwaway home and planting
 * the archive UNDER the already-running server
 * (scratch/ga-fire-2026-09-18-18Z/history-probe/{probe.mjs,probe-1b862bf.log,addendum.mjs}):
 *   - `/api/history` was 134 bytes before and 134 bytes after two archived days appeared — BYTE-IDENTICAL,
 *     a bare ARRAY with no envelope a note could ride, and both archive-only sessions absent from it
 *     while the panel above it claims "(from ledger — live + decommissioned)".
 *   - `/api/timeline/hist-live` was 382 bytes before and after, its first span starting 2026-09-17,
 *     while the archive held an OLDER transition for that very session at 2026-08-04.
 *   - `/api/timeline/<archive-only>` answered `{"session":…,"spans":[],"marks":[]}`, which fires the
 *     empty branch in src/web/ui.ts and rendered "No ledger history yet for this session — timeline
 *     fills in as tmux-agent observes it (sessions spawned before tmux-agent existed have none)".
 *     BOTH halves were false: the tool observed that session, and its own retention sweep gzipped the
 *     history. That is why case (f) below is the one that matters most — a confident wrong
 *     answer is worse than silence.
 *   - `/archiv|truncat/i` occurred 0 times in either payload, from a process whose own
 *     `/api/health.ledger` answered `"archiveBytes":472,"archiveFiles":2` as it served the page.
 *
 * The contract, each case a check that FAILS if the property is removed. Both homes run ONE server
 * with the archive planted UNDER the already-running process, so the note is the only delta between
 * two answers from one poll loop: a fix that always warns reds (a)/(b), one that never warns reds
 * (c)/(d)/(f).
 *   (a) CONTROL, live days and NO archive: `/api/history` answers an ENVELOPE — `sessions` AND `notes`
 *       present BY KEY NAME — with `notes` `[]`; `/api/timeline/<live>` likewise, with real spans.
 *   (b) CONTROL, a bare home — no live days, no archive: both `notes` are `[]`, and the timeline of a
 *       session with no history ANYWHERE is `spans: []` + `marks: []` with no note. That is the state
 *       in which "sessions spawned before tmux-agent existed have none" is the TRUE sentence, so this
 *       case is what stops a fix from simply deleting it (the rendered halves are pinned in the
 *       browser audit's T16, which measures the DOM this payload drives).
 *   (c) THE GAP, that bare home the instant 2 archived days appear under it: EXACTLY ONE note on
 *       `/api/history`, naming `2 archived days` and the literal oldest→newest range, with `sessions`
 *       byte-identical to (b)'s — the archived sessions are named, never invented.
 *   (d) the live home the instant the same archive appears: the note IS carried on `/api/history` AND
 *       on `/api/timeline/<live>`, and the rows/spans/marks are byte-identical to (a)'s — save the open
 *       span's `seconds`, which is the wall clock and MUST advance (see `stableTimeline`).
 *   (e) ONE wording: (c)'s note is byte-identical to what the BUILT CLI `waste` prints on that very
 *       home behind its `waste: ` prefix — the imported `archivedWindowNote()` over
 *       `archivedDaysInWindow()`, never a fourth phrasing of one fact.
 *   (f) THE WRONG SENTENCE: the timeline of a session whose whole life is archived is still
 *       `spans: []` + `marks: []` (no gunzip — the history is named, not read) but now carries the
 *       note, so the UI's empty branch has the true thing to say instead of the false one.
 *   (g) the archives are byte-for-byte undisturbed after every read above: naming history is not
 *       consuming it. The stronger form — no `gunzip` in the built `LedgerIndex` or dashboard server —
 *       is already a bound case in test/web-archived-window.test.js and passes there unmodified.
 *
 * FAIL-first on the parent 8f56d8c build (its dist is byte-identical to 1b862bf's src):
 * scratch/ga-fire-2026-09-18-20Z/red-parent-8f56d8c.log — (a) red at once on `/api/history` having no
 * `notes` key (it is a bare array there), with the parent's own web suites green in the same run.
 *
 * Run: node --test test/web-archived-session-views.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// the built dashboard on a throwaway home — the same helper test/web-archived-window.test.js and
// test/fleet-tmux-down.test.js drive /api/fleet through, never a second server starter
import { ROOT, startWeb } from "./helpers/built-web.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** A poll is a handful of small files behind a loopback socket — it answers at once or it is broken. */
const BOUND_MS = 20_000;
/** The history view is a 3 s single-flight cache (src/web/server.ts); outlast it so (c)/(d) compare
 *  a RECOMPUTED row set against (a)/(b)'s, not the same cached object served twice. */
const HISTORY_TTL_MS = 3_500;
/** Two archived days, dated before any live day here so no window and no sweep can confuse them. */
const ARCHIVED = ["2026-08-04", "2026-08-05"];
/** The session whose ENTIRE life is in the archive — case (f), the one the UI lied about. */
const GHOST = `hist-ghost-${ARCHIVED[0]}`;
/** A name with no events anywhere: the honest empty timeline of case (b). */
const NOBODY = "hist-never-existed";
/** No tmux server is ever reached; the name is a throwaway so a stray call cannot find the fleet. */
const SOCKET = `ta-histview-${process.pid}`;

/** `YYYY-MM-DD`, UTC — the live days are planted relative to today (see `plantLive`). */
const day = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/**
 * Two live day files, YESTERDAY and TODAY, two sessions: `hist-old` on the older day and `hist-live`
 * today, the latter with two state transitions so its timeline has real spans and marks to hold
 * byte-identical across (a)→(d).
 *
 * Deliberately NOT test/helpers/waste-fixture.js's `plantTwoDays`: its days are fixed calendar dates,
 * and this suite runs the DAEMON, whose health tick sweeps the ledger with the shipped `keepDays: 30`
 * (src/core/ledger-retention.ts:36). A fixed day would quietly become an ARCHIVED day once it aged
 * past 30 days and these controls would invert — the trap test/web-archived-window.test.js records.
 */
function plantLive(ledgerDir) {
  const rows = {
    [day(1)]: [["06:00:01", "session.spawned", "hist-old", { cwd: "/tmp" }], ["06:00:02", "session.killed", "hist-old", {}]],
    [day(0)]: [
      ["07:00:01", "session.spawned", "hist-live", { cwd: "/tmp" }],
      ["07:00:02", "session.state", "hist-live", { from: "UNKNOWN", to: "WORKING", via: "cpu" }],
      ["07:30:02", "session.state", "hist-live", { from: "WORKING", to: "IDLE", via: "cpu" }],
      ["07:30:03", "input.sent", "hist-live", { bytes: 4, preview: "ls" }],
    ],
  };
  for (const [d, events] of Object.entries(rows)) {
    const lines = events.map(([hms, type, session, data]) => JSON.stringify({ v: 1, ts: `${d}T${hms}.000Z`, type, session, actor: "fixture", data }));
    writeFileSync(join(ledgerDir, `events-${d}.ndjson`), lines.join("\n") + "\n");
  }
}

/**
 * Archived days gzipped exactly as a retention sweep leaves them, then read back with
 * `gunzipSync` so a mis-planted run FAILS here rather than passing as "nothing to report". Each day
 * holds a session that exists ONLY in history — a spawn, an ERROR transition and a kill, the life the
 * timeline panel used to describe as never observed.
 *
 * test/web-archived-window.test.js and test/waste-archived-window.test.js each plant this shape with
 * their own copy, and the cards that own them require those suites to stay green
 * unmodified — so this is knowingly a third copy, and consolidating all three into
 * test/helpers/waste-fixture.js is its own change with its own card (recorded on TMUX-130).
 */
function plantArchive(ledgerDir, days) {
  mkdirSync(join(ledgerDir, "archive"), { recursive: true, mode: 0o700 });
  for (const d of days) {
    const session = `hist-ghost-${d}`;
    const events = [
      [`${d}T06:00:00.000Z`, "session.spawned", { cwd: "/tmp" }],
      [`${d}T06:00:01.000Z`, "session.state", { from: "WORKING", to: "ERROR", via: "cpu" }],
      [`${d}T06:00:02.000Z`, "session.killed", {}],
    ];
    const body = events.map(([ts, type, data]) => JSON.stringify({ v: 1, ts, type, session, actor: "fixture", data })).join("\n") + "\n";
    const gz = join(ledgerDir, "archive", `events-${d}.ndjson.gz`);
    writeFileSync(gz, gzipSync(body), { mode: 0o600 });
    assert.equal(String(gunzipSync(readFileSync(gz))), body, `precondition: the planted archive ${d} does not read back as what was written`);
  }
}

const listing = (dir) => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};

/** A home with the ledger layout a case needs, its preconditions ASSERTED before anything reads it. */
function home(root, label, { live }) {
  const h = join(root, label);
  const ledger = join(h, "ledger");
  mkdirSync(ledger, { recursive: true });
  if (live) plantLive(ledger);
  const liveFiles = listing(ledger).filter((f) => f.endsWith(".ndjson"));
  assert.equal(liveFiles.length, live ? 2 : 0, `precondition ${label}: live day files are ${JSON.stringify(liveFiles)}`);
  assert.deepEqual(listing(join(ledger, "archive")), [], `precondition ${label}: an archive exists before the case plants one`);
  return h;
}

/** The dashboard on `h`, plus the token read from the home file into memory — never printed. */
async function dashboard(h) {
  const { child, port } = await startWeb(ROOT, h, { TMUX_AGENT_SOCKET: SOCKET });
  return { child, port, token: readFileSync(join(h, "web-token"), "utf8").trim() };
}

/**
 * Kill a dashboard and WAIT for it to be gone. A signalled daemon is still writing — its health tick
 * writes the black box under `<home>/health` — so removing the home while it exits is a race that
 * reddened CI run 35369838771 on macOS with `ENOTEMPTY`. Bounded, so a wedged child
 * cannot hang the suite.
 */
function reap(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function api(srv, path, label) {
  const r = await fetch(`http://127.0.0.1:${srv.port}${path}?token=${encodeURIComponent(srv.token)}`, { signal: AbortSignal.timeout(BOUND_MS) });
  assert.equal(r.status, 200, `${label}: GET ${path} → ${r.status}`);
  return r.json();
}

/** `notes` must be a real key holding a string[] — a note inside a string nobody reads is not a surface. */
function notesOf(payload, label, path) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(payload, "notes"),
    `${label}: ${path} has no notes key — keys: ${Object.keys(payload).join(",")} (on 8f56d8c /api/history was a bare ARRAY: no key, no envelope, nothing to qualify the answer with)`,
  );
  assert.ok(Array.isArray(payload.notes), `${label}: ${path} notes must be a string[], got ${JSON.stringify(payload.notes)}`);
  return payload.notes;
}

/** The built CLI's own answer on the same home — the wording (e) holds the payloads' note against. */
function cliWaste(h) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, "waste"],
      { cwd: ROOT, env: { ...process.env, TMUX_AGENT_HOME: h, TMUX_AGENT_SOCKET: SOCKET }, timeout: BOUND_MS, killSignal: "SIGKILL" },
      (err, stdout, stderr) => resolve({ code: err ? (err.killed ? `killed after ${BOUND_MS} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A timeline for comparing two polls of the SAME session. Every closed span, every mark and every
 * state/boundary is held byte-identical; the OPEN span's `seconds` is the wall clock (`Date.now()` in
 * src/web/server.ts) and advances by design between polls — it read 46938 then 46941 s here, which is
 * the feature working, not a row moving. Nulling it is therefore the only difference this comparison
 * forgives: a spliced-in archived transition, a reorder or a changed boundary still fails.
 */
const stableTimeline = (t) =>
  JSON.stringify([t.spans.map((s) => (s.to === null ? { ...s, seconds: "<open>" } : s)), t.marks]);

test("the per-session ledger views say when their history was archived: one note on /api/history and /api/timeline naming the archived days and their range the instant an archive appears under the running server, none without one, the rows and spans byte-identical either way, and an archive-only session's empty timeline no longer claims it was never observed", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-histview-")));
  const running = [];
  try {
    const liveHome = home(T, "live-only", { live: true });
    const bareHome = home(T, "bare", { live: false });
    const L = await dashboard(liveHome);
    running.push(L.child);
    const B = await dashboard(bareHome);
    running.push(B.child);

    // (a) CONTROL: live days, no archive — both keys are there by name, and neither says anything
    const aHist = await api(L, "/api/history", "(a)");
    assert.deepEqual(notesOf(aHist, "(a)", "/api/history"), [], `(a) a home with no archive at all was told its history was truncated: ${JSON.stringify(aHist.notes)}`);
    assert.ok(Array.isArray(aHist.sessions), `(a) /api/history must carry the rows under a sessions key: ${JSON.stringify(Object.keys(aHist))}`);
    assert.deepEqual(
      aHist.sessions.map((r) => r.session).sort(),
      ["hist-live", "hist-old"],
      `(a) precondition: the planted live days are not what the history view listed: ${JSON.stringify(aHist.sessions)}`,
    );
    const aTl = await api(L, "/api/timeline/hist-live", "(a)");
    assert.deepEqual(notesOf(aTl, "(a)", "/api/timeline/hist-live"), [], `(a) the timeline of a live session on an archive-free home was qualified: ${JSON.stringify(aTl.notes)}`);
    assert.ok(aTl.spans.length >= 2, `(a) precondition: the planted transitions did not become spans: ${JSON.stringify(aTl.spans)}`);
    const liveRows = JSON.stringify(aHist.sessions);
    const liveSpans = stableTimeline(aTl);

    // (b) CONTROL: a bare home — nothing read, nothing to report, and the timeline of a session with
    // no history ANYWHERE is the state in which the UI's "spawned before tmux-agent existed" is true
    const bHist = await api(B, "/api/history", "(b)");
    assert.deepEqual(notesOf(bHist, "(b)", "/api/history"), [], `(b) a bare home has no history to have truncated: ${JSON.stringify(bHist.notes)}`);
    assert.deepEqual(bHist.sessions, [], `(b) precondition: a bare home lists no sessions: ${JSON.stringify(bHist.sessions)}`);
    const bTl = await api(B, `/api/timeline/${NOBODY}`, "(b)");
    assert.deepEqual(notesOf(bTl, "(b)", `/api/timeline/${NOBODY}`), [], `(b) a session with no history anywhere must not be told history was withheld: ${JSON.stringify(bTl.notes)}`);
    assert.deepEqual([bTl.spans, bTl.marks], [[], []], `(b) precondition: ${NOBODY} has a timeline: ${JSON.stringify(bTl)}`);

    // the archive appears UNDER both running servers — from here the note is the ONLY delta
    plantArchive(join(bareHome, "ledger"), ARCHIVED);
    plantArchive(join(liveHome, "ledger"), ARCHIVED);
    await sleep(HISTORY_TTL_MS); // outlast the history cache so the rows below are recomputed, not replayed

    // (c) THE GAP: 2 archived days under a home that listed nothing — truncated, not empty
    const cHist = await api(B, "/api/history", "(c)");
    const cNotes = notesOf(cHist, "(c)", "/api/history");
    assert.equal(
      cNotes.length,
      1,
      `(c) /api/history said nothing about the ${ARCHIVED.length} archived days it did not read, or said it twice: ${JSON.stringify(cNotes)} (on 8f56d8c the payload was a bare array, 134 bytes before and after)`,
    );
    assert.match(cNotes[0], /\b2 archived days\b/, `(c) the note must say HOW MANY days were withheld: ${JSON.stringify(cNotes[0])}`);
    assert.ok(cNotes[0].includes(`${ARCHIVED[0]}→${ARCHIVED[1]}`), `(c) the note must date the range it withheld, oldest→newest: ${JSON.stringify(cNotes[0])}`);
    assert.equal(JSON.stringify(cHist.sessions), JSON.stringify(bHist.sessions), `(c) the row set must be untouched — an archived session is named, never invented: ${JSON.stringify(cHist.sessions)}`);

    // (d) live rows AND an archive: both views carry the one note, and neither invents or reorders
    const dHist = await api(L, "/api/history", "(d)");
    assert.deepEqual(dHist.notes, cNotes, `(d) one wording for one fact, live rows or not: ${JSON.stringify([dHist.notes, cNotes])}`);
    assert.equal(JSON.stringify(dHist.sessions), liveRows, `(d) the live rows must be byte-identical to (a)'s — none added, none reordered: ${JSON.stringify([dHist.sessions, aHist.sessions])}`);
    const dTl = await api(L, "/api/timeline/hist-live", "(d)");
    assert.deepEqual(dTl.notes, cNotes, `(d) the timeline of a live session must carry the same one note: ${JSON.stringify([dTl.notes, cNotes])}`);
    assert.equal(stableTimeline(dTl), liveSpans, `(d) the spans and marks must be byte-identical to (a)'s — the archived transition is named, not spliced in: ${stableTimeline(dTl)}`);

    // (e) ONE wording: the payloads' note IS the built CLI's line behind its verb prefix
    const cli = await cliWaste(bareHome);
    assert.equal(cli.code, 0, `(e) waste on the archived home exited ${cli.code}: ${cli.stderr.slice(0, 300)}`);
    const cliNotes = cli.stderr.split("\n").filter((l) => l.startsWith("waste: "));
    assert.equal(cliNotes.length, 1, `(e) precondition: the CLI's own note is not one line: ${JSON.stringify(cli.stderr)}`);
    assert.equal(
      cNotes[0],
      cliNotes[0].slice("waste: ".length),
      `(e) the two per-session views, the fleet poll and the CLI must print one string from one helper: ${JSON.stringify([cNotes[0], cliNotes[0]])}`,
    );

    // (f) THE WRONG SENTENCE: the archive-only session's timeline is still empty of spans — no
    // gunzip — but no longer empty of explanation, so the UI's empty branch has the true thing to say
    const fTl = await api(B, `/api/timeline/${GHOST}`, "(f)");
    assert.equal(
      notesOf(fTl, "(f)", `/api/timeline/${GHOST}`).length,
      1,
      `(f) a session the tool observed and whose history its own sweep gzipped was left with nothing but "sessions spawned before tmux-agent existed have none": ${JSON.stringify(fTl)}`,
    );
    assert.deepEqual(fTl.notes, cNotes, `(f) one wording here too: ${JSON.stringify([fTl.notes, cNotes])}`);
    assert.deepEqual([fTl.spans, fTl.marks], [[], []], `(f) the archived history must be NAMED, not read into spans (TMUX-90's live-only rule): ${JSON.stringify(fTl)}`);

    // (g) the archives are still there, byte for byte: naming history is not consuming it
    for (const d2 of ARCHIVED) {
      const gz = join(bareHome, "ledger", "archive", `events-${d2}.ndjson.gz`);
      assert.match(String(gunzipSync(readFileSync(gz))), new RegExp(`"session":"hist-ghost-${d2}"`), `(g) the archive for ${d2} was disturbed by a read`);
    }
  } finally {
    for (const child of running) await reap(child);
    rmSync(T, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
