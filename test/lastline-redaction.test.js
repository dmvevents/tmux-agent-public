/**
 * `Snapshot.lastLine` is redacted at its ONE producer (TMUX-156; gates G2 — docs/THREAT-MODEL.md promises redaction
 * at every boundary and, in accepted risk 1, that every read path redacts; G1 — no test asked about the field; G3 —
 * it is the body of every `watch` notification, so it is the one pane read built to leave the host).
 *
 * Measured 2026-09-23 00:23Z on 30a9cb0 by driving the built root and the built CLI (scratch/ga-fire-2026-09-23-00Z/
 * probe-lastline2.log, probe-lastline3b.log): src/core/monitor.ts:314 took the last non-empty line of the raw pane and
 * :341 published it as `lastLine: lastLine.slice(0, 160)` with `redact` imported nowhere in the file, while every other
 * pane read in the product redacts (MCP capture-pane and read-log, the CLI's calibrate draft, the dashboard's pane and
 * log tail, the orchestrator's previews). A pane whose last line was `token=AKIAFAKEFAKEFAKEFAK1` (a FAKE value in the
 * built-in AWS pattern's shape) came back raw from Monitor.snapshot(), fleetReport() and fleetFast({ deep }), and
 * through the CLI the plant reached a loopback webhook stub in watch's POST body, watch's stdout JSON, the console
 * sink's stderr, the status.json record and the status table, and both MCP status replies — while the ledger, the
 * `log` verb and MCP capture-pane redacted it (the controls). The ship takes the card's arm (A): redact at the
 * producer, BEFORE the 160-char cut (a key whose tail straddles column 160 would otherwise be cut below its pattern
 * and survive as a partial), with classification still reading the RAW tail so no verdict moves; every consumer —
 * an embedder reading Snapshot through the root, the operator's own lexicon redact[] rules — inherits.
 *
 * The contract, each line a check that FAILS if the property is removed (RED on the 31bca7a dist: the plant raw on
 * every surface below, quoted in the message):
 *   (1) ROOT: on an isolated tmux server, a shell settled and then painted — printf, then BLOCK, so the plant is the
 *       pane's LAST line (a printf followed by a fresh prompt lands one line early) — Monitor.snapshot(s).lastLine,
 *       every fleetReport() row and every fleetFast({ deep }) row carry `[REDACTED_AWS_KEY]` and not the plant, both
 *       halves asserted (an absence alone is vacuous: TMUX-96's lesson), and each equals redact() of the last line
 *       of the pane the monitor ACTUALLY read, cut to 160 — one collected message quoting that pane. A lexicon
 *       redact[] rule with a stranger's shape (`MYC_[A-Z0-9]{10}`, README's own example) is honoured on the field too.
 *       A second pane's plant STRADDLES column 160 (141 filler chars, then the 20-char key): the published field
 *       carries the whole marker and no `AKIA` — RED when the cut precedes the redaction (the partial
 *       `AKIAFAKEFAKEFAKEFAK` survives, below the pattern).
 *   (2) CLASSIFICATION UNMOVED: a lexicon profile whose blocked pattern is the RAW plant classifies the pane
 *       BLOCKED / classifiedBy "acme" while the published lastLine is redacted — RED when the tail is redacted before
 *       classify (the profile then has no opinion: IDLE / null).
 *   (3) BOUNDARIES, through the built CLI and MCP server against a loopback stub on port 0: the webhook body `watch`
 *       POSTs (read from the STUB, never from what the CLI printed), watch's stdout JSON, the console sink's stderr
 *       line, the status.json record and the status table, and the MCP session-status reply each carry `[REDACTED`
 *       and neither the plant nor the stranger's value — the lexicon loaded from the home's lexicon.json the way the
 *       CLI and the server load it at startup — one collected message.
 *   (4) DOCS: docs/THREAT-MODEL.md's accepted risk 1 names the snapshot's `lastLine` among the read paths that
 *       redact — a rewording reds rather than silently un-pinning the promise this file drives.
 *
 * Run: npm run build && node --test test/lastline-redaction.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ta from "../dist/index.js";
import { killServerSync } from "./helpers/kill-server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist/bin/tmux-agent.js");
const MCP = join(ROOT, "dist/mcp/server.js");

/** A FAKE value in the built-in AWS pattern's shape (AKIA + 16 uppercase alphanumerics) — never a real key. */
const PLANT = "AKIAFAKEFAKEFAKEFAK1";
const AWS_MARK = "[REDACTED_AWS_KEY]";
/** A stranger's shape no built-in knows, and the lexicon rule that teaches it (README's own example shape). */
const STRANGER = "MYC_STRANGER01";
const MYC_MARK = "[REDACTED_MYC]";
const LEXICON = { redact: [{ name: "myc", pattern: "MYC_[A-Z0-9]{10}", replacement: MYC_MARK }] };
/** What the shell prints and then blocks on. `aws` / `myc` are not pair-rule names, so the AWS marker survives whole
 * (a `token=` prefix would fold it into the pair rule's `[REDACTED]`). */
