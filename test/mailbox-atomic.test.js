/**
 * A mailbox message is complete or absent, and a file the reader cannot parse stays where it lies and is named
 * (TMUX-187, gate G1 correctness — silent message loss under a race).
 *
 * Measured 2026-09-30 on 0cd6bb1 (this file against the parent's dist, scratch/ga-fire-2026-09-30-16Z/red-parent-atomic.log):
 * Mailbox.send() wrote the message with one writeFileSync onto its final `.json` name — open(O_TRUNC), then write() — and
 * receive() read every `.json`, took its `skip malformed` catch on the one it could not parse and fell through to
 * renameSync(archive) regardless. Forced through test/fixtures/mailbox-fs.cjs, a `msg recv` run between the sender's open
 * and its write returned nothing and archived the empty file, and the sender's bytes then landed in archive/ through the
 * still-open descriptor: the message was never delivered and nothing said so on any surface. The coverage record had shown
 * that catch taken in 3 of 5 reads on cb4099a with no case planting an unreadable file (the 241st fire's covdiff) — an
 * error path covered by chance, never by a case.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) atomicity, observable: under the fixture, no `.json` path in an inbox is ever the target of a writeFileSync — the
 *       bytes go to a dot-prefixed sibling that does not end in `.json`, and the final name appears through renameSync
 *       alone, in the SAME directory (one filesystem: the rename is atomic) — RED on 0cd6bb1, writeFileSync onto the
 *       `.json` itself and no rename; the case also asserts the log names the inbox write it wrapped, so a preload that
 *       never loaded reds it instead of passing it vacuously;
 *   (b) the race, forced: a `msg recv` interleaved between the sender's open and write delivers nothing, and the NEXT
 *       `msg recv` delivers the message intact, archive/ then holding exactly it — RED on 0cd6bb1: the next read is empty
 *       too and the body sits in archive/;
 *   (c) a corrupt file does not vanish: a non-JSON `.json` planted in an inbox is still there after the read, the readable
 *       message beside it is delivered, and stderr carries ONE line naming the file behind `msg recv: ` (exit 0 — a
 *       supervising script polls this in a loop); a second read says it again — RED on 0cd6bb1: the file is in archive/,
 *       stderr empty;
 *   (d) the note is not printed unconditionally: a read with nothing unreadable carries no such line — the control, green
 *       on both trees, that stops (c) from being satisfied by a line printed always;
 *   (e) `Mailbox.receive()` — the signature VERSIONING item 6 covers, which no surface calls any more — is `collect()`'s
 *       messages alone, in-process on the built module: it delivers what parses, leaves what does not where it lies,
 *       and a read of a name nobody has sent to is still an empty read that creates nothing — RED on 0cd6bb1:
 *       the corrupt file is archived, and `collect()` does not exist.
 *
 * Run: node --test test/mailbox-atomic.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { Mailbox } from "../dist/adapters/messaging/mailbox.js";
import { Ledger } from "../dist/core/ledger.js";
import { removeTempHomes, tempHome } from "./helpers/temp-home.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const FIXTURE = join(ROOT, "test", "fixtures", "mailbox-fs.cjs");
// A mailbox verb touches no tmux server; the bound is against a hang, not a slow read.
const BOUND_MS = 20_000;

after(() => removeTempHomes()); // every home this file made

/** msg touches no tmux server; the isolated socket is hygiene, not a dependency. */
function socket() {
  return `ta-mbatom-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** A throwaway home and, beside it, the file the fixture logs to — never inside the home the verbs write. */
function home(tag) {
  const T = tempHome(`ta-mbatom-${tag}-`);
  return { h: join(T, "home"), log: join(T, "mailbox-fs.log") };
}

/** The built CLI, synchronously: { code, stdout, stderr }; code is a string when the bound fired — a hang, not a refusal. */
function cli(args, h, env = {}) {
  const r = spawnSync(process.execPath, [BIN, "--socket", socket(), ...args], {
    env: { ...process.env, TMUX_AGENT_HOME: h, ...env },
    encoding: "utf8",
    timeout: BOUND_MS,
    killSignal: "SIGKILL",
  });
  return { code: r.status ?? `killed by ${r.signal} after ${BOUND_MS} ms`, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

/** The fixture's environment for one CLI run: preloaded via NODE_OPTIONS (APPENDED — a coverage run's own options stay). */
function planted(log, race) {
  const env = { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${FIXTURE}`].filter(Boolean).join(" "), TA_MAILBOX_LOG: log };
  if (race) env.TA_MAILBOX_RACE = race;
  return env;
}

