/**
 * Unread mailbox mail is observable, and a READ never manufactures a mailbox (TMUX-120, gate G3
 * "failure modes observable" — the standard doctor already meets for the ledger's own footprint,
 * TMUX-90/H3, applied to the other directory the tool writes into a home).
 *
 * Measured 2026-09-17 08:2xZ on b6bcaaa (scratch/ga-fire-2026-09-17-06Z/mailbox-probe/probe-b6bcaaa.log):
 * `msg recv ghostagent` on a fresh home — a name never sent to, never spawned, never seen — exited 0
 * with nothing on either stream, no ledger row, and CREATED <home>/mailbox/ghostagent/{inbox,archive}
 * (receive() took the inbox through Mailbox.dir(), an mkdirSync(recursive, 0700), before listing it).
 * So a typo'd read was indistinguishable from the empty inbox of a healthy agent on every channel the
 * tool has, and left behind a directory byte-for-byte as legitimate as the real recipient's. In the
 * same measurement two messages sent to `gamma` and never received were reported by NO surface:
 * `grep -c mail` over the whole of doctor's output was 0 (top-level keys home, lexicon, profiles,
 * redaction, parents, ledger, build, dashboard, policy), `status --json` had no such key either, and in
 * the built artefact only the CLI and the mailbox module read an inbox at all. `msg send alpha bteta …`
 * — one character wrong in <to> — printed `msg <id> → bteta` and exited 0; the only trace of the failure
 * was a message.sent with no matching message.received, an asymmetry no surface computes.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) `msg recv <name-never-used>` on a fresh home → exit 0, stdout empty, <home>/mailbox/<name>
 *       ABSENT (the path, not merely empty) and <home>/mailbox itself never created — RED on b6bcaaa:
 *       inbox/ and archive/ both there;
 *   (b) that same read prints ONE stderr line naming the agent — a mailbox that has never existed is
 *       not the empty inbox of a known one — RED on b6bcaaa: stderr empty;
 *   (c) the note is not printed unconditionally: a known agent whose inbox is merely empty (beta after
 *       its one message is archived) reads with stderr EMPTY, exit 0 — green on both trees, the
 *       control that stops (b) from being satisfied by a line printed always;
 *   (d) send-before-spawn still works — `msg send alpha never-seen hi` creates, delivers, exits 0 and a
 *       later `msg recv never-seen` reads it back (smoke step 6's round trip, and the documented
 *       cross-host case): the fix is "a READ does not create", never "refuse an unknown recipient" —
 *       green on both trees, the control that stops (a) from being satisfied by a refusal;
 *   (e) doctor's JSON carries `mailbox` reporting the number of agents with pending mail and the
 *       pending count, and the numbers MOVE: 2 after two unreceived sends to `gamma`, 0 after gamma's
 *       recv — a hard-coded key cannot pass — RED on b6bcaaa: no `mailbox` key at all;
 *   (f) the orphan is nameable: after a case built exactly like the one-character-wrong send above,
 *       `mailbox.pendingAgents` is exactly ["bteta"] — the typo'd recipient nobody will ever read;
 *   (g) path-independent: every assertion is on parsed JSON, and the home path is asserted to contain
 *       neither "mail" nor "inbox" so a path value can never answer for a report. (The 06Z probe's
 *       first version of this check asked `grep -c mailbox` over doctor's output and got 4 — every hit
 *       its own directory name inside a path value. It could not have failed.) The key walk is run
 *       against the ledger's footprint keys first as its positive control.
 *
 * doctor is asked with `--port` on a loopback port nothing listens on: the probe must never reach the
 * operator's own dashboard, and a missing daemon is a report, not a failure.
 *
 * Run: node --test test/mailbox-observable.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
// A mailbox verb touches no tmux server; doctor's dashboard probe has its own timeout inside.
const BOUND_MS = 20_000;

/** msg and doctor touch no tmux server; the isolated socket is hygiene, not a dependency. */
function socket() {
  return `ta-mbobs-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/**
 * A home whose PATH contains neither "mail" nor "inbox": (g) — a report about a mailbox must not be
 * satisfiable by the home path appearing in some value. Asserted, not just intended.
 */
function home(tag) {
  const T = mkdtempSync(join(tmpdir(), `ta-t120-${tag}-`));
  const h = join(T, "home");
  for (const word of ["mail", "inbox"]) {
    assert.ok(!h.includes(word), `test setup: the home path must not contain ${JSON.stringify(word)} — a path value could then answer for a report (${h})`);
  }
  return { T, h };
}

/** { code, stdout, stderr }; code is a string when the bound fired — a hang, not a refusal. */
function cli(args, h, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, "--socket", socket(), ...args], { env: { ...process.env, TMUX_AGENT_HOME: h }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** A loopback port nothing listens on (bound once, released) — doctor's probe must find it refused. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createTcpServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** doctor's parsed JSON, or a failure naming what it printed instead. */
async function doctor(h, port) {
  const r = await cli(["doctor", "--port", String(port)], h);
  assert.equal(r.code, 0, `doctor exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new assert.AssertionError({ message: `doctor did not print JSON (${e.message}): ${r.stdout.slice(0, 300)}` });
  }
}

