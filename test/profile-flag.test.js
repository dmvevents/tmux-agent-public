/**
 * `--profile NAME` on `status` and `watch`, and `profile` on the MCP `session-status` / `fleet-status` tools — the two
 * surfaces an operator or a supervising agent actually drives — name the profile one session (or the fleet) is judged
 * by, through the `profileName` the library has honoured since TMUX-155 (TMUX-159; gates G4 a covered parameter that
 * no shipped surface could reach, G6 beside it; KR3's escape hatch for the auto chain picking wrong).
 *
 * Measured 2026-09-23 12:3xZ on 1ec7ff9 (scratch/ga-fire-2026-09-23-12Z/probe-profile*.log) and re-driven by this file
 * on its parent 075e48e (scratch/ga-fire-2026-09-24-06Z/red-parent.log): the CLI refused the flag — `--profile: unknown
 * flag (see the usage line: tmux-agent --help)`, exit 64, on the live socket and on one with no server alike — and the
 * MCP server STRIPPED the key: session-status with {name}, {name, profile: "codex"} and {name, profile: "no-such-profile"}
 * answered three byte-identical replies minus `at` (zod drops a key the schema does not declare before `run` sees it),
 * so a caller who wrote `profile` received the auto verdict labelled as if the name had been honoured, and a name the
 * library refuses by class was, one layer up, silently the auto verdict.
 *
 * The fixture is TMUX-155's (test/profile-name.test.js, its settle-then-paint discipline copied verbatim), reused because
 * it is the one pane on which an honoured name and an ignored one READ DIFFERENTLY: lexicon profile `acme` (blocked:
 * `^\s*@@\s*\d+\.`, matched by none of the four built-ins) in front of the chain, the pane painted `@@ 1. Deploy` —
 * auto's first opinion is acme → BLOCKED / "acme"; codex has no opinion on that tail → IDLE / null. On a bare prompt
 * the two agree, which is exactly how the parent's silent strip stayed unseen.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (1) CLI HONOURED: `status` reads p1 BLOCKED with classifiedBy "acme" in its --json record (the control);
 *       `status --profile codex` reads IDLE in the table AND classifiedBy null in its --json record; `watch p1
 *       --profile codex --idle-secs 1` exits 0 (idle) with verdict JSON IDLE / null where `watch p1 --idle-secs 1`
 *       (auto) exits 3 with BLOCKED / "acme"; `--profile acme` agrees with auto on both verbs. RED on the parent: every
 *       flagged run `--profile: unknown flag`, exit 64. Plant: the flag parsed but not threaded — the verdicts equal auto's.
 *   (2) CLI REFUSED: `status --profile no-such-profile` and `watch p1 --profile no-such-profile --idle-secs 1` exit 64
 *       with ONE stderr line — `--profile: unknown profile name: "no-such-profile" (this Monitor holds: acme,
 *       claude-code, codex, aider, generic-shell)`, ProfileNameError's own words behind the flag's name, no stack trace
 *       — nothing on stdout, the --json FILE not written, no session.state row ledgered under that home; the case typo
 *       "Acme" is refused the same way; and on a socket with no server the refusal is the same line and no server exists
 *       afterwards (judged before tmux is asked). RED on the parent: `unknown flag`. Plant: the throw swallowed.
 *   (3) MCP: session-status {name} → BLOCKED / "acme"; {name, profile: "codex"} → IDLE / null; {name, profile:
 *       "no-such-profile"} → isError true carrying the class's message, never a verdict; fleet-status {} / {profile:
 *       "codex"} / {profile: "no-such-profile"} the same three ways over sessions[]; and tools/list advertises `profile`
 *       as an OPTIONAL string property of both input schemas. RED on the parent: the two codex replies equal auto's,
 *       the two unknown-name replies carry a verdict with isError unset, neither schema names the key. Plant: the key
 *       declared but not threaded — the parent's behaviour re-created behind a schema that now admits it.
 *
 * Run: npm run build && node --test test/profile-flag.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { callTool, toolsFull } from "./helpers/mcp-contract.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
/** The lexicon profile the fixture puts in FRONT of the built-ins; `@@ 1.` is matched by none of the four. */
const ACME = { name: "acme", blocked: ["^\\s*@@\\s*\\d+\\."] };
const LEXICON = JSON.stringify({ version: 1, profiles: [ACME] });
const HELD = "acme, claude-code, codex, aider, generic-shell";
const UNKNOWN = "no-such-profile";
/** The one line a refusal prints: the flag, then ProfileNameError's own message, the value as typed and the names held. */
const REFUSAL = (typed) => new RegExp(`^--profile: unknown profile name: ${JSON.stringify(typed).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(this Monitor holds: ${HELD}\\)$`);
// a refusal is one process start; a verdict is one or two 3 s polls of `watch` — both far inside this
const BOUND_MS = 30_000;

