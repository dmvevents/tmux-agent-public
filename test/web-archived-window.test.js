/**
 * The fleet poll says when the ranking it served was computed over a TRUNCATED window —
 * `/api/fleet.notes` (TMUX-129, gate G3 "failure modes observable" on the surface with the largest
 * audience).
 *
 * TMUX-128 (642829e) gave the two waste surfaces that take a caller-named window — CLI `waste` and
 * MCP `waste-report` — one wording for "the window you asked about is truncated: N archived days are
 * inside it and were NOT read". Its scope bound named what it left: the dashboard's own Top waste
 * panel reads live days only too (LedgerIndex, by design — TMUX-90) and said nothing at all.
 * Measured 2026-09-18 on the pushed 642829e dist
 * (scratch/ga-fire-2026-09-18-14Z/waste-web-probe/{probe.sh,probe-642829e.log,addendum.sh}): on a
 * home with 0 live day files and 2 archived days (7 events, 3 of them errors, 309 B gzipped),
 * `/api/fleet` answered 513 bytes that were field-for-field identical to a bare home's — same
 * `readOnly`, same `sessions`, same `waste: []` — differing only in `generatedAt` and the clock
 * stamps inside `alerts`/`tmux`; `/archiv|truncat/i` occurred 0 times in that payload and 0 times in
 * the 37,351-byte dashboard HTML the same server served. That same process answered
 * `/api/health.ledger = {"files":0,…,"archiveBytes":309,"archiveFiles":2}` while it rendered the page.
 *
 * The contract, each case a check that FAILS if the property is removed. Both pairs run on ONE
 * server per home with the archive planted UNDER the already-running process, so the note is the
 * only delta between two answers from one poll loop — a fix that always warns reds (a)/(b) and a fix
 * that never warns reds (c)/(d):
 *   (a) CONTROL, live days and NO archive: `notes` is there BY KEY NAME and it is `[]`.
 *   (b) CONTROL, a bare home — no live days, no archive: `notes` is `[]`.
 *   (c) THE GAP, that bare home the instant 2 archived days appear under it: EXACTLY ONE note,
 *       naming `2 archived days` and the literal oldest→newest range, with `waste` still
 *       byte-identical to (b)'s — no row invented. RED on the parent, which answered (b) again.
 *   (d) the live home the instant the same archive appears: the note IS carried and the live rows
 *       are byte-identical to (a)'s — none added, none reordered, so the panel's table is untouched.
 *   (e) ONE wording: (c)'s note is byte-identical to what the BUILT CLI `waste` prints on that very
 *       home behind its `waste: ` prefix — the imported `archivedWindowNote()`, never a second
 *       phrasing of one fact.
 *   (f) a truncated window is not a BREACH: nothing about it rides `alerts` on any of the four
 *       answers. `alerts` is the ledgered breach set the red banner reads (TMUX-87's synthetic
 *       `tmux.unreachable` is its one exception); a window the reader declined to open is a
 *       qualification of the answer, not an incident.
 *   (g) no archive is ever READ: the built reader behind the panel and the dashboard server carry no
 *       gunzip at all — the note counts the NAMES under `archive/`. TMUX-90's live-only rule is
 *       unchanged, and test/ledger-retention.test.js's "readers see live days only" case (the one
 *       that reds if a fix starts decompressing instead of naming) passes unmodified.
 *
 * FAIL-first on the parent c0f37b4 dist — src identical to 642829e, the delta being docs-only:
 * scratch/ga-fire-2026-09-18-16Z/red-parent-c0f37b4.log ((a)/(b) green, (c) red on `notes` absent).
 *
 * Run: node --test test/web-archived-window.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// the built dashboard on a throwaway home, shared with test/fleet-tmux-down.test.js (the worked
// example for driving /api/fleet through it) and test/build-stamp.test.js
import { ROOT, startWeb } from "./helpers/built-web.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** A poll is a handful of small files behind a loopback socket — it answers at once or it is broken. */
const BOUND_MS = 20_000;
/** Two archived days, dated before any live day here so no window and no sweep can confuse them. */
const ARCHIVED = ["2026-08-04", "2026-08-05"];
/** No tmux server is ever reached; the name is a throwaway so a stray call cannot find the fleet. */
const SOCKET = `ta-webwarch-${process.pid}`;

