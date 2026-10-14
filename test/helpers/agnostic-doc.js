/**
 * The parse of docs/AGNOSTIC-DESIGN.md — the three-lexicon table that enumerates the rule the whole
 * product rests on, and since TMUX-143 the §2 calibrate contract and the §3 agent-facing
 * file set beside it. Shared by test/agnostic-contract.test.js and by that file's checks of the parse
 * itself.
 *
 * CONTRIBUTING rule 5 ("Agnostic core") names the three places our fleet's vocabulary leaked into the
 * source — classification regexes, non-session parent names, secret shapes — and links here for them;
 * AGENTS.md carries the same rule to any agent working on the repo. The table at the top of that page
 * IS the enumeration: three lexicons, the module each lives in, and the exact vocabulary in each that
 * is ours rather than an adopter's. No test read a byte of it. Measured 2026-09-20 on the pushed
 * 3765f06 (scratch/ga-fire-2026-09-20-14Z/probe/readers.log), every grep written `-rhF` rather than
 * `-rn` so a path word cannot manufacture a hit: `grep -rhF AGNOSTIC-DESIGN test/` → 0,
 * `"Whose vocabulary"` → 0, `"Non-session parent names"` → 0, `"Secret shapes to redact"` → 0. Two of
 * the three rows were already incomplete against their live authorities — row 2 named 6 of the 10
 * entries `NON_SESSION_PARENTS` and `NON_SESSION_PARENT_RE` hold, with `user`, `systemd`, `unknown`
 * and `^loop-` in the code and in no sentence — and on planted copies of that tree the doc ceasing to
 * name `cron`, `aider` or `Slack`, and the BUILT parent set gaining `"jenkins"`, were each
 * byte-identical to the unit suite's control.
 *
 * THREE LISTS, not one, because the rows answer to three different live authorities: row 1 to
 * `resolveProfiles({})`'s chain, row 2 to the parent predicate `computeEngagement` runs, row 3 to the
 * markers `redact()` emits. `declaredLexicons()` therefore returns one record per row, pairing each
 * vocabulary list with the `Where` path that says who must answer for it.
 *
 * The rules are the ones the parsed docs next door already pay for (test/helpers/versioning-doc.js,
 * test/helpers/readme-doc.js):
 *  - every marker is ASSERTED PRESENT, so a reworded one fails loudly instead of silently widening or
 *    emptying the parse;
 *  - `nonEmpty()` and `refuseDuplicates()` run PER LIST — three rows are three declarations (TMUX-122,
 *    TMUX-137);
 *  - every parenthetical is dropped, innermost-first: a parenthetical is prose ABOUT what precedes it,
 *    which is what keeps row 3's "(any `*_API_KEY=` spelling included)" aside out of the declaration
 *    (TMUX-133);
 *  - nothing may be backticked between the last row and TABLE_END, since there is nothing a name could
 *    mean there except a declaration.
 *
 * Two hazards are specific to this page and are why the region cut is bounded at BOTH ends. The doc
 * carries THREE tables (the calibrate layers and the audiences below), so a parse that takes
 * `|`-leading lines from the header onward swallows 21 tokens of the other two — `calibrate`,
 * `k8s-job`, `tmux-agent-calibrate`, `AGENTS.md` — as declared vocabulary; and the jsonc lexicon
 * example under the table pairs its fence backticks into one token carrying the whole example. Both
 * sit after TABLE_END.
 *
 * Cells are split on the pipes OUTSIDE backticks. Row 3 used to write the envelope shapes as
 * `` `Authorization: Bearer|Basic <cred>` ``, a `|` markdown reads as a cell boundary: a naive
 * `split("|")` mis-columns the row, and `ticks()` on the desynchronized cell returns
 * `[", ", " / ", " / "]` — three punctuation runs standing in for names.
 *
 * Lives here rather than in the suite so a case can plant drift in a doc STRING and assert what the
 * parse yields — no tree copy needed. `ticks()` comes from test/helpers/versioning-doc.js (it is
 * doc-agnostic; the guards below are not, so they carry this page's voice).
 *
 * ── §2 and §3, added by TMUX-143 ───────────────────────────────────────────────────────────────
 *
 * 953 of the page's 12018 normalized chars were parsed — the first table and nothing else — and the
 * parse deliberately STOPPED at TABLE_END, with a case asserting that it stops. So the suite already
 * knew the other two tables existed and read no byte of them. Measured 2026-09-20 on the pushed
 * 75ebb86 (scratch/ga-fire-2026-09-20-22Z/probe/), every grep `-rhF` so a path word cannot manufacture
 * a hit: `lexicon.draft.json` → 0, `"Never auto-apply"` → 0, `"Where an agent fits"` → 0,
 * `tmux-agent-adopt` → 0, `tmux-agent-supervise` → 0, `.claude/skills` → 0, `"five test layers"` → 0.
 * And §2's usage block was FALSE: it told an adopter to type a sampling flag that occurred exactly once
 * in the whole repo — in that block — implemented by nothing, read by nothing, and refused by the built
 * CLI with exit 64. Five drift classes were byte-identical to the unit suite's control on planted copies
 * of that tree (the CLI growing a `calibrate --limit` the doc never names; the doc dropping `--out`, the
 * only flag it has; the layers table naming a skill with no directory; the §3 list dropping a shipped
 * skill; and `calibrate --out` ALSO overwriting the home's `lexicon.json`, the "never auto-apply"
 * promise broken with the home's sha moving), while the same class of deletion on the ALREADY-parsed
 * three-lexicon table was RED — which is what makes those silences evidence.
 *
 * FOUR REGIONS, each cut to its OWN markers so the first table's region is untouched (its two boundary
 * cases assert the later headers are present in the page and absent from that region, and they must
 * stay green): the fenced usage line under §2's heading, the calibrate-layers table, §3's audiences
 * table, and §3's skills list. Same rules as above — markers asserted present, `nonEmpty()` and
 * `refuseDuplicates()` per list.
 *
 * Two deliberate differences from the first table's reader, both because the region is a different
 * shape rather than because the rule is softer:
 *  - the usage block is a FENCE, not backticked prose, so `ticks()` yields nothing there: it needs a
 *    reader of its own, anchored at `--` so that a flag's VALUE on the same line (`--out FILE`) cannot
 *    read as a second flag;
 *  - parentheticals are NOT dropped in the layers table, because there the parenthetical IS the
 *    artefact — row 1's "Who does it" cell is "**Deterministic code** (`calibrate`)" — rather than
 *    prose about a list, which is what TMUX-133's rule exists to strip.
 */
