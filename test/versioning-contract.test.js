/**
 * VERSIONING.md is a CHECKED contract, not a description: the semver promise behind
 * KR5 "Public API declared" and gate G4.
 *
 * The doc was written 2026-08-25 and never read by a test. Measured 2026-09-10 against the built
 * tree: item 2 declared 12 MCP tools while tools/list served 13 (policy-status — the one tool an
 * agent needs to learn WHY other tools are hidden — had no semver protection by the doc's own
 * "anything not listed is internal" rule); item 6 promised two package-root exports
 * (LedgerIndex, checkBrowserOrigin) that resolved undefined from dist/index.js, and 13 real root
 * exports were undeclared. Both existing guards (test/mcp.test.js, test/lexicon.test.js) are
 * hard-coded lists checked doc→code only, so the contract drifted through two later edits with
 * nothing going red — the same class TMUX-82 closed for CHANGELOG.
 *
 * This file parses VERSIONING.md AS DATA — items 1 (CLI verbs + global flags), 2 (MCP tool
 * names), 3 (ledger event types), 6 (root exports) — and asserts set equality in BOTH directions
 * against the built artefacts. A new export, tool, verb or event type therefore forces a decision:
 * declare it, or mark it internal in INTERNAL / reserved in RESERVED below (visible in this file,
 * never invisible drift in a feature).
 *
 * Item 3 was added in TMUX-126, measured 2026-09-18 on a0eeb1e: the item promised that every ledger
 * event `type` is covered, backticked 3 of the 23 the shipped union carries — all three as *examples*
 * of additive change — and no test read it, so renaming a type in src/core/ledger.ts and its one
 * emitter kept `npm test` green while a consumer's `switch` over `EventType` went dead. Three of the
 * 23 were also filed by nothing the package ships, i.e. promised to clients that could never see
 * them; that half is the RESERVED allowlist below.
 *
 * The parse lives in test/helpers/versioning-doc.js so the LAST section below can check the parse
 * itself against planted drift. It had to: items 1 and 2 are cut at a prose marker, item 2's marker
 * was wrapped across two lines, and a cut whose marker is absent keeps the whole item — so the prose
 * supplied a tool name and a tool deleted from the declared list passed (TMUX-118, measured on
 * 6cd9670). A cut that silently stopped matching is the one drift this file could not see.
 *
 * Item 7's home half was added in TMUX-136, measured 2026-09-19 on b243565: it is the item about a shape
 * on DISK, and it was both unread and short. The built Blackbox — constructed by the dashboard daemon —
 * creates a `health/` directory (mode 0700) of four crash-forensics files under the home, and item 7's
 * six-path list named none of them; `health/` was backticked 0 times in the whole of VERSIONING.md and 0
 * times in README.md. Dropping `web-token` from the declaration and a SEVENTH path the daemon's own
 * constructor creates were each invisible to the whole unit suite. It is the one item judged on TWO
 * authorities, because each alone is blind: the static read (what dist/ NAMES) would accept a path the
 * package never writes, and the dynamic read (what a real driven home HOLDS) reported item 7 complete —
 * a real drive leaves behind only the five paths the old list already named.
 *
 * BANLIST discipline: an empty parsed list is a hard failure, never a vacuous pass; a cut marker
 * that no longer matches is likewise a failure, not a pass; and the check was watched FAIL first on
 * the drifted doc (naming policy-status, LedgerIndex and checkBrowserOrigin) before the
 * reconciliation that made it pass — output on TMUX-83, and again on TMUX-118 for the cuts.
 *
 * Run: node --test test/versioning-contract.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toolsList, assertSameSet } from "./helpers/mcp-contract.js";
import { builtJs, declaredTypeNames, enumeratedStates, filedTypes, honoursMember, reachableFromValues, reachableUndeclared, shippedEventTypes, shippedSessionStates, shippedTypeMembers, shippedValueDeclarations, stripComments } from "./helpers/ledger-events.js";
import { coveredItems, declaredCli, declaredEnvVars, declaredEventTypes, declaredExportKinds, declaredExports, declaredHomeLayout, declaredLexiconShape, declaredNotCovered, declaredParsedItems, declaredPolicyShape, declaredSessionFields, declaredShippedStamp, declaredStampVerdict, declaredStatusShape, declaredTools, declaredUserOptions, ENV_COVERED_START, ENV_END, ENV_UNCOVERED_START, envTicks, eventTicks, EXPORT_TYPES_START, flatten, HOME_BYREF, HOME_END, HOME_SHIPPED, HOME_START, homeFirstSegments, LEX_END, LEX_PARENTS_START, LEX_PROFILE_START, LEX_REDACT_START, LEX_TOP_START, NOT_DIRS_START, NOT_END, NOT_EXPORTS_START, NOT_PATHS_START, notCoveredSection, optionTicks, PARSED_ITEMS_END, PARSED_ITEMS_START, POLICY_ACTION_END, POLICY_ACTION_START, POLICY_TOP_END, preambleText, reservedEventTypes, SESSION_END, SESSION_START, SHIPPED_END, SHIPPED_FIELDS_START, SHIPPED_PATH_START, SHIPPED_REPORTERS_START, SHIPPED_VERDICT_START, STATUS_CUT, ticks } from "./helpers/versioning-doc.js";
// copyTree/startWeb/stopWeb are the shared built-dashboard harness — see helpers/built-web.js
import { copyTree, startWeb, stopWeb } from "./helpers/built-web.js";
import { serverAbsent, shippedSessionRecord, untilServerAbsent } from "./helpers/status-record.js";
import { waitForShell } from "./helpers/wait-shell.js";
import { quietServer } from "./helpers/quiet-server.js";
import { killServerSync } from "./helpers/kill-server.js";

const execFileP = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = readFileSync(join(ROOT, "VERSIONING.md"), "utf8");

/**
 * Root exports that are deliberately NOT covered by semver. Each entry must exist in the built
 * barrel (a stale allowlist is itself drift) and must NOT also be declared in item 6 (a name
 * cannot be both promised and internal). Adding a name here is the explicit "leave it internal"
 * decision the doc's rule requires; the reason belongs next to the name.
 */
const INTERNAL = new Set([
  // Built-in agent profiles: their regexes track upstream CLIs and change in patch releases —
  // VERSIONING's NOT-covered list says so. Embedders use resolveProfiles() (covered) instead.
  "claudeCodeProfile", "codexProfile", "aiderProfile", "genericShellProfile",
]);

/**
 * Event types item 3 declares that NOTHING the package files — 3 of the 23, measured 2026-09-18 on
 * a0eeb1e (probe: scratch/ga-fire-2026-09-18-02Z/vitems-probe/). A declared type with no producer is
 * a promise a client can wait on forever, so the decision to keep each name is recorded HERE, beside
 * what would file it, and checked BOTH ways below: a name that starts being filed must leave this map
 * (the decision expired), and item 3 must mark exactly these `(reserved)` — the doc saying "reserved"
 * in English while this map says otherwise is the TMUX-122 failure in item 3's clothing.
 */
const RESERVED = new Map([
  // adopt-pane is a later phase: nothing appends this yet, and the name is reserved for that verb.
  ["session.adopted", "adopt-pane (Phase 4) will file it; no call site exists yet"],
  // watch files its trigger outcome through the notify sink as notify.sent — a trigger with no sink files nothing.
  ["trigger.fired", "watch files the outcome as notify.sent via src/adapters/notify/; a sink-less trigger files nothing"],
  // H5's projection enters the health watcher as an alert keyed "prediction" and leaves as health.warning.
  ["health.prediction", "H5's projection is filed as health.warning by src/core/healthwatch.ts; the keyed alert never becomes its own row"],
]);

// ---------------------------------------------------------------------------------------------
// Item 3 — ledger event types ≡ the EventType union of the built package (both directions)
// ---------------------------------------------------------------------------------------------
test("versioning: declared ledger event types equal the EventType union in dist/core/ledger.d.ts (both directions)", () => {
  const declared = declaredEventTypes(DOC);
  const shipped = shippedEventTypes();
  assertSameSet(declared, shipped, { declaredAs: "VERSIONING.md item 3", liveAs: "the EventType union in dist/core/ledger.d.ts" });
  // Counts too: a name parsed twice makes both directions agree while the declaration is not what the
  // parse says it is. refuseDuplicates() catches it; this is the second lock.
  assert.equal(declared.length, shipped.length,
    `item 3 parses ${declared.length} names for the ${shipped.length} types the shipped union carries — the cut is keeping more than the declared list`);
});

