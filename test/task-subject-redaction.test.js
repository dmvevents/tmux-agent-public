/**
 * The two text producers TMUX-205 left outside its card are closed: the mailbox's `message.sent` row carries
 * redact(subject) and LedgerIndex projects `subject` for rows filed before that rule; and the `@agent_task` tmux user
 * option — set verbatim at spawn, which is right: tmux is the operator's state, not a ledger — is redact()ed where the
 * tool READS it back, so a task string carrying a secret-shaped token travels through tmux and reaches no reader raw.
 *
 * Measured 2026-10-13 on fe4cf19: src/adapters/messaging/mailbox.ts emitted `message.sent` with `data.subject` as typed
 * — the one remaining free-text ledger field with no redaction at its producer — and `redactEventText()`
 * did not list `subject`; src/core/orchestrator.ts wrote `@agent_task` into tmux's user options as given and read it
 * back for `lineage` (the CLI's lines, MCP `list-lineage`, `status.json`'s `task`) through getOption, while
 * src/core/tmux.ts's `listSessionsDetailed()` read the same option for the dashboard's fleet rows and `calibrate` —
 * `monitor.ts:361` redacts only `lastLine`. A planted AWS-shaped token in a subject and in a task reached the ledger,
 * `/api/events`, `lineage`, `status.json` and `/api/fleet` whole.
 *
 * Each check FAILS if its property is removed (RED on fe4cf19 quoted in the messages):
 *   (1) PRODUCER: Mailbox.send() with a subject carrying the plant → the `message.sent` row holds the marker and no
 *       plant, the bytes on disk likewise; the recipient's inbox file still carries the subject as typed and `receive()`
 *       hands it back — delivery is the recipient's, the ledger is the audit trail;
 *   (2) LEGACY ROW: a `message.sent` planted on disk the way fe4cf19 wrote it reads back redacted through
 *       `LedgerIndex.events()` and on the built dashboard's `/api/events`, the file bytes untouched;
 *   (3) READ BOUNDARY, on a real isolated tmux server: a session whose `@agent_task` carries the plant — the option
 *       itself reads back raw from tmux (`show-options`), while `Tmux.listSessionsDetailed()`, `Orchestrator.lineage()`,
 *       the CLI's `lineage` line, `status --json`'s record and the built dashboard's `/api/fleet` row each carry the
 *       marker and not the plant;
 *   (4) DOCS: docs/THREAT-MODEL.md's accepted risk 1 names both paths — a rewording reds rather than silently un-pinning.
 *
 * Run: npm run build && node --test test/task-subject-redaction.test.js   (needs a tmux binary)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Mailbox } from "../dist/adapters/messaging/mailbox.js";
import { Ledger } from "../dist/core/ledger.js";
import { LedgerIndex } from "../dist/analytics/ledger-index.js";
import { Tmux } from "../dist/core/tmux.js";
import { Orchestrator } from "../dist/core/orchestrator.js";
import { Policy } from "../dist/core/policy.js";
import { ROOT, startWeb, stopWeb } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";
import { quietServer } from "./helpers/quiet-server.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** A FAKE value in the built-in AWS pattern's shape — never a real key. */
const AWS = "AKIAFAKEFAKEFAKEFAK1";
const AWS_MARK = "[REDACTED_AWS_KEY]";
const SUBJECT = `rotate ${AWS} before the demo`;
const SUBJECT_MARK = `rotate ${AWS_MARK} before the demo`;
const TASK = `rotate ${AWS} by friday`;
const TASK_MARK = `rotate ${AWS_MARK} by friday`;
const BOUND_MS = 20_000;