const RAW = `aws ${PLANT} myc ${STRANGER}`;
/** 141 filler chars put the key's last byte at column 161: cut-then-redact leaves `AKIAFAKEFAKEFAKEFAK` (AKIA + 15,
 * below the pattern's 16); redact-then-cut leaves the whole 18-char marker inside the 160. */
const RAW_STRADDLE = `${"x".repeat(141)}${PLANT}`;
/** The lexicon profile whose blocked pattern IS the raw plant — the control that classification reads the unredacted tail. */
const ACME = { name: "acme", blocked: [PLANT] };

// ---------------------------------------------------------------------------------------------
// pane helpers — test/lexicon.test.js's settle-then-paint discipline: never type into a shell that is still
// changing; accept the paint only once the plant IS the last non-empty line of a tail that has stopped changing
// ---------------------------------------------------------------------------------------------
/** same flags as Tmux.capturePane (40 lines, joined), so tails compare like-for-like */
const pane = (S, name) => execFileSync("tmux", ["-L", S, "capture-pane", "-p", "-J", "-t", `=${name}:`, "-S", "-40"], { encoding: "utf8" });
/** the classifier's view (monitor.ts snapshot(): last 6 non-empty, right-trimmed lines) */
const tailOf = (text) => text.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6);
const lastOf = (text) => tailOf(text).at(-1) ?? "";
/** two identical non-blank captures 500 ms apart whose tail satisfies `ok` → that pane; null on timeout */
async function settled(S, name, ok, tries) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = pane(S, name);
    if (cur.trim() && cur === prev && ok(tailOf(cur))) return cur;
    prev = cur;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
/** a detached session wide enough that the straddling line never wraps (the monitor joins wrapped lines anyway) */
function newSession(S, name) {
  execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", name, "-x", "240", "-y", "50", "-c", "/tmp"], { stdio: "ignore" });
}
/** print `raw`, then BLOCK, so `raw` stays the pane's last line for the whole case; returns the settled pane */
async function paint(S, name, raw) {
  assert.ok((await settled(S, name, () => true, 40)) !== null,
    `test setup: ${name}'s fresh shell never went quiet (20 s). Pane:\n${pane(S, name).slice(-400)}`);
  let painted = null;
  for (let i = 0; i < 3 && painted === null; i++) {
    execFileSync("tmux", ["-L", S, "send-keys", "-t", `=${name}:`, `clear; printf '${raw} '; sleep 60`, "Enter"], { stdio: "ignore" });
    painted = await settled(S, name, (tail) => tail.at(-1) === raw, 20);
  }
  assert.ok(painted !== null, `test setup: ${name}'s last line never settled on the plant. Pane:\n${pane(S, name).slice(-400)}`);
  return painted;
}

