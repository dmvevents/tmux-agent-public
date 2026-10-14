/**
 * docs/AGNOSTIC-DESIGN.md's three-lexicon table is a CHECKED contract, not prose.
 *
 * That table is the enumeration of the rule the product rests on. CONTRIBUTING rule 5 ("Agnostic
 * core" — "our fleet is the test subject, never the specification") names the three places our
 * vocabulary leaked into the source and links to this page for them; AGENTS.md carries the same rule
 * to any agent working on the repo; the README sends a stranger here for *why* any of it exists. Gate
 * G6 (Docs) with KR3 (Universality) behind it.
 *
 * Measured 2026-09-20 on the pushed 3765f06 (scratch/ga-fire-2026-09-20-14Z/probe/), every grep
 * written `-rhF` rather than `-rn` so a path word cannot manufacture a hit: `grep -rhF
 * AGNOSTIC-DESIGN test/` → 0, `"Whose vocabulary"` → 0, `"Non-session parent names"` → 0, `"Secret
 * shapes to redact"` → 0. Two of the three rows were already incomplete against their live
 * authorities: row 1 named three CLIs where the chain returns four names, and row 2 named 6 of the 10
 * entries the shipped predicate holds — `user`, `systemd`, `unknown` and `^loop-` were in the code and
 * in no sentence, and 7 of the 10 were driven by no test fixture at all. On planted copies of that
 * tree, four kinds of drift were byte-identical to the whole unit suite's control (394 tests, 393
 * pass, 1 tree-copy artifact): the doc ceasing to name `cron`, `aider` or `Slack` while each was still
 * live, and — the direction that matters most — the BUILT parent set gaining `"jenkins"`, a name the
 * universality doc never carries. The positive control that makes those silences evidence was the same
 * class of deletion on an already-parsed list: README's profile table minus its `aider` row is RED,
 * 394/389/5 (scratch/ga-fire-2026-09-20-14Z/probe/red/E2.log).
 *
 * This file parses the table AS DATA (test/helpers/agnostic-doc.js) and holds each row against its own
 * live authority, both directions:
 *  (a) row 1 ≡ `resolveProfiles({})`'s chain less the fallback, and `generic-shell` is last;
 *  (b) row 2 — one fixture per declared entry driven through `computeEngagement`, the two anchored
 *      patterns with a name that ends/starts with them AND a near-miss that must stay ORPHANED, plus
 *      the ten entries the built module carries compared with the ten the row declares;
 *  (c) row 3 — one sample per declared provider name mapped to the marker `redact()` actually emits,
 *      all four envelope shapes, a negative control, and every provider-named marker the built module
 *      emits traced back to a name the row declares;
 *  (d) the three `Where` cells resolve as `src/` + the cell, and as `dist/` + the same name for the
 *      module each case actually drives — so the column is load-bearing rather than decorative;
 *  (e) the parse's own rules, on planted doc STRINGS: markers asserted present, the third cell only,
 *      backtick-aware cell splitting, parentheticals, the region's END anchor, and the empty /
 *      duplicated / open-ended failures.
 *
 * Row 2's authority is MODULE STATE: the engagement configurator replaces the whole predicate for the
 * process, and `parents.replace` drops the built-ins outright (test/lexicon.test.js:252). So these
 * cases live in their own file, which configures no lexicon — asserted, not assumed, in the last case
 * below.
 *
 * ── §2 and §3: the calibrate contract and the agent-facing file set ────────────────────
 *
 * The parse above stops at TABLE_END and two cases assert that it stops, so the suite already knew this
 * page carried two more tables and read no byte of them: 953 of 12018 normalized chars (7%). And §2 was
 * FALSE — its fenced usage block told an adopter to type a sampling flag that existed nowhere but that
 * block, which the built CLI refuses with exit 64. Measured 2026-09-20 on the pushed 75ebb86
 * (scratch/ga-fire-2026-09-20-22Z/probe/), five drift classes byte-identical to the unit suite's control
 * on their own planted copies of that tree — the CLI growing a `calibrate --limit` the doc never names
 * (patched in the source header, built header, verb table and VALUE_FLAGS together, so the binary agreed
 * with itself and accepted it); the doc dropping `--out`, the only flag the verb has; the layers table
 * naming a `tmux-agent-kalibrate` skill with no directory; the §3 list dropping a shipped skill; and
 * `calibrate --out` ALSO overwriting `$TMUX_AGENT_HOME/lexicon.json`, with the home's sha read moving
 * before the verdict was taken. The positive control that makes those silences evidence: the same class
 * of deletion on the ALREADY-parsed table (row 2 minus `cron`) is RED, naming the table.
 *
 * So four more regions are read as data, each cut to its OWN markers so the first table's region and its
 * two boundary cases are untouched:
 *  (f) §2's fenced usage line ≡ the built CLI's own table entry for that verb, both directions, with the
 *      verb asserted dispatched — and the flag this page promised until TMUX-143 declared by nothing and
 *      DRIVEN to its exit 64, so "fixed" cannot mean implementing it;
 *  (g) "Never auto-apply" DRIVEN against the built binary on a throwaway $TMUX_AGENT_HOME — the draft at
 *      the path given, mode 0600, and that home's `lexicon.json` byte-identical by sha, with and without
 *      `--out`. Asserting the sentence exists would check nothing: it is a promise about writing to an
 *      operator's config, so only a drive can hold it;
 *  (h) §2's layers table as 3 rows — every artefact a "Who does it" cell names resolving to exactly one
 *      live authority (a verb the built CLI dispatches, or a skill directory this repo ships), the human
 *      row declared as naming none rather than skipped, and the row COUNT asserted;
 *  (i) §3's skills list ≡ the directories matching the page's OWN `.claude/skills/tmux-agent-*` glob,
 *      both directions, with the layers table's skill required to be one of them (one name, two sites);
 *      the audiences table's `AGENTS.md` link resolved; and the two counts that row states counted —
 *      CONTRIBUTING's numbered design rules and the rows of AGENTS.md's own test-layers table, each row
 *      naming a file or an `npm run` script that exists.
 * The authority for the skills is the REPO TREE, not the tarball: `.claude/` is tracked in git and
 * package.json's files[] ships dist/ + five root files, the same distinction case (d) makes for `src/`.
 *
 * ── §1: the config an adopter writes BY HAND ───────────────────────────────────────────
 *
 * §1 was the largest region of this page still parsed by nothing — 3182 of 13653 normalized chars,
 * measured 2026-09-21 on the pushed 89bf9e2 (scratch/ga-fire-2026-09-21-02Z/probe/) — and the only
 * unparsed one that re-declared a COVERED surface: VERSIONING.md item 5b declares the lexicon schema
 * and the suite has parsed it since TMUX-137, so §1's example was that surface's SECOND declaration,
 * checked by nothing. Every grep `-rhF` so a path word cannot manufacture a hit: `"Extend, never
 * silently replace"` → 0, `"Redaction is additive-only"` → 0, `"Validation is loud"` → 0, `"Patterns
 * are capped and screened"` → 0, `"strict superset"` → 0. The hits that DID exist were the boundary
 * asserts at (e) proving the parse stopped short of the example, which say it out loud — true of the
 * example's VALUES (`my-cli`, `boss`, `azure-key` answer to no live authority) and false of its KEYS.
 *
 * And decision 1 was FALSE. It promised "an explicit `\"replace\": true` per section"; the built
 * loader honours that spelling for `parents` alone, `redact` has none by design (decision 2 says so on
 * the same page, so decisions 1 and 2 contradicted each other), and `profiles` SILENTLY IGNORED it —
 * `validateLexicon` accepts the wrong spelling with no error and the key that works is
 * `replaceProfiles` at top level. Driven through the built binary on one throwaway `$TMUX_AGENT_HOME`
 * (scratch/ga-fire-2026-09-21-04Z/probe/cli-replace.log): with `"replace": true` beside `profiles`,
 * `doctor` reports `replaceBuiltins: false` and all four built-ins still in the chain, exit 0, no
 * warning — decision 4's own "never partial-silent" promise, broken on the same page. So an adopter who
 * followed §1 verbatim to drop our built-in profiles kept them and was told nothing. The fix was to
 * name the spellings the loader reads; adding a `profiles.replace` alias was explicitly not authorised,
 * and no `src/` byte moved.
 *
 * Seven plants, each watched RED against a control re-measured on the same tree copy
 * (scratch/ga-fire-2026-09-21-04Z/red-*.log; the control, the corrected page on that copy, is 40/40):
 * the PARENT page's decision 1 → 40/38/2, the parse refusing `"replace": true` by name; the example's
 * `contextPct` losing its capture group → 40/35/5, because a lexicon that cannot load takes every case
 * that drives it with it; the example dropping its `// ADDITIVE` comment → 40/38/2; a key renamed to one
 * item 5b does not declare → 40/38/2, naming the semver consequence; the BUILT redaction pass running
 * user rules BEFORE the built-ins → 40/39/1 (`[REDACTED_AWS_KEY]` where `[USER_SAW_IT]` was expected);
 * and the BUILT lexicon profile losing its `m` flag → 40/39/1, the macOS-CI scar caught from this side.
 *
 * Two more regions are read as data, each cut to its own markers so the first table's region is
 * byte-unchanged and (e)'s boundary cases stay green:
 *  (j) §1's jsonc example as DATA — comment-stripped, `JSON.parse`d, its keys flattened to the dotted
 *      paths item 5b's four lists use and every one held against the list that declares it (the other
 *      direction is deliberately not a set equality: the example illustrates 14 of item 5b's 19 keys),
 *      and its four `//` comments DRIVEN as the claims they are — the profile chain's order, the
 *      capture group reading 42, the supervisor names and the anchored near-miss through `doctor
 *      --parent` (out of process, because this file installs no lexicon), and redaction's additive
 *      order proven by a user rule that eats the built-in's own marker;
 *  (k) the six design decisions, one case each, every one driven rather than read: the corrected
 *      decision 1 through the built binary with the ignored spelling as the control, decision 5's cap
 *      read from the THREAT-MODEL.md page it links to and compared with the built refusal (never
 *      hard-coded) with `(ab|cd)+x` as the negative control, and decision 6's named-but-unreadable half
 *      deferred to the file that owns it (test/lexicon-unreadable.test.js, TMUX-112) rather than
 *      re-derived. 25 cases → 40, and the page's parsed share 25.1% → 46.0%.
 *
 * ── §2's three sampling promises ───────────────────────────────────────────────────────
 *
 * After §1, promise 4 was the only one of §2's numbered promises held to anything (TMUX-143 drives it),
 * and promises 1-3 were the last unparsed region of this page that described a shipped verb's BEHAVIOUR
 * — 447 chars, with the evidence-per-rule paragraph beneath them at 262. All three were FALSE, each
 * measured on the built code 2026-09-21 on the pushed 5f4a819 (scratch/ga-fire-2026-09-21-06Z/probe/):
 * promise 1 named `ledger history` among what the verb samples, and the built calibrate case builds its
 * inputs from `listSessionsDetailed()` + `capturePane(name, 40)` alone — a home whose ledger held two
 * `session.spawned` events carrying `data.task = "probe"` produced a report with `spawn`, `ledger`,
 * `event`, `task` and `probe` each ABSENT, while `waste` on that same home printed both sessions;
 * promise 2 made the prompt glyph conditional on "sessions that stopped advancing", and
 * `CalibrateInput.looksStalled` is read by NOTHING (1 hit in src/, 0 in test/) — `false`, `true` and
 * absent give byte-identical reports; promise 3 promised "the pane line" as every rule's evidence, and a
 * prompt rule's `evidence.sample` is the bucket KEY `glyph:❯` with the planted line nowhere in the JSON.
 * Parents and secret shapes DO honour promise 3, which is what made this a prose correction: *prose
 * before parse*, with no `src/` byte moved.
 *
 * One more region is read as data, cut to its own markers between §2's usage block and the layers table
 * so every region above is byte-unchanged:
 *  (l) the four promises as a LIST — the count asserted so a deleted one fails rather than leaving a case
 *      driving whichever prose is third — and THREE lists out of it, because the three promises answer to
 *      three different live authorities: promise 1's sources to what the built `case "calibrate":` body
 *      reads (`tmux.` calls set-equal in both directions, a source with no authority refused BY NAME, and
 *      the ledger asserted read by nothing there) plus a DRIVE through the built binary on a home whose
 *      ledger carries events with `waste` as the positive control; promise 2's three clustering criteria
 *      one case each on the built `calibrate` (the shared-parent threshold with the orphan note, four
 *      glyph shapes proposing where a bare numbered option does not, and the credential screen's length,
 *      entropy and hint-on-the-KEY); promise 3's evidence fields set-equal with the keys of `evidence` on
 *      every proposal kind, its per-kind sentence driven (a parent's `@agent_parent=` line, a charset
 *      sketch, the glyph — and the planted pane line and token both asserted ABSENT from the whole JSON),
 *      and the evidence-per-rule paragraph driven as the draft tracing back to proposals that carry
 *      evidence, with a credential shape reported rather than drafted.
 * Seven plants, each watched RED against a control re-measured on the same tree copy at 52/52
 * (scratch/ga-fire-2026-09-21-08Z/red/): the page naming the ledger again → 52/50/2, promise 2's stall
 * clause back → 52/51/1, promise 3's pane line back → 52/49/3, a promise deleted from the list →
 * 52/42/10; and three on the BUILT side, which is what keeps the parse from being one-sided — calibrate
 * copying the pane line into a prompt's evidence → 52/51/1, calibrate HONOURING `looksStalled` →
 * 52/51/1, and the CLI's calibrate case growing a ledger read → 52/51/1, the direction that matters most.
 * 40 cases → 52, and the page's parsed share 46.0% (6355 of 13819 normalized chars) → 50.1% (7433 of
 * 14825, the denominator grown by the paragraph §2 now carries about its own parse).
 *
 * Run: node --test test/agnostic-contract.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSameSet } from "./helpers/mcp-contract.js";
import { shippedTypeMembers, stripComments } from "./helpers/ledger-events.js";
import { ticks } from "./helpers/versioning-doc.js";
import { declaredLexiconShape } from "./helpers/versioning-doc.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";
after(() => removeTempHomes()); // every home this file made, once its last test has run
import {
  declaredLexicons,
  declaredUsage,
  declaredLayers,
  declaredAudiences,
  declaredSkills,
  declaredDecisions,
  declaredOptOuts,
  declaredPromises,
  decision,
  promise,
  promiseSources,
  promiseCriteria,
  promiseEvidence,
  exampleComments,
  exampleConfig,
  exampleKeys,
  lexiconExample,
  lexiconTable,
  regionOf,
  stripJsonc,
  cells,
  dropParentheticals,
  TABLE_START,
  TABLE_END,
  TABLE_HEADER,
  USAGE_START,
  NO_AUTO_APPLY,
  LAYERS_START,
  LAYERS_HEADER,
  LAYERS_END,
  AUDIENCES_START,
  AUDIENCES_HEADER,
  SKILLS_START,
  SKILLS_END,
  SECTION_START,
  INTRO_START,
  DECISIONS_START,
  DECISIONS_END,
  PROMISES_START,
  PROMISES_END,
  EVIDENCE_RULE,
} from "./helpers/agnostic-doc.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_REL = "docs/AGNOSTIC-DESIGN.md";
const DOC = readFileSync(join(ROOT, DOC_REL), "utf8");

/** The rows this suite holds an authority for, keyed by the `Where` path that names the module. */
const AUTHORITIES = new Map([
  ["core/monitor.ts", "resolveProfiles({})'s chain"],
  ["core/engagement.ts", "the parent predicate computeEngagement runs"],
  ["core/redact.ts", "the markers redact() emits"],
]);

/** The row whose `Where` cell names `where`, asserted present so a case cannot measure nothing. */
function row(where) {
  const rows = declaredLexicons(DOC);
  const found = rows.find((r) => r.where === where);
  assert.ok(found,
    `${DOC_REL}'s three-lexicon table no longer carries a row whose Where cell is \`${where}\` (it names ${rows.map((r) => r.where).join(", ")}) — the row this case holds against ${AUTHORITIES.get(where)} is gone, so the case would measure nothing`);
  return found;
}