test("versioning: every declared event type is filed by the built package, or RESERVED here with what would file it", () => {
  const declared = declaredEventTypes(DOC);
  const js = builtJs();
  const filed = new Set(filedTypes(declared, js));
  assert.ok(filed.size > 0, "not one declared event type occurs as a literal in dist/**/*.js — refusing to judge the vocabulary against nothing");
  const marked = reservedEventTypes(DOC);

  // (a) a declared type nothing files is a promise the package cannot produce
  const unfiled = declared.filter((t) => !filed.has(t) && !RESERVED.has(t)).sort();
  // (b) the allowlist must stay honest: a RESERVED name that IS filed means the decision expired
  const stale = [...RESERVED.keys()].filter((t) => filed.has(t)).sort();
  const undeclared = [...RESERVED.keys()].filter((t) => !declared.includes(t)).sort();
  // (c) the doc's English marks and the recorded reasons are one decision, so they are one set
  const markedNotRecorded = marked.filter((t) => !RESERVED.has(t)).sort();
  const recordedNotMarked = [...RESERVED.keys()].filter((t) => !marked.includes(t)).sort();

  const problems = [];
  if (unfiled.length) problems.push(`declared in VERSIONING.md item 3 but filed by nothing in dist/**/*.js — a client is promised a type the package cannot produce: ${unfiled.join(", ")}. File it, remove it from src/core/ledger.ts with a Breaking CHANGELOG entry (pre-1.0 permits it), or record it in RESERVED here and mark it (reserved) in item 3.`);
  if (stale.length) problems.push(`marked RESERVED here but now filed by the build — the decision expired: drop it from RESERVED and from item 3's (reserved) marks: ${stale.join(", ")}`);
  if (undeclared.length) problems.push(`RESERVED here but not declared in item 3 at all (stale allowlist): ${undeclared.join(", ")}`);
  if (markedNotRecorded.length) problems.push(`marked (reserved) in item 3 but with no recorded reason in RESERVED here — the doc claims a decision nothing states: ${markedNotRecorded.join(", ")}`);
  if (recordedNotMarked.length) problems.push(`recorded in RESERVED here but NOT marked (reserved) in item 3 — a reader is told nothing: ${recordedNotMarked.join(", ")}`);
  assert.equal(problems.length, 0, problems.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Item 2 — MCP tool names ≡ tools/list from the built server (both directions)
// ---------------------------------------------------------------------------------------------
test("versioning: declared MCP tool set equals tools/list from dist/mcp/server.js (both directions)", async () => {
  // names are listed before the sentence that explains what counts as breaking (the cut is checked below)
  const declared = declaredTools(DOC);

  // Non-read-only policy in a clean home: read-only HIDES mutating tools by design, so only this
  // posture shows the full advertised set (test/mcp.test.js covers the hidden case).
  const home = mkdtempSync(join(tmpdir(), "ta-versioning-"));
  writeFileSync(join(home, "policy.json"), JSON.stringify({ surfaces: { mcp: { readOnly: false } } }));
  try {
    const live = await toolsList({ TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: `ta-versioning-${process.pid}` });
    assert.ok(live.length > 0, "tools/list returned no tools — the server did not answer; refusing to compare against nothing");
    assertSameSet(declared, live, { declaredAs: "VERSIONING.md item 2", liveAs: "tools/list" });
    // Counts too, not just the sets: a name parsed twice makes both directions agree while the
    // declaration is not what the parse says it is.
    assert.equal(declared.length, live.length,
      `item 2 parses ${declared.length} names for the ${live.length} tools tools/list serves — the cut is keeping more than the declared list`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Item 1 — CLI verbs are dispatched by dist/bin/tmux-agent.js; global flags are parsed there
// ---------------------------------------------------------------------------------------------
test("versioning: declared CLI verbs equal the dispatched case labels and the usage line; every global flag is parsed", () => {
  const { verbs, flags } = declaredCli(DOC);

  const bin = readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8");
  // observable 1: the verb switch — `case "spawn":` labels are how a verb gets dispatched at all
  const labels = [...bin.matchAll(/^\s*case "([a-z]+)":/gm)].map((m) => m[1]);
  assert.ok(labels.length > 0, "found no case labels in dist/bin/tmux-agent.js — is the tree built?");
  assertSameSet(verbs, labels, { declaredAs: "VERSIONING.md item 1", liveAs: "the verb switch in dist/bin/tmux-agent.js" });
  // observable 2: the usage line a human sees on a bad verb must advertise exactly the same set
  const usage = /usage: tmux-agent <([a-z|]+)>/.exec(bin);
  assert.ok(usage, "usage line with <verb|verb|...> not found in dist/bin/tmux-agent.js");
  assertSameSet(verbs, usage[1].split("|"), { declaredAs: "VERSIONING.md item 1", liveAs: "the usage line" });
  // observable 3: a documented global flag must be read somewhere — via the flag registry or a
  // direct flag("x")/has("x") lookup. (One direction: verb-specific flags are covered by item 1
  // as "their flags" without being enumerated, so the registry may legitimately hold more.)
  const parsed = new Set([
    ...[...bin.matchAll(/(?:VALUE|BOOL)_FLAGS = new Set\(\[([^\]]*)\]\)/g)].flatMap((m) => ticks(m[1].replace(/"/g, "`"))),
    ...[...bin.matchAll(/\b(?:flag|has)\("([a-z-]+)"\)/g)].map((m) => m[1]),
  ]);
  const unparsed = flags.filter((f) => !parsed.has(f));
  assert.deepEqual(unparsed, [], `global flags declared in item 1 that dist/bin/tmux-agent.js never reads: --${unparsed.join(", --")}`);
});

// ---------------------------------------------------------------------------------------------
// Item 6 — package-root exports: declared ≡ shipped, values AND types, both directions
// ---------------------------------------------------------------------------------------------

/** The type names the shipped root barrel re-exports: types do not exist at runtime, so the
 * `export type { … }` lines of dist/index.d.ts are their only observable. One reader, because the
 * export case below and the signature cases beneath it must not disagree about what a type is. */
function shippedRootTypes() {
  const dts = readFileSync(join(ROOT, "dist/index.d.ts"), "utf8");
  return [...dts.matchAll(/^export type \{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
}

test("versioning: every declared root export resolves from dist/index.js and every shipped export is declared or marked internal", async () => {
  const declared = declaredExports(DOC);
  const root = await import(join(ROOT, "dist/index.js"));
  const liveValues = Object.keys(root).filter((k) => k !== "default");
  const liveTypes = shippedRootTypes();
  assert.ok(liveValues.length > 0 && liveTypes.length > 0, "dist/index.js or dist/index.d.ts exports nothing — is the tree built?");

  const live = new Set([...liveValues, ...liveTypes]);
  // (a) a declared name that ships as neither value nor type is a promise the package cannot keep
  const phantom = declared.filter((n) => !live.has(n)).sort();
  // (b) a shipped name that is neither declared nor explicitly internal is an undecided export
  const undecided = [...live].filter((n) => !declared.includes(n) && !INTERNAL.has(n)).sort();
  // (c) the allowlist itself must be honest: real names, and never contradicting the doc
  const staleInternal = [...INTERNAL].filter((n) => !live.has(n)).sort();
  const contradiction = [...INTERNAL].filter((n) => declared.includes(n)).sort();

  const problems = [];
  if (phantom.length) problems.push(`declared in VERSIONING.md item 6 but NOT exported from the package root: ${phantom.join(", ")}`);
  if (undecided.length) problems.push(`exported from the package root but neither declared in item 6 nor marked INTERNAL in this test: ${undecided.join(", ")}`);
  if (staleInternal.length) problems.push(`marked INTERNAL here but no longer exported (stale allowlist): ${staleInternal.join(", ")}`);
  if (contradiction.length) problems.push(`both declared in item 6 AND marked INTERNAL here (pick one): ${contradiction.join(", ")}`);
  assert.equal(problems.length, 0, problems.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Item 6's signature half — "and their signatures": the MEMBERS of the declared types.
// Until this card those four words were read only as declaredExports()' cut marker, so item 6's
// NAMES were set-equal with the package root in both directions while the members INSIDE every
// covered type could change, vanish or ship dead with nothing failing. Measured 2026-09-21 on
// 1747fde: exactly one of the 79 members of the 13 object types was honoured nowhere in the built
// JS — `CalibrateInput.looksStalled`, declared, shipped, and read by nothing (TMUX-145 pinned the
// behaviour from the other side: false, true and absent gave byte-identical reports).
// ---------------------------------------------------------------------------------------------

/**
 * The member count the 28 object types carry, asserted so a parse that silently reads fewer members
 * cannot pass. 79 on 1747fde, 78 once `CalibrateInput.looksStalled` was deleted by TMUX-147, 94
 * once TMUX-149 declared the five types a covered signature reached without item 6 naming them — the
 * walk grew 13 → 18 object types and every one of the 16 new members is honoured by the built JS, so
 * SIGNATURE_UNREAD stayed empty (measured with these readers, scratch/ga-fire-2026-09-21-22Z/probe-reader.log)
 * — and 129 once TMUX-150 declared the ten the VALUE half reached: 18 → 26 object types, and all 35 new
 * members are honoured in the built JS too (scratch/ga-fire-2026-09-22-02Z/probe-restamp.log), so the
 * allowlist is still empty after twice growing the walk. 134 once TMUX-151 taught the closure's
 * declaration index to read CLASS heads: `ActivityThresholds` (3) and `CpuSample` (2) were reachable
 * only through `Monitor.activity`'s class, so 26 → 28 object types (scratch/ga-fire-2026-09-22-06Z/probe-151.log).
 * UNMOVED by TMUX-154 at 134, and measured so (scratch/ga-fire-2026-09-22-18Z/probe-readers-parent.log,
 * probe-readers-edited.log): the seven error classes it declared are VALUES, walked by the value closure and not
 * by this member count, and `DenialReason` is a string-union alias, answered in SIGNATURE_ALIASES below.
 *
 * NOT the 83 TMUX-147's body quotes: that probe matched member names at up to eight columns of
 * indentation, and tsc pretty-prints a nested inline type across lines at exactly that depth, so it
 * read `sessions`, `version`, `profiles` and `redact` — keys of `CalibrationReport.sampled` and
 * `.draft` — as members of `CalibrationReport` itself. That is also where its one bogus
 * `CalibrationReport.redact` violation came from. membersOf() collapses nested braces first, so a
 * member is a name at the type's OWN depth: the same rule item 4 pays for with parentheticals.
 */
const SIGNATURE_MEMBERS = 134;

/**
 * Members of a covered type that the built JS honours NOWHERE, with the reason each is kept —
 * item 3's RESERVED shape, for the same reason: the decision is visible in this file rather than
 * invisible in a feature. Checked BOTH ways below, so it cannot be padded: an entry the built JS
 * does honour fails as loudly as a violation with no entry.
 *
 * Empty on purpose. The one member that would have been in it is gone: TMUX-147 deleted
 * `CalibrateInput.looksStalled` rather than record it, because honouring a field the page
 * docs/AGNOSTIC-DESIGN.md §2 no longer relies on would have been new behaviour.
 */
const SIGNATURE_UNREAD = new Map([]);

/**
 * The five names item 6 declares that are string-union aliases rather than object types (four until
 * TMUX-154 declared `DenialReason`), and where each one's members are answered. Recorded rather than
 * skipped: a walk that quietly ignored every type it could not read as an object would pass on a covered
 * type that became `any`. Every answer is LIVE and asserted in the alias case below — SessionState's was
 * the absence of one, stated as such, until TMUX-152.
 */
const SIGNATURE_ALIASES = new Map([
  // Parsed as data since TMUX-85 (root-docs) and compared with item 3's declared list both ways
  // since TMUX-126 — shippedEventTypes() is that reader, asserted non-empty in the alias case below.
  ["EventType", "item 3 declares its 23 members; shippedEventTypes() reads the union out of dist/core/ledger.d.ts"],
  // Live since TMUX-152, and the last of the four to get an authority. `SessionState` is the vocabulary
  // the dashboard, the ledger's `session.state` rows and every profile's classify() speak, and until that
  // card a member added to or removed from it was invisible to this suite the way item 3's were before
  // TMUX-126. Its authority is not a doc list — the NOT-covered section names it as a pointer only
  // (declaredNotCovered's note) — but the SHIPPED SURFACES that enumerate the members: README.md's
  // architecture tree and the MCP `session-status` description, each held equal to the union both ways in
  // the surfaces case below. Two of the three were WRONG when that was first measured.
  ["SessionState", "no declared list (the NOT-covered section points at the values by name); shippedSessionStates() reads the union out of dist/core/monitor.d.ts and README.md's architecture tree plus the shipped MCP session-status description are held equal to it, both ways, in the surfaces case below"],
  // The two TMUX-150 declared. Both arrived WITH a live authority, which is why neither needed
  // SessionState's note: item 5 declares the same five action names and the suite already holds them
  // equal to `explain().hiddenActions` both ways, so the alias case below holds the UNION to that same
  // reply. `Surface` has no declared list — item 5 names web/mcp/cli only in an aside its parse
  // deliberately drops — so its authority is the built package itself: the surface the Policy
  // constructor defaults to plus every one a `new Policy(…)` site in dist/ names.
  ["Action", "item 5 declares its 5 members; the union is held equal to explain().hiddenActions of a read-only surface both ways in the alias case below"],
  ["Surface", "no declared list (item 5's web/mcp/cli sit in a dropped aside); the union is held equal to the surfaces dist/**/*.js constructs a Policy with, both ways, in the alias case below"],
  // TMUX-154's, and it arrived WITH its authority for the reason Action and Surface did: `DenialReason` is the
  // type of `PolicyDenied.reason` — the one field any of the seven error classes carries, honoured at
  // dist/core/orchestrator.js (`e instanceof PolicyDenied ? e.reason : "policy"`) — and declaring the class as a
  // VALUE walks its body, so the value closure reaches the union and reports it as a gap unless item 6 names it.
  // No declared list (item 5 names no reason; the ledger's control.denied comment enumerates the three, as a
  // comment), so its authority is the built package itself: the reason literal of every `new PolicyDenied(…)`
  // the built policy.js constructs, asserted to be exactly three so a reader matching nothing fails.
  ["DenialReason", "no declared list; the union is held equal to the reason literals dist/core/policy.js constructs a PolicyDenied with, both ways, in the alias case below"],
]);

test("versioning: item 6's declared types ≡ the shipped `export type` barrel, each resolves to a declaration in dist/**/*.d.ts, and every member of the 28 object types is honoured by the built JS or recorded in SIGNATURE_UNREAD", () => {
  const { types } = declaredExportKinds(DOC);
  // (1) the names: item 6's type half against the barrel, both ways — a covered type that leaves the
  // build, or a shipped one the item stops naming, fails HERE naming it.
  assertSameSet(types, shippedRootTypes(), { declaredAs: "VERSIONING.md item 6's type half", liveAs: "the `export type { … }` barrel of dist/index.d.ts" });
  assert.equal(types.length, shippedRootTypes().length,
    `item 6's type half parses ${types.length} names for the ${shippedRootTypes().length} the barrel re-exports — a name parsed twice makes both directions agree while the declaration is not what the parse says it is`);

  // (2) every declared type resolves to a declaration in the built .d.ts — the only authority for a
  // member list, since tsc erases an interface from the emitted JS entirely.
  const { objects, aliases, missing } = shippedTypeMembers(types);
  assert.deepEqual(missing.sort(), [],
    `declared in VERSIONING.md item 6 and re-exported by the barrel, but no dist/**/*.d.ts declares it: ${missing.join(", ")} — item 6 promises these signatures, so a type whose declaration left the build is a promise with nothing behind it`);

  // (3) every member honoured somewhere in the comment-stripped built JS, in a property-shaped
  // position. Module scope, not the declaring module's: 15 of the 16 violations a declaring-module
  // scan reports are a type populated by another module (SessionMeta by the CLI and the web layer,
  // NotifySink by its sinks, LedgerEvent.actor by the ledger's callers), so under that authority the
  // allowlist would become the check (measured 2026-09-21, scratch/ga-fire-2026-09-21-12Z/probe/).
  const code = stripComments(builtJs());
  const violations = [];
  for (const [type, { members }] of objects) {
    for (const m of members) if (!honoursMember(m, code)) violations.push(`${type}.${m}`);
  }
  // Both directions as loops rather than filters: on a healthy tree `violations` is empty and so is
  // SIGNATURE_UNREAD, and a filter over each would be a predicate that CANNOT run — an uncovered
  // function in a file whose coverage is read as a gate, saying nothing about the check.
  const unrecorded = [], padded = [];
  for (const v of violations) if (!SIGNATURE_UNREAD.has(v)) unrecorded.push(v);
  for (const v of SIGNATURE_UNREAD.keys()) if (!violations.includes(v)) padded.push(v);
  unrecorded.sort();
  padded.sort();
  // (4) and the parse must not be vacuous: a type that suddenly reads zero members would make every
  // one of its promises pass silently, which is what nonEmpty() refuses for the doc lists. Reported
  // WITH the violations rather than before them, so one run names a dead member and a drifted count
  // together instead of hiding the first behind the second.
  const empty = [];
  for (const [type, { members }] of objects) if (members.length === 0) empty.push(type);
  empty.sort();
  const total = [...objects.values()].reduce((n, d) => n + d.members.length, 0);

  const problems = [];
  if (unrecorded.length) problems.push(`declared in a signature VERSIONING.md item 6 covers, but honoured NOWHERE in dist/**/*.js: ${unrecorded.join(", ")}. A consumer is told the field is part of a covered signature while passing or reading it changes nothing. Delete it (with a CHANGELOG entry — pre-1.0 permits a Breaking line), start honouring it, or record it in SIGNATURE_UNREAD here with the reason.`);
  if (padded.length) problems.push(`recorded in SIGNATURE_UNREAD here but the built JS DOES honour it — the decision expired, drop the entry: ${padded.join(", ")}`);
  if (empty.length) problems.push(`parsed ZERO members for ${empty.join(", ")} from dist/**/*.d.ts — an empty signature is a hard failure, not a pass: every member of that type would then be "honoured" by a check that read none of them`);
  if (total !== SIGNATURE_MEMBERS) problems.push(`item 6's ${objects.size} object types carry ${total} members where ${SIGNATURE_MEMBERS} were measured — if that is a deliberate change, the new count belongs in SIGNATURE_MEMBERS with the member's CHANGELOG entry beside it; if not, the parse is reading the declarations differently than it did`);
  assert.equal(problems.length, 0, problems.join("\n"));
  assert.equal(aliases.length, SIGNATURE_ALIASES.size,
    `${aliases.length} of item 6's declared types are not object types, and SIGNATURE_ALIASES records ${SIGNATURE_ALIASES.size} — the alias case below is where each one's answer is, so a type that is neither walked nor recorded is held to nothing`);
});

test("versioning: item 6's FIVE string-union aliases are ANSWERED rather than skipped — the member walk covers exactly the 28 object types, and EventType's, Action's, Surface's, SessionState's and DenialReason's unions are each held to a live authority", async () => {
  const { types } = declaredExportKinds(DOC);
  const { objects, aliases } = shippedTypeMembers(types);
  // Both ways, as item 3's RESERVED is: an alias with no recorded answer is a covered type held to
  // nothing, and a recorded answer for a name that is no longer an alias is a stale record.
  assertSameSet([...SIGNATURE_ALIASES.keys()], aliases, {
    declaredAs: "the SIGNATURE_ALIASES record of test/versioning-contract.test.js",
    liveAs: "the names in item 6's type half that dist/**/*.d.ts declares as something other than an object type",
  });
  assert.equal(objects.size, types.length - aliases.length,
    `the member walk covers ${objects.size} of item 6's ${types.length} declared types with ${aliases.length} aliases beside them — every declared type is either walked or recorded, never dropped`);
  // EventType's answer is live, so it is asserted rather than trusted: item 3 declares the union and
  // this is the reader both that case and root-docs use.
  assert.ok(shippedEventTypes().length > 0,
    `SIGNATURE_ALIASES records EventType as answered by item 3's declared list, and shippedEventTypes() read none — the record would then be pointing at a check that reads nothing`);
  // Action's and Surface's answers are live too, so they are asserted rather than trusted.
  // The union is the declaration a consumer writes against; holding it to the same authority item 5's
  // action names already answer to is what stops a sixth action name shipping in the type and nowhere else.
  const unionOf = (name) => [...(shippedTypeMembers([name]).bodies.get(name) ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  const { Policy } = await import(join(ROOT, "dist/index.js"));
  const hidden = new Policy({ readOnly: true }, "mcp").explain().hiddenActions;
  assert.ok(hidden.length > 0,
    "SIGNATURE_ALIASES records Action as answered by explain().hiddenActions and the built Policy answered none — the record would then be pointing at a check that reads nothing");
  assert.deepEqual(unionOf("Action"), [...hidden].sort(),
    `the \`Action\` union of dist/core/policy.d.ts is ${JSON.stringify(unionOf("Action"))} and the built Policy hides ${JSON.stringify([...hidden].sort())} — a covered union and the reply MCP policy-status returns must carry the same action names, or item 6 promises a vocabulary the tool does not speak`);
  // Surface's authority is the built package rather than a doc list: the constructor's default plus every
  // surface a `new Policy(…)` site names. Read comment-stripped, so a surface named in prose counts for
  // nothing — and the CLI's site names two of the three on one line (`cmd === "web" ? "web" : "cli"`).
  const policyJs = stripComments(builtJs());
  const built = new Set();
  const fallback = /constructor\(cfg,\s*surface\s*=\s*"([a-z]+)"/.exec(policyJs);
  assert.ok(fallback, "no `constructor(cfg, surface = \"…\")` in the built JS — the default surface is half of Surface's live authority, so refusing rather than reading a shorter list");
  built.add(fallback[1]);
  const sites = [...policyJs.matchAll(/new Policy\(([^;]*?)\)/g)];
  assert.ok(sites.length > 0, "the built package constructs no Policy at all — Surface's live side would then be the constructor default alone");
  for (const site of sites) for (const q of site[1].matchAll(/"([a-z]+)"/g)) built.add(q[1]);
  assert.deepEqual(unionOf("Surface"), [...built].sort(),
    `the \`Surface\` union of dist/core/policy.d.ts is ${JSON.stringify(unionOf("Surface"))} and the built package constructs a Policy for ${JSON.stringify([...built].sort())} — a surface the union names that nothing constructs is a covered name with no behaviour, and one it constructs that the union omits is a scope an operator cannot write down`);

  // SessionState's answer is live too since TMUX-152, and its authority is the shipped SURFACES that
  // enumerate the members rather than a doc list — the surfaces case below holds each of them equal to
  // the union both ways. Asserted here rather than trusted, the way EventType's reader is: a record
  // pointing at a reader that reads NOTHING is the same silence the note it replaced admitted to.
  const stateUnion = shippedTypeMembers(["SessionState"]).aliases;
  assert.deepEqual(stateUnion, ["SessionState"],
    "SessionState stopped being a union in the built declarations — if it became an object type it is walked above and its record here is stale");
  assert.ok(shippedSessionStates().length > 0,
    "SIGNATURE_ALIASES records SessionState as answered by shippedSessionStates() and it read none — the record would then be pointing at a check that reads nothing");
  // Two readers of ONE declaration, held equal: unionOf() finds SessionState wherever the whole-dist
  // .d.ts index declares it, shippedSessionStates() pins dist/core/monitor.d.ts. A union that moved
  // file, or a second declaration of the name shadowing it, is a disagreement here rather than two
  // suites quietly judging the same tree by different vocabularies.
  assert.deepEqual(unionOf("SessionState"), [...shippedSessionStates()].sort(),
    `the \`SessionState\` union the declaration index resolves is ${JSON.stringify(unionOf("SessionState"))} and dist/core/monitor.d.ts declares ${JSON.stringify([...shippedSessionStates()].sort())} — the surfaces case and this one would then be reading different vocabularies`);
  assert.ok(!flatten(coveredItems(DOC).get("6") ?? "").includes("WORKING"),
    "item 6 now backticks a SessionState member — a member is not a type name, so the declared-names parse above would go looking for a declaration of `WORKING`; the members answer to the surfaces case below, never to item 6's name list");

  // DenialReason's answer is live too since TMUX-154, and its authority is the built package rather than a doc
  // list, as Surface's is: the reason literal of every `new PolicyDenied(…)` the built policy.js constructs. Read
  // comment-stripped, so a reason named in prose counts for nothing; read to each call's `);` rather than to its
  // first `)`, because the read-only arm's message is a template literal that carries parentheses of its own and
  // passes its reason on a continuation line — read the CALL, not the line. Exactly three sites, or the reader is
  // matching something else; and none elsewhere in dist/, or policy.js has stopped being the one place that decides.
  assert.deepEqual(shippedTypeMembers(["DenialReason"]).aliases, ["DenialReason"],
    "DenialReason stopped being a union in the built declarations — if it became an object type it is walked above and its record here is stale");
  const denialCall = /new PolicyDenied\(([\s\S]*?)\);/g;
  const denialSites = [...stripComments(readFileSync(join(ROOT, "dist/core/policy.js"), "utf8")).matchAll(denialCall)];
  assert.equal(denialSites.length, 3,
    `the built dist/core/policy.js constructs a PolicyDenied at ${denialSites.length} sites where three rules — read-only, deny-list, allow-list — were measured; DenialReason's live authority is the reason each site passes, so a fourth rule or a lost one is a changed count here before it is a changed union`);
  assert.equal([...policyJs.matchAll(denialCall)].length, denialSites.length,
    "a module other than dist/core/policy.js constructs a PolicyDenied — the reason it passes is outside this authority, so item 6 would be promising a union one file holds while another file adds to it");
  const reasons = denialSites.map((m) => /"([^"]*)"\s*$/.exec(m[1].trimEnd())?.[1]);
  assert.ok(reasons.every((r) => typeof r === "string" && r.length > 0),
    `a PolicyDenied site in the built policy.js does not end in a string literal: ${JSON.stringify(reasons)} — the reason must be the LAST argument and a literal, or this reader is reading nothing`);
  assert.equal(new Set(reasons).size, reasons.length,
    `two PolicyDenied sites pass the same reason: ${JSON.stringify(reasons)} — a rule that cannot be told from another by its reason is not the three distinct causes item 6 promises`);
  assert.deepEqual(unionOf("DenialReason"), [...reasons].sort(),
    `the \`DenialReason\` union of dist/core/policy.d.ts is ${JSON.stringify(unionOf("DenialReason"))} and the built Policy constructs a PolicyDenied with ${JSON.stringify([...reasons].sort())} — a reason the union names that nothing throws is a covered value with no behaviour, and one it throws that the union omits is a cause a consumer cannot write down`);
});

/**
 * TMUX-152 — the members of `SessionState` are a PROMISE, and the surfaces that write them down had
 * drifted. VERSIONING.md's own NOT-covered section excludes the classification heuristics and redirects
 * the consumer onto the values BY NAME ("Depend on the SessionState values, not on how a given pane is
 * classified"), so the values are the stable thing the doc points at while their member list answered to
 * nobody. Measured on aa906ec, two of the three shipped enumerations were wrong:
 *
 *  - README.md's architecture tree named FIVE — no `GONE`, the state every session takes when the tmux
 *    server dies and the subject of nine cards in this series, and no `UNKNOWN`;
 *  - the MCP `session-status` description, shipped verbatim into dist/mcp/server.js, named SIX — no
 *    `UNKNOWN`, while test/mcp.test.js already asserts `UNKNOWN` is among the states that very tool can
 *    return and src/core/monitor.ts answers `UNKNOWN` on a first poll. An agent that spawned a session
 *    and called session-status immediately got the one state it was never told about.
 *
 * Read from dist/ and not src/ for the MCP surface, because the shipped string is what a consumer gets.
 * Both comparisons are set-equal in BOTH directions: a name a surface gains that the union drops is as
 * loud as a member the union gains that a surface omits, which is what makes an EIGHTH state a red tree.
 *
 * The third and fourth enumerations answer elsewhere, named here so nobody adds a second check for them:
 * the dashboard's glyph map and its five-chip `data-state` filter are both held in test/a11y.test.js —
 * the glyph map set-equal to the union, the chips a deliberate proper SUBSET of it.
 */
const STATE_SURFACES = [
  {
    what: "README.md's architecture tree",
    read: () => readFileSync(join(ROOT, "README.md"), "utf8"),
    after: "├─ state: ",
    before: "(profile-driven, event-ledgered)",
  },
  {
    what: "the MCP `session-status` description shipped in dist/mcp/server.js",
    read: () => readFileSync(join(ROOT, "dist/mcp/server.js"), "utf8"),
    after: "Classify one session: ",
    before: ", plus context%",
  },
];

test("versioning: the two SHIPPED surfaces that enumerate `SessionState` name exactly the members the built union declares — README's architecture tree and the MCP session-status description, both directions", () => {
  const union = shippedSessionStates();
  // Collected rather than asserted per surface, the rule the member walk above pays for too: one run
  // names BOTH surfaces' drift instead of hiding the second behind the first.
  const problems = [];
  for (const surface of STATE_SURFACES) {
    const named = enumeratedStates(surface.read(), surface);
    const missing = union.filter((n) => !named.includes(n)).sort();
    const extra = named.filter((n) => !union.includes(n)).sort();
    if (missing.length) problems.push(`${surface.what} does not name ${missing.join(", ")}, declared by the \`SessionState\` union of dist/core/monitor.d.ts — a consumer reading that surface is told the vocabulary is smaller than what it will be handed`);
    if (extra.length) problems.push(`${surface.what} names ${extra.join(", ")}, which the \`SessionState\` union does not declare — a state a consumer is promised and can never receive`);
  }
  assert.equal(problems.length, 0, problems.join("\n"));
});

test("versioning: the state cut's own rules are CHECKED, not trusted — a reworded marker, a doubled marker, an empty region and a name said twice each REFUSE rather than answer with a short list", () => {
  const base = { after: "├─ state: ", before: "(profile-driven, event-ledgered)", what: "a planted surface" };
  // (a) the happy path FIRST, on a planted string carrying a name no tree has: a cut that refused
  // everything would pass every case below while reading nothing, so the drift must come back BY NAME.
  assert.deepEqual(enumeratedStates("       ├─ state: WORKING / PONDERING     (profile-driven, event-ledgered)\n", base),
    ["WORKING", "PONDERING"], "the cut must return the planted names, or the refusals below prove nothing");
  // (b) a reworded surface FAILS naming the marker — the BANLIST rule that an empty candidate set is a
  // hard error, and the one shape that would have let this whole check rot silently.
  assert.throws(() => enumeratedStates("       |- states are WORKING and IDLE (profile-driven, event-ledgered)\n", base),
    /no "├─ state: ".*opening marker is gone/s, "a reworded tree line must fail naming the opening marker");
  assert.throws(() => enumeratedStates("       ├─ state: WORKING / IDLE     (profile-driven, ledgered)\n", base),
    /"\(profile-driven, event-ledgered\)" does not follow/, "a reworded parenthetical must fail naming the closing marker");
  // (c) a marker occurring twice: two tree lines, and the cut can no longer say which it answered for.
  assert.throws(() => enumeratedStates("├─ state: WORKING     (profile-driven, event-ledgered)\n├─ state: IDLE     (x)\n", base),
    /occurs more than once/, "a doubled marker must fail rather than silently answer for the first region");
  // (d) an empty region — the markers are both there and the list between them is gone.
  assert.throws(() => enumeratedStates("       ├─ state: (profile-driven, event-ledgered)\n", base),
    /cut ZERO state names/, "a list that emptied must fail, not pass with nothing to compare");
  // (e) one name twice: both directions of the set comparison agree while the surface is not what the
  // cut says it is, so the duplicate is refused before the comparison can be fooled by it.
  assert.throws(() => enumeratedStates("       ├─ state: WORKING / IDLE / WORKING     (profile-driven, event-ledgered)\n", base),
    /names WORKING more than once/, "a name enumerated twice must be refused");
});

test("versioning: the signature reader's own rules are CHECKED, not trusted — a property-shaped read is not a bare word, a nested key is not a member, and a covered type nothing declares is reported missing", () => {
  // (a) the five shapes that count as honouring a member. The shorthand one is the trap that made the
  // first probe of this wrong: dist/core/calibrate.js returns `prompts,` inside an object literal, which
  // is neither `.m` nor `m:`, and a check without that alternative invents two dead fields.
  for (const code of [
    "report.looksStalled = 1;",
    "return { looksStalled: input.stall };",
    'const key = "looksStalled";',
    "return { session, looksStalled, tail };",
    'const v = input["looksStalled"];',
  ]) {
    assert.ok(honoursMember("looksStalled", code), `honoursMember() does not read ${JSON.stringify(code)} as honouring looksStalled — that is one of the five property shapes the check is built on`);
  }
  // (b) and the vacuity trap it exists for: a BARE-WORD scan passes for a short member on almost any
  // input, which is why the one-violation agreement between the two probes was luck. `at` is a real
  // member of Snapshot; here it is a local variable and no read of the type.
  const bareWord = "const at = Date.now(); if (at > 0) return at;";
  assert.match(bareWord, /\bat\b/, "fixture stale: this line must contain `at` as a bare word, or it measures nothing about the sharper rule");
  assert.ok(!honoursMember("at", bareWord),
    "honoursMember() read a bare-word occurrence of `at` as honouring Snapshot.at — then the check passes for `v`, `ts` and `name` on almost any input and is not a discriminator at all");

  // (c) a nested inline type's keys are NOT members of the type that holds it. This is the rule behind
  // TMUX-147's count being 78 over its 13 types and not the 83 that card was filed with: `sampled` and `draft` are members
  // of CalibrationReport, and the keys inside them are members of nothing item 6 declares.
  const { objects } = shippedTypeMembers(["CalibrationReport"]);
  const members = objects.get("CalibrationReport")?.members ?? [];
  for (const own of ["sampled", "draft", "parents"]) {
    assert.ok(members.includes(own), `CalibrationReport's parsed members (${members.join(", ")}) do not include ${own} — the walk is reading the declaration differently than it did`);
  }
  for (const nested of ["sessions", "version", "profiles", "redact"]) {
    assert.ok(!members.includes(nested), `${nested} is parsed as a member of CalibrationReport — it is a key of the nested \`sampled\`/\`draft\` type, so the walk has stopped collapsing nested braces and the member count is over-read (the 83-vs-78 error)`);
  }

  // (d) a covered type no declaration carries is REPORTED, never silently dropped from the walk.
  const absent = shippedTypeMembers(["NoSuchTypeTMUX147"]);
  assert.deepEqual(absent.missing, ["NoSuchTypeTMUX147"],
    "a type name nothing in dist/**/*.d.ts declares was not reported missing — a covered type whose declaration left the build would then shrink the walk in silence");
  assert.equal(absent.objects.size + absent.aliases.length, 0, "a name nothing declares was also counted as an object type or an alias");
});

// ---------------------------------------------------------------------------------------------
// Item 6's signature half, one level deeper — REACHABILITY: a member's own TYPE.
// TMUX-147 made "and their signatures" a check over the MEMBERS of the declared types. What it still
// could not read is the type of a member: measured 2026-09-21 on 7b416af, five types were reachable
// from a covered signature, named by item 6 nowhere and re-exported by the package root nowhere —
// 16 members a consumer RECEIVES and cannot write a type annotation for. `calibrate()` is a declared
// root export returning a declared type whose three array members were arrays of unnameable names, and
// `LexiconConfig.parents` is the key an adopter writes BY HAND (docs/AGNOSTIC-DESIGN.md §1).
// ---------------------------------------------------------------------------------------------

/**
 * The five names TMUX-149 added to item 6's type half, so the control below can reconstruct the list as
 * it read BEFORE the fix and drive the closure over the answer this card was filed on. A literal rather
 * than a diff against git: the control's whole job is to show the walk still finds them, and reading the
 * previous revision would make the case depend on the checkout's history rather than on the built tree.
 */
const CLOSURE_ADDED = ["Evidence", "LexiconParents", "ParentProposal", "PromptProposal", "SecretShapeProposal"];

/**
 * Types reachable from a covered signature that item 6 deliberately does NOT name, with the reason each
 * is kept — SIGNATURE_UNREAD's shape and item 3's RESERVED's, for the same reason: the decision is
 * visible in this file rather than invisible in a feature. Checked BOTH ways below, so it cannot be
 * padded: an entry the closure does not reach fails as loudly as a gap with no entry.
 *
 * Empty on purpose, and the emptiness is the check — on this tree the both-ways comparison against an
 * empty literal is the assertion that NO type reaches a consumer unnameable. The five that would have
 * been in it were declared and re-exported instead (CLOSURE_ADDED above): a consumer who receives
 * `CalibrationReport.parents` can now write `ParentProposal[]`, which is what item 6 already promised.
 */
const SIGNATURE_UNNAMED = new Map([]);

/**
 * The number of declared type names the closure out of item 6's type half REACHES — the covered names
 * included, which is the point. On a healthy tree `SIGNATURE_UNNAMED` and the reachable-but-undeclared
 * set are both empty, so a reference scan that quietly stopped matching would report "no gaps" from a
 * walk that read nothing. 10 on this tree (measured with these readers,
 * scratch/ga-fire-2026-09-21-22Z/probe-reader.log): the five of CLOSURE_ADDED plus `EventType`,
 * `LexiconProfile`, `LexiconRedactRule`, `SessionMeta` and `SessionState`.
 *
 * UNMOVED by TMUX-151, and the flatness is a measurement rather than an omission: teaching the index to
 * read class heads took it 61 → 83 names, and the type half still reaches 13 with 0 gaps under either
 * exclude set (scratch/ga-fire-2026-09-22-06Z/probe-151.log). No member of a covered TYPE is class-typed
 * today — the hole was entirely on the VALUE side, where a class body is the thing being read.
 */
const SIGNATURE_CLOSURE_REFS = 13;

/**
 * The closure's whole judgement as ONE predicate, so every control below drives the SAME rules the live
 * case does rather than a paraphrase of them: the gaps both ways against the allowlist, every declared
 * type's body actually read, and the reference count. Returns the problems it found, empty on a healthy
 * tree — which is why the controls exist.
 */
function closureProblems({ reachable, refs, walked }, types, allowlist, expectedRefs, half = "item 6's type half", refsConst = "SIGNATURE_CLOSURE_REFS", allowConst = "SIGNATURE_UNNAMED") {
  // Both directions as loops rather than filters, for the reason the member case states: on a healthy
  // tree both sides are empty and a filter's predicate would be a function that CANNOT run.
  const unrecorded = [], padded = [];
  for (const name of reachable.keys()) if (!allowlist.has(name)) unrecorded.push(name);
  for (const name of allowlist.keys()) if (!reachable.has(name)) padded.push(name);
  unrecorded.sort();
  padded.sort();
  const unwalked = [];
  for (const t of types) if (!walked.includes(t)) unwalked.push(t);

  const problems = [];
  if (unrecorded.length) problems.push(`reachable from a signature VERSIONING.md item 6 covers, but NAMED by item 6 nowhere: ${unrecorded.map((n) => `${n} (${reachable.get(n).members.length} members, reachable from ${reachable.get(n).from.join(" + ")})`).join(", ")}. A consumer receives the type and cannot write an annotation for it, so "and their signatures" promises a shape they cannot name. Declare it in item 6 and re-export it from src/index.ts with an Added CHANGELOG entry (a new type export is additive), or record it in ${allowConst} here with the reason.`);
  if (padded.length) problems.push(`recorded in ${allowConst} here but the closure does NOT reach it — the decision expired, drop the entry: ${padded.join(", ")}`);
  if (unwalked.length) problems.push(`item 6 declares ${unwalked.join(", ")} and the closure read no declaration body for it — a covered type whose declaration left the build would otherwise contribute nothing to the walk in silence`);
  if (refs.size !== expectedRefs) problems.push(`the closure out of ${half}'s ${types.length} declared names reaches ${refs.size} declared type names where ${expectedRefs} were measured — if that is a deliberate change the new count belongs in ${refsConst} beside the reason; if not, the reference scan has stopped matching and an EMPTY answer would read as "no gaps"`);
  return problems;
}

test("versioning: no type reaches a consumer through a covered signature without item 6 NAMING it — the closure out of item 6's type half is walked TRANSITIVELY over dist/**/*.d.ts and is set-equal with SIGNATURE_UNNAMED both ways", (t) => {
  const { values, types } = declaredExportKinds(DOC);
  // The exclude set spans BOTH halves: the index reads class heads, so a class item 6 declares
  // as a VALUE — `Ledger`, `Monitor`, `Policy`, `Tmux` — is a name a consumer CAN write, and the type half
  // alone would report the next class-typed member of a covered type as a shape they cannot name. Latent
  // on this tree (type-half gaps are 0 either way), so the reader case below drives both arms on a fixture.
  const live = reachableUndeclared(types, ROOT, Infinity, [...values, ...types]);
  assert.ok(live.walked.length > 0,
    "the closure read not one declaration body — refusing to report zero unnameable types from a walk that read nothing");
  const problems = closureProblems(live, types, SIGNATURE_UNNAMED, SIGNATURE_CLOSURE_REFS);
  assert.equal(problems.length, 0, problems.join("\n"));
  t.diagnostic(`closure: walked ${live.walked.length} declarations, reached ${live.refs.size} declared type names, ${live.reachable.size} of them undeclared`);
});

test("versioning: the closure reader's own rules are CHECKED, not trusted — transitivity is pinned by a two-hop fixture AND by the pre-TMUX-149 answer, a one-level walk is REFUSED, the standard library is filtered out, and a padded allowlist or a scan that reads nothing both red", () => {
  const { types } = declaredExportKinds(DOC);

  // (a) transitivity pinned by a FIXTURE, so the property does not depend on this tree happening to
  // carry a two-hop chain. Alpha → Beta → Gamma: the deep walk owes both, a one-level walk only Beta.
  const fixture = mkdtempSync(join(tmpdir(), "ta-closure-"));
  try {
    mkdirSync(join(fixture, "dist"));
    writeFileSync(join(fixture, "dist/fixture.d.ts"),
      "export interface Alpha {\n    beta: Beta;\n}\nexport interface Beta {\n    gamma: Gamma;\n}\nexport interface Gamma {\n    leaf: string;\n}\n");
    const deepFixture = reachableUndeclared(["Alpha"], fixture);
    assert.deepEqual([...deepFixture.reachable.keys()], ["Beta", "Gamma"],
      "the closure did not reach Gamma from Alpha through Beta — the walk is one-level, and the type a consumer reaches two hops down is exactly the one three fires of this series missed");
    assert.deepEqual(deepFixture.reachable.get("Gamma").from, ["Beta"],
      "Gamma is reported reachable from something other than Beta — the `from` a reader needs in order to FIX a gap is wrong");
    assert.deepEqual([...reachableUndeclared(["Alpha"], fixture, 1).reachable.keys()], ["Beta"],
      "a maxDepth=1 walk over the fixture returned more than Beta — the depth parameter does nothing, and the control below cannot tell a transitive answer from a one-level one");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  // (b) and pinned again on the REAL tree, over item 6's type half as it read BEFORE this card: the
  // transitive answer is the five names / 16 members the card was filed on, the one-level answer is the
  // four the carried-forward note had, and the live predicate REFUSES that one naming each gap.
  const before = types.filter((n) => !CLOSURE_ADDED.includes(n));
  assert.equal(before.length, types.length - CLOSURE_ADDED.length,
    `item 6's type half no longer declares all of ${CLOSURE_ADDED.join(", ")} — the pre-TMUX-149 list this control reconstructs would then be the wrong one, and its answer would mean nothing`);
  const deep = reachableUndeclared(before);
  assert.deepEqual([...deep.reachable.keys()], CLOSURE_ADDED,
    "the transitive closure out of item 6's pre-TMUX-149 fifteen no longer returns the five names this card measured");
  assert.equal([...deep.reachable.values()].reduce((n, d) => n + d.members.length, 0), 16,
    "the five types carry a different number of members than the 16 the card measured — the count a consumer could not annotate is part of the claim");
  const one = reachableUndeclared(before, ROOT, 1);
  assert.ok(!one.reachable.has("Evidence"),
    "a ONE-LEVEL walk reported Evidence — then the transitive step is not what finds it, and this control measures nothing about transitivity");
  assert.deepEqual([...one.reachable.keys()], CLOSURE_ADDED.filter((n) => n !== "Evidence"),
    "the one-level walk no longer returns the four-name answer three fires carried forward — the two arms must differ by exactly Evidence for the deep walk to be doing the work");
  const refused = closureProblems(one, before, SIGNATURE_UNNAMED, SIGNATURE_CLOSURE_REFS).join("\n");
  for (const gap of CLOSURE_ADDED.filter((n) => n !== "Evidence")) {
    assert.match(refused, new RegExp(gap), `the predicate accepted the pre-fix closure without naming ${gap} — a real gap would then pass unnamed`);
  }

  // (c) the standard library is filtered out by "does the built tree DECLARE it", not by a stop-list.
  // Measured, not assumed: `Promise` and `Record` DO occur in covered bodies (NotifySink, LedgerEvent,
  // SpawnSpec), and SessionState's union members are capitalised tokens too — all dropped.
  const declared = declaredTypeNames();
  assert.ok(declared.size > 0, "the built tree's declared-name index is empty — the closure's filter would then drop every reference and report no gaps at all");
  const bodies = shippedTypeMembers(types).bodies;
  assert.match([...bodies.values()].join("\n"), /\bPromise\b/,
    "fixture stale: no covered signature names `Promise` any more, so this case no longer measures that the filter drops the standard library");
  const live = reachableUndeclared(types);
  for (const lib of ["Promise", "Record", "Partial", "Date"]) {
    assert.ok(!declared.has(lib) && !live.refs.has(lib),
      `${lib} is read as a type the built tree declares — the closure would then report the standard library as a shape the package owes a consumer a name for, and the allowlist would become the check`);
  }
  assert.ok(!live.refs.has("WORKING"),
    "the closure reached WORKING — that is a string literal inside SessionState's union, not a type, so the filter is admitting members of the unions it walks");

  // (d) a padded allowlist reds, using a name item 6 DOES declare — the closure cannot reach it as a
  // gap, so an allowlist that accepts it is a record of a decision about nothing.
  const padded = closureProblems(live, types, new Map([["CalibrationReport", "planted by this control"]]), SIGNATURE_CLOSURE_REFS).join("\n");
  assert.match(padded, /CalibrationReport/,
    "SIGNATURE_UNNAMED padded with a name item 6 declares raised no problem — the allowlist is then one-directional and a stale entry survives forever");

  // (e) and the vacuity the reference count exists for: a walk that read NOTHING must be a failure, not
  // the "no gaps" answer a healthy tree also gives.
  const vacuous = closureProblems({ reachable: new Map(), refs: new Map(), walked: [] }, types, SIGNATURE_UNNAMED, SIGNATURE_CLOSURE_REFS).join("\n");
  assert.match(vacuous, /stopped matching/,
    "a closure that read zero declaration bodies and reached zero names raised no problem — an empty answer would then be indistinguishable from a level tree");
  assert.match(vacuous, new RegExp(types[0]),
    `the vacuous walk was not reported as having skipped ${types[0]} — every declared type must be named when its body goes unread`);
});

// ---------------------------------------------------------------------------------------------
// Item 6's VALUE half — the other side of "and their signatures".
// TMUX-149's closure is seeded from item 6's TYPE half, so the 24 names a consumer CALLS or `new`s
// were seeded from nothing: a parameter's type, a return's type and every type a covered CLASS hands
// back from a method were outside every check in the suite. Measured 2026-09-22 on afccbee, 10 types
// the built tree declares were reachable from a covered value's signature with item 6 naming none of
// them and dist/index.d.ts re-exporting none — 8 object types carrying 35 members plus the two unions
// `Policy`'s signature speaks. `new Tmux({…})` took an options object a consumer could not annotate,
// `Monitor.tmuxStatus()` handed one back, and `wasteReport()` returned the analytics row a supervising
// script reads (scratch/ga-fire-2026-09-22-02Z/probe-values.log).
// ---------------------------------------------------------------------------------------------

/**
 * The ten names TMUX-150 added to item 6's type half, so the controls below can reconstruct the covered
 * set as it read BEFORE the fix and drive the closure over the answer this card was filed on. A literal
 * rather than a diff against git, for CLOSURE_ADDED's reason: the control's job is to show the walk still
 * finds them, and reading the previous revision would make it depend on the checkout's history.
 */
const VALUE_CLOSURE_ADDED = ["Action", "LedgerRetention", "Message", "PolicyConfig", "Surface", "SurfaceRules", "SweepResult", "TmuxOpts", "TmuxStatus", "WasteRow"];

/**
 * Types reachable from a covered VALUE's signature that item 6 deliberately does NOT name, with the
 * reason each is kept — SIGNATURE_UNNAMED's shape, checked BOTH ways below so it cannot be padded.
 *
 * Empty on purpose, and the emptiness is the check: on this tree the both-ways comparison against an
 * empty literal is the assertion that no type reaches a consumer through a covered value unnameable.
 * The ten that would have been in it were declared and re-exported instead (VALUE_CLOSURE_ADDED).
 */
const VALUE_UNNAMED = new Map([]);

/**
 * The number of declared type names the closure out of item 6's VALUE half reaches — the covered ones
 * included, which is the point: on a healthy tree VALUE_UNNAMED and the reachable-but-undeclared set are
 * both empty, so a reference scan that quietly stopped matching would report "no gaps" from a walk that
 * read nothing. 30 on afccbee (scratch/ga-fire-2026-09-22-02Z/probe-values.log), and unchanged by
 * TMUX-150's fix: declaring a type moves it out of the GAPS, never out of what the seeds reach.
 *
 * 39 since TMUX-151, and the +9 is the card: the declaration index reads CLASS heads now, so the classes a
 * covered value's signature names stop being filtered out as if they were `Date` or `Promise` — and one of
 * them, `Monitor.activity`'s `ActivityTracker`, is walked INTO, which is how `ActivityThresholds` and
 * `CpuSample` enter (scratch/ga-fire-2026-09-22-06Z/probe-151.log). The count is what makes the widening
 * loud: a filter that stopped reading class heads again would show up here as 39 → 30, not as "no gaps".
 *
 * 40 since TMUX-154, and the +1 is `DenialReason`: the seven error classes joined the value half, and
 * `PolicyDenied`'s body names the union its one field carries — the other six carry a constructor whose
 * parameters are literal unions, `unknown` and `string`, no declared type among them, so together they add eight
 * walked declarations (57 → 65: the seven and the union) and one reference. Predicted with these readers over the
 * parent tree's dist and then measured on the edited one (scratch/ga-fire-2026-09-22-18Z/probe-readers-parent.log,
 * probe-readers-edited.log). Declaring the classes WITHOUT the union reads here as 40 refs and one gap — the trap
 * TMUX-154 measured onto its own card so the ship would not discover it.
 *
 * UNMOVED by TMUX-155 at 40, and measured so (scratch/ga-fire-2026-09-22-22Z/probe-readers-parent.log,
 * probe-readers-edited.log): the eighth error class, `ProfileNameError`, is a value whose constructor takes `unknown`
 * and `readonly string[]` — no declared type among them — so it adds one walked declaration (65 → 66) and no reference.
 */
const VALUE_CLOSURE_REFS = 40;

test("versioning: no type reaches a consumer through a covered VALUE's signature without item 6 NAMING it — the closure out of item 6's value half is walked TRANSITIVELY over dist/**/*.d.ts and is set-equal with VALUE_UNNAMED both ways", (t) => {
  const { values, types } = declaredExportKinds(DOC);
  const covered = [...values, ...types];
  const live = reachableFromValues(values, covered);
  // A declared value nothing in the built declarations carries is reported, never dropped: the whole
  // closure would otherwise shrink in silence, which is what the type half's `missing` exists for.
  assert.deepEqual(live.missing, [],
    `declared in VERSIONING.md item 6's value half, but no dist/**/*.d.ts declares it as a class, function or const: ${live.missing.join(", ")} — item 6 promises these signatures, so a value whose declaration left the build is a promise with nothing behind it`);
  assert.ok(live.walked.length > 0,
    "the closure read not one value declaration — refusing to report zero unnameable types from a walk that read nothing");
  const problems = closureProblems(live, values, VALUE_UNNAMED, VALUE_CLOSURE_REFS, "item 6's value half", "VALUE_CLOSURE_REFS", "VALUE_UNNAMED");
  assert.equal(problems.length, 0, problems.join("\n"));
  t.diagnostic(`value closure: walked ${live.walked.length} declarations, reached ${live.refs.size} declared type names, ${live.reachable.size} of them undeclared`);
});

test("versioning: the value-half reader's own rules are CHECKED, not trusted — a class's whole BODY is read (head-only reaches 1 of the 10), the walk is TRANSITIVE (one-level misses SurfaceRules), a semicolon inside a parameter does not end a signature, and a padded allowlist or a scan that reads nothing both red", () => {
  const { values, types } = declaredExportKinds(DOC);
  const covered = [...values, ...types];

  // (a) the reader's KIND split, which decides where each declaration ends: 21 classes read to their
  // closing brace (12 until TMUX-151 declared `ActivityTracker`, 13 until TMUX-154 declared the seven error
  // classes, 20 until TMUX-155 declared the eighth, `ProfileNameError`), 12 functions to their terminating `;`.
  // A class misread as a function would stop at its first member and lose every method's signature — the
  // head-only failure, quietly.
  const { kinds } = shippedValueDeclarations(values);
  const byKind = {};
  for (const k of kinds.values()) byKind[k] = (byKind[k] ?? 0) + 1;
  assert.deepEqual(byKind, { class: 21, function: 12 },
    `item 6's ${values.length} values resolve to ${JSON.stringify(byKind)} — the kind decides where the declaration ends, so a changed split means the reader is slicing a different amount of signature than it was measured on`);

  // (b) the two rules pinned by a FIXTURE, so neither depends on this tree happening to carry the
  // shape. `Holder.m()` hands back Mid which carries Deep — the deep walk owes both, a one-level walk
  // only Mid, and a head-only read of the class owes nothing at all. `f`'s parameter carries a
  // semicolon INSIDE its braces, and a reader that ended the signature there would never see Deep.
  const fixture = mkdtempSync(join(tmpdir(), "ta-valueclosure-"));
  try {
    mkdirSync(join(fixture, "dist"));
    writeFileSync(join(fixture, "dist/fixture.d.ts"),
      "export declare class Holder {\n    m(): Mid;\n}\nexport declare function f(o: { a: string; b: Deep }): void;\nexport interface Mid {\n    deep: Deep;\n}\nexport interface Deep {\n    leaf: string;\n}\n");
    assert.deepEqual([...reachableFromValues(["Holder"], ["Holder"], fixture).reachable.keys()], ["Deep", "Mid"],
      "the value closure did not reach Deep from Holder through Mid — the walk is one-level, and the type a consumer reaches two hops down a method's return is exactly what this card was filed on");
    assert.deepEqual([...reachableFromValues(["Holder"], ["Holder"], fixture, 1).reachable.keys()], ["Mid"],
      "a maxDepth=1 walk over the fixture returned more than Mid — the depth parameter does nothing, and the control below cannot tell a transitive answer from a one-level one");
    assert.deepEqual([...reachableFromValues(["Holder"], ["Holder"], fixture, Infinity, true).reachable.keys()], [],
      "a HEAD-ONLY read of `class Holder {` reached a type — then the headOnly arm reads more than the declaration's first line and the control below measures nothing");
    assert.deepEqual([...reachableFromValues(["f"], ["f"], fixture).reachable.keys()], ["Deep"],
      "the reader did not reach Deep from `f(o: { a: string; b: Deep }): void;` — it ended the signature at the semicolon inside the parameter, so every function whose argument is an object type is read short");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  // (c) and pinned again on the REAL tree, over the covered set as it read BEFORE this card: the
  // transitive answer is the ten names / 35 members the card was filed on, the one-level answer is nine
  // (SurfaceRules hangs off PolicyConfig), the head-only answer is one, and the live predicate REFUSES
  // each degraded arm naming the gap it stops reaching.
  const before = covered.filter((n) => !VALUE_CLOSURE_ADDED.includes(n));
  assert.equal(before.length, covered.length - VALUE_CLOSURE_ADDED.length,
    `item 6 no longer declares all of ${VALUE_CLOSURE_ADDED.join(", ")} — the pre-TMUX-150 covered set this control reconstructs would then be the wrong one, and its answer would mean nothing`);
  const deep = reachableFromValues(values, before);
  assert.deepEqual([...deep.reachable.keys()], VALUE_CLOSURE_ADDED,
    "the transitive closure out of item 6's value half no longer returns the ten names this card measured");
  assert.equal([...deep.reachable.values()].reduce((n, d) => n + d.members.length, 0), 35,
    "the ten types carry a different number of members than the 35 the card measured — the count a consumer could not annotate is part of the claim");
  const one = reachableFromValues(values, before, ROOT, 1);
  assert.ok(!one.reachable.has("SurfaceRules"),
    "a ONE-LEVEL walk reported SurfaceRules — then the transitive step is not what finds it, and this control measures nothing about transitivity");
  assert.deepEqual([...one.reachable.keys()], VALUE_CLOSURE_ADDED.filter((n) => n !== "SurfaceRules"),
    "the one-level walk no longer returns the nine-name answer this card measured — the two arms must differ by exactly SurfaceRules for the deep walk to be doing the work");
  const heads = reachableFromValues(values, before, ROOT, Infinity, true);
  assert.deepEqual([...heads.reachable.keys()], ["WasteRow"],
    "a HEAD-ONLY read of the 33 declarations no longer returns WasteRow alone — that is the answer the 138th fire's read-only note recorded as zero, and the one this card corrects: `wasteReport()`'s declaration is the only one of the 33 (24 when measured; the eight error classes are all bodies) that fits on its own line");
  for (const [arm, result, seen] of [
    ["one-level", one, VALUE_CLOSURE_ADDED.filter((n) => n !== "SurfaceRules")],
    ["head-only", heads, ["WasteRow"]],
  ]) {
    const refused = closureProblems(result, values, VALUE_UNNAMED, VALUE_CLOSURE_REFS, "item 6's value half", "VALUE_CLOSURE_REFS", "VALUE_UNNAMED").join("\n");
    for (const gap of seen) {
      assert.match(refused, new RegExp(gap), `the predicate accepted the ${arm} closure without naming ${gap} — a real gap would then pass unnamed`);
    }
    // And the blindness itself, stated as the absence it is: the degraded arm cannot name what it never
    // reached, which is exactly why a reader that reads less is not a reader that reports less.
    for (const blind of VALUE_CLOSURE_ADDED.filter((n) => !seen.includes(n))) {
      assert.ok(!refused.includes(blind), `the ${arm} closure named ${blind} — then it reaches as much as the full read and neither arm measures what the full read is for`);
    }
    // The refs count is what makes a degraded reader LOUD rather than quietly honest: even with every gap
    // it can see allowlisted, reaching fewer declared names than were measured is itself a failure.
    assert.match(refused, /stopped matching/,
      `the ${arm} closure reached fewer declared type names than VALUE_CLOSURE_REFS and the predicate did not say so — a reader that silently stops matching would then report "no gaps" from a walk that read almost nothing`);
  }

  // (d) a padded allowlist reds, using a name item 6 DOES declare: the closure cannot reach it as a gap,
  // so an allowlist that accepts it is a record of a decision about nothing.
  const live = reachableFromValues(values, covered);
  const padded = closureProblems(live, values, new Map([["WasteRow", "planted by this control"]]), VALUE_CLOSURE_REFS, "item 6's value half", "VALUE_CLOSURE_REFS", "VALUE_UNNAMED").join("\n");
  assert.match(padded, /WasteRow/,
    "VALUE_UNNAMED padded with a name item 6 declares raised no problem — the allowlist is then one-directional and a stale entry survives forever");

  // (e) and the vacuity the reference count exists for: a walk that read NOTHING must be a failure, not
  // the "no gaps" answer a healthy tree also gives.
  const vacuous = closureProblems({ reachable: new Map(), refs: new Map(), walked: [] }, values, VALUE_UNNAMED, VALUE_CLOSURE_REFS, "item 6's value half", "VALUE_CLOSURE_REFS", "VALUE_UNNAMED").join("\n");
  assert.match(vacuous, /stopped matching/,
    "a value closure that read zero declarations and reached zero names raised no problem — an empty answer would then be indistinguishable from a level tree");
  assert.match(vacuous, new RegExp(values[0]),
    `the vacuous walk was not reported as having skipped ${values[0]} — every declared value must be named when its declaration goes unread`);
});

// ---------------------------------------------------------------------------------------------
// Both closures, one level deeper again — the filter's own BLIND SPOT: a CLASS.
// TMUX-149 and TMUX-150 walk through one declaration index, and its head shape read `interface` and
// `type` only. A class-typed member of a covered signature was therefore dropped, its declaration body
// never read, and every type reachable only THROUGH it dropped with it. Measured 2026-09-22 on 54dcdb1:
// the built tree declares 61 interface/type names and 22 CLASS names, so the index saw 61 of 83; the
// value half's closure went 30 refs / 0 gaps to 39 / 3. The three are `ActivityTracker` — reached from
// `Monitor.activity`, a seam whose own comment calls substituting a tracker supported — and behind it
// `ActivityThresholds` and `CpuSample`, two INTERFACES this index already accepted and could reach by no
// other path (scratch/ga-fire-2026-09-22-06Z/probe-151.log).
// ---------------------------------------------------------------------------------------------

/**
 * The three names TMUX-151 added to item 6, so the controls below can reconstruct the covered set as it
 * read BEFORE the fix — CLOSURE_ADDED's and VALUE_CLOSURE_ADDED's shape, and sorted, because that is the
 * order the closure reports gaps in. A literal rather than a diff against git, for their reason too.
 */
const CLASS_CLOSURE_ADDED = ["ActivityThresholds", "ActivityTracker", "CpuSample"];

test("versioning: a type reachable only THROUGH a covered CLASS is reached rather than dropped with it — the closure's declaration index reads class heads, and the three names Monitor.activity hid answer to item 6", (t) => {
  const { values, types } = declaredExportKinds(DOC);
  const covered = [...values, ...types];

  // (a) the index's head shape, over a FIXTURE so all four are checked and not only the two this tree
  // happens to carry. `abstract` is exactly that case: dist/ declares no abstract class today, and
  // VALUE_HEAD reads one — a head one reader accepts while the other drops it is the disagreement the
  // shared DECL_HEAD exists to prevent, and it would be invisible until the day someone writes one.
  const fixture = mkdtempSync(join(tmpdir(), "ta-classdecl-"));
  try {
    mkdirSync(join(fixture, "dist"));
    writeFileSync(join(fixture, "dist/fixture.d.ts"),
      "export interface Iface {\n    a: string;\n}\nexport type Alias = string;\nexport declare class Klass {\n    m(): void;\n}\nexport declare abstract class Abstract {\n    m(): void;\n}\n");
    assert.deepEqual([...declaredTypeNames(fixture)].sort(), ["Abstract", "Alias", "Iface", "Klass"],
      "the declaration index does not hold all four declaration heads (interface / type / class / abstract class) — a class it drops is not one name lost but a whole subtree, because the class's body is then never read");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  // (b) and on the real tree: the name the hole was found through is a CLASS by the value reader and a
  // declared type by the index, which is the agreement the two readers must reach for the walk to pass
  // through it at all.
  assert.equal(shippedValueDeclarations(["ActivityTracker"]).kinds.get("ActivityTracker"), "class",
    "dist/ no longer declares ActivityTracker as a class — this case's whole subject is what happens to the types behind a class, so its answer would mean nothing");
  assert.ok(declaredTypeNames().has("ActivityTracker"),
    "the declaration index does not hold ActivityTracker although dist/ declares it as a class — the closure's filter then drops every reference to it and the two interfaces behind it are unreachable");

  // (c) the seam that makes this a promise rather than a curiosity: `activity` is a PUBLIC member of a
  // covered class, so a consumer receives the tracker through a signature item 6 covers.
  const monitorBody = shippedValueDeclarations(["Monitor"]).bodies.get("Monitor");
  assert.match(monitorBody, /\bactivity:\s*ActivityTracker\b/,
    "fixture stale: dist/core/monitor.d.ts no longer declares `activity: ActivityTracker` on Monitor, so the reach this card measured is gone and the reconstruction below is testing a different tree");

  // (d) the covered set as it read BEFORE this card: the three are reported as gaps, each with the ONE
  // path that reaches it — the two interfaces through the class, the class through Monitor. That is the
  // claim: dropping the class does not lose a class, it loses everything behind it.
  const before = covered.filter((n) => !CLASS_CLOSURE_ADDED.includes(n));
  assert.equal(before.length, covered.length - CLASS_CLOSURE_ADDED.length,
    `item 6 no longer declares all of ${CLASS_CLOSURE_ADDED.join(", ")} — the pre-TMUX-151 covered set this control reconstructs would then be the wrong one, and its answer would mean nothing`);
  const deep = reachableFromValues(values, before);
  assert.deepEqual([...deep.reachable.keys()], CLASS_CLOSURE_ADDED,
    "the value closure over item 6's pre-TMUX-151 covered set no longer returns the three names this card measured");
  for (const [name, from, members] of [
    ["ActivityTracker", ["Monitor"], 2],
    ["ActivityThresholds", ["ActivityTracker"], 3],
    ["CpuSample", ["ActivityTracker"], 2],
  ]) {
    assert.deepEqual(deep.reachable.get(name).from, from,
      `${name} is reported reachable from something other than ${from.join(" + ")} — the two interfaces are reachable by NO path except the class body, and that is what makes the class's invisibility cost three names instead of one`);
    assert.equal(deep.reachable.get(name).members.length, members,
      `${name} carries a different number of members than the ${members} this card measured — the count a consumer could not annotate is part of the claim`);
  }

  // (e) and with them declared, the live closure is level in both halves and reaches what it was measured
  // reaching. The type half is asserted FLAT on purpose: the widening took the index 61 → 83 names and
  // moved nothing there, so a reader that quietly changed what a reference is would show up as a moved 13.
  const liveValues = reachableFromValues(values, covered);
  assert.equal(liveValues.reachable.size, 0,
    `a type still reaches a consumer through a covered value's signature with item 6 naming it nowhere: ${[...liveValues.reachable.keys()].join(", ")}`);
  assert.equal(liveValues.refs.size, VALUE_CLOSURE_REFS,
    `the value closure reaches ${liveValues.refs.size} declared type names where VALUE_CLOSURE_REFS records ${VALUE_CLOSURE_REFS}`);
  const liveTypes = reachableUndeclared(types, ROOT, Infinity, covered);
  assert.equal(liveTypes.refs.size, SIGNATURE_CLOSURE_REFS,
    `the type closure reaches ${liveTypes.refs.size} declared type names where SIGNATURE_CLOSURE_REFS records ${SIGNATURE_CLOSURE_REFS} — the class widening was measured to move this count by nothing, so a change here is the reference scan, not this card`);
  t.diagnostic(`class-aware index: ${declaredTypeNames().size} declared names, value closure ${liveValues.refs.size} refs, type closure ${liveTypes.refs.size} refs`);
});

test("versioning: the class-aware filter's own rules are CHECKED, not trusted — an interface reachable only through a class is REPORTED, the exclude set spans BOTH halves so a class item 6 declares as a VALUE is not reported as a gap, and it is the class's BODY that carries the reach", () => {
  // Every arm here is a FIXTURE, and that is deliberate: on this tree the type half reaches no class at
  // all (0 gaps under either exclude set), so widening the filter without widening `exclude` ships a
  // branch nothing drives. Measured on the fixture rather than reasoned from the source.
  const fixture = mkdtempSync(join(tmpdir(), "ta-classclosure-"));
  try {
    mkdirSync(join(fixture, "dist"));
    // `Covered` is the fixture's type half and `Ledger` its value half — the real shape: a covered
    // interface whose members are two classes, one of which item 6 declares as a value and one of which
    // hides an interface. `Shape` is the proof: a name the index accepted all along, reachable only here.
    writeFileSync(join(fixture, "dist/fixture.d.ts"),
      "export interface Covered {\n    l: Ledger;\n    u: Hidden;\n}\nexport declare class Ledger {\n    write(): void;\n}\nexport declare class Hidden {\n    shape: Shape;\n}\nexport interface Shape {\n    leaf: string;\n}\n");
    const typeHalf = ["Covered"], valueHalf = ["Ledger"];

    // (a) exclude = the TYPE half alone, which is what reachableUndeclared() did until this card: `Ledger`
    // reads as a gap although item 6 declares it — a name the consumer CAN write, reported as one they
    // cannot. The allowlist would then have to carry it, and the allowlist would become the check.
    assert.deepEqual([...reachableUndeclared(typeHalf, fixture).reachable.keys()], ["Hidden", "Ledger", "Shape"],
      "the closure seeded from the fixture's type half with the type half alone excluded did not report Ledger — then this arm is not the trap the widened exclude set exists for, and the live case's both-halves exclude is untested");

    // (b) exclude = BOTH halves: the declared class drops out and the two real gaps remain.
    const both = reachableUndeclared(typeHalf, fixture, Infinity, [...typeHalf, ...valueHalf]);
    assert.deepEqual([...both.reachable.keys()], ["Hidden", "Shape"],
      "excluding both halves did not drop Ledger while keeping Hidden and Shape — the exclude set must cover the names item 6 declares as VALUES without swallowing the ones it declares nowhere");

    // (c) `Shape` is the whole point of the card: an INTERFACE the index has always accepted, reachable by
    // no path except through a class body — so its `from` is the class, not the covered interface.
    assert.deepEqual(both.reachable.get("Shape").from, ["Hidden"],
      "Shape is reported reachable from something other than Hidden — an interface behind a class is exactly what a class-blind index loses, and the `from` a reader needs in order to FIX the gap is wrong");

    // (d) and the reach is the class's BODY, not its head: a one-level walk stops at the two classes and
    // never sees the interface behind one of them.
    assert.deepEqual([...reachableUndeclared(typeHalf, fixture, 1, [...typeHalf, ...valueHalf]).reachable.keys()], ["Hidden"],
      "a maxDepth=1 walk over the fixture reached more than Hidden — then reading the class's declaration body is not what finds Shape, and this case measures nothing about walking INTO a class");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Item 8 — tmux session user-options: declared ≡ the ones the built package sets and reads.
// The only covered item whose stated consumers are OUTSIDE this package ("external tooling reads
// these"), so drift here breaks someone else's script and nothing of ours can go red for it.
// ---------------------------------------------------------------------------------------------

/**
 * stripComments() — comments removed, string and template literals kept — is imported from
 * test/helpers/ledger-events.js, beside builtJs(). It lived HERE as a private copy until TMUX-147, and a
 * second byte-identical copy lived in test/agnostic-contract.test.js: three suites read the same built JS,
 * so a fix to one strip left the others judging that tree by the older rule. Its measurement and the
 * reason an over-eager strip is loud rather than silent are recorded at the definition.
 */

/**
 * The user-options the BUILT package actually uses: `@agent_*` as a quoted literal — the `set-option`
 * writes and `getOption` reads in dist/core/orchestrator.js — or inside a `#{…}` tmux format, which is how
 * dist/core/tmux.js asks list-sessions for all three at once. Bare occurrences are NOT the rule: counted
 * that way the three names hit 7/7/4 instead of 3/4/3, the extra hits being the comments that explain them.
 * Takes the JS as TEXT so a case can plant a fourth name, in code or in a comment, without touching dist/.
 */
function shippedUserOptions(js) {
  const code = stripComments(js);
  const names = [
    ...[...code.matchAll(/["'`](@agent_[A-Za-z0-9_]+)["'`]/g)].map((m) => m[1]),
    ...[...code.matchAll(/#\{(@agent_[A-Za-z0-9_]+)\}/g)].map((m) => m[1]),
  ];
  assert.ok(names.length > 0,
    "no @agent_* name occurs in dist/**/*.js as a quoted literal or inside a #{…} format — refusing to judge item 8 against nothing");
  return [...new Set(names)];
}

/** The comparison item 8 owes, as a function, so a case can run it over planted doc or planted JS. */
const compareUserOptions = (doc, js) => assertSameSet(declaredUserOptions(doc), shippedUserOptions(js),
  { declaredAs: "VERSIONING.md item 8", liveAs: "the quoted literals and #{…} formats of dist/**/*.js" });

test("versioning: declared tmux session user-options equal the ones the built package sets and reads (both directions)", () => {
  const declared = declaredUserOptions(DOC);
  const live = shippedUserOptions(builtJs());
  compareUserOptions(DOC, builtJs());
  // Counts too, the second lock items 2 and 3 carry: a name parsed twice satisfies both directions while
  // the declaration is not what the parse says it is.
  assert.equal(declared.length, live.length,
    `item 8 parses ${declared.length} names for the ${live.length} options the built package uses — the cut is keeping more than the declared list`);
});

test("versioning: an option the build sets that item 8 does not declare fails, naming it", () => {
  // The edit that was invisible before this card: a fourth set-option beside the three, doc untouched.
  const planted = `${builtJs()}\nawait this.tmux.exec(["set-option", "-t", paneTarget(spec.name), "@agent_model", spec.model]);\n`;
  assert.ok(shippedUserOptions(planted).includes("@agent_model"),
    "the plant does not read as shipped, so this case would be measuring the extraction rather than the contract");
  assert.throws(() => compareUserOptions(DOC, planted),
    (e) => e.message.includes("@agent_model") && e.message.includes("NOT declared in VERSIONING.md item 8"),
    "a fourth user-option the build sets with nothing declaring it passed — internal by the doc's own rule while external tooling reads it");
});

test("versioning: renaming a shipped option without the doc fails in BOTH directions", () => {
  // The card's own scenario. test/orchestrator.test.js catches this by asserting its own literal; no
  // failure there names VERSIONING.md, so an author who renames the option and updates that line in the
  // same pass lands in the doc-side plant below, where the suite was green.
  const renamed = builtJs().replaceAll("@agent_task", "@agent_topic");
  assert.notEqual(renamed, builtJs(), "fixture stale: dist/**/*.js no longer carries @agent_task at all");
  assert.throws(() => compareUserOptions(DOC, renamed),
    (e) => e.message.includes("@agent_topic") && e.message.includes("NOT declared")
      && e.message.includes("@agent_task") && e.message.includes("ABSENT"),
    "a renamed user-option satisfied the comparison — the new name must read as undeclared and the old as absent, or the doc is not the authority");
});

test("versioning: an option a dist COMMENT merely quotes is not shipped — the same name in code is", () => {
  const mentioned = `${builtJs()}\n// a fourth option we may add one day: "@agent_model" — named here, set nowhere\n`;
  assert.ok(!shippedUserOptions(mentioned).includes("@agent_model"),
    "a name a comment merely quotes counts as shipped — then a sentence about the future fails the contract, and the comparison above judges prose");
  const set = `${builtJs()}\nawait this.tmux.exec(["set-option", "-t", target, "@agent_model", value]);\n`;
  assert.ok(shippedUserOptions(set).includes("@agent_model"),
    "the same name in CODE does not count either — the rule is then not 'quoted literal' but 'nothing', and the live side is vacuous");
});

// ---------------------------------------------------------------------------------------------
// Item 4 — the status.json shape: declared ≡ the keys the shipped writer actually wrote. The only
// covered item whose consumer is a FILE rather than an import — item 2 defers to it twice and README
// sends a collector to parse it, so drift here breaks a supervising script in a patch release.
// ---------------------------------------------------------------------------------------------

/**
 * The status.json the SHIPPED path wrote, read once per run: the built CLI's `status --json FILE` on a
 * throwaway home and a socket no tmux server has ever run on. The FILE is the artefact an external reader
 * parses, so the file is the live side — never a regex over dist/analytics/status.js, which could agree
 * with the doc while what lands on disk does not. No server is needed: a dead socket answers
 * `{ reachable:false, … }` with `sessions: []`, which still carries item 4's whole enumerable half
 * (measured on 6bd630e, scratch/ga-fire-2026-09-19-06Z/probe/live-keys-6bd630e.log — one session the tool
 * spawned itself adds 14 per-session keys and changes neither set). Bounded, so a run that hangs on a dead
 * socket ends inside the bound rather than taking the suite with it.
 */
let writtenStatus;
function shippedStatusFile() {
  writtenStatus ??= (async () => {
    const home = mkdtempSync(join(tmpdir(), "ta-versioning-status-"));
    const out = join(home, "written.json");
    try {
      await execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), "--socket", `ta-versioning-nosrv-${process.pid}`, "status", "--json", out],
        { cwd: ROOT, env: { ...process.env, TMUX_AGENT_HOME: home }, timeout: 20_000, killSignal: "SIGKILL" });
      const s = JSON.parse(readFileSync(out, "utf8"));
      assert.ok(s.tmux && typeof s.tmux === "object",
        `the built CLI wrote a status.json with no tmux object (keys: ${Object.keys(s).join(",")}) — refusing to judge item 4 against an empty set`);
      return { top: Object.keys(s), tmux: Object.keys(s.tmux) };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  })();
  return writtenStatus;
}

/** The comparison item 4 owes, as a function, so a case can run it over a planted doc or a planted shape. */
function compareStatusShape(doc, live) {
  const declared = declaredStatusShape(doc);
  assertSameSet(declared.top, live.top,
    { declaredAs: "VERSIONING.md item 4 (status.json top-level keys)", liveAs: "the top-level keys the built writer wrote into status.json" });
  assertSameSet(declared.tmux, live.tmux,
    { declaredAs: "VERSIONING.md item 4 (the tmux block)", liveAs: "the keys of the tmux block as written into status.json" });
  return declared;
}

test("versioning: item 4's declared status.json shape equals the keys the shipped writer wrote — top-level and the tmux block, both directions", async () => {
  const live = await shippedStatusFile();
  const declared = compareStatusShape(DOC, live);
  // Counts too, the second lock items 2, 3 and 8 carry: a key parsed twice satisfies both directions while
  // the declaration is not what the parse says it is. refuseDuplicates() catches it first.
  assert.equal(declared.top.length, live.top.length,
    `item 4 parses ${declared.top.length} top-level keys for the ${live.top.length} the writer wrote — the parse is keeping more than the declared list`);
  assert.equal(declared.tmux.length, live.tmux.length,
    `item 4's tmux block parses ${declared.tmux.length} keys for the ${live.tmux.length} the writer wrote`);
});

test("versioning: a key deleted from item 4's tmux block is NOT declared, and the comparison fails naming it", async () => {
  // Plant A of the card: the edit that was invisible before this case. `checkedAt` left the declaration and
  // the code kept writing it; the whole unit suite stayed byte-identical to its control, because the 7 tests
  // that DO assert this list assert it as a literal they carry themselves.
  const live = await shippedStatusFile();
  const drifted = DOC.replace("`{ reachable, since, error, checkedAt }`", "`{ reachable, since, error }`");
  assert.notEqual(drifted, DOC,
    "fixture stale: item 4's tmux block is no longer written `{ reachable, since, error, checkedAt }`");
  assert.throws(() => compareStatusShape(drifted, live),
    (e) => e.message.includes("checkedAt") && e.message.includes("NOT declared in VERSIONING.md item 4"),
    "a key the writer puts in status.json's tmux block with nothing declaring it passed — internal by the doc's own rule while a collector parses it");
});

test("versioning: a top-level key deleted from item 4 fails naming it; one declared that nothing writes fails in the other direction", async () => {
  const live = await shippedStatusFile();
  // Plant C: the same deletion on the other half. `generatedAt` is what tells a supervisor how old the file is.
  const deleted = DOC.replace("top-level `v`, `generatedAt`", "top-level `v`");
  assert.notEqual(deleted, DOC, "fixture stale: item 4 no longer opens \"top-level `v`, `generatedAt`\"");
  assert.throws(() => compareStatusShape(deleted, live),
    (e) => e.message.includes("generatedAt") && e.message.includes("NOT declared in VERSIONING.md item 4"),
    "a top-level key the writer writes with nothing declaring it passed");
  // And the direction plant B has in the tree — a fifth key on one side and not the other. Planted on the DOC
  // side here so the case needs no build; the dist-side half (`publishStatus` shipping `writtenBy`) was watched
  // red on the parent tree in scratch/ga-fire-2026-09-19-08Z/red/ — the same set difference, other way round.
  const phantom = DOC.replace("top-level `v`, `generatedAt`", "top-level `v`, `writtenBy`, `generatedAt`");
  assert.notEqual(phantom, DOC, "fixture stale: item 4 no longer opens \"top-level `v`, `generatedAt`\"");
  assert.throws(() => compareStatusShape(phantom, live),
    (e) => e.message.includes("writtenBy") && e.message.includes("ABSENT from the top-level keys"),
    "item 4 promised a key status.json does not carry and the comparison passed — a collector would read undefined under a covered name");
});

/**
 * serverAbsent(), untilServerAbsent() and the writer this item is held against now live in
 * test/helpers/status-record.js: TMUX-153 gave README.md's `status.json` gloss the same authority, and one
 * writer driven by both readers is what stops a doc edit from satisfying either of them (the alternative
 * was a second copy of the drive, the shape the archive planter already pays for three times over).
 */

/** The comparison item 4's per-session half owes, as a function, so a case can run it over a planted doc or shape. */
const compareSessionFields = (doc, live) => assertSameSet(declaredSessionFields(doc), live,
  { declaredAs: "VERSIONING.md item 4 (the per-session fields)", liveAs: "the keys the built writer wrote into a status.json session record" });

/**
 * A plant made inside ONE item's own text and spliced back into the doc, for the phrases the reader's note at the
 * top of VERSIONING.md also QUOTES. Measured while writing TMUX-134: `DOC.replace(SESSION_START, …)` landed in that
 * comment — which no parse reads — so the case ran against an unplanted item and passed, while
 * `notEqual(planted, DOC)` saw a change and said nothing. A replace scoped to the item can only match in the item,
 * and a `from` the item no longer contains leaves it identical, which the same guard then catches. Item 5's plants
 * need it for the same reason: the note quotes all three of its markers, and its key list repeats the
 * names the note uses to describe the cuts.
 */
function plantInItem(number, from, to) {
  const item = (coveredItems(DOC).get(number) ?? "").trimEnd();
  assert.ok(DOC.includes(item) && item.includes("\n"), `fixture stale: item ${number} is no longer several lines of the doc verbatim`);
  const planted = DOC.replace(item, item.replace(from, to));
  assert.notEqual(planted, DOC, `fixture stale: "${from}" no longer occurs inside item ${number} as written`);
  return planted;
}

test("versioning: item 4's declared per-session fields equal the keys the shipped writer wrote into a real session's record, both directions", async () => {
  const declared = declaredSessionFields(DOC);
  const live = await shippedSessionRecord("versioning");
  compareSessionFields(DOC, live);
  // Counts too, the second lock items 2, 3, 4 and 8 carry: a field parsed twice satisfies both directions while
  // the declaration is not what the parse says it is. refuseDuplicates() catches it first.
  assert.equal(declared.length, live.length,
    `item 4's per-session list parses ${declared.length} fields for the ${live.length} keys the writer wrote into the record — the cut is keeping more than the declared list`);
});

test("versioning: a field dropped from item 4's per-session list is NOT declared and the comparison fails naming it; one declared that no record carries fails the other way", async () => {
  const live = await shippedSessionRecord("versioning");
  // The card's plant C: the declaration stops naming `reason` — the ONE field this half named before TMUX-134 made
  // it a list — while the writer keeps writing it. Measured invisible to the whole unit suite on 153a8be, and it is
  // the same direction as plant A (a key the writer ships that nothing declares), which was watched red on the
  // parent bc2d872 in scratch/ga-fire-2026-09-19-12Z/red/ with `writtenBy` shipped by dist's publishStatus.
  const dropped = DOC.replace("`cpuPerSec`, `reason`, `parent`", "`cpuPerSec`, `parent`");
  assert.notEqual(dropped, DOC, "fixture stale: item 4's per-session list no longer reads \"`cpuPerSec`, `reason`, `parent`\"");
  assert.ok(!declaredSessionFields(dropped).includes("reason"),
    "a field deleted from item 4's per-session list still parses as declared — the cut is keeping the prose before the list, which explains `reason` by name");
  assert.throws(() => compareSessionFields(dropped, live),
    (e) => e.message.includes("reason") && e.message.includes("NOT declared in VERSIONING.md item 4"),
    "the one field this half names by name left the declaration while the writer kept writing it, and the comparison passed — internal by the doc's own rule, in the record a collector loops over");
  // The other direction, which on the dist side is the card's plant B (`publishStatus` stops writing `task`, 14 keys
  // → 13): planted on the DOC side here so the case needs no rebuild — the same set difference, other way round.
  const phantom = DOC.replace("`owner`, `meta`\n   —", "`owner`, `meta`, `writtenBy`\n   —");
  assert.notEqual(phantom, DOC, "fixture stale: item 4's per-session list no longer ends \"`owner`, `meta`\" before its closing clause");
  assert.throws(() => compareSessionFields(phantom, live),
    (e) => e.message.includes("writtenBy") && e.message.includes("ABSENT from the keys the built writer wrote"),
    "item 4 promised a per-session field no record carries and the comparison passed — a collector reads undefined under a covered name");
});

// ---------------------------------------------------------------------------------------------
// Item 5 — the policy file schema: declared ≡ the top-level keys the built Policy honours, and the
// action names ≡ the list policy-status hands a client. The only covered item whose artefact the
// OPERATOR writes rather than the package emits — the file that gates every mutating action, and the
// one whose fourth key (`surfaces`) the tool's own refusal text tells an operator to set.
// ---------------------------------------------------------------------------------------------

/** Every dist/**\/*.js path, so a case can ask WHICH modules read something, not merely whether any does. */
function distJsFiles(dir = "dist", out = []) {
  for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`;
    if (ent.isDirectory()) distJsFiles(rel, out);
    else if (ent.name.endsWith(".js")) out.push(rel);
  }
  assert.ok(out.length > 0, "found no dist/**/*.js — is the tree built?");
  return out;
}

/**
 * The modules of the built package that read the policy FILE — `policy.json` or `TMUX_AGENT_POLICY` — with
 * comments stripped. The strip is load-bearing here, not tidiness: measured on e005f19
 * (scratch/ga-fire-2026-09-19-16Z/live-probe.log) the raw text of TWO of the 29 modules names policy.json,
 * the second being dist/core/lexicon.js's own TRUST MODEL comment ("operator-owned local config, exactly
 * like policy.json"). A grep would report two readers and the authority claim below would read false on
 * prose alone.
 */
function policyFileReaders() {
  const hits = distJsFiles().filter((rel) => /policy\.json|TMUX_AGENT_POLICY/.test(stripComments(readFileSync(join(ROOT, rel), "utf8"))));
  assert.ok(hits.length > 0,
    "no dist/**/*.js reads policy.json or TMUX_AGENT_POLICY at all — refusing to judge item 5 against nothing");
  return hits.sort();
}

/**
 * The top-level policy.json keys the BUILT package honours: every `this.cfg.<name>` read in
 * dist/core/policy.js, comments stripped. `this.cfg` IS the parsed file — the constructor assigns
 * `JSON.parse(readFileSync(p))` to it — so a `this.cfg.<name>` read is the package honouring a documented
 * key, and there is no other way to reach one. Takes the JS as TEXT so a case can plant a fifth honoured key
 * without touching dist/, the way item 8's live side does.
 */
function honouredPolicyKeys(js) {
  const names = [...stripComments(js).matchAll(/this\.cfg\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(names.length > 0,
    "no `this.cfg.<name>` read occurs in dist/core/policy.js — refusing to judge item 5's top-level keys against nothing");
  return [...new Set(names)];
}

const policyJs = () => readFileSync(join(ROOT, "dist/core/policy.js"), "utf8");

/** The comparison item 5's top half owes, as a function, so a case can run it over planted doc or planted JS. */
const comparePolicyKeys = (doc, js) => assertSameSet(declaredPolicyShape(doc).top, honouredPolicyKeys(js),
  { declaredAs: "VERSIONING.md item 5 (the policy.json top-level keys)", liveAs: "the this.cfg.<name> reads of dist/core/policy.js" });

/**
 * One fixture per declared top-level key: the config that must CHANGE a verdict, and the DenialReason the
 * built Policy must give for it. "Declared" has to mean "honoured" rather than "mentioned" — otherwise a key
 * written into item 5 that the package ignores is covered by semver on the strength of its name, which is
 * this card's drift in the other direction. Every fixture asks the same question (`send` on one session) so
 * each case measures the key and not the call, and the control is that question under `{}`.
 */
const HONOURED = new Map([
  ["readOnly", { cfg: { readOnly: true }, surface: "cli", reason: "read-only surface" }],
  ["deny", { cfg: { deny: { send: ["*"] } }, surface: "cli", reason: "deny-list" }],
  ["allow", { cfg: { allow: { send: ["elsewhere-*"] } }, surface: "cli", reason: "allow-list" }],
  // The key item 5 did not declare until TMUX-135, and the one with a second observable: the refusal is
  // scoped to the surface it names (THREAT-MODEL finding 6's fix), which `explain().source` reports.
  ["surfaces", { cfg: { surfaces: { mcp: { readOnly: true } } }, surface: "mcp", reason: "read-only surface", source: "surfaces.mcp", allowedOn: "cli" }],
]);

test("versioning: item 5's declared policy.json keys equal the ones the built Policy honours, both directions — and that module is still the only reader", () => {
  const declared = declaredPolicyShape(DOC).top;
  const live = honouredPolicyKeys(policyJs());
  comparePolicyKeys(DOC, policyJs());
  // Counts too, the second lock items 2, 3, 4 and 8 carry: a key parsed twice satisfies both directions while
  // the declaration is not what the parse says it is. refuseDuplicates() catches it first.
  assert.equal(declared.length, live.length,
    `item 5 parses ${declared.length} top-level keys for the ${live.length} the built Policy reads — the cut is keeping more than the declared list`);
  // What makes dist/core/policy.js the live side at all: it is the one module that reads the file. If a second
  // module starts reading policy.json, the extraction above stops being the authority and this case says so.
  assert.deepEqual(policyFileReaders(), ["dist/core/policy.js"],
    "a module other than dist/core/policy.js now reads policy.json / TMUX_AGENT_POLICY — the this.cfg.<name> extraction above is no longer the whole live side, so item 5 would be compared with part of the truth");
});

test("versioning: a fifth top-level key the built Policy honours that item 5 does not declare fails, naming it — a comment that merely mentions one does not", () => {
  // The card's plant B, measured INVISIBLE to the whole unit suite on e005f19: a fifth honoured key, declared
  // nowhere, is internal by the doc's own rule while the code gates an action on it.
  const planted = `${policyJs()}\nfunction auditOnlyRule() { return this.cfg.auditOnly ? "read-only surface" : null; }\n`;
  assert.ok(honouredPolicyKeys(planted).includes("auditOnly"),
    "the plant does not read as honoured, so this case would be measuring the extraction rather than the contract");
  assert.throws(() => comparePolicyKeys(DOC, planted),
    (e) => e.message.includes("auditOnly") && e.message.includes("NOT declared in VERSIONING.md item 5"),
    "a fifth key the built Policy honours with nothing declaring it passed — a patch release may stop honouring it and nothing in this repo calls that breaking");
  // And the other half of the same rule (item 8's, TMUX-132): a key a comment names is not honoured. Without
  // this, a sentence about a key we may add one day would fail the contract.
  const mentioned = `${policyJs()}\n// a fifth key we may honour one day: this.cfg.auditOnly — read nowhere yet\n`;
  assert.ok(!honouredPolicyKeys(mentioned).includes("auditOnly"),
    "a key a dist comment merely names counts as honoured — then prose about the future fails the contract, and the comparison above judges comments");
});

test("versioning: a key dropped from item 5 is NOT declared and the comparison fails naming it; one declared that nothing honours fails the other way", () => {
  // The card's plant A2, measured INVISIBLE on e005f19: item 5 stops naming `readOnly` while the built Policy
  // still honours it — the operator's own kill switch, uncovered, with the whole unit suite byte-identical.
  const dropped = plantInItem("5", "`readOnly`, `allow`", "`allow`");
  assert.ok(!declaredPolicyShape(dropped).top.includes("readOnly"),
    "a key deleted from item 5's list still parses as declared — the cut is keeping text that names it");
  assert.throws(() => comparePolicyKeys(dropped, policyJs()),
    (e) => e.message.includes("readOnly") && e.message.includes("NOT declared in VERSIONING.md item 5"),
    "the key the built Policy reads first and item 5 no longer declares passed the comparison");
  // The other direction, which on the dist side is plant B above: a key promised that nothing honours. An
  // operator writing it into policy.json gets silence, under a name semver covers.
  const phantom = plantInItem("5", "`deny`,\n   `surfaces`", "`deny`,\n   `surfaces`, `auditOnly`");
  assert.throws(() => comparePolicyKeys(phantom, policyJs()),
    (e) => e.message.includes("auditOnly") && e.message.includes("ABSENT from the this.cfg.<name> reads"),
    "item 5 promised a top-level key the built Policy never reads and the comparison passed — an operator writes it and nothing happens");
});

test("versioning: item 5's declared action names equal the list the built Policy hands a client, both directions", async () => {
  const { Policy } = await import(join(ROOT, "dist/index.js"));
  const declared = declaredPolicyShape(DOC).actions;
  const hidden = new Policy({ readOnly: true }, "mcp").explain().hiddenActions;
  assert.ok(Array.isArray(hidden) && hidden.length > 0,
    `the built Policy answered ${JSON.stringify(hidden)} as hiddenActions for a read-only surface — refusing to judge item 5's action names against nothing`);
  assertSameSet(declared, hidden,
    { declaredAs: "VERSIONING.md item 5 (the action names)", liveAs: "explain().hiddenActions of a read-only surface — the reply MCP policy-status returns" });
  assert.equal(declared.length, hidden.length,
    `item 5 parses ${declared.length} action names for the ${hidden.length} the built Policy hides — the cut is keeping more than the declared list`);
  // Why THAT is the live side, asserted rather than described: assertAllowed() honours any action string at
  // all, because the lookup is a plain r.deny?.[action] and the Action union is TypeScript, erased in dist/.
  // A live side built from "which names assertAllowed accepts" would prove anything declared (measured on
  // e005f19; `detach` is no action of this package).
  assert.throws(() => new Policy({ deny: { detach: ["*"] } }, "cli").assertAllowed("detach", "sess", "actor"),
    (e) => e.reason === "deny-list",
    "assertAllowed() refused an undeclared action name, so it could serve as the live side — re-read the comment above before changing this case, the erasure is what made hiddenActions the authority");
});

test("versioning: an action name dropped from item 5 fails naming it; a sixth one declared fails the other way", async () => {
  const { Policy } = await import(join(ROOT, "dist/index.js"));
  const hidden = new Policy({ readOnly: true }, "mcp").explain().hiddenActions;
  const compare = (doc) => assertSameSet(declaredPolicyShape(doc).actions, hidden,
    { declaredAs: "VERSIONING.md item 5 (the action names)", liveAs: "explain().hiddenActions of a read-only surface" });
  // `adopt` is the name that was backticked NOWHERE in this doc before TMUX-135: it is not a CLI verb, so
  // item 1's list could not lend it, and a client read it out of policy-status under no declaration at all.
  const dropped = plantInItem("5", "`kill`, `adopt`", "`kill`");
  assert.ok(!declaredPolicyShape(dropped).actions.includes("adopt"),
    "an action deleted from item 5's list still parses as declared — the cut is keeping text that names it");
  assert.throws(() => compare(dropped), (e) => e.message.includes("adopt") && e.message.includes("NOT declared in VERSIONING.md item 5"),
    "an action name the built Policy hands a client and item 5 no longer declares passed the comparison");
  // The card's plant E on the DOC side (the dist-side half was watched red on the parent e005f19 in
  // scratch/ga-fire-2026-09-19-16Z/red/, with `detach` added to the reply): a sixth name, promised, that no
  // client will ever be told about.
  const phantom = plantInItem("5", "`kill`, `adopt`", "`kill`, `adopt`, `detach`");
  assert.throws(() => compare(phantom), (e) => e.message.includes("detach") && e.message.includes("ABSENT from explain().hiddenActions"),
    "item 5 promised an action name no read-only surface hides and the comparison passed");
});

test("versioning: every top-level key item 5 declares is HONOURED by the built Policy, not merely mentioned", async () => {
  const { Policy } = await import(join(ROOT, "dist/index.js"));
  const declared = declaredPolicyShape(DOC).top;
  for (const key of declared) {
    const probe = HONOURED.get(key);
    assert.ok(probe,
      `item 5 declares \`${key}\` and no fixture in HONOURED drives it — semver would cover it on the strength of the name alone, which is this card's drift the other way round: add the fixture that proves the built Policy honours it, or stop declaring it`);
    assert.doesNotThrow(() => new Policy({}, probe.surface).assertAllowed("send", "sess", "actor"),
      `the control refuses on an EMPTY config, so \`${key}\`'s fixture below would be measuring the call rather than the key`);
    assert.throws(() => new Policy(probe.cfg, probe.surface).assertAllowed(
      "send", "sess", "actor"), (e) => e.reason === probe.reason,
      `the built Policy ignores \`${key}\`: ${JSON.stringify(probe.cfg)} on the ${probe.surface} surface left send allowed, or denied it for another reason than ${probe.reason} — item 5 declares a key a patch release could drop with nothing going red`);
    if (probe.source) {
      assert.equal(new Policy(probe.cfg, probe.surface).explain().source, probe.source,
        `\`${key}\` did not change what explain() reports as the source of the verdict — the per-surface scoping THREAT-MODEL finding 6 was closed with is then not observable`);
      assert.doesNotThrow(() => new Policy(probe.cfg, probe.allowedOn).assertAllowed("send", "sess", "actor"),
        `\`${key}\` refused on the ${probe.allowedOn} surface too — a surfaces entry that scopes nothing is the global switch finding 6 was about`);
    }
  }
  assert.equal(HONOURED.size, declared.length,
    `HONOURED carries ${HONOURED.size} fixtures for item 5's ${declared.length} declared keys — a fixture for a key the doc no longer declares is drift of its own`);
});

// ---------------------------------------------------------------------------------------------
// Item 5b — the lexicon file schema: four declared lists ≡ the keys the built package reads off a
// lexicon config, a profile, the parents block and a redact rule, AND every declared key honoured on
// a fixture that differs from its control in that key alone. The covered item an operator writes to
// make a security property STRONGER, and the one whose promise src/core/lexicon.ts names the failure
// for: "an adopter on a provider we do not use gets SILENT non-redaction, which writes their
// credentials to disk with no signal".
// ---------------------------------------------------------------------------------------------

/**
 * Comments removed AND the text of every literal blanked — a template literal keeping its `${…}`
 * expressions, since a real read can live inside one. Both strips are load-bearing, and measured so:
 * on 800f905 (scratch/ga-fire-2026-09-20-00Z/probe/lex-static*.log) a comment-only strip read a
 * top-level key named `json` off the built CLI, once from `lexicon: "a lexicon.json path"` — the flag's
 * own help text — and once from the `merge into lexicon.json` a calibrate draft prints. A key named in a
 * message or a path is not a read of one; the case below plants both halves rather than claiming it.
 */
function stripLiterals(js) {
  return stripComments(js).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    (lit) => (lit.startsWith("`") ? [...lit.matchAll(/\$\{([^{}]*)\}/g)].map((m) => `;${m[1]};`).join("") : '""'));
}

/**
 * Every `<holder>.<name>` / `<holder>?.<name>` member read of `js`, where `holder` is an expression like
 * `cfg` or `cfg.parents`. A match preceded by a quote, a slash or a dot is refused: that is a path, a
 * module specifier, or a member of something else (`this.cfg` is the **Policy**'s config, item 5's).
 */
function memberReads(js, holder) {
  const path = holder.split(".").join("\\??\\.");
  const re = new RegExp(String.raw`(?<![\w$"'/.])${path}\??\.([A-Za-z_$][\w$]*)`, "g");
  return [...new Set([...stripLiterals(js).matchAll(re)].map((m) => m[1]))];
}

/**
 * Which holder in which built module carries which of item 5b's four objects. Per (module, holder) rather
 * than per module, because the holder names collide across dist/: `spec` is a SpawnSpec in
 * orchestrator.js and a calibrate range in the CLI, `r` is a waste rollup in the CLI and a fetch response
 * in the dashboard UI. Scoped the way TMUX-135's live side scoped to dist/core/policy.js.
 *
 * One extraction limit, stated rather than hidden: validateLexicon() walks the LITERAL
 * ["error","blocked","working","idle"] with prof[key], so a member-read grep sees only `prof.name` and
 * `prof.contextPct` in lexicon.js. The four state keys are visible as monitor.js's `spec.*` instead —
 * which is why the profile list is read from BOTH modules, and why a table of holders is the live side
 * rather than one grep.
 */
const LEXICON_READS = new Map([
  ["dist/core/lexicon.js", { top: ["cfg"], profile: ["prof"], parents: ["cfg.parents"], redact: ["rule", "r"] }],
  ["dist/core/monitor.js", { top: ["cfg"], profile: ["spec"] }],
  ["dist/bin/tmux-agent.js", { top: ["lexicon"], parents: ["lexicon.parents"] }],
]);

/** How each of item 5b's four lists is named in a failure, so a message says which promise broke. */
const LEXICON_GROUPS = new Map([
  ["top", { declaredAs: "VERSIONING.md item 5b (the lexicon.json top-level keys)", liveAs: "the keys the built package reads off a lexicon config" }],
  ["profile", { declaredAs: "VERSIONING.md item 5b (the profiles[] fields)", liveAs: "the fields the built package reads off a lexicon profile" }],
  ["parents", { declaredAs: "VERSIONING.md item 5b (the parents fields)", liveAs: "the fields the built package reads off the parents block" }],
  ["redact", { declaredAs: "VERSIONING.md item 5b (the redact[] rule fields)", liveAs: "the fields the built package reads off a redact rule" }],
]);

/** dist as text, per module — a case passes a `read` that plants one module without touching the tree. */
const distText = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** The lexicon keys the BUILT package honours, by list, from the table above. */
function honouredLexiconShape(read = distText) {
  const out = {};
  for (const group of LEXICON_GROUPS.keys()) out[group] = [];
  for (const [rel, holders] of LEXICON_READS) {
    const js = read(rel);
    for (const [group, exprs] of Object.entries(holders)) {
      for (const expr of exprs) out[group].push(...memberReads(js, expr));
    }
  }
  for (const [group, names] of Object.entries(out)) {
    assert.ok(names.length > 0,
      `no member read of a lexicon ${group} object occurs in the built modules LEXICON_READS names — refusing to judge item 5b's ${group} list against nothing`);
    out[group] = [...new Set(names)];
  }
  return out;
}

/** The module that IS the lexicon loader, and the import that is the only way to hold what it returns. */
const LEXICON_MODULE = "dist/core/lexicon.js";
const IMPORTS_LEXICON = /from\s*["'][^"']*lexicon\.js["']/;

/**
 * Which built modules read a lexicon key at all: a module can only hold a lexicon config if it is the
 * loader or imports it, and of those it reads a key only if some member read on one of the table's holder
 * names occurs in it. Asserted below to be exactly the three LEXICON_READS names — the authority claim
 * TMUX-135 made for dist/core/policy.js. Measured on 800f905: seven modules can hold one
 * (bin/tmux-agent.js, core/{engagement,lexicon,monitor,redact}.js, index.js, mcp/server.js) and four of
 * them read no key — they route the config into lexicon.js's compilers, or only re-export it. Note this
 * asks for ANY member read, not one of the 19 declared names: a FOURTH module reading a key this table
 * never heard of must fail too, not only one reading a name already declared.
 */
function lexiconKeyReaders() {
  const holders = [...new Set([...LEXICON_READS.values()].flatMap((h) => Object.values(h).flat()))];
  const hits = distJsFiles().filter((rel) => {
    const js = distText(rel);
    if (rel !== LEXICON_MODULE && !IMPORTS_LEXICON.test(stripComments(js))) return false;
    return holders.some((expr) => memberReads(js, expr).length > 0);
  });
  assert.ok(hits.length > 0,
    "no module of the built package reads a lexicon key at all — refusing to judge item 5b against nothing");
  return hits.sort();
}

/** The comparison item 5b owes on the STATIC authority, list by list, so a case can run it over a plant. */
function compareLexiconShape(doc, live) {
  const declared = declaredLexiconShape(doc);
  for (const [group, names] of LEXICON_GROUPS) assertSameSet(declared[group], live[group], names);
  return declared;
}

/**
 * The fixture the DYNAMIC authority drives: one lexicon exercising all 19 declared keys at once, with
 * values chosen so each key has an observable of its own (`ctx (\d+)% left` read as 70 rather than 30 is
 * `contextPctInverted`; a lowercase secret matching an uppercase pattern is `flags`).
 */
const LEX_PROFILE = {
  name: "probeagent",
  error: ["PROBE-ERR"], blocked: ["PROBE-BLOCKED\\?"], working: ["PROBE-WORKING"], idle: ["PROBE-IDLE"],
  contextPct: "ctx (\\d+)% left", contextPctInverted: true,
};
const LEX_RULE = { name: "probe-secret", pattern: "PROBESEC-[A-Z0-9]{6}", replacement: "[PROBE-REDACTED]", flags: "i" };
const LEX_FIXTURE = {
  version: 1,
  profiles: [LEX_PROFILE],
  replaceProfiles: true,
  parents: { nonSession: ["probe-boss"], nonSessionPattern: "^probe-orch-\\d+$", replace: true },
  redact: [LEX_RULE],
};
/** …and the three ways a control drops exactly one key out of it. */
const lexWithout = (key) => { const c = { ...LEX_FIXTURE }; delete c[key]; return c; };
const lexProfile = (patch) => ({ ...LEX_FIXTURE, profiles: [{ ...LEX_PROFILE, ...patch }] });
const lexProfileWithout = (key) => { const p = { ...LEX_PROFILE }; delete p[key]; return { ...LEX_FIXTURE, profiles: [p] }; };
const lexRule = (patch) => ({ ...LEX_FIXTURE, redact: [{ ...LEX_RULE, ...patch }] });
const lexRuleWithout = (key) => { const r = { ...LEX_RULE }; delete r[key]; return { ...LEX_FIXTURE, redact: [r] }; };

/**
 * What the BUILT package makes of a lexicon config, through the covered root exports only. Each field is
 * the observable of at least one declared key. Every global the drive configures (redaction, engagement)
 * is restored before returning, so one case's fixture cannot leak into another's.
 */
function observeLexicon(api, cfg) {
  const { resolveProfiles, configureRedaction, redact, configureEngagement, validateLexicon } = api;
  const obs = { refusal: null, order: [], state: {}, contextPct: null, redacted: null, sup: {} };
  try {
    validateLexicon(cfg);
  } catch (e) {
    obs.refusal = e.message;
  }
  const profs = resolveProfiles(cfg);
  obs.order = profs.map((p) => p.name);
  // The user profiles come first in the chain, so profs[0] is the fixture's own when it has one.
  const prof = (cfg.profiles ?? []).length ? profs[0] : null;
  for (const [key, tail] of [["error", "PROBE-ERR here"], ["blocked", "PROBE-BLOCKED?"], ["working", "PROBE-WORKING"], ["idle", "PROBE-IDLE"]]) {
    obs.state[key] = prof ? prof.classify([tail]) : null;
  }
  // contextPct is NOT part of classify() — it is its own function on the profile, absent when unset. A
  // case driving classify alone reads null for a contextPct fixture and looks like "not honoured".
  obs.contextPct = prof?.contextPct?.(["ctx 30% left"]) ?? null;
  try {
    configureRedaction(cfg);
    obs.redacted = redact("token PROBESEC-abc123 end");
  } catch {
    obs.redacted = null; // a rule the loader refuses has no redaction to observe; `refusal` carries it
  } finally {
    configureRedaction({});
  }
  try {
    const isSup = configureEngagement(cfg);
    // `operator` is one of the BUILT-IN non-session parent names, and no rule of the fixture names or
    // matches it — so it is a supervisor here only while the built-ins are still merged in. (Measured
    // 2026-09-20: `claude`, which the 22Z probe used, is not a built-in name at all, so it reads false
    // under replace:true and under no replace alike — a control that proves nothing.)
    obs.sup = { name: isSup("probe-boss"), pattern: isSup("probe-orch-7"), builtin: isSup("operator") };
  } catch {
    obs.sup = {};
  } finally {
    configureEngagement({});
  }
  return obs;
}

/**
 * One entry per declared key: the config that must produce `value`, and the CONTROL that differs from it
 * in THAT KEY ALONE and must not. "Declared" has to mean "honoured" rather than "mentioned" — otherwise a
 * key written into item 5b that the package ignores is covered by semver on the strength of its name,
 * which is this card's drift the other way round (the TMUX-135 rule, whose fixtures are HONOURED above).
 *
 * Two keys cannot be controlled by deletion, and say so: a profile with no `name` and a redact rule with
 * no `pattern` are both refused at load, so their controls RENAME and re-pattern instead. `name` on a
 * redact rule is honoured in one place only — the refusal for a bad rule is reported under it — so its
 * fixture is the rule the pattern screen rejects.
 */
const LEXICON_HONOURED = new Map([
  ["top.version", { cfg: { ...LEX_FIXTURE, version: 2 }, control: LEX_FIXTURE, read: (o) => /unsupported version 2/.test(o.refusal ?? ""), value: true }],
  ["top.profiles", { cfg: LEX_FIXTURE, control: lexWithout("profiles"), read: (o) => o.order.includes("probeagent"), value: true }],
  ["top.replaceProfiles", { cfg: LEX_FIXTURE, control: lexWithout("replaceProfiles"), read: (o) => o.order.join(","), value: "probeagent,generic-shell" }],
  ["top.parents", { cfg: LEX_FIXTURE, control: lexWithout("parents"), read: (o) => o.sup.name, value: true }],
  ["top.redact", { cfg: LEX_FIXTURE, control: lexWithout("redact"), read: (o) => o.redacted, value: "token [PROBE-REDACTED] end" }],
  ["profile.name", { cfg: LEX_FIXTURE, control: lexProfile({ name: "otherprobe" }), read: (o) => o.order[0], value: "probeagent" }],
  ["profile.error", { cfg: LEX_FIXTURE, control: lexProfileWithout("error"), read: (o) => o.state.error, value: "ERROR" }],
  ["profile.blocked", { cfg: LEX_FIXTURE, control: lexProfileWithout("blocked"), read: (o) => o.state.blocked, value: "BLOCKED" }],
  ["profile.working", { cfg: LEX_FIXTURE, control: lexProfileWithout("working"), read: (o) => o.state.working, value: "WORKING" }],
  ["profile.idle", { cfg: LEX_FIXTURE, control: lexProfileWithout("idle"), read: (o) => o.state.idle, value: "IDLE" }],
  ["profile.contextPct", { cfg: LEX_FIXTURE, control: lexProfileWithout("contextPct"), read: (o) => o.contextPct, value: 70 }],
  ["profile.contextPctInverted", { cfg: LEX_FIXTURE, control: lexProfileWithout("contextPctInverted"), read: (o) => o.contextPct, value: 70 }],
  ["parents.nonSession", { cfg: LEX_FIXTURE, control: { ...LEX_FIXTURE, parents: { nonSessionPattern: LEX_FIXTURE.parents.nonSessionPattern, replace: true } }, read: (o) => o.sup.name, value: true }],
  ["parents.nonSessionPattern", { cfg: LEX_FIXTURE, control: { ...LEX_FIXTURE, parents: { nonSession: ["probe-boss"], replace: true } }, read: (o) => o.sup.pattern, value: true }],
  ["parents.replace", { cfg: LEX_FIXTURE, control: { ...LEX_FIXTURE, parents: { nonSession: ["probe-boss"], nonSessionPattern: LEX_FIXTURE.parents.nonSessionPattern } }, read: (o) => o.sup.builtin, value: false }],
  ["redact.name", { cfg: lexRule({ pattern: "(a+)+" }), control: lexRule({ pattern: "(a+)+", name: "other-rule" }), read: (o) => /redact rule "probe-secret"/.test(o.refusal ?? ""), value: true }],
  ["redact.pattern", { cfg: LEX_FIXTURE, control: lexRule({ pattern: "NOTHINGHERE-[0-9]{9}" }), read: (o) => o.redacted, value: "token [PROBE-REDACTED] end" }],
  ["redact.replacement", { cfg: LEX_FIXTURE, control: lexRule({ replacement: "[OTHER]" }), read: (o) => o.redacted, value: "token [PROBE-REDACTED] end" }],
  ["redact.flags", { cfg: LEX_FIXTURE, control: lexRuleWithout("flags"), read: (o) => o.redacted, value: "token [PROBE-REDACTED] end" }],
]);

test("versioning: item 5b's four declared lexicon lists equal the keys the built package reads off a config, a profile, the parents block and a redact rule, both directions — and those three modules are still the only readers", () => {
  const declared = compareLexiconShape(DOC, honouredLexiconShape());
  const live = honouredLexiconShape();
  // Counts per list too, the second lock items 2, 3, 4, 5 and 8 carry: a key parsed twice satisfies both
  // directions while the declaration is not what the parse says it is. refuseDuplicates() catches it first,
  // and here it must run PER LIST — `name` belongs to both `profiles[]` and `redact[]`, so one flat set
  // would fail on the shipped doc (measured on b0fe063).
  for (const group of LEXICON_GROUPS.keys()) {
    assert.equal(declared[group].length, live[group].length,
      `item 5b parses ${declared[group].length} ${group} keys for the ${live[group].length} the built package reads — the cut is keeping more than the declared list`);
  }
  assert.deepEqual(declared.profile.filter((k) => declared.redact.includes(k)), ["name"],
    "item 5b's profile and redact lists no longer share exactly `name` — the reason the guards run per list rather than over one flat set has moved, so re-read declaredLexiconShape() before changing this");
  // What makes the table above the live side at all: these are the only modules that read a lexicon key.
  assert.deepEqual(lexiconKeyReaders(), ["dist/bin/tmux-agent.js", "dist/core/lexicon.js", "dist/core/monitor.js"],
    "a module other than the three LEXICON_READS names now reads a lexicon key — the per-(module, holder) extraction above is no longer the whole live side, so item 5b would be compared with part of the truth");
});

test("versioning: a key dropped from item 5b's redact list is NOT declared and the comparison fails naming it; one declared that nothing reads fails the other way", () => {
  const live = honouredLexiconShape();
  // The card's plant A, measured INVISIBLE to the whole unit suite on b0fe063: item 5b stops naming the
  // redact-rule fields the additive-redaction promise rests on, while the built package keeps reading them.
  const dropped = plantInItem("5b", "`replacement`, `flags`", "`replacement`");
  assert.ok(!declaredLexiconShape(dropped).redact.includes("flags"),
    "a key deleted from item 5b's redact list still parses as declared — the cut is keeping text that names it");
  assert.throws(() => compareLexiconShape(dropped, live),
    (e) => e.message.includes("flags") && e.message.includes("NOT declared in VERSIONING.md item 5b"),
    "the key that decides whether a user rule matches case-insensitively left the declaration while the package kept reading it, and the comparison passed — internal by the doc's own rule, on the file whose whole point is that redaction can only get stronger");
  // The other direction: a field promised on a redact rule that nothing reads. An operator writes it into
  // lexicon.json and gets silence, under a name semver covers.
  const phantom = plantInItem("5b", "`replacement`, `flags`", "`replacement`, `flags`, `caseFold`");
  assert.throws(() => compareLexiconShape(phantom, live),
    (e) => e.message.includes("caseFold") && e.message.includes("ABSENT from the fields the built package reads off a redact rule"),
    "item 5b promised a redact-rule field the built package never reads and the comparison passed");
});

test("versioning: a sixth top-level key the built package honours that item 5b does not declare fails, naming it — a comment or a message that merely names one does not", () => {
  // The card's plant B, measured INVISIBLE on b0fe063 and live rather than dead code there: in the planted
  // copy resolveProfiles({profiles:[{name:'x'}]}) answered ["x","claude-code","codex","aider",
  // "generic-shell"] while the same call with strictProfiles:true answered ["x"], verified before the
  // verdict was read (scratch/ga-fire-2026-09-19-22Z/red/plant-B-live.log).
  const planted = (rel) => (rel === "dist/core/monitor.js"
    ? `${distText(rel)}\nexport function strictOnly(cfg) { return cfg.strictProfiles ? [] : null; }\n`
    : distText(rel));
  assert.ok(honouredLexiconShape(planted).top.includes("strictProfiles"),
    "the plant does not read as honoured, so this case would be measuring the extraction rather than the contract");
  assert.throws(() => compareLexiconShape(DOC, honouredLexiconShape(planted)),
    (e) => e.message.includes("strictProfiles") && e.message.includes("NOT declared in VERSIONING.md item 5b"),
    "a sixth top-level key the built package reads with nothing declaring it passed — a patch release may stop honouring it and nothing in this repo calls that breaking");
  // And the other half of the same rule (item 8's, TMUX-132, extended to literals here): a key a COMMENT
  // names is not read, and neither is one inside a MESSAGE — the two shapes the strip was measured on.
  for (const [what, tail] of [
    ["comment", "\n// a sixth key we may honour one day: cfg.strictProfiles — read nowhere yet\n"],
    ["message", '\nexport const hint = "set cfg.strictProfiles to drop the built-ins";\n'],
    ["template", "\nexport const help = `pass cfg.strictProfiles next to ${String(1)} other flag`;\n"],
  ]) {
    const mentioned = (rel) => (rel === "dist/core/monitor.js" ? `${distText(rel)}${tail}` : distText(rel));
    assert.ok(!honouredLexiconShape(mentioned).top.includes("strictProfiles"),
      `a key a dist ${what} merely names counts as read — then prose about the future fails the contract, and the comparison above judges ${what}s`);
    assert.doesNotThrow(() => compareLexiconShape(DOC, honouredLexiconShape(mentioned)),
      `the ${what} moved the live set, so the strip is not doing what its name says`);
  }
  // The strip must not be blind, either: the same name in a template EXPRESSION is a read.
  const inExpr = (rel) => (rel === "dist/core/monitor.js" ? `${distText(rel)}\nexport const tag = \`profiles: \${cfg.strictProfiles}\`;\n` : distText(rel));
  assert.ok(honouredLexiconShape(inExpr).top.includes("strictProfiles"),
    "a read inside a template's ${…} was swallowed with the literal text around it — then the strip hides real reads and the live side is short");
});

test("versioning: a key MOVED from one of item 5b's lists into a parenthetical is NOT declared, and the comparison fails naming it", () => {
  const live = honouredLexiconShape();
  // The exact shape this card is about. Before TMUX-137 item 5b wrote all 15 of its nested keys inside
  // parentheticals, so it declared 4 of the 19 keys the package honours — and the rule that makes an aside
  // declare nothing is what turned those 15 into a gap rather than a declaration. This case is
  // that rule pointed at the doc as it is now: an author who "tidies" a key back into an aside loses it.
  const moved = plantInItem("5b", "`nonSession`, `nonSessionPattern`, `replace` —",
    "`nonSession`, `nonSessionPattern` (and `replace`) —");
  const declared = declaredLexiconShape(moved);
  assert.ok(!declared.parents.includes("replace"),
    "a key moved into a parenthetical still parses as declared — the parenthetical rule has lapsed, and item 5b's 15 nested keys would read as declared while declaring nothing");
  assert.deepEqual(declared.parents, ["nonSession", "nonSessionPattern"],
    "moving one key into an aside changed more than that key — the parenthetical drop is eating list text around it");
  assert.throws(() => compareLexiconShape(moved, live),
    (e) => e.message.includes("replace") && e.message.includes("NOT declared in VERSIONING.md item 5b"),
    "the key that drops the built-in supervisor names left the declaration for an aside and the comparison passed — which is the state item 5b shipped in until this card");
});

test("versioning: item 5b's parse reads its four lists alone — not the subject it defers to item 7, not an aside, not the prose after", () => {
  const declared = declaredLexiconShape(DOC);
  // The subject names the FILE, and item 7 takes that path by reference; it is no key of the file.
  for (const group of LEXICON_GROUPS.keys()) {
    assert.ok(!declared[group].some((k) => k.includes("/") || k.includes("~")),
      `item 5b's ${group} list parsed a path — the subject's \`~/.tmux-agent/lexicon.json\` is item 7's by-reference declaration, not a key of the file`);
  }
  // `version` is a BARE key, not the `version: 1` token the subject aside carried until this card: a token
  // with a value in it is declared nowhere the parse can compare, so the loader's own refusal had no promise.
  assert.ok(declared.top.includes("version") && !declared.top.some((k) => k.includes(":")),
    "item 5b declares `version` as a value token rather than a bare key — nothing then compares it with the key the built loader refuses an unsupported value for");
  // Each marker's own backticked name belongs to the list that DECLARES it, never to the list it opens.
  assert.deepEqual([declared.profile.includes("profiles"), declared.parents.includes("parents"), declared.redact.includes("redact")], [false, false, false],
    "a list parsed the name out of its own opening phrase — the cut is keeping the marker, so `profiles`/`parents`/`redact` would be declared twice over");
  // And a name backticked after the last list reads as a declaration, so it must fail.
  const after = plantInItem("5b", "New optional keys are additive (minor).", "New optional keys are additive (minor). A sixth, `strictProfiles`, may appear.");
  assert.throws(() => declaredLexiconShape(after),
    (e) => e.message.includes("strictProfiles") && e.message.includes("AFTER its last list"),
    "a key backticked after item 5b's last list was ignored — there is nothing a name can mean there except a declaration");
});

test("versioning: item 5b declares each key once per list, and its five markers are rewrap-proof while a reworded one is loud", () => {
  const twice = plantInItem("5b", "`nonSession`, `nonSessionPattern`, `replace`", "`nonSession`, `nonSessionPattern`, `replace`, `nonSession`");
  assert.throws(() => declaredLexiconShape(twice),
    (e) => e.message.includes("nonSession") && e.message.includes("more than once"),
    "item 5b listed a key twice and the parse accepted it — set equality cannot see a duplicate, so both directions agree while the declaration is not what the parse says it is");
  // Rewrapping: every marker is matched on normalized text, and item 5b as shipped wraps two of its five
  // across a line break, so this is the shipped state rather than a hypothetical.
  const item = coveredItems(DOC).get("5b");
  const flat = flatten(item);
  const oneLine = DOC.replace(item, `${flat}\n`);
  assert.notEqual(oneLine, DOC, "fixture stale: item 5b is no longer written across several lines");
  assert.deepEqual(declaredLexiconShape(oneLine), declaredLexiconShape(DOC),
    "rewrapping item 5b onto one line changed what it declares — a cut is reading raw lines again");
  // Reworded on the FLATTENED item and spliced back, for item 7's two reasons: a marker that spans a line
  // break has no raw form to replace, and the reader's note at the top of the doc quotes all five of them —
  // a doc-wide replace would land there, where no parse reads, and pass on an unplanted item.
  for (const marker of [LEX_TOP_START, LEX_PROFILE_START, LEX_PARENTS_START, LEX_REDACT_START, LEX_END]) {
    const mangled = flat.replace(marker, marker.replace(/[A-Za-z]+/, (w) => `${w}ish`));
    assert.notEqual(mangled, flat, `fixture stale: "${marker}" no longer occurs in item 5b's normalized text`);
    assert.throws(() => declaredLexiconShape(DOC.replace(item, `${mangled}\n`)),
      (e) => /no longer occurs in/.test(e.message) && e.message.includes("item 5b"),
      `rewording item 5b's "${marker}" marker did not fail loudly — the parse would read prose as a declaration, or silently declare one list twice`);
  }
});

test("versioning: every key item 5b declares is HONOURED by the built package — one fixture per key against a control differing in that key alone", async () => {
  const api = await import(join(ROOT, "dist/index.js"));
  const declared = declaredLexiconShape(DOC);
  let checked = 0;
  for (const [group, keys] of Object.entries(declared)) {
    for (const key of keys) {
      const probe = LEXICON_HONOURED.get(`${group}.${key}`);
      assert.ok(probe,
        `item 5b declares \`${key}\` in its ${group} list and no fixture in LEXICON_HONOURED drives it — semver would cover it on the strength of the name alone, which is this card's drift the other way round: add the fixture that proves the built package honours it, or stop declaring it`);
      assert.deepEqual(probe.read(observeLexicon(api, probe.cfg)), probe.value,
        `the built package did not answer ${JSON.stringify(probe.value)} for \`${key}\` on its own fixture — the fixture is stale, so this case is measuring nothing`);
      assert.notDeepEqual(probe.read(observeLexicon(api, probe.control)), probe.value,
        `the built package ignores \`${key}\`: a config differing from the fixture in that key ALONE answered the same thing — item 5b declares a key a patch release could drop with nothing going red`);
      checked += 1;
    }
  }
  assert.equal(LEXICON_HONOURED.size, checked,
    `LEXICON_HONOURED carries ${LEXICON_HONOURED.size} fixtures for item 5b's ${checked} declared keys — a fixture for a key the doc no longer declares is drift of its own`);
  // 19, and stated: the count is the whole point of the card, which found 4 declared against 19 honoured.
  assert.equal(checked, 19, `item 5b declares ${checked} keys across its four lists, not the 19 the built package honours`);
});

test("versioning: the built CLI's own doctor reply carries every list of item 5b back — the third reader module's keys, observed rather than grepped", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-lexicon-")));
  try {
    const doctor = async (cfg) => {
      const path = join(dir, `lexicon-${Object.keys(cfg).length}.json`);
      writeFileSync(path, JSON.stringify(cfg));
      const { stdout } = await execFileP(process.execPath,
        [join(ROOT, "dist", "bin", "tmux-agent.js"), "--lexicon", path, "doctor"],
        { cwd: dir, env: { ...process.env, TMUX_AGENT_HOME: join(dir, "home") }, timeout: 25_000, killSignal: "SIGKILL" });
      return JSON.parse(stdout);
    };
    const live = await doctor(LEX_FIXTURE);
    const control = await doctor({});
    // dist/bin/tmux-agent.js is the third module LEXICON_READS names, and `doctor` is the only place its
    // reads are observable: the reply is what an operator checks a lexicon landed by. Every field here
    // answers a declared key, and the control differs on every one of them.
    for (const [what, read, want] of [
      ["version", (d) => d.lexicon.version, 1],
      ["profiles", (d) => d.profiles.order, ["probeagent", "generic-shell"]],
      ["profiles (count)", (d) => d.profiles.userDefined, 1],
      ["replaceProfiles", (d) => d.profiles.replaceBuiltins, true],
      ["parents.nonSession", (d) => d.parents.extraNames, ["probe-boss"]],
      ["parents.nonSessionPattern", (d) => d.parents.extraPattern, LEX_FIXTURE.parents.nonSessionPattern],
      ["parents.replace", (d) => d.parents.replaceBuiltins, true],
      ["redact", (d) => d.redaction.extraRules, 1],
    ]) {
      assert.deepEqual(read(live), want, `the built CLI's doctor reply does not report \`${what}\` from a lexicon that sets it`);
      assert.notDeepEqual(read(control), want, `doctor reports the same \`${what}\` with an EMPTY lexicon — the field is then no observation of a declared key`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Item 7 — the on-disk layout under $TMUX_AGENT_HOME: declared ≡ the first path segments the built
// package joins onto the home, AND ⊇ what a real home the built CLI drove is left holding. The only
// covered item about a shape on DISK — what a backup script, a log collector and crash forensics
// read — and the only one read on two authorities, because either alone is blind: a static read
// accepts a path the package names but never writes, and a dynamic read reported item 7 complete
// while the `health/` directory the daemon creates was declared nowhere at all.
// ---------------------------------------------------------------------------------------------

/**
 * A path the tool writes and REMOVES inside a single verb: recorded here, covered by nothing — item 6
 * keeps INTERNAL and item 3 keeps RESERVED the same way, so the decision is visible in the test rather
 * than asserted in English in the doc. Checked BOTH ways below: a name here the built package no longer
 * constructs is drift of its own, and a segment the package constructs that is neither declared nor
 * here fails the comparison naming it.
 */
const TRANSIENT = new Map([
  [".exec-<id>.sh", "the script `exec` writes, runs and unlinks before the verb returns"],
  [".exec-<id>.rc", "the exit code that script writes, read and unlinked by the same verb"],
  [".exec-<id>.out", "the output that script writes, read and unlinked by the same verb"],
  [".paste-<id>", "the buffer `send` load-buffers into tmux and unlinks once loaded"],
]);

/**
 * The tmux-agent home the built CLI is driven against here — one real session, spawned, sent to, exec'd,
 * status-published, messaged and killed. The verbs are chosen for what each one WRITES: `spawn` makes
 * `logs/` and the ledger day file, `send` and `exec` make (and remove) the transient dot-files, plain
 * `status` writes `status.json` at its DEFAULT path — the flagless form, since `--json FILE` would let the
 * case name the artefact it then finds — and `msg send` makes the mailbox. Read once per run.
 */
let drivenHome;
function drivenHomeSegments() {
  drivenHome ??= (async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-home-")));
    const home = join(dir, "home");
    const sock = `ta-versioning-home-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
    const name = `tahome-${process.pid}`;
    const cli = (args) => execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), "--socket", sock, ...args],
      { cwd: dir, env: { ...process.env, TMUX_AGENT_HOME: home }, timeout: 25_000, killSignal: "SIGKILL" });
    try {
      assert.ok(serverAbsent(sock), `the throwaway socket ${sock} already has a tmux server`);
      // A BARE shell in the driven pane: the server is started with `bash --norc --noprofile` as its
      // default-command before the CLI spawns on it. What this drive measures is the HOME the verbs leave behind,
      // never the pane's shell — and the host's login profile + pty wrapper + line editor wedged this very case in
      // four of twelve coverage reads on 2026-09-28 (all cuts, both processes asleep, the line drawn nowhere).
      quietServer(sock);
      await cli(["spawn", name, "--cwd", dir]);
      // Wait for exec's OWN guard before driving send/exec: a fresh pane is briefly held by the host's
      // pty wrapper or a login rc, and the item-7 exec below is refused there — RIGHTLY.
      await waitForShell(sock, name, { home });
      await cli(["send", name, "echo item7"]);
      await cli(["exec", name, "echo item7-exec"]);
      await cli(["status"]);
      await cli(["msg", "send", "versioning", name, "item7"]);
      await cli(["kill", name]);
      const segs = readdirSync(home);
      assert.ok(segs.length > 1,
        `the built CLI left ${segs.length} entries in a home it was driven end to end against (${segs.join(",") || "none"}) — refusing to judge item 7 against nothing`);
      return segs;
    } finally {
      killServerSync(sock);
      await untilServerAbsent(sock);
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return drivenHome;
}

/**
 * The default-home fallback collapsed to ONE token before anything else. `join(process.env.TMUX_AGENT_HOME
 * ?? join(homedir(), ".tmux-agent"), "policy.json")` is two nested joins, and a home-expression pattern that
 * reaches lazily to the first `)` matches the INNER one — which reports `.tmux-agent`, the home's own name,
 * and loses `policy.json` entirely. Measured on the 18Z probe, which did exactly that.
 */
const DEFAULT_HOME = /join\(\s*homedir\(\)\s*,\s*["'`]\.tmux-agent["'`]\s*\)/g;
const HOME_EXPR = String.raw`(?:(?:[A-Za-z_$][\w$]*\s*\?\?\s*)*process\.env\.TMUX_AGENT_HOME\s*\?\?\s*HOMEDEFAULT|(?:this|orch|opts)\.home|home)`;
const HOME_SITE = new RegExp(String.raw`join\(\s*${HOME_EXPR}\s*,\s*(\x60[^\x60]+\x60|"[^"]+"|'[^']+')`, "g");

/**
 * The first path segments the BUILT package constructs under the home: every `join(<home>, "<seg>", …)`
 * site of comment-STRIPPED dist/**\/*.js, with a template placeholder normalized to `<id>` so a per-call
 * name reads as the one path it is. Comments are stripped for the reason item 8's extraction strips them
 * (the 16Z lesson, where a raw grep counted a TRUST MODEL comment as a policy.json reader): a comment
 * QUOTING a join must not contribute a path. On today's dist the strip removes no site — a call shape is
 * a narrower thing than a grep — so the case below plants one rather than claiming the guard is already
 * load-bearing. Takes the JS as TEXT so a plant needs no rebuild.
 */
function homeSegments(js) {
  const code = stripComments(js).replace(DEFAULT_HOME, "HOMEDEFAULT");
  const segs = [...code.matchAll(HOME_SITE)].map((m) => m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, "<id>"));
  assert.ok(segs.length > 0,
    "no join(<home>, \"…\") site occurs in dist/**/*.js at all — refusing to judge item 7 against nothing");
  return [...new Set(segs)];
}

/** The comparison item 7 owes on the STATIC authority, as a function, so a case can run it over a plant. */
function compareHomeLayout(doc, js) {
  const declared = homeFirstSegments(declaredHomeLayout(doc));
  const live = homeSegments(js).filter((s) => !TRANSIENT.has(s));
  assertSameSet(declared, live,
    { declaredAs: "VERSIONING.md item 7 (the $TMUX_AGENT_HOME layout, by first path segment)", liveAs: "the first segments the built package joins onto the home, transient files aside" });
  return declared;
}

test("versioning: item 7's declared home layout equals the first path segments the built package joins onto $TMUX_AGENT_HOME, both directions", () => {
  const js = builtJs();
  compareHomeLayout(DOC, js);
  // The TRANSIENT allowlist both ways, as item 3's RESERVED is checked: an entry the package stopped
  // constructing is a decision about nothing, and every entry must carry the reason it is not covered.
  const live = homeSegments(js);
  for (const [seg, why] of TRANSIENT) {
    assert.ok(live.includes(seg),
      `TRANSIENT records \`${seg}\` as written-and-removed inside one verb, and the built package constructs no such path under the home — remove the entry, or item 7's comparison is excusing a path that no longer exists`);
    assert.ok(why.length > 20, `TRANSIENT's entry for \`${seg}\` records no reason it is uncovered`);
  }
});

test("versioning: a path deleted from item 7 is NOT declared and the comparison fails naming it; a further path the built package creates fails the other way", () => {
  const js = builtJs();
  // Plant A of the card, measured invisible to the whole unit suite on b243565: item 7 stops naming
  // `web-token`, a path the built package writes AND reads back (bin/tmux-agent.js,
  // core/dashboard-probe.js, web/server.js), while the code keeps writing it.
  const dropped = plantInItem("7", "`web-token`, `status.json`", "`status.json`");
  assert.ok(!declaredHomeLayout(dropped).includes("web-token"),
    "a path deleted from item 7's list still parses as declared — the cut is keeping text outside the list");
  assert.throws(() => compareHomeLayout(dropped, js),
    (e) => e.message.includes("web-token") && e.message.includes("NOT declared in VERSIONING.md item 7"),
    "the dashboard's own token file left the declaration while the package kept writing it, and the comparison passed — internal by the doc's own rule, in the home a backup script copies");
  // Plant B, the direction the card watched red on the parent: the daemon's Blackbox constructor creates a
  // further directory beside `health/`, declared nowhere. Planted in the JS so the case needs no rebuild;
  // the same edit inside dist/core/blackbox.js was verified to really create the directory before its
  // verdict was read (scratch/ga-fire-2026-09-19-20Z/red/).
  const seventh = `${js}\nmkdirSync(join(home, "audit"), { recursive: true, mode: 0o700 });\n`;
  assert.ok(homeSegments(seventh).includes("audit"),
    "the plant does not read as constructed, so this case would be measuring the extraction rather than the contract");
  assert.throws(() => compareHomeLayout(DOC, seventh),
    (e) => e.message.includes("audit") && e.message.includes("NOT declared in VERSIONING.md item 7"),
    "a further home path the package creates with nothing declaring it passed — crash forensics and backups would find a directory semver does not cover");
  // And the mirror: a path item 7 promises that nothing under the home constructs.
  const phantom = plantInItem("7", "`web-token`, `status.json`", "`web-token`, `status.json`, `audit/index.json`");
  assert.throws(() => compareHomeLayout(phantom, js),
    (e) => e.message.includes("audit") && e.message.includes("ABSENT from the first segments"),
    "item 7 promised a home path the package never creates and the comparison passed — a backup script would look for a directory that is never there");
});

test("versioning: a home path a dist COMMENT merely quotes is not constructed — the same call in code is", () => {
  const js = builtJs();
  const mentioned = `${js}\n// one day we may keep an audit trail: join(home, "audit") beside the health directory\n`;
  assert.ok(!homeSegments(mentioned).includes("audit"),
    "a join a comment merely quotes counts as constructed — then a sentence about the future fails item 7's contract, and the comparison above judges prose (the 16Z lesson, where a raw grep read a TRUST MODEL comment as a reader)");
  assert.doesNotThrow(() => compareHomeLayout(DOC, mentioned),
    "the comment moved the live set, so the strip is not doing what its name says");
  const coded = `${js}\nmkdirSync(join(home, "audit"), { recursive: true });\n`;
  assert.ok(homeSegments(coded).includes("audit"),
    "the same join in CODE does not count either — the rule is then not 'a call site' but 'nothing', and the live side is vacuous");
});

test("versioning: item 7's two config files are declared BY REFERENCE from the items that own them — a deferral to an item naming no such file is loud", () => {
  // policy.json and lexicon.json live in the same home and are items 5's and 5b's to declare. The parse
  // reads THEIR subjects, so this is the one declaration in item 7 that follows another item when it moves.
  assert.deepEqual(declaredHomeLayout(DOC).slice(-2), ["policy.json", "lexicon.json"],
    "item 7 no longer takes items 5's and 5b's files by reference — either the deferral moved or the referenced items renamed their subjects");
  const renamed = DOC.replace("**Lexicon file schema** (`~/.tmux-agent/lexicon.json`)", "**Lexicon file schema** (`~/.tmux-agent/vocab.json`)");
  assert.notEqual(renamed, DOC, "fixture stale: item 5b no longer opens \"**Lexicon file schema** (`~/.tmux-agent/lexicon.json`)\"");
  assert.ok(declaredHomeLayout(renamed).includes("vocab.json") && !declaredHomeLayout(renamed).includes("lexicon.json"),
    "item 5b renamed its file and item 7's declaration did not move with it — the deferral is then a sentence, not a reference, and item 7 declares a path nothing writes");
  // A deferral that resolves to nothing must be loud, never an empty contribution — nonEmpty()'s rule for
  // the case where the OTHER item is the one that drifted.
  const emptied = DOC.replace("**Policy file schema** (`~/.tmux-agent/policy.json`)", "**Policy file schema**");
  assert.notEqual(emptied, DOC, "fixture stale: item 5 no longer opens \"**Policy file schema** (`~/.tmux-agent/policy.json`)\"");
  assert.throws(() => declaredHomeLayout(emptied),
    (e) => e.message.includes("defers a home path to item 5") && e.message.includes("backticks no"),
    "item 7 deferred to an item that names no home file of its own and the parse returned a shorter list — the file would be covered by neither item, silently");
});

test("versioning: item 7's parse reads its list alone — not the home it names, not its asides, not the shipped half, not the prose after", () => {
  const declared = declaredHomeLayout(DOC);
  // The item's own subject names the home, not a path in it; the list is cut after it for that reason.
  assert.ok(!declared.some((p) => p.includes("TMUX_AGENT_HOME")),
    "item 7's parse read its own subject as a declared path — $TMUX_AGENT_HOME is the home, not something in it");
  // Every parenthetical dropped: the knobs an aside explains declare nothing, and `health.json`
  // appears in BOTH the list and an aside, so a lapse of this rule would trip refuseDuplicates() above.
  for (const aside of ["ledgerKeepDays", "ledgerDeleteAfterDays", "TMUX_AGENT_LOG_MAX_BYTES", "capture.rotated"]) {
    assert.ok(!declared.includes(aside), `item 7's parse read \`${aside}\` from an aside as a declared path`);
  }
  assert.equal(declared.filter((p) => p === "health.json").length, 1,
    "item 7's asides re-mention `health.json`, and the parse counted it twice — the parenthetical rule has lapsed");
  // The shipped half is a second declaration about a different tree, and its paths are not home paths.
  for (const shipped of ["dist/build.json", "version", "commit", "builtAt", "stale"]) {
    assert.ok(!declared.includes(shipped), `item 7's parse read \`${shipped}\` from the shipped-layout half as a path under the home`);
  }
  // And a path backticked between the list's end and that half reads as a declaration, so it must fail.
  const after = plantInItem("7", "Adding a path", "A seventh, `audit/index.json`, may appear. Adding a path");
  assert.throws(() => declaredHomeLayout(after),
    (e) => e.message.includes("audit/index.json") && e.message.includes(HOME_SHIPPED),
    "a path backticked after item 7's list and before its shipped half was ignored — there is nothing a path can mean there except a declaration");
});

test("versioning: item 7 declares each path once, and its markers are rewrap-proof while a reworded one is loud", () => {
  const twice = plantInItem("7", "`web-token`, `status.json`", "`web-token`, `status.json`, `web-token`");
  assert.throws(() => declaredHomeLayout(twice),
    (e) => e.message.includes("web-token") && e.message.includes("more than once"),
    "item 7 listed a path twice and the parse accepted it — set equality cannot see a duplicate, so both directions agree while the declaration is not what the parse says it is");
  // Rewrapping: every marker is matched on normalized text, and two of item 7's four already span a line
  // break as shipped — HOME_END and HOME_BYREF — so this is the shipped state, not a hypothetical.
  const item = coveredItems(DOC).get("7");
  const flat = flatten(item);
  const oneLine = DOC.replace(item, `${flat}\n`);
  assert.notEqual(oneLine, DOC, "fixture stale: item 7 is no longer written across several lines");
  assert.deepEqual(declaredHomeLayout(oneLine), declaredHomeLayout(DOC),
    "rewrapping item 7 onto one line changed what it declares — a cut is reading raw lines again");
  // The rewording is done on the FLATTENED item and spliced back, for two reasons: a marker that spans a
  // line break has no raw form to replace, and the reader's note at the top of this doc quotes all four of
  // them — a doc-wide replace would land there, where no parse reads, and the case would pass on an
  // unplanted item (the 12Z trap plantInItem() exists for).
  for (const marker of [HOME_SHIPPED, HOME_START, HOME_END, HOME_BYREF]) {
    const mangled = flat.replace(marker, marker.replace(/[A-Za-z]+/, (w) => `${w}ish`));
    assert.notEqual(mangled, flat, `fixture stale: "${marker}" no longer occurs in item 7's normalized text`);
    assert.throws(() => declaredHomeLayout(DOC.replace(item, `${mangled}\n`)),
      (e) => /no longer occurs in/.test(e.message) && e.message.includes("item 7"),
      `rewording item 7's "${marker}" marker did not fail loudly — the parse would read prose as a declaration, or silently drop the deferral`);
  }
});

test("versioning: a REAL home the built CLI drove end to end carries only paths item 7 declares", async () => {
  const live = await drivenHomeSegments();
  const declared = homeFirstSegments(declaredHomeLayout(DOC));
  const undeclared = live.filter((s) => !declared.includes(s) && !TRANSIENT.has(s));
  assert.deepEqual(undeclared, [],
    `a home the built CLI was driven end to end against (spawn → send → exec → status → msg send → kill) is left holding ${undeclared.join(", ")}, which VERSIONING.md item 7 declares and TRANSIENT excuses neither — the static read above cannot see this, since it only knows what the code NAMES`);
  // The other half of why both authorities are needed: this one proves the declaration is not merely prose.
  // A path is only proven WRITTEN when a real drive leaves it behind, so the overlap must be non-trivial.
  const proven = live.filter((s) => declared.includes(s));
  assert.ok(proven.length >= 3,
    `only ${proven.length} of item 7's ${declared.length} declared paths (${proven.join(", ") || "none"}) were left behind by a real drive — either the drive stopped exercising the home or the declaration has become prose`);
});

// ---------------------------------------------------------------------------------------------
// Item 7's SHIPPED half — the build stamp the PACKAGE carries: declared fields ≡ the keys the
// stamped dist/build.json holds AND the keys the built readBuildStamp() normalises to, both
// directions; one fixture per field proving the built code HONOURS it; the declared path proven to
// be IN the tarball (the "the package carries" clause smoke step 14 does not check); and every
// declared reporter driven for real. The last unparsed thing in the covered list, and the second
// item whose whole payload sat inside a parenthetical, where item 7's own rule says a name declares
// nothing — so of the half's 9 backticked tokens 4 survived and none of them was a field.
// ---------------------------------------------------------------------------------------------

/** The stamp the running tree carries, read at the path item 7's shipped half declares — never rewritten. */
const shippedStampJson = () => readFileSync(join(ROOT, declaredShippedStamp(DOC).path), "utf8");

/** The comparison the shipped half owes on the FILE authority, as a function so a case can plant either side. */
function compareStampFields(doc, stampJson) {
  const declared = declaredShippedStamp(doc).fields;
  const live = Object.keys(JSON.parse(stampJson));
  assert.ok(live.length > 0,
    "the shipped stamp holds no keys at all — refusing to judge item 7's shipped half against nothing");
  assertSameSet(declared, live, {
    declaredAs: "VERSIONING.md item 7's shipped half (the build stamp's fields)",
    liveAs: "the keys dist/build.json holds after `npm run build` stamped this tree",
  });
  return declared;
}

/**
 * The same comparison on the READER authority: the keys the built readBuildStamp() normalises a stamp to.
 * Both are needed and neither may be dropped for the other, and they catch OPPOSITE drift — the reader
 * normalises to its own three fields, so a fourth key in the file is invisible here and caught by the file
 * authority above, while a field declared here that the built reader drops is invisible there and caught
 * only by this one.
 */
async function compareStampReader(doc, stampJson) {
  const { readBuildStamp } = await import(join(ROOT, "dist/core/build.js"));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-stamp-")));
  try {
    const path = join(dir, "build.json");
    writeFileSync(path, stampJson);
    const read = readBuildStamp(path);
    assert.ok(read, "the built readBuildStamp() read no stamp from the fixture — refusing to judge item 7's shipped half against nothing");
    assertSameSet(declaredShippedStamp(doc).fields, Object.keys(read), {
      declaredAs: "VERSIONING.md item 7's shipped half (the build stamp's fields)",
      liveAs: "the keys the built readBuildStamp() normalises a stamp to",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A stamp whose three values are distinguishable, so an observable naming one cannot be a coincidence. */
const STAMP_PROBE = { version: "9.9.9-probe", commit: "f00dbee", builtAt: "2026-09-20T04:00:00.000Z" };
const STAMP_FORMATTED = "9.9.9-probe (f00dbee, built 2026-09-20T04:00:00.000Z)";

/**
 * One entry per declared field: the CONTROL is the same stamp file with that field's KEY renamed, so the
 * built reader finds it absent, and `says` is what the observable then reports in its place. "Declared" has
 * to mean "honoured" rather than "mentioned" (the TMUX-135 rule): a field written into this half that the
 * package ignores would otherwise be covered by semver on the strength of its name, which is this card's
 * drift the other way round. The observable is the string `--version` prints, built from the stamp FILE, so
 * the field NAME is what is exercised — an object would prove only that the formatter reads a property.
 */
const STAMP_HONOURED = new Map([
  ["version", { rename: "versionRenamed", says: "unknown (f00dbee" }],
  ["commit", { rename: "commitRenamed", says: "(no git commit, built" }],
  ["builtAt", { rename: "builtAtRenamed", says: "built unknown" }],
]);

/**
 * One probe per declared reporter, each returning what that surface reported for every declared field — so a
 * reporter named in the doc with no probe here fails loudly. The probes assert the report EXISTS and freeze
 * no reply shape: `/api/*` is in this same file's NOT-covered section and a status reply carries
 * startedAt / processUptimeSec / onDisk / stale of its own, none of them a field of the stamp.
 */
const STAMP_REPORTERS = new Map([
  ["--version", async (fields, stamp) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-version-")));
    try {
      const { stdout } = await execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), "--version"],
        { env: { ...process.env, TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: `ta-versioning-none-${process.pid}` }, timeout: 25_000, killSignal: "SIGKILL" });
      return Object.fromEntries(fields.map((f) => [f, stdout.includes(String(stamp[f])) ? stamp[f] : null]));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }],
  ["doctor", async (fields, stamp) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-doctor-")));
    try {
      const { stdout } = await execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), "doctor"],
        { env: { ...process.env, TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: `ta-versioning-none-${process.pid}` }, timeout: 25_000, killSignal: "SIGKILL" });
      const reply = JSON.parse(stdout);
      return Object.fromEntries(fields.map((f) => [f, reply.build?.[f] ?? null]));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }],
  ["/api/health.build", async (fields, stamp) => {
    // The built dashboard, from a COPY of dist/ (the repo's own stamp is read by every other suite and must
    // never move under them) on a throwaway home, token disabled — the token file is never read or printed.
    const tree = copyTree();
    const home = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-health-")));
    let child = null;
    try {
      const started = await startWeb(tree, home, {}, ["--no-token"]);
      child = started.child;
      const r = await fetch(`http://127.0.0.1:${started.port}/api/health`);
      assert.equal(r.status, 200, `/api/health → ${r.status}`);
      const h = await r.json();
      return Object.fromEntries(fields.map((f) => [f, h.build?.[f] ?? null]));
    } finally {
      // killing is a signal, not a state: the daemon's exit is awaited before either home goes —
      // CI run 35966537723 attempt 1 lost this race at the rmSync(home) below with every assertion passed.
      await stopWeb(child);
      rmSync(tree, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }],
]);

test("versioning: item 7's shipped half declares the build stamp the package carries — the path it is read at, and its fields on two authorities (the stamped dist/build.json and the built readBuildStamp()), both directions", async () => {
  const declared = declaredShippedStamp(DOC);
  // The declared PATH is load-bearing: this read is done at it, so renaming it in the doc without the tree
  // (or in the tree without the doc) fails here rather than being compared against the old file.
  const stampJson = shippedStampJson();
  compareStampFields(DOC, stampJson);
  await compareStampReader(DOC, stampJson);
  // Counts too, the second lock the parsed items carry: a field parsed twice satisfies both directions while
  // the declaration is not what the parse says it is. refuseDuplicates() catches it first.
  assert.equal(declared.fields.length, Object.keys(JSON.parse(stampJson)).length,
    `item 7's shipped half declares ${declared.fields.length} fields for the ${Object.keys(JSON.parse(stampJson)).length} the stamp holds — the cut is keeping more than the declared list`);
  // 3, and stated: the count is the point of the card, which found 0 of the 3 declared (all three sat in an
  // aside) while the built package writes, reads and prints them.
  assert.equal(declared.fields.length, 3, `item 7's shipped half declares ${declared.fields.length} stamp fields, not the 3 the built package writes and reads`);
});

test("versioning: a field dropped from item 7's shipped half is NOT declared and the comparison fails naming it; a fourth field the shipped stamp carries fails the other way", async () => {
  const stampJson = shippedStampJson();
  // Plant A of the card, measured invisible to the whole unit suite on 0fefe2d: item 7 stops naming `builtAt`
  // while `npm run build` still writes it, `--version` still prints it and the stale verdict still compares it.
  const dropped = plantInItem("7", "`version`, `commit`, `builtAt`", "`version`, `commit`");
  assert.ok(!declaredShippedStamp(dropped).fields.includes("builtAt"),
    "a field deleted from item 7's shipped list still parses as declared — the cut is keeping text outside the list");
  assert.throws(() => compareStampFields(dropped, stampJson),
    (e) => e.message.includes("builtAt") && e.message.includes("NOT declared in VERSIONING.md item 7's shipped half"),
    "the field the build writes and item 7 no longer declares passed the comparison — internal by the doc's own rule, in the artefact the tarball carries");
  await assert.rejects(() => compareStampReader(dropped, stampJson),
    (e) => e.message.includes("builtAt") && e.message.includes("NOT declared"),
    "the reader authority did not see the dropped field either — then one of the two authorities is doing nothing");
  // Plant B, the card's other invisible one: the shipped stamp carries a FOURTH field, declared nowhere.
  // Planted as the stamp JSON so the repo's own dist/build.json is never touched; the live shape of this plant
  // was verified on the tree first (keys version,commit,builtAt,branch, carried among the tarball's 64 files).
  const fourth = JSON.stringify({ ...JSON.parse(stampJson), branch: "master" });
  assert.throws(() => compareStampFields(DOC, fourth),
    (e) => e.message.includes("branch") && e.message.includes("NOT declared in VERSIONING.md item 7's shipped half"),
    "a fourth field in the stamp the package ships, declared nowhere, passed — covered by nothing, in the file --version and the dashboard read");
  // The reader authority CANNOT see that one — it normalises to its own three fields — and saying so here is
  // why the file authority exists: a case that used the reader alone would have called plant B a pass.
  await assert.doesNotReject(() => compareStampReader(DOC, fourth),
    "the built readBuildStamp() passed a fourth key through — then it is no longer the normalising authority this comparison treats it as, and the file authority above is the only one left");
  // And the mirror: a field this half promises that the shipped stamp does not carry.
  const phantom = plantInItem("7", "`version`, `commit`, `builtAt`", "`version`, `commit`, `builtAt`, `branch`");
  assert.throws(() => compareStampFields(phantom, stampJson),
    (e) => e.message.includes("branch") && e.message.includes("ABSENT from the keys dist/build.json holds"),
    "item 7 promised a stamp field the build never writes and the comparison passed — a consumer reads it and finds undefined");
  await assert.rejects(() => compareStampReader(phantom, stampJson),
    (e) => e.message.includes("branch") && e.message.includes("ABSENT from the keys the built readBuildStamp()"),
    "a field declared that the built reader DROPS passed the reader authority — the direction only it can see");
});

test("versioning: every field item 7's shipped half declares is HONOURED by the built package, and the verdict it declares is the one a moved stamp reports — one fixture per name", async () => {
  const { readBuildStamp, formatBuild, buildStatus } = await import(join(ROOT, "dist/core/build.js"));
  const declared = declaredShippedStamp(DOC);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-honoured-")));
  try {
    const formatted = (stamp) => {
      const path = join(dir, `stamp-${Object.keys(stamp).join("-")}.json`);
      writeFileSync(path, JSON.stringify(stamp));
      const read = readBuildStamp(path);
      assert.ok(read, `the built readBuildStamp() read nothing from ${JSON.stringify(stamp)} — the fixture is stale, so this case is measuring nothing`);
      return formatBuild(read);
    };
    assert.equal(formatted(STAMP_PROBE), STAMP_FORMATTED,
      "the built code does not print the probe stamp as expected — the fixture is stale, so every control below is compared with nothing");
    let checked = 0;
    for (const field of declared.fields) {
      const probe = STAMP_HONOURED.get(field);
      assert.ok(probe,
        `item 7's shipped half declares \`${field}\` as a field of the stamp and no fixture in STAMP_HONOURED drives it — semver would cover it on the strength of the name alone, which is this card's drift the other way round: add the fixture that proves the built package honours it, or stop declaring it`);
      // The control is the same file with THAT key renamed: the built reader then finds the field absent, and
      // the observable says so in its own words. A field the package ignored would read identically.
      const control = { ...STAMP_PROBE };
      control[probe.rename] = control[field];
      delete control[field];
      const out = formatted(control);
      assert.notEqual(out, STAMP_FORMATTED,
        `the built package ignores \`${field}\`: a stamp differing from the fixture in that key ALONE printed the same thing — item 7 declares a field a patch release could drop with nothing going red`);
      assert.ok(out.includes(probe.says),
        `renaming \`${field}\` in the stamp printed ${JSON.stringify(out)}, which does not carry ${JSON.stringify(probe.says)} — the observable changed for some other reason than the field going missing`);
      checked += 1;
    }
    assert.equal(STAMP_HONOURED.size, checked,
      `STAMP_HONOURED carries ${STAMP_HONOURED.size} fixtures for item 7's ${checked} declared stamp fields — a fixture for a field the doc no longer declares is drift of its own`);
    // The verdict is declared in a position of its own because it is NO field of the stamp (the reader
    // normalises to three), and it is honoured the same way: the name a daemon reports a moved stamp under.
    const verdict = declaredStampVerdict(DOC);
    assert.ok(!declared.fields.includes(verdict),
      `item 7's shipped half declares \`${verdict}\` as both a stamp field and the verdict — the fields comparison above would then go red against the three the built reader normalises to`);
    const fresh = buildStatus(STAMP_PROBE, { ...STAMP_PROBE });
    const moved = buildStatus(STAMP_PROBE, { ...STAMP_PROBE, commit: "beefeed" });
    assert.equal(fresh[verdict], false,
      `the built buildStatus() answers ${JSON.stringify(fresh[verdict])} for \`${verdict}\` on a stamp that has not moved — item 7 declares a verdict the running product does not report under that name`);
    assert.equal(moved[verdict], true,
      `the built buildStatus() does not report \`${verdict}\` for a daemon whose on-disk stamp moved under it — the one promise this half makes about behaviour rather than names`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("versioning: item 7's shipped path is IN the tarball and every reporter it declares reports the stamp — the report asserted present, no reply shape frozen", async () => {
  const declared = declaredShippedStamp(DOC);
  const stamp = JSON.parse(shippedStampJson());
  // "the package carries" had no check: smoke step 14 (test/smoke.sh) refuses a src//test//docs/ LEAK and
  // counts nothing, so the declared path being in the pack was asserted nowhere.
  const { stdout } = await execFileP("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, timeout: 120_000 });
  const files = JSON.parse(stdout)[0].files.map((f) => f.path);
  assert.ok(files.length > 10,
    `npm pack --dry-run --json listed ${files.length} files — refusing to judge the declaration against nothing`);
  assert.ok(files.includes(declared.path),
    `item 7's shipped half declares \`${declared.path}\` as the file the package carries and npm pack does not ship it (${files.length} files) — the stamp would be declared on a tree a stranger never receives`);
  const want = Object.fromEntries(declared.fields.map((f) => [f, stamp[f]]));
  for (const name of declared.reporters) {
    const probe = STAMP_REPORTERS.get(name);
    assert.ok(probe,
      `item 7's shipped half declares \`${name}\` as a surface that reports the stamp and no probe here drives it — semver would cover the report on the strength of the name alone: add the probe, or stop declaring it`);
    assert.deepEqual(await probe(declared.fields, stamp), want,
      `\`${name}\` does not report the stamp the package carries — the declaration says it does, and a surface here ceasing to report it is breaking by this half's own rule`);
  }
  assert.equal(STAMP_REPORTERS.size, declared.reporters.length,
    `STAMP_REPORTERS carries ${STAMP_REPORTERS.size} probes for item 7's ${declared.reporters.length} declared reporters — a probe for a surface the doc no longer names is drift of its own`);
});

test("versioning: item 7's shipped half parses its four positions alone — not the writer in its path's aside, not the home half, and nothing backticked after the verdict", () => {
  const declared = declaredShippedStamp(DOC);
  const all = [declared.path, ...declared.fields, ...declared.reporters, declaredStampVerdict(DOC)];
  // The aside beside the path says WHO writes the stamp and that dist ships wholesale; under item 7's own
  // parenthetical rule neither is a declaration — and both were, before this card, the only
  // company the three fields had.
  for (const aside of ["npm run build", "dist"]) {
    assert.ok(!all.includes(aside), `item 7's shipped half read \`${aside}\` out of the aside beside its path as a declaration`);
  }
  // The home half is before all five markers, so no path under the home is read here — the mirror of the
  // home parse's own assertion that no stamp field is read as a home path.
  for (const home of ["web-token", "status.json", "health.json", "health/heartbeat"]) {
    assert.ok(!all.includes(home), `item 7's shipped half read \`${home}\` from the home half as part of the stamp declaration`);
  }
  // A name backticked after the verdict reads as a declaration, so it must fail (item 6's rule, TMUX-126).
  const after = plantInItem("7", "ceasing to report the stamp", "ceasing to report the stamp (`branch` too)");
  assert.throws(() => declaredShippedStamp(after),
    (e) => e.message.includes("branch") && e.message.includes("AFTER its shipped half's last region"),
    "a name backticked after item 7's verdict was ignored — there is nothing a name can mean there except a declaration");
  // And a field MOVED from the list into an aside stops being declared: the exact shape this card is about,
  // since all three fields sat in one before it.
  const moved = plantInItem("7", "`version`, `commit`, `builtAt`.", "`version`, `commit` (and `builtAt`).");
  assert.ok(!declaredShippedStamp(moved).fields.includes("builtAt"),
    "a field moved from item 7's shipped list into a parenthetical still parses as declared — the rule items 4, 5, 5b and 7's home half all pay for has lapsed");
  assert.throws(() => compareStampFields(moved, shippedStampJson()),
    (e) => e.message.includes("builtAt"),
    "a field in an aside still satisfied the comparison — then an aside declares things after all, and this card fixed nothing");
});

test("versioning: item 7's shipped half declares each field once and ONE verdict, and its five markers are rewrap-proof while a reworded one is loud", () => {
  const twice = plantInItem("7", "`version`, `commit`, `builtAt`", "`version`, `commit`, `builtAt`, `version`");
  assert.throws(() => declaredShippedStamp(twice),
    (e) => e.message.includes("version") && e.message.includes("more than once"),
    "item 7's shipped half listed a field twice and the parse accepted it — set equality cannot see a duplicate, so both directions agree while the declaration is not what the parse says it is");
  const twoVerdicts = plantInItem("7", "reports the verdict: `stale`", "reports the verdict: `stale`, `moved`");
  assert.throws(() => declaredStampVerdict(twoVerdicts),
    (e) => e.message.includes("2 names") && e.message.includes("staleness verdict"),
    "item 7's shipped half named two staleness verdicts and the parse took the first — the second would be covered by semver with nothing answering for it");
  // Rewrapping: every marker is matched on normalized text, and the half is shipped across several lines.
  const item = coveredItems(DOC).get("7");
  const flat = flatten(item);
  const oneLine = DOC.replace(item, `${flat}\n`);
  assert.notEqual(oneLine, DOC, "fixture stale: item 7 is no longer written across several lines");
  assert.deepEqual(declaredShippedStamp(oneLine), declaredShippedStamp(DOC),
    "rewrapping item 7 onto one line changed what its shipped half declares — a cut is reading raw lines again");
  assert.equal(declaredStampVerdict(oneLine), declaredStampVerdict(DOC),
    "rewrapping item 7 onto one line changed the verdict it declares");
  // The rewording is done on the FLATTENED item and spliced back, for the two reasons the home half's case
  // gives: a marker spanning a line break has no raw form to replace, and the reader's note at the top of
  // this doc quotes all five — a doc-wide replace would land there, where no parse reads.
  for (const marker of [SHIPPED_PATH_START, SHIPPED_FIELDS_START, SHIPPED_REPORTERS_START, SHIPPED_VERDICT_START, SHIPPED_END]) {
    const mangled = flat.replace(marker, marker.replace(/[A-Za-z]+/, (w) => `${w}ish`));
    assert.notEqual(mangled, flat, `fixture stale: "${marker}" no longer occurs in item 7's normalized text`);
    const planted = DOC.replace(item, `${mangled}\n`);
    assert.throws(() => declaredShippedStamp(planted),
      (e) => /no longer occurs in/.test(e.message) && e.message.includes("item 7"),
      `rewording item 7's "${marker}" marker did not fail loudly in the shipped-half parse — a region would read prose as a declaration`);
  }
});

// ---------------------------------------------------------------------------------------------
// The NOT-covered section — what semver does NOT promise, which every covered item defers to when
// it calls a name internal, and which no test read a byte of. Three lists on three live authorities:
// what the package's exports map refuses a consumer OUTSIDE it, the INTERNAL allowlist beside the
// names in this very file, and the file list of the published tarball. The first parsed text here
// that is not a covered item, and the third card running whose payload sat inside parentheticals —
// 6 of the section's 10 backticked tokens, dropped by the file's own rule.
// ---------------------------------------------------------------------------------------------

/**
 * A plant made inside the NOT-covered section's own text and spliced back — plantInItem's mirror, and
 * needed for the same reason: the reader's note at the top of VERSIONING.md now QUOTES all four
 * of this section's markers, and it comes FIRST in the file, so a doc-wide `DOC.replace(marker, …)` would
 * land there, where no parse reads, and the case would run against an unplanted section while
 * `notEqual(planted, DOC)` saw a change and said nothing.
 */
function plantInSection(from, to) {
  const section = notCoveredSection(DOC).trimEnd();
  assert.ok(DOC.includes(section) && section.includes("\n"), "fixture stale: the NOT-covered section is no longer several lines of the doc verbatim");
  const planted = DOC.replace(section, section.replace(from, to));
  assert.notEqual(planted, DOC, `fixture stale: "${from}" no longer occurs inside the NOT-covered section as written`);
  return planted;
}

/** The comparison the internal-exports list owes, as a function so a case can plant either side. */
const compareInternalExports = (doc, internal) => assertSameSet(declaredNotCovered(doc).exports, internal,
  { declaredAs: "VERSIONING.md's NOT-covered section (the internal root exports)", liveAs: "the INTERNAL allowlist of test/versioning-contract.test.js" });

/**
 * The other direction that list owes: a name excluded here must BE a root export. An exclusion for a name
 * the barrel does not carry is the stale-allowlist drift the item 6 case already refuses for INTERNAL,
 * arriving through the doc instead — and it would read as a pass forever, since nothing would contradict it.
 */
function assertInternalExportsLive(doc, live) {
  const phantom = declaredNotCovered(doc).exports.filter((n) => !live.has(n)).sort();
  assert.deepEqual(phantom, [],
    `VERSIONING.md's NOT-covered section excludes ${phantom.join(", ")} from semver as root exports and the package root exports no such name — the list and the barrel have drifted, and an exclusion for something that does not exist can never fail`);
}

/**
 * Every BUILT module matching a declared module-path pattern, from a walk of dist/ — so each specifier the
 * case tries names a file that exists, and the refusal it asserts is the exports map's rather than the file
 * system's. All of them, not one: a pattern is a promise about its whole extent, and an exports map that
 * opened up `./dist/core/*` alone would satisfy a case that happened to sample dist/adapters/.
 */
function builtMembers(pattern) {
  const star = pattern.indexOf("*");
  assert.ok(star > -1,
    `the NOT-covered section declares \`${pattern}\` as an internal module path with no \`*\` in it — the case cannot derive the members of a pattern it cannot read`);
  const prefix = pattern.slice(0, star);
  const members = distJsFiles().filter((rel) => rel.startsWith(prefix)).sort();
  assert.ok(members.length > 0,
    `no built module under ${prefix} — refusing to judge the exclusion of \`${pattern}\` against a path the tree does not have`);
  return members;
}

/**
 * What a consumer OUTSIDE the package gets for each of `specifiers`: a throwaway directory whose
 * node_modules/tmux-agent IS this tree, so a bare specifier resolves through the package's own exports map
 * — the thing that actually refuses a deep import — rather than through a relative path, which never
 * consults it. Answers `{ exports }` for a resolve and `{ code }` for a refusal, in a child process, so one
 * failing import cannot poison the suite's own module registry.
 */
async function outsideConsumer(specifiers) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-consumer-")));
  try {
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(ROOT, join(dir, "node_modules", "tmux-agent"));
    writeFileSync(join(dir, "probe.mjs"), [
      `const out = {};`,
      `for (const spec of ${JSON.stringify(specifiers)}) {`,
      `  try { const m = await import(spec); out[spec] = { exports: Object.keys(m).filter((k) => k !== "default").length }; }`,
      `  catch (e) { out[spec] = { code: e.code ?? String(e.message).slice(0, 60) }; }`,
      `}`,
      `process.stdout.write(JSON.stringify(out));`,
    ].join("\n"));
    const { stdout } = await execFileP(process.execPath, [join(dir, "probe.mjs")], { cwd: dir, timeout: 60_000 });
    return JSON.parse(stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("versioning: the NOT-covered section's three lists are read alone — not the `/api/*` glob, not the two names item 6 declares, not the allowlist path in an aside", () => {
  const declared = declaredNotCovered(DOC);
  const all = [...declared.paths, ...declared.exports, ...declared.dirs];
  // The prose BEFORE the first marker is where the exclusions no list can answer for stay, and every one of
  // these would break something if read as a declaration: `/api/*` is a glob with no member to resolve that
  // the package's own CLI and MCP surfaces fetch themselves (17 built files mention it), and `SessionState`
  // and `resolveProfiles` are names item 6 DECLARES — on both lists at once, they trip the contradiction
  // rule below on the shipped doc.
  for (const pointer of ["/api/*", "SessionState", "resolveProfiles"]) {
    assert.ok(!all.includes(pointer),
      `the NOT-covered section read \`${pointer}\` out of the prose before its first list as an exclusion — it stands there because no list here can answer for it`);
  }
  // An aside declares nothing: the allowlist this file keeps beside the names, and item 7's
  // shipped half, which declares a file the package CARRIES under the same directory this section excludes
  // imports of. That second one is why the aside is there at all.
  for (const aside of ["test/versioning-contract.test.js", "dist/"]) {
    assert.ok(!all.includes(aside),
      `the NOT-covered section read \`${aside}\` out of a parenthetical as an exclusion — a parenthetical is prose ABOUT what precedes it`);
  }
  // The counts are the point of the card: 4 of the section's 10 tokens survived its own parenthetical rule
  // before this change, and not one of the six that matter was among them.
  assert.deepEqual(declared.paths, ["dist/*"],
    `the NOT-covered section declares ${JSON.stringify(declared.paths)} as its internal module paths, not the built tree's own subpaths`);
  assert.equal(declared.exports.length, 4,
    `the NOT-covered section declares ${declared.exports.length} internal root exports, not the 4 built-in profile objects the package root carries`);
  assert.deepEqual(declared.dirs, ["scratch/"],
    `the NOT-covered section declares ${JSON.stringify(declared.dirs)} as its excluded directories`);
  // A name backticked after the last list reads as an exclusion the suite must answer for (item 6's rule).
  const after = plantInSection("and the reverse is breaking.", "and the reverse is breaking, as is `branch`.");
  assert.throws(() => declaredNotCovered(after),
    (e) => e.message.includes("branch") && e.message.includes("AFTER its last list"),
    "a name backticked after the NOT-covered section's last list was ignored — there is nothing a name can mean there except an exclusion");
});

test("versioning: the NOT-covered section's internal root exports equal the INTERNAL allowlist both ways — each one a live root export, none of them declared in item 6", async () => {
  const declared = declaredNotCovered(DOC).exports;
  const root = await import(join(ROOT, "dist/index.js"));
  const live = new Set(Object.keys(root).filter((k) => k !== "default"));
  assert.ok(live.size > 0, "dist/index.js exports nothing — is the tree built?");
  // The allowlist's comment claimed this section as its authority and read no byte of it; this is the tie.
  compareInternalExports(DOC, [...INTERNAL]);
  assert.equal(declared.length, INTERNAL.size,
    `the section declares ${declared.length} internal root exports for the ${INTERNAL.size} the INTERNAL allowlist records — a name parsed twice satisfies both directions while the declaration is not what the parse says it is`);
  assertInternalExportsLive(DOC, live);
  // A name cannot be both promised and excluded, and the item 6 case refuses exactly this for INTERNAL —
  // which is why the two pointer names above stay in prose rather than in the exports list.
  const contradiction = declared.filter((n) => declaredExports(DOC).includes(n)).sort();
  assert.deepEqual(contradiction, [],
    `${contradiction.join(", ")} is declared in VERSIONING.md item 6 AND excluded by the NOT-covered section — the file promises and disclaims the same name`);
});

test("versioning: an export dropped from the NOT-covered section is NOT excluded and the comparison fails naming it; one excluded that the package root does not export fails the other way", async () => {
  const root = await import(join(ROOT, "dist/index.js"));
  const live = new Set(Object.keys(root).filter((k) => k !== "default"));
  // The card's plant A, measured invisible to the WHOLE unit suite on 6d2faff (381 tests, 380 pass, 1 tree-copy
  // artifact — byte-identical to its control): the section stops naming `aiderProfile` while the export still
  // ships and the INTERNAL allowlist still records the decision to keep it internal.
  const dropped = plantInSection("`codexProfile`, `aiderProfile`,", "`codexProfile`,");
  assert.ok(!declaredNotCovered(dropped).exports.includes("aiderProfile"),
    "an export deleted from the NOT-covered section's list still parses as excluded — the cut is keeping text outside the list");
  assert.throws(() => compareInternalExports(dropped, [...INTERNAL]),
    (e) => e.message.includes("aiderProfile") && e.message.includes("NOT declared in VERSIONING.md's NOT-covered section"),
    "the export the package ships and this file keeps internal left the section's list and the comparison passed — the doc would be silent about a name whose regexes change in patch releases");
  // The mirror: a name excluded here that the allowlist does not record — the decision written in one place
  // and not the other, which is the drift the tie exists to catch in both directions.
  const extra = plantInSection("`codexProfile`, `aiderProfile`,", "`codexProfile`, `aiderProfile`, `paneWidth`,");
  assert.throws(() => compareInternalExports(extra, [...INTERNAL]),
    (e) => e.message.includes("paneWidth") && e.message.includes("ABSENT from the INTERNAL allowlist"),
    "a name excluded by the section with no decision recorded beside it passed — `paneWidth` is the export TMUX-122 caught item 6's prose declaring, and it would now be disclaimed by nothing anyone can see");
  // …and it is no root export either, which is the second direction the doc side owes on its own.
  assert.ok(!live.has("paneWidth"), "fixture stale: `paneWidth` is a live root export now, so it no longer plants a name the barrel does not carry");
  assert.throws(() => assertInternalExportsLive(extra, live),
    (e) => e.message.includes("paneWidth") && e.message.includes("the package root exports no such name"),
    "the section excluded a name the barrel does not export and the live check passed — an exclusion for nothing can never fail");
});

test("versioning: every internal module path the NOT-covered section declares refuses a CONCRETE member from a consumer outside the package — absence ruled out first, the root's own resolve as the control", async () => {
  const declared = declaredNotCovered(DOC).paths;
  let checked = 0;
  for (const pattern of declared) {
    const members = builtMembers(pattern);
    // Absence ruled out FIRST, because the refusal is VACUOUS on its own: measured on 6d2faff, a subpath
    // that does not exist (dist/core/NOPE.js) is refused with the SAME code, so a case that only caught the
    // error would pass on a pattern naming files the tree does not have. The same file loads by file:// URL.
    const direct = await import(pathToFileURL(join(ROOT, members[0])).href);
    assert.ok(Object.keys(direct).length > 0,
      `${members[0]} is a member of \`${pattern}\` and loads by file:// URL exporting nothing — then the refusal below is not evidence about a module`);
    const absent = `tmux-agent/${members[0]}.NOPE.js`;
    const out = await outsideConsumer(["tmux-agent", ...members.map((m) => `tmux-agent/${m}`), absent]);
    assert.ok(out["tmux-agent"].exports > 0,
      `the package ROOT did not resolve for a consumer outside it (${JSON.stringify(out["tmux-agent"])}) — the fixture is broken, so every refusal below measures nothing`);
    const reachable = members.filter((m) => out[`tmux-agent/${m}`].code !== "ERR_PACKAGE_PATH_NOT_EXPORTED");
    assert.deepEqual(reachable, [],
      `the NOT-covered section calls \`${pattern}\` internal and a consumer outside the package reached ${reachable.length} of its ${members.length} members: ${reachable.join(", ")} — a deep import the doc disclaims is resolvable, so semver covers it by the file's own rule ("anything not listed here is internal" cuts both ways)`);
    assert.equal(out[absent].code, "ERR_PACKAGE_PATH_NOT_EXPORTED",
      `a subpath that does not exist was refused ${JSON.stringify(out[absent].code)} rather than the same code as the ${members.length} that do — recorded here because it is WHY the file:// load above must rule absence out, and a change in that answer would make this case's evidence something else`);
    checked += 1;
  }
  assert.equal(checked, declared.length,
    `${checked} of the ${declared.length} declared module-path patterns were driven — a pattern the section declares with nothing trying it is covered by semver on the strength of its name`);
});

/** The file list `npm pack --dry-run --json` would ship from `dir` — the published tarball, without publishing. */
async function packList(dir) {
  const { stdout } = await execFileP("npm", ["pack", "--dry-run", "--json"], { cwd: dir, timeout: 120_000 });
  const files = JSON.parse(stdout)[0].files.map((f) => f.path);
  assert.ok(files.length > 0, `npm pack --dry-run --json listed no files in ${dir} — refusing to judge a declaration against nothing`);
  return files;
}

/**
 * A throwaway package carrying THIS manifest and holding a file under each of `probes`, so the exclusion is
 * judged with something real to exclude. Measured while writing this card: `scratch/` is gitignored, so a
 * fresh clone — which is what CI packs — has no such directory at all, and a guard that read the working tree
 * for one FAILED on a tree copy and would have failed in CI, while its passing case would have proved only
 * that there was nothing to find. `alsoInFiles` widens the manifest's `files` list: the control that proves
 * this fixture can SEE a carried file, without which the exclusion below can never fail.
 */
async function packWithProbes(probes, alsoInFiles = null) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-pack-")));
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    if (alsoInFiles) pkg.files = [...pkg.files, alsoInFiles];
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    for (const rel of probes) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      writeFileSync(join(dir, rel), "a working note, which the published package does not carry\n");
    }
    return await packList(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("versioning: nothing under a directory the NOT-covered section excludes is carried by the package — one probe file per declared directory, with a control that proves the check can see one", async () => {
  const dirs = declaredNotCovered(DOC).dirs;
  const probe = (dir) => `${dir}TMUX-139-probe.md`;
  // (1) This repo's own tarball. smoke step 14 refuses a src//test//docs/ LEAK and counts nothing, so a
  // `files` list that gained one of these directories was seen by nothing before this case.
  const shipped = await packList(ROOT);
  assert.ok(shipped.length > 10,
    `npm pack --dry-run --json listed ${shipped.length} files for this tree — refusing to judge the section's exclusions against nothing`);
  for (const dir of dirs) {
    const leaked = shipped.filter((f) => f.startsWith(dir));
    assert.deepEqual(leaked, [],
      `npm pack ships ${leaked.length} file(s) under \`${dir}\`, which the NOT-covered section says the package does not carry: ${leaked.slice(0, 5).join(", ")}`);
  }
  // (2) One probe file per declared directory, so "not carried" is measured against something that exists —
  // `scratch/` is gitignored and absent from a fresh clone, where (1) alone would pass for want of anything
  // to find. "Nothing to check" is not a pass.
  const withProbes = await packWithProbes(dirs.map(probe));
  let checked = 0;
  for (const dir of dirs) {
    assert.ok(!withProbes.includes(probe(dir)),
      `a file created under \`${dir}\` is carried by the package (${withProbes.length} files) — the NOT-covered section says anything there may change any time, so a consumer must never receive it`);
    checked += 1;
  }
  assert.equal(checked, dirs.length,
    `${checked} of the ${dirs.length} excluded directories were driven — a directory the section excludes with nothing tried under it is an exclusion on the strength of its name`);
  // (3) The control: the same fixture with the first declared directory added to the manifest's `files` MUST
  // carry its probe. Without it, (2) would pass on a fixture npm could not see into either.
  const first = dirs[0];
  const control = await packWithProbes(dirs.map(probe), first.replace(/\/+$/, ""));
  assert.ok(control.includes(probe(first)),
    `the control put ${first.replace(/\/+$/, "")} in the manifest's \`files\` list and npm pack still did not carry ${probe(first)} (${control.length} files) — then the exclusions above passed because this check cannot see a carried file at all`);
});

test("versioning: the NOT-covered section declares each name once per list, a name MOVED into a parenthetical stops being declared, and its four markers are rewrap-proof while a reworded one is loud", () => {
  const twice = plantInSection("`codexProfile`, `aiderProfile`,", "`codexProfile`, `aiderProfile`, `codexProfile`,");
  assert.throws(() => declaredNotCovered(twice),
    (e) => e.message.includes("codexProfile") && e.message.includes("more than once"),
    "the section listed an export twice and the parse accepted it — set equality cannot see a duplicate, so both directions agree while the declaration is not what the parse says it is");
  // The shape this card is about: a name moved out of a list into an aside stops being declared. Before this
  // change the WHOLE section looked like that — 6 of its 10 backticked tokens sat inside parentheticals, the
  // four built-in profile objects among them.
  const moved = plantInSection("`codexProfile`, `aiderProfile`,", "`codexProfile` (and `aiderProfile`),");
  assert.ok(!declaredNotCovered(moved).exports.includes("aiderProfile"),
    "an export moved from the section's list into a parenthetical still parses as excluded — the rule items 4, 5, 5b and 7 all pay for has lapsed");
  assert.throws(() => compareInternalExports(moved, [...INTERNAL]),
    (e) => e.message.includes("aiderProfile"),
    "a name in an aside still satisfied the comparison — then an aside declares things after all, and this card fixed nothing");
  // Rewrapping: every marker is matched on normalized text, and the section is shipped across many lines.
  const section = notCoveredSection(DOC);
  const flat = flatten(section);
  const oneLine = DOC.replace(section, `${flat}\n`);
  assert.notEqual(oneLine, DOC, "fixture stale: the NOT-covered section is no longer written across several lines");
  assert.deepEqual(declaredNotCovered(oneLine), declaredNotCovered(DOC),
    "rewrapping the NOT-covered section onto one line changed what it declares — a cut is reading raw lines again");
  // The rewording is done on the FLATTENED section and spliced back, for the two reasons item 7's case gives:
  // a marker spanning a line break has no raw form to replace, and the reader's note at the top of the doc
  // quotes all four — a doc-wide replace would land there, where no parse reads.
  for (const marker of [NOT_PATHS_START, NOT_EXPORTS_START, NOT_DIRS_START, NOT_END]) {
    const mangled = flat.replace(marker, marker.replace(/[A-Za-z]+/, (w) => `${w}ish`));
    assert.notEqual(mangled, flat, `fixture stale: "${marker}" no longer occurs in the NOT-covered section's normalized text`);
    const planted = DOC.replace(section, `${mangled}\n`);
    assert.throws(() => declaredNotCovered(planted),
      (e) => /no longer occurs in/.test(e.message) && e.message.includes("NOT-covered"),
      `rewording the section's "${marker}" marker did not fail loudly — a list would read prose as an exclusion`);
  }
});

// ---------------------------------------------------------------------------------------------
// Item 9 — the environment surface: the two declared lists ≡ every `process.env.<NAME>` the built
// package reads, and each declared name HONOURED by the built code. The first item about how the tool
// is CONFIGURED rather than what it emits, and the one this file had no item for at all: 11 variables
// read across 9 modules, 6 of them named in no user-facing doc, none of them declared.
// ---------------------------------------------------------------------------------------------

/**
 * The environment the BUILT package reads: every `process.env.<NAME>` in comment-stripped dist/**\/*.js.
 * The strip is the whole authority question. Measured on 4a11d0b
 * (scratch/ga-fire-2026-09-20-20Z/authority-counts.log): dist mentions `TMUX_AGENT_*` names 68 times and
 * READS 25, the difference being comments, printed strings (`adapters/notify/slack.js` carries "no
 * TMUX_AGENT_SLACK_WEBHOOK" as a reason) and prose — so a mention-based live side can be satisfied by a
 * comment that quotes this doc, which is not a configuration surface at all.
 *
 * The count assert is what keeps the authority WHOLE: every `process.env` use must be the `.<NAME>` form
 * this reads, so `process.env["X"]` or a destructure — a read this regex cannot see — is loud instead of
 * silently absent from the live side. Takes the JS as TEXT so a case can plant a read, in code or in a
 * comment, without touching dist/ (item 8's and item 5's live sides do the same).
 */
function readEnvNames(js) {
  const code = stripComments(js);
  const names = [...code.matchAll(/process\.env\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const uses = (code.match(/process\.env/g) ?? []).length;
  assert.equal(names.length, uses,
    `dist/**/*.js makes ${uses} \`process.env\` uses and only ${names.length} of them are the \`process.env.<NAME>\` form this parse reads — a bracket read or a destructured one is a configuration surface item 9 would be compared against without it`);
  assert.ok(names.length > 0,
    "no `process.env.<NAME>` read occurs in dist/**/*.js at all — refusing to judge item 9 against nothing");
  return [...new Set(names)];
}

/** The comparison item 9 owes, as a function, so a case can run it over a planted doc or planted JS. */
const compareEnvVars = (doc, js) => {
  const declared = declaredEnvVars(doc);
  assertSameSet([...declared.covered, ...declared.notCovered], readEnvNames(js),
    { declaredAs: "VERSIONING.md item 9 (the environment variables, both lists)", liveAs: "the process.env.<NAME> reads of dist/**/*.js" });
  return declared;
};

test("versioning: item 9's declared environment variables equal the ones the built package reads, both directions — and every process.env use is the form this parse reads", () => {
  const declared = compareEnvVars(DOC, builtJs());
  const live = readEnvNames(builtJs());
  // Counts too, the second lock every parsed item carries: a name parsed twice satisfies both directions
  // while the declaration is not what the parse says it is. refuseDuplicates() catches it first,
  // and here it runs per list AND across the two, since a name in both is covered and not covered at once.
  assert.equal(declared.covered.length + declared.notCovered.length, live.length,
    `item 9 parses ${declared.covered.length + declared.notCovered.length} variables for the ${live.length} the built package reads — a cut is keeping more than the declared lists`);
  // Stated: 11 was the gap TMUX-142 was filed about (11 read, 0 declared); 13 since TMUX-203 added the dashboard's
  // two access-note knobs (TMUX_AGENT_PUBLIC_HINT / TMUX_AGENT_PUBLIC_URL), both declared in item 9 and both driven below.
  assert.equal(live.length, 13, `the built package reads ${live.length} environment variables, not the 13 item 9 was written for — declare the new one or record why it is not covered`);
  // The split is an author's judgement, so both halves must actually carry names: an empty one would let
  // every name drift to the other side unnoticed. nonEmpty() has already refused it per list; this says why.
  assert.ok(declared.covered.length > 0 && declared.notCovered.length > 0,
    "one of item 9's two lists is empty — the covered/not-covered split is then not a judgement the doc records, and every read name would be promised or none");
});

test("versioning: a variable the built package reads that item 9 does not declare fails, naming it — a comment that merely names one does not", () => {
  // The card's plant A, measured INVISIBLE to the whole unit suite on 4a11d0b: the built watchdog grows a
  // read of a name NO doc anywhere carries. It is the direction that matters most — an operator cannot set
  // what they cannot read about, and by this file's own rule the name is internal while the code obeys it.
  const planted = `${builtJs()}\nfunction traceEnv() { return Number(process.env.TMUX_AGENT_TRACE_MS ?? 0); }\n`;
  assert.ok(readEnvNames(planted).includes("TMUX_AGENT_TRACE_MS"),
    "the plant does not read as read, so this case would be measuring the extraction rather than the contract");
  assert.throws(() => compareEnvVars(DOC, planted),
    (e) => e.message.includes("TMUX_AGENT_TRACE_MS") && e.message.includes("NOT declared in VERSIONING.md item 9"),
    "a variable the built package reads with nothing declaring it passed — the failure must name the DOC, not diff a fixture literal, or an author fixes the test instead of the declaration");
  // And the other half of the same rule (item 8's, TMUX-132): a name a comment names is not read. Without
  // this, a sentence about a variable we may add one day would fail the contract.
  const mentioned = `${builtJs()}\n// one day, maybe: process.env.TMUX_AGENT_TRACE_MS — read nowhere yet\n`;
  assert.ok(!readEnvNames(mentioned).includes("TMUX_AGENT_TRACE_MS"),
    "a name a dist comment merely quotes counts as read — then prose about the future fails the contract, and the comparison above judges comments");
});

test("versioning: a variable dropped from item 9's covered list is NOT declared and the comparison fails naming it; one declared that nothing reads fails the other way", () => {
  // The card's plant B at the address the declaration now lives: item 9 stops naming the rotation bound
  // while dist/core/orchestrator.js still reads it. On the parent tree the same drift was planted in item 7's
  // ASIDE, where TMUX-133's rule says a name declares nothing — which is exactly why it was invisible there.
  const dropped = plantInItem("9", "and `TMUX_AGENT_LOG_MAX_BYTES` (the size", "and the log rotation size (the size");
  assert.ok(!declaredEnvVars(dropped).covered.includes("TMUX_AGENT_LOG_MAX_BYTES"),
    "a variable deleted from item 9's covered list still parses as declared — the cut is keeping text that names it");
  assert.throws(() => compareEnvVars(dropped, builtJs()),
    (e) => e.message.includes("TMUX_AGENT_LOG_MAX_BYTES") && e.message.includes("NOT declared in VERSIONING.md item 9"),
    "the variable the built orchestrator rotates a capture log by left the declaration and the comparison passed — an operator's unit file sets it under no promise at all");
  // The card's plant C, likewise re-addressed: fiction the other way round — a name the doc promises that the
  // package never reads. An operator sets it, nothing happens, and semver covers the name.
  const phantom = plantInItem("9", "are: `TMUX_AGENT_HOME` (the home", "are: `TMUX_AGENT_COLOR` (turns colour off), `TMUX_AGENT_HOME` (the home");
  assert.throws(() => compareEnvVars(phantom, builtJs()),
    (e) => e.message.includes("TMUX_AGENT_COLOR") && e.message.includes("ABSENT from the process.env.<NAME> reads"),
    "item 9 promised a variable the built package never reads and the comparison passed");
});

test("versioning: item 9 declares every variable in exactly one list — a name in BOTH is refused, a name in NEITHER fails the comparison", () => {
  // The split is the one judgement in this item, so it has to be visible AND complete. Both is the failure
  // set equality cannot see: the union carries the name either way, so both directions agree while the doc
  // says a variable is covered and not covered at once.
  const both = plantInItem("9", "cover are: `TMUX_AGENT_HEALTH_TICK_MS`", "cover are: `TMUX_AGENT_POLICY`, `TMUX_AGENT_HEALTH_TICK_MS`");
  assert.throws(() => declaredEnvVars(both),
    (e) => e.message.includes("TMUX_AGENT_POLICY") && e.message.includes("BOTH covered and not covered"),
    "item 9 listed a variable as covered AND not covered and the parse accepted it — the comparison below would pass on the union, so the contradiction would ship");
  // Neither: the name leaves the covered list for the prose after the last list, where item 6's rule
  // says there is nothing a name can mean except a declaration — so that fails FIRST, loudly,
  // instead of the variable quietly becoming internal.
  const moved = plantInItem("9", "New variables are additive (minor).",
    "New variables are additive (minor). `TMUX_AGENT_POLICY` is read but internal.");
  assert.throws(() => declaredEnvVars(moved),
    (e) => e.message.includes("TMUX_AGENT_POLICY") && e.message.includes("prose AFTER its last list"),
    "a variable moved out of item 9's lists into the prose after them was ignored — the split is then not complete, and a read name can leave the declaration by being reworded around");
});

test("versioning: item 9's parse reads its two lists alone — not the meaning in an aside, not the prose after, and the `$` sigil names the same variable", () => {
  const declared = declaredEnvVars(DOC);
  const all = [...declared.covered, ...declared.notCovered];
  // Every parenthetical dropped: each name carries its meaning beside it, and the meanings name
  // flags, paths and defaults. A lapse of the rule would declare `--socket` and `~/.tmux-agent` as variables.
  for (const aside of ["--socket", "--actor", "--lexicon", "--default-server", "~/.tmux-agent", "cli", "1"]) {
    assert.ok(!all.includes(aside), `item 9's parse read \`${aside}\` from an aside as a declared variable`);
  }
  // The shape filter is what makes those asides safe to write at all: a value or a flag is not SHOUTY_SNAKE.
  assert.deepEqual(envTicks("`--socket`, `1`, `~/.tmux-agent`, `MiB`, `TMUX_AGENT_HOME`"), ["TMUX_AGENT_HOME"],
    "envTicks() no longer keeps values and flags out of the declaration — item 9's asides would then declare variables the package never reads");
  // Item 7 writes the same variable as `$TMUX_AGENT_HOME`, the only name in this file written that way, so a
  // copy of that style into item 9 must declare the SAME name rather than a second one nothing reads.
  const sigil = plantInItem("9", "are: `TMUX_AGENT_HOME` (the home", "are: `$TMUX_AGENT_HOME` (the home");
  assert.deepEqual(declaredEnvVars(sigil), declared,
    "item 9 written with item 7's `$` sigil declared something other than the same variable — the comparison would then report the name both undeclared and phantom");
  // And the mentions in OTHER items declare nothing: item 1 backticks three of these as flag fallbacks and
  // item 7 two more, one of them inside a parenthetical. The cut is scoped to item 9 for that reason.
  const outside = coveredItems(DOC);
  assert.ok(envTicks(outside.get("1") ?? "").length > 0 && envTicks(outside.get("7") ?? "").length > 0,
    "fixture stale: items 1 and 7 no longer backtick any environment variable — the reason item 9's parse is scoped to its own item has moved, so re-read declaredEnvVars() before changing this");
});

test("versioning: item 9 declares each variable once per list, and its three markers are rewrap-proof while a reworded one is loud", () => {
  const twice = plantInItem("9", "set), `TMUX_AGENT_SOCKET` (the `-L` server name every verb drives — `--socket`'s fallback),",
    "set), `TMUX_AGENT_SOCKET` (the `-L` server name every verb drives — `--socket`'s fallback), `TMUX_AGENT_SOCKET`,");
  assert.throws(() => declaredEnvVars(twice),
    (e) => e.message.includes("TMUX_AGENT_SOCKET") && e.message.includes("more than once"),
    "item 9 listed a variable twice and the parse accepted it — set equality cannot see a duplicate, so both directions agree while the declaration is not what the parse says it is");
  // Rewrapping: every marker is matched on normalized text, and item 9 is shipped across many lines with two
  // of its three markers already spanning one.
  // trimEnd() because item 9 is the LAST covered item: coveredItems() keeps the blank line before the
  // NOT-covered heading, so the raw text carries one newline the doc does not (plantInItem's reason too).
  const item = (coveredItems(DOC).get("9") ?? "").trimEnd();
  const flat = flatten(item);
  const oneLine = DOC.replace(item, `${flat}\n`);
  assert.ok(DOC.includes(item) && item.includes("\n"), "fixture stale: item 9 is no longer several lines of the doc verbatim");
  assert.notEqual(oneLine, DOC, "fixture stale: item 9 is no longer written across several lines");
  assert.deepEqual(declaredEnvVars(oneLine), declaredEnvVars(DOC),
    "rewrapping item 9 onto one line changed what it declares — a cut is reading raw lines again");
  // The rewording is done on the FLATTENED item and spliced back, for the two reasons item 7's case gives: a
  // marker spanning a line break has no raw form to replace, and the reader's note at the top of this doc
  // quotes all three — a doc-wide replace would land there, where no parse reads (the trap plantInItem exists for).
  for (const marker of [ENV_COVERED_START, ENV_UNCOVERED_START, ENV_END]) {
    const mangled = flat.replace(marker, marker.replace(/[A-Za-z]+/, (w) => `${w}ish`));
    assert.notEqual(mangled, flat, `fixture stale: "${marker}" no longer occurs in item 9's normalized text`);
    assert.throws(() => declaredEnvVars(DOC.replace(item, `${mangled}\n`)),
      (e) => /no longer occurs in/.test(e.message) && e.message.includes("item 9"),
      `rewording item 9's "${marker}" marker did not fail loudly — the parse would read prose as a declaration, or read one of the two lists as empty`);
  }
});

/**
 * Set `patch` in THIS process's environment for the drive, then put it back exactly as it was — the
 * variables below are read in a constructor, not at import time, so an in-process drive can measure them.
 * A leak would be worse than a slow case: the next fixture would inherit it and read as honoured.
 */
async function withEnv(patch, fn) {
  const saved = Object.keys(patch).map((k) => [k, process.env[k]]);
  const apply = (pairs) => { for (const [k, v] of pairs) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  apply(Object.entries(patch));
  try {
    return await fn();
  } finally {
    apply(saved);
  }
}

/** A ledger that only collects, so a drive is judged by what the built code FILED without writing a home. */
const collectLedger = () => {
  const events = [];
  return { events, emit(e) { events.push(e); } };
};

/**
 * The environment a CHILD gets: this process's, less every `TMUX_AGENT_*` name, plus the fixture. Scrubbing
 * first is what makes the fixture the only variable in play — and `TMUX_AGENT_HOME` is always given, so no
 * drive here can touch the operator's real home.
 */
function cleanEnv(patch) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("TMUX_AGENT_")) delete env[k];
  return { ...env, ...patch };
}

/** `doctor`'s own reply from the built CLI: the surface that reports the home and the lexicon it resolved. */
async function doctorReply(dir, env) {
  const { stdout } = await execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), "doctor"],
    { cwd: dir, env: cleanEnv(env), timeout: 25_000, killSignal: "SIGKILL" });
  return JSON.parse(stdout);
}

/** One watchdog drive with `opts` EMPTY, so the environment is what is measured (item 9's read is a `??`). */
async function watchdogStall(env) {
  const { CaptureWatchdog } = await import(join(ROOT, "dist/index.js"));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-wd-")));
  try {
    mkdirSync(join(home, "logs"), { recursive: true });
    // The stall the watchdog exists for: the pane advances while this log stays exactly this size.
    writeFileSync(join(home, "logs", "envprobe.log"), "static\n");
    const ledger = collectLedger();
    const reArmed = [];
    const wd = await withEnv(env, () => new CaptureWatchdog(home, ledger, (s) => { reArmed.push(s); }, {}));
    for (const tail of ["frame one", "frame two", "frame three"]) await wd.observe("envprobe", tail);
    const stalled = ledger.events.filter((e) => e.type === "capture.stalled");
    return { stalled: stalled.length, exhausted: stalled[0]?.data?.exhausted ?? null, reArmed: reArmed.length };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** How many health snapshots the built daemon wrote in one window — the tick's own observable, in words. */
async function snapshotCadence(ms) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-tick-")));
  const { child } = await startWeb(ROOT, home, { TMUX_AGENT_HEALTH_TICK_MS: ms }, ["--no-token"]);
  try {
    await new Promise((r) => setTimeout(r, 2600));
    const file = join(home, "health", "snapshots.ndjson");
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).length;
    assert.ok(lines > 0, `the daemon wrote no health snapshot at all under a ${ms} ms tick — refusing to judge the cadence against nothing`);
    return lines > 1 ? "several snapshots" : "one snapshot";
  } finally {
    // killing is a signal, not a state: the child's exit is awaited before its home goes.
    child.kill("SIGTERM");
    await once(child, "exit");
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * What the built daemon's page says about reaching it — the access note's own words: the hint when
 * TMUX_AGENT_PUBLIC_HINT is set, "served at <url>" when TMUX_AGENT_PUBLIC_URL is, the `ssh -L` tunnel otherwise.
 * The CLI treats "" as unset, so a control differing in that variable ALONE sets it to "".
 */
async function accessNoteOf(env) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-note-")));
  const { child, port } = await startWeb(ROOT, home, env, ["--no-token"]);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "text/html" } });
    assert.equal(res.status, 200, `the built daemon did not serve its page (${res.status}) — refusing to judge the note against nothing`);
    const html = await res.text();
    const tunnel = html.includes("ssh -L");
    if (html.includes("versioning probe: served through a harness")) return tunnel ? "the hint AND a tunnel" : "the hint, no tunnel";
    const served = /This UI is served at <b>([^<]+)<\/b>/.exec(html);
    if (served) return `served at ${served[1]}${tunnel ? ", and a tunnel" : ", no tunnel"}`;
    return tunnel ? "tunnel" : "neither";
  } finally {
    await stopWeb(child); // the child's exit is awaited before its home goes
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * ONE real fleet, driven once, answering for the four variables a CLI run is the only witness to: the actor
 * the ledger records, the socket the verb drives, the default server it drives instead, and the size a
 * capture log is rotated at. Four spawns and three `lineage` reads on a throwaway socket and home — the
 * recipe shippedSessionRecord() (test/helpers/status-record.js) uses, so the operator's fleet is never touched — and the pairs it
 * returns differ in ONE variable each: two spawns with different actors, two with different rotation sizes,
 * and the same fleet read on the named socket, on an absent one, and with the default server asked for.
 * Measured before the case was written: scratch/ga-fire-2026-09-20-20Z/drive-probe.log.
 */
let envDriven;
function drivenEnvObservations() {
  envDriven ??= (async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-")));
    const home = join(dir, "home");
    const sock = `ta-versioning-env-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
    const absent = `${sock}-absent`;
    const cli = (args, env) => execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), ...args],
      { cwd: ROOT, env: cleanEnv({ TMUX_AGENT_HOME: home, ...env }), timeout: 25_000, killSignal: "SIGKILL" });
    const ledgered = () => readdirSync(join(home, "ledger")).filter((f) => f.endsWith(".ndjson"))
      .flatMap((f) => readFileSync(join(home, "ledger", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    const listed = async (env) => (await cli(["lineage"], env)).stdout.split("\n").filter(Boolean).map((l) => l.split("\t")[0]);
    try {
      for (const s of [sock, absent]) assert.ok(serverAbsent(s), `the throwaway socket ${s} already has a tmux server`);
      const one = `envactor-${process.pid}`, two = `envother-${process.pid}`;
      const rot = `envrot-${process.pid}`, kept = `envkept-${process.pid}`;
      mkdirSync(join(home, "logs"), { recursive: true });
      // A log already over the planted bound, so the rotation is decided by the variable and nothing else.
      for (const n of [rot, kept]) writeFileSync(join(home, "logs", `${n}.log`), "x".repeat(4096));
      await cli(["spawn", one, "--cwd", dir], { TMUX_AGENT_SOCKET: sock, TMUX_AGENT_ACTOR: "envactorone" });
      await cli(["spawn", two, "--cwd", dir], { TMUX_AGENT_SOCKET: sock, TMUX_AGENT_ACTOR: "envactortwo" });
      await cli(["spawn", rot, "--cwd", dir], { TMUX_AGENT_SOCKET: sock, TMUX_AGENT_LOG_MAX_BYTES: "1024" });
      await cli(["spawn", kept, "--cwd", dir], { TMUX_AGENT_SOCKET: sock, TMUX_AGENT_LOG_MAX_BYTES: "10485760" });
      const events = ledgered();
      const spawnActors = (n) => events.filter((e) => e.type === "session.spawned" && e.session === n).map((e) => e.actor);
      const rotation = (n) => ({
        rotated: events.filter((e) => e.type === "capture.rotated" && e.session === n).length,
        generations: readdirSync(join(home, "logs")).filter((f) => f.startsWith(`${n}.log`)).length,
      });
      const onSocket = await listed({ TMUX_AGENT_SOCKET: sock });
      const onAbsent = await listed({ TMUX_AGENT_SOCKET: absent });
      const onDefault = await listed({ TMUX_AGENT_SOCKET: sock, TMUX_AGENT_DEFAULT_SERVER: "1" });
      assert.ok(onSocket.includes(one) && onSocket.length >= 4,
        `the built CLI listed ${onSocket.length} sessions on the socket it had just spawned four onto (${onSocket.join(",") || "none"}) — refusing to judge item 9's socket against nothing`);
      return {
        actor: { fixture: spawnActors(one), control: spawnActors(two) },
        logMaxBytes: { fixture: rotation(rot), control: rotation(kept) },
        socket: { fixture: onSocket.includes(one), control: onAbsent.includes(one) },
        // The default server is asked for by VALUE (`1`), so the fixture is the run that stops seeing the
        // session on the socket its own environment still names — the one observable that needs no server
        // of its own to exist, on this host or in CI.
        defaultServer: { fixture: { ourSessionListed: onDefault.includes(one) }, control: { ourSessionListed: onSocket.includes(one) } },
      };
    } finally {
      killServerSync(sock);
      await untilServerAbsent(sock);
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return envDriven;
}

/**
 * One entry per declared variable: the fixture that sets it, the CONTROL differing in that variable ALONE,
 * and the observable both are read through. "Declared" has to mean "honoured" rather than "mentioned" (the
 * TMUX-135 rule, whose fixtures are HONOURED above) — otherwise a name written into item 9 that the package
 * ignores is covered by semver on the strength of its name, which is this card's drift the other way round.
 *
 * Grouped by what the drive costs, so a failure names a group and the slow ones are visible: `inProcess`
 * builds the covered export and reads its verdict, `doctor` runs the built CLI's own report, `fleet` shares
 * ONE real tmux drive, `daemon` starts the dashboard. Two of the eleven had no fixture anywhere in test/
 * before this card (the watchdog knobs, mentioned only in src/) and two more were mentioned but never set.
 */
const ENV_HONOURED = new Map([
  ["TMUX_AGENT_POLICY", { group: "inProcess", want: true, observe: async () => {
    const { Policy } = await import(join(ROOT, "dist/index.js"));
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-policy-")));
    try {
      const at = (name, cfg) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(cfg)); return p; };
      const readOnly = at("readonly.json", { readOnly: true });
      const open = at("open.json", { readOnly: false });
      const verdict = (p) => withEnv({ TMUX_AGENT_POLICY: p }, () => new Policy(undefined, "cli").isReadOnly());
      return { fixture: await verdict(readOnly), control: await verdict(open) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } }],
  // The sink's own reason is the observable the card names: with the variable unset it is the no-URL wording;
  // with it set the sink POSTs to the URL the variable named (port 1 — undici's bad-port list refuses it before
  // any connection is tried, so no egress) and, since TMUX-157 made every failed send say why, its reason names
  // the failed fetch instead. Read up to the cause parenthesis, so the fixture holds the sink's own words and not
  // undici's wording of the cause.
  ["TMUX_AGENT_SLACK_WEBHOOK", { group: "inProcess", want: "TypeError: fetch failed", observe: async () => {
    const { SlackWebhookSink } = await import(join(ROOT, "dist/index.js"));
    const reason = (url) => withEnv({ TMUX_AGENT_SLACK_WEBHOOK: url }, async () => {
      const ledger = collectLedger();
      await new SlackWebhookSink(ledger).notify("env probe", "body");
      assert.equal(ledger.events.length, 1, "the built Slack sink filed no notify.sent event — the reason below would be read off nothing");
      const r = ledger.events[0].data?.reason;
      assert.equal(typeof r, "string", `the built Slack sink filed a notify.sent row with no reason: ${JSON.stringify(ledger.events[0].data)}`);
      return r.replace(/ \(.*$/, "");
    });
    return { fixture: await reason("http://127.0.0.1:1/env-probe"), control: await reason(undefined) };
  } }],
  ["TMUX_AGENT_WATCHDOG_GRACE_MS", { group: "inProcess", want: { stalled: 1 }, observe: async () => ({
    // 0 ms of grace: the same three observations that are a stall become one. 600 s: the log is static
    // inside the grace window, so nothing is filed — the knob is the whole difference.
    fixture: { stalled: (await watchdogStall({ TMUX_AGENT_WATCHDOG_GRACE_MS: "0" })).stalled },
    control: { stalled: (await watchdogStall({ TMUX_AGENT_WATCHDOG_GRACE_MS: "600000" })).stalled },
  }) }],
  ["TMUX_AGENT_WATCHDOG_MAX_REARMS", { group: "inProcess", want: { exhausted: true, reArmed: 0 }, observe: async () => {
    const read = async (rearms) => {
      const { exhausted, reArmed } = await watchdogStall({ TMUX_AGENT_WATCHDOG_GRACE_MS: "0", TMUX_AGENT_WATCHDOG_MAX_REARMS: rearms });
      return { exhausted, reArmed };
    };
    // A budget of 0 gives up on the first stall and re-arms nothing; 3 re-arms once and says so.
    return { fixture: await read("0"), control: await read("3") };
  } }],
  ["TMUX_AGENT_HOME", { group: "doctor", want: true, observe: async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-home-")));
    try {
      const named = join(dir, "home-named");
      const other = join(dir, "home-other");
      const reportsNamed = async (home) => (await doctorReply(dir, { TMUX_AGENT_HOME: home })).home === named;
      return { fixture: await reportsNamed(named), control: await reportsNamed(other) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } }],
  ["TMUX_AGENT_LEXICON", { group: "doctor", want: { path: true, first: "envprobeagent" }, observe: async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ta-versioning-env-lexicon-")));
    try {
      const at = (name, cfg) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(cfg)); return p; };
      const named = at("named.json", { version: 1, profiles: [{ name: "envprobeagent", idle: ["ENV-IDLE"] }] });
      const empty = at("empty.json", { version: 1 });
      const read = async (lexicon) => {
        const d = await doctorReply(dir, { TMUX_AGENT_HOME: join(dir, "home"), TMUX_AGENT_LEXICON: lexicon });
        return { path: d.lexicon.path === lexicon, first: d.profiles.order[0] };
      };
      return { fixture: await read(named), control: await read(empty) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } }],
  ["TMUX_AGENT_ACTOR", { group: "fleet", want: ["envactorone"], observe: async () => (await drivenEnvObservations()).actor }],
  ["TMUX_AGENT_SOCKET", { group: "fleet", want: true, observe: async () => (await drivenEnvObservations()).socket }],
  ["TMUX_AGENT_DEFAULT_SERVER", { group: "fleet", want: { ourSessionListed: false }, observe: async () => (await drivenEnvObservations()).defaultServer }],
  ["TMUX_AGENT_LOG_MAX_BYTES", { group: "fleet", want: { rotated: 1, generations: 2 }, observe: async () => (await drivenEnvObservations()).logMaxBytes }],
  ["TMUX_AGENT_HEALTH_TICK_MS", { group: "daemon", want: "several snapshots", observe: async () => ({
    fixture: await snapshotCadence("1000"), control: await snapshotCadence("60000"),
  }) }],
  // TMUX-203: the dashboard's two access-note knobs; each control differs in that variable alone, set to "" (unset).
  ["TMUX_AGENT_PUBLIC_HINT", { group: "daemon", want: "the hint, no tunnel", observe: async () => ({
    fixture: await accessNoteOf({ TMUX_AGENT_PUBLIC_HINT: "versioning probe: served through a harness" }),
    control: await accessNoteOf({ TMUX_AGENT_PUBLIC_HINT: "" }),
  }) }],
  ["TMUX_AGENT_PUBLIC_URL", { group: "daemon", want: "served at http://versioning.probe/ui/, no tunnel", observe: async () => ({
    fixture: await accessNoteOf({ TMUX_AGENT_PUBLIC_URL: "http://versioning.probe/ui/" }),
    control: await accessNoteOf({ TMUX_AGENT_PUBLIC_URL: "" }),
  }) }],
]);

/** Every fixture of one group, each against its control. Returns the names driven, for the count below. */
async function honourEachOf(group) {
  const names = [...ENV_HONOURED].filter(([, probe]) => probe.group === group).map(([name]) => name);
  assert.ok(names.length > 0, `no fixture in ENV_HONOURED carries the ${group} group — refusing a vacuous pass`);
  for (const name of names) {
    const probe = ENV_HONOURED.get(name);
    const { fixture, control } = await probe.observe();
    assert.deepEqual(fixture, probe.want,
      `the built package did not answer ${JSON.stringify(probe.want)} for ${name} on its own fixture (it answered ${JSON.stringify(fixture)}) — the fixture is stale, so this case is measuring nothing`);
    assert.notDeepEqual(control, probe.want,
      `the built package ignores ${name}: a run differing from the fixture in THAT VARIABLE ALONE answered the same ${JSON.stringify(probe.want)} — item 9 declares a variable a patch release could stop reading with nothing going red`);
  }
  return names;
}

test("versioning: every environment variable item 9 declares that the built exports read is HONOURED — one fixture per name against a control differing in that variable alone", async () => {
  await honourEachOf("inProcess");
});

test("versioning: the built CLI's own doctor reply reports the home and the lexicon its environment named", async () => {
  await honourEachOf("doctor");
});

test("versioning: a REAL fleet the built CLI drove honours the actor, the socket, the default server and the rotation size its environment named", async () => {
  await honourEachOf("fleet");
});

test("versioning: the dashboard daemon takes its health snapshots at the cadence its environment names, and says how it is reached in the words its environment names", async () => {
  await honourEachOf("daemon");
});

test("versioning: every variable item 9 declares has a fixture driving it, and every fixture answers a declared variable", () => {
  const declared = declaredEnvVars(DOC);
  const all = [...declared.covered, ...declared.notCovered];
  // Both ways, for the reason HONOURED and LEXICON_HONOURED are checked both ways: a declared name with no
  // fixture is covered by semver on the strength of its name, and a fixture for a name the doc no longer
  // declares is drift of its own. The four group cases above would otherwise SKIP an undriven name silently.
  assertSameSet(all, [...ENV_HONOURED.keys()],
    { declaredAs: "VERSIONING.md item 9 (the environment variables, both lists)", liveAs: "the fixtures of ENV_HONOURED in this file" });
  assert.equal(ENV_HONOURED.size, all.length,
    `ENV_HONOURED carries ${ENV_HONOURED.size} fixtures for item 9's ${all.length} declared variables`);
  // And the groups partition the table, so no fixture is defined and then driven by no case at all.
  const grouped = ["inProcess", "doctor", "fleet", "daemon"].flatMap((g) => [...ENV_HONOURED].filter(([, p]) => p.group === g).map(([n]) => n));
  assertSameSet(grouped, [...ENV_HONOURED.keys()],
    { declaredAs: "the four groups the cases above drive", liveAs: "the fixtures of ENV_HONOURED" });
});

// ---------------------------------------------------------------------------------------------
// The preamble's own claim — "Items 1, 2, 3, 4, 5, 5b, 6, 7, 8 and 9 below are parsed as data by
// test/versioning-contract.test.js". That sentence has grown one item per card since TMUX-83 and was
// read by nothing: `grep -rhF 'below are parsed as' test/` returned 0, so an item named there with no
// parser, or a parse deleted while the sentence kept naming its item, left the file describing a check
// that does not exist. The map below is the answer, and it is a map to PARSERS the cases invoke rather
// than a second list of numbers — a literal compared with a literal would pass while the claim lied.
// ---------------------------------------------------------------------------------------------

/** Item number → the parsers this suite reads that item's declaration with, each invoked below. */
const ITEM_PARSERS = new Map([
  ["1", [["declaredCli", declaredCli]]],
  ["2", [["declaredTools", declaredTools]]],
  ["3", [["declaredEventTypes", declaredEventTypes]]],
  ["4", [["declaredStatusShape", declaredStatusShape], ["declaredSessionFields", declaredSessionFields]]],
  ["5", [["declaredPolicyShape", declaredPolicyShape]]],
  ["5b", [["declaredLexiconShape", declaredLexiconShape]]],
  ["6", [["declaredExports", declaredExports]]],
  ["7", [["declaredHomeLayout", declaredHomeLayout], ["declaredShippedStamp", declaredShippedStamp], ["declaredStampVerdict", declaredStampVerdict]]],
  ["8", [["declaredUserOptions", declaredUserOptions]]],
  ["9", [["declaredEnvVars", declaredEnvVars]]],
]);

/**
 * A parser mapped to an item must READ something: a list, every list of a multi-list item, or a single
 * name. Without this the map is a tautology — a function that returns [] would satisfy the preamble's
 * claim while the item is declared by nothing, which is the vacuous pass nonEmpty() refuses everywhere.
 */
function assertParsedSomething(number, name, value) {
  const lists = Array.isArray(value) ? [value] : typeof value === "string" ? [value] : Object.values(value);
  assert.ok(lists.length > 0, `${name}() read no declaration at all for item ${number} — the preamble claims it is parsed as data`);
  for (const list of lists) {
    const got = typeof list === "string" ? [list] : list;
    assert.ok(Array.isArray(got) && got.length > 0,
      `${name}() read an EMPTY declaration for item ${number} — the preamble's claim that the item is parsed as data would then be satisfied by a parser that reads nothing`);
  }
}

/** The whole accounting, as a function, so a case can run it over a planted preamble or a planted item. */
function assertPreambleAccounts(doc) {
  const enumerated = declaredParsedItems(doc);
  assertSameSet(enumerated, [...ITEM_PARSERS.keys()],
    { declaredAs: "VERSIONING.md's preamble (the items it says are parsed as data)", liveAs: "the item → parser map of this file, every parser invoked" });
  const items = coveredItems(doc);
  for (const [number, readers] of ITEM_PARSERS) {
    assert.ok(items.has(number),
      `this file maps a parser to item ${number}, which the covered list does not carry — the preamble would name an item that does not exist`);
    for (const [name, read] of readers) assertParsedSomething(number, name, read(doc));
  }
  // The rule the card states, kept even though set equality above implies it today: a covered item this
  // sentence names must have a parser. If the enumeration is ever allowed to be a subset, this is the check
  // that still refuses a claim about a check that was deleted.
  for (const number of items.keys()) {
    assert.ok(ITEM_PARSERS.has(number) || !enumerated.includes(number),
      `the preamble names covered item ${number} among the items parsed as data and no parser in this file reads it — the sentence is a claim about a check that does not exist`);
  }
  return enumerated;
}

/** A plant made inside the preamble alone — plantInItem's reason, for the text before the covered list. */
function plantInPreamble(from, to) {
  const at = DOC.indexOf("## Covered by semver");
  const preamble = DOC.slice(0, at);
  assert.equal(preamble.split(from).length - 1, 1,
    `fixture stale: "${from}" occurs ${preamble.split(from).length - 1} times in VERSIONING.md's preamble, not once — the plant would apply nothing, or land twice`);
  return preamble.replace(from, to) + DOC.slice(at);
}

test("versioning: the preamble's enumeration of parsed items equals the item → parser map, every parser invoked and asserted non-empty", () => {
  const enumerated = assertPreambleAccounts(DOC);
  // 10, and stated: the sentence has named one more item per card since TMUX-83 (1, 2, 3, 6 → 9 of them),
  // and the count is what makes a silently dropped name visible in the message rather than only in a set.
  assert.equal(enumerated.length, 10,
    `the preamble names ${enumerated.length} parsed items, not the 10 the covered list has parsers for — declare the new item's parser in ITEM_PARSERS, or take the item out of the sentence`);
  assert.deepEqual(enumerated, [...ITEM_PARSERS.keys()],
    "the preamble enumerates the parsed items in a different ORDER than the covered list reads them — the sentence is read as a reading order, so keep the two in step");
});

test("versioning: the preamble dropping an item that IS parsed fails naming it; claiming one no parser reads fails the other way", () => {
  // The card's plant D, measured INVISIBLE to the whole unit suite on 4a11d0b: the sentence stops naming
  // item 8 while `declaredUserOptions(` is invoked ten times in this suite. The doc then understates its own
  // guarantees, and the next author reads "item 8 is not checked" and edits it freely.
  const dropped = plantInPreamble("7, 8 and 9 below are parsed", "7 and 9 below are parsed");
  assert.ok(!declaredParsedItems(dropped).includes("8"),
    "an item deleted from the preamble's enumeration still parses as claimed — the cut is keeping text that names it");
  assert.throws(() => assertPreambleAccounts(dropped),
    (e) => e.message.includes("8") && e.message.includes("the item → parser map"),
    "the preamble stopped claiming an item this suite parses and the accounting passed — the file may then quietly understate what is checked, which is how item 9 went unwritten for a month");
  // The other direction, the one that matters to a reader: the sentence promises a check that does not exist.
  const phantom = plantInPreamble("8 and 9 below are parsed", "8, 9 and 10 below are parsed");
  assert.throws(() => assertPreambleAccounts(phantom),
    (e) => e.message.includes("10") && e.message.includes("ABSENT from the item → parser map"),
    "the preamble claimed an item no parser reads and the accounting passed — the sentence is then a promise the suite does not keep");
});

test("versioning: a covered item the preamble does not name may have no parser — one it names may not", () => {
  // The accounting must leave room for an item written down BEFORE its parser exists (item 4's per-session
  // half and item 7's shipped half were both written first, parsed a card later). Silence about it is the
  // price: the sentence may not name it.
  const tenth = "10. **A surface written down before it is parsed** — no parser reads this yet.\n";
  const unnamed = DOC.replace("\n## NOT covered", `${tenth}\n## NOT covered`);
  assert.notEqual(unnamed, DOC, "fixture stale: VERSIONING.md no longer has a '## NOT covered' heading to insert a tenth item before");
  assert.ok(coveredItems(unnamed).has("10"), "the planted tenth item is not read as a covered item — this case would then be measuring nothing");
  assert.doesNotThrow(() => assertPreambleAccounts(unnamed),
    "a covered item with no parser that the preamble does not name failed the accounting — an item could then never be written down before its check, which is how every parsed item here was born");
  const named = plantInPreamble("8 and 9 below are parsed", "8, 9 and 10 below are parsed").replace("\n## NOT covered", `${tenth}\n## NOT covered`);
  assert.throws(() => assertPreambleAccounts(named),
    (e) => e.message.includes("10"),
    "the preamble named the unparsed tenth item and the accounting passed — the sentence then says a check exists for an item nothing reads");
});

test("versioning: the preamble's enumeration reads item numbers alone — a rewrap changes nothing, while a summarized or reworded claim is loud", () => {
  // Rewrapping: the cut runs on normalized text, and the shipped sentence already spans two lines between
  // its markers' words ("parsed as / data by"), so this is the shipped state rather than a hypothetical.
  const at = DOC.indexOf("## Covered by semver");
  const raw = DOC.slice(0, at);
  const oneLine = `${flatten(raw)}\n\n${DOC.slice(at)}`;
  assert.notEqual(oneLine, DOC, "fixture stale: VERSIONING.md's preamble is no longer written across several lines");
  assert.deepEqual(declaredParsedItems(oneLine), declaredParsedItems(DOC),
    "rewrapping the preamble changed which items it claims are parsed — the cut is reading raw lines again");
  assert.ok(preambleText(DOC).includes(PARSED_ITEMS_END),
    `fixture stale: the preamble no longer carries "${PARSED_ITEMS_END}" — the claim this section reads has moved`);
  // A summary instead of an enumeration: "1 through 9" names no item a parser can be matched to, and a parse
  // that read the numbers out of it would silently claim items 1 and 9 alone.
  const summarized = plantInPreamble("Items 1, 2, 3, 4, 5, 5b, 6, 7, 8 and 9 below", "Items 1 through 9 below");
  assert.throws(() => declaredParsedItems(summarized),
    (e) => e.message.includes("through") && /reworded|cut moved/.test(e.message),
    "the preamble summarized its enumeration and the parse read numbers out of it anyway — an item between the ends would then be claimed by a sentence that never names it");
  // And both markers: reworded or gone, each is a hard failure rather than an unread sentence. The rewording
  // is done on the FLATTENED preamble and spliced back, for the reason item 7's case gives — the shipped
  // claim spans a line break ("parsed as / data by"), so it has no raw form to replace.
  const flat = flatten(raw);
  for (const [from, to] of [[PARSED_ITEMS_END, PARSED_ITEMS_END.replace("below", "belowish")], [`${PARSED_ITEMS_START} 1,`, "items 1,"]]) {
    const mangled = flat.replace(from, to);
    assert.notEqual(mangled, flat, `fixture stale: "${from}" no longer occurs in the preamble's normalized text`);
    assert.throws(() => declaredParsedItems(`${mangled}\n\n${DOC.slice(at)}`),
      (e) => /no longer occurs in/.test(e.message) && e.message.includes("preamble"),
      `rewording the preamble's "${from}" did not fail loudly — the sentence naming which items are checked would go unread, which is the state this card found`);
  }
});

// ---------------------------------------------------------------------------------------------
// The parse itself — the checks above are only as good as where they cut the item.
// Each case plants its drift in a doc STRING, so the shipped VERSIONING.md is never touched.
// ---------------------------------------------------------------------------------------------
test("versioning: a tool removed from item 2's list is NOT declared, even though the prose names it too", () => {
  const drifted = DOC.replace("`read-log`, `policy-status`. Removing a", "`read-log`. Removing a");
  assert.notEqual(drifted, DOC,
    "fixture stale: item 2's declared list must still end \"`read-log`, `policy-status`.\" right before the cut marker");
  assert.ok(!declaredTools(drifted).includes("policy-status"),
    "a tool deleted from item 2's declared list still parses as declared — the cut is keeping the prose after it, so tools/list agrees with a declaration the doc no longer makes");
});

test("versioning: the shipped item 2 declares each tool once — the prose mention is not a declaration", () => {
  const item2 = coveredItems(DOC).get("2") ?? "";
  assert.ok(ticks(flatten(item2)).filter((n) => n === "policy-status").length >= 2,
    "fixture stale: item 2 no longer names `policy-status` both in its list and in its prose, so this case proves nothing");
  assert.deepEqual(declaredTools(DOC).filter((n) => n === "policy-status"), ["policy-status"],
    "item 2's parse names policy-status more than once — the second mention comes from the prose after the cut");
});

test("versioning: rewrapping item 2 does not change what it declares — the cut reads normalized text", () => {
  const item2 = coveredItems(DOC).get("2") ?? "";
  const oneLine = DOC.replace(item2, `${flatten(item2)}\n`);
  assert.notEqual(oneLine, DOC, "fixture stale: item 2 must span more than one line for a rewrap to mean anything");
  assert.deepEqual(declaredTools(oneLine), declaredTools(DOC),
    "joining item 2 onto one line changed its declared tool set — a cosmetic reflow decides what the contract covers");
});

test("versioning: a cut marker that no longer occurs fails loudly, naming the item and the phrase", () => {
  for (const [what, marker, parse, reworded] of [
    // item 2's marker is wrapped in the doc, so rewording it there has to span the wrap; item 1's and
    // item 6's occur in the reader's note above item 1 as well, which is harmless — only the item is parsed
    ["item 2", "Removing a tool", declaredTools, DOC.replace("Removing a\n   tool", "Deleting a\n   tool")],
    ["item 1", "global flags", declaredCli, DOC.replaceAll("global flags", "global switches")],
    ["item 6", "and their signatures", declaredExports, DOC.replaceAll("and their signatures", "plus their signatures")],
    // item 6's value/type split: the marker is the ONE place the doc says which names carry
    // signatures, so a reworded one must fail rather than read 39 values and no types (or the reverse).
    ["item 6's value/type split", EXPORT_TYPES_START, declaredExportKinds, DOC.replaceAll("; types", "; and the types")],
    ["item 3", "New event types", declaredEventTypes, DOC.replaceAll("New event types", "Fresh event types")],
    ["item 8", "external tooling reads", declaredUserOptions, DOC.replaceAll("external tooling reads", "outside tooling reads")],
  ]) {
    assert.notEqual(reworded, DOC, `fixture stale: "${marker}" no longer occurs where this case rewords it`);
    assert.throws(() => parse(reworded), (e) => e.message.includes(marker) && e.message.includes(what),
      `${what}: a cut marker the doc no longer contains must fail naming the item and the phrase, not silently keep the prose after it`);
  }
});

test("versioning: a name backticked in item 6's PROSE is not a declared export — the parse refuses it", () => {
  // The exact edit an author makes when they add a root export and mean to call it internal: item 6's
  // prose amended in place. Measured on f050f5c the parse returned paneWidth among item 6's names, so
  // it was covered by semver by the doc's own rule while the doc said "internal" in English, and the
  // undecided-export failure below (the one alarm that forces the decision) went quiet — 7/7, rc 0.
  const drifted = DOC.replace("built-in profile objects, see below)", "built-in profile objects and `paneWidth`, see below)");
  assert.notEqual(drifted, DOC, "fixture stale: item 6's prose no longer reads \"built-in profile objects, see below)\"");
  assert.throws(() => declaredExports(drifted),
    (e) => e.message.includes("paneWidth") && e.message.includes("item 6") && e.message.includes("INTERNAL"),
    "a name backticked in item 6's prose still parses as declared — semver covers it by the doc's rule, and nothing records that decision");
});

test("versioning: item 6 declares each export once — a name listed twice fails, naming it", () => {
  const drifted = DOC.replace("values `Tmux`, `TmuxError`,", "values `Tmux`, `Tmux`, `TmuxError`,");
  assert.notEqual(drifted, DOC, "fixture stale: item 6's declared list no longer starts \"values `Tmux`, `TmuxError`,\"");
  assert.throws(() => declaredExports(drifted), (e) => e.message.includes("Tmux") && e.message.includes("item 6"),
    "item 6 parsed a doubled name without failing — 40 names for 39 exports still satisfies both directions");
});

test("versioning: wrapping item 6's cut marker across two lines does not change what it declares", () => {
  const wrapped = DOC.replace("— and their signatures", "— and their\n   signatures");
  assert.notEqual(wrapped, DOC, "fixture stale: item 6's cut marker no longer follows \"— \" on one line");
  assert.deepEqual(declaredExports(wrapped), declaredExports(DOC),
    "rewrapping item 6 changed its declared set — the cut is reading raw lines, so a cosmetic reflow decides what semver covers (TMUX-118's failure, in item 6)");
});

test("versioning: item 6's cut narrows nothing on the shipped doc — count and set", () => {
  // The fix is to the parse, not to the promise: today's prose backticks nothing, so the cut must
  // drop nothing. This is what would go red if a later edit moved the cut into the declared list.
  const whole = ticks(flatten(coveredItems(DOC).get("6") ?? ""));
  const declared = declaredExports(DOC);
  assert.equal(declared.length, whole.length,
    `item 6's cut keeps ${declared.length} of the ${whole.length} backticked names the shipped item carries — the cut has moved into the declared list, narrowing the semver promise`);
  assert.deepEqual([...declared].sort(), [...whole].sort(), "item 6's cut changed WHICH names the shipped doc declares");
});

test("versioning: item 3's declared list is compared with the shipped union in BOTH directions", () => {
  const shipped = shippedEventTypes();
  const compare = (doc) => assertSameSet(declaredEventTypes(doc), shipped,
    { declaredAs: "VERSIONING.md item 3", liveAs: "the EventType union in dist/core/ledger.d.ts" });
  // (a) a type the package still files, dropped from the doc. The same edit made in
  //     src/core/ledger.ts instead is the card's own scenario — a rename that left the suite green.
  const dropped = DOC.replace("`capture.stalled`, `control.denied`", "`control.denied`");
  assert.notEqual(dropped, DOC, "fixture stale: item 3's list no longer reads \"`capture.stalled`, `control.denied`\"");
  assert.ok(!declaredEventTypes(dropped).includes("capture.stalled"),
    "a type deleted from item 3's list still parses as declared — the cut is keeping text that names it");
  assert.throws(() => compare(dropped), (e) => e.message.includes("capture.stalled") && e.message.includes("NOT declared"),
    "a type the built union carries and item 3 no longer declares must fail, naming it");
  // (b) the other direction: a name declared with no type behind it — a promise the package cannot keep
  const phantom = DOC.replace("`control.denied`,", "`control.denied`, `session.frobbed`,");
  assert.notEqual(phantom, DOC, "fixture stale: item 3's list no longer reads \"`control.denied`,\"");
  assert.throws(() => compare(phantom), (e) => e.message.includes("session.frobbed") && e.message.includes("ABSENT"),
    "a type item 3 declares that the shipped union does not carry must fail, naming it");
});

test("versioning: an event type backticked in item 3's PROSE is not declared — the parse refuses it", () => {
  // Item 3's own wording until this card: the additive rule with an example beside it. Measured on
  // a0eeb1e a parse of the whole item returned exactly those three example names, so 3 of the 23
  // types read as the declaration — and both directions could be satisfied by a doc naming three.
  const drifted = DOC.replace("New event types and new `data` keys are *additive* (minor).",
    "New event types and new `data` keys are *additive* (minor) — e.g. `fleet.tmux` (tmux-server reachability transitions) was added this way.");
  assert.notEqual(drifted, DOC, "fixture stale: item 3's additive sentence is no longer the one this case rewords");
  assert.throws(() => declaredEventTypes(drifted), (e) => e.message.includes("fleet.tmux") && e.message.includes("item 3"),
    "a type backticked in item 3's prose still parses as declared — the doc means an example and semver reads a declaration");
});

test("versioning: item 3 declares each type once — a name listed twice fails, naming it", () => {
  const drifted = DOC.replace("`session.spawned`,", "`session.spawned`, `session.spawned`,");
  assert.notEqual(drifted, DOC, "fixture stale: item 3's declared list no longer starts \"`session.spawned`,\"");
  assert.throws(() => declaredEventTypes(drifted), (e) => e.message.includes("session.spawned") && e.message.includes("item 3"),
    "item 3 parsed a doubled name without failing — 24 names for 23 types still satisfies both directions (TMUX-122's failure, in item 3)");
});

test("versioning: rewrapping item 3 changes neither its declared types nor its (reserved) marks", () => {
  const item3 = coveredItems(DOC).get("3") ?? "";
  const oneLine = DOC.replace(item3, `${flatten(item3)}\n`);
  assert.notEqual(oneLine, DOC, "fixture stale: item 3 must span more than one line for a rewrap to mean anything");
  assert.deepEqual(declaredEventTypes(oneLine), declaredEventTypes(DOC),
    "joining item 3 onto one line changed its declared type set — a cosmetic reflow decides what semver covers (TMUX-118's failure, in item 3)");
  assert.deepEqual(reservedEventTypes(oneLine), reservedEventTypes(DOC),
    "joining item 3 onto one line changed which types read as (reserved) — the mark is being read off raw lines, so a rewrap moves a decision");
});

test("versioning: an option deleted from item 8's list is NOT declared, and the comparison fails naming it", () => {
  // The card's invisible plant A: the declaration loses a name the code still sets. External tooling
  // reading @agent_task then reads a name semver stopped covering, and before this card nothing said so.
  const dropped = DOC.replace("`@agent_owner`,\n   `@agent_task` — external", "`@agent_owner` — external");
  assert.notEqual(dropped, DOC, "fixture stale: item 8's list no longer wraps as \"`@agent_owner`,\" then \"`@agent_task` — external\"");
  assert.ok(!declaredUserOptions(dropped).includes("@agent_task"),
    "an option deleted from item 8's list still parses as declared — the cut is keeping text that names it");
  assert.throws(() => compareUserOptions(dropped, builtJs()),
    (e) => e.message.includes("@agent_task") && e.message.includes("NOT declared"),
    "the option the build still sets and item 8 no longer declares passed the comparison");
});

test("versioning: an option backticked in item 8's PROSE is not declared — the parse refuses it", () => {
  const drifted = DOC.replace("— external tooling reads these.", "— external tooling reads these, as it will read `@agent_model`.");
  assert.notEqual(drifted, DOC, "fixture stale: item 8 no longer ends \"— external tooling reads these.\"");
  assert.throws(() => declaredUserOptions(drifted), (e) => e.message.includes("@agent_model") && e.message.includes("item 8"),
    "a name backticked in item 8's prose still parses as declared — the doc means a plan and semver reads a promise (TMUX-126's failure, in item 8)");
});

test("versioning: item 8 declares each option once — a name listed twice fails, naming it", () => {
  const drifted = DOC.replace("`@agent_parent`, `@agent_owner`,", "`@agent_parent`, `@agent_parent`, `@agent_owner`,");
  assert.notEqual(drifted, DOC, "fixture stale: item 8's list no longer reads \"`@agent_parent`, `@agent_owner`,\"");
  assert.throws(() => declaredUserOptions(drifted), (e) => e.message.includes("@agent_parent") && e.message.includes("item 8"),
    "item 8 parsed a doubled name without failing — 4 names for 3 options still satisfies both directions (TMUX-122's failure, in item 8)");
});

test("versioning: rewrapping item 8 does not change what it declares, and its cut narrows nothing", () => {
  const item8 = coveredItems(DOC).get("8") ?? "";
  // Item 8 is the LAST covered item, so what coveredItems() returns for it ends in the blank line before
  // "## NOT covered" plus the newline the line-join adds — a string the doc does not literally contain.
  // Every parse flattens, so that tail changes no verdict; a fixture that replaces the item does have to
  // trim it, or the replace silently matches nothing and this case passes on an unrewrapped doc.
  const asWritten = item8.trimEnd();
  assert.ok(DOC.includes(asWritten) && asWritten.includes("\n"),
    "fixture stale: item 8 is no longer two or more lines of the doc verbatim, so a rewrap here means nothing");
  const oneLine = DOC.replace(asWritten, flatten(item8));
  assert.notEqual(oneLine, DOC, "fixture stale: item 8 must span more than one line for a rewrap to mean anything");
  assert.deepEqual(declaredUserOptions(oneLine), declaredUserOptions(DOC),
    "joining item 8 onto one line changed its declared option set — a cosmetic reflow decides what semver covers (TMUX-118's failure, in item 8)");
  // The plant with teeth against a RAW-line cut, item 6's case in item 8: wrap the marker itself. Item 8's
  // marker sits on one line today, so only this edit tells a normalized cut from a raw one — a raw cut
  // stops finding the phrase and cutBefore() fails instead of quietly keeping the prose.
  const wrapped = DOC.replace("— external tooling reads", "— external tooling\n   reads");
  assert.notEqual(wrapped, DOC, "fixture stale: item 8's cut marker no longer follows \"— \" on one line");
  assert.deepEqual(declaredUserOptions(wrapped), declaredUserOptions(DOC),
    "wrapping item 8's cut marker across two lines changed what it declares — the cut is reading raw lines (TMUX-118's failure, in item 8)");
  // As with items 3 and 6: today's prose names no option, so the cut must drop none. This goes red if a
  // later edit moves the cut into the list — the quiet way a three-name promise becomes a two-name one.
  const whole = optionTicks(flatten(item8));
  const declared = declaredUserOptions(DOC);
  assert.equal(declared.length, whole.length,
    `item 8's cut keeps ${declared.length} of the ${whole.length} option-shaped names the shipped item carries — the cut has moved into the declared list, narrowing the semver promise`);
  assert.deepEqual([...declared].sort(), [...whole].sort(), "item 8's cut changed WHICH options the shipped doc declares");
});

test("versioning: item 4's parse reads its two lists and nothing else — not its subject, not the parenthetical, not the prose after the cut", () => {
  const { top, tmux } = declaredStatusShape(DOC);
  // The subject names the FILE, not a key in it — and it is dropped structurally (the item's bolded head),
  // not by a hard-coded name, so renaming the file changes neither set.
  assert.ok(!top.includes("status.json") && !tmux.includes("status.json"),
    "item 4's own subject reads as a key of the file it names — every comparison below then judges `status.json` against the writer");
  const renamedSubject = DOC.replace("4. **`status.json` shape**", "4. **`state.json` shape**");
  assert.notEqual(renamedSubject, DOC, "fixture stale: item 4's head is no longer \"4. **`status.json` shape**\"");
  assert.deepEqual(declaredStatusShape(renamedSubject), declaredStatusShape(DOC),
    "renaming the file item 4 describes changed what it declares — the head is being read as a declaration");
  // `sessions[]` is how the doc writes an array-valued key; `sessions` is what the writer writes.
  assert.ok(top.includes("sessions") && !top.some((k) => k.endsWith("[]")),
    `item 4 parses ${top.join(", ")} — \`sessions[]\` must read as the key \`sessions\`, or both directions fail on a notation`);
  // The prose after the cut is the per-session half, deliberately unparsed (its fields are documented
  // nowhere yet — TMUX-133's scope note). None of its tokens may read as a key of the file.
  for (const noise of ["reason", "GONE", "null", "session-status", "/api/session"]) {
    assert.ok(!top.includes(noise) && !tmux.includes(noise),
      `item 4's prose token \`${noise}\` reads as a declared key — the cut has moved past "${STATUS_CUT}"`);
  }
  // A parenthetical is prose ABOUT what precedes it: today's re-mentions of `sessions` and `error` live in
  // the one after the tmux block, and a parse that read them would declare `sessions` twice (refuseDuplicates)
  // while agreeing with the writer. A fifth name planted there is likewise not a key.
  const inParen = DOC.replace("tmux's own words in `error` when unreachable;", "tmux's own words in `error` when unreachable, beside `writtenBy`;");
  assert.notEqual(inParen, DOC, "fixture stale: item 4's tmux parenthetical no longer ends \"tmux's own words in `error` when unreachable;\"");
  assert.deepEqual(declaredStatusShape(inParen), declaredStatusShape(DOC),
    "a name mentioned in item 4's parenthetical reads as a declared key — prose about the tmux block then decides what semver covers (TMUX-122's failure, in item 4)");
  const afterCut = DOC.replace("why a session is `GONE`", "why a session is `GONE` and `writtenBy` is who wrote it");
  assert.notEqual(afterCut, DOC, "fixture stale: item 4's per-session half no longer says \"why a session is `GONE`\"");
  assert.deepEqual(declaredStatusShape(afterCut), declaredStatusShape(DOC),
    "a name mentioned after item 4's cut reads as a declared key of the file");
});

test("versioning: item 4 declares each key once — a key listed twice fails, naming it, in either half", () => {
  const dupTop = DOC.replace("top-level `v`, `generatedAt`", "top-level `v`, `generatedAt`, `v`");
  assert.notEqual(dupTop, DOC, "fixture stale: item 4 no longer opens \"top-level `v`, `generatedAt`\"");
  assert.throws(() => declaredStatusShape(dupTop),
    (e) => e.message.includes("item 4 parses v more than once"),
    "a top-level key listed twice passed — both directions then agree while the declaration is not what the parse says it is");
  const dupTmux = DOC.replace("`{ reachable, since, error, checkedAt }`", "`{ reachable, since, error, checkedAt, error }`");
  assert.notEqual(dupTmux, DOC, "fixture stale: item 4's tmux block is no longer written `{ reachable, since, error, checkedAt }`");
  assert.throws(() => declaredStatusShape(dupTmux),
    (e) => e.message.includes("item 4's tmux block parses error more than once"),
    "a tmux key listed twice passed");
});

test("versioning: item 4's cut reads normalized text — the shipped marker already spans two lines; a reworded one and a vanished tmux block fail loudly", () => {
  const item4 = coveredItems(DOC).get("4") ?? "";
  // No plant needed for the TMUX-118 rule here: item 4 wraps its own cut marker across VERSIONING.md:84-85,
  // so a raw-line cut would find nothing today and keep the whole item — exactly item 2's failure.
  assert.ok(!item4.includes(STATUS_CUT) && flatten(item4).includes(STATUS_CUT),
    `fixture stale: item 4's cut marker "${STATUS_CUT}" no longer spans two lines of the shipped doc, so only a planted wrap would prove the cut reads normalized text`);
  const asWritten = item4.trimEnd();
  assert.ok(DOC.includes(asWritten) && asWritten.includes("\n"),
    "fixture stale: item 4 is no longer several lines of the doc verbatim, so a rewrap here means nothing");
  const oneLine = DOC.replace(asWritten, flatten(item4));
  assert.notEqual(oneLine, DOC, "fixture stale: item 4 must span more than one line for a rewrap to mean anything");
  assert.deepEqual(declaredStatusShape(oneLine), declaredStatusShape(DOC),
    "joining item 4 onto one line changed what it declares — a cosmetic reflow decides what semver covers (TMUX-118's failure, in item 4)");
  const reworded = DOC.replace("and the documented\n   per-session fields", "and the recorded\n   per-session fields");
  assert.notEqual(reworded, DOC, "fixture stale: item 4's cut marker no longer wraps after \"and the documented\"");
  assert.throws(() => declaredStatusShape(reworded),
    (e) => e.message.includes(STATUS_CUT) && e.message.includes("item 4 (status.json shape)"),
    "a reworded cut marker kept the per-session prose instead of failing — `reason`, `GONE` and `null` then read as top-level keys");
  const noBlock = DOC.replace("(`{ reachable, since, error, checkedAt }` — the verdict", "(the verdict");
  assert.notEqual(noBlock, DOC, "fixture stale: item 4's tmux block no longer opens its parenthetical");
  assert.throws(() => declaredStatusShape(noBlock),
    (e) => e.message.includes("no longer declares its tmux block"),
    "item 4 with no `{ … }` block yielded a tmux key set anyway — an empty contract is a hard failure, not a pass");
});

test("versioning: item 4's per-session list reads the list alone — not `reason`'s explanation before it, not the null rule after it, and a rewrap changes nothing", () => {
  const fields = declaredSessionFields(DOC);
  // The prose BEFORE the list is where this half lived before it was a list: it names `reason` a second time and
  // `GONE`, `null`, `session-status`, `/api/session` beside it — a state value, a JSON literal and two OTHER
  // surfaces that carry the same field. Parsed as declarations they would double `reason` (refuseDuplicates) and
  // promise four things that are no field of anything; that is the naive parse this card refused.
  for (const noise of ["GONE", "null", "session-status", "/api/session"]) {
    assert.ok(!fields.includes(noise),
      `item 4's per-session list parses \`${noise}\` as a declared field — the list is starting before "${SESSION_START}"`);
  }
  assert.deepEqual(fields.filter((f) => f === "reason"), ["reason"],
    "item 4's per-session parse must name reason exactly once: twice means it is reading the explanation in front of the list as well as the list, none means the list stopped declaring the one field this half named before TMUX-134 made it a list");
  const inFront = plantInItem("4", "why a session is `GONE`", "why a session is `GONE`, beside `writtenBy`");
  assert.deepEqual(declaredSessionFields(inFront), fields,
    "a name backticked in the prose BEFORE item 4's per-session list reads as a declared field — an explanation then decides what semver covers");
  // Item 6's rule in item 4's second half: after the list there is nothing a backticked name could
  // mean except a declaration, so the text past the cut must carry none — today's null rule carries none.
  const afterList = plantInItem("4", "so a collector reads one shape", "so a collector reads one shape, `writtenBy` included");
  assert.throws(() => declaredSessionFields(afterList), (e) => e.message.includes("writtenBy") && e.message.includes("item 4"),
    "a name backticked after item 4's per-session list still parses as declared — the doc means an aside and semver reads a promise");
  const item4 = coveredItems(DOC).get("4") ?? "";
  const asWritten = item4.trimEnd();
  assert.ok(DOC.includes(asWritten) && asWritten.includes("\n"),
    "fixture stale: item 4 is no longer several lines of the doc verbatim, so a rewrap here means nothing");
  const oneLine = DOC.replace(asWritten, flatten(item4));
  assert.notEqual(oneLine, DOC, "fixture stale: item 4 must span more than one line for a rewrap to mean anything");
  assert.deepEqual(declaredSessionFields(oneLine), fields,
    "joining item 4 onto one line changed its declared per-session fields — a cosmetic reflow decides what semver covers (TMUX-118's failure, in item 4's second half)");
});

test("versioning: item 4's per-session list declares each field once, and a marker reworded or wrapped at either end is loud, never silent", () => {
  const fields = declaredSessionFields(DOC);
  const dup = DOC.replace("`owner`, `meta`\n   —", "`owner`, `meta`, `owner`\n   —");
  assert.notEqual(dup, DOC, "fixture stale: item 4's per-session list no longer ends \"`owner`, `meta`\" before its closing clause");
  assert.throws(() => declaredSessionFields(dup),
    (e) => e.message.includes("item 4's per-session list parses owner more than once"),
    "a per-session field listed twice passed — 15 names for 14 keys still satisfies both directions (TMUX-122's failure, in item 4's second half)");
  // Both ends are cut at a phrase, so both get TMUX-118's two rules. Reworded: a hard failure naming the phrase —
  // a start marker that stopped matching would begin the list in `reason`'s explanation, an end marker that stopped
  // matching would swallow the null rule and declare `null` a field. Every plant goes through plantInItem(): the
  // reader's note at the top of the doc quotes both markers, and a DOC-wide replace lands there instead (measured).
  for (const [marker, reworded] of [
    [SESSION_START, plantInItem("4", SESSION_START, "Each `sessions[]` record holds:")],
    [SESSION_END, plantInItem("4", SESSION_END, "each of them on every record")],
  ]) {
    assert.throws(() => declaredSessionFields(reworded), (e) => e.message.includes(marker) && e.message.includes("per-session list"),
      `a reworded "${marker}" kept the prose on that side of the list instead of failing — the parse must name the phrase it can no longer find`);
  }
  // Wrapped: unmoved. Both markers sit on one line today, so only a planted wrap tells a normalized cut from a raw
  // one — the plant item 8's case has teeth from, here in item 4's second half.
  for (const [marker, wrapped] of [
    [SESSION_START, plantInItem("4", "record carries:", "record\n   carries:")],
    [SESSION_END, plantInItem("4", "— all of them on every", "— all of them on\n   every")],
  ]) {
    assert.deepEqual(declaredSessionFields(wrapped), fields,
      `wrapping "${marker}" across two lines changed what item 4's per-session half declares — the cut is reading raw lines (TMUX-118's failure)`);
  }
});

test("versioning: item 5's parse reads its two lists and nothing else — not the file it names, not the surfaces in its aside, not the reply between the halves, not the prose after", () => {
  const { top, actions } = declaredPolicyShape(DOC);
  // The item's subject names the FILE the keys belong to, and the path to it sits in a parenthetical of its own.
  // Both are dropped structurally — the bolded head and every parenthetical, item 4's rules — so renaming either
  // changes no declaration.
  const renamedSubject = plantInItem("5", "**Policy file schema** (`~/.tmux-agent/policy.json`)", "**Control file schema** (`~/.tmux-agent/control.json`)");
  assert.deepEqual(declaredPolicyShape(renamedSubject), { top, actions },
    "renaming the policy file, or the subject that introduces it, changed what item 5 declares — the head and the path are being read as keys of the file");
  // `web`/`mcp`/`cli` are the surfaces a `surfaces` entry may name, `policy-status` the tool that answers the
  // action list, hiddenActions its field: none of them a key of policy.json or an action name. The first three
  // live in a parenthetical, the last two in the prose BETWEEN the two lists — after the top half's cut and
  // before the action list's, so neither half may claim them.
  for (const noise of ["web", "mcp", "cli", "policy-status", "~/.tmux-agent/policy.json"]) {
    assert.ok(!top.includes(noise) && !actions.includes(noise),
      `item 5 parses \`${noise}\` as a declared key or action — the cut has moved past "${POLICY_TOP_END}" or before "${POLICY_ACTION_START}"`);
  }
  // A fifth name planted in that aside is likewise not a key (TMUX-122's rule, in item 5's top half).
  const inAside = plantInItem("5", "(`web`, `mcp`, `cli`)", "(`web`, `mcp`, `cli`, and `auditOnly` one day)");
  assert.deepEqual(declaredPolicyShape(inAside).top, top,
    "a name mentioned in item 5's parenthetical reads as a declared top-level key — prose about the surfaces then decides what semver covers");
  // Item 6's rule after the action list: there is nothing a backticked name could mean past the end marker
  // except a declaration, so the suite must fail naming it. Today's closing sentence carries none.
  const afterList = plantInItem("5", "or ceasing to honour a documented key", "or ceasing to honour a documented key such as `surfaces`");
  assert.throws(() => declaredPolicyShape(afterList), (e) => e.message.includes("surfaces") && e.message.includes("item 5"),
    "a name backticked after item 5's action list still parses as declared — the doc means an example and semver reads a promise");
});

test("versioning: item 5 declares each name once, in either half; its three markers are wrapped-proof and a reworded one is loud", () => {
  const { top, actions } = declaredPolicyShape(DOC);
  const dupKey = plantInItem("5", "`readOnly`, `allow`", "`readOnly`, `allow`, `readOnly`");
  assert.throws(() => declaredPolicyShape(dupKey), (e) => e.message.includes("item 5 parses readOnly more than once"),
    "a top-level key listed twice passed — 5 names for 4 keys still satisfies both directions (TMUX-122's failure, in item 5)");
  const dupAction = plantInItem("5", "`kill`, `adopt`", "`kill`, `adopt`, `kill`");
  assert.throws(() => declaredPolicyShape(dupAction), (e) => e.message.includes("item 5's action list parses kill more than once"),
    "an action name listed twice passed — 6 names for 5 actions still satisfies both directions");
  // TWO of the three markers already span a wrap in the shipped doc, so a raw-line cut would find neither today
  // and keep the whole item — item 2's failure, with no plant needed to show it.
  const item5 = coveredItems(DOC).get("5") ?? "";
  for (const marker of [POLICY_TOP_END, POLICY_ACTION_END]) {
    assert.ok(!item5.includes(marker) && flatten(item5).includes(marker),
      `fixture stale: item 5's marker "${marker}" no longer spans two lines of the shipped doc, so only a planted wrap would prove this cut reads normalized text`);
  }
  // The third sits on one line, so only a planted wrap tells a normalized cut from a raw one (item 8's plant,
  // TMUX-132). A whole-item rewrap must move nothing either.
  const wrapped = plantInItem("5", "the action names are:", "the action\n   names are:");
  assert.deepEqual(declaredPolicyShape(wrapped), { top, actions },
    `wrapping "${POLICY_ACTION_START}" across two lines changed what item 5 declares — the cut is reading raw lines (TMUX-118's failure, in item 5)`);
  const asWritten = item5.trimEnd();
  assert.ok(DOC.includes(asWritten) && asWritten.includes("\n"),
    "fixture stale: item 5 is no longer several lines of the doc verbatim, so a rewrap here means nothing");
  const oneLine = DOC.replace(asWritten, flatten(item5));
  assert.notEqual(oneLine, DOC, "fixture stale: item 5 must span more than one line for a rewrap to mean anything");
  assert.deepEqual(declaredPolicyShape(oneLine), { top, actions },
    "joining item 5 onto one line changed what it declares — a cosmetic reflow decides what semver covers");
  // Reworded: each marker must fail naming itself and the half it cuts. A dead POLICY_TOP_END would read
  // `policy-status` as a key of the file; a dead POLICY_ACTION_START would begin the action list in that same
  // prose; a dead POLICY_ACTION_END would swallow the breaking-change sentence into the list.
  for (const [marker, reworded] of [
    [POLICY_TOP_END, plantInItem("5", "An allow- or\n   deny-list is keyed by action", "An allow- or\n   deny-list is keyed by verb")],
    [POLICY_ACTION_START, plantInItem("5", "the action names are:", "the action names shall be:")],
    [POLICY_ACTION_END, plantInItem("5", "Tightening the default\n   posture", "Hardening the default\n   posture")],
  ]) {
    assert.throws(() => declaredPolicyShape(reworded), (e) => e.message.includes(marker) && e.message.includes("item 5"),
      `a reworded "${marker}" kept the prose on that side of the cut instead of failing — the parse must name the phrase it can no longer find`);
  }
});

test("versioning: item 3's cut narrows nothing on the shipped doc — count and set", () => {
  // As with item 6: today's prose names no type, so the cut must drop none. This goes red if a later
  // edit moves the cut into the list — the quiet way a 23-name promise becomes a 3-name one.
  const whole = eventTicks(flatten(coveredItems(DOC).get("3") ?? ""));
  const declared = declaredEventTypes(DOC);
  assert.equal(declared.length, whole.length,
    `item 3's cut keeps ${declared.length} of the ${whole.length} event-shaped names the shipped item carries — the cut has moved into the declared list, narrowing the semver promise`);
  assert.deepEqual([...declared].sort(), [...whole].sort(), "item 3's cut changed WHICH types the shipped doc declares");
});