/** Every dotted key path in a parsed object — (g)'s walk, so nothing is decided by a grep over text. */
function keyPaths(v, prefix = "") {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v).flatMap(([k, val]) => [`${prefix}${k}`, ...keyPaths(val, `${prefix}${k}.`)]);
}

test("a read never manufactures a mailbox, and says which of the two states it is", async () => {
  const { T, h } = home("read");
  try {
    // (a) + (b): a name never sent to, never spawned, never seen
    const ghost = await cli(["msg", "recv", "ghostagent"], h);
    assert.equal(ghost.code, 0, `msg recv ghostagent exited ${ghost.code}, want 0: ${ghost.stderr.slice(0, 300)}`);
    assert.equal(ghost.stdout, "", `a read of a mailbox that never existed wrote to stdout: ${ghost.stdout.slice(0, 200)}`);
    assert.equal(existsSync(join(h, "mailbox", "ghostagent")), false, "the read CREATED <home>/mailbox/ghostagent (on b6bcaaa: inbox/ and archive/ both) — a read must not manufacture a mailbox");
    assert.equal(existsSync(join(h, "mailbox")), false, "the read created <home>/mailbox — nothing had ever been sent through this home");
    const note = ghost.stderr.trim().split("\n").filter(Boolean);
    assert.equal(note.length, 1, `one stderr line, not none (b6bcaaa) and not a stack trace: ${JSON.stringify(ghost.stderr.slice(0, 300))}`);
    assert.match(note[0], /^msg recv: no mailbox for "ghostagent" —/, `the note must name the agent as typed: ${note[0]}`);

    // (c) the control: a KNOWN agent whose inbox is merely empty stays silent
    let r = await cli(["msg", "send", "alpha", "beta", "for-beta", "real"], h);
    assert.equal(r.code, 0, `msg send alpha beta exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    r = await cli(["msg", "recv", "beta"], h);
    assert.equal(r.code, 0, `msg recv beta exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    assert.equal(r.stdout.trim().split("\n").length, 1, `beta's one message: ${r.stdout}`);
    assert.equal(r.stderr, "", `a delivering read printed a note: ${r.stderr.slice(0, 300)}`);
    r = await cli(["msg", "recv", "beta"], h); // archived: the empty inbox of an agent we have heard of
    assert.equal(r.code, 0, `the second msg recv beta exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    assert.equal(r.stdout, "", `the second read re-delivered: ${r.stdout.slice(0, 200)}`);
    assert.equal(r.stderr, "", `the note is printed unconditionally — a known agent's empty inbox is not a missing mailbox: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("send-before-spawn still creates, delivers and reads back — a read does not create, a send still does", async () => {
  const { T, h } = home("send");
  try {
    // (d): the documented cross-host case and smoke step 6's round trip, unchanged
    let r = await cli(["msg", "send", "alpha", "never-seen", "hi", "body", "words"], h);
    assert.equal(r.code, 0, `msg send alpha never-seen hi exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    assert.match(r.stdout, /^msg \S+ → never-seen\n$/, `the send's one stdout line: ${r.stdout}`);
    assert.equal(existsSync(join(h, "mailbox", "never-seen", "inbox")), true, "a send must still create the recipient's mailbox on demand");
    r = await cli(["msg", "recv", "never-seen"], h);
    assert.equal(r.code, 0, `msg recv never-seen exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    const got = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(got.map((m) => [m.from, m.to, m.subject, m.body]), [["alpha", "never-seen", "hi", "body words"]], "the message did not round-trip as sent");
    assert.equal(r.stderr, "", `the read of a mailbox a send created printed a note: ${r.stderr.slice(0, 300)}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("doctor reports the mailbox's footprint: how much mail nobody has collected, and whose", async () => {
  const { T, h } = home("doctor");
  const port = await freePort();
  try {
    // (e) two messages sent and never received
    for (const subject of ["s1", "s2"]) {
      const r = await cli(["msg", "send", "alpha", "gamma", subject, "body"], h);
      assert.equal(r.code, 0, `msg send alpha gamma ${subject} exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    }
    let doc = await doctor(h, port);
    const paths = keyPaths(doc);
    // (g) the positive control first: the walk finds the ledger footprint keys doctor DOES report
    for (const k of ["ledger.bytes", "ledger.files", "ledger.oldestDay"]) {
      assert.ok(paths.includes(k), `the key walk cannot see doctor.${k} — the walk itself is broken, so its verdict on mailbox means nothing (keys: ${paths.slice(0, 40).join(",")})`);
    }
    assert.ok(doc.mailbox, `doctor has no mailbox key — unread mail is on no surface (top-level keys: ${Object.keys(doc).join(",")})`);
    for (const k of ["mailbox.agents", "mailbox.pending", "mailbox.pendingAgents", "mailbox.pendingBytes", "mailbox.oldestPending"]) {
      assert.ok(paths.includes(k), `doctor.${k} is not reported (mailbox keys: ${Object.keys(doc.mailbox).join(",")})`);
    }
    assert.equal(doc.mailbox.pending, 2, `doctor.mailbox.pending is ${doc.mailbox.pending} after two unreceived sends, want 2`);
    assert.deepEqual(doc.mailbox.pendingAgents, ["gamma"], `doctor.mailbox.pendingAgents after two sends to gamma: ${JSON.stringify(doc.mailbox.pendingAgents)}`);
    assert.equal(doc.mailbox.agents, 1, `doctor.mailbox.agents is ${doc.mailbox.agents}, want 1 (only gamma has a mailbox)`);
    assert.ok(doc.mailbox.pendingBytes > 0, `doctor.mailbox.pendingBytes is ${doc.mailbox.pendingBytes} with two messages on disk`);
    assert.match(String(doc.mailbox.oldestPending), /^\d{4}-\d{2}-\d{2}T/, `doctor.mailbox.oldestPending must date the oldest unread message: ${doc.mailbox.oldestPending}`);
    assert.equal(doc.mailbox.dir, join(h, "mailbox"), `doctor.mailbox.dir names the directory reported on: ${doc.mailbox.dir}`);

    // the number must MOVE: the recipient collects, and the report follows
    const recv = await cli(["msg", "recv", "gamma"], h);
    assert.equal(recv.code, 0, `msg recv gamma exited ${recv.code}: ${recv.stderr.slice(0, 300)}`);
    assert.equal(recv.stdout.trim().split("\n").length, 2, `gamma's two messages: ${recv.stdout}`);
    doc = await doctor(h, port);
    assert.equal(doc.mailbox.pending, 0, `doctor.mailbox.pending is ${doc.mailbox.pending} after gamma collected, want 0 — a hard-coded key would not move`);
    assert.deepEqual(doc.mailbox.pendingAgents, [], `doctor.mailbox.pendingAgents after the recv: ${JSON.stringify(doc.mailbox.pendingAgents)}`);
    assert.equal(doc.mailbox.pendingBytes, 0, `doctor.mailbox.pendingBytes is ${doc.mailbox.pendingBytes} with nothing pending`);
    assert.equal(doc.mailbox.oldestPending, null, `doctor.mailbox.oldestPending is ${doc.mailbox.oldestPending} with nothing pending, want null`);
    assert.equal(doc.mailbox.agents, 1, `doctor.mailbox.agents is ${doc.mailbox.agents} after the recv, want 1 — a collected mailbox is still a mailbox`);

    // (f) one character wrong in <to>: the sender is told msg <id> → bteta and exits 0, and nobody
    // will ever read it. The report must name the orphan, not just count it.
    for (const to of ["beta", "bteta"]) {
      const r = await cli(["msg", "send", "alpha", to, "for-beta", "real"], h);
      assert.equal(r.code, 0, `msg send alpha ${to} exited ${r.code}: ${r.stderr.slice(0, 300)}`);
      assert.match(r.stdout, new RegExp(`^msg \\S+ → ${to}\\n$`), `the typo'd send is reported as a success, as measured: ${r.stdout}`);
    }
    const beta = await cli(["msg", "recv", "beta"], h);
    assert.equal(beta.code, 0, `msg recv beta exited ${beta.code}: ${beta.stderr.slice(0, 300)}`);
    assert.equal(beta.stdout.trim().split("\n").length, 1, `beta's one message — not the typo's: ${beta.stdout}`);
    doc = await doctor(h, port);
    assert.deepEqual(doc.mailbox.pendingAgents, ["bteta"], `the orphan must be nameable: pendingAgents is ${JSON.stringify(doc.mailbox.pendingAgents)}, want ["bteta"]`);
    assert.equal(doc.mailbox.pending, 1, `doctor.mailbox.pending is ${doc.mailbox.pending}, want 1 (the typo's message alone)`);
    assert.equal(doc.mailbox.agents, 3, `doctor.mailbox.agents is ${doc.mailbox.agents}, want 3 (gamma, beta, bteta)`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});
