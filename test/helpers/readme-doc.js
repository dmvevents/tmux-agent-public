/**
 * The parse of the two places README.md makes a machine-checkable promise about a NAME: the "Agnostic core"
 * bullet — the two adapter types it points an author at, and the profile table that answers "does this
 * support MY CLI" — and the `status.json` gloss, the sentence that tells a stranger what is in the file a
 * collector parses. Shared by test/readme-contract.test.js and by that file's
 * checks of the parse itself.
 *
 * README.md has been a checked contract since TMUX-84, but the one TABLE on the page was read by
 * nothing: measured 2026-09-20 on c90a3fd (scratch/ga-fire-2026-09-20-10Z/probe/ and -12Z/probe/),
 * `grep -rh "Profile | Status" test/` and `grep -rh "Agnostic core" test/` each returned 0 lines —
 * written `-rh` rather than `-rn` so a path word cannot manufacture a hit. Dropping the `aider` row
 * while the built chain still returned the profile left the whole unit suite byte-identical to its
 * control, and so did README telling a reader to copy `aiderProfile`, the export VERSIONING.md's own
 * NOT-covered section declares INTERNAL. A FIFTH built-in the page never names WAS caught — by two
 * fixture literals in test/lexicon.test.js, neither naming README nor any declaration, which is the
 * TMUX-133/135 shape: an author who edits those two literals in the same commit lands in a green tree
 * with the table lying.
 *
 * Two live authorities answer this declaration and they catch opposite drift: `resolveProfiles({})`'s
 * chain and Monitor's constructor default (dist/core/monitor.js:186). ORDER is load-bearing rather
 * than cosmetic — Monitor classifies with `this.profiles.find((p) => p.classify(tail) !== null)`
 * (:227), first match wins, and the table's last row calls generic-shell the fallback — so the
 * comparison is order-equal, not only set-equal.
 *
 * Four rules, all of them already paid for by the parse of VERSIONING.md next door:
 *  - every marker is ASSERTED PRESENT, and the region cuts run on whitespace-NORMALIZED text where
 *    they are not line-structural, so a rewrap cannot move one;
 *  - nonEmpty() and refuseDuplicates() run PER LIST — the types and the names are two lists, and
 *    `codex` appears twice in the table (row 1's first cell, and its status cell's "a real `codex`
 *    CLI"), so one flat read fails on the shipped page;
 *  - the bullet's own subject declares nothing and every parenthetical is dropped, innermost-first —
 *    a parenthetical is prose ABOUT what precedes it, which is what keeps "(context %, spinner/menu
 *    detection)" out of the adapter-type list;
 *  - nothing may be backticked between the last table row and PROFILE_END, since there is nothing a
 *    name could mean there except a declaration.
 *
 * A name is taken from a row's FIRST CELL only. That is the rule this card is about: a name moved out
 * of a first cell into a status cell is no longer a declaration, and the comparison against the chain
 * goes red for it — which is also why the pane text of the worked example below the table
 * (`› 1. Update now`, `›`, `❯`) is excluded BY POSITION rather than by a special case, sitting as it
 * does after PROFILE_END.
 *
 * The Status column is deliberately NOT parsed: there is no live authority for "verified" against
 * "best-effort", so it stays editorial prose.
 *
 * Lives here rather than in the suite so a case can plant drift in a doc STRING and assert what the
 * parse yields — no tree copy needed. See test/helpers/versioning-doc.js, whose flatten() and ticks()
 * this file reuses (both are doc-agnostic; the guards below are not, so they carry README's voice).
 */
import assert from "node:assert/strict";
import { flatten, ticks } from "./versioning-doc.js";

/**
 * The three phrases the bullet is read by: its own subject, the sentence that introduces the table,
 * and the paragraph that ends the declaration. Named so the cases that plant a REWORDED marker, and
 * the reader's note quoting them, cannot drift from the parse.
 */
/**
 * The bullet's opening, pinned as a PREFIX rather than the whole bolded subject: everything inside the
 * bold is dropped before the adapter types are read (TMUX-133's rule — a subject names the bullet, not
 * a type in it), and pinning the closing `:**` too would make that rule undemonstrable, since no plant
 * could then put a name inside the bold and still be found here.
 */
export const BULLET_SUBJECT = "- **Agnostic core";
export const PROFILE_START = "The built-in profiles, tried in this order:";
export const PROFILE_END = "Why this matters concretely:";
/** The table's own header, asserted present so a parse of zero rows cannot be a missing table. */
export const TABLE_HEADER = "| Profile | Status |";

