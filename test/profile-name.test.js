/**
 * `Monitor.snapshot(session, profileName?)` — the covered parameter on FOUR Monitor signatures (snapshot, fleet,
 * fleetReport, fleetFast's opts) — is HONOURED when the name is one this Monitor holds and REFUSED with a named
 * class, `ProfileNameError`, when it is not (TMUX-155; gates G4 a covered signature whose behaviour on a bad value
 * was declared nowhere, G1 the one line that honoured it was guarded by nothing, G6).
 *
 * Measured 2026-09-22 20:23Z on 1faae68 by driving the built root (scratch/ga-fire-2026-09-22-20Z/
 * probe-profilename-drive.log, -drive2.log): the parameter was honoured by ONE line (src/core/monitor.ts:286),
 * passed by 0 product call sites and 0 tests, and an unknown or misspelled name — "no-such-profile", or "Acme" for
 * a lexicon profile named "acme" — silently fell back to the auto chain: the caller received the auto verdict
 * labelled with whichever profile spoke, byte-identical to the unnamed call, and a Snapshot carries no field that
 * tells the honoured request from the ignored one. Flipping the lookup's `===` or deleting it left 490/490 green.
 * The package's idiom for a bad argument is a named refusal (SocketNameError, SessionNameError, AgentNameError,
 * SinceError, OutPathError: each names the argument, the value as typed and the rule), so the ship took the card's
 * arm (A): refuse, and root-export the class so a consumer can catch on it (test/root-error-classes.test.js drives
 * it through the root beside the other seven).
 *
 * The live half reuses test/lexicon.test.js's settle-then-paint discipline verbatim: never type into a shell that
 * is still changing; accept the paint only once the marker sits on an ANCHORED line of a tail that has stopped
 * changing; attach the pane each snapshot actually read to every message. The marker is ASCII (`@@ 1.`) for the
 * reason given there, and is matched by none of the four built-in profiles — which is the property this file needs:
 * the chain's first auto opinion must NOT be the profile the case names.
 *
 * The contract, each line a check that FAILS if the property is removed:
 *   (1) HONOURED: with lexicon profile `acme` (blocked: `^\s*@@\s*\d+\.`) in front of the built-ins and the pane
 *       painted `@@ 1. Deploy`, snapshot(s) → BLOCKED / classifiedBy "acme" (the control: auto's first opinion is
 *       acme); snapshot(s, "codex") → state "IDLE" / classifiedBy null — codex has no opinion on that tail, so the
 *       answer DIFFERS from auto, which is the only way a pane can show the name was honoured rather than ignored;
 *       snapshot(s, "acme") → BLOCKED / "acme" again. RED when the lookup's `===` is flipped ("codex" then selects
 *       a profile that is not codex) or the lookup is deleted (the auto chain answers BLOCKED / acme for "codex").
 *   (2) REFUSED, all four signatures in ONE collected message: snapshot(s, "no-such-profile"), fleet(…),
 *       fleetReport(…) and fleetFast({ deep: [s], profileName }) each REJECT with `instanceof ta.ProfileNameError`
 *       from the ROOT (`import * as ta` — a named import of an unexported name is a load error naming nothing),
 *       `err.name === "ProfileNameError"`, and a message carrying the value as typed and the names this Monitor
 *       holds; the case typo "Acme" is refused the same way (names are exact). A drive that neither rejects nor
 *       matches is a problem, never a pass — on the parent tree all five RESOLVED to the auto verdict.
 *   (3) The judgement comes BEFORE the driver is asked: on a socket no server listens on, snapshot(…, unknown) and
 *       fleet(unknown) both reject with the class — fleet would otherwise resolve `[]` for a dead server (its
 *       listSessions swallow, kept on purpose) and never reach the per-session lookup — and no tmux server exists
 *       on that socket afterwards. RED on the parent for fleet (resolved []) and snapshot (resolved GONE).
 *
 * Run: npm run build && node --test test/profile-name.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ta from "../dist/index.js";
import { killServerSync } from "./helpers/kill-server.js";

const CLASS = "ProfileNameError";
const UNKNOWN = "no-such-profile";
/** The lexicon profile the live case puts in FRONT of the built-ins; `@@ 1.` is matched by none of the four. */
const ACME = { name: "acme", blocked: ["^\\s*@@\\s*\\d+\\."] };