// ---------------------------------------------------------------------------------------------
// (1) + (2): the ROOT — the producer and the two listings that inherit from it
// ---------------------------------------------------------------------------------------------
test("lastLine redaction: the ROOT publishes redact() of the pane's last line, cut AFTER redaction, on snapshot / fleetReport / fleetFast({ deep }) — a lexicon rule honoured, a key straddling column 160 whole — while a profile whose blocked pattern is the RAW plant still classifies BLOCKED", async () => {
  const S = `ta-ll-${process.pid}`;
  const H = mkdtempSync(join(tmpdir(), "ta-ll-"));
  const t = new ta.Tmux({ socket: S });
  try {
    newSession(S, "ll1");
    newSession(S, "ll2");
    await paint(S, "ll1", RAW);
    await paint(S, "ll2", RAW_STRADDLE);

    // the stranger's rule, installed the way the CLI and the MCP server install it at startup; then the fixture's
    // own premises, so a red below is the FIELD and not redact()
    assert.equal(ta.configureRedaction(LEXICON), 1, "fixture: exactly one lexicon redact rule must be active");
    assert.equal(ta.redact(RAW), `aws ${AWS_MARK} myc ${MYC_MARK}`,
      "fixture: redact() itself must take both shapes out of the plant line — the field cannot inherit what redact() does not do");
    assert.equal(ta.redact(RAW_STRADDLE.slice(0, 160)), RAW_STRADDLE.slice(0, 160),
      "fixture: the straddling key CUT at 160 must sit below the pattern, or the two orders cannot be told apart");

    // record what each snapshot actually read, so a failure shows the pane AT SNAPSHOT TIME, per session
    const seen = [];
    const capturePane = t.capturePane.bind(t);
    t.capturePane = async (name, lines) => { const text = await capturePane(name, lines); seen.push({ name, text }); return text; };
    const lastRead = (name) => seen.filter((e) => e.name === name).at(-1)?.text;
    const evidence = () => seen.map(({ name, text }, i) => `--- pane ${name} as read by capture ${i + 1}:\n${text.trimEnd().slice(-400)}`).join("\n");

    const chain = ta.resolveProfiles({ profiles: [ACME] });
    assert.equal(chain[0]?.name, "acme", "fixture: acme must sit in FRONT of the built-ins, or auto's first opinion is not the profile this case names");
    const m = new ta.Monitor(t, new ta.Ledger(join(H, "ledger")), H, chain);

    const problems = [];
    /** both halves on one field — the markers present, the raw values absent — and the field is exactly
     * redact(<last line the monitor read>) cut to 160 */
    const check = (label, field, { marks, raws, name }) => {
      if (typeof field !== "string") { problems.push(`${label}: lastLine is ${JSON.stringify(field)}, not a string`); return; }
      for (const mark of marks) if (!field.includes(mark)) problems.push(`${label}: ${JSON.stringify(field)} lacks ${mark}`);
      for (const raw of raws) if (field.includes(raw)) problems.push(`${label}: ${JSON.stringify(field)} carries the raw ${JSON.stringify(raw)}`);
      const read = lastRead(name);
      if (read === undefined) problems.push(`${label}: the monitor read no pane for ${name} — a field built from nothing is not a redacted one`);
      else {
        const want = ta.redact(lastOf(read)).slice(0, 160);
        if (field !== want) problems.push(`${label}: ${JSON.stringify(field)} is not redact(<last line read>).slice(0, 160) = ${JSON.stringify(want)}`);
      }
      if (field.length > 160) problems.push(`${label}: ${field.length} chars — the 160-char cut is gone`);
    };
    const short = { marks: [AWS_MARK, MYC_MARK], raws: [PLANT, STRANGER], name: "ll1" };
    // the straddler: the raw value is CUT in both orders, so its absence proves nothing — the surviving prefix does
    const straddle = { marks: [AWS_MARK], raws: ["AKIA"], name: "ll2" };

    const s1 = await m.snapshot("ll1");
    check("snapshot(ll1).lastLine", s1.lastLine, short);
    // (2) classification reads the RAW tail: acme's blocked pattern is the plant itself
    if (`${s1.state}/${s1.classifiedBy}` !== "BLOCKED/acme") {
      problems.push(`snapshot(ll1) classified ${s1.state} / ${JSON.stringify(s1.classifiedBy)} — acme's blocked pattern IS the raw plant, so anything but BLOCKED/acme means the profile was handed a redacted tail`);
    }
    const s2 = await m.snapshot("ll2");
    check("snapshot(ll2).lastLine (key straddling column 160)", s2.lastLine, straddle);

    const fr = await m.fleetReport();
    if (fr.sessions.length !== 2) problems.push(`fleetReport() listed ${fr.sessions.length} sessions, not the 2 painted — an empty listing is not a redacted one`);
    for (const row of fr.sessions) check(`fleetReport() row ${row.session}.lastLine`, row.lastLine, row.session === "ll2" ? straddle : short);

    const ff = await m.fleetFast({ deep: ["ll1", "ll2"] });
    if (ff.sessions.length !== 2) problems.push(`fleetFast({ deep }) listed ${ff.sessions.length} sessions, not the 2 painted`);
    for (const row of ff.sessions) check(`fleetFast({ deep: [ll1, ll2] }) row ${row.session}.lastLine`, row.lastLine, row.session === "ll2" ? straddle : short);

    assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}\n${evidence()}`);
  } finally {
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (3): the BOUNDARIES — through the built CLI and the built MCP server, against a loopback stub
// ---------------------------------------------------------------------------------------------
function cli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Minimal webhook receiver on port 0: the body is read HERE, never from what the CLI printed. */
function receiver() {
  const hits = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => { hits.push({ method: req.method, body }); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}/hook`, hits, close: () => srv.close() }));
  });
}
/** One JSON-RPC round trip over stdio to the built MCP server: initialize, then session-status for `name`; the reply text. */
function mcpSessionStatus(S, H, name) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [MCP], { env: { ...process.env, TMUX_AGENT_SOCKET: S, TMUX_AGENT_HOME: H }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "", err = "", asked = false, done = false;
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`MCP server timed out; stderr: ${err.slice(0, 300)}`)); }, 25_000);
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 0 && !asked) {
          asked = true;
          p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "session-status", arguments: { name } } }) + "\n");
        } else if (m.id === 1 && !done) {
          done = true;
          clearTimeout(timer);
          p.stdin.end(); // the transport closing is the server's shutdown signal — only after the reply
          resolve(m.result?.content?.[0]?.text ?? "");
        }
      }
    });
    p.on("error", reject);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) + "\n");
  });
}

