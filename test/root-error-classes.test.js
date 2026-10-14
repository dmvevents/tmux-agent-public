/**
 * The seven error classes a covered root VALUE throws are nameable from the package ROOT — `AgentNameError`,
 * `CwdError`, `OutPathError`, `PolicyDenied`, `SessionNameError`, `SinceError`, `SocketNameError` — so a consumer
 * catching one can write `err instanceof CwdError` from `import { CwdError } from "tmux-agent"` instead of matching on
 * `err.message`, whose wording VERSIONING.md's NOT-covered section says may change any time (TMUX-154; gates G4 the
 * public API is declared, and here it was thrown at a consumer without being declared; G1 seven classes reached a
 * consumer through covered calls and only one had any instanceof case, all six of them through a deep import; G6).
 *
 * Measured 2026-09-22 16:23Z on e510bd5 (scratch/ga-fire-2026-09-22-16Z/probe-error-classes-3.log, -4.log): nine
 * classes in the built package extend Error and are thrown at a consumer; the root exported TWO of them (`TmuxError`,
 * `LexiconError`) and none of the other seven, every one of which is thrown by a value VERSIONING.md item 6 COVERS —
 * `new Tmux({…})`, `sessionTarget()`, `Orchestrator.spawn()`, `Policy.assertAllowed()`, `Mailbox.send()`,
 * `wasteReport()`, `publishStatus()`. `constructor.name in ta` was false for all seven. The deep route the product
 * itself uses (nine instanceof sites via `../core/*.js`) is refused to a consumer by the exports map
 * (ERR_PACKAGE_PATH_NOT_EXPORTED on all five paths — driven by TMUX-139's exports-map case in
 * test/versioning-contract.test.js, cited here and not re-tested), and dist/* is declared internal, so the only handle
 * left was err.message. The CLI never needed the class: it turns every one of the seven INTO a FlagError and exit 64.
 * The library consumer does.
 *
 * Everything here is reached through `import * as ta from "../dist/index.js"` — the ROOT, never a dist/core/* path —
 * because that is the one route a consumer has. A namespace import rather than named imports on purpose: a named import
 * of a name the root does not export is a SyntaxError at module load, which would turn the parent tree's red into a
 * load error naming nothing; `ta[name]` is `undefined` there, and the case says so, for all seven, in ONE message.
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) each of the seven covered calls above, driven with the value the class refuses, throws — and what it throws is
 *       `instanceof ta.<Class>` with `err.name === "<Class>"`; `PolicyDenied` on all THREE `DenialReason` arms
 *       (read-only surface, deny-list, allow-list) with `err.reason` equal to the arm — RED on 424c9c1: the seven
 *       are not exported, so `ta.<Class>` is undefined for every one of them. Collected into one problems array and
 *       asserted ONCE, so the red names all seven together — a per-class loop stops at the first and reports the
 *       rest green by silence. A call that does NOT throw is a problem too, never a pass: the fixture value must
 *       still be one the class refuses.
 *   (b) the drive is not vacuous and cannot go stale: the classes the root exports whose name ends in Error or Denied
 *       equal the nine this file knows — the seven driven here plus `TmuxError` and `LexiconError`, whose throws need
 *       a live tmux server and a lexicon file and are driven in test/unit.test.js and test/lexicon.test.js — BOTH ways,
 *       so a tenth class exported tomorrow is a red here until it is driven, and a class that leaves the root is a
 *       stale entry rather than a silent shrink.
 *   (c) nothing was touched on the way to a refusal: no tmux server was started on the throwaway socket (the driver
 *       is never asked anything before the judgement), and the throwaway home's mailbox has no `../evil` directory.
 *
 * EIGHT since TMUX-155: `ProfileNameError`, what `Monitor.snapshot(session, profileName)` — and fleet(), fleetReport(),
 * fleetFast({ profileName }) through it — throws for a profile name this Monitor does not hold, where until then an
 * unknown or misspelled name silently fell back to the auto chain (measured 2026-09-22 20:23Z on 1faae68,
 * scratch/ga-fire-2026-09-22-20Z/probe-profilename-drive.log). The name is judged BEFORE the driver is asked, which is
 * what lets its drive sit here beside the other seven: (c) below still holds, no server is started on the throwaway
 * socket. The honoured path and the refusal on all four signatures are driven on a live pane in
 * test/profile-name.test.js; this file owns the ROOT's view of the class.
 *
 * Run: node --test test/root-error-classes.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import * as ta from "../dist/index.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

// A throwaway home, so the Orchestrator's ctor mkdir and the mailbox's directories never touch a real ~/.tmux-agent.
const HOME = tempHome("ta-rooterr-");
process.env.TMUX_AGENT_HOME = HOME;
after(() => removeTempHomes()); // every home this file made, once its last test has run
// A socket no server listens on and nothing here ever contacts: every drive below is refused BEFORE the driver is asked.
const SOCKET = `ta-rooterr-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;

/** The two classes the root already exported before TMUX-154, driven elsewhere (see (b) in the header). */
const DRIVEN_ELSEWHERE = { TmuxError: "test/unit.test.js", LexiconError: "test/lexicon.test.js" };