/** `dist/` + a row's `Where` cell: the built module that must answer for that row's vocabulary. */
function builtPath(where) {
  const rel = join("dist", where.replace(/\.ts$/, ".js"));
  assert.ok(existsSync(join(ROOT, rel)),
    `${DOC_REL}'s Where cell names \`${where}\` and ${rel} does not exist — is the tree built? refusing to judge that row's vocabulary against nothing`);
  return rel;
}

/**
 * stripComments() — comments removed, string and template literals kept — is imported from
 * test/helpers/ledger-events.js, beside builtJs(). It lived HERE as a private copy byte-identical to
 * test/versioning-contract.test.js's until TMUX-147: three suites read the same built JS, so a fix to one
 * strip left the others judging that tree by the older rule. Measurement at the definition.
 */

/**
 * The non-session-parent vocabulary the BUILT module carries, in its two shapes: the literals of
 * `NON_SESSION_PARENTS` and the top-level alternatives of `NON_SESSION_PARENT_RE`. Both consts are
 * module-private (dist/core/engagement.js exports only `ENGAGEMENT_RANK`, `computeEngagement` and the
 * configurator), so the built source IS the enumeration — there is no getter to ask. Takes the JS as
 * TEXT so a case can plant a sixth literal without touching dist/.
 */
function shippedParentVocabulary(js) {
  const code = stripComments(js);
  const set = /NON_SESSION_PARENTS = new Set\(\[([^\]]*)\]\)/.exec(code);
  assert.ok(set, "dist/core/engagement.js no longer assigns NON_SESSION_PARENTS = new Set([…]) — refusing to judge the table's non-session-parent row against nothing");
  const re = /NON_SESSION_PARENT_RE = \/(.+?)\/[a-z]*;/.exec(code);
  assert.ok(re, "dist/core/engagement.js no longer assigns NON_SESSION_PARENT_RE = /…/ — refusing to judge the table's non-session-parent row against nothing");
  const literals = [...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const alternatives = re[1].split("|").filter(Boolean);
  assert.ok(literals.length > 0 && alternatives.length > 0,
    `the built parent vocabulary parsed as ${literals.length} literals and ${alternatives.length} pattern alternatives — an empty live side is a hard failure, not a pass`);
  return [...literals, ...alternatives];
}

/** Every provider-named `[REDACTED_*]` marker the built redaction module emits. */
function shippedRedactionMarkers(js) {
  const markers = [...new Set([...stripComments(js).matchAll(/\[REDACTED_[A-Z_]+\]/g)].map((m) => m[0]))];
  assert.ok(markers.length > 0,
    "dist/core/redact.js emits no provider-named [REDACTED_*] marker — refusing to judge the table's provider set against nothing");
  return markers;
}

/**
 * One fixture per entry row 2 declares: a parent name that IS an instance of that entry. The three
 * `watchdog`/`daemon`/`supervisor` entries are substring patterns, so the fixtures are spelled the way
 * our own fleet spells them (the 27-of-31 orphan bug's real names); the last two are anchored, so each
 * carries a NEAR-MISS that contains the token away from its anchor and must stay ORPHANED.
 */
const PARENT_FIXTURES = new Map([
  ["operator", { parent: "operator" }],
  ["user", { parent: "user" }],
  ["cron", { parent: "cron" }],
  ["systemd", { parent: "systemd" }],
  ["unknown", { parent: "unknown" }],
  ["watchdog", { parent: "cron-watchdog" }],
  ["daemon", { parent: "telegram-daemon" }],
  ["supervisor", { parent: "fleet-supervisor" }],
  ["-loop$", { parent: "nightly-cron-loop", nearMiss: "my-loop-runner" }],
  ["^loop-", { parent: "loop-ralph", nearMiss: "ralph-loop-a" }],
]);

/**
 * One sample per token row 3 declares, and what `redact()` must return for it. The six provider names
 * carry the MARKER they map to; the four envelope shapes carry the redacted line they become, because
 * their replacement keeps the name and the separator. The two must not be conflated: the OpenAI rule's
 * marker is provider-NEUTRAL (`[REDACTED_API_KEY]`) while the api-key envelope emits
 * `api_key=[REDACTED]`.
 */
const REDACT_FIXTURES = new Map([
  ["AWS", { sample: "AKIAIOSFODNN7EXAMPLE", marker: "[REDACTED_AWS_KEY]" }],
  ["GitHub", { sample: "ghp_abcdefghijklmnopqrstuvwxyz0123456789", marker: "[REDACTED_GH_TOKEN]" }],
  ["Slack", { sample: "xoxb-123456789012-abcdefghijkl", marker: "[REDACTED_SLACK_TOKEN]" }],
  ["OpenAI", { sample: "sk-abcdefghijklmnopqrstuvwxyz0123", marker: "[REDACTED_API_KEY]" }],
  ["JWT", { sample: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZ2VudCJ9.ZHVtbXlzaWduYXR1cmVfbm90X3JlYWw", marker: "[REDACTED_JWT]" }],
  ["PEM", { sample: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----", marker: "[REDACTED_PRIVATE_KEY]" }],
  ["Authorization: Bearer", { sample: "Authorization: Bearer abcdefghijklmnop", expect: "Authorization: Bearer [REDACTED]" }],
  ["Authorization: Basic", { sample: "Authorization: Basic dXNlcjpwYXNzd29yZA==", expect: "Authorization: Basic [REDACTED]" }],
  ["X-Api-Key:", { sample: "X-Api-Key: abcdefghijklmnop", expect: "X-Api-Key: [REDACTED]" }],
  ["api_key=", { sample: "api_key=abcdefghijklmnop", expect: "api_key=[REDACTED]" }],
]);

/** The table's region as a standalone doc STRING with `edit` applied — drift without a tree copy. */
function tableDoc(edit) {
  return `${edit(lexiconTable(DOC).join("\n"))}\n\n${TABLE_END} (test/agnostic-contract.test.js).\n`;
}

/**
 * A plant anchor, asserted present in the table's region BEFORE anything is written. An unapplied plant
 * reads exactly like an invisible one: the 14Z fire's first positive control asserted a row it never
 * found (README's table is indented inside a bullet), applied nothing, and reported its parent's
 * numbers as a verdict. Measured again here — plant B, the row-1 deletion, removes the very text the
 * duplicate-refusal case below anchors on, and without this guard that case reported a missing expected
 * exception instead of a stale fixture (probe/red/B.log, before the guard).
 */
function anchor(text) {
  assert.ok(lexiconTable(DOC).join("\n").includes(text),
    `fixture stale: this case plants drift by editing "${text}", which ${DOC_REL}'s three-lexicon table no longer carries verbatim — the plant would apply nothing and the rule below would be asserted against the shipped page`);
  return text;
}

// ── row 1: the CLIs we run ──────────────────────────────────────────────────────────────────────

test("agnostic: row 1's declared CLI names ARE resolveProfiles()'s chain less the fallback, by name and by position", async () => {
  const declared = row("core/monitor.ts");
  const { resolveProfiles } = await import(join(ROOT, builtPath(declared.where)));
  const chain = resolveProfiles({}).map((p) => p.name);
  assert.ok(chain.length > 0, "resolveProfiles({}) returned an empty chain — the built package did not answer; refusing to compare the table against nothing");
  const phantom = declared.vocab.filter((n) => !chain.includes(n)).sort();
  assert.deepEqual(phantom, [],
    `${DOC_REL} names ${phantom.join(", ")} as a CLI we run and resolveProfiles({}) returns no profile of that name (${chain.join(" → ")}) — the page that states the universality rule would be promising a lexicon that does not ship`);
  // The row says "the three CLIs we run" and the chain has four members: the fourth is the fallback,
  // not a CLI anyone runs. Holding that claim means naming the one undeclared member rather than
  // asserting a set equality that is RED on the shipped page (README declares all four, TMUX-140).
  const undeclared = chain.filter((n) => !declared.vocab.includes(n));
  assert.deepEqual(undeclared, ["generic-shell"],
    `resolveProfiles({}) returns ${undeclared.join(", ")} beyond what ${DOC_REL}'s first row declares — the only member this table may leave out is the generic-shell fallback, which is not a CLI anyone runs; every other profile in the chain is vocabulary of ours that this page must name`);
  assert.equal(chain[chain.length - 1], "generic-shell",
    `the generic-shell fallback is not LAST in resolveProfiles({})'s chain (${chain.join(" → ")}) — classification is first-match-wins, so a fallback that is not last never runs and the row's "three CLIs" claim stops being true`);
});

// ── row 2: what a legitimate non-tmux supervisor is called ──────────────────────────────────────

test("agnostic: every declared non-session-parent entry is honoured by the shipped predicate — one fixture each, with a control that IS orphaned", async () => {
  const declared = row("core/engagement.ts");
  const { computeEngagement } = await import(join(ROOT, builtPath(declared.where)));
  const { LedgerIndex } = await import(join(ROOT, "dist/analytics/ledger-index.js"));
  const index = new LedgerIndex(tempHome("ta-agnostic-"), 0);
  const sessions = [{ session: "control", state: "IDLE", attached: false, parent: "dead-tmux-session" }];
  declared.vocab.forEach((token, i) => {
    const probe = PARENT_FIXTURES.get(token);
    assert.ok(probe,
      `${DOC_REL} declares \`${token}\` as a legitimate non-tmux supervisor and no fixture in PARENT_FIXTURES drives it — the page would be promising an adopter a vocabulary nothing exercises: add the fixture that proves the predicate honours it, or stop declaring it`);
    assert.match(probe.parent, new RegExp(token, "i"),
      `PARENT_FIXTURES drives \`${token}\` with the parent "${probe.parent}", which is not an instance of that token — a fixture that does not match what it stands for measures a different entry`);
    sessions.push({ session: `s${i}`, state: "IDLE", attached: false, parent: probe.parent });
    if (probe.nearMiss) sessions.push({ session: `n${i}`, state: "IDLE", attached: false, parent: probe.nearMiss });
  });
  const got = computeEngagement(sessions, index, 900, Date.now());
  assert.equal(got.get("control").engagement, "ORPHANED",
    "a parent naming a tmux session that is gone must read ORPHANED — without that control, every case below would pass on a predicate that simply never orphans anything");
  let checked = 0;
  declared.vocab.forEach((token, i) => {
    const probe = PARENT_FIXTURES.get(token);
    assert.equal(got.get(`s${i}`).engagement, "PARKED",
      `${DOC_REL} declares \`${token}\` a legitimate non-tmux supervisor and a session whose parent is "${probe.parent}" reads ${got.get(`s${i}`).engagement} — an adopter reading this table is told that vocabulary is honoured; ORPHANED here is the 27-of-31 mislabelling the row exists to explain`);
    if (probe.nearMiss) {
      assert.equal(got.get(`n${i}`).engagement, "ORPHANED",
        `\`${token}\` is written as an ANCHORED pattern and the parent "${probe.nearMiss}", which carries the token away from that anchor, is also treated as a supervisor — the row's spelling would then be claiming an anchor the predicate does not have`);
    }
    checked += 1;
  });
  assert.equal(PARENT_FIXTURES.size, checked,
    `PARENT_FIXTURES carries ${PARENT_FIXTURES.size} fixtures for the ${checked} entries ${DOC_REL} declares — a fixture for an entry the page no longer names is drift of its own`);
});

test("agnostic: the ten entries the BUILT engagement module carries are the ten the table declares (both directions)", () => {
  const declared = row("core/engagement.ts");
  const js = readFileSync(join(ROOT, builtPath(declared.where)), "utf8");
  assertSameSet(declared.vocab, shippedParentVocabulary(js), {
    declaredAs: `${DOC_REL}'s non-session-parent row`,
    liveAs: "dist/core/engagement.js's built-in NON_SESSION_PARENTS / NON_SESSION_PARENT_RE",
  });
  // The direction that matters most, proved on the built source as a STRING: vocabulary the code grows
  // and the universality doc never mentions must fail as a DECLARATION failure naming this page.
  const planted = shippedParentVocabulary(js.replace('"unknown"]', '"unknown", "jenkins"]'));
  assert.ok(planted.includes("jenkins"),
    "planting a sixth literal in the built source did not change what the live side reads — then this case cannot see a name the code grows, and the comparison above is vacuous");
  assert.throws(() => assertSameSet(declared.vocab, planted, {
    declaredAs: `${DOC_REL}'s non-session-parent row`,
    liveAs: "dist/core/engagement.js's built-in NON_SESSION_PARENTS / NON_SESSION_PARENT_RE",
  }), /jenkins/);
});

// ── row 3: the secret shapes ────────────────────────────────────────────────────────────────────

test("agnostic: every declared secret shape is honoured — each provider name mapped to the marker redact() emits, each envelope shape to its redacted line", async () => {
  const declared = row("core/redact.ts");
  const { redact } = await import(join(ROOT, builtPath(declared.where)));
  let checked = 0;
  for (const token of declared.vocab) {
    const probe = REDACT_FIXTURES.get(token);
    assert.ok(probe,
      `${DOC_REL} declares \`${token}\` as a secret shape this tool redacts and no fixture in REDACT_FIXTURES drives it — the failure mode of a wrong entry here is silent non-redaction that writes plaintext credentials to disk, so a row may not stand on prose alone`);
    assert.equal(redact(probe.sample), probe.marker ?? probe.expect,
      `${DOC_REL} declares \`${token}\` and redact() does not turn a sample of that shape into ${probe.marker ?? probe.expect} — it returned ${JSON.stringify(redact(probe.sample))}`);
    checked += 1;
  }
  assert.equal(REDACT_FIXTURES.size, checked,
    `REDACT_FIXTURES carries ${REDACT_FIXTURES.size} fixtures for the ${checked} shapes ${DOC_REL} declares — a fixture for a shape the page no longer names is drift of its own`);
  // Six provider names, four envelope shapes: the split is asserted, not assumed, so a provider that
  // quietly became an envelope entry (or the reverse) fails instead of passing under the other's rule.
  const providers = declared.vocab.filter((t) => REDACT_FIXTURES.get(t).marker);
  assert.equal(providers.length, 6, `${DOC_REL}'s redaction row declares ${providers.length} provider names (${providers.join(", ")}) where the sentence says six — a provider set the page miscounts is exactly what an adopter checks their own cloud against`);
  assert.equal(declared.vocab.length - providers.length, 4, `${DOC_REL}'s redaction row declares ${declared.vocab.length - providers.length} HTTP envelope shapes where TMUX-95 shipped four`);
});

test("agnostic: every provider-named marker the BUILT redaction module emits traces back to a name the table declares (both directions)", () => {
  const declared = row("core/redact.ts");
  const js = readFileSync(join(ROOT, builtPath(declared.where)), "utf8");
  const fromDoc = declared.vocab.map((t) => REDACT_FIXTURES.get(t)?.marker).filter(Boolean);
  assertSameSet(fromDoc, shippedRedactionMarkers(js), {
    declaredAs: `the provider names ${DOC_REL}'s redaction row declares, by the marker each maps to`,
    liveAs: "dist/core/redact.js's built-in replacements",
  });
  // A seventh provider in the code and in no sentence is the silent-non-redaction case from the other
  // side: the adopter on a cloud we do not use is told the set is ours, and this page never grows.
  const planted = shippedRedactionMarkers(js.replace('"[REDACTED_JWT]"],', '"[REDACTED_JWT]"],\n    [/az-[0-9a-f]{32}/g, "[REDACTED_AZURE_KEY]"],'));
  assert.ok(planted.includes("[REDACTED_AZURE_KEY]"),
    "planting a provider marker in the built source did not change what the live side reads — then this case cannot see a provider the code grows, and the comparison above is vacuous");
  assert.throws(() => assertSameSet(fromDoc, planted, {
    declaredAs: `the provider names ${DOC_REL}'s redaction row declares, by the marker each maps to`,
    liveAs: "dist/core/redact.js's built-in replacements",
  }), /REDACTED_AZURE_KEY/);
});

test("agnostic: a shape the table does not declare passes through redact() unchanged (the negative control)", async () => {
  const { redact } = await import(join(ROOT, builtPath(row("core/redact.ts").where)));
  for (const plain of [
    "nightly-cron-loop: fire 123 finished, 394/394 green",
    "api_key_file=/srv/example/.config/agent.toml",
  ]) {
    assert.equal(redact(plain), plain,
      `redact() rewrote a pane line carrying no credential (${JSON.stringify(plain)}) — a rule that fires on ordinary output would make the whole read path unreadable, and the cases above would pass on a function that redacts everything`);
  }
});

// ── the Where column, and the parse's own rules ─────────────────────────────────────────────────

test("agnostic: the three Where cells resolve as src/ + the cell, and every row has a live authority", () => {
  const rows = declaredLexicons(DOC);
  for (const r of rows) {
    assert.match(r.where, /^core\/[a-z-]+\.ts$/,
      `${DOC_REL}'s Where cell \`${r.where}\` is not a src/core source path — the paragraph under the table says these are source paths, and the suite derives the built module from the same cell`);
    assert.ok(existsSync(join(ROOT, "src", r.where)),
      `${DOC_REL}'s Where cell names \`${r.where}\` and src/${r.where} does not exist — the path authority is the repo tree (the npm tarball carries dist/ and 0 src/ files), so a reader following this cell lands nowhere`);
    builtPath(r.where);
  }
  assertSameSet(rows.map((r) => r.where), [...AUTHORITIES.keys()], {
    declaredAs: `${DOC_REL}'s three-lexicon table`,
    liveAs: "the rows this suite holds a live authority for (AUTHORITIES)",
  });
});

test("agnostic: the table's three markers are asserted present — a reworded one is a hard failure, not a pass", () => {
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(TABLE_START, "The three lexicons:"))), /no longer introduces its three-lexicon table/);
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(TABLE_HEADER, "Lexicons:"))), /no longer carries the/);
  assert.throws(() => declaredLexicons(lexiconTable(DOC).join("\n")), /no longer followed by/,
    "with TABLE_END gone the region would run into the doc's other two tables and its jsonc example");
});