import assert from "node:assert/strict";
import { ticks } from "./versioning-doc.js";

/** The sentence that introduces the table: the region starts here, never at the header. */
export const TABLE_START = "Every token of vocabulary that is ours rather than an adopter's, one row per lexicon:";
/** The paragraph that ends the declaration — without it the region runs into the doc's other two tables. */
export const TABLE_END = "Read as data by the suite";
/** The table's own header, asserted present so a parse of zero rows cannot be a missing table. */
export const TABLE_HEADER = "| Lexicon | Where | Whose vocabulary is it? |";

/** §2's calibrate contract: the heading the fenced usage line sits under. */
export const USAGE_START = "### `tmux-agent calibrate` — propose, never apply";
/** §2's fourth numbered promise — the one a case DRIVES against the built binary rather than reads. */
export const NO_AUTO_APPLY = "**Never auto-apply.**";
/** §2's layers table: the sentence that introduces it, its header, and the paragraph that closes it. */
export const LAYERS_START = "Calibration is deliberately split so the mechanical half needs no model:";
export const LAYERS_HEADER = "| Layer | Who does it | Why there |";
export const LAYERS_END = "So: deterministic evidence → agent interpretation → human ratification.";
/** §3's audiences table: introduced here, ended by the heading of the skills list below it. */
export const AUDIENCES_START = "Two distinct audiences, which is why this needs stating rather than one catch-all file:";
export const AUDIENCES_HEADER = "| Audience | File | Contract it carries |";
/** §3's skills list: its own heading, ended by the heading of the subsection after it. */
export const SKILLS_START = "### Skills (in-repo, so they version with the code that they describe)";
export const SKILLS_END = "### Memory: the ledger is the substrate, the lexicon is the learning";

/** `|---|---|---|` and friends: a row that declares nothing. */
const SEPARATOR = /^\s*\|[\s|:-]+\|\s*$/;

function nonEmpty(list, what) {
  assert.ok(list.length > 0, `parsed ZERO ${what} from docs/AGNOSTIC-DESIGN.md — an empty contract is a hard failure, not a pass`);
  return list;
}

/**
 * Refuse a token a row declares twice. A name parsed twice is what a cell read that kept prose looks
 * like, and the comparison against the live authority cannot see it: both directions agree while the
 * declaration is not what the parse says it is.
 */
function refuseDuplicates(names, what, noun) {
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort();
  assert.deepEqual(twice, [], `docs/AGNOSTIC-DESIGN.md's ${what} parses ${twice.join(", ")} more than once — either it declares a ${noun} twice or the read kept text beside the list`);
  return names;
}

/** Every parenthetical gone, innermost-first to a fixpoint so a nested one cannot leave its contents. */
export function dropParentheticals(text) {
  let out = text;
  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(/\([^()]*\)/g, " ");
  }
  return out;
}

/**
 * A row's cells, split on the pipes that are OUTSIDE backticks — the trap row 3 used to set. A `|`
 * inside a backticked token is part of the token, not a column boundary.
 */