function socket(tag) {
  return `ta-pf${tag}-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** A home holding the fixture lexicon, so every surface driven below holds the same five names. */
function home(tag) {
  const h = mkdtempSync(join(tmpdir(), `ta-pf${tag}-`));
  writeFileSync(join(h, "lexicon.json"), LEXICON);
  return h;
}
/** { code, stdout, stderr }; code is a string when the bound fired — a hang is named, never mistaken for a code. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, TMUX_AGENT_SLACK_WEBHOOK: "", ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Session names on a socket; a socket whose server never started has none. */
function sessions(sock) {
  try {
    return execFileSync("tmux", ["-L", sock, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
  } catch { return []; }
}
/** `state/classifiedBy` of a status table's row for `name` — the second tab-separated field is the state. */
function tableState(stdout, name) {
  const row = stdout.split("\n").find((l) => l.startsWith(`${name}\t`));
  assert.ok(row, `no row for ${name} in status's table: ${JSON.stringify(stdout.slice(0, 300))}`);
  return row.split("\t")[1];
}
/** The record for `name` in a status.json the run wrote. */
function jsonRecord(file, name) {
  assert.ok(existsSync(file), `${file} was not written`);
  const rec = JSON.parse(readFileSync(file, "utf8")).sessions.find((s) => s.session === name);
  assert.ok(rec, `no record for ${name} in ${file}`);
  return rec;
}
/** Every ledger row of one type under a home, whichever day file holds it — `[]` when no ledger was ever written. */
function ledgerRows(h, type) {
  const dir = join(h, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).flatMap((f) =>
    readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === type));
}
/** The verdict an MCP status reply carries — its content[0] parsed — or the error text of an isError reply. */
function reply(res) {
  const text = res.content?.[0]?.text ?? "";
  return { isError: res.isError === true, value: JSON.parse(text), text };
}
const verdict = (s) => `${s.state}/${s.classifiedBy}`;

/**
 * TMUX-155's pane: a fresh shell settled, then painted with the anchored marker and settled again. Resolves to the
 * capture that satisfied the guard; every assertion that reads the pane later can quote it.
 */