test("agnostic: the region stops at TABLE_END — the doc's other two tables and its jsonc example are not read", () => {
  const region = lexiconTable(DOC).join("\n");
  for (const header of ["| Layer | Who does it | Why there |", "| Audience | File | Contract it carries |"]) {
    assert.ok(DOC.includes(header),
      `fixture stale: ${DOC_REL} no longer carries the table header "${header}", so this case cannot prove the region stops before it`);
    assert.ok(!region.includes(header),
      `the three-lexicon region reaches "${header}" — that table's rows would be read as declared vocabulary`);
  }
  const vocab = declaredLexicons(DOC).flatMap((r) => r.vocab);
  for (const token of ["calibrate", "tmux-agent-calibrate", "k8s-job", "AGENTS.md", "my-cli", "boss", "azure-key"]) {
    assert.ok(DOC.includes(token), `fixture stale: ${DOC_REL} no longer mentions ${token} below the table, so this case cannot prove the parse stops short of it`);
    assert.ok(!vocab.includes(token),
      `${token} is declared vocabulary of the three-lexicon table — it lives below TABLE_END, in another table or in the lexicon example, where a name is an illustration and answers to no live authority`);
  }
});

test("agnostic: vocabulary is read from the THIRD cell only — a name in the Lexicon cell declares nothing", () => {
  const before = declaredLexicons(DOC).flatMap((r) => r.vocab);
  const STATES = "`BLOCKED`/`WORKING`/`ERROR`";
  assert.ok(lexiconTable(DOC).some((l) => l.includes(STATES)),
    `fixture stale: ${DOC_REL}'s first row no longer backticks ${STATES} in its Lexicon cell, so this case cannot prove those names are not read as vocabulary`);
  for (const state of ["BLOCKED", "WORKING", "ERROR"]) {
    assert.ok(!before.includes(state),
      `${state} parses as declared vocabulary — it is a real session state, but it is the Lexicon column's editorial prose about what the regexes look for, and no live authority answers for it`);
  }
  const planted = declaredLexicons(tableDoc((t) => t.replace(anchor("| Secret shapes to redact |"), "| Secret shapes to redact, e.g. `Azure` |")));
  assert.deepEqual(planted.flatMap((r) => r.vocab), before,
    "a backticked name added to a Lexicon cell changed the parsed vocabulary — the first-cell text is editorial, so a name there must declare nothing");
  // The Where cell is not a second declaration either: exactly one module answers for a row.
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(anchor("| `core/redact.ts` |"), "| `core/redact.ts` and `core/lexicon.ts` |"))), /backticks 2 paths in its Where cell/);
});

test("agnostic: a row splits on the pipes OUTSIDE backticks — row 3's old `Bearer|Basic` spelling reads as ONE cell", () => {
  const OLD = "| Secret shapes to redact | `core/redact.ts` | AWS, GitHub — **our** provider set; plus the envelope every token travels in (`Authorization: Bearer|Basic <cred>`, `X-Api-Key:` / `api_key=` / `*_API_KEY=` pairs) |";
  const cell = cells(OLD);
  assert.equal(cell.length, 3,
    `the old row 3 spelling split into ${cell.length} cells — a \`|\` inside a backticked token is part of the token, not a column boundary`);
  assert.ok(ticks(cell[2]).includes("Authorization: Bearer|Basic <cred>"),
    "the backticked envelope token did not survive as ONE token — the cell read desynchronized on the pipe inside it");
  // What a naive split returns, quoted: the third cell mis-columns and its "names" are punctuation runs.
  const naive = OLD.split("|").slice(1, -1).map((c) => c.trim());
  assert.deepEqual(ticks(naive[3]), [", ", " / ", " / "],
    "a naive split of the old row 3 no longer yields the punctuation runs this case exists to refuse — the fixture is stale, so it proves nothing about the backtick-aware read");
  // TMUX-133's rule is why the four shapes had to be lifted OUT of that parenthetical: inside one they
  // declare nothing at all, which is the same silence with the cell read correctly.
  assert.deepEqual(ticks(dropParentheticals(cell[2])), [],
    "the old row 3's envelope shapes survived the parenthetical rule — then lifting them out of the parenthetical was not what made them declarations");
  // A bare pipe OUTSIDE backticks is a real mis-columning and must be refused, not guessed at.
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(anchor("| `core/monitor.ts` |"), "| `core/monitor.ts` | pane | width |"))), /splits into \d+ cells rather than 3/);
});

test("agnostic: a parenthetical declares nothing — row 3's `*_API_KEY=` aside is prose about the four shapes", () => {
  const ASIDE = "(any `*_API_KEY=` spelling included)";
  assert.ok(lexiconTable(DOC).some((l) => l.includes(ASIDE)),
    `fixture stale: ${DOC_REL}'s redaction row no longer carries the aside ${ASIDE}, so this case cannot prove a parenthetical declares nothing`);
  const vocab = declaredLexicons(DOC).flatMap((r) => r.vocab);
  assert.ok(!vocab.includes("*_API_KEY="),
    "`*_API_KEY=` parses as a declared shape — it sits in a parenthetical, which is prose ABOUT the four shapes before it, and it has no fixture of its own");
  // And the rule is innermost-first to a fixpoint, so a nested aside cannot leak its contents either.
  const planted = declaredLexicons(tableDoc((t) => t.replace(anchor(ASIDE), "(any `*_API_KEY=` spelling included (even `X_PLANE_KEY=`))")));
  assert.deepEqual(planted.flatMap((r) => r.vocab), vocab,
    "a name inside a NESTED parenthetical parsed as declared vocabulary — the drop must run innermost-first to a fixpoint");
});

test("agnostic: an empty, duplicated or open-ended declaration is a hard failure, never a vacuous pass", () => {
  const ROWS = /^\| (?:Agent-CLI|Non-session|Secret).*$/gm;
  assert.equal((lexiconTable(DOC).join("\n").match(ROWS) ?? []).length, 3,
    `fixture stale: the row-deleting plant below matches ${(lexiconTable(DOC).join("\n").match(ROWS) ?? []).length} of ${DOC_REL}'s rows, not 3 — a plant that removes no row would leave the shipped table parsing normally and the assertion below expecting a throw it never gets`);
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(anchor("`claude-code`, `codex`, `aider`"), "claude-code, codex, aider"))),
    /parsed ZERO vocabulary tokens for `core\/monitor\.ts`/);
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(ROWS, ""))),
    /parsed ZERO table rows/);
  assert.throws(() => declaredLexicons(tableDoc((t) => t.replace(anchor("`codex`, `aider`"), "`codex`, `aider`, `codex`"))),
    /parses codex more than once/);
  assert.throws(() => declaredLexicons(tableDoc((t) => `${t}\n\nAlso \`gemini-cli\`, soon.`)),
    /between the last row of the three-lexicon table/);
});

test("agnostic: this file measures the SHIPPED default vocabulary — no lexicon is configured in this process", async () => {
  const { extraRedactionRuleCount } = await import(join(ROOT, builtPath("core/redact.ts")));
  assert.equal(extraRedactionRuleCount(), 0,
    "a lexicon's redact rules are installed in this process — row 3's cases would then be measuring an operator's vocabulary rather than the shipped default the table declares");
  // Row 2's authority is MODULE STATE: the engagement configurator replaces the whole predicate for the
  // process, and `parents.replace` drops the built-ins outright (test/lexicon.test.js:252). This regex
  // finds a CALL — the identifier followed by "(" — which is why its own source text here, where the
  // name is followed by an escape, does not match it.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.equal(self.match(/configureEngagement\s*\(/g), null,
    "this file calls the engagement configurator, which installs a lexicon's parent rules for the whole process — row 2's ten entries would then be measuring that lexicon rather than the shipped default; keep those cases in a file that configures nothing");
});

// ── §2 and §3: the live authorities ───────────────────────────────────────────────────

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");

/** { code, stdout, stderr } from the BUILT binary; each run is bounded so a red run cannot hang the suite. */
function cli(args, env, timeout = 20_000) {
  return new Promise((res) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) =>
      res({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

/**
 * A socket name whose server does not exist. `calibrate` reads the LIVE fleet, which on a developer's host
 * is whatever sessions happen to be running; a dead socket is an empty fleet, and the verb starts no server
 * for it (measured: exit 0, `sampled.sessions` 0, and /tmp/tmux-$UID/<name> never created). Every case that
 * drives the verb asserts that count, so a socket the binary did not honour fails loudly rather than
 * measuring this host's fleet.
 */
const deadSocket = () => `ta-agnostic-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
/** No ambient TMUX_AGENT_* may reach a driven case: DEFAULT_SERVER=1 would make --socket the live fleet. */
const PINNED = { TMUX_AGENT_DEFAULT_SERVER: "0", TMUX_AGENT_SOCKET: undefined, TMUX_AGENT_LEXICON: undefined };
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * The flags the BUILT CLI declares for `verb` in its own usage table. dist/bin/tmux-agent.js is an entry
 * point rather than a library — the table and the `case` labels are module-private, so the built source IS
 * the authority and there is nothing to import. Takes the JS as TEXT so a case can plant a flag the CLI
 * serves without touching dist/.
 */
function shippedVerbFlags(js, verb) {
  const entry = new RegExp(`\\n\\s*${verb}: \\{([^}]*)\\},`).exec(js);
  assert.ok(entry, `dist/bin/tmux-agent.js's usage table no longer carries a \`${verb}: { … }\` entry — refusing to judge ${DOC_REL}'s usage line against nothing`);
  const flags = /flags: "([^"]*)"/.exec(entry[1]);
  assert.ok(flags, `dist/bin/tmux-agent.js's \`${verb}\` entry declares no flags string — refusing to judge ${DOC_REL}'s usage line against nothing`);
  const read = [...flags[1].matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
  assert.ok(read.length > 0, `dist/bin/tmux-agent.js declares \`${verb}\`'s flags as ${JSON.stringify(flags[1])}, from which no flag parses — an empty live side would let a usage line that declares nothing pass`);
  return read;
}

/** The verbs the built CLI dispatches: a `case "x":` label is how a verb gets run at all (TMUX-83's observable). */
function dispatchedVerbs(js) {
  const labels = [...js.matchAll(/^\s*case "([a-z]+)":/gm)].map((m) => m[1]);
  assert.ok(labels.length > 0, 'found no `case "verb":` labels in dist/bin/tmux-agent.js — is the tree built? refusing to judge this page against nothing');
  return labels;
}

/** Every flag the built CLI reads: the two registries, plus any direct flag()/has() lookup (README's rule). */
function flagRegistry(js) {
  const read = [
    ...[...js.matchAll(/(?:VALUE|BOOL)_FLAGS = new Set\(\[([^\]]*)\]\)/g)].flatMap((m) => [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1])),
    ...[...js.matchAll(/\b(?:flag|has)\("([a-z-]+)"\)/g)].map((m) => m[1]),
  ];
  assert.ok(read.length > 0, "found no flag reads in dist/bin/tmux-agent.js — is the tree built? refusing to judge a flag's absence against nothing");
  return read;
}

/** The `<dir>/<prefix>*` glob §3's audiences table declares for the skills, read from that cell. */
function skillGlob(doc) {
  const globs = declaredAudiences(doc).flatMap((r) => ticks(r.file)).filter((t) => t.endsWith("*"));
  assert.equal(globs.length, 1,
    `${DOC_REL}'s audiences table backticks ${globs.length} file globs (${globs.join(", ") || "none"}) where exactly one names the skill directories — the live set the skills list is compared against is resolved FROM this cell, so a cell that stopped carrying it would compare the list against a directory this page never named`);
  const m = /^(.*)\/([A-Za-z0-9._-]+)\*$/.exec(globs[0]);
  assert.ok(m, `${DOC_REL}'s audiences table declares the skills as \`${globs[0]}\`, which is not a <dir>/<prefix>* glob — the suite resolves the directory and the prefix from this cell`);
  return { dir: m[1], prefix: m[2], as: globs[0] };
}

/**
 * The skill directories the REPO TREE carries for that glob. The tree is the authority, not the tarball:
 * `.claude/` is tracked in git and package.json's files[] ships dist/ + five root files, so these
 * directories are in no package — the same distinction case (d) makes for the `src/` paths.
 */
function shippedSkillDirs({ dir, prefix, as }) {
  const abs = join(ROOT, dir);
  assert.ok(existsSync(abs),
    `${DOC_REL} sends an adopter's agent to \`${as}\` and ${dir}/ does not exist in this repo — the authority is the repo tree, so that cell points nowhere`);
  const names = readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith(prefix)).map((d) => d.name).sort();
  assert.ok(names.length > 0,
    `no directory under ${dir}/ matches the prefix \`${prefix}\` this page declares — refusing to judge the skills list against an empty set`);
  return names;
}

/** CONTRIBUTING's numbered design rules — the list §3's AGENTS.md row states a count for. */
function numberedDesignRules() {
  const page = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8");
  const section = /^## Design rules[^\n]*\n([\s\S]*?)(?=^## )/m.exec(page);
  assert.ok(section, "CONTRIBUTING.md no longer carries a `## Design rules` section — refusing to judge the count this page states against nothing");
  const rules = [...section[1].matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)].map((m) => ({ n: Number(m[1]), title: m[2] }));
  assert.ok(rules.length > 0, "CONTRIBUTING.md's `## Design rules` section carries no numbered rule — an empty live side is a hard failure, not a pass");
  assert.deepEqual(rules.map((r) => r.n), rules.map((_, i) => i + 1),
    `CONTRIBUTING.md's design rules are numbered ${rules.map((r) => r.n).join(", ")} rather than 1..${rules.length} — a list this page states a count for has to be the list the count is about`);
  return rules;
}

/** The rows of AGENTS.md's own test-layers table, each as the one artefact its first cell names. */
function agentsTestLayers() {
  const HEADER = "| Layer | Only it can catch |";
  const lines = readFileSync(join(ROOT, "AGENTS.md"), "utf8").split("\n");
  const at = lines.findIndex((l) => l.includes(HEADER));
  assert.ok(at > -1, `AGENTS.md no longer carries its "${HEADER}" table — refusing to judge the layer count ${DOC_REL} states against nothing`);
  const rows = [];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s*\|/.test(line)) break;
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue;
    const cell = cells(line);
    assert.equal(cell.length, 2, `AGENTS.md's layers row "${cell[0]}" splits into ${cell.length} cells rather than 2`);
    const named = ticks(cell[0]);
    assert.equal(named.length, 1,
      `AGENTS.md's layers row "${cell[0]}" backticks ${named.length} artefacts where a layer names exactly one file or npm script — a row naming none is a layer a reader cannot run`);
    rows.push(named[0]);
  }
  assert.ok(rows.length > 0, "AGENTS.md's layers table carries no rows — an empty live side is a hard failure, not a pass");
  return rows;
}