function freshHome(prefix) {
  const h = tempHome(prefix);
  process.env.TMUX_AGENT_HOME = h;
  return h;
}
function rows(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
function bytes(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("");
}
/** Presence AND absence on one string. */
function assertScrubbed(s, mark, label) {
  assert.ok(s.includes(mark), `${label}: ${mark} is missing — the field was not redacted at all: ${JSON.stringify(s).slice(0, 300)}`);
  assert.equal(s.includes(AWS), false, `${label}: the plant survives (on fe4cf19 this field was stored or read back as typed): ${JSON.stringify(s).slice(0, 300)}`);
}
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    const clean = { ...process.env };
    delete clean.TMUX_AGENT_SOCKET;
    delete clean.TMUX_AGENT_DEFAULT_SERVER;
    execFile(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...clean, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const tmuxRaw = (sock, args) => execFileSync("tmux", ["-L", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("(1) message.sent carries redact(subject): the row and the bytes on disk hold the marker, the recipient's inbox still holds the subject as typed", () => {
  const home = freshHome("ta-tsr-mail-");
  const ledgerDir = join(home, "ledger");
  const mailbox = new Mailbox(join(home, "mailbox"), new Ledger(ledgerDir));
  const msg = mailbox.send("alpha", "beta", SUBJECT, "the body");
  const sent = rows(ledgerDir).filter((e) => e.type === "message.sent");
  assert.equal(sent.length, 1, `one message.sent row, got ${sent.length}`);
  assertScrubbed(String(sent[0].data.subject), AWS_MARK, "message.sent.data.subject");
  assert.equal(sent[0].data.subject, SUBJECT_MARK, "the subject is redacted and otherwise byte-for-byte what was typed");
  assert.equal(sent[0].data.id, msg.id, "the row still names the message id");
  assertScrubbed(bytes(ledgerDir), AWS_MARK, "the ledger's bytes on disk");
  // the message itself is the recipient's: delivered as typed (the mailbox files are 0600 in a 0700 home, like capture logs)
  const got = mailbox.receive("beta");
  assert.equal(got.length, 1, "the recipient did not receive the message");
  assert.equal(got[0].subject, SUBJECT, "the delivered subject is no longer what was sent — redaction belongs to the ledger row, not the message");
});

/** A message.sent row the way fe4cf19 wrote it — the subject as typed. */
function plantLegacy(dir, session) {
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, `events-${day}.ndjson`), JSON.stringify({ v: 1, ts: `${day}T01:00:00.000Z`, type: "message.sent", session, actor: "alpha", data: { id: "legacy1", subject: SUBJECT } }) + "\n", { mode: 0o600 });
}

test("(2) a legacy message.sent row reads back redacted through LedgerIndex.events() and /api/events, the file bytes untouched", async () => {
  const home = freshHome("ta-tsr-legacy-");
  const dir = join(home, "ledger");
  plantLegacy(dir, "beta-legacy");
  const events = new LedgerIndex(dir).events(undefined, 120, true);
  assert.equal(events.length, 1, `one planted row read back, got ${events.length}`);
  assertScrubbed(String(events[0].data.subject), AWS_MARK, "events(): message.sent.subject (legacy)");
  assert.ok(bytes(dir).includes(AWS), "test setup: the planted legacy row was rewritten on disk — the plant must stay in the file for this case to mean anything");
  const socket = `ta-built-${process.pid}`;
  let child = null;
  try {
    const started = await startWeb(ROOT, home, {}, ["--no-token"]);
    child = started.child;
    const r = await fetch(`http://127.0.0.1:${started.port}/api/events`, { signal: AbortSignal.timeout(BOUND_MS) });
    assert.equal(r.status, 200, `/api/events answered ${r.status}`);
    const served = (await r.json()).filter((e) => e.session === "beta-legacy");
    assert.equal(served.length, 1, `/api/events carries the planted row, got ${served.length}`);
    assertScrubbed(JSON.stringify(served), AWS_MARK, "/api/events message.sent.subject (legacy)");
  } finally {
    await stopWeb(child);
    killServerSync(socket);
  }
});

test("(3) @agent_task is redacted where it is read back — listSessionsDetailed, lineage(), the CLI's lineage line, status --json, /api/fleet — while the tmux option itself stays what the operator set", async () => {
  const home = freshHome("ta-tsr-task-");
  // the dashboard the built-web helper starts drives THIS socket, so the session is born on it
  const S = `ta-built-${process.pid}`;
  const name = `tk-${process.pid}`;
  let child = null;
  try {
    quietServer(S);
    tmuxRaw(S, ["new-session", "-d", "-s", name, "-x", "160", "-y", "40"]);
    tmuxRaw(S, ["set-option", "-t", `=${name}:`, "@agent_task", TASK]);
    tmuxRaw(S, ["set-option", "-t", `=${name}:`, "@agent_parent", "tsr-parent"]);
    // the option itself: tmux is the operator's state, not a ledger — read back raw by tmux's own verb
    assert.equal(tmuxRaw(S, ["show-options", "-v", "-t", `=${name}:`, "@agent_task"]).trim(), TASK, "test setup: tmux does not hold the task as set");
    // the driver's detailed listing (the dashboard's and calibrate's source)
    const tmux = new Tmux({ socket: S });
    const detail = (await tmux.listSessionsDetailed()).find((d) => d.name === name);
    assert.ok(detail, "the session is not in listSessionsDetailed()");
    assertScrubbed(String(detail.task), AWS_MARK, "listSessionsDetailed().task");
    assert.equal(detail.task, TASK_MARK, "listSessionsDetailed().task is redacted and otherwise what was set");
    assert.equal(detail.parent, "tsr-parent", "a field that carries no secret is left byte-for-byte");
    // the orchestrator's lineage (MCP list-lineage, status.json)
    const orch = new Orchestrator(tmux, new Ledger(join(home, "ledger")), new Policy({}), "tsr-test");
    const row = (await orch.lineage()).find((l) => l.name === name);
    assert.ok(row, "the session is not in lineage()");
    assertScrubbed(String(row.task), AWS_MARK, "lineage().task");
    // the built CLI: lineage's line and status --json's record
    let r = await cli(["--socket", S, "lineage"], { TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `lineage exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    const line = r.stdout.split("\n").find((l) => l.startsWith(`${name}\t`));
    assert.ok(line, `lineage printed no line for ${name}: ${r.stdout.slice(0, 200)}`);
    assertScrubbed(line, AWS_MARK, "the CLI's lineage line");
    const out = join(home, "status.json");
    r = await cli(["--socket", S, "status", "--json", out], { TMUX_AGENT_HOME: home }, 30_000);
    assert.equal(r.code, 0, `status --json exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    const rec = JSON.parse(readFileSync(out, "utf8")).sessions.find((s) => s.session === name);
    assert.ok(rec, "status.json has no record for the session");
    assertScrubbed(String(rec.task), AWS_MARK, "status.json record.task");
    // the dashboard's fleet row
    const started = await startWeb(ROOT, home, {}, ["--no-token"]);
    child = started.child;
    const f = await fetch(`http://127.0.0.1:${started.port}/api/fleet`, { signal: AbortSignal.timeout(BOUND_MS) });
    assert.equal(f.status, 200, `/api/fleet answered ${f.status}`);
    const fleetRow = ((await f.json()).sessions ?? []).find((s) => s.session === name);
    assert.ok(fleetRow, "/api/fleet has no row for the session");
    assertScrubbed(String(fleetRow.task), AWS_MARK, "/api/fleet row.task");
    // and tmux still holds what the operator set — nothing rewrote the option
    assert.equal(tmuxRaw(S, ["show-options", "-v", "-t", `=${name}:`, "@agent_task"]).trim(), TASK, "the tmux option was rewritten — redaction belongs to the read, tmux is not a ledger");
  } finally {
    await stopWeb(child);
    killServerSync(S);
  }
});

test("(4) docs/THREAT-MODEL.md's accepted risk 1 names message.sent's subject and the @agent_task read boundary", () => {
  const text = readFileSync(join(ROOT, "docs/THREAT-MODEL.md"), "utf8");
  assert.match(text, /`message\.sent`[^\n]{0,40}`subject`[\s\S]{0,400}`@agent_task`[\s\S]{0,240}reads? (?:it )?back/,
    "docs/THREAT-MODEL.md must name the mailbox's message.sent subject and the @agent_task option read back redacted — the two paths TMUX-205 left and TMUX-225 closed");
});
