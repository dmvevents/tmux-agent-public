/**
 * The ledger's text fields are redacted BEFORE they are cut, at every producer, and rows written before that rule are
 * projected redacted on every read path (TMUX-205; THREAT-MODEL accepted risk 1 — "every read path redacts" — and
 * CONTRIBUTING rule 6, redact at the boundary).
 *
 * Measured 2026-10-13 on e757b28: src/core/orchestrator.ts wrote `preview: redact(text.slice(0, 120))` for both
 * `input.sent` producers (the verified path and `verify:false`) and `command: redact(command.slice(0, 200))` for
 * `exec.done` and `exec.timeout` — the cut BEFORE the redaction, so a key whose tail straddled the cut was sliced below
 * its pattern and survived as a partial (`AKIAFAKEFAKEFAKEFAK`, AKIA + 15 of the 16 the AWS pattern needs) in the row
 * on disk and on every surface that serves rows; `session.spawned` stored `command` and `task` verbatim, no redaction
 * at all. src/core/monitor.ts:361 had already learned the order for `lastLine`: one of five sites. The
 * rows reach `LedgerIndex.events()` (the dashboard's `/api/events`, the session detail's event list, the timeline's
 * marks — an `input.sent` mark IS the preview) and the rollup's `task` (`/api/history`, `/api/fleet`) as stored, with
 * no second redaction boundary. The review found it and reproduced it offline (S1; FM-02).
 *
 * Now every producer redacts first and cuts second — `redact(text).slice(0, 120)`, `redact(command).slice(0, 200)` —
 * and `session.spawned` stores `redact(command)` / `redact(task)`; and LedgerIndex projects every row it ingests
 * through the same three-field redaction (`data.preview`, `data.command`, `data.task` when they are strings), so a
 * legacy row holding a whole shape is served redacted on every route that reads the index. A legacy row holding only
 * a FRAGMENT (the partial a pre-TMUX-205 cut left) carries nothing a pattern can match — which is the reason the
 * producers had to change, not a thing the projection can repair; the ledger schema and field names are unchanged.
 *
 * The plants are FAKE values in the built-in shapes — never real credentials. Each check FAILS if the property is
 * removed (RED on e757b28: the fragments and the raw command/task quoted in the messages):
 *   (1) PRODUCERS, driven in-process through the built Orchestrator on a FakeTmux: an `input.sent` text and an exec
 *       command whose AWS-shaped key ends one byte past the 120 / 200 cut, on the verified send, the `verify:false`
 *       send, `exec.done` and `exec.timeout`; a spawn whose command carries the key and whose task carries a JWT and a
 *       GitHub token — every row holds its marker and no fragment, the previews stay inside their cut, and the raw
 *       bytes on disk hold none of the three plants (presence AND absence, so an empty ledger cannot pass);
 *   (2) LEGACY ROWS: raw rows planted on disk the way e757b28 wrote them (whole shapes) read back through
 *       `LedgerIndex.events()` and `.sessions()` redacted — the plants gone, the markers present;
 *   (3) ROUTES, through the built dashboard on that planted home: `/api/events`, `/api/session/<name>` (its event
 *       list), `/api/history` (the rollup's task) and `/api/timeline/<name>` (its marks) each serve the markers and
 *       none of the plants;
 *   (4) DOCS: docs/THREAT-MODEL.md's accepted risk 1 names the ledger's three fields among the read paths redacted
 *       before their cut — a rewording reds rather than silently un-pinning the promise this file drives.
 *
 * Run: npm run build && node --test test/ledger-preview-redaction.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Orchestrator } from "../dist/core/orchestrator.js";
import { Policy } from "../dist/core/policy.js";
import { Ledger } from "../dist/core/ledger.js";
import { LedgerIndex } from "../dist/analytics/ledger-index.js";
import { ROOT, startWeb, stopWeb } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes()); // every home this file made, once its last test has run

/** FAKE values in three built-in shapes — never real credentials. */
const AWS = "AKIAFAKEFAKEFAKEFAK1"; // AKIA + 16: the built-in AWS pattern
const JWT = "eyJFAKEFAKEFAKE.FAKEPAYLOAD00.FAKESIGNATURE0"; // eyJ + three 10+ segments
const GH = "ghp_FAKEFAKEFAKEFAKEFAKE1234"; // ghp_ + 24
const AWS_MARK = "[REDACTED_AWS_KEY]";
const JWT_MARK = "[REDACTED_JWT]";
const GH_MARK = "[REDACTED_GH_TOKEN]";
/** The partial a pre-TMUX-205 cut left of the AWS plant: AKIA + 15, below the pattern's 16. */
const AWS_FRAGMENT = AWS.slice(0, 19);
const PLANTS = [AWS, JWT, GH];
/** Filler that puts the plant's LAST byte one past the cut: cut-then-redact keeps the fragment, redact-then-cut the marker. */
const straddle = (cut, plant) => "x".repeat(cut - plant.length + 1) + plant;
const SENT = straddle(120, AWS); // input.sent previews are cut at 120
const CMD = straddle(200, AWS); // exec.done / exec.timeout commands are cut at 200
const BOUND_MS = 10_000;

