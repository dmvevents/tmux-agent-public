/**
 * README.md is a CHECKED contract, not a description: it is the page a stranger reads
 * first, so gate G6 (Docs) and the KR3 stranger walkthrough both stand on it being true.
 *
 * Measured 2026-09-10 against the built tree on 25febbc: the MCP section listed 12 tools while
 * tools/list served 13 (policy-status — the same omission TMUX-83 had just closed in
 * VERSIONING.md, never carried here), and the Development block's suite counts and coverage
 * percentages were two weeks and 80 unit tests stale. No test read README (`grep -ln README
 * test/` → three files, none of which parse it), so nothing went red. Same class as TMUX-82
 * (CHANGELOG) and TMUX-83 (VERSIONING), now on the entry document.
 *
 * This file parses README.md AS DATA and asserts, against the built artefacts:
 *  (a) the `Tools:` list of the MCP section ≡ tools/list from dist/mcp/server.js, both directions;
 *  (b) every `tmux-agent <verb>` on a command line of a fenced bash block is a dispatch `case`
 *      label in dist/bin/tmux-agent.js, and every `--flag` on those lines (plus every backticked
 *      `--flag` in prose) is read there via the flag registry or flag("x")/has("x");
 *  (c) every `npm run <script>` names a script in package.json;
 *  (d) every relative markdown link resolves to a path in the repo;
 *  (e) no hard-coded suite counts or coverage percentages anywhere on the page — they change
 *      every fire and live in docs/TESTING.md's measured table, which README points at instead.
 *
 * TMUX-140 added the one table on the page — the one that answers "does this support MY CLI" — and the
 * two adapter types the "Agnostic core" bullet above it points an author at. Measured 2026-09-20 on
 * c90a3fd (scratch/ga-fire-2026-09-20-12Z/probe/): `grep -rh "Profile | Status" test/` and
 * `grep -rh "Agnostic core" test/` each returned 0 lines, and on planted copies of the pushed tree,
 * README dropping the `aider` row while the chain still returned the profile (red-parent/A.log) and
 * README telling a reader to copy `aiderProfile` — the export VERSIONING.md's own NOT-covered section
 * declares INTERNAL — (red-parent/C.log) were each byte-identical to the control. A FIFTH built-in the
 * page never names was caught only by two fixture literals in test/lexicon.test.js (red-parent/B.log),
 * neither naming README nor a declaration. The parse lives in test/helpers/readme-doc.js, where a case
 * can plant drift in a doc STRING; it adds:
 *  (f) the table's first cells ≡ `resolveProfiles({})`'s chain, set-equal AND order-equal (first match
 *      wins, so the order a stranger reads is a claim about which profile wins);
 *  (g) the same names, same order, against the second authority — Monitor's constructor default;
 *  (h) "declared" means HONOURED: one real fixture per name, the chain member of that name speaking
 *      where the fallback does not, and generic-shell's own case being that it is last;
 *  (i) the bullet's adapter types are types dist/index.d.ts declares — "add one for your CLI in ~20
 *      lines" must resolve to something a consumer can import;
 *  (j) no export the NOT-covered section calls INTERNAL is backticked anywhere on the page.
 *
 * TMUX-153 added the `status.json` gloss — the sentence that tells a stranger what is in the file a collector
 * parses, and the only place on the page they are told before they write one. Measured 2026-09-22 on 0b1e4a4
 * (scratch/ga-fire-2026-09-22-12Z/probe-readme-status.log, -gloss.log, -gloss2.log): it offered FIVE names for
 * a record that carries fourteen, and three of the five — `ctx%`, `lineage`, `last line` — named no field at
 * all; `ctx%` was a token the whole shipped tree used nowhere else, and a reader who wrote `s.lineage` from it
 * got undefined. `grep -rh "machine-readable fleet state\|ctx%" test/ scripts/` returned 0, so every word of
 * it could drift while the suite stayed green. Watched FAIL on the parent tree before the correction
 * (scratch/ga-fire-2026-09-22-14Z/red-1-parent-gloss.log). It adds:
 *  (k) the gloss's names ≡ VERSIONING.md item 4's declared per-session fields, both directions, each written
 *      as a code span, with the page's own "those fields and no others" claim read as data;
 *  (l) the same names against the SECOND authority — the keys the built writer puts in a real status.json
 *      record (test/helpers/status-record.js, the drive item 4's own case uses), so a rename in the
 *      declaration cannot make doc and doc agree while the package writes something else;
 *  (m) the parse's own rules: both cuts asserted present, the claim ABOUT the list not read as a member of
 *      it, an empty or duplicated list refused, and an unbackticked name still READ — or the drifted
 *      sentence would have parsed as clean.
 *
 * BANLIST discipline: an empty parsed list is a hard failure, never a vacuous pass; and the
 * check was watched FAIL first on the drifted README (naming policy-status and the stale number
 * lines) before the reconciliation that made it pass — output on TMUX-84.
 *
 * Run: node --test test/readme-contract.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toolsList, assertSameSet } from "./helpers/mcp-contract.js";
import { declaredNotCovered, declaredSessionFields, flatten } from "./helpers/versioning-doc.js";
import { shippedSessionRecord } from "./helpers/status-record.js";
import {
  agnosticBullet,
  declaredAdapterTypes,
  declaredProfiles,
  declaredStatusFields,
  statusSection,
  BULLET_SUBJECT,
  PROFILE_START,
  PROFILE_END,
  TABLE_HEADER,
  STATUS_SECTION,
  GLOSS_START,
  GLOSS_END,
  GLOSS_ALL_CLAIM,
} from "./helpers/readme-doc.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const LINES = README.split("\n");

/** Every `backticked` token in a run of text. */
function ticks(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function nonEmpty(list, what) {
  assert.ok(list.length > 0, `parsed ZERO ${what} from README.md — an empty contract is a hard failure, not a pass`);
  return list;
}

/** Body of the `## heading` section whose heading starts with `prefix`, up to the next `## `. */
function section(prefix) {
  const start = LINES.findIndex((l) => l.startsWith(prefix));
  assert.ok(start > -1, `README.md must keep its "${prefix}" section`);
  let end = LINES.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = LINES.length;
  return LINES.slice(start + 1, end).join("\n");
}

/** `tmux-agent <verb> <rest>` command lines of every fenced bash block, trailing `# comment` cut. */
function commandLines() {
  const out = [];
  for (const block of README.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const raw of block[1].split("\n")) {
      const line = raw.replace(/\s+#.*$/, "");
      const m = /^\s*tmux-agent ([a-z-]+)(.*)$/.exec(line);
      if (m) out.push({ verb: m[1], rest: m[2] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// (a) MCP section — the Tools: list ≡ tools/list from the built server (both directions)
// ---------------------------------------------------------------------------------------------
test("readme: the MCP section's Tools list equals tools/list from dist/mcp/server.js (both directions)", async () => {
  const para = section("## MCP server").split(/\n[ \t]*\n/).find((p) => p.startsWith("Tools:"));
  assert.ok(para, 'README.md\'s MCP section must keep its "Tools:" paragraph');
  const declared = nonEmpty(ticks(para), "MCP tool names (Tools: paragraph)");

  // Non-read-only policy in a clean home: read-only HIDES mutating tools by design, so only this
  // posture shows the full advertised set (test/mcp.test.js covers the hidden case).
  const home = mkdtempSync(join(tmpdir(), "ta-readme-"));
  writeFileSync(join(home, "policy.json"), JSON.stringify({ surfaces: { mcp: { readOnly: false } } }));
  try {
    const live = await toolsList({ TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: `ta-readme-${process.pid}` });
    assert.ok(live.length > 0, "tools/list returned no tools — the server did not answer; refusing to compare against nothing");
    assertSameSet(declared, live, { declaredAs: "README.md's Tools: list", liveAs: "tools/list" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// (b) every verb shown is dispatched by dist/bin/tmux-agent.js; every flag shown is read there
// ---------------------------------------------------------------------------------------------
test("readme: every tmux-agent verb in a bash block is dispatched, and every flag shown is read by the binary", () => {
  const bin = readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8");
  // `case "spawn":` labels are how a verb gets dispatched at all (same observable as TMUX-83)
  const labels = new Set([...bin.matchAll(/^\s*case "([a-z]+)":/gm)].map((m) => m[1]));
  assert.ok(labels.size > 0, "found no case labels in dist/bin/tmux-agent.js — is the tree built?");
  // a flag is read via the registry or a direct flag("x")/has("x") lookup
  const read = new Set([
    ...[...bin.matchAll(/(?:VALUE|BOOL)_FLAGS = new Set\(\[([^\]]*)\]\)/g)].flatMap((m) => [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1])),
    ...[...bin.matchAll(/\b(?:flag|has)\("([a-z-]+)"\)/g)].map((m) => m[1]),
  ]);
  assert.ok(read.size > 0, "found no flag reads in dist/bin/tmux-agent.js — is the tree built?");

  const verbs = new Set(), flags = new Set();
  for (const { verb, rest } of commandLines()) {
    verbs.add(verb);
    for (const f of rest.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) flags.add(f[1]);
  }
  // prose documents flags too (`--default-server`, `--no-token`): a backticked --flag is a promise
  for (const f of README.matchAll(/`--([a-z][a-z-]*)`/g)) flags.add(f[1]);
  nonEmpty([...verbs], "tmux-agent verbs (bash blocks)");
  nonEmpty([...flags], "--flags (bash blocks + prose)");

  const unknownVerbs = [...verbs].filter((v) => !labels.has(v)).sort();
  const unreadFlags = [...flags].filter((f) => !read.has(f)).sort();
  const problems = [];
  if (unknownVerbs.length) problems.push(`README shows verbs that dist/bin/tmux-agent.js does not dispatch: ${unknownVerbs.join(", ")}`);
  if (unreadFlags.length) problems.push(`README shows flags that dist/bin/tmux-agent.js never reads: --${unreadFlags.join(", --")}`);
  assert.equal(problems.length, 0, problems.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// (c) every `npm run <script>` exists
// ---------------------------------------------------------------------------------------------
test("readme: every npm run <script> names a script in package.json", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {};
  const named = nonEmpty([...new Set([...README.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)].map((m) => m[1]))], "npm run scripts");
  const missing = named.filter((s) => !(s in scripts)).sort();
  assert.deepEqual(missing, [], `README names npm scripts that package.json does not define: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------------------------------------
// (d) every relative link resolves
// ---------------------------------------------------------------------------------------------
test("readme: every relative markdown link resolves to a path in the repo", () => {
  const links = [...README.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^(?:[a-z][a-z+.-]*:|#)/.test(l));
  nonEmpty(links, "relative links");
  const dead = [...new Set(links)].filter((l) => !existsSync(join(ROOT, l.split("#")[0]))).sort();
  assert.deepEqual(dead, [], `README links that resolve to nothing in the repo: ${dead.join(", ")}`);
});

// ---------------------------------------------------------------------------------------------
// (e) no suite counts / coverage literals — they drift every fire; TESTING's table is restamped
// ---------------------------------------------------------------------------------------------
test("readme: no hard-coded suite counts or coverage percentages; the Development section points at docs/TESTING.md", () => {
  const COUNT = /\b\d+ (?:unit|smoke|web-smoke|checks|acceptance criteria)\b/;
  const PCT = /\d+(?:\.\d+)?% (?:lines|branches|functions)\b/;
  const hits = LINES.map((l, i) => (COUNT.test(l) || PCT.test(l)) ? `README.md:${i + 1}: ${l.trim()}` : null).filter(Boolean);
  assert.deepEqual(hits, [], `README carries suite/coverage literals that drift every fire — point at docs/TESTING.md instead:\n${hits.join("\n")}`);
  assert.ok(/\(docs\/TESTING\.md\)/.test(section("## Development")), "README's Development section must link docs/TESTING.md, where the measured numbers live");
});

// ---------------------------------------------------------------------------------------------
// (f)-(j) the "Agnostic core" bullet: the profile table and the adapter types it names
// ---------------------------------------------------------------------------------------------

/**
 * One fixture per declared profile name — the pane text that proves the NAME maps to a profile which
 * actually speaks, not just to a row. Every tail is REAL: `corpusId` reads it out of
 * test/fixtures/state-corpus.json by id, so a stale id is a hard failure rather than a skipped case,
 * and aider's is the documented prompt test/profiles.test.js drives, taken from the profile's own
 * `Apply edit` pattern rather than invented — the hand-written "> Applied edit to foo.py" of the fire
 * that filed this card classified null and cost a probe run. generic-shell is declared the FALLBACK and
 * holds no opinion by design, so its case is the other claim the table makes about it: it is last in
 * the chain, and an unmatched pane is what falls back to it.
 */
const PROFILE_HONOURED = new Map([
  ["claude-code", { corpusId: "claude-write-permission" }],
  ["codex", { corpusId: "codex-update-prompt" }],
  ["aider", { tail: ["Apply edit to main.py? (Y)es/(N)o [Y]"], source: "aider's documented prompt (test/profiles.test.js)" }],
  ["generic-shell", { fallback: true, corpusId: "codex-at-shell" }],
]);

/** The bullet as a standalone doc STRING with `edit` applied, so a case can plant drift without a tree copy. */
function bulletDoc(edit) {
  return `${edit(agnosticBullet(README).join("\n"))}\n\n  ${PROFILE_END} a live Codex session read IDLE.\n`;
}

test("readme: the profile table's first cells ARE resolveProfiles()'s chain, in the table's own order (both directions)", async () => {
  const { resolveProfiles } = await import(join(ROOT, "dist/index.js"));
  const declared = declaredProfiles(README);
  const live = resolveProfiles({}).map((p) => p.name);
  assert.ok(live.length > 0, "resolveProfiles({}) returned an empty chain — the built package did not answer; refusing to compare the table against nothing");
  assertSameSet(declared, live, { declaredAs: "README.md's profile table", liveAs: "resolveProfiles({})'s chain" });
  // Order, not only membership: Monitor takes the FIRST profile with an opinion (dist/core/monitor.js:227),
  // so the order a stranger reads down the table is a claim about which profile wins a contested pane.
  assert.deepEqual(declared, live,
    `README.md's profile table lists the built-in chain in a different ORDER than resolveProfiles({}) returns it (${declared.join(" → ")} vs ${live.join(" → ")}) — first match wins, so the table would be telling a stranger the wrong profile decides`);
});

test("readme: Monitor's constructor default repeats the table's names in the table's order (the second authority)", async () => {
  const { Monitor } = await import(join(ROOT, "dist/index.js"));
  // The default profile list is the whole subject here, and the constructor only assigns its four
  // arguments (dist/core/monitor.js:186) — so a null tmux and a null ledger are passed deliberately:
  // nothing below reaches either, and a constructor that started to would fail loudly rather than
  // quietly measure a stub. A Monitor built without a lexicon is what every embedder gets.
  const monitor = new Monitor(null, null, ROOT);
  const dflt = (monitor.profiles ?? []).map((p) => p.name);
  assert.ok(dflt.length > 0, "a Monitor built with no profiles argument carries an empty chain — the built package did not answer; refusing to compare the table against nothing");
  assert.deepEqual(declaredProfiles(README), dflt,
    `README.md's profile table and Monitor's constructor default disagree (${declaredProfiles(README).join(" → ")} vs ${dflt.join(" → ")}) — an embedder who constructs a Monitor directly gets THIS chain, so the table must answer for it too`);
});

test("readme: every profile name the table declares maps to a profile that actually SPEAKS — one fixture per name", async () => {
  const { resolveProfiles } = await import(join(ROOT, "dist/index.js"));
  const corpus = JSON.parse(readFileSync(join(ROOT, "test/fixtures/state-corpus.json"), "utf8")).fixtures;
  const chain = resolveProfiles({});
  const fallback = chain[chain.length - 1];
  const declared = declaredProfiles(README);
  let checked = 0;
  for (const name of declared) {
    const probe = PROFILE_HONOURED.get(name);
    assert.ok(probe,
      `README.md's profile table declares \`${name}\` and no fixture in PROFILE_HONOURED drives it — the page would be promising a stranger support on the strength of a row alone: add the fixture that proves the profile speaks, or stop declaring it`);
    const tail = probe.corpusId ? corpus.find((f) => f.id === probe.corpusId)?.tail : probe.tail;
    assert.ok(Array.isArray(tail) && tail.length > 0,
      `the fixture for \`${name}\` resolved to no pane text${probe.corpusId ? ` — test/fixtures/state-corpus.json carries no fixture "${probe.corpusId}"` : ""} — a fixture that stopped resolving measures nothing`);
    const member = chain.find((p) => p.name === name);
    assert.ok(member, `no member of resolveProfiles({})'s chain answers to \`${name}\`, which README.md's table declares`);
    if (probe.fallback) {
      assert.equal(member, fallback,
        `README.md's table calls \`${name}\` the fallback and it is not LAST in resolveProfiles({})'s chain (${chain.map((p) => p.name).join(" → ")}) — first match wins, so a fallback that is not last never runs`);
      assert.equal(chain.find((p) => p.classify(tail) !== null), undefined,
        `a profile had an opinion about the pane \`${name}\`'s case uses as unmatched — the fixture is stale, so the fallback claim is measuring nothing`);
      assert.equal(member.classify(tail), null,
        `\`${name}\` is declared the fallback and it answered ${JSON.stringify(member.classify(tail))} for an unmatched pane — the floor's job is to hold no opinion so the core CPU-delta signals decide`);
    } else {
      assert.notEqual(member.classify(tail), null,
        `README.md declares \`${name}\` as a supported profile and the chain member of that name has NO opinion about its own captured pane text — the row promises a stranger a profile that speaks for their CLI`);
      assert.equal(fallback.classify(tail), null,
        `the fallback \`${fallback.name}\` also classified \`${name}\`'s fixture, so the fixture proves nothing about \`${name}\` — pick a pane only that profile speaks for`);
    }
    checked += 1;
  }
  assert.equal(PROFILE_HONOURED.size, checked,
    `PROFILE_HONOURED carries ${PROFILE_HONOURED.size} fixtures for the table's ${checked} declared names — a fixture for a row the page no longer carries is drift of its own`);
});

test("readme: the adapter types the Agnostic-core bullet names are types the built package declares", () => {
  const dts = readFileSync(join(ROOT, "dist/index.d.ts"), "utf8");
  const types = new Set([...dts.matchAll(/export type \{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(",").map((t) => t.trim()).filter(Boolean)));
  assert.ok(types.size > 0, "dist/index.d.ts re-exports no types — is the tree built? refusing to judge the bullet against nothing");
  const declared = declaredAdapterTypes(README);
  const missing = declared.filter((t) => !types.has(t)).sort();
  assert.deepEqual(missing, [],
    `README.md's Agnostic-core bullet points an author at ${missing.join(", ")}, which dist/index.d.ts does not declare (it declares ${types.size}) — "add one for your CLI in ~20 lines" must resolve to a name a consumer can import`);
});

test("readme: no export VERSIONING.md's NOT-covered section calls INTERNAL is backticked anywhere on the page", () => {
  const internal = declaredNotCovered(readFileSync(join(ROOT, "VERSIONING.md"), "utf8")).exports;
  assert.ok(internal.length > 0, "VERSIONING.md's NOT-covered section declares no internal root exports — refusing to judge README.md against an empty list");
  const named = internal.filter((n) => README.includes(`\`${n}\``)).sort();
  assert.deepEqual(named, [],
    `README.md backticks ${named.join(", ")}, which VERSIONING.md's NOT-covered section declares INTERNAL — the page a stranger copies from would be teaching an import no semver promise covers: send them to \`resolveProfiles()\`, a declared root export, instead`);
});

test("readme: the bullet's three markers are asserted present, its subject declares nothing, and a parenthetical is prose", () => {
  // A marker that stopped matching must fail loudly rather than silently widen or empty the parse —
  // VERSIONING.md's item 2 lost its cut to a rewrap and read prose as a declaration.
  assert.throws(() => declaredProfiles(bulletDoc((t) => t.replace(PROFILE_START, "The built-in profiles are:"))), /no longer occurs in README\.md's Agnostic-core bullet/);
  assert.throws(() => declaredProfiles(bulletDoc((t) => t.replace(BULLET_SUBJECT, "- **Profiles"))), /no longer opens a bullet with/);
  assert.throws(() => declaredProfiles(agnosticBullet(README).join("\n")), /no longer followed by/, "with PROFILE_END gone the region would run to the end of the page and read the worked example's pane text as declared names");
  // The subject names the bullet, never an adapter type; a parenthetical is prose ABOUT what precedes it.
  const planted = bulletDoc((t) => t
    .replace(`${BULLET_SUBJECT}:**`, `${BULLET_SUBJECT}, one \`FakeType\` per CLI:**`)
    .replace("(context %, spinner/menu detection)", "(context %, a `FakeAside` type)"));
  assert.deepEqual(declaredAdapterTypes(planted), declaredAdapterTypes(README),
    "the bullet's own subject and a parenthetical inside it must declare no adapter type (TMUX-133's rule, in this file)");
});

test("readme: the table parse reads FIRST CELLS only, and refuses an empty, duplicated or open-ended list", () => {
  const rows = declaredProfiles(README);
  // Every plant below edits the REAL bullet, so each anchor is asserted present in its own voice first:
  // a plant whose anchor moved applies nothing, and a case that plants nothing measures nothing.
  const MOVED_ANCHOR = "| `aider` | best-effort";
  const DUPE_ANCHOR = "  | `codex` |";
  for (const anchor of [MOVED_ANCHOR, DUPE_ANCHOR]) {
    assert.ok(agnosticBullet(README).join("\n").includes(anchor),
      `fixture stale: this case plants drift by editing "${anchor}", which README.md's table no longer carries verbatim — the plant would apply nothing and the rules below would be asserted against the shipped page`);
  }
  // The shape this card is about: a name moved out of a first cell into a status cell is no longer a
  // declaration, so the comparison against the built chain goes red for it instead of passing quietly.
  const moved = declaredProfiles(bulletDoc((t) => t.replace(MOVED_ANCHOR, "| aider | best-effort with `aider`")));
  assert.ok(!moved.includes("aider"), `a name in a STATUS cell still parsed as declared (${moved.join(", ")}) — the first-cell rule is what makes the table a declaration rather than a page mentioning words`);
  assert.equal(moved.length, rows.length - 1, "moving one name out of a first cell must drop exactly that one name");
  // Duplicates: the status cell of row 1 already says "a real `codex` CLI", so a flat read of the rows
  // fails on the shipped page — and a row repeated is what a parse that widened looks like.
  assert.throws(() => declaredProfiles(bulletDoc((t) => t.replace(
    DUPE_ANCHOR,
    `${DUPE_ANCHOR} **verified** |\n${DUPE_ANCHOR}`))), /parses codex more than once/);
  // An empty parse is a hard failure, never a vacuous pass — and a table that stopped being a table
  // parses as zero rows, which is the same hazard one step earlier.
  assert.throws(() => declaredProfiles(bulletDoc((t) => t.replace(/^\s*\|\s*`.*$/gm, ""))), /parsed ZERO profile names/);
  assert.throws(() => declaredProfiles(bulletDoc((t) => t.replace(TABLE_HEADER, "Profiles:"))), /no longer carries the/);
  // Nothing backticked after the last row: there a name could mean nothing except a declaration.
  assert.throws(() => declaredProfiles(bulletDoc((t) => `${t}\n  Also \`gemini-cli\`, soon.`)), /between the last row of the profile table/);
});

// ---------------------------------------------------------------------------------------------
// (k)-(m) the `status.json` gloss: the sentence a collector's author reads before writing one
// ---------------------------------------------------------------------------------------------

const VERSIONING = readFileSync(join(ROOT, "VERSIONING.md"), "utf8");

/**
 * The gloss's region replaced wholesale, as a standalone doc STRING — the plant path this file already uses
 * for the profile table, here for a region a plant needs to empty or duplicate rather than edit in place.
 */
function glossDoc(inner) {
  // Flattened, because the cuts are: README wraps mid-marker today ("… )) is\npublished on every …"), so a
  // plant built on the raw lines would find no end marker and every rule below would be asserted against the
  // shipped page. flatten() is what the parse reads anyway, and the heading stays its own line so the section
  // cut still has one to find.
  const body = flatten(statusSection(README).slice(1).join("\n"));
  const a = body.indexOf(GLOSS_START);
  const b = body.indexOf(GLOSS_END, a);
  assert.ok(a > -1 && b > a,
    `fixture stale: README.md's "${STATUS_SECTION}" section no longer carries "${GLOSS_START}" followed by "${GLOSS_END}" — every plant below would apply nothing and the rules would be asserted against the shipped page`);
  return `${STATUS_SECTION}\n${body.slice(0, a + GLOSS_START.length)}${inner}${body.slice(b)}\n\n## Development\n`;
}

/**
 * The three ways the gloss can lie about the record, COLLECTED — one message, never a throw per name.
 * Measured while watching this red on the parent tree (scratch/ga-fire-2026-09-22-14Z/red-1-parent-gloss.log):
 * a loop that threw on the first unresolvable name would have reported `ctx%` and left `lineage` and
 * `last line` green by silence, which is how a sentence with three holes in it reads as having one.
 */
function glossProblems(gloss, live, liveAs) {
  const problems = [];
  const unresolvable = gloss.names.filter((n) => !live.includes(n)).sort();
  const unoffered = live.filter((n) => !gloss.names.includes(n)).sort();
  if (unresolvable.length) problems.push(
    `README.md's \`status.json\` gloss offers ${unresolvable.join(", ")}, which ${liveAs} does not carry — a collector written from this sentence reads undefined under every one of those names`);
  if (unoffered.length) problems.push(
    `${liveAs} carries ${unoffered.join(", ")}, which the gloss does not offer — a reader who takes this sentence for the record's shape never learns those fields are there`);
  if (gloss.bare.length) problems.push(
    `the gloss offers ${gloss.bare.join(", ")} as prose rather than as a code span — a name a reader is meant to type into \`record[name]\` is written \`like this\` everywhere else on the page, and an unbackticked one is indistinguishable from a description of the field`);
  if (!gloss.all) problems.push(
    `the gloss no longer claims "${GLOSS_ALL_CLAIM}" — with that gone it does not say whether it names the whole record or a subset, and a documented subset must not be indistinguishable from a stale copy (test/a11y.test.js's \`chip_states\` case, TMUX-152)`);
  return problems;
}

test("readme: the `status.json` gloss's names ARE item 4's declared per-session fields, as code spans, both directions", () => {
  const declared = declaredSessionFields(VERSIONING);
  assert.ok(declared.length > 0, "VERSIONING.md item 4 declares no per-session fields — refusing to judge README.md's gloss against an empty list");
  const gloss = declaredStatusFields(README);
  assert.equal(glossProblems(gloss, declared, "VERSIONING.md item 4's per-session list").join("\n"), "");
  // Counts too, the second lock the parsed items next door carry: a name parsed twice satisfies both
  // directions while the offer is not what the parse says it is. refuseDuplicates() catches it first.
  assert.equal(gloss.names.length, declared.length,
    `the gloss offers ${gloss.names.length} names for item 4's ${declared.length} declared fields — the cut is keeping more than the sentence's own list`);

  // The card's plant (b): one name deleted from the corrected sentence. A subset would pass a one-direction
  // check, so the other direction is what makes this red — and it is the drift this whole card is about.
  const dropped = glossProblems(declaredStatusFields(glossDoc(`: each session's \`session\`, \`state\`, \`at\`, \`lastLine\`, \`classifiedBy\`, \`contextPct\`, \`logBytes\`, \`rssBytes\`, \`cpuPerSec\`, \`reason\`, \`parent\`, \`task\`, \`owner\` — ${GLOSS_ALL_CLAIM}) `)), declared, "item 4");
  assert.ok(dropped.some((p) => p.includes("carries meta")), `deleting \`meta\` from the gloss left it clean: ${dropped.join(" | ") || "no problems at all"}`);

  // Plant (c): a name the record does not carry — `lineage` is the honest one, since it is what the drifted
  // sentence offered and what a reader actually wrote (`s.lineage` → undefined).
  const phantom = glossProblems(declaredStatusFields(glossDoc(`: each session's \`session\`, \`lineage\` — ${GLOSS_ALL_CLAIM}) `)), declared, "item 4");
  assert.ok(phantom.some((p) => p.includes("offers lineage")), `the gloss offering \`lineage\`, which no record carries, left it clean: ${phantom.join(" | ") || "no problems at all"}`);

  // Plant (d): the AUTHORITY moves, not the page — item 4 renames a field and the README claim goes red for it.
  const renamed = VERSIONING.replace("`contextPct`, `logBytes`", "`ctxPct`, `logBytes`");
  assert.notEqual(renamed, VERSIONING, "fixture stale: item 4's per-session list no longer reads \"`contextPct`, `logBytes`\"");
  const moved = glossProblems(gloss, declaredSessionFields(renamed), "item 4");
  assert.ok(moved.some((p) => p.includes("offers contextPct")) && moved.some((p) => p.includes("carries ctxPct")),
    `item 4 renamed a field and the gloss still answered for it: ${moved.join(" | ") || "no problems at all"}`);
});

test("readme: the same names are the keys a REAL status.json record carries — a second authority, not a second copy", async () => {
  // Item 4's declaration and this page are both DOCS: held against each other alone, a rename in the
  // declaration would make doc and doc agree while the package wrote something else. So the gloss answers
  // to the same writer item 4 answers to (test/helpers/status-record.js), never to a hand-typed key list.
  const live = await shippedSessionRecord("readme");
  assert.ok(live.length > 0, "the built writer wrote a session record with no keys — refusing to judge README.md's gloss against nothing");
  assert.equal(glossProblems(declaredStatusFields(README), live, "the keys the built writer wrote into a status.json session record").join("\n"), "");
});

test("readme: the gloss parse is cut at both ends, drops the claim ABOUT the list, and refuses an empty or duplicated one", () => {
  // A marker that stopped matching must fail loudly rather than silently widen or empty the parse.
  assert.throws(() => declaredStatusFields(glossDoc(": `session`) ").replace(GLOSS_START, "machine-readable state of the fleet")), /no longer occurs in README\.md's/);
  assert.throws(() => declaredStatusFields(glossDoc(": `session`) ").replace(GLOSS_END, "ships on every")), /no longer follows README\.md's/);
  assert.throws(() => declaredStatusFields(glossDoc(": `session`) ").replace(STATUS_SECTION, "## Status and analytics")), /no longer carries a/);
  assert.throws(() => declaredStatusFields(statusSection(README).join("\n")), /no longer followed by another/,
    "with no following heading the region would run to the end of the page, where `--json`, the profile table's names and every other backticked token read as offered fields");
  // An empty parse is a hard failure, never a vacuous pass — and a duplicate is what a widened cut looks like.
  assert.throws(() => declaredStatusFields(glossDoc(") ")), /parsed ZERO per-session field names/);
  assert.throws(() => declaredStatusFields(glossDoc(": `session`, `state`, `session`) ")), /parses session more than once/);
  // The claim ABOUT the list ends it: prose after GLOSS_ALL_CLAIM explains the fields, so a name mentioned
  // there is an example, not an offer — the rule that lets the sentence say what a null means without
  // declaring `meta` twice.
  const claimed = declaredStatusFields(glossDoc(`: each session's \`session\` — ${GLOSS_ALL_CLAIM}, a null in \`meta\` where the host did not answer) `));
  assert.deepEqual(claimed.names, ["session"], "a name in the prose AFTER the enumeration claim was read as an offered field");
  assert.equal(claimed.all, true);
  // And with the claim gone the gloss says nothing about being whole, which the contract cases report.
  assert.equal(declaredStatusFields(glossDoc(": `session`) ")).all, false,
    `the gloss dropped "${GLOSS_ALL_CLAIM}" and still read as claiming the whole record`);
  // The drifted sentence's own shape: unbackticked names ARE read, or the parent tree would have looked clean.
  const drifted = declaredStatusFields(glossDoc(": session, state, ctx%, lineage, last line) "));
  assert.deepEqual(drifted.names, ["session", "state", "ctx%", "lineage", "last line"]);
  assert.deepEqual(drifted.bare, drifted.names, "every name of the drifted sentence was prose, so every one must be reported as prose");
});