async function paintedPane(S, name) {
  execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", name, "-c", "/tmp"], { stdio: "ignore" });
  // same flags as Tmux.capturePane (monitor reads 40 lines, joined), so tails compare like-for-like
  const capture = () => execFileSync("tmux", ["-L", S, "capture-pane", "-p", "-J", "-t", `=${name}:`, "-S", "-40"], { encoding: "utf8" });
  const tailOf = (pane) => pane.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6);
  const marker = /^\s*@@\s*\d+\./; // anchored like ACME — an echoed command line merely CONTAINING "@@ 1." must not count
  /** two identical non-blank captures 500 ms apart whose tail satisfies `ok` → that pane; null on timeout */
  const settled = async (ok, tries) => {
    let prev = null;
    for (let i = 0; i < tries; i++) {
      const cur = capture();
      if (cur.trim() && cur === prev && ok(tailOf(cur))) return cur;
      prev = cur;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };
  // never type into a shell still sourcing its rc files (ble.sh buffers those keys and replays them)
  assert.ok((await settled(() => true, 40)) !== null, `test setup: the fresh shell never went quiet (20 s). Pane:\n${capture().slice(-400)}`);
  let painted = null;
  for (let i = 0; i < 3 && painted === null; i++) {
    execFileSync("tmux", ["-L", S, "send-keys", "-t", `=${name}:`, "clear; printf '\\n@@ 1. Deploy\\n'", "Enter"], { stdio: "ignore" });
    painted = await settled((tail) => tail.some((l) => marker.test(l)), 20);
  }
  assert.ok(painted !== null, `test setup: the prompt never settled on an anchored tail line. Pane:\n${capture().slice(-400)}`);
  return painted;
}