/** A layer's artefact resolved in the tree: an `npm run` script package.json declares, a glob with a match, or a path. */
function layerArtefactExists(named) {
  const script = /^npm run ([A-Za-z0-9:_-]+)$/.exec(named);
  if (script) return Boolean(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts?.[script[1]]);
  if (named.includes("*")) {
    const pat = named.slice(named.lastIndexOf("/") + 1);
    const re = new RegExp(`^${pat.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    const dir = join(ROOT, dirname(named));
    return existsSync(dir) && readdirSync(dir).some((f) => re.test(f));
  }
  return existsSync(join(ROOT, named));
}

/**
 * A plant anchor in the page as a whole, asserted present EXACTLY ONCE before anything is written. An
 * unapplied plant reads exactly like an invisible one, and a plant that applies twice is a different edit
 * than the one the case describes (the same trap `anchor()` above exists for, on the first table's region).
 */
function once(text) {
  const n = DOC.split(text).length - 1;
  assert.equal(n, 1,
    `fixture stale: ${DOC_REL} carries "${text.slice(0, 64)}" ${n} times rather than once — the plant below would apply nothing, or in two places, and the rule would be asserted against the shipped page`);
  return text;
}

// ── (f) §2's usage line ≡ the built CLI's own table for that verb ────────────────────────────────

test("agnostic: §2's usage line declares exactly the flags the built CLI serves for that verb, both directions, and the verb is dispatched", () => {
  const usage = declaredUsage(DOC);
  const bin = readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8");
  assert.ok(dispatchedVerbs(bin).includes(usage.verb),
    `${DOC_REL} tells an adopter to type \`${usage.line}\` and dist/bin/tmux-agent.js dispatches no case for ${usage.verb} — the page that explains how to teach the tool their fleet would open with a verb the binary refuses`);
  assertSameSet(usage.flags, shippedVerbFlags(bin, usage.verb), {
    declaredAs: `${DOC_REL}'s §2 usage line (\`${usage.line}\`)`,
    liveAs: `dist/bin/tmux-agent.js's own usage table for \`${usage.verb}\``,
  });
  // The direction that matters most, proved on the built source as a STRING: a flag the code grows and
  // this page never names must fail as a DECLARATION failure naming this page, not as an internal one.
  const planted = shippedVerbFlags(bin.replace(`${usage.verb}: { args: [], flags: "`, `${usage.verb}: { args: [], flags: "[--limit N] `), usage.verb);
  assert.ok(planted.includes("limit"),
    "planting a flag in the built usage table did not change what the live side reads — then this case cannot see a flag the CLI grows, and the comparison above is vacuous");
  assert.throws(() => assertSameSet(usage.flags, planted, {
    declaredAs: `${DOC_REL}'s §2 usage line`,
    liveAs: "dist/bin/tmux-agent.js's own usage table",
  }), /limit/);
});

test("agnostic: the sampling flag §2 promised until TMUX-143 is declared by nothing and refused by the built binary — exit 64, the home never created", async () => {
  const GONE = "--sample";
  assert.ok(!DOC.includes(GONE),
    `${DOC_REL} names ${GONE} again — for as long as this page existed it told an adopter to type that flag while the binary refused it; the fix was to remove the promise, never to implement it`);
  const bin = readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8");
  assert.ok(!flagRegistry(bin).includes(GONE.slice(2)),
    `dist/bin/tmux-agent.js now reads ${GONE} — the card that removed this promise from the page explicitly did not authorise adding the feature; if it is wanted, it is a flag with its own card, its own usage line and its own test`);
  // and the refusal an adopter following the old page would have hit, driven rather than asserted
  const home = join(tempHome("ta-agnostic-gone-"), "never");
  const r = await cli(["--socket", deadSocket(), declaredUsage(DOC).verb, GONE, "40"], { ...PINNED, TMUX_AGENT_HOME: home });
  assert.equal(r.code, 64, `\`${declaredUsage(DOC).verb} ${GONE} 40\` exited ${r.code}, want 64 (EX_USAGE) — stderr: ${JSON.stringify(r.stderr.slice(0, 200))}`);
  assert.match(r.stderr, new RegExp(`^${GONE}: unknown flag`), `the refusal names the flag as typed: ${r.stderr.slice(0, 200)}`);
  assert.equal(r.stdout, "", "a refused flag wrote a calibration report to stdout");
  assert.equal(existsSync(home), false, "the refusal created the home — the flag is judged before anything is touched");
});

// ── (g) "Never auto-apply", DRIVEN against the built binary ──────────────────────────────────────