test("lastLine redaction: through the built CLI and MCP server — the webhook body watch POSTs (read from the stub), watch's stdout JSON, the console sink's stderr, the status.json record, the status table and the MCP session-status reply each carry the marker and neither the plant nor the lexicon-taught stranger's value", async () => {
  const S = `ta-llb-${process.pid}`;
  const H = mkdtempSync(join(tmpdir(), "ta-llb-"));
  // the default path both the CLI and the MCP server load and configureRedaction() from at startup
  writeFileSync(join(H, "lexicon.json"), JSON.stringify(LEXICON));
  const rec = await receiver();
  try {
    newSession(S, "ll3");
    const painted = await paint(S, "ll3", RAW);
    const env = { TMUX_AGENT_HOME: H };
    const problems = [];
    const check = (label, text) => {
      if (typeof text !== "string" || !text) { problems.push(`${label}: nothing to read (${JSON.stringify(text)}) — an empty surface is not a redacted one`); return; }
      if (!text.includes("[REDACTED")) problems.push(`${label}: no [REDACTED marker in ${JSON.stringify(text.slice(0, 300))}`);
      for (const raw of [PLANT, STRANGER]) if (text.includes(raw)) problems.push(`${label}: carries the raw ${JSON.stringify(raw)}: ${JSON.stringify(text.slice(0, 300))}`);
    };
    const lastJson = (stdout) => { try { return JSON.parse(stdout.trim().split("\n").pop()); } catch { return null; } };

    // (a) watch → webhook, the body as the STUB received it; and watch's own stdout JSON
    const w = await cli(["--socket", S, "watch", "ll3", "--idle-secs", "2"], { ...env, TMUX_AGENT_SLACK_WEBHOOK: rec.url });
    assert.equal(w.code, 0, `watch must exit 0 on the idle painted pane, got ${w.code} (stderr: ${w.stderr.slice(0, 300)})\n${painted.trimEnd().slice(-400)}`);
    assert.ok(rec.hits.length >= 1, "the sink must actually POST — nothing received is not a redacted body");
    check("webhook body as RECEIVED by the stub", rec.hits[0].body);
    check("watch stdout JSON .lastLine", lastJson(w.stdout)?.lastLine);

    // (b) the console sink, when no webhook is configured
    const c = await cli(["--socket", S, "watch", "ll3", "--idle-secs", "2"], { ...env, TMUX_AGENT_SLACK_WEBHOOK: "" });
    assert.equal(c.code, 0, `watch (console sink) must exit 0, got ${c.code} (stderr: ${c.stderr.slice(0, 300)})`);
    check("console sink stderr [notify] line", c.stderr.split("\n").find((l) => l.includes("[notify]")) ?? "");

    // (c) status --json FILE: the record in the file, and the table on stdout
    const file = join(H, "status.json");
    const st = await cli(["--socket", S, "status", "--json", file], env);
    assert.equal(st.code, 0, `status must exit 0, got ${st.code} (stderr: ${st.stderr.slice(0, 300)})`);
    const record = JSON.parse(readFileSync(file, "utf8")).sessions.find((x) => x.session === "ll3");
    assert.ok(record, `status.json carries no record for ll3 — sessions: ${JSON.stringify(JSON.parse(readFileSync(file, "utf8")).sessions.map((x) => x.session))}`);
    check("status.json record .lastLine", record.lastLine);
    check("status table row", st.stdout.split("\n").find((l) => l.startsWith("ll3\t")) ?? "");

    // (d) the MCP session-status reply, whole (a 160-char slice of it once hid this field: probe-lastline3.log)
    const reply = await mcpSessionStatus(S, H, "ll3");
    check("MCP session-status reply", reply);
    let parsed = null;
    try { parsed = JSON.parse(reply); } catch { problems.push(`MCP session-status reply is not JSON: ${reply.slice(0, 200)}`); }
    if (parsed) check("MCP session-status reply .lastLine", parsed.lastLine);

    assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}\n--- pane as painted:\n${painted.trimEnd().slice(-400)}`);
  } finally {
    rec.close();
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (4): the promise, pinned
// ---------------------------------------------------------------------------------------------
test("lastLine redaction: docs/THREAT-MODEL.md's accepted risk 1 names the snapshot's `lastLine` among the read paths that redact", () => {
  const text = readFileSync(join(ROOT, "docs/THREAT-MODEL.md"), "utf8");
  // the sentence wraps across lines in the doc (the break falls between "every" and "*read*"), so blanks are \s+
  const m = /every\s+\*read\*\s+path\s+\(([^)]*)\)\s+redacts/.exec(text);
  assert.ok(m, "docs/THREAT-MODEL.md must keep its accepted-risk sentence `every *read* path (…) redacts` — the promise TMUX-156 measured false for one path");
  const paths = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(paths.length >= 4, `parsed ${paths.length} read path(s) from "(${m[1]})" — a near-empty list is not the promise`);
  for (const p of ["`read-log`", "`capture-pane`", "`lastLine`"]) {
    assert.ok(paths.some((x) => x.includes(p)), `the read paths the sentence names (${m[1]}) do not include ${p} — a rewording un-pins the promise this suite drives`);
  }
});