/**
 * One drive per covered call, with the value its class refuses. `via` is the covered signature in the words a consumer
 * would write; `run` returns nothing — the throw is the result. `reason`, when present, is the DenialReason arm a
 * PolicyDenied must carry (its one own field, honoured at dist/core/orchestrator.js: `e instanceof PolicyDenied ?
 * e.reason : "policy"`).
 */
function drives() {
  const ledger = new ta.Ledger(join(HOME, "ledger"));
  const tmux = new ta.Tmux({ socket: SOCKET });
  const orch = new ta.Orchestrator(tmux, ledger, new ta.Policy({}), "rooterr");
  const monitor = new ta.Monitor(tmux, ledger, HOME);
  return [
    { cls: "SocketNameError", via: 'new Tmux({ socket: "../x" })', run: () => new ta.Tmux({ socket: "../x" }) },
    { cls: "SessionNameError", via: 'sessionTarget("bad name")', run: () => ta.sessionTarget("bad name") },
    { cls: "CwdError", via: "Orchestrator.spawn({ cwd: <missing> })", run: () => orch.spawn({ name: "rooterr-x", parent: "me", cwd: join(HOME, "nonexistent") }) },
    // readOnly must be SET: `new Policy({}, "web")` does not throw on this tree (measured, probe-error-classes-4.log).
    { cls: "PolicyDenied", via: 'new Policy({ readOnly: true }, "web").assertAllowed("kill", "x", "me")', reason: "read-only surface", run: () => new ta.Policy({ readOnly: true }, "web").assertAllowed("kill", "x", "me") },
    { cls: "PolicyDenied", via: 'new Policy({ deny: { kill: ["x"] } }).assertAllowed("kill", "x", "me")', reason: "deny-list", run: () => new ta.Policy({ deny: { kill: ["x"] } }).assertAllowed("kill", "x", "me") },
    { cls: "PolicyDenied", via: 'new Policy({ allow: { kill: ["y"] } }).assertAllowed("kill", "x", "me")', reason: "allow-list", run: () => new ta.Policy({ allow: { kill: ["y"] } }).assertAllowed("kill", "x", "me") },
    { cls: "AgentNameError", via: 'Mailbox.send("../evil", "me", "s", "b")', run: () => new ta.Mailbox(join(HOME, "mailbox"), ledger).send("../evil", "me", "s", "b") },
    { cls: "SinceError", via: 'wasteReport(dir, "not-a-date")', run: () => ta.wasteReport(join(HOME, "ledger"), "not-a-date") },
    { cls: "OutPathError", via: "publishStatus(orch, monitor, <path under a missing directory>)", run: () => ta.publishStatus(orch, monitor, join(HOME, "nonexistent", "status.json")) },
    // judged before hasSessionChecked(): the stock chain holds no "no-such-profile", so the driver is never asked
    { cls: "ProfileNameError", via: 'Monitor.snapshot("rooterr-s", "no-such-profile")', run: () => monitor.snapshot("rooterr-s", "no-such-profile") },
  ];
}
const DRIVEN = [...new Set(drives().map((d) => d.cls))].sort();