export function cells(line) {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cur = "";
  let tick = false;
  for (const ch of body) {
    if (ch === "`") tick = !tick;
    if (ch === "|" && !tick) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * The raw lines of the three-lexicon table's region, from the sentence that introduces it to the
 * paragraph that ends it. Raw rather than normalized because a table is line-structural: a row is a
 * LINE, and flattening the region would leave `| |` as the only row boundary (readme-doc.js's reason,
 * in this file). Both markers are asserted present in their own voice.
 */
export function lexiconTable(doc) {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l.includes(TABLE_START));
  assert.ok(start > -1, `docs/AGNOSTIC-DESIGN.md no longer introduces its three-lexicon table with "${TABLE_START}" — the vocabulary would then be declared by nothing and compared against its live authorities as empty sets; a marker that stopped matching is a hard failure, not a pass`);
  const end = lines.findIndex((l, i) => i > start && l.includes(TABLE_END));
  assert.ok(end > start, `docs/AGNOSTIC-DESIGN.md's three-lexicon table is no longer followed by "${TABLE_END}" — the region would run to the end of the page and read the doc's other two tables (the calibrate layers, the audiences) and its jsonc lexicon example as declared vocabulary; a marker that stopped matching is a hard failure, not a pass`);
  return lines.slice(start, end);
}

/**
 * One record per table row, in the table's own order: `{ lexicon, where, vocab }`. `vocab` is the
 * backticked tokens of the THIRD cell — the declaration — and `where` the single backticked path of
 * the second, the module that must answer for them. The first cell is editorial and is returned
 * unparsed: row 1 backticks `BLOCKED`/`WORKING`/`ERROR` there, real states but not this table's
 * payload.
 */
export function declaredLexicons(doc) {
  const region = lexiconTable(doc);
  const header = region.findIndex((l) => l.includes(TABLE_HEADER));
  assert.ok(header > -1, `docs/AGNOSTIC-DESIGN.md no longer carries the "${TABLE_HEADER}" header after "${TABLE_START}" — a table that stopped being a table parses as zero rows, and an empty declaration is a hard failure rather than a pass`);
  const body = region.slice(header + 1);
  const rows = [];
  let last = -1;
  body.forEach((line, i) => {
    if (!/^\s*\|/.test(line) || SEPARATOR.test(line)) return;
    const cell = cells(line);
    assert.equal(cell.length, 3, `docs/AGNOSTIC-DESIGN.md's row "${cell[0]}" splits into ${cell.length} cells rather than 3 — a bare \`|\` outside backticks reads as a column boundary, so the Where and vocabulary cells would be mis-columned and the parse would compare punctuation against a live authority`);
    const where = ticks(cell[1]);
    assert.equal(where.length, 1, `docs/AGNOSTIC-DESIGN.md's row "${cell[0]}" backticks ${where.length} paths in its Where cell (${where.join(", ") || "none"}) — exactly one module must answer for a row's vocabulary, or the suite cannot tell which one to hold it against`);
    rows.push({
      lexicon: cell[0],
      where: where[0],
      vocab: refuseDuplicates(nonEmpty(ticks(dropParentheticals(cell[2])), `vocabulary tokens for \`${where[0]}\``), `\`${where[0]}\` row`, "token"),
    });
    last = i;
  });
  nonEmpty(rows, "table rows (the three-lexicon table)");
  // TMUX-126's rule in this file: after the last row there is nothing a backticked name could mean
  // except a declaration, and the region already ends at TABLE_END.
  const after = ticks(body.slice(last + 1).join(" "));
  assert.deepEqual(after, [], `docs/AGNOSTIC-DESIGN.md backticks ${after.join(", ")} between the last row of the three-lexicon table and "${TABLE_END}", where a name reads as declared vocabulary — put it in a row's third cell to declare it, or name it without backticks if it is only an example`);
  return rows;
}

// ── §2 and §3: the calibrate contract and the agent-facing file set ───────────────────

/**
 * The lines of a region, from the marker that opens it to the one that closes it — the opening line
 * included, the closing line not (`lexiconTable()`'s convention). Both markers are asserted present in
 * their own voice: a reworded one has to be a hard failure, never a parse that silently empties or
 * widens into the section below.
 */
export function regionOf(doc, start, end, what) {
  const lines = doc.split("\n");
  const from = lines.findIndex((l) => l.includes(start));
  assert.ok(from > -1, `docs/AGNOSTIC-DESIGN.md no longer opens ${what} with "${start}" — the region would be empty and everything held against it compared as an empty set; a marker that stopped matching is a hard failure, not a pass`);
  const to = lines.findIndex((l, i) => i > from && l.includes(end));
  assert.ok(to > from, `docs/AGNOSTIC-DESIGN.md no longer closes ${what} with "${end}" — the region would run past its section and read what follows as part of this declaration; a marker that stopped matching is a hard failure, not a pass`);
  return lines.slice(from, to);
}

/**
 * What §2's fenced usage line declares: `{ line, verb, flags }`. The block is a FENCE rather than
 * backticked prose, so `ticks()` yields nothing here and the region is cut to the fence pair under
 * USAGE_START; exactly one command line may live in it, since a second would be a second contract with
 * nothing to choose between them. The flag scan is anchored at `--`, so `FILE` in `[--out FILE]` reads
 * as that flag's value and not as a flag of its own.
 */
export function declaredUsage(doc) {
  const lines = doc.split("\n");
  const head = lines.findIndex((l) => l.includes(USAGE_START));
  assert.ok(head > -1, `docs/AGNOSTIC-DESIGN.md no longer heads its calibrate contract with "${USAGE_START}" — the usage line would be found by nothing and the verb's flags compared against the built CLI as an empty set; a marker that stopped matching is a hard failure, not a pass`);
  const open = lines.findIndex((l, i) => i > head && l.trim() === "```");
  assert.ok(open > head, `docs/AGNOSTIC-DESIGN.md's "${USAGE_START}" is no longer followed by a fenced block — the command an adopter is told to type would be declared by nothing`);
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  assert.ok(close > open, `docs/AGNOSTIC-DESIGN.md's usage block under "${USAGE_START}" is never closed — the parse would read the prose after it as part of the command`);
  const body = lines.slice(open + 1, close).map((l) => l.trim()).filter(Boolean);
  assert.equal(body.length, 1, `docs/AGNOSTIC-DESIGN.md's usage block declares ${body.length} command lines where exactly one is the contract — two spellings of the same verb leave nothing to hold the CLI to, and zero is an empty declaration`);
  const words = body[0].split(/\s+/);
  assert.equal(words[0], "tmux-agent", `docs/AGNOSTIC-DESIGN.md's usage line starts with "${words[0]}" rather than the binary's own name — an adopter types this verbatim`);
  assert.match(words[1] ?? "", /^[a-z]+$/, `docs/AGNOSTIC-DESIGN.md's usage line names "${words[1]}" where a verb belongs — the suite derives the CLI table entry to judge the flags against from this word`);
  const flags = [...body[0].matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
  return { line: body[0], verb: words[1], flags: refuseDuplicates(flags, "fenced usage line", "flag") };
}

/**
 * One record per row of §2's layers table, in the table's own order: `{ layer, who, names }`. `names` is
 * the backticked artefacts of the "Who does it" cell — `calibrate` for the deterministic half,
 * `tmux-agent-calibrate` for the agent's, and NOTHING for the human's. The human row is returned saying
 * it names nothing rather than being skipped: a row dropped from the split must fail, and it cannot if
 * rows without an authority are invisible to the parse. Parentheticals are kept here (see the header).
 */
export function declaredLayers(doc) {
  const region = regionOf(doc, LAYERS_START, LAYERS_END, "the calibrate-layers table");
  const header = region.findIndex((l) => l.includes(LAYERS_HEADER));
  assert.ok(header > -1, `docs/AGNOSTIC-DESIGN.md no longer carries the "${LAYERS_HEADER}" header after "${LAYERS_START}" — a table that stopped being a table parses as zero rows, and an empty declaration is a hard failure rather than a pass`);
  const rows = [];
  region.slice(header + 1).forEach((line) => {
    if (!/^\s*\|/.test(line) || SEPARATOR.test(line)) return;
    const cell = cells(line);
    assert.equal(cell.length, 3, `docs/AGNOSTIC-DESIGN.md's layers row "${cell[0]}" splits into ${cell.length} cells rather than 3 — a bare \`|\` outside backticks reads as a column boundary, so the "Who does it" cell would be mis-columned and the artefact held against the wrong authority`);
    const names = refuseDuplicates(ticks(cell[1]), `layers row "${cell[0]}"`, "artefact");
    assert.ok(names.length <= 1, `docs/AGNOSTIC-DESIGN.md's layers row "${cell[0]}" names ${names.length} artefacts (${names.join(", ")}) in its "Who does it" cell — one row, one thing that must answer for it, or the suite cannot tell which authority the row is making a claim about`);
    rows.push({ layer: cell[0], who: cell[1], names });
  });
  return nonEmpty(rows, "table rows (the calibrate-layers table)");
}

/** One record per row of §3's audiences table: `{ audience, file, contract }`, cells returned unparsed. */
export function declaredAudiences(doc) {
  const region = regionOf(doc, AUDIENCES_START, SKILLS_START, "§3's audiences table");
  const header = region.findIndex((l) => l.includes(AUDIENCES_HEADER));
  assert.ok(header > -1, `docs/AGNOSTIC-DESIGN.md no longer carries the "${AUDIENCES_HEADER}" header after "${AUDIENCES_START}" — a table that stopped being a table parses as zero rows, and an empty declaration is a hard failure rather than a pass`);
  const rows = [];
  region.slice(header + 1).forEach((line) => {
    if (!/^\s*\|/.test(line) || SEPARATOR.test(line)) return;
    const cell = cells(line);
    assert.equal(cell.length, 3, `docs/AGNOSTIC-DESIGN.md's audiences row "${cell[0]}" splits into ${cell.length} cells rather than 3 — a bare \`|\` outside backticks reads as a column boundary, so the File and Contract cells would be mis-columned`);
    rows.push({ audience: cell[0], file: cell[1], contract: cell[2] });
  });
  return nonEmpty(rows, "table rows (§3's audiences table)");
}

/** The skill names §3's list declares: one per top-level bullet, each bullet's single backticked name. */
export function declaredSkills(doc) {
  const region = regionOf(doc, SKILLS_START, SKILLS_END, "§3's skills list");
  const names = region.filter((l) => /^- /.test(l)).map((l) => {
    const named = ticks(l);
    assert.equal(named.length, 1, `docs/AGNOSTIC-DESIGN.md's skills bullet "${l.slice(0, 64)}" backticks ${named.length} names where a bullet declares exactly one skill (${named.join(", ") || "none"}) — a bullet the parse reads as no skill is a directory promised to an adopter and held to nothing`);
    return named[0];
  });
  return refuseDuplicates(nonEmpty(names, "skill names (§3's skills list)"), "skills list", "skill");
}

// ── §1: the lexicon config an adopter writes BY HAND ───────────────────────────────────
//
// §1 is the section an adopter TYPES from, and until this card it was the largest unparsed region of
// the page: 3182 of 13653 normalized chars, measured on 89bf9e2. It is also the only unparsed region
// that re-declared a COVERED surface — VERSIONING.md item 5b has declared the lexicon schema, and the
// suite has parsed it, since TMUX-137 — so §1 was that surface's second declaration, checked by
// nothing. The shape TMUX-143 found for calibrate's flags and TMUX-84 for the README.
//
// Its first design decision was FALSE, and the parse is why it no longer is. The page promised "an
// explicit `\"replace\": true` per section" for as long as it existed; the built loader honours that
// spelling for `parents` alone, `redact` has none by design (decision 2 says so on the same page, so
// decisions 1 and 2 contradicted each other), and `profiles` SILENTLY IGNORED it — `validateLexicon`
// accepts the wrong spelling with no error, and the key that works is `replaceProfiles` at top level.
// Driven through the built binary on a throwaway home (scratch/ga-fire-2026-09-21-04Z/probe/cli-replace.log):
// `"replace": true` beside `profiles`, and `replace` inside a profile, both leave
// `profiles.replaceBuiltins` false with all four built-ins still in the chain, exit 0, no warning —
// which broke decision 4's own promise on the same page ("Validation is loud … never partial-silent").
// So an adopter who followed §1 verbatim to drop our built-in profiles kept them and was told nothing.
//
// TWO REGIONS, each cut to its OWN markers so the first table's region is byte-unchanged (its boundary
// cases at :383/:390 assert the later headers and the example's own names are absent from it, and they
// stay green): the fenced jsonc example under §1's heading, and the six numbered design decisions.
//
// The rules are the ones the regions above pay for — markers asserted present so a reworded one is a
// hard failure rather than an empty parse, `nonEmpty()` and `refuseDuplicates()` per list. Three
// differences, each because §1 is a different shape rather than because the rule is softer:
//  - the example is JSONC, so the parse is a comment strip and a `JSON.parse()`, and its keys are
//    compared as DOTTED PATHS against item 5b's four lists (`top.`, `profile.`, `parents.`, `redact.`),
//    the same four groups that item declares;
//  - the strip takes only a `//` that starts after whitespace, so a `//` inside a pattern string
//    survives. No pattern in the example carries one today; the rule is written for the one that will;
//  - the four `//` comments are CLAIMS about the key on their line, so they are parsed per key and each
//    one is asserted to still say what its case drives — a reworded comment fails loudly.

/** §1's heading: the section an adopter types from, and the marker both regions below are found from. */
export const SECTION_START = "## 1. The fix: lexicons become data, with the shipped values as defaults";
/** §1's intro sentence: the three claims it makes about `lexicon.json` by pointing at `policy.json`. */
export const INTRO_START = "One file, `$TMUX_AGENT_HOME/lexicon.json`";
/** The heading the six design decisions are numbered under, and the §2 heading that closes them. */
export const DECISIONS_START = "### Design decisions, and why each is the safe one";
export const DECISIONS_END = "## 2. The framework of analysis";

/**
 * The lines of §1's fenced lexicon example. The fence is asserted to still name `jsonc`: the block
 * carries `//` comments, which are legal there and nowhere else in JSON, and an adopter who is told
 * "json" types a file their own parser refuses.
 */
export function lexiconExample(doc) {
  const lines = doc.split("\n");
  const head = lines.findIndex((l) => l.includes(SECTION_START));
  assert.ok(head > -1, `docs/AGNOSTIC-DESIGN.md no longer heads §1 with "${SECTION_START}" — the lexicon example an adopter types would be found by nothing and every key it declares compared against item 5b as an empty set; a marker that stopped matching is a hard failure, not a pass`);
  const open = lines.findIndex((l, i) => i > head && l.trim().startsWith("```"));
  assert.ok(open > head, `docs/AGNOSTIC-DESIGN.md's §1 no longer carries a fenced block — the config this page exists to teach would be declared by nothing`);
  assert.equal(lines[open].trim(), "```jsonc", `docs/AGNOSTIC-DESIGN.md's §1 opens its example with "${lines[open].trim()}" rather than \`\`\`jsonc — the block's four // comments are legal in jsonc and in no JSON parser, so the language tag is part of what the page promises an adopter`);
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  assert.ok(close > open, `docs/AGNOSTIC-DESIGN.md's §1 example is never closed — the parse would read the design decisions below it as part of the config`);
  const body = lines.slice(open + 1, close);
  return nonEmpty(body.filter((l) => l.trim()), "lines of §1's lexicon example");
}

/**
 * The example's `//` comments removed, a `//` inside a string kept. Only a comment that starts after
 * WHITESPACE is a comment: `https://` inside a pattern would otherwise eat the rest of its line and
 * the strip would be silently wrong in exactly the place a regex lives. Exported so a case can plant
 * that pattern and prove it survives (test/versioning-contract.test.js:229's rule, this page's shape).
 */
export function stripJsonc(text) {
  return text.replace(/\s\/\/.*$/gm, "");
}

/** §1's example as the config an adopter would have on disk: comment-stripped and `JSON.parse`d. */
export function exampleConfig(doc) {
  const jsonc = lexiconExample(doc).join("\n");
  assert.match(jsonc, /\s\/\//, `docs/AGNOSTIC-DESIGN.md's §1 example carries no // comment — the four in it are the claims this page makes about the keys they sit beside, and a block with none is parsed here as data no test reads back`);
  try {
    return JSON.parse(stripJsonc(jsonc));
  } catch (e) {
    return assert.fail(`docs/AGNOSTIC-DESIGN.md's §1 example does not parse as JSON once its // comments are stripped — ${(e).message}. An adopter types this block into $TMUX_AGENT_HOME/lexicon.json verbatim, so a trailing comma or an unbalanced brace here is a file the tool refuses at load with exit 78`);
  }
}

/**
 * The example's comments, keyed by the config key on their own line: a comment there is a claim ABOUT
 * that key ("tried BEFORE built-ins" on `profiles`, "ADDITIVE" on `redact`), which is what lets each
 * case anchor on the claim it drives instead of on a line number.
 */
export function exampleComments(doc) {
  const out = new Map();
  for (const line of lexiconExample(doc)) {
    const said = /\s\/\/\s*(.+?)\s*$/.exec(line);
    if (!said) continue;
    const key = /"([A-Za-z]+)"\s*:/.exec(line);
    assert.ok(key, `docs/AGNOSTIC-DESIGN.md's §1 example carries the comment "${said[1]}" on a line that names no key — every comment in that block reads as a claim about the key beside it, and one attached to nothing is a promise no case can hold`);
    assert.ok(!out.has(key[1]), `docs/AGNOSTIC-DESIGN.md's §1 example comments \`${key[1]}\` twice — a key with two claims on it leaves nothing to choose between them`);
    out.set(key[1], said[1]);
  }
  nonEmpty([...out.keys()], "commented keys in §1's lexicon example");
  return out;
}

/**
 * Every key the example declares, as the dotted paths item 5b's four lists use: `top.version`,
 * `profile.blocked`, `parents.nonSession`, `redact.pattern`. Deduplicated across `profiles[]` and
 * `redact[]` entries rather than refused, because a second profile legitimately carries `name` again —
 * a key written twice inside ONE object cannot survive `JSON.parse`, so there is nothing else to refuse.
 */
export function exampleKeys(cfg) {
  const keys = Object.keys(cfg).map((k) => `top.${k}`);
  for (const prof of cfg.profiles ?? []) for (const k of Object.keys(prof)) keys.push(`profile.${k}`);
  for (const k of Object.keys(cfg.parents ?? {})) keys.push(`parents.${k}`);
  for (const rule of cfg.redact ?? []) for (const k of Object.keys(rule)) keys.push(`redact.${k}`);
  return nonEmpty([...new Set(keys)], "keys in §1's lexicon example");
}

/**
 * §1's six numbered design decisions: `{ n, title, body }` each, in the page's own order. The numbers
 * are asserted to run 1..N with no gap, so a decision deleted or renumbered fails here rather than
 * leaving the case that drives it reading another decision's prose.
 */
export function declaredDecisions(doc) {
  const text = regionOf(doc, DECISIONS_START, DECISIONS_END, "§1's design decisions").join("\n");
  const heads = [...text.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)];
  nonEmpty(heads, "numbered design decisions (§1)");
  const rows = heads.map((m, i) => ({
    n: Number(m[1]),
    title: m[2],
    body: text.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined),
  }));
  refuseDuplicates(rows.map((r) => String(r.n)), "§1's design decisions", "number");
  assert.deepEqual(rows.map((r) => r.n), rows.map((_, i) => i + 1),
    `docs/AGNOSTIC-DESIGN.md's design decisions are numbered ${rows.map((r) => r.n).join(", ")} — they must run 1..${rows.length} with no gap, or a case that drives "decision 5" is reading whichever prose happens to be fifth`);
  return rows;
}

/** The decision numbered `n`, asserted present so a case cannot drive a decision the page dropped. */
export function decision(doc, n) {
  const rows = declaredDecisions(doc);
  const found = rows.find((r) => r.n === n);
  assert.ok(found, `docs/AGNOSTIC-DESIGN.md's §1 declares ${rows.length} design decisions and none is numbered ${n} — the claim this case holds is gone, so the case would measure nothing`);
  return found;
}

/**
 * The opt-out spellings decision 1 declares: one record per backticked name in it, `{ raw, group, key }`
 * with a bare name read as top-level and `a.b` as a key of section `a`. Every name in that decision is
 * something an adopter will type, so the shape is asserted rather than guessed: the promise this page
 * carried until TMUX-144 was the token `"replace": true`, which is not a key of anything — it names no
 * section, and the loader reads `replace` inside `parents` only.
 */
export function declaredOptOuts(doc) {
  const d1 = decision(doc, 1);
  const named = nonEmpty(ticks(d1.body), `opt-out spellings in §1's decision 1 ("${d1.title}")`);
  const out = named.map((raw) => {
    const m = /^([A-Za-z]+)(?:\.([A-Za-z]+))?$/.exec(raw);
    assert.ok(m, `docs/AGNOSTIC-DESIGN.md's decision 1 backticks \`${raw}\`, which is neither a lexicon key nor a \`section.key\` pair — a name in that decision reads as an opt-out spelling an adopter types, and for as long as this page existed the one it named was \`"replace": true\` "per section", which the loader honours for \`parents\` alone and silently ignores beside \`profiles\``);
    return { raw, group: m[2] ? m[1] : "top", key: m[2] ?? m[1] };
  });
  refuseDuplicates(out.map((o) => o.raw), "§1's decision 1", "opt-out spelling");
  return out;
}

// ── §2: the three sampling promises, and the evidence every rule must carry ────────────
//
// §2's numbered promises are where this page says what `tmux-agent calibrate` DOES, and after TMUX-144
// they were the only unparsed region of it that described a shipped verb's BEHAVIOUR — 447 chars, with
// the evidence-per-rule paragraph beneath them at 262. Promise 4 has been DRIVEN since TMUX-143.
// Promises 1-3 were read by nothing, and false in three places, each measured on the BUILT code
// (scratch/ga-fire-2026-09-21-06Z/probe/):
//  - promise 1 named `ledger history` among what the verb samples. NOTHING reads the ledger: the built
//    calibrate case builds its inputs from `listSessionsDetailed()` and `capturePane(name, 40)` alone and
//    `CalibrateInput` has no field for ledger data, so a home whose ledger held two `session.spawned`
//    events carrying `data.task = "probe"` — proven present by `waste` on that same home — yielded a
//    report in which `spawn`, `ledger`, `event`, `task` and `probe` were each ABSENT (probe/drive.log);
//  - promise 2 made the prompt glyph conditional on "sessions that stopped advancing".
//    `CalibrateInput.looksStalled` is declared at src/core/calibrate.ts:75 and read by NOTHING (1 hit in
//    src/, 0 in test/): `false`, `true` and absent give byte-identical reports, the glyph proposal
//    present in all three (probe/calib.log);
//  - promise 3 promised "the pane line" as every rule's evidence. A prompt rule's `evidence.sample` is
//    the bucket KEY `glyph:❯` and the planted line `❯ 1. Yes, proceed` appears NOWHERE in the report.
//    Parents (`@agent_parent=boss`, seenInSessions 2) and secret shapes (a charset sketch, the planted
//    token absent from the whole JSON) DO honour it, which is what made this a prose correction.
//
// ONE region, cut to its OWN markers between §2's usage block and the layers table, so every region
// above is byte-unchanged (the first table's two boundary cases and the disjointness case stay green).
// Same rules as those regions — markers asserted present, `nonEmpty()` and `refuseDuplicates()` per
// list, and the promise COUNT asserted so a deleted promise fails rather than leaving a case that drives
// "promise 3" reading whichever prose happens to be third. THREE lists come out of it, because the three
// promises answer to three different live authorities: promise 1's sources to what the built calibrate
// case reads, promise 2's criteria to the clustering the built `calibrate()` performs, promise 3's
// evidence fields to the keys of `evidence` in a report that module produces.
//
// Parentheticals are dropped in the two prose lists (TMUX-133's rule: an aside is prose ABOUT the item
// before it, never another item) and are the DECLARATION in promise 3, where the parenthetical is the
// evidence enumeration itself — the same split the layers table makes for its "Who does it" cell.

/**
 * §2's numbered promises: the region opens at the first one and closes at the heading after them. The
 * marker stops before promise 1's colon on purpose — the colon is what `promiseSources()` cuts its list
 * at, and a marker that carried it would turn "the list lost its colon" into "the region is missing",
 * which is a different failure reported in the wrong voice.
 */
export const PROMISES_START = "1. **Sample** the live fleet";
export const PROMISES_END = "### Where an agent fits";
/** The paragraph under promise 4 that states the evidence-per-rule requirement — inside this region. */
export const EVIDENCE_RULE = "The evidence-per-rule requirement is what makes it reviewable";

/**
 * §2's four numbered promises: `{ n, title, body }` each, in the page's own order. The numbers are
 * asserted to run 1..N with no gap for the reason `declaredDecisions()` states next door, and the
 * evidence-per-rule paragraph is asserted to be INSIDE the region: it is the sentence promise 3's
 * enumeration answers to, so a cut that lost it would leave that promise's rule declared by half a page.
 */
export function declaredPromises(doc) {
  const text = regionOf(doc, PROMISES_START, PROMISES_END, "§2's numbered promises").join("\n");
  assert.ok(text.includes(EVIDENCE_RULE),
    `docs/AGNOSTIC-DESIGN.md's §2 promises no longer carry "${EVIDENCE_RULE}" before "${PROMISES_END}" — that paragraph is what makes the evidence per rule a requirement rather than a description, and a region cut short of it reads promise 3's enumeration with nothing behind it; a marker that stopped matching is a hard failure, not a pass`);
  const heads = [...text.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)];
  nonEmpty(heads, "numbered promises (§2)");
  const rows = heads.map((m, i) => ({
    n: Number(m[1]),
    title: m[2],
    body: text.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined),
  }));
  refuseDuplicates(rows.map((r) => String(r.n)), "§2's numbered promises", "number");
  assert.deepEqual(rows.map((r) => r.n), rows.map((_, i) => i + 1),
    `docs/AGNOSTIC-DESIGN.md's §2 promises are numbered ${rows.map((r) => r.n).join(", ")} — they must run 1..${rows.length} with no gap, or a case that drives "promise 2" is holding the built verb to whichever prose happens to be second`);
  return rows;
}

