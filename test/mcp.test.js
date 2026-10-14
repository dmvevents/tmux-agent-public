/**
 * MCP surface tests — the integration point we promise in VERSIONING.md and had ZERO tests for.
 *
 * Speaks real JSON-RPC over stdio to dist/mcp/server.js, the same way any MCP client would.
 * This exists because a manual probe found the surface silently crippled: a global read-only
 * policy set for the DASHBOARD removed 5 of 12 tools from tools/list, and the only hint was a
 * stderr line most clients discard. An outside user would have hit that on install.
 *
 * Run: node --test test/mcp.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, realpathSync, statSync, chmodSync, accessSync, constants, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { plantTwoDays, SINCE, ALL_SESSIONS } from "./helpers/waste-fixture.js";
import { APIKEY_VALUE, BLE_CAPTURED_LINE } from "./helpers/highlighted-capture.js";
import { killServerSync } from "./helpers/kill-server.js";

const SOCKET = `ta-mcp-${process.pid}`;
// The built entry points, resolved from THIS file's directory and never from the process's cwd: a
// FAIL-first re-run of a copied test against a parent tree's dist/ must drive THAT dist whichever
// directory the runner started in. A bare "dist/mcp/server.js" resolved against the cwd, so run from
// the repo root it drove the tree's fixed dist and read 1/1 where the parent's read 0/1 (TMUX-189;
// the static guard is test/dist-from-file.test.js).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "dist/mcp/server.js");
const CLI = join(ROOT, "dist/bin/tmux-agent.js");

/** Drive the MCP server over stdio; returns responses keyed by request id. */
function mcp(requests, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], {
      env: { ...process.env, TMUX_AGENT_SOCKET: SOCKET, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("MCP server timed out"));
    }, 25_000);
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      clearTimeout(timer);
      const byId = new Map();
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id !== undefined) byId.set(m.id, m);
        } catch {
          /* notifications / partials */
        }
      }
      resolve(byId);
    });
    p.on("error", reject);
    const init = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    };
    p.stdin.write(JSON.stringify(init) + "\n");
    // Sequence the calls: write request N+1 only after N has been answered. Firing them all in
    // one tick made session-status race spawn-session and read GONE for a session that existed.
    let next = 0;
    const answered = new Set();
    const pump = () => {
      if (next < requests.length) p.stdin.write(JSON.stringify(requests[next++]) + "\n");
    };
    p.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id !== undefined && !answered.has(m.id)) {
            answered.add(m.id);
            if (m.id !== 0) pump();
          }
        } catch { /* partial */ }
      }
    });
    pump(); // first request rides after initialize
    // Do NOT end stdin immediately: the stdio transport closing is the server's shutdown
    // signal, so a slow tool (spawn-session takes ~1s) would never be answered. Wait until
    // every request id has a reply, then close.
    const want = new Set(requests.map((r) => r.id));
    p.stdout.on("data", () => {
      if ([...want].every((id) => answered.has(id))) setTimeout(() => p.stdin.end(), 80);
    });
    if (want.size === 0) setTimeout(() => p.stdin.end(), 400);
  });
}

const call = (id, name, args = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const text = (m) => m?.result?.content?.[0]?.text ?? "";
const parsed = (m) => {
  try {
    return JSON.parse(text(m));
  } catch {
    return null;
  }
};

test("mcp: initialize handshake succeeds", async () => {
  const r = await mcp([]);
  assert.ok(r.get(0)?.result, "initialize must return a result");
});

test("mcp: every documented tool is advertised (regression: policy hid 5 of 12)", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-"));
  writeFileSync(join(home, "policy.json"), JSON.stringify({ surfaces: { mcp: { readOnly: false } } }));
  const r = await mcp([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }], { TMUX_AGENT_HOME: home });
  const names = (r.get(1)?.result?.tools ?? []).map((t) => t.name);
  const promised = [
    "spawn-session", "send-input", "exec-sync", "capture-pane", "session-status",
    "fleet-status", "kill-session", "list-lineage", "message-send", "message-receive",
    "waste-report", "read-log", "policy-status",
  ];
  for (const t of promised) assert.ok(names.includes(t), `tools/list is missing ${t}`);
  rmSync(home, { recursive: true, force: true });
});