/** `{ err }` when `run` rejected or threw, `{ value }` when it resolved — so a message can say WHAT resolved. */
async function outcome(run) {
  try { return { value: await run() }; } catch (err) { return { err }; }
}

/** The one shape a refusal must have, or the reasons it does not — `[]` is a pass. */
function refusalProblems(label, { err, value }, typed, held) {
  if (err === undefined) return [`${label}: did NOT reject — resolved to ${JSON.stringify(summarize(value))}, the auto verdict wearing whichever profile spoke; the caller cannot tell it from an honoured request`];
  const problems = [];
  const Cls = ta[CLASS];
  if (typeof Cls !== "function") problems.push(`${label}: threw ${err?.constructor?.name ?? typeof err} and the root exports no \`${CLASS}\` — a consumer has no name to write for instanceof`);
  else if (!(err instanceof Cls)) problems.push(`${label}: threw ${err?.constructor?.name ?? typeof err}, not an instance of the root's \`${CLASS}\``);
  if (err?.name !== CLASS) problems.push(`${label}: err.name is ${JSON.stringify(err?.name)}, not "${CLASS}" — the seven other classes set this.name so a log line names the class`);
  if (!String(err?.message).includes(JSON.stringify(typed))) problems.push(`${label}: the message ${JSON.stringify(err?.message)} does not carry the value as typed, ${JSON.stringify(typed)}`);
  for (const name of held) if (!String(err?.message).includes(name)) problems.push(`${label}: the message ${JSON.stringify(err?.message)} does not name the held profile "${name}" — a misspelling is only diagnosable against the names that WOULD have been accepted`);
  return problems;
}

/** A Snapshot, an array of them, or a report, reduced to the verdicts a message needs. */
function summarize(v) {
  const one = (s) => s && typeof s === "object" && "state" in s ? { state: s.state, classifiedBy: s.classifiedBy } : s;
  if (Array.isArray(v)) return v.map(one);
  if (v && typeof v === "object" && Array.isArray(v.sessions)) return { sessions: v.sessions.map(one) };
  return one(v);
}