function freshHome(prefix) {
  const h = tempHome(prefix);
  process.env.TMUX_AGENT_HOME = h;
  return h;
}
/** Every ledger row under `dir`, oldest first. */
function rows(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** The raw bytes of every ledger file under `dir`, concatenated — what is actually at rest. */
function bytes(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("");
}
/**
 * The FakeTmux of test/orchestrator.test.js: exactly the surface Orchestrator calls, every exec recorded — and a pane
 * that ECHOES what is pasted into it, the way a shell does: a `set-buffer` carries the text (every paste here is short
 * and single-line), the `paste-buffer` that follows appends it to the pane on a fresh prompt line. Since TMUX-206 a
 * verified send is judged on the lines the paste ADDED, so a fake whose pane already showed the text before the paste
 * would read as a dropped paste; this one shows it only after.
 */
function fakeTmux(opts = {}) {
  const calls = [];
  let pane = opts.paneText ?? "$ ";
  let buffered = "";
  return {
    calls,
    socketArgs: () => ["-L", "test"],
    exec: async (args) => {
      calls.push(args);
      if (opts.onExec) await opts.onExec(args);
      if (args[0] === "set-buffer") buffered = args[3] ?? "";
      if (args[0] === "paste-buffer") pane += `${buffered}\n$ `;
      if (args[0] === "show-options") return { stdout: "\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    hasSession: async () => false,
    capturePane: async () => pane,
    paneInfo: async () => ({ pid: 4242, currentCmd: "bash", cwd: "/tmp", dead: false }),
    listSessions: async () => [],
    listSessionsReachable: async () => ({ reachable: true, error: null, sessions: [] }),
  };
}
/** Presence AND absence on one string: the marker is there, the plant and its fragment are not. */
function assertScrubbed(s, marks, label) {
  for (const m of marks) assert.ok(s.includes(m), `${label}: ${m} is missing — the field was not redacted at all: ${JSON.stringify(s).slice(0, 300)}`);
  for (const p of [...PLANTS, AWS_FRAGMENT]) {
    assert.equal(s.includes(p), false, `${label}: the plant ${p} survives (on e757b28 the cut ran before the redaction, or the field was stored verbatim): ${JSON.stringify(s).slice(0, 300)}`);
  }
}

test("(1) every producer redacts BEFORE its cut: input.sent (verified and verify:false), exec.done, exec.timeout, and session.spawned's command and task hold the marker and no fragment — on disk", async () => {
  const home = freshHome("ta-lpr-prod-");
  const dir = join(home, "ledger");
  let complete = true; // the fake pane completes every exec it is asked to wait for — until the case flips this
  const tmux = fakeTmux({
    // a ready prompt for every readiness poll; the pane echoes each paste (see fakeTmux), so every verified send
    // lands on its first attempt on the lines the paste added
    paneText: "$ ",
    onExec: (args) => {
      if (complete && args[0] === "wait-for" && args.length === 2) {
        writeFileSync(join(home, `.exec-${args[1]}.rc`), "0");
        writeFileSync(join(home, `.exec-${args[1]}.out`), "ok\n");
      }
    },
  });
  const orch = new Orchestrator(tmux, new Ledger(dir), new Policy({}), "lpr-test");
  // the two input.sent producers
  assert.equal(await orch.sendVerified("s1", SENT, { enter: true }), true, "test setup: the verified send did not land on the fake pane");
  assert.equal(await orch.sendVerified("s1", SENT, { enter: true, verify: false }), true, "test setup: the verify:false send did not return true");
  // exec.done
  const done = await orch.execSync("s1", CMD, BOUND_MS);
  assert.equal(done.exitCode, 0, "test setup: the fake pane did not complete the exec");
  // exec.timeout: the fake never completes this one (execs are awaited in turn, so the flag is unambiguous)
  complete = false;
  await assert.rejects(() => orch.execSync("s1", CMD, 600), /timeout/, "test setup: the exec meant to time out completed instead");
  complete = true;
  // session.spawned: a command with the key, a task with a JWT and a GitHub token
  const created = await orch.spawn({ name: "s2", cwd: home, parent: "lpr-parent", command: `aws ${AWS} s3 ls`, task: `rotate ${JWT} then ${GH}` });
  assert.equal(created, true, "test setup: spawn did not create the session on the fake");

  const all = rows(dir);
  const sent = all.filter((e) => e.type === "input.sent");
  // the verified send, the verify:false send, the script line each exec injects (two), the spawn's launch command
  assert.equal(sent.length, 5, `five input.sent rows (two sends, two exec script lines, the spawn's launch command), got ${sent.length}: ${JSON.stringify(sent.map((e) => e.data.preview))}`);
  for (const [i, e] of sent.entries()) {
    assertScrubbed(String(e.data.preview), [], `input.sent[${i}].preview`);
    assert.ok(String(e.data.preview).length <= 120, `input.sent[${i}].preview is ${String(e.data.preview).length} chars — the 120 cut is gone`);
  }
  const marked = sent.filter((e) => String(e.data.preview).includes(AWS_MARK));
  assert.equal(marked.length, 3, `three input.sent previews carry ${AWS_MARK} (both sends of the straddling text and the spawn's launch command), got ${marked.length}: ${JSON.stringify(sent.map((e) => e.data.preview))}`);
  const execDone = all.filter((e) => e.type === "exec.done");
  assert.equal(execDone.length, 1, `one exec.done row, got ${execDone.length}`);
  assertScrubbed(String(execDone[0].data.command), [AWS_MARK], "exec.done.command");
  assert.ok(String(execDone[0].data.command).length <= 200, `exec.done.command is ${String(execDone[0].data.command).length} chars — the 200 cut is gone`);
  const execTimeout = all.filter((e) => e.type === "exec.timeout");
  assert.equal(execTimeout.length, 1, `one exec.timeout row, got ${execTimeout.length}`);
  assertScrubbed(String(execTimeout[0].data.command), [AWS_MARK], "exec.timeout.command");
  assert.ok(String(execTimeout[0].data.command).length <= 200, `exec.timeout.command is ${String(execTimeout[0].data.command).length} chars — the 200 cut is gone`);
  const spawned = all.filter((e) => e.type === "session.spawned");
  assert.equal(spawned.length, 1, `one session.spawned row, got ${spawned.length}`);
  assert.equal(spawned[0].data.command, `aws ${AWS_MARK} s3 ls`, "session.spawned.command is not redacted (on e757b28 it was stored verbatim)");
  assert.equal(spawned[0].data.task, `rotate ${JWT_MARK} then ${GH_MARK}`, "session.spawned.task is not redacted (on e757b28 it was stored verbatim)");
  // what is actually at rest: no plant, no fragment, anywhere in the files — and the markers are there to prove the rows are
  assertScrubbed(bytes(dir), [AWS_MARK, JWT_MARK, GH_MARK], "the ledger's bytes on disk");
});

/** Rows the way e757b28 wrote them — whole shapes stored verbatim (a spawn's command/task) or redact()ed only after a cut
 *  that happened to leave the shape whole (short previews/commands). Planted on disk, read back projected. */
function plantLegacy(dir, session) {
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const ts = (s) => `${day}T0${s}.000Z`;
  const row = (type, extra) => JSON.stringify({ v: 1, type, session, actor: "legacy", ...extra });
  writeFileSync(
    join(dir, `events-${day}.ndjson`),
    [
      row("session.spawned", { ts: ts("1:00:00"), parent: "legacy-parent", data: { cwd: "/tmp", command: `aws ${AWS} s3 ls`, task: `rotate ${JWT}` } }),
      // the token stands alone (no `token:` pair before it), so the GitHub-shape rule — not the pair rule — names the marker
      row("input.sent", { ts: ts("1:00:01"), data: { chars: 40, enter: true, attempt: 0, preview: `echo ${GH} | gh auth login --with-token` } }),
      row("exec.done", { ts: ts("1:00:02"), data: { exitCode: 0, id: "legacy1", command: `aws ${AWS} sts get-caller-identity` } }),
      row("exec.timeout", { ts: ts("1:00:03"), data: { id: "legacy2", timeoutMs: 1000, elapsedMs: 1002, command: `git push https://user:${GH}@example.invalid/r.git`, holder: "the guard saw a shell" } }),
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
}

test("(2) legacy rows: raw rows planted the way e757b28 wrote them read back redacted through LedgerIndex.events() and .sessions()", () => {
  const home = freshHome("ta-lpr-legacy-");
  const dir = join(home, "ledger");
  plantLegacy(dir, "legacy-s");
  const index = new LedgerIndex(dir);
  const events = index.events(undefined, 120, true);
  assert.equal(events.length, 4, `four planted rows read back, got ${events.length}`);
  const byType = Object.fromEntries(events.map((e) => [e.type, e]));
  assertScrubbed(String(byType["session.spawned"].data.command), [AWS_MARK], "events(): session.spawned.command (legacy)");
  assertScrubbed(String(byType["session.spawned"].data.task), [JWT_MARK], "events(): session.spawned.task (legacy)");
  assertScrubbed(String(byType["input.sent"].data.preview), [GH_MARK], "events(): input.sent.preview (legacy)");
  assertScrubbed(String(byType["exec.done"].data.command), [AWS_MARK], "events(): exec.done.command (legacy)");
  assertScrubbed(String(byType["exec.timeout"].data.command), ["[REDACTED]"], "events(): exec.timeout.command (legacy, URL credential)");
  assert.equal(byType["exec.timeout"].data.holder, "the guard saw a shell", "a field that carries no secret is left byte-for-byte");
  const roll = index.sessions(true).find((r) => r.session === "legacy-s");
  assert.ok(roll, "the planted session has no rollup");
  assertScrubbed(String(roll.task), [JWT_MARK], "sessions(): the rollup's task (legacy)");
  assert.equal(roll.parent, "legacy-parent", "a rollup field that carries no secret is left byte-for-byte");
  // the bytes on disk are the legacy bytes — the projection is a READ-side boundary, it rewrites nothing
  assert.ok(bytes(dir).includes(AWS), "test setup: the planted legacy row was rewritten on disk — the plant must stay in the file for this case to mean anything");
});

test("(3) routes: the built dashboard serves the planted legacy home redacted on /api/events, /api/session, /api/history and /api/timeline", async () => {
  const home = freshHome("ta-lpr-web-");
  plantLegacy(join(home, "ledger"), "legacy-w");
  const socket = `ta-lpr-${process.pid}`;
  let child = null;
  try {
    const started = await startWeb(ROOT, home, { TMUX_AGENT_SOCKET: socket }, ["--no-token"]);
    child = started.child;
    const get = async (path) => {
      const r = await fetch(`http://127.0.0.1:${started.port}${path}`, { signal: AbortSignal.timeout(BOUND_MS) });
      assert.equal(r.status, 200, `${path} answered ${r.status}`);
      return r.json();
    };
    const events = await get("/api/events");
    const planted = events.filter((e) => e.session === "legacy-w");
    assert.equal(planted.length, 4, `/api/events carries the four planted rows, got ${planted.length}`);
    assertScrubbed(JSON.stringify(planted), [AWS_MARK, JWT_MARK, GH_MARK], "/api/events");
    const detail = await get("/api/session/legacy-w");
    assert.ok(Array.isArray(detail.events) && detail.events.length === 4, `/api/session/<name>.events carries the four planted rows, got ${JSON.stringify(detail.events ?? null).slice(0, 120)}`);
    assertScrubbed(JSON.stringify(detail.events), [AWS_MARK, JWT_MARK, GH_MARK], "/api/session/<name>.events");
    const history = await get("/api/history");
    const roll = (history.sessions ?? []).find((r) => r.session === "legacy-w");
    assert.ok(roll, `/api/history has no row for the planted session: ${JSON.stringify(history).slice(0, 200)}`);
    assertScrubbed(String(roll.task), [JWT_MARK], "/api/history row.task");
    const timeline = await get("/api/timeline/legacy-w");
    const mark = (timeline.marks ?? []).find((m) => m.type === "input.sent");
    assert.ok(mark, `/api/timeline has no input.sent mark: ${JSON.stringify(timeline).slice(0, 200)}`);
    assertScrubbed(String(mark.detail), [GH_MARK], "/api/timeline input.sent mark.detail");
  } finally {
    await stopWeb(child);
    killServerSync(socket);
  }
});

test("(4) docs/THREAT-MODEL.md's accepted risk 1 names the ledger's preview, command and task among the read paths redacted before their cut", () => {
  const text = readFileSync(join(ROOT, "docs/THREAT-MODEL.md"), "utf8");
  assert.match(text, /the ledger's\s+`preview`,\s+`command`\s+and\s+`task`\s+fields\s+are\s+redacted\s+before\s+their\s+cut/,
    "docs/THREAT-MODEL.md must keep the sentence naming the ledger's three text fields as redacted before their cut — the promise TMUX-205 measured false for four producers and one unredacted event");
});