/** `YYYY-MM-DD`, UTC — the live days are planted relative to today (see `plantLive`). */
const day = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/**
 * Two live day files, TODAY and YESTERDAY, three sessions: `warch-old` on the older day (2 events,
 * 0 errors) and on today `warch-loud` (3 events, 2 errors) and `warch-quiet` (2 events, 1 error).
 * The errors-first ranking is therefore loud, quiet, old.
 *
 * Deliberately NOT test/helpers/waste-fixture.js's `plantTwoDays`: its days are fixed calendar dates,
 * and this suite runs the DAEMON, whose first health tick sweeps the ledger with `keepDays: 30`
 * (src/web/server.ts). A fixed day would quietly become an ARCHIVED day once it aged past 30 days
 * and this suite's controls would invert. Relative days can never age into the sweep.
 */
function plantLive(ledgerDir) {
  const rows = {
    [day(1)]: [["06:00:01", "session.spawned", "warch-old", { cwd: "/tmp" }], ["06:00:02", "input.sent", "warch-old", { bytes: 4 }]],
    [day(0)]: [
      ["07:00:01", "session.spawned", "warch-loud", { cwd: "/tmp" }],
      ["07:00:02", "control.denied", "warch-loud", { action: "exec", reason: "deny-list" }],
      ["07:00:03", "exec.timeout", "warch-loud", { id: "x", timeoutMs: 1000, elapsedMs: 1002, command: "sleep 5" }],
      ["07:10:01", "session.spawned", "warch-quiet", { cwd: "/tmp" }],
      ["07:10:02", "control.denied", "warch-quiet", { action: "kill", reason: "read-only surface" }],
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
 * holds a session that exists only in history and would TOP the waste ranking if it were read —
 * which is the point: it must not be read, only named.
 *
 * test/waste-archived-window.test.js plants the same shape with its own copy: that suite's cases pin
 * byte counts against it and the card that owns it requires it to stay green unmodified,
 * so consolidating the two planters is its own change, not this one's.
 */
function plantArchive(ledgerDir, days) {
  mkdirSync(join(ledgerDir, "archive"), { recursive: true, mode: 0o700 });
  for (const d of days) {
    const session = `ghost-${d}`;
    const events = [
      [`${d}T04:00:01.000Z`, "session.spawned", { cwd: "/tmp" }],
      [`${d}T04:00:02.000Z`, "control.denied", { action: "kill", reason: "read-only surface" }],
      [`${d}T04:00:03.000Z`, "exec.timeout", { id: "x", timeoutMs: 1000, elapsedMs: 1002, command: "sleep 5" }],
      [`${d}T04:00:04.000Z`, "session.state", { from: "WORKING", to: "ERROR", via: "cpu" }],
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
 * writes the black box under `<home>/health` — so removing the home while it exits is a race:
 * measured on CI run 35369838771 (macos-latest, node 20), where every assertion below passed and the
 * cleanup threw `ENOTEMPTY: rmdir '…/bare/health'`. Bounded, so a wedged child cannot hang the suite.
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

async function fleet(srv, label) {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/fleet?token=${encodeURIComponent(srv.token)}`, { signal: AbortSignal.timeout(BOUND_MS) });
  assert.equal(r.status, 200, `${label}: /api/fleet → ${r.status}`);
  return r.json();
}

/** The built CLI's own answer on the same home — the wording (e) holds the payload's note against. */
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

test("the fleet poll carries a note when the window its waste ranking covered was truncated: one note naming the archived days and their range the instant an archive appears under the running server, none on a home without one, the waste rows byte-identical either way, and nothing about it in alerts", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-web-warch-")));
  const running = [];
  try {
    const liveHome = home(T, "live-only", { live: true });
    const bareHome = home(T, "bare", { live: false });
    const L = await dashboard(liveHome);
    running.push(L.child);
    const B = await dashboard(bareHome);
    running.push(B.child);

    // (a) CONTROL: live days, no archive — the key is there by name, and it says nothing
    const a = await fleet(L, "(a)");
    assert.ok(
      Object.prototype.hasOwnProperty.call(a, "notes"),
      `(a) /api/fleet has no notes key — a note smuggled into a string nobody reads is not a surface. keys: ${Object.keys(a).join(",")}`,
    );
    assert.ok(Array.isArray(a.notes), `(a) notes must be a string[], got ${JSON.stringify(a.notes)}`);
    assert.deepEqual(a.notes, [], `(a) a home with no archive at all was told its window was truncated: ${JSON.stringify(a.notes)}`);
    assert.deepEqual(
      a.waste.map((w) => w.session),
      ["warch-loud", "warch-quiet", "warch-old"],
      `(a) precondition: the planted live days are not what the panel ranked: ${JSON.stringify(a.waste)}`,
    );
    const liveRows = JSON.stringify(a.waste);

    // (b) CONTROL: a bare home — nothing read, nothing to report
    const b = await fleet(B, "(b)");
    assert.deepEqual(b.notes, [], `(b) a bare home has no history to have truncated: ${JSON.stringify(b.notes)}`);
    assert.deepEqual(b.waste, [], `(b) precondition: a bare home ranks nothing: ${JSON.stringify(b.waste)}`);

    // the archive appears UNDER both running servers — from here the note is the ONLY delta
    plantArchive(join(bareHome, "ledger"), ARCHIVED);
    plantArchive(join(liveHome, "ledger"), ARCHIVED);

    // (c) THE GAP: 2 archived days under a home whose ranking is empty — truncated, not empty
    const c = await fleet(B, "(c)");
    assert.equal(
      c.notes.length,
      1,
      `(c) the poll said nothing about the ${ARCHIVED.length} archived days its ranking did not read, or said it twice: ${JSON.stringify(c.notes)} (on 642829e: notes absent, the payload byte-identical to a bare home's)`,
    );
    assert.match(c.notes[0], /\b2 archived days\b/, `(c) the note must say HOW MANY days were excluded: ${JSON.stringify(c.notes[0])}`);
    assert.ok(c.notes[0].includes(`${ARCHIVED[0]}→${ARCHIVED[1]}`), `(c) the note must date the range it excluded, oldest→newest: ${JSON.stringify(c.notes[0])}`);
    assert.equal(JSON.stringify(c.waste), JSON.stringify(b.waste), `(c) the ranking itself must be untouched — no row invented from an archive: ${JSON.stringify(c.waste)}`);

    // (d) live rows AND an archive: the rows do not excuse the archived days, and do not move
    const d = await fleet(L, "(d)");
    assert.deepEqual(d.notes, c.notes, `(d) one wording for one fact, live rows or not: ${JSON.stringify([d.notes, c.notes])}`);
    assert.equal(JSON.stringify(d.waste), liveRows, `(d) the live rows must be byte-identical to (a)'s — none added, none reordered: ${JSON.stringify([d.waste, a.waste])}`);

    // (e) ONE wording: the payload's note IS the built CLI's line behind its verb prefix
    const cli = await cliWaste(bareHome);
    assert.equal(cli.code, 0, `(e) waste on the archived home exited ${cli.code}: ${cli.stderr.slice(0, 300)}`);
    const cliNotes = cli.stderr.split("\n").filter((l) => l.startsWith("waste: "));
    assert.equal(cliNotes.length, 1, `(e) precondition: the CLI's own note is not one line: ${JSON.stringify(cli.stderr)}`);
    assert.equal(
      c.notes[0],
      cliNotes[0].slice("waste: ".length),
      `(e) the panel's note and the CLI's line for one truncated window must be one string from one helper: ${JSON.stringify([c.notes[0], cliNotes[0]])}`,
    );

    // (f) a truncated window is a qualification, not a breach — it never rides the banner's set
    for (const [label, payload] of [["(a)", a], ["(b)", b], ["(c)", c], ["(d)", d]]) {
      const breach = payload.alerts.filter((al) => /archiv|truncat/i.test(JSON.stringify(al)));
      assert.deepEqual(breach, [], `${label} alerts is the ledgered breach set the red banner reads; a window the reader declined to open is not a breach: ${JSON.stringify(breach)}`);
    }

    // the archives are still there, byte for byte: naming history is not consuming it
    for (const d2 of ARCHIVED) {
      const gz = join(bareHome, "ledger", "archive", `events-${d2}.ndjson.gz`);
      assert.match(String(gunzipSync(readFileSync(gz))), new RegExp(`"session":"ghost-${d2}"`), `the archive for ${d2} was disturbed by a read`);
    }
  } finally {
    for (const child of running) await reap(child);
    rmSync(T, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("the panel's reader still never opens an archive: no gunzip in the built LedgerIndex or in the dashboard server", () => {
  // TMUX-90's live-only rule is deliberate and unchanged — this card adds a note, not a gunzip. A
  // dashboard that decompressed 30 archived days per poll is a different product decision: LedgerIndex
  // is called on EVERY request by design, which is precisely why it must not open archives.
  for (const rel of ["analytics/ledger-index.js", "web/server.js"]) {
    const built = readFileSync(join(ROOT, "dist", rel), "utf8");
    for (const forbidden of ["gunzip", "createGunzip", "node:zlib"]) {
      assert.equal(
        built.split(forbidden).length - 1,
        0,
        `dist/${rel} contains ${forbidden}: the panel is decompressing history instead of naming it (TMUX-90's live-only rule)`,
      );
    }
  }
});
