/**
 * Unit tests for the pure logic — the parts a contributor most needs to be able to refactor
 * safely, and where an end-to-end shell smoke gives no useful signal.
 *
 * Uses node:test (built in, zero dependencies). Attack-class names are deliberate: this
 * suite doubles as the executable threat model for the loopback HTTP guard.
 *
 * Run: node --test test/
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { checkBrowserOrigin } from "../dist/web/server.js";
import { redact } from "../dist/core/redact.js";
import { sessionTarget, paneTarget, Tmux } from "../dist/core/tmux.js";
import { Policy } from "../dist/core/policy.js";
import { Ledger } from "../dist/core/ledger.js";
import { LedgerIndex } from "../dist/analytics/ledger-index.js";
import { wasteReport } from "../dist/analytics/status.js";
import { rotateIfNeeded, logFamilyBytes } from "../dist/core/rotate.js";
import { claudeCodeProfile } from "../dist/core/monitor.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";
after(() => removeTempHomes()); // every home this file made, once its last test has run

const PORT = 7337;

// ─────────────────────────────────────────────────────────────────────────────
// Loopback HTTP guard — one case per attack class (CSRF exploit was PROVEN, 2026-08-25)
// ─────────────────────────────────────────────────────────────────────────────
test("guard: allows the served page's own same-origin fetch", () => {
  assert.equal(checkBrowserOrigin({ host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, "sec-fetch-site": "same-origin" }, PORT), null);
});

test("guard: allows top-level navigation (Sec-Fetch-Site: none)", () => {
  assert.equal(checkBrowserOrigin({ host: `localhost:${PORT}`, "sec-fetch-site": "none" }, PORT), null);
});

test("guard: allows non-browser clients (curl/MCP send no Sec-Fetch-Site or Origin)", () => {
  assert.equal(checkBrowserOrigin({ host: `127.0.0.1:${PORT}` }, PORT), null);
});

test("guard: BLOCKS forged cross-origin POST (the proven CSRF exploit)", () => {
  const r = checkBrowserOrigin({ host: `127.0.0.1:${PORT}`, origin: "https://evil.example" }, PORT);
  assert.match(String(r), /cross-origin/);
});

test("guard: BLOCKS browser-declared cross-site request", () => {
  const r = checkBrowserOrigin({ host: `127.0.0.1:${PORT}`, "sec-fetch-site": "cross-site" }, PORT);
  assert.match(String(r), /cross-site/);
});

test("guard: BLOCKS same-site-but-not-same-origin (subdomain attack)", () => {
  const r = checkBrowserOrigin({ host: `127.0.0.1:${PORT}`, "sec-fetch-site": "same-site" }, PORT);
  assert.match(String(r), /cross-site/);
});

test("guard: BLOCKS DNS rebinding (hostile hostname resolving to loopback)", () => {
  const r = checkBrowserOrigin({ host: `evil.example:${PORT}` }, PORT);
  assert.match(String(r), /not loopback/);
});

test("guard: BLOCKS a loopback Host on the wrong port (confused-deputy across local services)", () => {
  const r = checkBrowserOrigin({ host: "127.0.0.1:9999" }, PORT);
  assert.match(String(r), /does not match/);
});

test("guard: BLOCKS an empty Host header", () => {
  assert.notEqual(checkBrowserOrigin({}, PORT), null);
});

test("guard: treats Origin: null (sandboxed iframe) as unforgeable-absent, still needs loopback Host", () => {
  assert.equal(checkBrowserOrigin({ host: `127.0.0.1:${PORT}`, origin: "null" }, PORT), null);
  assert.notEqual(checkBrowserOrigin({ host: `evil.example:${PORT}`, origin: "null" }, PORT), null);
});

test("guard: IPv6 loopback literal is accepted", () => {
  assert.equal(checkBrowserOrigin({ host: `[::1]:${PORT}` }, PORT), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Redaction — secrets must never reach disk or a caller
// ─────────────────────────────────────────────────────────────────────────────
test("redact: AWS access key ids", () => {
  assert.ok(!redact("AKIAIOSFODNN7EXAMPLE").includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(!redact("ASIAIOSFODNN7EXAMPLE").includes("ASIAIOSFODNN7EXAMPLE"));
});

test("redact: presigned-URL STS credential (the real leak found in production logs)", () => {
  const url = "https://b.s3.amazonaws.com/k?X-Amz-Credential=ASIAIOSFODNN7EXAMPLE%2F20260825";
  assert.ok(!redact(url).includes("ASIAIOSFODNN7EXAMPLE"));
});

test("redact: github, slack, openai-style tokens and JWTs", () => {
  assert.ok(!redact("ghp_0123456789abcdefghijklmnopqrstuvwx").includes("ghp_0"));
  assert.ok(!redact("xoxb-123456789012-abcdefghijkl").includes("xoxb-"));
  assert.ok(!redact("sk-abcdefghijklmnopqrstuvwxyz0123").includes("sk-abcdef"));
  assert.ok(!redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r").includes("eyJhbGciOiJIUzI1NiJ9"));
});

test("redact: private key blocks and inline credentials", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
  assert.ok(!redact(pem).includes("MIIabc"));
  assert.ok(!redact("password: hunter2hunter2").includes("hunter2hunter2"));
  assert.ok(!redact("https://user:s3cr3tpass@host/x").includes("s3cr3tpass"));
});

test("redact: leaves ordinary output untouched", () => {
  const plain = "npm test\n42 passing\n/srv/example/project";
  assert.equal(redact(plain), plain);
});

// TMUX-95 — the HTTP credential envelope. Filed from a FAIL-first probe of the shipped dist on
// a06c46c (2026-09-12): every provider's token travels a command line as `Authorization: Bearer
// <cred>` or an api-key header/pair, and this tool's own dashboard token is accepted in exactly
// that form (THREAT-MODEL §7) — none of it was redacted. The value below is synthetic (base64 of
// a made-up string), never a real credential.
const ENVELOPE_CRED = "Zm9vYmFyYmF6cXV1eHNlY3JldDEyMzQ1Ng";

test("redact: Authorization: Bearer/Basic <cred> — scheme kept, value gone, any case, bare or inside -H quotes", () => {
  assert.equal(redact(`Authorization: Bearer ${ENVELOPE_CRED}`), "Authorization: Bearer [REDACTED]");
  assert.equal(redact(`authorization: bearer ${ENVELOPE_CRED}`), "authorization: bearer [REDACTED]");
  assert.equal(redact(`Authorization: Basic ${ENVELOPE_CRED}==`), "Authorization: Basic [REDACTED]");
  assert.equal(
    redact(`curl -H 'Authorization: Bearer ${ENVELOPE_CRED}' http://127.0.0.1:7337/api/health`),
    "curl -H 'Authorization: Bearer [REDACTED]' http://127.0.0.1:7337/api/health",
  );
  assert.equal(
    redact(`curl -H "AUTHORIZATION: BEARER ${ENVELOPE_CRED}" http://127.0.0.1:7337/api/health`),
    `curl -H "AUTHORIZATION: BEARER [REDACTED]" http://127.0.0.1:7337/api/health`,
  );
  // header-map / JSON spelling, and a scheme-less value — still the credential, still gone
  assert.equal(redact(`"Authorization": "Bearer ${ENVELOPE_CRED}"`), `"Authorization": "Bearer [REDACTED]"`);
  assert.equal(redact(`Authorization: ${ENVELOPE_CRED}`), "Authorization: [REDACTED]");
});

test("redact: X-Api-Key / api_key / apikey / *_API_KEY pairs — name kept, value gone, mirroring the password= rule", () => {
  assert.equal(redact(`X-Api-Key: ${ENVELOPE_CRED}`), "X-Api-Key: [REDACTED]");
  assert.equal(redact(`x-api-key=${ENVELOPE_CRED}`), "x-api-key=[REDACTED]");
  assert.equal(redact(`api_key=${ENVELOPE_CRED}`), "api_key=[REDACTED]");
  assert.equal(redact(`apikey: ${ENVELOPE_CRED}`), "apikey: [REDACTED]");
  assert.equal(redact(`PLANE_API_KEY=${ENVELOPE_CRED}`), "PLANE_API_KEY=[REDACTED]");
  assert.equal(
    redact(`curl -H "X-Api-Key: ${ENVELOPE_CRED}" http://plane/api/v1/`),
    `curl -H "X-Api-Key: [REDACTED]" http://plane/api/v1/`,
  );
  assert.equal(redact(`export PLANE_API_KEY="${ENVELOPE_CRED}"`), `export PLANE_API_KEY="[REDACTED]"`);
});

test("redact: envelope negatives — prose with bearer / api key and no credential is byte-identical; values under 8 non-space chars pass (floor 8 ≥ the pair rule's 6)", () => {
  for (const plain of [
    "the bearer of this message needs an api key from the dashboard",
    "Authorization header required; set your API key in ~/.tmux-agent/web-token",
    "api_key_file=/etc/plane/key",
    // TMUX-91's own acceptance command, as typed: a shell substitution is not a credential
    'curl -H "Authorization: Bearer $(cat ~/.tmux-agent/web-token)" http://127.0.0.1:7337/api/health',
    "Authorization: Bearer short",
    "X-Api-Key: abc1234",
  ]) assert.equal(redact(plain), plain);
});

// ─────────────────────────────────────────────────────────────────────────────
// tmux target grains — the silent-failure footgun (CONTRIBUTING rule 2)
// ─────────────────────────────────────────────────────────────────────────────
test("targets: session grain is =name, pane grain carries the trailing colon", () => {
  assert.equal(sessionTarget("build-1"), "=build-1");
  assert.equal(paneTarget("build-1"), "=build-1:");
});

test("targets: exact-match prefix defeats tmux prefix matching (kill wrk_A must not hit wrk_AB)", () => {
  assert.ok(sessionTarget("wrk_A").startsWith("="));
});

test("targets: hostile session names are rejected, not escaped", () => {
  for (const bad of ["a;rm -rf /", "a b", "-leading", "", "a".repeat(65), "a'b", "$(x)"]) {
    assert.throws(() => sessionTarget(bad), /invalid session name/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("socket args: shell metacharacters in the socket env var are refused", () => {
  // since TMUX-113 the throw is the constructor's, in assertSocketName's words — the property (refused, never -L'd) is the same
  assert.throws(() => new Tmux({ socket: ";rm -rf ~" }).socketArgs(), /invalid socket name/);
  assert.throws(() => new Tmux({ socketPath: "/tmp/a;b" }).socketArgs(), /unsafe socket path/);
  assert.deepEqual(new Tmux({ socket: "tmux-agent" }).socketArgs(), ["-L", "tmux-agent"]);
  assert.deepEqual(new Tmux({ defaultServer: true }).socketArgs(), []);
});

test("socket name: one exported rule — assertSocketName refuses a traversal, whitespace, a shell metacharacter, the empty name and a non-string, naming the source when given; the constructor judges a given socket, --default-server or not", async () => {
  // Measured 2026-09-16 on 7b1e542 (scratch/ga-fire-2026-09-16-02Z/socket-probe): the rule lived in socketArgs() alone and
  // threw a bare Error at the first tmux call — after the home was made, swallowed by hasSession's catch (watch → GONE).
  // The rule is imported here, not at the top, so a dist without it fails THIS case and not the file's load (the red-first
  // on 148895f is this assertion, as test/lineage-name.test.js reads assertName).
  const { assertSocketName, SocketNameError } = await import("../dist/core/tmux.js");
  assert.equal(typeof assertSocketName, "function", "src/core/tmux.ts exports no assertSocketName — the CLI and the MCP server have no one rule to judge a socket name through");
  const RULE = "([A-Za-z0-9._-], 1 or more)";
  for (const bad of ["../x", "a b", "a;b", "", 42, null]) {
    const plain = `invalid socket name: ${JSON.stringify(bad)} ${RULE}`;
    assert.throws(() => assertSocketName(bad), (e) => e instanceof SocketNameError && e.name === "SocketNameError" && e.message === plain, `assertSocketName(${JSON.stringify(bad)}): the plain message`);
    assert.throws(() => assertSocketName(bad, "--socket"), (e) => e instanceof SocketNameError && e.message === `--socket: ${plain}`, `assertSocketName(${JSON.stringify(bad)}, "--socket"): the source opens the line`);
    assert.throws(() => assertSocketName(bad, "TMUX_AGENT_SOCKET"), (e) => e instanceof SocketNameError && e.message === `TMUX_AGENT_SOCKET: ${plain}`, `assertSocketName(${JSON.stringify(bad)}, "TMUX_AGENT_SOCKET")`);
  }
  for (const ok of ["tmux-agent", "a.b_c-d", "0", "X", "ta-smoke-12345"]) assert.doesNotThrow(() => assertSocketName(ok, "--socket"), `assertSocketName rejects a valid name ${JSON.stringify(ok)}`);
  // the constructor: a name given is a name judged — so no driver exists whose hasSession could swallow the throw
  assert.throws(() => new Tmux({ socket: "../x" }), (e) => e instanceof SocketNameError && e.message === `invalid socket name: "../x" ${RULE}`, "new Tmux({ socket: \"../x\" }) was built");
  assert.throws(() => new Tmux({ socket: "../x", defaultServer: true }), (e) => e instanceof SocketNameError, "defaultServer exempted a name typed");
  assert.throws(() => new Tmux({ socket: "" }), (e) => e instanceof SocketNameError, "the empty name was built");
  // the defaults and a valid pair are unchanged: nothing given is the shipped default, defaultServer still wins for a valid pair
  assert.doesNotThrow(() => new Tmux({}), "the default socket (nothing given) was refused");
  assert.doesNotThrow(() => new Tmux({ socket: undefined }), "an undefined socket (the CLI with neither flag nor variable) was refused");
  assert.deepEqual(new Tmux({}).socketArgs(), ["-L", "tmux-agent"]);
  assert.deepEqual(new Tmux({ socket: "ok-name", defaultServer: true }).socketArgs(), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────────────
test("policy: read-only blocks every mutating action", () => {
  const p = new Policy({ readOnly: true });
  for (const a of ["spawn", "send", "exec", "kill", "adopt"]) {
    assert.throws(() => p.assertAllowed(a, "x", "tester"), /read-only/);
  }
  assert.equal(p.isReadOnly(), true);
});

test("policy: allow-list scopes an action by session prefix", () => {
  const p = new Policy({ allow: { kill: ["worker-*"] } });
  p.assertAllowed("kill", "worker-3", "t"); // allowed
  assert.throws(() => p.assertAllowed("kill", "prod-db", "t"), /not in allow-list/);
  p.assertAllowed("send", "anything", "t"); // unlisted action stays open
});

test("policy: deny-list wins over an open default", () => {
  const p = new Policy({ deny: { send: ["prod-*"] } });
  assert.throws(() => p.assertAllowed("send", "prod-web", "t"), /deny-list/);
  p.assertAllowed("send", "dev-web", "t");
});

// ─────────────────────────────────────────────────────────────────────────────
// Ledger + incremental index
// ─────────────────────────────────────────────────────────────────────────────
test("ledger: day file is resolved per write, not frozen at construction", () => {
  const dir = tempHome("ta-led-");
  const l = new Ledger(dir);
  const today = new Date().toISOString().slice(0, 10);
  assert.match(l.path, new RegExp(`events-${today}\\.ndjson$`));
  l.emit({ type: "session.spawned", session: "s", parent: "p" });
  assert.equal(statSync(l.path).size > 0, true);
  assert.equal(statSync(l.path).mode & 0o777, 0o600, "ledger must not be world-readable");
});

test("ledger index: only new bytes are parsed, and rollups aggregate correctly", () => {
  const dir = tempHome("ta-idx-");
  const f = join(dir, "events-2026-08-25.ndjson");
  const ev = (type, session, extra = {}) => JSON.stringify({ v: 1, ts: "2026-08-25T00:00:00Z", type, session, ...extra }) + "\n";
  writeFileSync(f, ev("session.spawned", "a", { parent: "sup" }) + ev("input.sent", "a"));
  const ix = new LedgerIndex(dir, 0);
  let rows = ix.sessions(true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parent, "sup");
  assert.equal(rows[0].inputsSent, 1);

  appendFileSync(f, ev("session.state", "a", { data: { to: "ERROR" } }) + ev("session.killed", "a"));
  rows = ix.sessions(true);
  assert.equal(rows[0].errorEvents, 1, "ERROR transitions count toward waste");
  assert.ok(rows[0].killedAt, "kill is recorded");
  assert.equal(rows[0].inputsSent, 1, "earlier bytes must not be re-ingested");
});

// TMUX-101: README ("Status & analytics") has said since v0.1.0 that the ledger's events — it names
// exec.timeout and control.denied — aggregate into the waste report's error events. On 98514cc both
// readers counted one thing, session.state → ERROR: a session refused three times, timed out once
// and mistyped once read errors=0 and ranked LAST, below a session that had flapped once. The two
// readers are declared "same contract"; these cases hold them to one fixture and one predicate.
function plantWasteLedger() {
  const dir = tempHome("ta-waste-");
  let t = 0;
  const ev = (type, session, data) =>
    JSON.stringify({ v: 1, ts: `2026-09-14T00:30:${String(++t).padStart(2, "0")}Z`, type, session, actor: "t", ...(data ? { data } : {}) }) + "\n";
  writeFileSync(
    join(dir, "events-2026-09-14.ndjson"),
    // pl-refused: five failures, not one of them a session.state → ERROR
    ev("session.spawned", "pl-refused", { cwd: "/tmp" }) +
      ev("control.denied", "pl-refused", { action: "exec", reason: "read-only surface" }) +
      ev("control.denied", "pl-refused", { action: "send", reason: "deny-list" }) +
      ev("control.denied", "pl-refused", { action: "exec", reason: "foreground program", program: "less" }) +
      ev("exec.timeout", "pl-refused", { id: "abc123", timeoutMs: 2000, elapsedMs: 2003, command: "sleep 30" }) +
      ev("input.verified", "pl-refused", { ok: false, expected: "echo HI", got: "echo H" }) +
      // pl-error: the one event 98514cc counted — the control
      ev("session.spawned", "pl-error", { cwd: "/tmp" }) +
      ev("session.state", "pl-error", { from: "WORKING", to: "ERROR", via: "lexicon" }) +
      // pl-clean: success events only — errors=0 under any fix
      ev("session.spawned", "pl-clean", { cwd: "/tmp" }) +
      ev("input.sent", "pl-clean", { bytes: 8 }) +
      ev("input.verified", "pl-clean", { ok: true }) +
      ev("exec.done", "pl-clean", { id: "def456", rc: 0, elapsedMs: 120 }) +
      ev("session.state", "pl-clean", { from: "WORKING", to: "IDLE", via: "cpu" }) +
      ev("session.killed", "pl-clean"),
  );
  return dir;
}

test("waste: every ledgered failure or refusal is an error event, in wasteReport and LedgerIndex alike", () => {
  const dir = plantWasteLedger();
  const byName = (rows) => Object.fromEntries(rows.map((r) => [r.session, r]));
  const readers = [
    ["wasteReport", wasteReport(dir)],
    ["LedgerIndex.waste", new LedgerIndex(dir, 0).waste(10)],
  ];
  for (const [name, list] of readers) {
    const rows = byName(list);
    assert.equal(rows["pl-refused"].errorEvents, 5, `${name}: 3 control.denied + 1 exec.timeout + 1 input.verified ok:false`);
    assert.equal(rows["pl-error"].errorEvents, 1, `${name}: session.state → ERROR still counts`);
    assert.equal(rows["pl-clean"].errorEvents, 0, `${name}: success events count nothing`);
    // the columns the fix does not touch
    assert.equal(rows["pl-refused"].stateChurn, 0, `${name}: churn unchanged`);
    assert.equal(rows["pl-clean"].stateChurn, 1, `${name}: churn unchanged`);
    assert.equal(rows["pl-clean"].inputsSent, 1, `${name}: inputs unchanged`);
    assert.equal(list[0].session, "pl-refused", `${name}: the refused session ranks first (errors first, then churn)`);
  }
});

test("waste: one predicate names the error set, and success events are not in it", async () => {
  // dynamic import: a build without the predicate fails this assertion by name instead of
  // refusing to load the whole file
  const { isErrorEvent } = await import("../dist/core/ledger.js");
  assert.equal(typeof isErrorEvent, "function", "core/ledger exports isErrorEvent — the one place both readers consume");
  const ev = (type, data) => ({ v: 1, ts: "2026-09-14T00:00:00Z", type, session: "s", ...(data ? { data } : {}) });
  for (const e of [
    ev("session.state", { from: "WORKING", to: "ERROR", via: "lexicon" }),
    ev("control.denied", { action: "exec", reason: "deny-list" }),
    ev("exec.timeout", { id: "x", timeoutMs: 1, elapsedMs: 2, command: "c" }),
    ev("input.verified", { ok: false }),
  ])
    assert.equal(isErrorEvent(e), true, `${e.type} ${JSON.stringify(e.data)} is an error event`);
  for (const e of [
    ev("session.spawned", { cwd: "/tmp" }),
    ev("session.killed"),
    ev("input.sent", { bytes: 8 }),
    ev("input.verified", { ok: true }),
    ev("input.verified"),
    ev("exec.done", { id: "x", rc: 1, elapsedMs: 5 }), // the command's own rc is the agent's verdict, not the tool's
    ev("session.state", { from: "WORKING", to: "IDLE" }),
    ev("session.state", { from: "ERROR", to: "WORKING" }), // leaving ERROR is recovery
    ev("fleet.tmux", { to: "unreachable" }),
    ev("health.warning", { rule: "mem" }),
    ev("capture.stalled"),
  ])
    assert.equal(isErrorEvent(e), false, `${e.type} ${JSON.stringify(e.data ?? null)} is not an error event`);
});

test("ledger index: a partial trailing line is held until complete (no loss, no dupe)", () => {
  const dir = tempHome("ta-part-");
  const f = join(dir, "events-2026-08-25.ndjson");
  const full = JSON.stringify({ v: 1, ts: "2026-08-25T00:00:00Z", type: "session.spawned", session: "z" }) + "\n";
  writeFileSync(f, full + '{"v":1,"ts":"2026-08-25T00:00:01Z","type":"input.sent","sessi');
  const ix = new LedgerIndex(dir, 0);
  assert.equal(ix.sessions(true).length, 1, "partial line ignored");
  appendFileSync(f, 'on":"z"}\n');
  const rows = ix.sessions(true);
  assert.equal(rows[0].inputsSent, 1, "completed line ingested exactly once");
});

test("ledger index: truncation/rotation resets the cursor instead of stalling", () => {
  const dir = tempHome("ta-rot-");
  const f = join(dir, "events-2026-08-25.ndjson");
  const ev = (s) => JSON.stringify({ v: 1, ts: "2026-08-25T00:00:00Z", type: "session.spawned", session: s }) + "\n";
  writeFileSync(f, ev("one") + ev("two"));
  const ix = new LedgerIndex(dir, 0);
  assert.equal(ix.sessions(true).length, 2);
  writeFileSync(f, ev("three")); // smaller than the old offset
  assert.ok(ix.sessions(true).some((r) => r.session === "three"), "post-truncation content is read");
});

// ─────────────────────────────────────────────────────────────────────────────
// Log rotation — disk-growth guard
// ─────────────────────────────────────────────────────────────────────────────
test("rotate: fires past the cap, shifts generations, and drops the oldest", () => {
  const dir = tempHome("ta-lr-");
  const f = join(dir, "s.log");
  writeFileSync(f, "x".repeat(2000));
  assert.equal(rotateIfNeeded(f, { maxBytes: 1000, keep: 2 }), true);
  assert.equal(statSync(`${f}.1`).size, 2000);
  writeFileSync(f, "y".repeat(2000));
  assert.equal(rotateIfNeeded(f, { maxBytes: 1000, keep: 2 }), true);
  assert.equal(statSync(`${f}.2`).size, 2000, "previous generation shifted up");
  assert.ok(logFamilyBytes(f, 2) >= 4000);
});

test("rotate: no-op below the cap and on a missing file (never throws into capture)", () => {
  const dir = tempHome("ta-lr2-");
  const f = join(dir, "s.log");
  writeFileSync(f, "small");
  assert.equal(rotateIfNeeded(f, { maxBytes: 1_000_000 }), false);
  assert.equal(rotateIfNeeded(join(dir, "absent.log")), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent profile — the regex that already shipped one false positive
// ─────────────────────────────────────────────────────────────────────────────
test("profile: an IDLE footer containing the word 'tokens' is NOT working", () => {
  assert.notEqual(claudeCodeProfile.classify(["new task? /clear to save 130.3k tokens"]), "WORKING");
});

test("profile: real activity and error states are detected; errors outrank activity", () => {
  assert.equal(claudeCodeProfile.classify(["✻ Thinking… (esc to interrupt)"]), "WORKING");
  assert.equal(claudeCodeProfile.classify(["API Error: overloaded"]), "ERROR");
  assert.equal(claudeCodeProfile.classify(["✻ working", "API Error: safeguards flagged this"]), "ERROR");
  assert.equal(claudeCodeProfile.classify(["❯ 1. Yes  2. No"]), "BLOCKED");
});

test("profile: context pressure is extracted for the compaction watch", () => {
  assert.equal(claudeCodeProfile.contextPct(["ctx:84% | 🔧12"]), 84);
  assert.equal(claudeCodeProfile.contextPct(["no context here"]), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Supervisor engagement — active vs parked vs orphaned
// ─────────────────────────────────────────────────────────────────────────────
test("engagement: a recently-driven session reads ACTIVE and names its driver", async () => {
  const { computeEngagement } = await import("../dist/core/engagement.js");
  const dir = tempHome("ta-eng-");
  const now = Date.parse("2026-08-25T12:00:00Z");
  const ev = (t, s, actor, ts) => JSON.stringify({ v: 1, ts, type: t, session: s, actor }) + "\n";
  writeFileSync(join(dir, "events-2026-08-25.ndjson"),
    ev("input.sent", "driven", "hub-1", "2026-08-25T11:58:00Z") +
    ev("input.sent", "stale", "hub-1", "2026-08-25T09:00:00Z"));
  const ix = new LedgerIndex(dir, 0);
  const m = computeEngagement([
    { session: "driven", state: "WORKING", attached: false, parent: "hub-1" },
    { session: "stale", state: "WORKING", attached: false, parent: "hub-1" },
  ], ix, 900, now);
  assert.equal(m.get("driven").engagement, "ACTIVE");
  assert.equal(m.get("driven").lastDrivenBy, "hub-1");
  assert.equal(m.get("driven").drivenAgoSecs, 120);
  assert.equal(m.get("stale").engagement, "AUTONOMOUS", "driven 3h ago is not still being driven");
});

test("engagement: attached beats autonomous; idle+undriven is PARKED", async () => {
  const { computeEngagement } = await import("../dist/core/engagement.js");
  const ix = new LedgerIndex(tempHome("ta-eng2-"), 0);
  const m = computeEngagement([
    { session: "watched", state: "IDLE", attached: true, parent: "operator" },
    { session: "quiet", state: "IDLE", attached: false, parent: "operator" },
    { session: "busy", state: "WORKING", attached: false, parent: "operator" },
  ], ix, 900, Date.now());
  assert.equal(m.get("watched").engagement, "ATTACHED");
  assert.equal(m.get("quiet").engagement, "PARKED");
  assert.equal(m.get("busy").engagement, "AUTONOMOUS");
});

test("engagement: a PROCESS parent (watchdog/operator/cron) is not orphaned", async () => {
  const { computeEngagement } = await import("../dist/core/engagement.js");
  const ix = new LedgerIndex(tempHome("ta-eng3-"), 0);
  // regression: treating "parent absent from tmux list-sessions" as orphaned mislabelled
  // 27 of 31 real sessions, whose owners are watchdogs and the operator.
  const m = computeEngagement([
    { session: "a", state: "WORKING", attached: false, parent: "cron-watchdog" },
    { session: "b", state: "WORKING", attached: false, parent: "pager-watchdog" },
    { session: "c", state: "WORKING", attached: false, parent: "operator" },
    { session: "d", state: "WORKING", attached: false, parent: "dead-tmux-session" },
    { session: "e", state: "IDLE", attached: false, parent: null },
  ], ix, 900, Date.now());
  for (const s of ["a", "b", "c"]) assert.notEqual(m.get(s).engagement, "ORPHANED", `${s} has a process parent`);
  assert.equal(m.get("d").engagement, "ORPHANED", "parent names a tmux session that is gone");
  assert.equal(m.get("e").engagement, "ORPHANED", "no lineage at all");
});

test("engagement: rank orders the operator's attention correctly", async () => {
  const { ENGAGEMENT_RANK } = await import("../dist/core/engagement.js");
  assert.ok(ENGAGEMENT_RANK.ACTIVE < ENGAGEMENT_RANK.ATTACHED);
  assert.ok(ENGAGEMENT_RANK.ATTACHED < ENGAGEMENT_RANK.AUTONOMOUS);
  assert.ok(ENGAGEMENT_RANK.AUTONOMOUS < ENGAGEMENT_RANK.PARKED);
  assert.ok(ENGAGEMENT_RANK.PARKED < ENGAGEMENT_RANK.ORPHANED);
});

// ─────────────────────────────────────────────────────────────────────────────
// session.meta enrichment — census/supervisor lineage for ADOPTED sessions
// (they have no spawn event and no tmux user-options; without meta the fleet
// view showed 30 rows of blank lineage — verified 2026-08-25)
// ─────────────────────────────────────────────────────────────────────────────
test("ledger-index: session.meta enriches the rollup; latest wins; spawn parent stays authoritative", () => {
  const dir = tempHome("ta-meta-");
  const lines = [
    { v: 1, ts: "2026-08-25T10:00:00.000Z", type: "session.meta", session: "adopted", data: { repo: "org/x", branch: "main", role: "old role", verdict: "KEEP", parent: "hub" } },
    { v: 1, ts: "2026-08-25T11:00:00.000Z", type: "session.meta", session: "adopted", data: { repo: "org/x", branch: "main", role: "new role", verdict: "RECOMMEND-CLOSE", parent: "hub" } },
    { v: 1, ts: "2026-08-25T09:00:00.000Z", type: "session.spawned", session: "spawned", parent: "real-parent", data: {} },
    { v: 1, ts: "2026-08-25T12:00:00.000Z", type: "session.meta", session: "spawned", data: { verdict: "KEEP", parent: "census-guess" } },
  ];
  writeFileSync(join(dir, "events-2026-08-25.ndjson"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const ix = new LedgerIndex(dir, 0);
  const by = new Map(ix.sessions(true).map((r) => [r.session, r]));
  assert.equal(by.get("adopted").meta.verdict, "RECOMMEND-CLOSE", "latest meta wins");
  assert.equal(by.get("adopted").meta.role, "new role");
  assert.equal(by.get("adopted").parent, "hub", "meta parent fills the blank on adopted sessions");
  assert.equal(by.get("spawned").parent, "real-parent", "spawn event outranks census enrichment");
  assert.equal(by.get("spawned").meta.verdict, "KEEP", "meta still attached alongside");
});

test("status: latestSessionMeta scans day files in order and tolerates junk lines", async () => {
  const { latestSessionMeta } = await import("../dist/analytics/status.js");
  const dir = tempHome("ta-meta2-");
  writeFileSync(join(dir, "events-2026-08-24.ndjson"),
    JSON.stringify({ v: 1, ts: "2026-08-24T01:00:00.000Z", type: "session.meta", session: "s", data: { verdict: "KEEP" } }) + "\nnot json but mentions session.meta\n");
  writeFileSync(join(dir, "events-2026-08-25.ndjson"),
    JSON.stringify({ v: 1, ts: "2026-08-25T01:00:00.000Z", type: "session.meta", session: "s", data: { verdict: "CLOSE", why: "superseded" } }) + "\n");
  const m = latestSessionMeta(dir);
  assert.equal(m.get("s").verdict, "CLOSE", "later day file supersedes");
  assert.equal(m.get("s").ts, "2026-08-25T01:00:00.000Z");
  assert.equal(latestSessionMeta(join(dir, "missing")).size, 0, "no ledger dir = empty map, not a throw");
});