/** What `run` threw, or null when it returned (a Promise's rejection counts as its throw). */
async function thrown(run) {
  try { await run(); return null; } catch (e) { return e; }
}

test("root error classes: each of the eight covered calls throws an instance of the class the ROOT exports, named, and PolicyDenied carries its arm — one message for all eight", async () => {
  assert.equal(DRIVEN.length, 8, `this file drives ${DRIVEN.length} classes where TMUX-154 measured seven and TMUX-155 added the eighth — the drive list itself has drifted`);
  const problems = [];
  for (const d of drives()) {
    const label = `${d.cls} via ${d.via}`;
    const Cls = ta[d.cls];
    const err = await thrown(d.run);
    if (err === null) { problems.push(`${label}: did NOT throw — the fixture value is no longer one the class refuses, so nothing here is being tested`); continue; }
    if (typeof Cls !== "function") { problems.push(`${label}: threw ${err?.constructor?.name ?? typeof err} and the root exports no \`${d.cls}\` — a consumer has no name to write for instanceof and is left matching on err.message, whose wording is NOT covered`); continue; }
    if (!(err instanceof Cls)) problems.push(`${label}: threw ${err?.constructor?.name ?? typeof err}, not an instance of the root's \`${d.cls}\``);
    if (err?.name !== d.cls) problems.push(`${label}: err.name is ${JSON.stringify(err?.name)}, not "${d.cls}" — the six other classes set this.name to their own name so a log line names the class, and this one must too`);
    if (d.reason !== undefined && err?.reason !== d.reason) problems.push(`${label}: err.reason is ${JSON.stringify(err?.reason)}, not "${d.reason}" — the one field PolicyDenied carries, and the one the orchestrator ledgers a refusal under`);
  }
  assert.equal(problems.length, 0, `${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
});

test("root error classes: the root's Error/Denied exports equal the ten this file knows, both ways — an eleventh class is red until driven, a departed one a stale entry", () => {
  const live = Object.keys(ta).filter((k) => /(Error|Denied)$/.test(k) && typeof ta[k] === "function").sort();
  const known = [...DRIVEN, ...Object.keys(DRIVEN_ELSEWHERE)].sort();
  assert.ok(live.length > 0, "the root exports no Error/Denied class at all — is the tree built?");
  const undriven = live.filter((n) => !known.includes(n));
  const departed = known.filter((n) => !live.includes(n));
  const problems = [];
  if (undriven.length) problems.push(`exported from the root but driven by no case here and recorded in DRIVEN_ELSEWHERE nowhere: ${undriven.join(", ")} — add the covered call that throws it, or record which suite drives it`);
  if (departed.length) problems.push(`known here but no longer exported from the root: ${departed.join(", ")} — a consumer who wrote the name has lost it (a breaking change), or this file's list is stale`);
  assert.equal(problems.length, 0, problems.join("\n"));
  // And every class is an Error: a root export named like one that is not `extends Error` would pass instanceof
  // nowhere a consumer expects it to.
  for (const n of live) assert.ok(ta[n].prototype instanceof Error, `${n} is exported from the root and does not extend Error`);
});

test("root error classes: the refusals touched nothing — no server on the throwaway socket, no directory for the refused agent name", () => {
  let sessions = "";
  try { sessions = execFileSync("tmux", ["-L", SOCKET, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch { /* no server on that socket — the expected answer */ }
  assert.equal(sessions.trim(), "", `a tmux server exists on ${SOCKET} with sessions ${JSON.stringify(sessions.trim())} — a drive reached the driver before its judgement`);
  assert.ok(!existsSync(join(HOME, "mailbox", "..", "evil")) && !existsSync(join(HOME, "evil")), "the refused agent name `../evil` left a directory beside the mailbox — the judgement came after the mkdir");
  const mailbox = existsSync(join(HOME, "mailbox")) ? readdirSync(join(HOME, "mailbox")) : [];
  assert.deepEqual(mailbox, [], `the mailbox root carries ${JSON.stringify(mailbox)} after a refused send — nothing should have been created for it`);
});