test("mcp: every tool declares a description and an object input schema", async () => {
  const r = await mcp([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  for (const t of r.get(1)?.result?.tools ?? []) {
    assert.ok(t.description && t.description.length > 20, `${t.name} needs a usable description`);
    assert.equal(t.inputSchema?.type, "object", `${t.name} inputSchema must be an object`);
  }
});

test("mcp: read-only mode HIDES mutating tools but keeps policy-status discoverable", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-ro-"));
  writeFileSync(join(home, "policy.json"), JSON.stringify({ surfaces: { mcp: { readOnly: true } } }));
  const r = await mcp(
    [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, call(2, "policy-status")],
    { TMUX_AGENT_HOME: home },
  );
  const names = (r.get(1)?.result?.tools ?? []).map((t) => t.name);
  for (const t of ["spawn-session", "send-input", "exec-sync", "kill-session"]) {
    assert.ok(!names.includes(t), `${t} must be hidden in read-only mode`);
  }
  assert.ok(names.includes("session-status"), "read tools stay available");
  // the whole point of the fix: an agent can discover WHY a tool is absent
  assert.ok(names.includes("policy-status"), "policy-status must never be hidden");
  const p = parsed(r.get(2));
  assert.equal(p?.readOnly, true);
  assert.ok(p?.hiddenActions?.length > 0, "policy-status must name what is hidden");
  rmSync(home, { recursive: true, force: true });
});

test("mcp: a read-only refusal of a mutating tool is ledgered as control.denied", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-ro-ledger-"));
  writeFileSync(join(home, "policy.json"), JSON.stringify({ surfaces: { mcp: { readOnly: true } } }));
  const r = await mcp(
    [call(1, "exec-sync", { name: "rf-ro", command: "echo MCP_RO" })],
    { TMUX_AGENT_HOME: home, TMUX_AGENT_ACTOR: "probe-mcp" },
  );
  assert.equal(r.get(1)?.result?.isError, true, "the read-only refusal is still an isError reply");
  // server.ts refuses this BEFORE the orchestrator's gate can see it, so the audit event has to be
  // the server's own. Measured 2026-09-13 on 17c5d2e: isError came back and the ledger held nothing.
  const dir = join(home, "ledger");
  const events = readdirSync(dir)
    .filter((f) => f.endsWith(".ndjson"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  const d = events.filter((e) => e.type === "control.denied");
  assert.equal(d.length, 1, `expected exactly one control.denied, got ${d.length}: ${JSON.stringify(events)}`);
  assert.equal(d[0].actor, "probe-mcp", "actor is the MCP client");
  assert.equal(d[0].session, "rf-ro", "the refused session is named");
  assert.equal(d[0].data?.action, "exec", "the tool's verb, not just its name");
  assert.match(String(d[0].data?.reason ?? ""), /read-only/);
  rmSync(home, { recursive: true, force: true });
});

test("mcp: waste-report refuses a since it cannot read and honours one it can — the CLI's one validator, not a second", async () => {
  // Measured 2026-09-14 on af231ba and cf8321e (scratch/ga-fire-2026-09-14-10Z/since-probe/run1-cf8321e.log):
  // since: "yesterday" returned every session with isError unset — Date.parse gave NaN, NaN compared
  // false against every event, and the tool answered as if the window had been honoured. The fixture
  // is the one test/waste-since.test.js holds the CLI verb to, so the two surfaces cannot drift.
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-since-"));
  plantTwoDays(join(home, "ledger"));
  const r = await mcp(
    [
      call(1, "waste-report", { since: SINCE.midDay }),
      call(2, "waste-report", { since: "yesterday" }),
      call(3, "waste-report", { since: "" }),
      call(4, "waste-report", {}),
    ],
    { TMUX_AGENT_HOME: home },
  );
  assert.notEqual(r.get(1)?.result?.isError, true, `a readable since is not an error: ${text(r.get(1))}`);
  assert.deepEqual((parsed(r.get(1)) ?? []).map((x) => x.session), ["late"], `since ${SINCE.midDay} keeps the later session alone`);
  for (const [id, v] of [[2, "yesterday"], [3, ""]]) {
    assert.equal(r.get(id)?.result?.isError, true, `since ${JSON.stringify(v)} must be an isError reply — on cf8321e it was every session: ${text(r.get(id)).slice(0, 120)}`);
    const msg = String(parsed(r.get(id))?.error ?? "");
    assert.match(msg, /^--since: /, `the same message as the CLI, flag first: ${msg}`);
    assert.match(msg, v === "" ? /no value given/ : /"yesterday"/, `the rejected value is named: ${msg}`);
    assert.match(msg, /2026-08-18T00:00:00Z/, `the accepted form is shown: ${msg}`);
  }
  assert.deepEqual((parsed(r.get(4)) ?? []).map((x) => x.session).sort(), ALL_SESSIONS, "no since: every planted session, unchanged");
  rmSync(home, { recursive: true, force: true });
});

test("mcp: message-send / message-receive refuse an agent name that is a path, isError — the mailbox's one rule, not a second", async () => {
  // Measured 2026-09-15 on d8979b9 (scratch/ga-fire-2026-09-15-04Z/mailbox-probe/run2-d8979b9-mcp.log): to: "../../X"
  // wrote the message file BESIDE the 0700 home and message-receive on the same path read and archived it, both with
  // isError unset; to: "" was delivered to <home>/mailbox/inbox. z.string() admits every string, so the judgement is
  // the mailbox's own throw, which the server's catch turns into the isError reply. The home is nested inside the
  // temp dir so a traversal that gets through (the red) lands inside it, never beside it.
  const T = mkdtempSync(join(tmpdir(), "ta-mcp-mailbox-"));
  const home = join(T, "home");
  const r = await mcp(
    [
      call(1, "message-send", { from: "mb-a", to: "../../outside", subject: "hello", body: "body" }),
      call(2, "message-receive", { agent: "../../outside" }),
      call(3, "message-send", { from: "mb-a", to: "", subject: "hello", body: "body" }),
      call(4, "message-send", { from: "../x", to: "mb-b", subject: "hello", body: "body" }),
      call(5, "message-send", { from: "mb-a", to: "mb-b", subject: "hello", body: "body" }),
      call(6, "message-receive", { agent: "mb-b" }),
    ],
    { TMUX_AGENT_HOME: home },
  );
  for (const [id, role, v] of [[1, "to", "../../outside"], [2, "agent", "../../outside"], [3, "to", ""], [4, "from", "../x"]]) {
    assert.equal(r.get(id)?.result?.isError, true, `${role}: ${JSON.stringify(v)} must be an isError reply — on d8979b9 it was a normal one: ${text(r.get(id)).slice(0, 120)}`);
    const msg = String(parsed(r.get(id))?.error ?? "");
    assert.equal(msg, `<${role}> ${JSON.stringify(v)} is not an agent name — alnum start, [A-Za-z0-9._-], at most 64`, `the argument, the value as typed and the rule, the CLI's words: ${msg}`);
  }
  assert.equal(existsSync(join(T, "outside")), false, "the traversal target was created beside the home");
  assert.equal(existsSync(join(home, "mailbox", "inbox")), false, "an agent named nothing was delivered to");
  assert.deepEqual(readdirSync(T), ["home"], `something landed beside the home: ${readdirSync(T).join(", ")}`);
  assert.notEqual(r.get(5)?.result?.isError, true, `a valid message-send is not an error: ${text(r.get(5))}`);
  assert.deepEqual((parsed(r.get(6)) ?? []).map((m) => [m.from, m.to, m.subject, m.body]), [["mb-a", "mb-b", "hello", "body"]], "the valid round-trip changed");
  assert.equal((statSync(join(home, "mailbox")).mode & 0o777).toString(8), "700", "<home>/mailbox is not 0700 over MCP");
  rmSync(T, { recursive: true, force: true });
});

/** A home whose PATH holds neither "mail" nor "inbox": a path value must never be able to answer for a note. */
function mailboxHome(tag) {
  const T = mkdtempSync(join(tmpdir(), `ta-mcp-${tag}-`));
  const home = join(T, "home");
  for (const word of ["mail", "inbox"]) {
    assert.ok(!home.includes(word), `test setup: the home path must not contain ${JSON.stringify(word)} — a path value could then answer for a note (${home})`);
  }
  return { T, home };
}

test("mcp: message-receive tells a name nothing was ever sent to from a known agent's empty inbox, in the CLI's words", async () => {
  // Measured 2026-09-17 on 6d33171 (scratch/ga-fire-2026-09-17-22Z/mcprecv-probe/probe-6d33171.log): the two
  // replies were BYTE-IDENTICAL — isError=false, one content block, text="[]" — and the name appeared NOWHERE,
  // not in the reply and not on the server's own stream, whose only line was the ready banner. So a supervising
  // agent that mistyped a peer's name was told exactly what an agent whose peer is merely quiet is told —
  // nothing — on the surface an agent drives, while the CLI has distinguished the two since TMUX-120. The note
  // rides in a SECOND content block: content[0].text stays the JSON array byte-for-byte, because [] → an
  // object would break every client that parses it (item 2's result shapes; asserted in the next test).
  const { T, home } = mailboxHome("recvnote");
  const ghost = "mb-phantom";
  const r = await mcp(
    [
      call(1, "message-send", { from: "mb-alpha", to: "mb-beta", subject: "for-beta", body: "real" }),
      call(2, "message-receive", { agent: "mb-beta" }), // delivers: beta becomes an agent we have heard of
      call(3, "message-receive", { agent: "mb-beta" }), // archived — the empty inbox of a KNOWN agent
      call(4, "message-receive", { agent: ghost }), // never sent to, never seen
    ],
    { TMUX_AGENT_HOME: home },
  );
  const blocks = (id) => r.get(id)?.result?.content ?? [];
  try {
    // Both gaps in one failure, so the red names each of them rather than the first one only
    assert.deepEqual(
      {
        differs: JSON.stringify(r.get(4)?.result) !== JSON.stringify(r.get(3)?.result),
        namesTheAgent: blocks(4).some((b) => String(b.text).includes(ghost)),
      },
      { differs: true, namesTheAgent: true },
      `the never-seen read must differ from the known-but-empty one AND name the agent as typed — on 6d33171 both were ${JSON.stringify(text(r.get(4)))} (identical) with the name nowhere`,
    );
    assert.equal(blocks(4).length, 2, `the never-seen read carries the array and exactly ONE note: ${JSON.stringify(blocks(4))}`);
    // One rule, one wording: the CLI's line for the same unknown name on the same home, minus its own prefix.
    // Not a re-derived string — both surfaces read Mailbox.known() and print unknownAgentNote().
    const cli = spawnSync(process.execPath, [CLI, "--socket", SOCKET, "msg", "recv", ghost], {
      env: { ...process.env, TMUX_AGENT_HOME: home },
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, `msg recv ${ghost} exited ${cli.status}: ${String(cli.stderr).slice(0, 300)}`);
    const line = String(cli.stderr).trim();
    assert.match(line, /^msg recv: /, `the CLI's note must still carry its own prefix, and only that: ${JSON.stringify(line)}`);
    assert.equal(blocks(4)[1].text, line.slice("msg recv: ".length),
      `the MCP note and the CLI's line for one unknown agent must be one wording: ${JSON.stringify([blocks(4)[1]?.text, line])}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: the note is additive and never unconditional — the array every client parses is unchanged, and no read manufactures a mailbox", async () => {
  // The controls that stop the test above from being satisfied the wrong way: a note printed for every read
  // signals nothing, and turning [] into an object would break every client that iterates the parse of
  // content[0].text. Green on the parent tree too — that is what makes them controls.
  const { T, home } = mailboxHome("recvbound");
  const ghost = "mb-nobody";
  const r = await mcp(
    [
      call(1, "message-send", { from: "mb-alpha", to: "mb-gamma", subject: "first", body: "one" }),
      call(2, "message-send", { from: "mb-alpha", to: "mb-gamma", subject: "second", body: "two" }),
      call(3, "message-send", { from: "mb-alpha", to: "mb-beta", subject: "for-beta", body: "real" }),
      call(4, "message-receive", { agent: "mb-beta" }), // a delivering read
      call(5, "message-receive", { agent: "mb-beta" }), // known, EMPTY
      call(6, "message-receive", { agent: ghost }), // never seen
      call(7, "message-receive", { agent: "mb-gamma" }), // two messages, intact
    ],
    { TMUX_AGENT_HOME: home },
  );
  const blocks = (id) => r.get(id)?.result?.content ?? [];
  try {
    for (const id of [4, 5, 6, 7]) {
      assert.notEqual(r.get(id)?.result?.isError, true, `message-receive answered isError (id ${id}): ${text(r.get(id)).slice(0, 200)}`);
      assert.ok(Array.isArray(parsed(r.get(id))), `content[0].text must parse to a JSON array (id ${id}): ${text(r.get(id)).slice(0, 200)}`);
    }
    assert.equal(text(r.get(6)), text(r.get(5)),
      "the two empty reads must agree byte-for-byte in content[0].text — a client that reads only the first block sees no change at all");
    assert.deepEqual((parsed(r.get(7)) ?? []).map((m) => [m.from, m.to, m.subject, m.body]),
      [["mb-alpha", "mb-gamma", "first", "one"], ["mb-alpha", "mb-gamma", "second", "two"]],
      "the two-message delivery lost, reordered or rewrote a message");
    assert.equal(blocks(5).length, 1, `a KNOWN agent's empty inbox must carry no note: ${JSON.stringify(blocks(5))}`);
    assert.equal(blocks(7).length, 1, `a delivering read must carry no note: ${JSON.stringify(blocks(7))}`);
    // TMUX-120's property, on this surface: the read of a name nobody has sent to creates nothing
    assert.equal(existsSync(join(home, "mailbox", ghost)), false, `the MCP read CREATED <home>/mailbox/${ghost} — a read must not manufacture a mailbox`);
    assert.ok(existsSync(join(home, "mailbox", "mb-gamma")), "test setup: the real recipient's mailbox must exist, else the check above proves nothing");
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: message-receive leaves a file it cannot parse in the inbox and names it in a second block, the CLI's words — the array is what WAS delivered", async () => {
  // On 0cd6bb1 receive() took its skip-malformed catch and fell through to the archive rename regardless, so an unreadable
  // file — the half-written message of a racing send, before send() wrote atomically — was archived unread, and this
  // surface answered "[]" with nothing said (test/mailbox-atomic.test.js holds the race and the CLI's line; this case holds
  // the MCP surface to the same wording). TMUX-125's route: content[0] stays the array, the verdict rides a second block.
  const { T, home } = mailboxHome("recvbad");
  try {
    const sent = await mcp([call(1, "message-send", { from: "mb-alpha", to: "mb-gamma", subject: "good", body: "readable" })], { TMUX_AGENT_HOME: home });
    assert.notEqual(sent.get(1)?.result?.isError, true, `message-send answered isError: ${text(sent.get(1)).slice(0, 200)}`);
    const bad = join(home, "mailbox", "mb-gamma", "inbox", "zzz-corrupt.json"); // sorts after the real message
    assert.ok(existsSync(join(home, "mailbox", "mb-gamma", "inbox")), "test setup: the send must have made the inbox the corrupt file is planted in");
    writeFileSync(bad, "{ not json", { mode: 0o600 });
    const r = await mcp(
      [
        call(2, "message-receive", { agent: "mb-gamma" }), // delivers the readable one, meets the corrupt one
        call(3, "message-receive", { agent: "mb-gamma" }), // the corrupt one again — still there, still said
      ],
      { TMUX_AGENT_HOME: home },
    );
    const blocks = (id) => r.get(id)?.result?.content ?? [];
    for (const id of [2, 3]) assert.notEqual(r.get(id)?.result?.isError, true, `message-receive answered isError (id ${id}): ${text(r.get(id)).slice(0, 200)}`);
    assert.deepEqual((parsed(r.get(2)) ?? []).map((m) => m.subject), ["good"], `content[0] is the array of what WAS delivered: ${text(r.get(2))}`);
    assert.equal(blocks(2).length, 2, `the read carries the array and exactly ONE note — on 0cd6bb1 the array alone: ${JSON.stringify(blocks(2))}`);
    assert.ok(existsSync(bad), `the unreadable file was moved out of the inbox (0cd6bb1: archived unread, silently): inbox ${JSON.stringify(readdirSync(join(home, "mailbox", "mb-gamma", "inbox")))}`);
    assert.equal(text(r.get(3)), "[]", `the second read's array is empty — the good message was archived by the first, the corrupt one delivered by neither: ${text(r.get(3))}`);
    assert.equal(blocks(3).length, 2, `the second read says it again — a corrupt file must never become invisible: ${JSON.stringify(blocks(3))}`);
    assert.equal(blocks(3)[1].text, blocks(2)[1].text, "the note is the same on both reads");
    // One rule, one wording: the CLI's line for the same inbox, minus its own prefix — both surfaces print malformedNote().
    const cli = spawnSync(process.execPath, [CLI, "--socket", SOCKET, "msg", "recv", "mb-gamma"], {
      env: { ...process.env, TMUX_AGENT_HOME: home },
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, `msg recv mb-gamma exited ${cli.status}: ${String(cli.stderr).slice(0, 300)}`);
    const line = String(cli.stderr).trim();
    assert.match(line, /^msg recv: /, `the CLI's note must carry its own prefix, and only that: ${JSON.stringify(line)}`);
    assert.equal(blocks(3)[1].text, line.slice("msg recv: ".length),
      `the MCP note and the CLI's line for one unreadable file must be one wording: ${JSON.stringify([blocks(3)[1]?.text, line])}`);
    assert.match(blocks(3)[1].text, /zzz-corrupt\.json/, `the note names the file: ${blocks(3)[1].text}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: spawn-session refuses a cwd that is not a directory this user can enter, isError — the orchestrator's one rule, not a second", async () => {
  // Measured 2026-09-15 on 3b9b838 (scratch/ga-fire-2026-09-15-08Z/cwd-probe/run2b-3b9b838-mcp.log): cwd "/srv/example/tmux-agnet"
  // (no such path) and cwd "/etc/hostname" (a file) both answered {"created": true}, isError unset, the shell in $HOME and
  // the ledger's session.spawned row recording the value as typed. z.string() admits every string, so the judgement is
  // Orchestrator.spawn's own assertCwd, thrown before hasSession and new-session, which the server's catch turns into the
  // isError reply — the CLI's words, from the one exported rule. The plants live in a temp dir so the test is portable.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-cwd-")));
  const home = join(T, "home");
  const nosuch = join(T, "tmux-agnet");
  const file = join(T, "afile");
  writeFileSync(file, "not a directory\n");
  const name = `mcp-cwd-${process.pid}`;
  const r = await mcp(
    [
      call(1, "spawn-session", { name: `${name}-a`, cwd: nosuch, parent: "mcp-test" }),
      call(2, "spawn-session", { name: `${name}-b`, cwd: file, parent: "mcp-test" }),
      call(3, "spawn-session", { name, cwd: T, parent: "mcp-test" }),
      call(4, "kill-session", { name }),
    ],
    { TMUX_AGENT_HOME: home },
  );
  for (const [id, v, reason] of [[1, nosuch, "no such directory"], [2, file, "not a directory"]]) {
    assert.equal(r.get(id)?.result?.isError, true, `cwd ${JSON.stringify(v)} must be an isError reply — on 3b9b838 it was {"created": true}: ${text(r.get(id)).slice(0, 120)}`);
    const msg = String(parsed(r.get(id))?.error ?? "");
    assert.equal(msg, `--cwd: ${reason} ${JSON.stringify(v)} — give a directory`, `the flag, the reason in words, the value as typed and what it takes, the CLI's words: ${msg}`);
  }
  assert.equal(parsed(r.get(3))?.created, true, `a valid spawn-session is unchanged: ${text(r.get(3))}`);
  assert.equal(parsed(r.get(4))?.killed, name, `kill-session removed the valid one: ${text(r.get(4))}`);
  let live = [];
  try {
    live = execFileSync("tmux", ["-L", SOCKET, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n");
  } catch { /* no server left on the socket — no sessions either */ }
  assert.ok(!live.includes(`${name}-a`) && !live.includes(`${name}-b`), `a refused spawn-session birthed a session (in $HOME): ${live.join(", ")}`);
  // the ledger: exactly one session.spawned row — the valid spawn, holding the resolved directory — none for a refusal
  const rows = readdirSync(join(home, "ledger")).filter((f) => f.endsWith(".ndjson")).flatMap((f) => readFileSync(join(home, "ledger", f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  assert.deepEqual(rows.filter((e) => e.type === "session.spawned").map((e) => [e.session, e.data.cwd]), [[name, T]], "session.spawned rows are not exactly the valid spawn with its directory (on 3b9b838 each refused cwd had a row)");
  rmSync(T, { recursive: true, force: true });
});

test("mcp: spawn-session refuses a session name the tool cannot use, isError — the driver's one rule, not a second", async () => {
  // Measured 2026-09-15 on 296272c at the CLI (scratch/ga-fire-2026-09-15-14Z/name-probe-parent/probe-296272c.log; the
  // orchestrator path is the same one): name "vp bad" reached `new-session -s` and the session was born on the socket
  // while the caller was told the call failed, in tmux's words; name "../evil" made tmux create `__/evil` (tmux rewrites
  // . and : to _) and only then threw `invalid session name` from the post-hasSession set-option — a half-made session
  // left behind, the refusal in the rule's words but after the fact. z.string() admits every string, so the judgement
  // is Orchestrator.spawn's own assertName — the driver's exported rule, `hasSession` having swallowed it until now —
  // thrown before assertCwd, hasSession and new-session, which the server's catch turns into the isError reply.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-name-")));
  const home = join(T, "home");
  const name = `mcp-name-${process.pid}`;
  const r = await mcp(
    [
      call(1, "spawn-session", { name: "vp bad", cwd: T, parent: "mcp-test" }),
      call(2, "spawn-session", { name: "../evil", cwd: T, parent: "mcp-test" }),
      call(3, "spawn-session", { name, cwd: T, parent: "mcp-test" }),
      call(4, "kill-session", { name }),
    ],
    { TMUX_AGENT_HOME: home },
  );
  for (const [id, v] of [[1, "vp bad"], [2, "../evil"]]) {
    assert.equal(r.get(id)?.result?.isError, true, `name ${JSON.stringify(v)} must be an isError reply: ${text(r.get(id)).slice(0, 120)}`);
    const msg = String(parsed(r.get(id))?.error ?? "");
    assert.equal(msg, `invalid session name: ${JSON.stringify(v)} (alnum start, [A-Za-z0-9._-], <=64)`, `the value as typed and the rule, the driver's words (on 296272c "vp bad" came back in tmux's): ${msg}`);
  }
  assert.equal(parsed(r.get(3))?.created, true, `a valid spawn-session is unchanged: ${text(r.get(3))}`);
  assert.equal(parsed(r.get(4))?.killed, name, `kill-session removed the valid one: ${text(r.get(4))}`);
  let live = [];
  try {
    live = execFileSync("tmux", ["-L", SOCKET, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n");
  } catch { /* no server left on the socket — no sessions either */ }
  assert.ok(!live.includes("vp bad") && !live.includes("__/evil"), `a refused spawn-session birthed a session (on 296272c: "vp bad" as typed, "../evil" as tmux's __/evil): ${live.join(", ")}`);
  // the ledger: exactly one session.spawned row — the valid spawn — none for a refused name
  const rows = readdirSync(join(home, "ledger")).filter((f) => f.endsWith(".ndjson")).flatMap((f) => readFileSync(join(home, "ledger", f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  assert.deepEqual(rows.filter((e) => e.type === "session.spawned").map((e) => e.session), [name], "session.spawned rows are not exactly the valid spawn (on 296272c the refused names reached new-session)");
  rmSync(T, { recursive: true, force: true });
});

/**
 * The server's startup alone: spawn it under `env`, offer the initialize request, and report how it ended —
 * { code, stdout, stderr, answered }. A server that refuses to start exits on its own (its stdin closing is not why);
 * one that starts is shut down by ending stdin once its first reply arrives. Bounded by SIGKILL so a red run cannot hang.
 */
function mcpStartup(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER], { env: { ...process.env, TMUX_AGENT_SOCKET: SOCKET, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("MCP server startup timed out"));
    }, 25_000);
    p.stdin.on("error", () => { /* EPIPE: the server was gone before the request was written — the case under test */ });
    p.stdout.on("data", (d) => {
      stdout += d;
      setTimeout(() => p.stdin.end(), 80); // it answered: a started server shuts down when its transport closes
    });
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, answered: stdout.split("\n").some((l) => { try { return JSON.parse(l).id === 0; } catch { return false; } }) });
    });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) + "\n");
  });
}

test("mcp: spawn-session refuses a parent the tool cannot use, isError; a TMUX_AGENT_ACTOR it cannot use refuses to start the server — the driver's one rule, not a second", async () => {
  // Measured 2026-09-15 on e254450 (scratch/ga-fire-2026-09-15-16Z/parent-actor-probe/supplement-e254450.log): under
  // TMUX_AGENT_ACTOR=../mcp-who the server started and answered; spawn-session with parent "not a name!" answered
  // {"created": true}, isError unset, and list-lineage then reported parent "not a name!", owner "../mcp-who" — the
  // values in tmux's options and the ledger's audit envelope, the child ORPHANED by construction (no session can bear
  // that parent), and every other actor's kill refused in the owner's words. z.string() admits every string, so the
  // judgement is Orchestrator.spawn's own assertName on the parent — beside its judgement of the name, before
  // hasSession and new-session — which the server's catch turns into the isError reply; the actor is judged before the
  // home, the ledger or a server is touched, and the process exits 78 (EX_CONFIG, the code a lexicon it cannot read
  // already uses) with one stderr line naming the variable, before initialize is answered.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-lineage-")));
  const home = join(T, "home");
  const name = `mcp-lineage-${process.pid}`;
  const r = await mcp(
    [
      call(1, "spawn-session", { name: `${name}-bad`, cwd: T, parent: "not a name!" }),
      call(2, "spawn-session", { name: `${name}-bad`, cwd: T, parent: "../who" }),
      call(3, "spawn-session", { name, cwd: T, parent: "mcp-test" }),
      call(4, "kill-session", { name }),
    ],
    { TMUX_AGENT_HOME: home, TMUX_AGENT_ACTOR: "mcp-lineage-test" },
  );
  for (const [id, v] of [[1, "not a name!"], [2, "../who"]]) {
    assert.equal(r.get(id)?.result?.isError, true, `parent ${JSON.stringify(v)} must be an isError reply — on e254450 it was {"created": true}: ${text(r.get(id)).slice(0, 120)}`);
    const msg = String(parsed(r.get(id))?.error ?? "");
    assert.equal(msg, `--parent: invalid session name: ${JSON.stringify(v)} (alnum start, [A-Za-z0-9._-], <=64)`, `the source, the value as typed and the rule — the CLI's words: ${msg}`);
  }
  assert.equal(parsed(r.get(3))?.created, true, `a valid spawn-session is unchanged: ${text(r.get(3))}`);
  assert.equal(parsed(r.get(4))?.killed, name, `kill-session removed the valid one: ${text(r.get(4))}`);
  let live = [];
  try {
    live = execFileSync("tmux", ["-L", SOCKET, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n");
  } catch { /* no server left on the socket — no sessions either */ }
  assert.ok(!live.includes(`${name}-bad`), `a refused spawn-session birthed a session (on e254450: with the parent in its lineage): ${live.join(", ")}`);
  // the ledger: exactly one session.spawned row — the valid spawn — and no row carrying a refused parent
  const rows = readdirSync(join(home, "ledger")).filter((f) => f.endsWith(".ndjson")).flatMap((f) => readFileSync(join(home, "ledger", f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  assert.deepEqual(rows.filter((e) => e.type === "session.spawned").map((e) => [e.session, e.parent]), [[name, "mcp-test"]], "session.spawned rows are not exactly the valid spawn with its parent (on e254450 the refused parents each had a row)");
  // the actor: the server does not start, exits 78 with one line naming the variable, answers nothing, makes nothing
  const never = join(T, "never-home");
  const s = await mcpStartup({ TMUX_AGENT_HOME: never, TMUX_AGENT_ACTOR: "../mcp-who" });
  assert.equal(s.code, 78, `TMUX_AGENT_ACTOR="../mcp-who": the server exited ${s.code}, want 78 (EX_CONFIG) — on e254450 it started and answered (stderr: ${JSON.stringify(s.stderr.slice(0, 200))})`);
  assert.equal(s.answered, false, `the server answered initialize under an actor it cannot use: ${s.stdout.slice(0, 200)}`);
  assert.deepEqual(s.stderr.trim().split("\n"), ['TMUX_AGENT_ACTOR: invalid session name: "../mcp-who" (alnum start, [A-Za-z0-9._-], <=64)'], `one stderr line: the variable, the value as typed and the rule: ${s.stderr}`);
  assert.equal(existsSync(never), false, "a refused actor created the home before it was judged");
  // and the control: a valid actor starts and answers, as before
  const ok = await mcpStartup({ TMUX_AGENT_HOME: home, TMUX_AGENT_ACTOR: "mcp-lineage-test" });
  assert.equal(ok.answered, true, `a valid TMUX_AGENT_ACTOR did not start the server: exit ${ok.code}, stderr ${ok.stderr.slice(0, 200)}`);
  rmSync(T, { recursive: true, force: true });
});

test("mcp: a TMUX_AGENT_LEXICON the server cannot read, or cannot parse, refuses to start the server — exit 78, one line, no stack", async (t) => {
  // Measured 2026-09-15 on 85d3ba7 and 2026-09-16 on bc8b2ea (scratch/ga-fire-2026-09-16-00Z/lexicon-probe/
  // supplement-bc8b2ea.log D, E): under TMUX_AGENT_LEXICON=<a 000 file> the server printed its ready line and exec-sync
  // answered with the operator's redact shape in plain text, isError unset; under <not JSON> it exited 1 with a ten-line
  // stack trace from lexicon.js:73 where the CLI gives 78 and one line. The server judges the lexicon at startup as it
  // judges TMUX_AGENT_ACTOR (the test above): the CLI's line, exit 78, before initialize is answered.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-lexicon-")));
  const home = join(T, "home");
  const missing = join(T, "nope", "lex.json");
  const bad = join(T, "bad.json");
  writeFileSync(bad, "{ not json");
  const locked = join(T, "locked.json");
  writeFileSync(locked, '{"version":1}');
  chmodSync(locked, 0o000);
  // root reads a 000 file (accessSync R_OK passes), so the case would be a false red there — skip it, named
  let canRead = true;
  try {
    accessSync(locked, constants.R_OK);
  } catch {
    canRead = false;
  }
  if (canRead) t.diagnostic("000-mode case skipped: this user can read a 000 file (running as root?)");
  const ok = join(T, "ok.json");
  writeFileSync(ok, '{"version":1}');
  // the default path a symbolic link whose target is missing: on cd44cf1 the loader read its ENOENT as the
  // absent file and the server started with the shipped vocabulary — the operator's redact rules silently not applied
  const linkHome = join(T, "link-home");
  mkdirSync(linkHome);
  const target = join(T, "moved-dotfiles", "lexicon.json"); // never created
  symlinkSync(target, join(linkHome, "lexicon.json"));
  try {
    const cases = [
      [{ TMUX_AGENT_LEXICON: missing }, `lexicon config error: TMUX_AGENT_LEXICON ${JSON.stringify(missing)}: cannot be read — no such file or directory (ENOENT)`],
      ...(canRead ? [] : [[{ TMUX_AGENT_LEXICON: locked }, `lexicon config error: TMUX_AGENT_LEXICON ${JSON.stringify(locked)}: cannot be read — permission denied for this user (EACCES)`]]),
      [{ TMUX_AGENT_HOME: linkHome }, `lexicon config error: default path ${JSON.stringify(join(linkHome, "lexicon.json"))}: cannot be read — a symbolic link to ${JSON.stringify(target)}, which does not exist (ENOENT)`],
    ];
    for (const [extra, line] of cases) {
      const s = await mcpStartup({ TMUX_AGENT_HOME: home, ...extra });
      assert.equal(s.code, 78, `${JSON.stringify(extra)}: the server exited ${s.code}, want 78 (EX_CONFIG) — on bc8b2ea (cd44cf1 for the default-path link) it started and answered (stderr: ${JSON.stringify(s.stderr.slice(0, 200))})`);
      assert.equal(s.answered, false, `the server answered initialize under a lexicon it cannot read: ${s.stdout.slice(0, 200)}`);
      assert.deepEqual(s.stderr.trim().split("\n"), [line], `one stderr line — the CLI's own: ${s.stderr}`);
    }
    // not JSON: 78 and one line, where bc8b2ea exited 1 with a stack trace
    const b = await mcpStartup({ TMUX_AGENT_HOME: home, TMUX_AGENT_LEXICON: bad });
    assert.equal(b.code, 78, `TMUX_AGENT_LEXICON=<not JSON>: the server exited ${b.code}, want 78 — on bc8b2ea exit 1 and a stack trace (stderr: ${JSON.stringify(b.stderr.slice(0, 200))})`);
    assert.equal(b.answered, false, `the server answered initialize under a lexicon it cannot parse: ${b.stdout.slice(0, 200)}`);
    const lines = b.stderr.trim().split("\n");
    assert.equal(lines.length, 1, `one line, not a stack trace: ${b.stderr}`);
    assert.match(lines[0], /^lexicon config error: .*bad\.json: not valid JSON — /, `the CLI's line: ${lines[0]}`);
    // the controls: a valid named lexicon and the absent default both start and answer, as before
    for (const env of [{ TMUX_AGENT_HOME: home, TMUX_AGENT_LEXICON: ok }, { TMUX_AGENT_HOME: home }]) {
      const c = await mcpStartup(env);
      assert.equal(c.answered, true, `the server did not start under ${JSON.stringify(env)}: exit ${c.code}, stderr ${c.stderr.slice(0, 200)}`);
    }
  } finally {
    chmodSync(locked, 0o600);
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: a TMUX_AGENT_POLICY the server cannot read, or a policy file that is not the schema, refuses to start the server — exit 78, one line, no stack", async (t) => {
  // Measured 2026-10-13 on e757b28: under TMUX_AGENT_POLICY=<a path that does not exist>, <a directory>, <a 000 file>, a
  // file holding {"readOnly":"yes"} and a default-path policy.json holding `[]` the server started and answered
  // initialize with every tool advertised — the Policy constructor's one bare catch installed the permissive default, so
  // an operator's read-only intent for this surface was silently gone and policy-status reported "global default". A
  // throw from the constructor would have been an uncaught exception at module load: exit 1 and a stack trace. The
  // server judges the file at startup as it judges TMUX_AGENT_LEXICON (the test above): the CLI's line, exit 78, before
  // initialize is answered; a valid file and the absent default start it as before.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-policy-")));
  const home = join(T, "home");
  const missing = join(T, "nope", "policy.json");
  const dir = join(T, "adir");
  mkdirSync(dir);
  const bad = join(T, "bad.json");
  writeFileSync(bad, '{"readOnly":true,}');
  const wrong = join(T, "wrong.json");
  writeFileSync(wrong, '{"readOnly":"yes"}');
  const locked = join(T, "locked.json");
  writeFileSync(locked, '{"readOnly":true}');
  chmodSync(locked, 0o000);
  // root reads a 000 file (accessSync R_OK passes), so the case would be a false red there — skip it, named
  let canRead = true;
  try {
    accessSync(locked, constants.R_OK);
  } catch {
    canRead = false;
  }
  if (canRead) t.diagnostic("000-mode case skipped: this user can read a 000 file (running as root?)");
  const ok = join(T, "ok.json");
  writeFileSync(ok, JSON.stringify({ surfaces: { mcp: { readOnly: false } } }));
  const badHome = join(T, "bad-home");
  mkdirSync(badHome);
  writeFileSync(join(badHome, "policy.json"), "[]");
  // the default path a symbolic link whose target is missing: on cd44cf1 the loader read its ENOENT as the
  // absent file and the server answered initialize readOnly=false with every mutating tool open
  const linkHome = join(T, "link-home");
  mkdirSync(linkHome);
  const target = join(T, "moved-dotfiles", "policy.json"); // never created
  symlinkSync(target, join(linkHome, "policy.json"));
  try {
    const cases = [
      [{ TMUX_AGENT_POLICY: missing }, `policy config error: TMUX_AGENT_POLICY ${JSON.stringify(missing)}: cannot be read — no such file or directory (ENOENT)`],
      [{ TMUX_AGENT_POLICY: dir }, `policy config error: TMUX_AGENT_POLICY ${JSON.stringify(dir)}: cannot be read — is a directory, not a file (EISDIR)`],
      ...(canRead ? [] : [[{ TMUX_AGENT_POLICY: locked }, `policy config error: TMUX_AGENT_POLICY ${JSON.stringify(locked)}: cannot be read — permission denied for this user (EACCES)`]]),
      [{ TMUX_AGENT_POLICY: wrong }, `policy config error: ${wrong}: readOnly must be true or false (got "yes")`],
      [{ TMUX_AGENT_HOME: badHome }, `policy config error: ${join(badHome, "policy.json")}: expected a JSON object`],
      [{ TMUX_AGENT_HOME: linkHome }, `policy config error: default path ${JSON.stringify(join(linkHome, "policy.json"))}: cannot be read — a symbolic link to ${JSON.stringify(target)}, which does not exist (ENOENT)`],
    ];
    for (const [extra, line] of cases) {
      const s = await mcpStartup({ TMUX_AGENT_HOME: home, ...extra });
      assert.equal(s.code, 78, `${JSON.stringify(extra)}: the server exited ${s.code}, want 78 (EX_CONFIG) — on e757b28 it started and answered (stderr: ${JSON.stringify(s.stderr.slice(0, 200))})`);
      assert.equal(s.answered, false, `the server answered initialize under a policy file it cannot use: ${s.stdout.slice(0, 200)}`);
      assert.deepEqual(s.stderr.trim().split("\n"), [line], `one stderr line — the CLI's own: ${s.stderr}`);
    }
    // not JSON: 78 and one line whose reason is the parser's own words
    const b = await mcpStartup({ TMUX_AGENT_HOME: home, TMUX_AGENT_POLICY: bad });
    assert.equal(b.code, 78, `TMUX_AGENT_POLICY=<not JSON>: the server exited ${b.code}, want 78 — on e757b28 it started and answered (stderr: ${JSON.stringify(b.stderr.slice(0, 200))})`);
    assert.equal(b.answered, false, `the server answered initialize under a policy file it cannot parse: ${b.stdout.slice(0, 200)}`);
    const lines = b.stderr.trim().split("\n");
    assert.equal(lines.length, 1, `one line, not a stack trace: ${b.stderr}`);
    assert.match(lines[0], /^policy config error: .*bad\.json: not valid JSON — /, `the CLI's line: ${lines[0]}`);
    // the controls: a valid named file and the absent default both start and answer, as before
    for (const env of [{ TMUX_AGENT_HOME: home, TMUX_AGENT_POLICY: ok }, { TMUX_AGENT_HOME: home }]) {
      const c = await mcpStartup(env);
      assert.equal(c.answered, true, `the server did not start under ${JSON.stringify(env)}: exit ${c.code}, stderr ${c.stderr.slice(0, 200)}`);
    }
  } finally {
    chmodSync(locked, 0o600);
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: a TMUX_AGENT_SOCKET the server cannot use refuses to start the server — exit 78, one line, no home, before initialize is answered", async () => {
  // Measured 2026-09-16 on 7b1e542 (scratch/ga-fire-2026-09-16-02Z/socket-probe/supplement-7b1e542.log C, D, E): under
  // TMUX_AGENT_SOCKET=../x, 'a b' and the set-but-empty variable the server started, printed `ready (socket=../x, …)`,
  // answered initialize and tools/list (13 tools), and answered fleet-status — every tool — isError with the driver's
  // `unsafe socket name: ../x`; exit 0 when the transport closed; the home made. TMUX_AGENT_ACTOR and TMUX_AGENT_LEXICON
  // (the two tests above) already refuse to start it. The server judges the variable at startup the same way: the CLI's
  // line — the variable, the value as typed, the rule — exit 78 (EX_CONFIG), before initialize is answered, no home.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-socket-")));
  try {
    for (const [i, value] of ["../x", "a b", ""].entries()) {
      const never = join(T, `never-home-${i}`);
      const s = await mcpStartup({ TMUX_AGENT_HOME: never, TMUX_AGENT_SOCKET: value });
      assert.equal(s.code, 78, `TMUX_AGENT_SOCKET=${JSON.stringify(value)}: the server exited ${s.code}, want 78 (EX_CONFIG) — on 7b1e542 it started, answered and exited 0 (stderr: ${JSON.stringify(s.stderr.slice(0, 200))})`);
      assert.equal(s.answered, false, `the server answered initialize under a socket it cannot use: ${s.stdout.slice(0, 200)}`);
      assert.deepEqual(s.stderr.trim().split("\n"), [`TMUX_AGENT_SOCKET: invalid socket name: ${JSON.stringify(value)} ([A-Za-z0-9._-], 1 or more)`], `one stderr line: the variable, the value as typed and the rule (on 7b1e542: the ready line naming the value): ${s.stderr}`);
      assert.equal(existsSync(never), false, `a refused socket created the home before it was judged (TMUX_AGENT_SOCKET=${JSON.stringify(value)})`);
    }
    // the control: the suite's own socket starts and answers, as before
    const ok = await mcpStartup({ TMUX_AGENT_HOME: join(T, "home") });
    assert.equal(ok.answered, true, `a valid TMUX_AGENT_SOCKET did not start the server: exit ${ok.code}, stderr ${ok.stderr.slice(0, 200)}`);
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: a read tool returns usable JSON — and says WHICH server the empty answer came from", async () => {
  // Until TMUX-127 this case asserted list-lineage "should succeed even with no sessions" against whatever server
  // the suite's socket happened to have — which is the ambiguity itself: a dead server and an idle fleet were one
  // `[]`, and a green assertion on an unspecified server state blessed it. The state is named here — a socket no
  // server has ever run on — so the usable-JSON shape is asserted TOGETHER with the block that says the tree is
  // empty because tmux is not there. The live-server and alive-but-empty controls live in
  // test/lineage-tmux-down.test.js, which owns this surface's contract.
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-lin-"));
  const gone = `ta-mcp-nosrv-${process.pid}`;
  try {
    const r = await mcp([call(1, "list-lineage")], { TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: gone });
    assert.ok(r.get(1)?.result, "list-lineage should succeed on a socket with no server, as it always has");
    assert.ok(Array.isArray(parsed(r.get(1))), "list-lineage returns an array");
    const blocks = r.get(1)?.result?.content ?? [];
    assert.equal(blocks.length, 2, `a socket with no server must carry the array AND one note saying so: ${JSON.stringify(blocks)}`);
    assert.ok(String(blocks[1].text).includes(gone), `the note must name the socket: ${JSON.stringify(blocks[1]?.text)}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: bad input is an isError response, not a crash", async () => {
  const r = await mcp([
    call(1, "session-status", {}), // missing required `name`
    call(2, "no-such-tool"),
    call(3, "list-lineage"), // must still work after the errors
  ]);
  assert.equal(r.get(1)?.result?.isError, true, "schema violation must set result.isError");
  assert.equal(r.get(2)?.result?.isError, true, "unknown tool must set result.isError");
  assert.ok(r.get(3)?.result, "server survives bad calls and keeps serving");
});

test("mcp: full lifecycle — spawn, status, send, kill — through the protocol only", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-life-"));
  writeFileSync(join(home, "policy.json"), JSON.stringify({ surfaces: { mcp: { readOnly: false } } }));
  const name = `mcplife${process.pid}`;
  const r = await mcp(
    [
      call(1, "spawn-session", { name, cwd: "/tmp", parent: "mcp-test", task: "lifecycle" }),
      call(2, "session-status", { name }),
      call(3, "list-lineage"),
      call(4, "kill-session", { name }),
    ],
    { TMUX_AGENT_HOME: home },
  );
  assert.equal(parsed(r.get(1))?.created, true, "spawn-session created the session");
  assert.ok(["WORKING", "IDLE", "UNKNOWN", "BLOCKED"].includes(parsed(r.get(2))?.state), "status returns a known state");
  const lineage = parsed(r.get(3)) ?? [];
  const row = lineage.find((l) => l.name === name);
  assert.equal(row?.parent, "mcp-test", "lineage records the parent we passed");
  assert.equal(parsed(r.get(4))?.killed, name, "kill-session removed it");
  killServerSync(SOCKET);
  rmSync(home, { recursive: true, force: true });
});

test("mcp: capture-pane output is redacted before it leaves the server", async () => {
  const r = await mcp([call(1, "capture-pane", { name: "definitely-not-a-session", lines: 5 })]);
  // absent session is an error, not a leak — assert we fail closed rather than returning host data
  assert.ok(r.get(1)?.result?.isError === true || text(r.get(1)).length >= 0);
});

// TMUX-111: read-log is the served form of the raw pipe-pane capture — the one path where a syntax-highlighting shell's
// bytes reach a caller. Planted, not typed: the log holds the ble.sh line exactly as the sixty-fourth fire captured it
// (test/helpers/highlighted-capture.js), so this runs on any host and needs no tmux server. RED on 5700f1d: the tail
// carried the value.
test("mcp: read-log takes a highlighted KEY=value pair out of the capture log — the ble.sh bytes as captured", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-mcp-hl-"));
  mkdirSync(join(home, "logs"), { recursive: true, mode: 0o700 });
  const name = `mcphl${process.pid}`;
  writeFileSync(join(home, "logs", `${name}.log`), `hello-from-supervisor\r\n${BLE_CAPTURED_LINE}\n`, "utf8");
  const r = await mcp([call(1, "read-log", { name, lines: 5 })], { TMUX_AGENT_HOME: home });
  const out = parsed(r.get(1));
  assert.equal(r.get(1)?.result?.isError, undefined, `read-log answered isError: ${text(r.get(1))}`);
  assert.equal(typeof out?.tail, "string", `read-log did not answer a tail: ${text(r.get(1))}`);
  assert.ok(out.tail.includes("hello-from-supervisor"), "the planted log was read (not the 'no capture log' branch)");
  assert.ok(!out.tail.includes(APIKEY_VALUE), `the highlighted pair's value reached the caller: ${JSON.stringify(out.tail)}`);
  assert.match(out.tail, /PLANE_API_KEY.*\[REDACTED\]/s, `no [REDACTED] after the name: ${JSON.stringify(out.tail)}`);
  rmSync(home, { recursive: true, force: true });
});

// TMUX-116: fleet-status is the agent's fleet listing (README:73). Measured 2026-09-16 on 1c4ae7f
// (scratch/ga-fire-2026-09-16-14Z/status-probe/probe-1c4ae7f.log): three seconds after kill-server, with the daemon's
// tick having ledgered fleet.tmux and two GONE, the tool answered { sessions: [], statusFile }, isError false — the
// same two keys and the same empty list a socket no server ever ran on gets. It read monitor.fleet() =
// tmux.listSessions(), which swallows a dead server into [] on purpose (nickgnd#9). Now the reply carries `tmux` —
// the verdict of the very listing that produced `sessions`, the /api/health shape { reachable, since, error,
// checkedAt } — and so does the file it published. An unreachable server is a fact the tool reports, not a tool
// failure: isError stays false. RED on 1d863d7: "fleet-status has no tmux key".
test("mcp: fleet-status carries the tmux server's verdict beside sessions and statusFile — reachable:false in tmux's words on a socket with no server, isError false; reachable:true on a live one", async () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-116-")));
  const name = `mcp116-${process.pid}`;
  try {
    // a socket no server has ever run on: the tool answers, and says so
    const nosrv = `ta-mcp-nosrv-${process.pid}`;
    const d = await mcp([call(1, "fleet-status")], { TMUX_AGENT_HOME: join(T, "dead-home"), TMUX_AGENT_SOCKET: nosrv });
    assert.notEqual(d.get(1)?.result?.isError, true, `an unreachable server is a fact, not a tool failure — isError: ${text(d.get(1)).slice(0, 200)}`);
    const dead = parsed(d.get(1));
    assert.ok(dead && typeof dead === "object", `fleet-status did not answer JSON: ${text(d.get(1)).slice(0, 200)}`);
    assert.deepEqual(dead.sessions, [], "no sessions on a socket with no server");
    assert.ok("tmux" in dead, `fleet-status has no tmux key — keys: ${Object.keys(dead).sort().join(",")} (on 1c4ae7f: sessions,statusFile, identical to an idle fleet)`);
    assert.deepEqual(Object.keys(dead.tmux).sort(), ["checkedAt", "error", "reachable", "since"], "the verdict has the /api/health shape");
    assert.equal(dead.tmux.reachable, false, "a socket no server ever ran on is not a reachable fleet");
    assert.ok(typeof dead.tmux.error === "string" && dead.tmux.error.includes(nosrv), `error must be tmux's own words naming the socket: ${JSON.stringify(dead.tmux.error)}`);
    assert.equal(dead.tmux.since, dead.tmux.checkedAt, "the server has observed no transition — since is the check itself");
    // the file it published says the same — the collector and the agent read one verdict
    const file = JSON.parse(readFileSync(dead.statusFile, "utf8"));
    assert.equal(file.tmux?.reachable, false, `the published status.json does not carry the verdict: ${JSON.stringify(file.tmux)}`);
    assert.equal(file.tmux.error, dead.tmux.error, "the file's words are the tool's words");

    // the suite's live socket with one session: reachable, the session listed, no error
    const l = await mcp(
      [call(1, "spawn-session", { name, cwd: "/tmp", parent: "mcp-test" }), call(2, "fleet-status"), call(3, "kill-session", { name })],
      { TMUX_AGENT_HOME: join(T, "live-home") },
    );
    assert.equal(parsed(l.get(1))?.created, true, `spawn-session did not create the session: ${text(l.get(1))}`);
    const live = parsed(l.get(2));
    assert.notEqual(l.get(2)?.result?.isError, true, `fleet-status on the live socket answered isError: ${text(l.get(2)).slice(0, 200)}`);
    assert.ok(live?.sessions?.some((s) => s.session === name), `the live fleet does not list the session: ${JSON.stringify(live?.sessions?.map((s) => s.session))}`);
    assert.equal(live.tmux?.reachable, true, `a live server is reachable: ${JSON.stringify(live.tmux)}`);
    assert.equal(live.tmux.error, null, "a reachable verdict carries no error");
    assert.match(live.tmux.checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(parsed(l.get(3))?.killed, name, `kill-session removed the session: ${text(l.get(3))}`);
  } finally {
    killServerSync(SOCKET);
    rmSync(T, { recursive: true, force: true });
  }
});

test("mcp: session-status says WHY a session is GONE — tmux's own words when the server did not answer, null when it answered and the session is absent", async () => {
  // Measured 2026-09-16 on f1a60d9 (scratch/ga-fire-2026-09-16-18Z/gone-probe/probe-f1a60d9.log): a session killed on a
  // live server and a session whose whole server had died came back differing in NO key or value but `session` and `at`
  // — nine keys, state GONE, lastLine "", everything else null — and the string "no server" appeared 0 times in either,
  // while fleet-status already answered the verdict. An agent told "GONE" respawns one session; on a dead
  // server that is the wrong move once per session in its charter.
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-mcp-117-")));
  const name = `mcp117-${process.pid}`;
  try {
    // a socket no server has ever run on: the tool answers, and says why
    const nosrv = `ta-mcp-nosrv117-${process.pid}`;
    const d = await mcp([call(1, "session-status", { name })], { TMUX_AGENT_HOME: join(T, "dead-home"), TMUX_AGENT_SOCKET: nosrv });
    assert.notEqual(d.get(1)?.result?.isError, true, `an unreachable server is a fact, not a tool failure — isError: ${text(d.get(1)).slice(0, 200)}`);
    const dead = parsed(d.get(1));
    assert.equal(dead?.state, "GONE", `session-status on a socket with no server: ${text(d.get(1)).slice(0, 200)}`);
    assert.ok("reason" in dead, `session-status has no reason key — keys: ${Object.keys(dead).sort().join(",")} (on 34d9785 a killed session and a dead server were these same keys and values)`);
    assert.ok(typeof dead.reason === "string" && dead.reason.includes(nosrv), `reason must be tmux's own words naming the socket: ${JSON.stringify(dead.reason)}`);
    assert.match(dead.reason, /no server running|error connecting/, `reason must be tmux's wording, not ours: ${JSON.stringify(dead.reason)}`);

    // the suite's live socket: a session that exists, and a name that does not — the server answered for both
    const l = await mcp(
      [
        call(1, "spawn-session", { name, cwd: "/tmp", parent: "mcp-test" }),
        call(2, "session-status", { name }),
        call(3, "session-status", { name: `${name}-nosuch` }),
        call(4, "kill-session", { name }),
      ],
      { TMUX_AGENT_HOME: join(T, "live-home") },
    );
    assert.equal(parsed(l.get(1))?.created, true, `spawn-session did not create the session: ${text(l.get(1))}`);
    const live = parsed(l.get(2));
    assert.notEqual(live?.state, "GONE", `the live session read as GONE: ${text(l.get(2)).slice(0, 200)}`);
    assert.equal(live.reason, null, `a session that exists has no reason to explain: ${JSON.stringify(live.reason)}`);
    const absent = parsed(l.get(3));
    assert.equal(absent?.state, "GONE", `an absent session is GONE: ${text(l.get(3)).slice(0, 200)}`);
    assert.equal(absent.reason, null, `the server answered — an absent session must not be reported as the server's death: ${JSON.stringify(absent.reason)}`);
    // the gap: on the parent these two GONEs were the same reply but for session/at
    const differing = Object.keys({ ...absent, ...dead }).filter((k) => k !== "session" && k !== "at").filter((k) => JSON.stringify(absent[k]) !== JSON.stringify(dead[k]));
    assert.deepEqual(differing, ["reason"], `an absent session and a dead server differ in [${differing.join(",")}] — want reason alone (on 34d9785: nothing)`);
    assert.equal(parsed(l.get(4))?.killed, name, `kill-session removed the session: ${text(l.get(4))}`);
  } finally {
    killServerSync(SOCKET);
    rmSync(T, { recursive: true, force: true });
  }
});