test("profile flag: `status --profile` and `watch --profile` judge the pane by the NAMED profile — codex reads IDLE / null where auto reads BLOCKED / acme, in the table, the --json record and the watch verdict", async () => {
  const S = socket("1");
  const H = home("1");
  let painted = "";
  try {
    painted = await paintedPane(S, "p1");
    const file = (n) => join(H, `status-${n}.json`);
    // the control first: auto's first opinion is acme, so a named codex can only agree with it by being ignored
    let r = await cli(["--socket", S, "status", "--json", file("auto")], { TMUX_AGENT_HOME: H });
    assert.equal(r.code, 0, `control status exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    assert.equal(tableState(r.stdout, "p1"), "BLOCKED", `control: auto must read the painted marker as BLOCKED. Pane:\n${painted.slice(-300)}`);
    assert.equal(verdict(jsonRecord(file("auto"), "p1")), "BLOCKED/acme", "control: auto's --json record must be classified by acme, the profile in front");

    // (1) status: the named profile decides the table AND the record the file carries
    r = await cli(["--socket", S, "status", "--profile", "codex", "--json", file("codex")], { TMUX_AGENT_HOME: H });
    assert.equal(r.code, 0, `status --profile codex exited ${r.code} — on the parent 075e48e the flag itself was refused: ${r.stderr.slice(0, 200)}`);
    assert.equal(tableState(r.stdout, "p1"), "IDLE", `status --profile codex: codex has no opinion on "@@ 1." so the core signals say IDLE — BLOCKED here is auto's answer wearing the name`);
    assert.equal(verdict(jsonRecord(file("codex"), "p1")), "IDLE/null", "status --profile codex: the --json record must carry the named profile's verdict, classifiedBy null (codex spoke no state)");
    r = await cli(["--socket", S, "status", "--profile", "acme", "--json", file("acme")], { TMUX_AGENT_HOME: H });
    assert.equal(r.code, 0, `status --profile acme exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(verdict(jsonRecord(file("acme"), "p1")), "BLOCKED/acme", "status --profile acme must agree with auto when the named profile IS the one that spoke");

    // (1) watch: the verdict JSON and the exit code a supervising script branches on both follow the name
    const control = await cli(["--socket", S, "watch", "p1", "--idle-secs", "1"], { TMUX_AGENT_HOME: H });
    assert.equal(control.code, 3, `control watch (auto) exited ${control.code}, want 3 (BLOCKED): ${control.stderr.slice(0, 200)}`);
    assert.equal(verdict(JSON.parse(control.stdout.trim().split("\n").pop())), "BLOCKED/acme", "control watch: BLOCKED by acme");
    r = await cli(["--socket", S, "watch", "p1", "--profile", "codex", "--idle-secs", "1"], { TMUX_AGENT_HOME: H });
    assert.equal(r.code, 0, `watch --profile codex exited ${r.code}, want 0 (idle) — 3 is auto's BLOCKED wearing the name; 64 is the parent's refusal: ${r.stderr.slice(0, 200)}`);
    assert.equal(verdict(JSON.parse(r.stdout.trim().split("\n").pop())), "IDLE/null", "watch --profile codex: the verdict JSON must be the named profile's, IDLE / null");
    r = await cli(["--socket", S, "watch", "p1", "--profile", "acme", "--idle-secs", "1"], { TMUX_AGENT_HOME: H });
    assert.equal(r.code, 3, `watch --profile acme exited ${r.code}, want 3: ${r.stderr.slice(0, 200)}`);
    assert.equal(verdict(JSON.parse(r.stdout.trim().split("\n").pop())), "BLOCKED/acme", "watch --profile acme must agree with auto");
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

test("profile flag: an unknown or misspelled --profile is refused before tmux is asked — exit 64, ONE line carrying ProfileNameError's message, nothing on stdout, no file, no verdict ledgered, no server born", async () => {
  const S = socket("2");
  const S0 = socket("2dead"); // no server ever listens here
  const H = home("2");
  try {
    await paintedPane(S, "p2");
    const problems = [];
    /** A refusal's shape, or the reasons it is not one — `[]` is a pass; collected so the parent tree names every miss at once. */
    const refused = (label, r, typed) => {
      if (r.code !== 64) problems.push(`${label}: exited ${JSON.stringify(r.code)}, want 64 (EX_USAGE) — stdout ${JSON.stringify(r.stdout.slice(0, 120))}, stderr ${JSON.stringify(r.stderr.slice(0, 160))}`);
      if (r.stdout !== "") problems.push(`${label}: wrote to stdout what it should have refused before: ${JSON.stringify(r.stdout.slice(0, 160))}`);
      const lines = r.stderr.trim().split("\n");
      if (lines.length !== 1) problems.push(`${label}: ${lines.length} stderr lines, not one — a stack trace or a verdict: ${JSON.stringify(r.stderr.slice(0, 300))}`);
      if (!REFUSAL(typed).test(lines[0])) problems.push(`${label}: the line is ${JSON.stringify(lines[0])} — want the flag, then ProfileNameError's own message: the value as typed and the five names held`);
    };
    const file = join(H, "never.json");
    refused("status --profile no-such-profile --json FILE", await cli(["--socket", S, "status", "--profile", UNKNOWN, "--json", file], { TMUX_AGENT_HOME: H }), UNKNOWN);
    if (existsSync(file)) problems.push(`status --profile ${UNKNOWN} --json FILE: the file was written (${statSync(file).size} bytes) — the fleet was read and published under a name the tool does not hold`);
    refused('status --profile Acme — a case typo of a held name', await cli(["--socket", S, "status", "--profile", "Acme"], { TMUX_AGENT_HOME: H }), "Acme");
    refused("watch p2 --profile no-such-profile --idle-secs 1", await cli(["--socket", S, "watch", "p2", "--profile", UNKNOWN, "--idle-secs", "1"], { TMUX_AGENT_HOME: H }), UNKNOWN);
    // judged before tmux is asked: a socket with no server gets the same line, and has no server afterwards
    refused("status --profile no-such-profile on a socket with no server", await cli(["--socket", S0, "status", "--profile", UNKNOWN], { TMUX_AGENT_HOME: H }), UNKNOWN);
    refused("watch p2 --profile no-such-profile on a socket with no server", await cli(["--socket", S0, "watch", "p2", "--profile", UNKNOWN, "--idle-secs", "1"], { TMUX_AGENT_HOME: H }), UNKNOWN);
    const rows = ledgerRows(H, "session.state");
    if (rows.length) problems.push(`${rows.length} session.state row(s) ledgered under a home that saw only refused runs — a verdict was reached before the name was judged: ${JSON.stringify(rows[0]).slice(0, 200)}`);
    if (sessions(S0).length) problems.push(`a tmux server exists on ${S0} with sessions ${JSON.stringify(sessions(S0))} — a refused run reached the driver`);
    assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    // the control on the same home: a held name is not refused, and only then does the ledger see a verdict
    const ok = await cli(["--socket", S, "status", "--profile", "acme"], { TMUX_AGENT_HOME: H });
    assert.equal(ok.code, 0, `control: status --profile acme exited ${ok.code}: ${ok.stderr.slice(0, 200)}`);
    assert.ok(ledgerRows(H, "session.state").length > 0, "control: the honoured run must ledger the verdict the refused runs did not — else the ledger check above proves nothing");
  } finally {
    killServerSync(S);
    killServerSync(S0);
    rmSync(H, { recursive: true, force: true });
  }
});

test("profile flag: MCP session-status { name, profile? } and fleet-status { profile? } honour the name, refuse an unknown one with isError, and advertise the key in their schemas — never the auto verdict behind a stripped key", async () => {
  const S = socket("3");
  const H = home("3");
  const env = { TMUX_AGENT_HOME: H, TMUX_AGENT_SOCKET: S };
  try {
    await paintedPane(S, "p3");
    const problems = [];
    const expectVerdict = async (tool, args, want, pick) => {
      const res = reply(await callTool(tool, args, env));
      if (res.isError) { problems.push(`${tool} ${JSON.stringify(args)}: isError — ${res.text.slice(0, 200)}`); return; }
      const got = verdict(pick(res.value));
      if (got !== want) problems.push(`${tool} ${JSON.stringify(args)}: ${got}, want ${want}${args.profile ? " — the auto verdict is what a stripped key answers" : ""}`);
    };
    const expectRefusal = async (tool, args) => {
      const res = reply(await callTool(tool, args, env));
      if (!res.isError) { problems.push(`${tool} ${JSON.stringify(args)}: NOT an isError reply — answered a verdict (${res.text.slice(0, 160)}) for a profile the library refuses by name`); return; }
      const msg = res.value?.error ?? "";
      if (!msg.includes(`unknown profile name: ${JSON.stringify(UNKNOWN)}`) || !msg.includes(HELD)) problems.push(`${tool} ${JSON.stringify(args)}: the error is ${JSON.stringify(msg)} — want ProfileNameError's message with the value as typed and the names held`);
    };
    const one = (v) => v;
    const first = (v) => { assert.equal(v.sessions?.length, 1, `fleet-status listed ${v.sessions?.length} sessions on an isolated socket holding one`); return v.sessions[0]; };
    await expectVerdict("session-status", { name: "p3" }, "BLOCKED/acme", one); // the control
    await expectVerdict("session-status", { name: "p3", profile: "codex" }, "IDLE/null", one);
    await expectVerdict("session-status", { name: "p3", profile: "acme" }, "BLOCKED/acme", one);
    await expectRefusal("session-status", { name: "p3", profile: UNKNOWN });
    await expectVerdict("fleet-status", {}, "BLOCKED/acme", first); // the control
    await expectVerdict("fleet-status", { profile: "codex" }, "IDLE/null", first);
    await expectRefusal("fleet-status", { profile: UNKNOWN });
    // the schema is how a client learns the key exists at all — an undeclared key is stripped, not refused
    const tools = await toolsFull(env);
    for (const name of ["session-status", "fleet-status"]) {
      const t = tools.find((x) => x.name === name);
      if (!t) { problems.push(`${name}: not in tools/list`); continue; }
      const prop = t.inputSchema?.properties?.profile;
      if (prop?.type !== "string") problems.push(`${name}: inputSchema declares no string property "profile" — properties are ${JSON.stringify(Object.keys(t.inputSchema?.properties ?? {}))}`);
      if ((t.inputSchema?.required ?? []).includes("profile")) problems.push(`${name}: "profile" is REQUIRED — an optional argument made required is breaking (VERSIONING item 2)`);
    }
    assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});