test("profile name: a KNOWN name is honoured on a live pane — \"codex\" answers IDLE / null where auto answers BLOCKED / acme — and an UNKNOWN or misspelled one is refused with the root's ProfileNameError on all four signatures, one message", async () => {
  const S = `ta-pn-${process.pid}`;
  const H = mkdtempSync(join(tmpdir(), "ta-pn-"));
  const t = new ta.Tmux({ socket: S });
  try {
    execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", "pn1", "-c", "/tmp"], { stdio: "ignore" });
    // same flags as Tmux.capturePane (monitor reads 40 lines, joined), so tails compare like-for-like
    const capture = () => execFileSync("tmux", ["-L", S, "capture-pane", "-p", "-J", "-t", "=pn1:", "-S", "-40"], { encoding: "utf8" });
    // the classifier's view of a pane (monitor.ts snapshot(): last 6 non-empty, right-trimmed lines)
    const tailOf = (pane) => pane.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6);
    // anchored like ACME — an echoed command line merely CONTAINING "@@ 1." must not count
    const marker = /^\s*@@\s*\d+\./;
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
    // 1. never type into a shell still sourcing its rc files (ble.sh buffers those keys and replays them)
    assert.ok((await settled(() => true, 40)) !== null,
      `test setup: the fresh shell never went quiet (20 s). Pane:\n${capture().slice(-400)}`);
    // 2. paint, and accept only a quiet tail with the marker on an anchored line
    let painted = null;
    for (let i = 0; i < 3 && painted === null; i++) {
      execFileSync("tmux", ["-L", S, "send-keys", "-t", "=pn1:", "clear; printf '\\n@@ 1. Deploy\\n'", "Enter"], { stdio: "ignore" });
      painted = await settled((tail) => tail.some((l) => marker.test(l)), 20);
    }
    assert.ok(painted !== null, `test setup: the prompt never settled on an anchored tail line. Pane:\n${capture().slice(-400)}`);
    // 3. record what each snapshot actually read, so a failure shows the pane AT SNAPSHOT TIME
    const seen = [];
    const capturePane = t.capturePane.bind(t);
    t.capturePane = async (name, lines) => { const pane = await capturePane(name, lines); seen.push(pane); return pane; };
    const evidence = () => seen.map((pane, i) =>
      `--- pane as read by snapshot ${i + 1}${tailOf(pane).join("\n") === tailOf(painted).join("\n") ? "" : " (DRIFTED since the guard)"}:\n${pane.trimEnd().slice(-400)}`).join("\n");

    const chain = ta.resolveProfiles({ profiles: [ACME] });
    const held = chain.map((p) => p.name);
    assert.deepEqual(held, ["acme", "claude-code", "codex", "aider", "generic-shell"],
      "fixture: acme must sit in FRONT of the four built-ins, or auto's first opinion is not the profile this case names");
    const m = new ta.Monitor(t, new ta.Ledger(join(H, "ledger")), H, chain);

    // (1) HONOURED — the control first: auto's first opinion is acme, so a named "codex" can only agree by ignoring the name
    const auto = await m.snapshot("pn1");
    assert.equal(auto.state, "BLOCKED", `control: auto must read the painted marker as BLOCKED (lastLine: ${auto.lastLine})\n${evidence()}`);
    assert.equal(auto.classifiedBy, "acme", `control: auto's classifier must be acme, the profile in front\n${evidence()}`);
    const codex = await m.snapshot("pn1", "codex");
    assert.equal(codex.classifiedBy, null,
      `snapshot(s, "codex") was classified by ${JSON.stringify(codex.classifiedBy)}: the named profile has no opinion on this tail, so any classifier here means the name was NOT honoured\n${evidence()}`);
    assert.equal(codex.state, "IDLE",
      `snapshot(s, "codex") read ${codex.state}: codex has no opinion on "@@ 1." and the core signals say IDLE — BLOCKED here is auto's answer wearing the name\n${evidence()}`);
    const acme = await m.snapshot("pn1", "acme");
    assert.equal(`${acme.state}/${acme.classifiedBy}`, "BLOCKED/acme", `snapshot(s, "acme") must agree with auto when the named profile IS the one that spoke\n${evidence()}`);

    // (2) REFUSED — five drives, one message
    const problems = [];
    problems.push(...refusalProblems(`snapshot(s, ${JSON.stringify(UNKNOWN)})`, await outcome(() => m.snapshot("pn1", UNKNOWN)), UNKNOWN, held));
    problems.push(...refusalProblems(`snapshot(s, "Acme") — a case typo of a held name`, await outcome(() => m.snapshot("pn1", "Acme")), "Acme", held));
    problems.push(...refusalProblems(`fleet(${JSON.stringify(UNKNOWN)})`, await outcome(() => m.fleet(UNKNOWN)), UNKNOWN, held));
    problems.push(...refusalProblems(`fleetReport(${JSON.stringify(UNKNOWN)})`, await outcome(() => m.fleetReport(UNKNOWN)), UNKNOWN, held));
    problems.push(...refusalProblems(`fleetFast({ deep: [s], profileName: ${JSON.stringify(UNKNOWN)} })`, await outcome(() => m.fleetFast({ deep: ["pn1"], profileName: UNKNOWN })), UNKNOWN, held));
    assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}\n${evidence()}`);
  } finally {
    killServerSync(S); // and its socket file, once tmux says the server is gone
    rmSync(H, { recursive: true, force: true });
  }
});

test("profile name: the judgement comes BEFORE the driver is asked — on a socket with no server, snapshot and fleet both reject with ProfileNameError and no server exists afterwards", async () => {
  const S = `ta-pn0-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  const H = mkdtempSync(join(tmpdir(), "ta-pn0-"));
  try {
    const m = new ta.Monitor(new ta.Tmux({ socket: S }), new ta.Ledger(join(H, "ledger")), H);
    const held = ["claude-code", "codex", "aider", "generic-shell"]; // the stock chain
    const problems = [];
    problems.push(...refusalProblems(`snapshot("pn0", ${JSON.stringify(UNKNOWN)}) on a dead socket`, await outcome(() => m.snapshot("pn0", UNKNOWN)), UNKNOWN, held));
    problems.push(...refusalProblems(`fleet(${JSON.stringify(UNKNOWN)}) on a dead socket`, await outcome(() => m.fleet(UNKNOWN)), UNKNOWN, held));
    assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    let sessions = "";
    try { sessions = execFileSync("tmux", ["-L", S, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch { /* no server on that socket — the expected answer */ }
    assert.equal(sessions.trim(), "", `a tmux server exists on ${S} with sessions ${JSON.stringify(sessions.trim())} — a drive reached the driver before its judgement`);
  } finally {
    rmSync(H, { recursive: true, force: true });
  }
});