/** The promise numbered `n`, asserted present so a case cannot drive a promise the page dropped. */
export function promise(doc, n) {
  const rows = declaredPromises(doc);
  const found = rows.find((r) => r.n === n);
  assert.ok(found, `docs/AGNOSTIC-DESIGN.md's §2 declares ${rows.length} promises and none is numbered ${n} — the claim this case holds is gone, so the case would measure nothing`);
  return found;
}

/** One phrase per comma-separated item of a promise's list, parentheticals dropped and the full stop off. */
function phrases(said) {
  return dropParentheticals(said).replace(/\s+/g, " ").trim().replace(/\.$/, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * What promise 1 says the verb samples, in the page's order: the items after its colon. Every one of them
 * is a claim about where the built calibrate case gets an input, which is why an unmappable source has to
 * be a hard failure — for as long as this page existed one of them was the ledger, which it reads nothing
 * from.
 */
export function promiseSources(doc) {
  const p = promise(doc, 1);
  const at = p.body.indexOf(":");
  assert.ok(at > -1,
    `docs/AGNOSTIC-DESIGN.md's promise 1 ("${p.title}") no longer names its sources after a colon — what the verb samples would be declared by nothing and compared against the built case as an empty set`);
  return refuseDuplicates(nonEmpty(phrases(p.body.slice(at + 1)), "sources in §2's promise 1"), "§2's promise 1", "source");
}

/** Promise 2's clustering criteria, in the page's order: the items after the em dash that introduces them. */
export function promiseCriteria(doc) {
  const p = promise(doc, 2);
  const at = p.body.indexOf("—");
  assert.ok(at > -1,
    `docs/AGNOSTIC-DESIGN.md's promise 2 ("${p.title}") no longer introduces its clustering criteria with an em dash — the three things the verb clusters would be declared by nothing, and each of them is driven by a case of its own`);
  return refuseDuplicates(nonEmpty(phrases(p.body.slice(at + 1)), "clustering criteria in §2's promise 2"), "§2's promise 2", "criterion");
}

/**
 * The evidence every rule must carry, as promise 3 enumerates it: the items of its ONE parenthetical.
 * Here the parenthetical IS the declaration rather than prose about one, so it is read instead of
 * dropped — and exactly one is allowed, because a second would be a second enumeration with nothing to
 * choose between them.
 */
export function promiseEvidence(doc) {
  const p = promise(doc, 3);
  const asides = [...p.body.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  assert.equal(asides.length, 1,
    `docs/AGNOSTIC-DESIGN.md's promise 3 carries ${asides.length} parentheticals where exactly one enumerates the evidence every rule must carry (${asides.join(" | ") || "none"}) — that list is held against the keys of \`evidence\` in a report the built module produces, so a second one leaves nothing to choose between them and none is an empty declaration`);
  return refuseDuplicates(nonEmpty(phrases(asides[0]), "evidence fields in §2's promise 3"), "§2's promise 3", "evidence field");
}