const lines = (log) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
const inbox = (h, agent) => join(h, "mailbox", agent, "inbox");
const archive = (h, agent) => join(h, "mailbox", agent, "archive");
const listing = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : "<absent>");
const messages = (stdout) => stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tuple = (m) => [m.from, m.to, m.subject, m.body];

test("(a) a message reaches its .json name by rename alone: no inbox .json is ever a writeFileSync target, temp and final share one directory, and the fixture bit", () => {
  const { h, log } = home("atomic");
  const r = cli(["msg", "send", "alpha", "beta", "hello", "body", "words"], h, planted(log));
  assert.equal(r.code, 0, `msg send under the fixture exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  const L = lines(log);
  const writes = L.filter((l) => l.startsWith("writeFileSync ")).map((l) => l.slice("writeFileSync ".length));
  const renames = L.filter((l) => l.startsWith("renameSync ")).map((l) => l.slice("renameSync ".length).split(" -> "));
  // the fixture bit: the send wrote INTO the inbox through the wrapped call — an empty log is a preload that never
  // loaded, and the claims below would then be about nothing
  const intoInbox = writes.filter((p) => dirname(p) === inbox(h, "beta"));
  assert.equal(intoInbox.length, 1, `exactly one writeFileSync into beta's inbox, got ${JSON.stringify(writes)} (an empty log: the preload never loaded)`);
  // the claim: the bytes never go onto a .json name — the name both readers filter on appears by rename alone
  assert.ok(!intoInbox[0].endsWith(".json"), `the message was written straight onto its .json name (0cd6bb1's shape — a reader listing the inbox between open and write sees a torn file): ${intoInbox[0]}`);
  assert.ok(basename(intoInbox[0]).startsWith("."), `the temp name is dot-prefixed, the shape ledger-retention's archives use: ${intoInbox[0]}`);
  const renamedIn = renames.filter(([, to]) => dirname(to) === inbox(h, "beta"));
  assert.equal(renamedIn.length, 1, `exactly one renameSync into beta's inbox, got ${JSON.stringify(renames)} (0cd6bb1: none — nothing was renamed into place)`);
  assert.equal(renamedIn[0][0], intoInbox[0], `the rename's source must be the file the write made: ${JSON.stringify(renamedIn[0])}`);
  assert.ok(renamedIn[0][1].endsWith(".json"), `the rename's destination is the .json name the readers deliver: ${renamedIn[0][1]}`);
  assert.equal(dirname(renamedIn[0][0]), dirname(renamedIn[0][1]), `temp and final name must share ONE directory — rename() is atomic within a filesystem, not across two: ${JSON.stringify(renamedIn[0])}`);
  // on disk: the inbox holds exactly the .json and no leftover temp, and it round-trips as sent
  assert.deepEqual(listing(inbox(h, "beta")), [basename(renamedIn[0][1])], `the inbox holds exactly the renamed .json: ${JSON.stringify(listing(inbox(h, "beta")))}`);
  const got = cli(["msg", "recv", "beta"], h);
  assert.equal(got.code, 0, `msg recv beta exited ${got.code}: ${got.stderr.slice(0, 300)}`);
  assert.deepEqual(messages(got.stdout).map(tuple), [["alpha", "beta", "hello", "body words"]], `the message did not round-trip as sent: ${got.stdout}`);
  assert.equal(got.stderr, "", `(d) a read with nothing unreadable printed a note: ${got.stderr.slice(0, 300)}`);
});

test("(b) a read interleaved between the sender's open and write delivers nothing, and the NEXT read delivers the message intact — not the archive", () => {
  const { h, log } = home("race");
  const r = cli(["msg", "send", "alpha", "beta", "racing", "the", "body"], h, planted(log, "beta"));
  assert.equal(r.code, 0, `msg send under the forced race exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  const race = lines(log).filter((l) => l.startsWith("race: "));
  assert.equal(race.length, 1, `the fixture ran the interleaved read exactly once, log: ${JSON.stringify(lines(log))}`);
  assert.match(race[0], /-> exit 0 stdout "" stderr ""/, `the interleaved read must deliver nothing and say nothing — the message is not complete yet, and the inbox exists (no unknown-agent note): ${race[0]}`);
  // the loss, or its absence: what does the NEXT read see?
  const next = cli(["msg", "recv", "beta"], h);
  assert.equal(next.code, 0, `msg recv beta after the race exited ${next.code}: ${next.stderr.slice(0, 300)}`);
  assert.deepEqual(messages(next.stdout).map(tuple), [["alpha", "beta", "racing", "the body"]],
    `the read after the race must deliver the message — on 0cd6bb1 the interleaved read archived the empty .json and the sender's bytes landed in archive/ through its open descriptor, never delivered: stdout ${JSON.stringify(next.stdout)}, archive ${JSON.stringify(listing(archive(h, "beta")))}, inbox ${JSON.stringify(listing(inbox(h, "beta")))}`);
  assert.equal(next.stderr, "", `(d) the delivering read printed a note: ${next.stderr.slice(0, 300)}`);
  // afterwards: the inbox is empty (no temp left behind) and archive/ holds exactly the delivered message
  assert.deepEqual(listing(inbox(h, "beta")), [], `the inbox after delivery: ${JSON.stringify(listing(inbox(h, "beta")))}`);
  const arch = listing(archive(h, "beta"));
  assert.equal(arch.length, 1, `archive/ holds exactly the delivered message: ${JSON.stringify(arch)}`);
  assert.equal(JSON.parse(readFileSync(join(archive(h, "beta"), arch[0]), "utf8")).subject, "racing", "the archived file is the delivered message, complete");
});

test("(c) a file that will not parse stays in the inbox and is named on stderr, the readable message beside it is delivered, and a second read says it again; (d) a clean read says nothing", () => {
  const { h } = home("corrupt");
  let r = cli(["msg", "send", "alpha", "gamma", "good", "readable"], h);
  assert.equal(r.code, 0, `msg send alpha gamma exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  const bad = join(inbox(h, "gamma"), "zzz-corrupt.json"); // sorts after the real message: readdir order is delivery order
  writeFileSync(bad, "{ not json", { mode: 0o600 });
  const note = 'msg recv: 1 unreadable message file(s) for "gamma" left in the inbox, not archived — zzz-corrupt.json';

  r = cli(["msg", "recv", "gamma"], h);
  assert.equal(r.code, 0, `exit 0 — the readable message was delivered and a poll loop must go on: ${r.code}, ${r.stderr.slice(0, 300)}`);
  assert.deepEqual(messages(r.stdout).map((m) => m.subject), ["good"], `the readable message beside the corrupt one is delivered: ${r.stdout}`);
  assert.equal(existsSync(bad), true, `the unreadable file was moved out of the inbox (0cd6bb1: archived unread, silently) — inbox ${JSON.stringify(listing(inbox(h, "gamma")))}, archive ${JSON.stringify(listing(archive(h, "gamma")))}`);
  assert.equal(listing(archive(h, "gamma")).includes("zzz-corrupt.json"), false, `the unreadable file must not be in archive/: ${JSON.stringify(listing(archive(h, "gamma")))}`);
  const said = r.stderr.trim().split("\n").filter(Boolean);
  assert.equal(said.length, 1, `ONE stderr line, not none (0cd6bb1) and not a stack trace: ${JSON.stringify(r.stderr.slice(0, 400))}`);
  assert.equal(said[0], note, `the line names the count, the agent as typed and the file: ${JSON.stringify(said[0])}`);

  // not a one-shot: the file is still there on the next read, and still said
  r = cli(["msg", "recv", "gamma"], h);
  assert.equal(r.code, 0, `the second msg recv gamma exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  assert.equal(r.stdout, "", `the second read re-delivered: ${r.stdout.slice(0, 200)}`);
  assert.equal(existsSync(bad), true, "the unreadable file vanished between the first read and the second");
  assert.equal(r.stderr.trim(), note, `the second read must say it again — a corrupt file must never become invisible: ${JSON.stringify(r.stderr.slice(0, 400))}`);

  // (d) the control: a read with nothing unreadable carries no such line, and TMUX-125's unknown-agent note still stands alone
  r = cli(["msg", "send", "alpha", "delta", "clean", "read"], h);
  assert.equal(r.code, 0, `msg send alpha delta exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  r = cli(["msg", "recv", "delta"], h);
  assert.equal(r.code, 0, `msg recv delta exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  assert.equal(messages(r.stdout).length, 1, `delta's one message: ${r.stdout}`);
  assert.equal(r.stderr, "", `a read with nothing unreadable printed a note — the line would then signal nothing: ${r.stderr.slice(0, 300)}`);
  r = cli(["msg", "recv", "ghost-nobody"], h);
  assert.equal(r.code, 0, `msg recv ghost-nobody exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  assert.match(r.stderr.trim(), /^msg recv: no mailbox for "ghost-nobody" —/, `the unknown-agent note is untouched, and is the only line: ${JSON.stringify(r.stderr.slice(0, 300))}`);
  assert.equal(r.stderr.trim().split("\n").length, 1, `one line for an unknown agent, no unreadable-file line beside it: ${JSON.stringify(r.stderr.slice(0, 300))}`);
});

test("(e) receive() — the signature item 6 covers — is collect()'s messages alone: it delivers what parses, leaves what does not, and a never-sent-to name is an empty read that creates nothing", () => {
  const { h } = home("receive");
  const mb = new Mailbox(join(h, "mailbox"), new Ledger(join(h, "ledger")));
  const sent = mb.send("alpha", "eps", "one", "first");
  assert.deepEqual(listing(inbox(h, "eps")).filter((f) => f.endsWith(".json")).length, 1, `the send left exactly one .json in the inbox: ${JSON.stringify(listing(inbox(h, "eps")))}`);
  const bad = join(inbox(h, "eps"), "zzz-corrupt.json");
  writeFileSync(bad, "{ not json", { mode: 0o600 });
  const got = mb.receive("eps");
  assert.deepEqual(got.map(tuple), [["alpha", "eps", "one", "first"]], `receive() delivers what parses: ${JSON.stringify(got)}`);
  assert.equal(got[0].id, sent.id, "the delivered message is the one sent");
  assert.equal(existsSync(bad), true, `receive() moved the unreadable file out of the inbox (0cd6bb1: archived unread): inbox ${JSON.stringify(listing(inbox(h, "eps")))}, archive ${JSON.stringify(listing(archive(h, "eps")))}`);
  assert.deepEqual(mb.collect("eps"), { messages: [], malformed: ["zzz-corrupt.json"] }, "collect() names the file receive() left, and nothing else remains");
  assert.deepEqual(mb.receive("eps"), [], "a second receive() is empty — the corrupt file is neither delivered nor archived");
  assert.equal(existsSync(bad), true, "the unreadable file is still there after the second read");
  assert.deepEqual(mb.receive("nobody-ever"), [], "a read of a name nobody has sent to is an empty read");
  assert.deepEqual(mb.collect("nobody-ever"), { messages: [], malformed: [] }, "and collect() says the same, with nothing unreadable");
  assert.equal(existsSync(join(h, "mailbox", "nobody-ever")), false, "the read CREATED a mailbox — TMUX-120's rule, on collect()'s path");
});
