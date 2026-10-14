/**
 * A mailbox agent name is a path segment under <home>/mailbox, judged by the session-name rule before any
 * directory is created — refused with exit 64 at the CLI (isError over MCP: test/mcp.test.js); the mailbox's
 * directories are 0700 and its message files 0600 (TMUX-107; gates G2 no test named an agent name, a traversal
 * or the message file's mode and the threat model did not mention the mailbox; G1 the one class of positional
 * value the verb then acts on that TMUX-104/105/106 left unjudged).
 *
 * Measured 2026-09-15 04:2xZ on d8979b9 (scratch/ga-fire-2026-09-15-04Z/mailbox-probe/run1-d8979b9.log,
 * run2-d8979b9-mcp.log): Mailbox.inbox() was join(root, agent, "inbox") with no check on the name and the CLI
 * handed rest[1..3] straight through. `msg send vp-a ../../outside hello body` wrote a 664 message file into
 * <probe>/outside/inbox — a sibling of the 0700 home, inside a 775 directory the verb created — and exited 0;
 * `msg recv ../../outside` read every *.json there and renamed each into an archive/ it created, exit 0, the
 * ledger's session field the path as typed; `msg send vp-a '' hello` delivered to <home>/mailbox/inbox — an
 * agent named nothing; `msg send vp-a team/lead hello` nested a directory; `msg send ../x vp-c hello` died in
 * Node's ENOENT with the argument unnamed (the <from> is spliced into the file name). The home was 0700 and its
 * ledger 0600; mailbox/ was 775 and the message file 664.
 *
 * Black-box through the built CLI like test/positional-count.test.js: the contract is the exit code, the
 * streams and what did NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run
 * cannot hang the suite. The home is nested one level inside the test's temp dir so that a traversal that
 * gets through (the red) lands INSIDE the temp dir, never beside it. The contract, each line a check that
 * FAILS if the property is removed:
 *   (a) `msg send vp-a ../../outside hello body` → 64, one stderr line naming <to>, the value as typed and the
 *       rule; nothing on stdout; <tmp>/outside absent; the not-yet-existing home still absent — RED on
 *       d8979b9: exit 0, the file under <tmp>/outside/inbox, the home created;
 *   (b) `msg recv ../../outside`, `msg recv ''`, `msg recv ..` → 64 naming <agent>; no directory anywhere —
 *       RED: exit 0, inbox/ and archive/ created outside the home;
 *   (c) `msg send vp-a '' hello`, `team/lead`, `.hidden` and a 65-char name → 64 naming <to> — RED: exit 0,
 *       delivered / nested;
 *   (d) `msg send ../x vp-c hello`, `msg send '' vp-c hello`, `a/b` → 64 naming <from>; a bad <from> and a
 *       bad <to> together name <from>, the header's order — RED: Node's ENOENT exit 1 / delivered from nobody;
 *   (e) the controls, green before and after: `msg send a.b_c-d e.f_g-h hi body words` and a 64-char name
 *       round-trip as sent; the ledger holds exactly their message.sent / message.received rows and none for a
 *       refusal made against the same home;
 *   (f) modes: after the send <home>/mailbox, <home>/mailbox/<agent> and its inbox/ are 0700 and the message
 *       file 0600; after recv, archive/ is 0700 and the archived file 0600 — RED: 775 / 664; a pre-existing
 *       775 mailbox/ is brought to 0700 by the next send (the chmod, not only the mkdir mode);
 *   (g) the rule cannot drift: the regex literal in src/adapters/messaging/mailbox.ts equals the session-name
 *       literal in src/core/tmux.ts, and is the documented one.
 *
 * Run: node --test test/agent-name.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const MAILBOX_SRC = join(ROOT, "src", "adapters", "messaging", "mailbox.ts");
const TMUX_SRC = join(ROOT, "src", "core", "tmux.ts");
// A refusal is one process start; a red run (the parent's exit 0 after the write) still ends inside the bound.
const BOUND_MS = 5_000;
const RULE = "alnum start, [A-Za-z0-9._-], at most 64";

/** msg touches no tmux server; the isolated socket is hygiene, so a regression cannot reach the default one. */
function socket() {
  return `ta-agentname-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
const mode = (p) => (statSync(p).mode & 0o777).toString(8);
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** A refusal is exit 64, nothing on stdout, exactly one stderr line: the verb, the argument, the value as typed and the rule. */
function assertRefused(r, verb, role, value, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `${verb}: <${role}> ${JSON.stringify(value)} is not an agent name — ${RULE}`, `${label}: the verb, the argument, the value as typed and the rule`);
}

test("an agent name that is a path is refused with exit 64 naming the argument, before the home exists", async () => {
  const T = mkdtempSync(join(tmpdir(), "ta-agentname-"));
  const S = socket();
  const home = join(T, "home"); // nested: `../../outside` from <home>/mailbox is <T>/outside — inside T, never beside it
  const env = { TMUX_AGENT_HOME: home };
  try {
    // (a) <to> climbs out of the home
    let r = await cli(["--socket", S, "msg", "send", "vp-a", "../../outside", "hello", "body"], env);
    assertRefused(r, "msg send", "to", "../../outside", "msg send vp-a ../../outside hello body");
    // (b) recv on a path: nothing read, nothing created
    for (const agent of ["../../outside", "", ".."]) {
      r = await cli(["--socket", S, "msg", "recv", agent], env);
      assertRefused(r, "msg recv", "agent", agent, `msg recv ${JSON.stringify(agent)}`);
    }
    // (c) <to>: empty, nested, dot-led, one over the bound
    for (const to of ["", "team/lead", ".hidden", "a".repeat(65)]) {
      r = await cli(["--socket", S, "msg", "send", "vp-a", to, "hello"], env);
      assertRefused(r, "msg send", "to", to, `msg send vp-a ${JSON.stringify(to)} hello`);
    }
    // (d) <from>: spliced into the file name and the ledger's actor
    for (const from of ["../x", "", "a/b"]) {
      r = await cli(["--socket", S, "msg", "send", from, "vp-c", "hello"], env);
      assertRefused(r, "msg send", "from", from, `msg send ${JSON.stringify(from)} vp-c hello`);
    }
    r = await cli(["--socket", S, "msg", "send", "../x", "../../outside", "hello"], env);
    assertRefused(r, "msg send", "from", "../x", "msg send ../x ../../outside hello");
    // nothing was created anywhere: not the home (so no ledger row), not the traversal target
    assert.equal(existsSync(home), false, "a refusal created the home before the name was judged (on d8979b9 the message was delivered)");
    assert.deepEqual(readdirSync(T), [], `a refusal left something in the temp dir: ${readdirSync(T).join(", ")}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("valid names round-trip unchanged, the mailbox is 0700 and its message files 0600, and no refusal reaches the ledger", async () => {
  const T = mkdtempSync(join(tmpdir(), "ta-agentname-ctl-"));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  const LONG = "n" + "0".repeat(63); // 64 characters — the rule's bound, valid
  try {
    // (e) the controls: every character class the rule admits, and the longest name it admits
    let r = await cli(["--socket", S, "msg", "send", "a.b_c-d", "e.f_g-h", "hi", "body", "words"], env, 20_000);
    assert.equal(r.code, 0, `msg send a.b_c-d e.f_g-h hi body words exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.match(r.stdout, /^msg \S+ → e\.f_g-h\n$/, `the send's one stdout line: ${r.stdout}`);
    r = await cli(["--socket", S, "msg", "send", "a.b_c-d", LONG, "hi"], env, 20_000);
    assert.equal(r.code, 0, `msg send a.b_c-d <64-char name> hi exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    // (f) modes on the way in: the directories 0700, the message file 0600 — the ledger's own (THREAT-MODEL finding 8)
    const inbox = join(home, "mailbox", "e.f_g-h", "inbox");
    const files = readdirSync(inbox);
    assert.equal(files.length, 1, `one message in the inbox, got: ${files.join(", ")}`);
    for (const d of [join(home, "mailbox"), join(home, "mailbox", "e.f_g-h"), inbox]) assert.equal(mode(d), "700", `${d.slice(home.length)} is ${mode(d)}, want 700 (on d8979b9: 775)`);
    assert.equal(mode(join(inbox, files[0])), "600", `the message file is ${mode(join(inbox, files[0]))}, want 600 (on d8979b9: 664)`);
    // the round-trip, and the modes on the way out
    r = await cli(["--socket", S, "msg", "recv", "e.f_g-h"], env, 20_000);
    assert.equal(r.code, 0, `msg recv e.f_g-h exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    const got = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(got.map((m) => [m.from, m.to, m.subject, m.body]), [["a.b_c-d", "e.f_g-h", "hi", "body words"]], "the message did not round-trip as sent");
    const archive = join(home, "mailbox", "e.f_g-h", "archive");
    assert.equal(mode(archive), "700", `archive/ is ${mode(archive)}, want 700`);
    assert.deepEqual(readdirSync(archive), files, "the message was not archived under its own name");
    assert.equal(mode(join(archive, files[0])), "600", `the archived file is ${mode(join(archive, files[0]))}, want 600`);
    assert.deepEqual(readdirSync(inbox), [], "the inbox was not emptied — a second recv would re-deliver");
    r = await cli(["--socket", S, "msg", "recv", LONG], env, 20_000);
    assert.equal(r.code, 0, `msg recv <64-char name> exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(r.stdout.trim().split("\n").length, 1, `the 64-char agent's one message: ${r.stdout}`);
    // a refusal against the SAME, existing home: nothing beside it, nothing in the ledger (asserted below)
    r = await cli(["--socket", S, "msg", "send", "vp-a", "../../outside", "hello"], env);
    assertRefused(r, "msg send", "to", "../../outside", "msg send vp-a ../../outside hello (home exists)");
    assert.deepEqual(readdirSync(T), ["home"], `something landed beside the existing home: ${readdirSync(T).join(", ")}`);
    // a pre-existing world-traversable mailbox/ is brought to 0700 by the next send: the chmod, not only the mkdir mode
    const home2 = join(T, "home2");
    mkdirSync(join(home2, "mailbox", "vp-x", "inbox"), { recursive: true, mode: 0o775 });
    assert.notEqual(mode(join(home2, "mailbox")), "700", "test setup: the pre-existing mailbox/ must not already be 700");
    r = await cli(["--socket", S, "msg", "send", "vp-w", "vp-x", "hi"], { TMUX_AGENT_HOME: home2 }, 20_000);
    assert.equal(r.code, 0, `msg send into a pre-existing mailbox exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    for (const d of ["mailbox", "mailbox/vp-x", "mailbox/vp-x/inbox"]) assert.equal(mode(join(home2, d)), "700", `pre-existing ${d} is ${mode(join(home2, d))} after a send, want 700`);
    // the ledger: one row per delivered message each way, the session an agent name — and none for the refusal
    const rows = readdirSync(join(home, "ledger")).filter((f) => f.endsWith(".ndjson")).flatMap((f) => readFileSync(join(home, "ledger", f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
    const msgs = rows.filter((e) => e.type.startsWith("message."));
    assert.deepEqual(msgs.map((e) => [e.type, e.session, e.actor]), [
      ["message.sent", "e.f_g-h", "a.b_c-d"], ["message.sent", LONG, "a.b_c-d"],
      ["message.received", "e.f_g-h", "a.b_c-d"], ["message.received", LONG, "a.b_c-d"],
    ], "the ledger's message rows are not exactly the four deliveries (on d8979b9 a refused path was a session)");
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("the mailbox's agent-name rule is the session-name rule, verbatim — one rule in two files, no drift", () => {
  // (g) tmux.ts: `!/^[A-Za-z0-9]…/.test(name)`; mailbox.ts: `export const AGENT_NAME = /…/;` — the same literal
  const tmuxRule = /!\/(\^\[A-Za-z0-9\][^/]*)\/\.test\(name\)/.exec(readFileSync(TMUX_SRC, "utf8"));
  assert.ok(tmuxRule, "src/core/tmux.ts assertName no longer tests the name against a regex literal");
  const mailboxRule = /^export const AGENT_NAME = \/(.+)\/;$/m.exec(readFileSync(MAILBOX_SRC, "utf8"));
  assert.ok(mailboxRule, "src/adapters/messaging/mailbox.ts no longer exports AGENT_NAME as a regex literal");
  assert.equal(mailboxRule[1], tmuxRule[1], "the mailbox's rule has drifted from the session-name rule");
  assert.equal(mailboxRule[1], "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", "the rule is not the documented one");
});