test("agnostic: §2's \"Never auto-apply\" is DRIVEN — the draft lands at 0600 where it was asked for and the home's lexicon.json does not move a byte", async () => {
  assert.ok(DOC.includes(NO_AUTO_APPLY),
    `fixture stale: ${DOC_REL} no longer promises ${NO_AUTO_APPLY} — this case exists to hold that promise, and without it there is nothing to drive`);
  const usage = declaredUsage(DOC);
  assert.ok(usage.flags.includes("out"),
    `fixture stale: ${DOC_REL}'s usage line no longer declares --out, the flag this case drives to prove the write goes where it was asked for and nowhere else`);
  const home = mkdtempSync(join(tmpdir(), "ta-agnostic-apply-"));
  const LEX = `${JSON.stringify({ version: 1, profiles: [{ name: "my-cli", blocked: ["^awaiting"] }] }, null, 2)}\n`;
  const lexicon = join(home, "lexicon.json");
  writeFileSync(lexicon, LEX);
  const before = sha(lexicon);
  const draft = join(home, "draft.json");
  const S = deadSocket();
  try {
    const r = await cli(["--socket", S, usage.verb, "--out", draft], { ...PINNED, TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `\`${usage.verb} --out FILE\` exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    assert.ok(existsSync(draft), `\`${usage.verb} --out ${draft}\` wrote no file at the path it was given: ${r.stderr.slice(0, 300)}`);
    assert.equal(statSync(draft).mode & 0o777, 0o600,
      `the draft is mode ${(statSync(draft).mode & 0o777).toString(8)} — it carries pane text from an operator's fleet, so 0600 is the promise this page and the CLI header both make`);
    assert.equal(JSON.parse(readFileSync(draft, "utf8")).sampled.sessions, 0,
      "the pinned socket was not honoured: the draft sampled sessions from this host's live fleet, so this case would be measuring whatever happens to be running");
    assert.equal(sha(lexicon), before,
      `${DOC_REL} promises ${NO_AUTO_APPLY} and \`${usage.verb} --out FILE\` changed $TMUX_AGENT_HOME/lexicon.json — a draft written straight into an operator's config is the misclassifying-fleet-view failure this page says is worse than no fleet view`);
    assert.equal(readFileSync(lexicon, "utf8"), LEX, "the home's lexicon.json is no longer byte-identical");
    // with no --out the report goes to stdout, and the home's lexicon is still where it was
    const bare = await cli(["--socket", S, usage.verb], { ...PINNED, TMUX_AGENT_HOME: home });
    assert.equal(bare.code, 0, `a bare \`${usage.verb}\` exited ${bare.code}: ${bare.stderr.slice(0, 300)}`);
    assert.equal(JSON.parse(bare.stdout).sampled.sessions, 0, "a bare calibrate did not print a report over the pinned socket");
    assert.equal(sha(lexicon), before,
      `${DOC_REL} promises ${NO_AUTO_APPLY} and a bare \`${usage.verb}\`, which only reports, changed $TMUX_AGENT_HOME/lexicon.json`);
    // ledger/ and logs/ ARE bootstrapped in the home, which is why the promise is about the lexicon by sha
    // rather than about the home's file set (that would be false on a passing run).
    assert.ok(existsSync(join(home, "ledger")), "fixture note: the verb no longer bootstraps the home, so the sha rule above is stricter than it needs to be");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── (h) §2's layers table: three rows, each artefact held to one live authority ──────────────────

test("agnostic: §2's layers table is read as 3 rows — every artefact a row names resolves to exactly one live authority, and the human row names none", () => {
  const rows = declaredLayers(DOC);
  const bin = readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8");
  const verbs = dispatchedVerbs(bin);
  const skills = shippedSkillDirs(skillGlob(DOC));
  const usage = declaredUsage(DOC);
  const resolved = rows.map((r) => {
    if (r.names.length === 0) {
      assert.match(r.who, /human/i,
        `${DOC_REL}'s layers row "${r.layer}" names no artefact and its "Who does it" cell is "${r.who}" — the only row of this split that may answer to nothing is the human's; every other layer is a promise about something that ships`);
      return "none";
    }
    const [name] = r.names;
    const where = [verbs.includes(name) && "verb", skills.includes(name) && "skill"].filter(Boolean);
    assert.equal(where.length, 1,
      `${DOC_REL}'s layers row "${r.layer}" names \`${name}\`, which resolves to ${where.join(" and ") || "NOTHING"} — a name in this table must be either a verb dist/bin/tmux-agent.js dispatches (${verbs.length} of them) or a skill directory this repo ships (${skills.join(", ")}), exactly one of the two`);
    if (where[0] === "verb") {
      assert.equal(name, usage.verb,
        `${DOC_REL}'s layers row "${r.layer}" names the verb \`${name}\` while §2's own usage line above it declares \`${usage.verb}\` — one verb, two sites in the same section, so a rename that touches one of them must fail`);
    }
    return where[0];
  });
  assert.deepEqual(resolved, ["verb", "skill", "none"],
    `${DOC_REL}'s layers table resolves as ${resolved.join(" → ")} where the split this page states is deterministic code → an agent → a human, one row each — a deleted or reordered row changes what the page promises about where a model is allowed to matter`);
});

// ── (i) §3's file set: the skills, the link, and the two counts ──────────────────────────────────

test("agnostic: §3's skills list ≡ the directories the repo tree ships for this page's own glob, both directions, and the layers table's skill is one of them", () => {
  const glob = skillGlob(DOC);
  const declared = declaredSkills(DOC);
  assertSameSet(declared, shippedSkillDirs(glob), {
    declaredAs: `${DOC_REL}'s §3 skills list`,
    liveAs: `the directories matching \`${glob.as}\` in the repo tree`,
  });
  // One name, two sites: the layers table names a skill in its "Who does it" cell and §3 names it in a
  // bullet, so the check may not be satisfied by either half alone.
  const verbs = new Set(dispatchedVerbs(readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8")));
  const fromLayers = declaredLayers(DOC).flatMap((r) => r.names).filter((n) => !verbs.has(n));
  assert.ok(fromLayers.length > 0,
    `fixture stale: ${DOC_REL}'s layers table names no artefact that is not a CLI verb, so this case cannot prove the table and the list agree`);
  const orphan = fromLayers.filter((n) => !declared.includes(n));
  assert.deepEqual(orphan, [],
    `${DOC_REL}'s layers table names ${orphan.join(", ")} and its §3 skills list does not — an adopter's agent is sent to the list, so a skill named only in the table is a directory it is never told to read`);
});

test("agnostic: §3's audiences table names two files that resolve — one relative link, one skills glob the repo tree answers", () => {
  const rows = declaredAudiences(DOC);
  const shapes = rows.map((r) => {
    const link = /\]\((\.\.?\/[^)]+)\)/.exec(r.file);
    if (link) {
      const target = resolve(join(ROOT, "docs"), link[1]);
      assert.ok(existsSync(target),
        `${DOC_REL}'s audiences row "${r.audience}" links ${link[1]} and that resolves to ${target}, which does not exist — an agent following this cell lands nowhere`);
      return "link";
    }
    const globbed = ticks(r.file).filter((t) => t.endsWith("*"));
    assert.equal(globbed.length, 1,
      `${DOC_REL}'s audiences row "${r.audience}" carries neither a relative link nor a single directory glob in its File cell ("${r.file}") — this table's whole job is to tell an agent which file carries which contract`);
    shippedSkillDirs(skillGlob(DOC));
    return "glob";
  });
  assert.deepEqual(shapes.sort(), ["glob", "link"],
    `${DOC_REL}'s audiences table resolves as ${shapes.join(" + ")} where it states two distinct audiences — one file at the repo root and one directory set — so a row that lost its File cell, or a table that lost a row, fails here`);
});

test("agnostic: the audiences cell's two counts are counted — CONTRIBUTING's numbered design rules and the rows of AGENTS.md's own test-layers table", () => {
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const stated = (cell, what) => {
    const m = new RegExp(`\\b(\\d+|${Object.keys(WORDS).join("|")}) ${what}\\b`, "i").exec(cell);
    assert.ok(m, `fixture stale: ${DOC_REL}'s audiences table no longer states a count of ${what} ("${cell}") — this case exists to count what that cell claims`);
    return WORDS[m[1].toLowerCase()] ?? Number(m[1]);
  };
  const cell = declaredAudiences(DOC).map((r) => r.contract).find((c) => /design rules/.test(c));
  assert.ok(cell, `fixture stale: no ${DOC_REL} audiences row states a count of design rules`);
  const rules = numberedDesignRules();
  assert.equal(stated(cell, "design rules"), rules.length,
    `${DOC_REL} tells an agent working on this repo that AGENTS.md carries ${stated(cell, "design rules")} design rules and CONTRIBUTING.md numbers ${rules.length} (${rules.map((r) => r.title).join("; ")}) — a rule added without touching this cell is a rule an agent is never told about`);
  const layers = agentsTestLayers();
  assert.equal(stated(cell, "test layers"), layers.length,
    `${DOC_REL} states ${stated(cell, "test layers")} test layers and AGENTS.md's own table carries ${layers.length} (${layers.join(", ")}) — the layer an agent is not told about is the one it does not run before claiming`);
});

test("agnostic: every row of AGENTS.md's test-layers table names a file or an npm script that exists", () => {
  const layers = agentsTestLayers();
  const missing = layers.filter((l) => !layerArtefactExists(l));
  assert.deepEqual(missing, [],
    `AGENTS.md's test-layers table names ${missing.join(", ")}, which resolves to no file and no npm script — ${DOC_REL} sends an agent to that table for the layers it must run, so a row naming something absent is a layer that cannot be run`);
  // The count case above would pass on a table of five rows naming five things that do not exist.
  assert.ok(layers.some((l) => l.startsWith("npm run")) && layers.some((l) => l.includes("/")),
    `fixture stale: AGENTS.md's layers table no longer mixes npm scripts with paths (${layers.join(", ")}) — the resolver above has two branches and this case would be exercising one`);
});

// ── the new regions' own rules: markers, vacuity, and the first table's cut ──────────────────────

test("agnostic: the new regions' markers are asserted present — a reworded heading or closing sentence is a hard failure, not a pass", () => {
  assert.throws(() => declaredUsage(DOC.replace(once(USAGE_START), "### Calibration")), /no longer heads its calibrate contract/);
  // The fence is the region's cut, so both of its lines are markers: with the pair gone there is no block
  // to read, and with only the closing one gone the region would otherwise run on into the prose below.
  const FENCED = once("```\ntmux-agent calibrate [--out FILE]\n```");
  assert.throws(() => declaredUsage(DOC.replace(FENCED, "tmux-agent calibrate [--out FILE]")), /no longer followed by a fenced block/);
  assert.throws(() => declaredUsage(DOC.replace(FENCED, "```\ntmux-agent calibrate [--out FILE]")), /is never closed/);
  assert.throws(() => declaredLayers(DOC.replace(once(LAYERS_START), "The split:")), /no longer opens the calibrate-layers table/);
  assert.throws(() => declaredLayers(DOC.replace(once(LAYERS_END), "Therefore:")), /no longer closes the calibrate-layers table/);
  assert.throws(() => declaredLayers(DOC.replace(once(LAYERS_HEADER), "| Layer | Who |")), /no longer carries the/);
  assert.throws(() => declaredAudiences(DOC.replace(once(AUDIENCES_START), "Two audiences:")), /no longer opens §3's audiences table/);
  assert.throws(() => declaredAudiences(DOC.replace(once(AUDIENCES_HEADER), "| Audience | File |")), /no longer carries the/);
  assert.throws(() => declaredSkills(DOC.replace(once(SKILLS_END), "### Memory")), /no longer closes §3's skills list/);
  // SKILLS_START is load-bearing TWICE: it closes the audiences region and opens the skills list, so a
  // reworded heading must fail on both sides rather than silently merging the two declarations.
  const reworded = DOC.replace(once(SKILLS_START), "### The skills");
  assert.throws(() => declaredAudiences(reworded), /no longer closes §3's audiences table/);
  assert.throws(() => declaredSkills(reworded), /no longer opens §3's skills list/);
});

test("agnostic: an empty, duplicated, mis-columned or doubled declaration in the new regions is a hard failure, never a vacuous pass", () => {
  const BULLETS = /^- \*\*`(tmux-agent-[a-z]+)`\*\*.*$/gm;
  assert.equal((DOC.match(BULLETS) ?? []).length, 3,
    `fixture stale: the bullet plants below match ${(DOC.match(BULLETS) ?? []).length} of ${DOC_REL}'s skill bullets, not 3 — a plant that changes no bullet would leave the shipped list parsing normally and the assertions below expecting a throw they never get`);
  // A bullet whose name stops being a name is the per-bullet failure (it is a directory promised and held
  // to nothing); the bullets gone altogether is the empty-declaration failure. Neither may be a pass.
  assert.throws(() => declaredSkills(DOC.replace(BULLETS, "- **$1** — a skill")), /backticks 0 names/);
  assert.throws(() => declaredSkills(DOC.replace(BULLETS, "")), /parsed ZERO skill names/);
  assert.throws(() => declaredSkills(DOC.replace(once("- **`tmux-agent-supervise`**"), "- **`tmux-agent-adopt`**")), /parses tmux-agent-adopt more than once/);
  const ROWS = /^\| (?:Sampling|Naming|Ratifying).*$/gm;
  assert.equal((DOC.match(ROWS) ?? []).length, 3,
    `fixture stale: the row-deleting plant below matches ${(DOC.match(ROWS) ?? []).length} of the layers table's rows, not 3`);
  assert.throws(() => declaredLayers(DOC.replace(ROWS, "")), /parsed ZERO table rows \(the calibrate-layers table\)/);
  assert.throws(() => declaredLayers(DOC.replace(once("| Ratifying the draft | **A human** |"), "| Ratifying the draft | **A human** | who | signs |")), /splits into \d+ cells rather than 3/);
  assert.throws(() => declaredLayers(DOC.replace(once("via the `tmux-agent-calibrate` skill"), "via the `tmux-agent-calibrate` or `tmux-agent-adopt` skill")), /names 2 artefacts/);
  assert.throws(() => declaredUsage(DOC.replace(once("tmux-agent calibrate [--out FILE]"), "tmux-agent calibrate [--out FILE] [--out ALSO]")), /parses out more than once/);
  assert.throws(() => declaredUsage(DOC.replace(once("tmux-agent calibrate [--out FILE]"), "tmux-agent calibrate [--out FILE]\ntmux-agent calibrate")), /declares 2 command lines/);
});

test("agnostic: the eight regions are disjoint — a new cut may not widen the first table's, and the first table declares nothing the others do", () => {
  const lines = DOC.split("\n");
  const span = (start, end) => {
    const a = lines.findIndex((l) => l.includes(start));
    const b = lines.findIndex((l, i) => i > a && l.includes(end));
    assert.ok(a > -1 && b > a, `fixture stale: the region "${start.slice(0, 40)}" → "${end.slice(0, 40)}" does not resolve in ${DOC_REL}`);
    return [a, b];
  };
  const ordered = [
    ["the three-lexicon table", span(TABLE_START, TABLE_END)],
    ["§1's lexicon example", span(SECTION_START, DECISIONS_START)],
    ["§1's design decisions", span(DECISIONS_START, DECISIONS_END)],
    ["§2's usage block", span(USAGE_START, PROMISES_START)],
    ["§2's numbered promises", span(PROMISES_START, PROMISES_END)],
    ["the calibrate-layers table", span(LAYERS_START, LAYERS_END)],
    ["§3's audiences table", span(AUDIENCES_START, SKILLS_START)],
    ["§3's skills list", span(SKILLS_START, SKILLS_END)],
  ];
  ordered.forEach(([what, [a, b]], i) => {
    if (i === 0) return;
    const [prev, [, end]] = ordered[i - 1];
    assert.ok(a >= end,
      `${what}'s region opens at line ${a + 1}, inside ${prev}'s (which runs to line ${end}) — the regions of this page must not overlap: the first table's two boundary cases assert the later headers are ABSENT from its region, and a widened cut would read another section's rows as declared vocabulary`);
    assert.ok(b > a, `${what}'s region closes at or before it opens`);
  });
  // And the declarations themselves are disjoint: nothing the new regions declare is vocabulary of the
  // first table, which is the same property case (:339) asserts from the other side.
  const vocab = declaredLexicons(DOC).flatMap((r) => r.vocab);
  const newly = [...declaredSkills(DOC), ...declaredLayers(DOC).flatMap((r) => r.names), ...declaredUsage(DOC).flags,
    ...exampleKeys(exampleConfig(DOC)).map((k) => k.split(".")[1]), ...declaredOptOuts(DOC).map((o) => o.raw)];
  assert.ok(newly.length > 0, "the new regions declare nothing — refusing to prove disjointness against an empty set");
  const both = newly.filter((n) => vocab.includes(n));
  assert.deepEqual(both, [],
    `${both.join(", ")} is declared by BOTH the three-lexicon table and §1/§2/§3 — a name read by two regions answers to two authorities, and the one that is wrong passes under the other's rule`);
});

// ── §1: the lexicon config an adopter writes BY HAND ───────────────────────────────────

/** Item 5b IS the lexicon schema's declaration, and has been parsed since TMUX-137: §1 is its second one. */
const VERSIONING = readFileSync(join(ROOT, "VERSIONING.md"), "utf8");
/** The section word §1's prose uses for a config section → the name item 5b's four lists are keyed by. */
const ITEM_5B_GROUP = new Map([["top", "top"], ["profiles", "profile"], ["parents", "parents"], ["redact", "redact"]]);

/**
 * Every key §1's example declares, held against the list item 5b declares it in. In a function so a plant
 * can be asserted to THROW: a key in the example that VERSIONING.md never declares is this page telling an
 * adopter to type a name semver does not cover, which is the second-declaration drift this card was filed
 * about (TMUX-143's shape for calibrate's flags, TMUX-84's for the README).
 */
function assertExampleKeysDeclared(doc) {
  const declared = declaredLexiconShape(VERSIONING);
  const keys = exampleKeys(exampleConfig(doc));
  for (const dotted of keys) {
    const [group, key] = dotted.split(".");
    assert.ok(declared[group],
      `${DOC_REL}'s §1 example declares ${dotted} and VERSIONING.md item 5b has no ${group} list (it declares ${Object.keys(declared).join(", ")}) — the groups must be the same four, or the comparison is against nothing`);
    assert.ok(declared[group].includes(key),
      `${DOC_REL}'s §1 example tells an adopter to write \`${key}\` in ${group === "top" ? "the file" : `a lexicon's ${group}`} and VERSIONING.md item 5b declares ${declared[group].join(", ")} — item 5b is what semver covers, so a key this page promises and that one does not is a key an adopter may lose in a patch release`);
  }
  return keys;
}

/** Decision 1's opt-out spellings, each held against item 5b's list for the section it names. */
function assertOptOutsDeclared(doc) {
  const declared = declaredLexiconShape(VERSIONING);
  const outs = declaredOptOuts(doc);
  for (const o of outs) {
    const group = ITEM_5B_GROUP.get(o.group);
    assert.ok(group, `${DOC_REL}'s decision 1 names \`${o.raw}\`, whose section \`${o.group}\` is not one of the four item 5b declares (${[...ITEM_5B_GROUP.keys()].join(", ")})`);
    assert.ok(declared[group].includes(o.key),
      `${DOC_REL}'s decision 1 offers \`${o.raw}\` and VERSIONING.md item 5b's ${group} list declares ${declared[group].join(", ")} — this decision is the one an adopter reads to drop our built-in vocabulary, so a spelling the loader does not read is the silent no-op this card was filed for`);
  }
  return outs;
}

/** A throwaway home carrying `lexicon.json`, for a drive through the built binary. Caller removes it. */
function homeWithLexicon(cfg, tag) {
  const home = mkdtempSync(join(tmpdir(), `ta-agnostic-${tag}-`));
  writeFileSync(join(home, "lexicon.json"), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  return home;
}

/** `doctor`'s own JSON on that home, over a socket no server runs on. The verb reads the lexicon it reports. */
async function doctorOn(home, args = []) {
  const r = await cli(["--socket", deadSocket(), "doctor", ...args], { ...PINNED, TMUX_AGENT_HOME: home });
  assert.equal(r.code, 0, `doctor on a throwaway home exited ${r.code}: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

test("agnostic: §1's jsonc example is parsed as DATA — every key it tells an adopter to type is one VERSIONING.md item 5b declares", () => {
  const keys = assertExampleKeysDeclared(DOC);
  assert.ok(keys.length >= 10,
    `${DOC_REL}'s §1 example parsed ${keys.length} keys (${keys.join(", ")}) — it carries a profile, a parents block and a redact rule, so a parse this small has read part of the block and the rest is unchecked`);
  // A key item 5b never declares must be a hard failure, not a pass: the example is the shape an adopter
  // copies, so a name only this page carries is covered by semver on the strength of its own illustration.
  const planted = DOC.replace(once(`  "version": 1,`), `  "version": 1,\n  "replaceRedact": true,`);
  assert.throws(() => assertExampleKeysDeclared(planted), /replaceRedact/,
    "a key planted in §1's example that item 5b does not declare parsed clean — then this case cannot see the page growing a name semver does not cover");
  // …and the other direction is deliberately NOT a set equality: the example illustrates 14 of item 5b's 19
  // keys, and `idle`/`contextPctInverted`/`flags`/`replaceProfiles`/`replace` are declared there, driven by
  // test/versioning-contract.test.js, and not part of the shortest config that teaches the tool a fleet.
  const declared = declaredLexiconShape(VERSIONING);
  const total = Object.values(declared).flat().length;
  assert.ok(keys.length < total,
    `${DOC_REL}'s §1 example now carries all ${total} keys item 5b declares — if it is meant to be exhaustive, the comparison above should be a set equality in both directions`);
});

test("agnostic: the example's comment strip takes a // comment and leaves a // that is INSIDE a pattern string", () => {
  const jsonc = lexiconExample(DOC).join("\n");
  assert.equal((stripJsonc(jsonc).match(/\/\//g) ?? []).length, 0,
    `${DOC_REL}'s §1 example still carries a // after the strip — a comment reaching JSON.parse is the failure this strip exists for`);
  // The trap the rule is written for: a pattern with a `//` in it must survive, because a strip that eats
  // the rest of that line is silently wrong in exactly the place a regex lives. No pattern in the example
  // carries one today; this is the plant for the one that will.
  const URL_PAT = "cloning https://";
  const planted = DOC.replace(once(`      "working": ["thinking…", "⣾|⣽|⣻"],`), `      "working": ["thinking…", "${URL_PAT}"],`);
  assert.deepEqual(exampleConfig(planted).profiles[0].working, ["thinking…", URL_PAT],
    `a \`//\` inside a pattern string did not survive the comment strip — the strip must take only a \`//\` that starts after whitespace`);
  // and the control, so the rule above is not "strip nothing": a real comment in the same place IS taken.
  const commented = DOC.replace(once(`  "parents": {`), `  "parents": {   // a claim about this key`);
  assert.deepEqual(exampleConfig(commented).parents, exampleConfig(DOC).parents,
    "a planted // comment changed what the example parses to — then the strip is not removing comments");
});

test("agnostic: the example's // comments are claims about the key they sit on — four keys, each one the example declares", () => {
  const comments = exampleComments(DOC);
  const keys = exampleKeys(exampleConfig(DOC));
  for (const key of comments.keys()) {
    assert.ok(keys.includes(`top.${key}`) || keys.includes(`profile.${key}`),
      `${DOC_REL}'s §1 example comments \`${key}\`, which is not a key the block declares (${keys.join(", ")}) — a claim about a key that is not there is read by nothing`);
  }
  assert.deepEqual([...comments.keys()].sort(), ["contextPct", "parents", "profiles", "redact"],
    `${DOC_REL}'s §1 example comments ${[...comments.keys()].join(", ")} — each of those four comments is DRIVEN by a case below, so one added or removed here is a promise this suite stops holding`);
  // A comment attached to no key cannot be a silent pass: there would be nothing to hold it to.
  const planted = DOC.replace(once(`{\n  "version": 1,`), `{   // a comment about nothing\n  "version": 1,`);
  assert.throws(() => exampleComments(planted), /names no key/,
    "a comment on a line that declares no key parsed clean — then a claim this page makes could answer to nothing");
});

test("agnostic: the `profiles` comment — tried BEFORE built-ins — and decision 3 are DRIVEN: the user's profile is first and the built-in chain follows it unchanged", async () => {
  const said = exampleComments(DOC).get("profiles");
  assert.match(said, /BEFORE built-ins/,
    `fixture stale: ${DOC_REL}'s §1 example no longer claims its profiles are tried BEFORE the built-ins ("${said}") — this case exists to drive that claim`);
  assert.match(decision(DOC, 3).title, /tried first/,
    `fixture stale: ${DOC_REL}'s decision 3 no longer states the precedence ("${decision(DOC, 3).title}") — the same property, stated twice on the page, is driven here once`);
  const { resolveProfiles } = await import(join(ROOT, builtPath("core/monitor.ts")));
  const cfg = exampleConfig(DOC);
  const fallback = resolveProfiles({}).map((p) => p.name);
  assert.ok(fallback.length > 0, "resolveProfiles({}) returned an empty chain — refusing to judge the example's precedence against nothing");
  assert.deepEqual(resolveProfiles(cfg).map((p) => p.name), [...cfg.profiles.map((p) => p.name), ...fallback],
    `the chain §1's example produces is not its own profiles followed by the built-in chain in order — the comment on \`profiles\` and decision 3 both promise the user's are tried first, and classification is first-match-wins, so position IS the promise`);
});

test("agnostic: decision 3's point — OVERRIDING a built-in — is driven: a user profile wins on a tail the built-in also recognises", async () => {
  const { resolveProfiles } = await import(join(ROOT, builtPath("core/monitor.ts")));
  assert.match(decision(DOC, 3).body, /Overriding is the entire\s+point/,
    `fixture stale: ${DOC_REL}'s decision 3 no longer says overriding is the point ("${decision(DOC, 3).body.slice(0, 96)}") — this case drives that sentence`);
  // A tail the shipped chain calls WORKING, claimed by a user profile as BLOCKED. First-match-wins through
  // the chain is the observable: the same tail must read differently with and without the lexicon.
  const TAIL = ["session opened", "esc to interrupt"];
  const first = (chain) => chain.map((p) => p.classify(TAIL)).find((s) => s !== null) ?? null;
  assert.equal(first(resolveProfiles({})), "WORKING",
    `fixture stale: the shipped chain no longer reads ${JSON.stringify(TAIL)} as WORKING, so this case cannot prove a user profile overrides it`);
  const override = { version: 1, profiles: [{ name: "my-cli", blocked: ["esc to interrupt"] }] };
  assert.equal(first(resolveProfiles(override)), "BLOCKED",
    `a user profile did not override a built-in on the same tail — decision 3's "Prevents: an adopter being unable to correct a built-in profile that misreads their fork of a CLI" would be false`);
});

test("agnostic: the `contextPct` comment — one capture group = the percentage — is DRIVEN: 42, and a tail without a number reads null", async () => {
  const said = exampleComments(DOC).get("contextPct");
  assert.match(said, /one capture group/,
    `fixture stale: ${DOC_REL}'s §1 example no longer claims one capture group is the percentage ("${said}") — this case exists to drive that claim`);
  const { profileFromLexicon } = await import(join(ROOT, builtPath("core/monitor.ts")));
  const prof = profileFromLexicon(exampleConfig(DOC).profiles[0]);
  assert.equal(prof.contextPct?.(["context 42%"]), 42,
    "the example's contextPct pattern did not read 42 out of a pane line — the one thing that comment promises is that the capture group IS the number");
  assert.equal(prof.contextPct?.(["no percentage here"]), null,
    "a tail with no percentage did not read null — a contextPct that invents a number is worse than one that abstains");
  // and the claim is a REQUIREMENT, not advice: the same pattern with the group removed is refused by name.
  const { validateLexicon } = await import(join(ROOT, builtPath("core/lexicon.ts")));
  const ungrouped = { version: 1, profiles: [{ name: "my-cli", contextPct: exampleConfig(DOC).profiles[0].contextPct.replace(/[()]/g, "") }] };
  assert.throws(() => validateLexicon(ungrouped), /profile "my-cli"\.contextPct needs one capture group/,
    "the example's contextPct pattern without its capture group was accepted — then the comment's claim is not enforced and an adopter's percentage is null forever");
});

test("agnostic: the six state patterns §1's example declares each classify, and an unmatched tail stays null", async () => {
  const { profileFromLexicon } = await import(join(ROOT, builtPath("core/monitor.ts")));
  const spec = exampleConfig(DOC).profiles[0];
  // One fixture per pattern the example writes, and the SET is asserted first: a changed pattern in the doc
  // must be a stale-fixture failure here, never a case that quietly stops exercising it.
  const FIXTURES = new Map([
    ["quota exceeded", { state: "ERROR", tail: ["quota exceeded for this project"] }],
    ["fatal:", { state: "ERROR", tail: ["fatal: could not reach the API"] }],
    ["\\[y/N\\]", { state: "BLOCKED", tail: ["overwrite lexicon.json? [y/N]"] }],
    ["^\\s*»\\s*\\d+\\.", { state: "BLOCKED", tail: ["pick one:", "  » 1. keep going"] }],
    ["thinking…", { state: "WORKING", tail: ["thinking… 12s"] }],
    ["⣾|⣽|⣻", { state: "WORKING", tail: ["⣾ working"] }],
  ]);
  const declared = ["error", "blocked", "working"].flatMap((k) => spec[k] ?? []);
  assertSameSet(declared, [...FIXTURES.keys()], {
    declaredAs: `${DOC_REL}'s §1 example profile (its error, blocked and working patterns)`,
    liveAs: "the fixtures this case drives, one per pattern",
  });
  const prof = profileFromLexicon(spec);
  for (const [pattern, { state, tail }] of FIXTURES) {
    assert.equal(prof.classify(tail), state,
      `the example's \`${pattern}\` did not read ${JSON.stringify(tail)} as ${state} — an adopter types this block verbatim, so a pattern that classifies nothing is a fleet view that is confidently wrong`);
  }
  // The `^`-anchored one is the trap: classify() takes an ARRAY and compiles with `im`, so a pattern planted
  // on the FIRST line cannot see the `m` the macOS-CI scar added. This is that pattern on a LATER line.
  assert.equal(prof.classify(["pick one:", "  » 1. keep going"]), "BLOCKED",
    "the `^`-anchored blocked pattern did not match on a non-first line of the tail — without the `m` flag a menu that is not the first line of the pane reads as IDLE, which is the codex bug this page was written about");
  assert.equal(prof.classify(["a quiet shell prompt"]), null,
    "a tail none of the example's patterns match did not read null — the profile must abstain and let the built-in chain and the core signals decide");
});

test("agnostic: the `parents` comment — what a legitimate NON-tmux supervisor is called here — is DRIVEN through the built binary, near-miss included", async () => {
  const said = exampleComments(DOC).get("parents");
  assert.match(said, /NON-tmux supervisor/,
    `fixture stale: ${DOC_REL}'s §1 example no longer claims its parents block names legitimate non-tmux supervisors ("${said}") — this case exists to drive that claim`);
  const cfg = exampleConfig(DOC);
  const NEAR = "orchestrator-x";
  const names = [...cfg.parents.nonSession, "orchestrator-7", NEAR];
  const home = homeWithLexicon(cfg, "parents");
  try {
    // Driven OUT OF PROCESS on purpose: the engagement configurator installs a lexicon's parent rules for
    // the whole process, and the case at :481 asserts this file installs none (row 2 measures the shipped
    // default). `doctor --parent` runs that same predicate inside the binary and reports its verdicts.
    const { parents } = await doctorOn(home, ["--parent", names.join(",")]);
    assert.deepEqual(parents.extraNames, cfg.parents.nonSession,
      `the binary read ${JSON.stringify(parents.extraNames)} as the example's extra supervisor names — the lexicon on that home was not honoured, so the verdicts below would be the shipped defaults`);
    const supervisors = Object.entries(parents.verdicts).filter(([, v]) => /not orphaned/.test(v)).map(([n]) => n);
    assertSameSet(supervisors, names.filter((n) => n !== NEAR), {
      declaredAs: "the names §1's example makes legitimate supervisors",
      liveAs: "what the built binary's own parent predicate answers for them",
    });
    assert.match(parents.verdicts[NEAR], /live tmux session/,
      `${NEAR} reads as a non-session supervisor — the example's pattern is anchored (\`${cfg.parents.nonSessionPattern}\`), and a near-miss that passes it is the 27-of-31 orphan bug with our names swapped for an adopter's`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("agnostic: the `redact` comment and decision 2 are DRIVEN — built-ins always run, the user's rule runs AFTER, and one bad rule is skipped rather than aborting the pass", async () => {
  const said = exampleComments(DOC).get("redact");
  assert.match(said, /ADDITIVE/,
    `fixture stale: ${DOC_REL}'s §1 example no longer claims redaction is additive ("${said}") — this case exists to drive that claim`);
  assert.match(decision(DOC, 2).title, /additive-only/,
    `fixture stale: ${DOC_REL}'s decision 2 no longer states the additive rule ("${decision(DOC, 2).title}") — the same property, stated twice on the page`);
  const built = builtPath("core/redact.ts");
  const { configureRedaction, redact, extraRedactionRuleCount } = await import(join(ROOT, built));
  const cfg = exampleConfig(DOC);
  const AWS = REDACT_FIXTURES.get("AWS");
  const AZURE = "0123456789abcdef0123456789abcdef.azure";
  try {
    assert.equal(configureRedaction(cfg), cfg.redact.length,
      "the example's redact rules did not install — configureRedaction takes the CONFIG, not compiled rules, and a case that hands it the wrong thing installs 0 rules and passes while reading nothing");
    assert.equal(redact(`${AWS.sample} and ${AZURE}`), `${AWS.marker} and ${cfg.redact[0].replacement}`,
      "one line carrying a built-in shape and the example's own did not come back with BOTH markers — additive means the built-ins still run when a lexicon is configured");
    // ORDER, proven rather than asserted: a user rule whose pattern IS the built-in's marker can only fire if
    // the built-in already replaced the secret with it.
    assert.equal(configureRedaction({ version: 1, redact: [{ name: "eat-marker", pattern: `\\[${AWS.marker.slice(1, -1)}\\]`, replacement: "[USER_SAW_IT]" }] }), 1);
    assert.equal(redact(AWS.sample), "[USER_SAW_IT]",
      `a user rule matching ${AWS.marker} did not fire on a raw ${AWS.sample.slice(0, 4)} secret — the built-in patterns do not run BEFORE the user's, so decision 2's order is not what the page says`);
  } finally {
    configureRedaction({});
  }
  assert.equal(extraRedactionRuleCount(), 0,
    "this case left a lexicon's redact rules installed for the process — the cases above measure the shipped default vocabulary and would be reading this fixture");
  // The skip-on-throw half is structural: the user loop is AFTER the built-in loop and inside a try/catch.
  const js = readFileSync(join(ROOT, built), "utf8");
  const builtins = js.indexOf("of PATTERNS");
  const user = js.indexOf("of extra");
  assert.ok(builtins > -1 && user > builtins,
    `${built} no longer replaces over the built-in patterns before the user's (found at ${builtins} and ${user}) — decision 2's "always run, before user patterns" is the structure, not a convention`);
  assert.match(js.slice(user), /try \{/,
    `${built}'s user-rule loop carries no try — decision 2 promises a user pattern that throws is skipped rather than aborting the pass, and an aborted pass lets raw text through`);
});

test("agnostic: decision 1 names only opt-out spellings item 5b declares — the `\"replace\": true` per section this page promised until TMUX-144 is refused by the parse", () => {
  const outs = assertOptOutsDeclared(DOC);
  assert.ok(outs.length >= 2,
    `${DOC_REL}'s decision 1 names ${outs.length} opt-out spellings (${outs.map((o) => o.raw).join(", ")}) — the loader honours one for the profile chain and one for the parent names, so a decision that names fewer has stopped telling an adopter how to opt out at all`);
  const OLD = 'An explicit\n   `"replace": true` per section is available';
  assert.ok(!DOC.includes(OLD),
    `${DOC_REL} promises ${OLD} again — the built loader honours that spelling for \`parents\` alone, has none for \`redact\` by design (decision 2, on this same page) and SILENTLY IGNORES it beside \`profiles\`, which is the drift TMUX-144 removed; the fix was to name the spellings the loader reads, never to add an alias`);
  // The plant is the page's own history: the token that promise carried names no section, and the loader
  // reads `replace` inside `parents` only — so restoring it must be a hard failure.
  const planted = DOC.replace(once("`replaceProfiles` at the top\n   level drops the built-in profile chain, `parents.replace` drops the built-in supervisor names"),
    'An explicit `"replace": true` per section is available');
  assert.throws(() => declaredOptOuts(planted), /neither a lexicon key nor/,
    "the sentence this page carried until TMUX-144 parsed clean — then the parse cannot see the promise it was written to refuse");
  // And the other half of that promise: a per-section `replace` for the PROFILES block is not a key item 5b
  // declares, so a page that offers one is RED here rather than shipping an alias nobody implemented.
  const alias = DOC.replace(once("`parents.replace` drops the built-in supervisor names"), "`profiles.replace` drops the built-in profile chain");
  assert.throws(() => assertOptOutsDeclared(alias), /profiles\.replace/,
    "a `profiles.replace` promise parsed clean against item 5b — then the false spelling could come back under a different shape");
});

test("agnostic: decision 1's corrected claim is DRIVEN through the built binary — each spelling drops what it says, and the one this page no longer promises leaves the built-ins in place", async () => {
  const cfg = exampleConfig(DOC);
  const { resolveProfiles } = await import(join(ROOT, builtPath("core/monitor.ts")));
  const fallback = resolveProfiles({}).map((p) => p.name);
  const mine = cfg.profiles.map((p) => p.name);
  const drives = [
    ["replaceProfiles", { ...cfg, replaceProfiles: true }, (d) => {
      assert.equal(d.profiles.replaceBuiltins, true, "`replaceProfiles: true` did not drop the built-in profile chain");
      assert.deepEqual(d.profiles.order, [...mine, fallback[fallback.length - 1]],
        `the chain under \`replaceProfiles: true\` is ${d.profiles.order.join(" → ")} — decision 1 promises only the adopter's own vocabulary, which leaves their profiles plus the generic-shell fallback that is not a CLI anyone runs`);
    }],
    ["parents.replace", { ...cfg, parents: { ...cfg.parents, replace: true } }, (d) => {
      assert.equal(d.parents.replaceBuiltins, true, "`parents.replace: true` did not drop the built-in supervisor names");
      assert.equal(d.profiles.replaceBuiltins, false, "`parents.replace` also dropped the profile chain — the two opt-outs are per section");
    }],
    // The control, and the reason this card exists: the spelling the page promised for as long as it existed
    // does nothing at all, with exit 0 and no warning — which is decision 4's "never partial-silent" broken.
    ['"replace": true beside profiles', { ...cfg, replace: true }, (d) => {
      assert.equal(d.profiles.replaceBuiltins, false,
        "a top-level `replace: true` dropped the built-in profiles — then the spelling this page used to promise works and decision 1 never needed correcting");
      assert.deepEqual(d.profiles.order, [...mine, ...fallback],
        `the chain under a top-level \`replace: true\` is ${d.profiles.order.join(" → ")} — an adopter who asks to drop our built-ins keeps every one of them, which is why the page may not offer that spelling`);
      assert.equal(d.parents.replaceBuiltins, false, "a top-level `replace: true` reached the parents block");
    }],
  ];
  for (const [what, lexicon, check] of drives) {
    const home = homeWithLexicon(lexicon, "replace");
    try {
      const d = await doctorOn(home);
      assert.equal(d.lexicon.loaded, true, `the binary did not load the lexicon written for the ${what} drive`);
      check(d);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("agnostic: decision 4 is DRIVEN — five bad lexicons, five refusals, each naming the rule it refused", async () => {
  assert.match(decision(DOC, 4).body, /with the rule's `name` in the error/,
    `fixture stale: ${DOC_REL}'s decision 4 no longer promises the rule's name in the error ("${decision(DOC, 4).body.slice(0, 120)}") — this case exists to drive that promise`);
  const { validateLexicon, LexiconError } = await import(join(ROOT, builtPath("core/lexicon.ts")));
  const BAD = [
    ['profile "prof-x".blocked[0]', { version: 1, profiles: [{ name: "prof-x", blocked: ["("] }] }],
    ['profile "prof-y".contextPct', { version: 1, profiles: [{ name: "prof-y", contextPct: "context \\d+%" }] }],
    ['redact rule "rule-z"', { version: 1, redact: [{ name: "rule-z", pattern: "(", replacement: "x" }] }],
    ["parents.nonSessionPattern", { version: 1, parents: { nonSessionPattern: "(" } }],
    ["unsupported version 99", { version: 99 }],
  ];
  for (const [named, cfg] of BAD) {
    let caught = null;
    try {
      validateLexicon(cfg);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, `a lexicon that should be refused for ${named} validated clean — "a bad lexicon must not degrade the fleet view into confident wrongness" is decision 4's whole argument`);
    assert.ok(caught instanceof LexiconError, `the refusal for ${named} is a ${caught.constructor.name} rather than a LexiconError — the CLI's exit 78 is keyed on that type`);
    assert.ok(caught.message.includes(named),
      `the refusal for ${named} reads "${caught.message}" and does not name it — decision 4 promises the failure is per-rule, and an operator cannot fix a rule the error does not identify`);
  }
  // Loud means at LOAD, not on first use: the example validates clean, so the refusals above are the config's
  // fault rather than this build refusing everything.
  validateLexicon(exampleConfig(DOC));
});

test("agnostic: decision 5 is DRIVEN — the cap is the number the page it links to states, the nested quantifiers are refused by name, and a bounded group is accepted", async () => {
  const d5 = decision(DOC, 5);
  const link = /\[THREAT-MODEL\.md\]\(([^)]+)\)/.exec(d5.body);
  assert.ok(link, `${DOC_REL}'s decision 5 no longer links THREAT-MODEL.md for the residual risk — the cap it screens with is stated there, and this case reads the number from that page rather than hard-coding it`);
  const target = resolve(join(ROOT, "docs"), link[1]);
  assert.ok(existsSync(target), `${DOC_REL}'s decision 5 links ${link[1]}, which resolves to ${target} and does not exist — a reader following it for the residual risk lands nowhere`);
  const stated = /capped at (\d+) chars/.exec(readFileSync(target, "utf8"));
  assert.ok(stated, `${link[1]} no longer states the pattern-length cap in words — decision 5 says the cap exists and defers the number to that page, so with it gone the number is declared nowhere`);
  const cap = Number(stated[1]);
  const { validateLexicon } = await import(join(ROOT, builtPath("core/lexicon.ts")));
  const rule = (pattern) => ({ version: 1, redact: [{ name: "capped", pattern, replacement: "x" }] });
  assert.throws(() => validateLexicon(rule("a".repeat(cap + 1))), new RegExp(`longer than ${cap} chars \\(got ${cap + 1}\\)`),
    `a pattern one char over the cap ${link[1]} states was accepted — the two numbers must be the same one, or the page records a control the build does not apply`);
  validateLexicon(rule("a".repeat(cap)));
  for (const nested of ["(a+)+", "(\\d*)*"]) {
    assert.throws(() => validateLexicon(rule(nested)), /nested unbounded quantifier/,
      `${nested} was accepted — decision 5 promises the shapes that cause backtracking in practice are rejected at load, since JS has no regex timeout and the poll loop would hang`);
  }
  // The negative control: the screen is "nested UNBOUNDED quantifiers", not "any nesting". Without this a
  // pattern-rejecting build would pass the case above while refusing a legitimate group.
  validateLexicon(rule("(ab|cd)+x"));
});

test("agnostic: decision 6 and §1's intro are DRIVEN on one home — absent means defaults, the file is a sibling of policy.json, and the tool creates neither", async () => {
  assert.match(decision(DOC, 6).body, /No lexicon file at the default path/,
    `fixture stale: ${DOC_REL}'s decision 6 no longer states the strict-superset rule ("${decision(DOC, 6).body.slice(0, 120)}") — this case exists to drive it`);
  const intro = DOC.split("\n").find((l) => l.includes(INTRO_START));
  assert.ok(intro, `${DOC_REL}'s §1 no longer opens with "${INTRO_START}" — the sentence that tells an adopter where the file goes, and which promises it inherits from policy.json, would be found by nothing`);
  const { resolveProfiles } = await import(join(ROOT, builtPath("core/monitor.ts")));
  const bare = mkdtempSync(join(tmpdir(), "ta-agnostic-absent-"));
  try {
    const d = await doctorOn(bare);
    assert.equal(d.lexicon.loaded, false, "a home with no lexicon.json reported one loaded");
    assert.equal(d.lexicon.path, join(bare, "lexicon.json"),
      `the default path is ${d.lexicon.path} rather than a sibling under the home — §1 promises the same location as policy.json, which src/core/policy.ts resolves as $TMUX_AGENT_HOME/policy.json`);
    assert.deepEqual(d.profiles.order, resolveProfiles({}).map((p) => p.name),
      "an absent lexicon did not leave classification byte-identical to the shipped chain — decision 6 is what makes this change safe to ship at GA rather than after");
    assert.equal(d.redaction.extraRules, 0, "an absent lexicon installed redaction rules");
    assert.equal(existsSync(join(bare, "lexicon.json")), false,
      "running the tool on a home without a lexicon CREATED one — absent must stay absent, or an adopter's next upgrade is pinned to whatever we wrote for them");
    // The same sentence's other half, driven on the same home: policy.json is read from beside it.
    writeFileSync(join(bare, "policy.json"), `${JSON.stringify({ readOnly: true })}\n`, { mode: 0o600 });
    writeFileSync(join(bare, "lexicon.json"), `${JSON.stringify(exampleConfig(DOC), null, 2)}\n`, { mode: 0o600 });
    const both = await doctorOn(bare);
    assert.equal(both.policy.readOnly, true, "a policy.json in the home was not honoured — then this case cannot prove the two files share a location");
    assert.equal(both.lexicon.loaded, true, "a lexicon.json in the same home was not honoured");
    assert.equal((statSync(bare).mode & 0o777) & 0o077, 0,
      `the home the tool bootstraps is mode ${(statSync(bare).mode & 0o777).toString(8)} — §1's "same 0600 expectation" as policy.json rests on both files sitting inside a home no other user can enter`);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
  // The NAMED-but-unreadable half of decision 6 is TMUX-112's, and is asserted covered rather than re-driven.
  const owner = "test/lexicon-unreadable.test.js";
  const js = readFileSync(join(ROOT, owner), "utf8");
  assert.match(js, /want 78 \(EX_CONFIG\)/,
    `${owner} no longer drives the exit-78 refusal for a lexicon that was NAMED and cannot be read — decision 6 states both halves ("is not \\"no file\\": it is refused"), and this case defers that one to the file that owns it`);
});

test("agnostic: §1's markers are asserted present, and an empty or unparsable declaration there is a hard failure rather than a vacuous pass", () => {
  assert.throws(() => lexiconExample(DOC.replace(once(SECTION_START), "## 1. Lexicons as data")), /no longer heads §1/);
  assert.throws(() => lexiconExample(DOC.replace(once("```jsonc"), "```json")), /rather than ```jsonc/);
  assert.throws(() => exampleConfig(DOC.replace(once(`  "redact": [`), "```\n  \"redact\": [")), /does not parse as JSON/);
  assert.throws(() => declaredDecisions(DOC.replace(once(DECISIONS_START), "### The decisions")), /no longer opens §1's design decisions/);
  assert.throws(() => declaredDecisions(DOC.replace(once(DECISIONS_END), "## 2. Framework")), /no longer closes §1's design decisions/);
  // A block that stopped being JSON is the loudest failure of all: an adopter types it verbatim.
  assert.throws(() => exampleConfig(DOC.replace(once(`  "version": 1,`), `  "version": 1,,`)), /does not parse as JSON/);
  // Six decisions, numbered 1..6: a deleted one must fail rather than leave a case reading the next one's prose.
  const DECISION = /^\d+\. \*\*(Extend|Redaction|User profiles|Validation|Patterns|Config)/gm;
  assert.equal((DOC.match(DECISION) ?? []).length, 6,
    `fixture stale: the decision-deleting plant below matches ${(DOC.match(DECISION) ?? []).length} of ${DOC_REL}'s design decisions, not 6`);
  assert.throws(() => declaredDecisions(DOC.replace(DECISION, "- **$1")), /parsed ZERO numbered design decisions/);
  assert.throws(() => declaredDecisions(DOC.replace(once("3. **User profiles are tried first"), "9. **User profiles are tried first")), /must run 1\.\.6 with no gap/);
  assert.throws(() => decision(DOC, 7), /none is numbered 7/);
});

// ── §2: the three sampling promises, and the evidence every rule carries ───────────────

/** A fixed `now`: `generatedAt` defaults to `new Date()`, so two reports of one fleet differ without it. */
const AT = "2026-09-21T08:23:00.000Z";
/** 20 chars of high entropy, on a key the credential screen's hint matches — planted, never a real secret. */
const TOKEN = "Kq7bZ2xW9tLmR4vP8sYh";
/** The pane line a glyph sits on: planted so a case can assert the report carries the GLYPH and not this. */
const PROMPT_LINE = "❯ 1. Yes, proceed";

/**
 * One fleet that produces all three proposal kinds at once, which is what promise 3 ("EVERY rule") needs:
 * two sessions naming a parent that is no session, so the shared-parent threshold is cleared; one of them
 * sitting on a prompt glyph; the other carrying a credential-shaped value the built-in redactor does not
 * know. Order is load-bearing — a prompt's `evidence.session` is `[...sessions][0]` — so the session that
 * carries the glyph is first, and the case that asserts the session name says which one it expects.
 */
const FLEET = [
  { session: "zzz", parent: "boss", tail: ["reading files", PROMPT_LINE] },
  { session: "aaa", parent: "boss", tail: [`AZURE_SECRET=${TOKEN}`] },
];

/** The BUILT calibrate module: §2's promises are claims about what it does, so these cases drive it. */
function builtCalibrate() {
  const rel = "dist/core/calibrate.js";
  assert.ok(existsSync(join(ROOT, rel)),
    `${rel} does not exist — is the tree built? §2's promises 1-3 are claims about what that module does, and this case refuses to judge them against nothing`);
  return import(join(ROOT, rel));
}

/**
 * The built CLI's `case "<verb>":` body, comments stripped — the authority for what promise 1 says the
 * verb samples. The case labels and the inputs they build are module-private, so the built source IS the
 * enumeration (`shippedVerbFlags()`'s reason, one section up). Taken as TEXT so a plant can add a read.
 */
function verbCase(js, verb) {
  const m = new RegExp(`\\n\\s*case "${verb}": \\{([\\s\\S]*?)\\n\\s*case "`).exec(js);
  assert.ok(m, `dist/bin/tmux-agent.js carries no \`case "${verb}": {\` body followed by another case label — refusing to judge what ${DOC_REL}'s promise 1 says that verb samples against nothing`);
  const body = stripComments(m[1]);
  assert.ok(body.includes(`${verb}(inputs)`),
    `the \`case "${verb}":\` body this case read never calls ${verb}(inputs) — the region cut is wrong, and every claim below would be measured against the wrong code`);
  return body;
}

/** The tmux driver methods a built case calls: the live side of what the verb samples. */
const tmuxCalls = (body) => [...new Set([...body.matchAll(/\btmux\.([A-Za-z]+)\(/g)].map((m) => m[1]))];

/**
 * What the built calibrate case must read for each source promise 1 names. `driver` is the tmux method
 * when the source comes from one, null when it rides along on a listing that is already there — the
 * `@agent_parent` value is a field of `listSessionsDetailed()`'s own records, not a second call.
 */
const SOURCE_AUTHORITIES = new Map([
  ["pane tails", { reads: "tmux.capturePane(", as: "capturePane()", driver: "capturePane" }],
  ["session names", { reads: "tmux.listSessionsDetailed(", as: "listSessionsDetailed()", driver: "listSessionsDetailed" }],
  ["`@agent_parent` values", { reads: "d.parent", as: "the parent field of a detailed session", driver: null }],
]);

/** The field of `evidence` each phrase of promise 3's enumeration is about. */
const EVIDENCE_FIELDS = new Map([
  ["the shape it was derived from", "sample"],
  ["the session it came from", "session"],
  ["how often it recurred", "seenInSessions"],
]);

/**
 * Promise 1's sources, each resolved to what the built case reads it from. In a function so a plant can be
 * asserted to THROW: a source with no live authority is this page telling an adopter the verb reads
 * something it does not, which is exactly what `ledger history` was for as long as this page existed.
 */
function assertSourcesResolve(doc, body, verb) {
  const sources = promiseSources(doc);
  for (const s of sources) {
    const auth = SOURCE_AUTHORITIES.get(s);
    assert.ok(auth,
      `${DOC_REL}'s promise 1 tells an adopter \`${verb}\` samples "${s}" and this suite has no live authority for it — until TMUX-145 that list named the ledger, which the built case reads nothing from, so a source resolving to nothing is the drift this check exists for, never an unchecked line`);
    assert.ok(body.includes(auth.reads),
      `${DOC_REL}'s promise 1 names "${s}" and the built \`case "${verb}":\` body never reads ${auth.as} — the page would be promising an input the verb does not take`);
  }
  return sources;
}

/** Promise 3's evidence phrases mapped to report fields. In a function for the same reason as above. */
function assertEvidenceFields(doc) {
  return promiseEvidence(doc).map((f) => {
    const field = EVIDENCE_FIELDS.get(f);
    assert.ok(field,
      `${DOC_REL}'s promise 3 promises "${f}" as part of the evidence EVERY rule carries and no field of the built report answers for it — until TMUX-145 that list promised the pane line, which a prompt rule does not carry, so a phrase resolving to no field is the drift this check exists for`);
    return field;
  });
}

/** The one clustering criterion of promise 2 matching `re`, asserted present so a case drives the page's words. */
function criterion(re) {
  const all = promiseCriteria(DOC);
  const hit = all.filter((c) => re.test(c));
  assert.equal(hit.length, 1,
    `fixture stale: ${DOC_REL}'s promise 2 declares ${all.length} clustering criteria ("${all.join('" | "')}") and ${hit.length} match ${re} — this case drives exactly one of them, and a criterion it can no longer find is a claim held to nothing`);
  return hit[0];
}

test("agnostic: §2's four promises are read as a LIST — the count asserted, each one named, and the evidence-per-rule paragraph inside the region", () => {
  const promises = declaredPromises(DOC);
  assert.deepEqual(promises.map((p) => p.title), ["Sample", "Cluster", "Propose", "Never auto-apply."],
    `${DOC_REL}'s §2 promises are ${promises.map((p) => p.title).join(", ")} — each of those four is held by a case below (1-3 by this card, 4 by TMUX-143's drive), so one added or renamed here is a promise this suite stops holding`);
  // The region must carry the paragraph that turns promise 3 into a requirement, and nothing from §2's
  // usage block above it or the layers table below: the disjointness case proves the cut, this proves the
  // content it has to contain.
  const region = regionOf(DOC, PROMISES_START, PROMISES_END, "§2's numbered promises").join("\n");
  assert.ok(region.includes(EVIDENCE_RULE), `the promises region no longer carries "${EVIDENCE_RULE}"`);
  assert.ok(!region.includes(LAYERS_HEADER) && !region.includes("```"),
    `${DOC_REL}'s promises region swallowed the layers table or §2's fenced usage block — a widened cut reads another declaration's text as a promise`);
});

test("agnostic: promise 1's sources each resolve to a live authority in the built calibrate case, both directions — and the ledger it named until TMUX-145 is read by nothing there", () => {
  const verb = declaredUsage(DOC).verb;
  const body = verbCase(readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8"), verb);
  const sources = assertSourcesResolve(DOC, body, verb);
  // The direction that matters most: an input the CODE grows and this page never names. Declared side is
  // every source whose authority IS a driver call, taken from the map rather than from what the code
  // happens to read — filtering by the live side would make this comparison vacuous.
  assertSameSet(sources.map((s) => SOURCE_AUTHORITIES.get(s).driver).filter(Boolean), tmuxCalls(body), {
    declaredAs: `${DOC_REL}'s promise 1 ("${sources.join('", "')}")`,
    liveAs: `the tmux driver calls in the built \`case "${verb}":\` body`,
  });
  assert.ok(!/ledger/i.test(body),
    `the built \`case "${verb}":\` body now reads the ledger and ${DOC_REL}'s promise 1 does not name it — the card that took that promise off the page explicitly did not authorise adding the read; if the verb should sample the ledger, that is a feature with its own card, its own sentence in §2 and its own test`);
});

test("agnostic: promise 1 is DRIVEN through the built binary — a home whose ledger carries events yields a report that names none of them, while `waste` on that same home names both", async () => {
  const verb = declaredUsage(DOC).verb;
  const home = mkdtempSync(join(tmpdir(), "ta-agnostic-ledger-"));
  const S = deadSocket();
  try {
    // Two events on one session each, carrying a task word nothing else in the report could produce.
    // A ledger event's kind key is `type` (src/core/ledger.ts), and the day file is events-<date>.ndjson.
    const TASK = "probe-the-ledger";
    mkdirSync(join(home, "ledger"), { recursive: true });
    const events = ["calib-a", "calib-b"].map((session) =>
      JSON.stringify({ v: 1, ts: AT, type: "session.spawned", session, parent: "boss", data: { task: TASK } }));
    writeFileSync(join(home, "ledger", `events-${AT.slice(0, 10)}.ndjson`), `${events.join("\n")}\n`, { mode: 0o600 });
    const r = await cli(["--socket", S, verb], { ...PINNED, TMUX_AGENT_HOME: home });
    assert.equal(r.code, 0, `\`${verb}\` on a home with a ledger exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    const report = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(report.sampled).sort(), ["parents", "sessions"],
      `the report counts what it sampled as ${JSON.stringify(report.sampled)} — promise 1 names the live fleet's panes, names and parents, so a third counter here would be a source this page does not declare`);
    assert.equal(report.sampled.sessions, 0,
      "the pinned socket was not honoured: the report sampled this host's live fleet, so this case would be measuring whatever happens to be running");
    for (const word of [TASK, "calib-a", "session.spawned", "ledger"]) {
      assert.ok(!r.stdout.includes(word),
        `\`${verb}\` put "${word}" in its report from a home whose only content is a ledger — promise 1 no longer names the ledger among its sources, and a report that carries ledger text would make that correction false in the other direction`);
    }
    // The positive control, without which the absence above is "nothing to read" rather than "not read":
    // the SAME home, read by the verb that does consume the ledger.
    const waste = await cli(["--socket", S, "waste"], { ...PINNED, TMUX_AGENT_HOME: home });
    assert.equal(waste.code, 0, `waste on that home exited ${waste.code}: ${waste.stderr.slice(0, 300)}`);
    assert.match(waste.stdout, /calib-a\s+events=1/,
      `waste on the same home does not report calib-a (${JSON.stringify(waste.stdout.slice(0, 200))}) — then the ledger this case planted is unreadable and the report's silence above proves nothing`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("agnostic: promise 2's first criterion is DRIVEN — a parent two sessions name is proposed, one that a single session names is not, and the note says why", async () => {
  const said = criterion(/non-session parents/);
  const { calibrate } = await builtCalibrate();
  const two = calibrate(FLEET, AT);
  assert.equal(two.parents.length, 1, `"${said}" — one parent recurs across this fleet and ${two.parents.length} were proposed`);
  assert.equal(two.parents[0].name, "boss");
  assert.equal(two.parents[0].evidence.seenInSessions, 2, `"${said}" — "repeated" is counted in SESSIONS, and this proposal claims ${two.parents[0].evidence.seenInSessions}`);
  assert.deepEqual(two.draft.parents.nonSession, ["boss"], "the proposal did not reach the draft an adopter would ratify");
  // One child is the threshold's other side: it may be a genuine orphan, so it is NOT proposed, and the
  // report says so rather than dropping it silently — the 27-of-31 orphan bug read from this end.
  const one = calibrate([FLEET[0]], AT);
  assert.deepEqual(one.parents, [],
    `"${said}" — a parent named by exactly one session was proposed anyway, which is the confident wrongness §2's own layers table says this half must not produce`);
  assert.equal(one.draft.parents, undefined, "a draft carrying a parents block with no proposal behind it");
  assert.match(one.notes.join(" "), /named by exactly one session — those may be genuine orphans/,
    `the report drops the single-child parent without saying so (notes: ${JSON.stringify(one.notes)}) — the evidence-per-rule paragraph is about rules that were proposed; a rule that was NOT needs its reason too`);
});

test("agnostic: promise 2's second criterion is DRIVEN — four glyph shapes at a pane tail each propose, and a numbered option with no glyph does not", async () => {
  const said = criterion(/prompt glyphs/);
  const { calibrate } = await builtCalibrate();
  const one = (line) => calibrate([{ session: "a", parent: null, tail: [line] }], AT).prompts;
  // The codex `›` bug generalised: the SHAPE is the signal, not the glyph, which is what lets this find a
  // CLI nobody profiled. `❯` claude-code, `›` codex, `[y/n]` and `(Y)es/(N)o` aider.
  for (const line of [PROMPT_LINE, "  › 2) Retry", "Continue? [y/n]", "(Y)es/(N)o"]) {
    assert.equal(one(line).length, 1, `"${said}" — ${JSON.stringify(line)} at a pane tail proposed nothing`);
  }
  assert.deepEqual(one("1. Yes, proceed"), [],
    `"${said}" — a numbered option with no glyph before the number proposed a BLOCKED pattern; ordinary numbered output is not a prompt, and a profile built from it would misclassify every list an agent prints`);
});

test("agnostic: promise 2's third criterion is DRIVEN — the credential screen takes a long high-entropy value on a credential-ish key, and nothing else", async () => {
  const said = criterion(/credentials/);
  const { calibrate, entropy } = await builtCalibrate();
  const shapes = (line) => calibrate([{ session: "a", parent: null, tail: [line] }], AT).secretShapes;
  const FLAT = "a".repeat(18);
  const SHORT = TOKEN.slice(0, 12);
  assert.ok(entropy(TOKEN) > entropy(FLAT),
    `fixture stale: the built entropy() reads ${entropy(TOKEN)} for this case's token and ${entropy(FLAT)} for a flat run of one character — the screen's threshold is the module's, and this case measures it rather than restating it`);
  const hit = shapes(`AZURE_SECRET=${TOKEN}`);
  assert.equal(hit.length, 1, `"${said}" — a 20-char high-entropy value on a key reading "secret" surfaced ${hit.length} shapes`);
  assert.equal(hit[0].shape, "20 chars, charset [a-z A-Z 0-9]",
    `the shape is "${hit[0].shape}" — "high-entropy strings shaped like credentials" is reported as a DESCRIPTION, which is the never-copy-a-value half of this promise`);
  assert.ok(!JSON.stringify(hit).includes(TOKEN), "the planted token appears in the proposal — the report must carry the shape, never the value");
  assert.deepEqual(shapes(`AZURE_SECRET=${FLAT}`), [],
    `"${said}" — an 18-char run of one character is long enough for the key/value scan and is not high-entropy, so a screen that proposes it would send an adopter a redaction rule for their own prose`);
  assert.deepEqual(shapes(`AZURE_SECRET=${SHORT}`), [],
    `"${said}" — a ${SHORT.length}-char value was proposed: the screen takes long values, and short ones are where a false positive costs an adopter their own output`);
  assert.deepEqual(shapes(`COLOUR=${TOKEN}`), [],
    `"${said}" — the same token on a key that reads nothing like a credential was proposed; the hint is required on the KEY, or every build id in a pane becomes a secret shape`);
});

test("agnostic: promise 2's corrected sentence is DRIVEN — the stall field is GONE from the shipped signature, and a caller that passes it anyway still gets a byte-identical report with the glyph proposed", async () => {
  assert.match(promise(DOC, 2).body, /the\s+session's own state is never consulted/,
    `fixture stale: ${DOC_REL}'s promise 2 no longer says the session's own state is never consulted ("${promiseCriteria(DOC).join(" | ")}") — for as long as this page existed it made the glyph conditional on "sessions that stopped advancing", and this case is the live authority for the sentence that replaced it`);
  // TMUX-145 pinned the field as INERT; TMUX-147 removed it, so the strongest form of this promise is
  // now an ABSENCE — and an absence is what this asserts, in the one authority that survives tsc. The
  // drive below is kept as the second half: a consumer written against the old signature is unaffected
  // at runtime, which is the claim CHANGELOG.md's Breaking entry makes on the adopter's behalf.
  const { objects } = shippedTypeMembers(["CalibrateInput"]);
  const members = objects.get("CalibrateInput")?.members ?? [];
  assert.ok(members.length > 0, "read no members of CalibrateInput from dist/**/*.d.ts — is the tree built?");
  assert.ok(!members.includes("looksStalled"),
    `dist/**/*.d.ts declares CalibrateInput.looksStalled again (members: ${members.join(", ")}) — ${DOC_REL}'s promise 2 says the session's own state is never consulted, and a field the built code honours nowhere is what VERSIONING.md item 6's signature check refuses; if the stall is now consulted, this page and that check are both wrong`);
  const { calibrate } = await builtCalibrate();
  const runs = [undefined, false, true].map((looksStalled) =>
    JSON.stringify(calibrate(looksStalled === undefined ? FLEET : FLEET.map((i) => ({ ...i, looksStalled })), AT)));
  assert.equal(new Set(runs).size, 1,
    `the report changes with a looksStalled property on the input — ${DOC_REL}'s promise 2 says the session's own state is never consulted, so the verb has started reading a field its own signature no longer declares`);
  assert.equal(JSON.parse(runs[0]).prompts.length, 1,
    "no glyph was proposed in any of the three runs — the byte-identity above would be between three empty reports, which proves nothing about the stall");
});

test("agnostic: promise 3's evidence enumeration ≡ the keys of `evidence` on EVERY proposal the built calibrate makes, both directions", async () => {
  const declared = assertEvidenceFields(DOC);
  const { calibrate } = await builtCalibrate();
  const report = calibrate(FLEET, AT);
  for (const [kind, list] of [["parent", report.parents], ["prompt", report.prompts], ["secret-shape", report.secretShapes]]) {
    assert.equal(list.length, 1,
      `fixture stale: the fleet this case calibrates produced ${list.length} ${kind} proposals where it must produce exactly 1 — promise 3 is about EVERY rule, and a kind this fixture stops producing is a kind the enumeration is no longer held against`);
    assertSameSet(declared, Object.keys(list[0].evidence), {
      declaredAs: `${DOC_REL}'s promise 3 ("${promiseEvidence(DOC).join('", "')}")`,
      liveAs: `the keys of \`evidence\` on the built calibrate's ${kind} proposal`,
    });
  }
});

test("agnostic: promise 3's per-kind sentence is DRIVEN — a parent's shape is its `@agent_parent=` line, a credential's is a charset sketch, a prompt's is the glyph and NOT the pane line", async () => {
  assert.match(promise(DOC, 3).body, /not the pane line the glyph sat on/,
    `fixture stale: ${DOC_REL}'s promise 3 no longer says what a prompt rule's shape is — until TMUX-145 it promised "the pane line" for every rule, and this case is the live authority for the sentence that replaced it`);
  const { calibrate } = await builtCalibrate();
  const report = calibrate(FLEET, AT);
  assert.equal(report.parents[0].evidence.sample, "@agent_parent=boss",
    "a parent proposal's evidence is not the lineage line the page now names");
  assert.equal(report.secretShapes[0].evidence.sample, `AZURE_SECRET=<20 chars, charset [a-z A-Z 0-9]>`,
    "a secret shape's evidence is not the charset sketch the page now names");
  assert.equal(report.prompts[0].evidence.sample, "glyph:❯",
    `a prompt proposal's evidence is ${JSON.stringify(report.prompts[0].evidence.sample)} — the page now names the glyph, so a report carrying something else makes the corrected prose false`);
  assert.equal(report.prompts[0].line, report.prompts[0].evidence.sample,
    "PromptProposal.line and its evidence.sample stopped being the same bucket key — the page names one shape per rule, so two different answers here leave a reviewer with nothing to review");
  assert.equal(report.prompts[0].evidence.session, "zzz",
    "a prompt's evidence.session is the first session the bucket saw, in input order — the fixture puts the glyph-carrying session first on purpose");
  const json = JSON.stringify(report);
  assert.ok(!json.includes(PROMPT_LINE),
    `the report carries the planted pane line ${JSON.stringify(PROMPT_LINE)} — promise 3 says a prompt's shape is the glyph and not the line it sat on; making the line the evidence is a src decision with its own card, not a silent change under this prose`);
  assert.ok(!json.includes(TOKEN),
    "the planted credential value appears somewhere in the report — a draft is a file people paste into issues and chat, so the value may never be copied (the G2 half of this promise)");
});

test("agnostic: the evidence-per-rule paragraph is DRIVEN — every rule in the draft traces to a proposal that carries evidence, both directions, and a credential shape is reported rather than drafted", async () => {
  assert.ok(DOC.includes(EVIDENCE_RULE),
    `fixture stale: ${DOC_REL} no longer states the evidence-per-rule requirement — this case exists to hold it, and without the paragraph there is nothing to drive`);
  const { calibrate } = await builtCalibrate();
  const report = calibrate(FLEET, AT);
  // The paragraph's claim is reviewability: a reviewer reads WHY a rule was proposed. So every rule in the
  // draft — the file a human moves into place — must trace back to a proposal that carries evidence, and
  // nothing may appear in the draft that no proposal accounts for.
  assertSameSet(report.draft.parents.nonSession, report.parents.map((p) => p.name), {
    declaredAs: "the draft's parents.nonSession",
    liveAs: "the parent proposals that carry evidence",
  });
  assertSameSet(report.draft.profiles.flatMap((p) => p.blocked), report.prompts.map((p) => p.suggestedPattern), {
    declaredAs: "the draft's proposed BLOCKED patterns",
    liveAs: "the prompt proposals that carry evidence",
  });
  for (const p of [...report.parents, ...report.secretShapes]) {
    assert.ok(p.reason && p.reason.length > 20,
      `a proposal reaches an adopter with reason ${JSON.stringify(p.reason)} — the paragraph under promise 3 is what makes this reviewable, and a rule whose why is empty can only be taken on trust`);
  }
  assert.equal(report.prompts[0].reason, undefined,
    "a prompt proposal grew a `reason` field — its why is the glyph, the session count and the pattern it suggests, which is what the corrected promise 3 names; a fourth answer here means that prose has to move too");
  // A credential shape is the one thing NOT drafted: the report describes it and a human decides, because
  // a guessed redaction rule that is wrong makes a pane unreadable. So the evidence is there and the rule
  // is not — which is why the draft is checked against the proposals kind by kind rather than in bulk.
  assert.equal(report.secretShapes.length, 1, "fixture stale: this fleet no longer surfaces a credential shape");
  assert.equal(report.draft.redact, undefined,
    "the draft carries a redact rule derived from a credential shape — the report proposes shapes for a human to review, and drafting one turns a guess about someone's pane into config they ratify by default");
  assert.match(report.notes.join(" "), /Values are NEVER copied into this report/,
    `the report stops saying that values are never copied (notes: ${JSON.stringify(report.notes)}) — that sentence is the reviewer's instruction for the one proposal kind the draft leaves out`);
});

test("agnostic: a source or an evidence field with no live authority is refused BY NAME — the ledger and the pane line this page promised until TMUX-145", () => {
  const verb = declaredUsage(DOC).verb;
  const body = verbCase(readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8"), verb);
  assert.ok(assertSourcesResolve(DOC, body, verb).length >= 3, "the shipped page declares fewer sources than the plants below edit");
  const LEDGER = "ledger history";
  const revert = DOC.replace(once("`@agent_parent` values."), `\`@agent_parent\` values, ${LEDGER}.`);
  assert.throws(() => assertSourcesResolve(revert, body, verb), new RegExp(LEDGER),
    "promise 1 naming the ledger again parsed clean — then this page can promise an input the verb does not take, which is the drift this card was filed for");
  const LINE = "the pane line";
  assert.throws(() => assertEvidenceFields(DOC.replace(once("(the shape it was derived from,"), `(${LINE}, the shape it was derived from,`)), new RegExp(LINE),
    "promise 3 promising the pane line again parsed clean — then every rule's evidence can name a field no proposal carries");
});

test("agnostic: §2's promise markers are asserted present, and an empty, renumbered or duplicated promise list is a hard failure rather than a vacuous pass", () => {
  assert.throws(() => declaredPromises(DOC.replace(once(PROMISES_START), "1. **Sample** the fleet:")), /no longer opens §2's numbered promises/);
  assert.throws(() => declaredPromises(DOC.replace(once(PROMISES_END), "### Where the agent fits")), /no longer closes §2's numbered promises/);
  assert.throws(() => declaredPromises(DOC.replace(once(EVIDENCE_RULE), "The evidence requirement is what makes it reviewable")), /no longer carry "The evidence-per-rule requirement/);
  const PROMISE = /^(\d)\. \*\*(Sample|Cluster|Propose|Never)/gm;
  assert.equal((DOC.match(PROMISE) ?? []).length, 4,
    `fixture stale: the plants below match ${(DOC.match(PROMISE) ?? []).length} of §2's promises, not 4 — a plant that changes no promise would leave the shipped page parsing normally and these assertions expecting a throw they never get`);
  // Indented, the way a list nested inside a bullet is: the region marker still matches on includes()
  // while the head regex is anchored, so the parse empties. That is the shape README's table set when a
  // positive control asserted a row it never found (:296's reason, this region's turn).
  assert.throws(() => declaredPromises(DOC.replace(PROMISE, "   $1. **$2")), /parsed ZERO numbered promises/);
  assert.throws(() => declaredPromises(DOC.replace(once("3. **Propose** a draft lexicon"), "3. Propose a draft lexicon")), /must run 1\.\.3 with no gap/);
  assert.throws(() => declaredPromises(DOC.replace(once("4. **Never auto-apply.**"), "3. **Never auto-apply.**")), /parses 3 more than once/);
  assert.throws(() => promise(DOC, 5), /none is numbered 5/);
  // The three lists are cut from the promises they belong to, so a promise that stopped carrying its list
  // must fail rather than return an empty one.
  assert.throws(() => promiseSources(DOC.replace(once("the live fleet:"), "the live fleet")), /no longer names its sources after a colon/);
  assert.throws(() => promiseCriteria(DOC.replace(once("what recurs —"), "what recurs:")), /no longer introduces its clustering criteria/);
  assert.throws(() => promiseEvidence(DOC.replace(once("(the shape it was derived from"), "the shape it was derived from")), /carries 0 parentheticals/);
});