/** A table row's FIRST CELL, backticked: `| `claude-code` | **verified** … |` → claude-code. */
const ROW = /^\s*\|\s*`([^`]+)`\s*\|/;

function nonEmpty(list, what) {
  assert.ok(list.length > 0, `parsed ZERO ${what} from README.md — an empty contract is a hard failure, not a pass`);
  return list;
}

/**
 * Refuse a name the bullet declares twice. A name parsed twice is what a cut that kept prose looks
 * like, and the comparison against the built chain cannot see it: both directions agree while the
 * declaration is not what the parse says it is (TMUX-118 for VERSIONING item 2, TMUX-122 for item 6).
 */
function refuseDuplicates(names, what, noun) {
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort();
  assert.deepEqual(twice, [], `README.md's ${what} parses ${twice.join(", ")} more than once — either the page declares a ${noun} twice or the parse read text beside the list`);
  return names;
}

/** Every parenthetical gone, innermost-first to a fixpoint so a nested one cannot leave its contents. */
function dropParentheticals(text) {
  let out = text;
  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(/\([^()]*\)/g, " ");
  }
  return out;
}

/**
 * The raw lines of the "Agnostic core" bullet, from its subject to the paragraph that ends it. Raw
 * rather than normalized because the table is line-structural: a row is a LINE, and flattening the
 * region would leave `| |` as the only row boundary.
 */
export function agnosticBullet(readme) {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l.startsWith(BULLET_SUBJECT));
  assert.ok(start > -1, `README.md no longer opens a bullet with "${BULLET_SUBJECT}" — the adapter types and the profile table would then be declared by nothing and compared against the built chain as empty sets; a marker that stopped matching is a hard failure, not a pass`);
  const end = lines.findIndex((l, i) => i > start && l.includes(PROFILE_END));
  assert.ok(end > start, `README.md's Agnostic-core bullet is no longer followed by "${PROFILE_END}" — the declaration would run to the end of the page, and the worked example's pane text (\`› 1. Update now\`, \`❯\`) would read as declared names; a marker that stopped matching is a hard failure, not a pass`);
  return lines.slice(start, end);
}

/** Where PROFILE_START stands inside the bullet: the types are before it, the table after it. */
function splitAtTable(region) {
  const at = region.findIndex((l) => l.includes(PROFILE_START));
  assert.ok(at > -1, `the marker "${PROFILE_START}" no longer occurs in README.md's Agnostic-core bullet — the parse cannot tell the sentence naming the adapter types from the table declaring the profile names, so one of the two lists would swallow the other; a marker that stopped matching is a hard failure, not a pass`);
  return at;
}

/**
 * The adapter types the bullet points an author at — `AgentProfile` and `NotifySink` today: the
 * backticked names BEFORE the table, less the bullet's own subject and every parenthetical. Both are
 * types the built root re-exports (dist/index.d.ts), which is what the contract test holds them to;
 * a stranger who reads "add one for your CLI in ~20 lines" and cannot import the name has been sent
 * at nothing.
 */
export function declaredAdapterTypes(readme) {
  const region = agnosticBullet(readme);
  const head = dropParentheticals(flatten(region.slice(0, splitAtTable(region)).join("\n")).replace(/^- \*\*.*?\*\*/, " "));
  return refuseDuplicates(nonEmpty(ticks(head), "adapter type names (the Agnostic-core bullet)"), "Agnostic-core bullet", "adapter type");
}

/**
 * The profile names the table declares, IN THE TABLE'S OWN ORDER: the first cell of every row after
 * PROFILE_START, and nothing else on the page. Order is returned rather than a set because
 * first-match-wins makes it observable (dist/core/monitor.js:227).
 */
export function declaredProfiles(readme) {
  const region = agnosticBullet(readme);
  const rows = region.slice(splitAtTable(region) + 1);
  assert.ok(rows.some((l) => l.includes(TABLE_HEADER)), `README.md no longer carries the "${TABLE_HEADER}" header after "${PROFILE_START}" — a table that stopped being a table parses as zero rows, and an empty declaration is a hard failure rather than a pass`);
  const names = [];
  let last = -1;
  rows.forEach((line, i) => {
    const m = ROW.exec(line);
    if (m) {
      names.push(m[1]);
      last = i;
    }
  });
  nonEmpty(names, "profile names (the Agnostic-core bullet's table)");
  // Item 6's rule in this file: after the last row there is nothing a backticked name
  // could mean except a declaration, and the region already ends at PROFILE_END.
  const after = ticks(rows.slice(last + 1).join(" "));
  assert.deepEqual(after, [], `README.md backticks ${after.join(", ")} between the last row of the profile table and "${PROFILE_END}", where a name reads as a declared profile — put it in a row's FIRST CELL to declare it, or name it without backticks if it is only an example`);
  return refuseDuplicates(names, "profile table", "profile");
}

// ---------------------------------------------------------------------------------------------
// The `status.json` gloss — the sentence a collector's author reads before writing one
// ---------------------------------------------------------------------------------------------

/**
 * The section the gloss lives in, and the phrases it lies between. All three are present on BOTH sides of
 * TMUX-153's fix, which is the point: the drifted sentence is parseable, so the new case could be watched
 * FAIL on the parent tree naming what it offered rather than dying on a marker that did not exist yet.
 */
export const STATUS_SECTION = "## Status & analytics";
export const GLOSS_START = "machine-readable fleet state";
export const GLOSS_END = "is published on every";

/**
 * The words that say the gloss enumerates the WHOLE record. Item 4 declares the record as closed ("all of
 * them on every record"), so the README's own claim has to be readable too — a gloss that silently became a
 * subset is indistinguishable from one that went stale, which is the trap test/a11y.test.js's `chip_states`
 * case exists to keep out (TMUX-152: a deliberate subset is held as a STRICT subset, never as a copy).
 * If this page ever documents a subset on purpose, this marker changes and the comparison below changes with
 * it — that edit is the declaration, not a silent weakening of the check.
 */
export const GLOSS_ALL_CLAIM = "those fields and no others";

/** The raw lines of the "Status & analytics" section, so the gloss's markers cannot match elsewhere on the page. */
export function statusSection(readme) {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l.startsWith(STATUS_SECTION));
  assert.ok(start > -1, `README.md no longer carries a "${STATUS_SECTION}" section — the \`status.json\` gloss would be looked for across the whole page, where its cut markers can match prose about something else; a marker that stopped matching is a hard failure, not a pass`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  assert.ok(end > start, `README.md's "${STATUS_SECTION}" section is no longer followed by another "## " heading — the gloss's region would run to the end of the page; a marker that stopped matching is a hard failure, not a pass`);
  return lines.slice(start, end);
}

/**
 * What README.md's `status.json` gloss OFFERS a consumer, and whether it claims to name the whole record.
 *
 * Measured on 0b1e4a4 (scratch/ga-fire-2026-09-22-12Z/probe-readme-status.log): the sentence offered five
 * names for a record that carries fourteen, and three of the five — `ctx%`, `lineage`, `last line` — named
 * no field at all, `ctx%` being a token the shipped tree used NOWHERE else. Nothing read the line
 * (`grep -rh "machine-readable fleet state\|ctx%" test/ scripts/` → 0), so every word of it could drift while
 * the suite stayed green — and a reader who wrote `s.lineage` from it got undefined, the failure item 4's own
 * case names in its message (test/versioning-contract.test.js).
 *
 * Returns `{ names, bare, all }` rather than a bare list because the three ways this sentence can lie are
 * different and a caller must be able to report them TOGETHER — a name the record does not carry, a name
 * offered as prose where the page's own convention is a code span, and the enumeration claim going missing.
 * A per-name throw stops at the first and reports the rest green-by-silence.
 *
 * The region is cut at both ends on whitespace-NORMALIZED text with both markers asserted present,
 * the text after GLOSS_ALL_CLAIM is dropped — a claim ABOUT the list is not a member of it, the same rule that
 * keeps parentheticals out of the declarations next door — and nonEmpty()/refuseDuplicates() guard the vacuous
 * and the double-counted parse.
 */
export function declaredStatusFields(readme) {
  const text = flatten(statusSection(readme).join("\n"));
  const at = text.indexOf(GLOSS_START);
  assert.ok(at > -1, `the start marker "${GLOSS_START}" no longer occurs in README.md's "${STATUS_SECTION}" section — the gloss's field list would then begin in the prose before it, where a name describes the file instead of naming a field in it; a marker that stopped matching is a hard failure, not a pass`);
  const after = text.slice(at + GLOSS_START.length);
  const endAt = after.indexOf(GLOSS_END);
  assert.ok(endAt > -1, `the cut marker "${GLOSS_END}" no longer follows README.md's \`status.json\` gloss — the list would run on into the rest of the section, where \`status --json FILE\`, the \`tmux\` block's own keys and \`reason\`'s explanation all read as offered per-session fields; a marker that stopped matching is a hard failure, not a pass`);
  const whole = after.slice(0, endAt);
  const all = whole.includes(GLOSS_ALL_CLAIM);
  // A claim about the list is not a member of it: everything from "those fields and no others" on is prose.
  const region = all ? whole.slice(0, whole.indexOf(GLOSS_ALL_CLAIM)) : whole;

  // One comma-separated item is one offer. An item carrying code spans offers those; an item carrying none
  // offers its own words, which is how the drifted sentence's `ctx%`, `lineage` and `last line` are read at
  // all — they were never backticked, and a parse that only saw code spans would call the parent tree clean.
  const names = [], bare = [];
  for (const item of region.split(",")) {
    const spans = ticks(item);
    if (spans.length) {
      names.push(...spans);
      continue;
    }
    const word = item.replace(/^[\s:]+/, "").replace(/\s*[—–-]\s*$/, "").replace(/[\s)]+$/, "").trim();
    // Pure grammar between two spans ("and", "then") offers nothing; a word that names something does.
    if (!word || /^(?:and|or|then|plus)$/i.test(word)) continue;
    names.push(word);
    bare.push(word);
  }
  return {
    names: refuseDuplicates(nonEmpty(names, "per-session field names (the `status.json` gloss)"), "`status.json` gloss", "field"),
    bare,
    all,
  };
}
