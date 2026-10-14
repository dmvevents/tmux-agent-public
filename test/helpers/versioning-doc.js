/**
 * The parse of VERSIONING.md's "Covered by semver" items — shared by the contract test
 * (test/versioning-contract.test.js, TMUX-83) and by that suite's checks of the parse itself.
 *
 * Items 1, 2 and 6 list their names BEFORE a sentence of prose explaining what counts as breaking, so
 * each parse cuts the item at a marker phrase. Measured 2026-09-16 on 6cd9670: item 2's marker
 * ("Removing a tool") is wrapped across VERSIONING.md:43-44, the item was read as RAW lines, and
 * split() on an absent string returns the whole input — so the cut kept 853 of 853 chars, the prose
 * sentence "`policy-status` is never hidden by policy" was parsed as a declaration, and a tool
 * deleted from item 2's list still passed the set comparison this suite exists to fail.
 * Two rules follow, and they are why this parse is a shared function rather than four expressions:
 * every cut runs on WHITESPACE-NORMALIZED text, so a rewrap cannot move it, and every marker is
 * ASSERTED PRESENT, so a reworded one fails the suite loudly instead of silently keeping the prose.
 *
 * Item 3 joined them in TMUX-126 — measured on a0eeb1e, item 3 promised that every ledger event
 * `type` value is covered by semver while backticking 3 of the 23 the shipped union carries, all three
 * as examples of *additive* change inside its prose, and no test read the item at all: renaming a type
 * in src/core/ledger.ts and in its one emitter left `npm test` green, so a consumer's `switch` over
 * `EventType` went quietly dead under a promise that could not fail. Its declaration is now the list,
 * with the additive/breaking prose after the cut, read by declaredEventTypes() below.
 *
 * Item 8 joined in TMUX-132 — measured on a3450d6, it declared the three tmux session user-options
 * `@agent_parent`, `@agent_owner`, `@agent_task` and said of them "external tooling reads these", which
 * makes it the one covered item whose stated consumers are outside this package; no test read it. So
 * deleting `@agent_task` from the declaration left `npm test` green, and so did a fourth option the
 * built orchestrator sets and the doc never names. Renaming one WAS caught — by an orchestrator test
 * asserting its own literal, which an author renaming the option edits in the same pass, landing back in
 * the invisible case. Read by declaredUserOptions() below, cut at "external tooling reads": the sentence
 * naming the audience, after the list naming what they read.
 *
 * Item 4 joined in TMUX-133 — measured on 6bd630e, it declares the shape of `status.json`, the file a
 * supervising script parses, and no test read it: a key deleted from the declaration and a fifth key the
 * built writer shipped were each invisible to the whole unit suite. Read by declaredStatusShape() below,
 * which needs two rules of its own because item 4 is prose with a list inside it rather than a list with
 * prose after it. Its PER-SESSION half followed in TMUX-134 — measured on 153a8be, the record an external
 * reader loops over was declared by no list at all, so a fifteenth key the writer shipped, a dropped `task`
 * and the deletion of `reason` (the one field that half named) were each invisible to the whole unit suite.
 * That half had to be WRITTEN before it could be parsed; declaredSessionFields() reads it, cut at both ends.
 *
 * Item 5 joined in TMUX-135 — measured on e005f19, it declares the schema of the file an OPERATOR writes to gate
 * every mutating action, and no test read it: the built Policy honoured four top-level keys while item 5 named
 * three (`surfaces`, the documented fix for THREAT-MODEL finding 6 and the key the tool's own refusal text tells
 * the operator to set, was backticked nowhere in this doc), and "the action names" deferred to a list that existed
 * nowhere — four of the five were backticked only in item 1 as CLI VERBS, and `adopt` not at all. Read by
 * declaredPolicyShape() below: item 4's structural rules for the keys, a both-ends cut for the actions.
 *
 * Item 5b joined in TMUX-137 — measured on b0fe063, it was the LAST item of the declaration with no parse at
 * all, and the one about the file an operator writes to make redaction STRONGER. Of the 19 keys the built
 * package honours it declared 4: every nested key sat inside a parenthetical, where the rule items 4, 5 and 7
 * already pay for says a name declares nothing, and `version` — the key whose unsupported value the loader
 * refuses — was backticked only as the token `version: 1` inside its own subject aside. So item 5b ceasing to
 * name `redact[]` and its four keys, the clause the additive-redaction promise rests on, was invisible to the
 * whole unit suite, as was the built package honouring a sixth top-level key. Read by declaredLexiconShape()
 * below — the first item read as FOUR lists, since the file it declares is nested and `name` belongs to two.
 *
 * Item 7's home half joined in TMUX-136 — measured on b243565, it declares a shape on DISK and no test read
 * it, while the shape it declared was itself short: the built Blackbox creates a `health/` directory of four
 * crash-forensics files under the home that item 7's six-path list never named, and `health/` was backticked
 * nowhere in any .md the package ships. Dropping `web-token` from the declaration and a SEVENTH path the
 * daemon's own constructor creates were each invisible to the whole unit suite. Read by declaredHomeLayout()
 * below — the first item with a second half AFTER its list, so its "nothing backticked after" rule is bounded
 * by an end marker of its own, and the first whose declaration takes two paths BY REFERENCE from other items.
 *
 * Item 6's SIGNATURE half joined in TMUX-147 — the four words "and their signatures" that end its list,
 * which until then were read only as declaredExports()' cut MARKER (cutBefore below, and the marker loop
 * of test/versioning-contract.test.js). So the item's NAMES were set-equal with the package root in both
 * directions while the members inside every covered type answered to nothing: measured 2026-09-21 on
 * 1747fde, the 13 object types among its 15 declared type names carried 79 members and exactly one of
 * them — `CalibrateInput.looksStalled` — was honoured NOWHERE in dist/**\/*.js, declared and shipped and
 * read by nothing. Read by declaredExportKinds() below, which splits the list at "; types" because a
 * signature belongs to a type and the flat list cannot tell a value from one.
 *
 * Item 6 got neither rule until TMUX-122 — measured on f050f5c, declaredExports() read every
 * backticked token of the WHOLE item, so an author who added a root export and wrote it into item 6's
 * prose to call it internal ("the four built-in profile objects and `paneWidth`, see below") thereby
 * DECLARED it: covered by semver by the doc's own rule, with the one check that forces a decision
 * about a new export (rc=1 when it is undeclared) silenced back to rc=0, 7/7. A third rule follows,
 * for the item whose declaration IS its whole list: the text after the cut must carry no backticked
 * token at all, since there is nothing there a name could mean except a declaration.
 *
 * The "NOT covered" section joined in TMUX-139 — the first parse here that is not about the covered list
 * at all, and the section every covered item defers to when it says a name is internal. Measured on
 * 6d2faff, its heading was used ONCE, as the end anchor coveredItems() cuts the covered list at, and not
 * one of its 811 normalized chars was read; under the file's own parenthetical rule 4 of its 10 backticked
 * tokens survived and the 6 dropped were the payload. Read by declaredNotCovered() below as three lists,
 * because the exclusions it can be held to answer to three different live authorities.
 *
 * Item 9 joined in TMUX-142 — the first item about the surface an operator CONFIGURES the tool through
 * rather than a page they read, and the one the file had no item for at all. Measured on 4a11d0b
 * (scratch/ga-fire-2026-09-20-18Z/probe/): the built package reads 11 `TMUX_AGENT_*` variables across 9
 * modules — a home, a socket, an actor, a lexicon, a policy file, a webhook, a rotation size, a health
 * tick and two watchdog knobs — and none of the eight covered items declared that surface, no test parsed
 * a list of it, and 6 of the 11 were named in no user-facing doc at all (`TMUX_AGENT_POLICY`, which
 * relocates the file deciding which actions are REFUSED, among them). The built watchdog growing a read of
 * a name no doc carries, the doc ceasing to name one the code still reads, and a README declaring one the
 * package never reads were each invisible to the whole unit suite. Read by declaredEnvVars() below as TWO
 * lists, because the covered/not-covered split is an author's judgement: a parse that could not see it
 * would have to call every read name covered or none of them.
 *
 * The preamble's own claim about which items are parsed joined at the same time, read by
 * declaredParsedItems(): VERSIONING.md:5 has said "Items … below are parsed as data by
 * test/versioning-contract.test.js" since TMUX-83, and `grep -rhF 'below are parsed as' test/` returned 0 —
 * so an item added to that sentence with no parser, or a parse deleted while the sentence kept naming its
 * item, left the file describing a check that does not exist.
 *
 * Lives here rather than in the suite so a case can plant drift in a doc STRING and assert what the
 * parse yields — no tree copy needed. See test/helpers/mcp-contract.js on why helpers are not
 * *.test.js files.
 */
import assert from "node:assert/strict";

/** Item text with every run of whitespace collapsed: what every cut reads, wrap-independent. */
export function flatten(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Items of the "Covered by semver" list, keyed by their number ("1", "2", "5b", ...). */
export function coveredItems(doc) {
  const start = doc.indexOf("## Covered by semver");
  const end = doc.indexOf("## NOT covered", start);
  assert.ok(start > -1 && end > start, "VERSIONING.md must keep its 'Covered by semver' / 'NOT covered' sections");
  const items = new Map();
  let key = null;
  for (const line of doc.slice(start, end).split("\n")) {
    const m = /^(\d+[a-z]?)\. \*\*/.exec(line);
    if (m) key = m[1];
    if (key) items.set(key, (items.get(key) ?? "") + line + "\n");
  }
  return items;
}

/** Every `backticked` token in a run of text, with any trailing "()" removed. */
export function ticks(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ""));
}

export function nonEmpty(list, what) {
  assert.ok(list.length > 0, `parsed ZERO ${what} from VERSIONING.md — an empty contract is a hard failure, not a pass`);
  return list;
}

/**
 * The declaration in `item` up to `marker`, which MUST occur in the normalized text: a marker that
 * stopped matching keeps the prose after it, and a name mentioned there then reads as declared —
 * the TMUX-118 failure. Absent is a hard failure in nonEmpty()'s voice, never a pass.
 */
export function cutBefore(item, marker, what) {
  const text = flatten(item);
  const at = text.indexOf(marker);
  assert.ok(at > -1, `the cut marker "${marker}" no longer occurs in ${what} of VERSIONING.md — the cut would keep the prose after it and read any name mentioned there as declared; a marker that stopped matching is a hard failure, not a pass`);
  return text.slice(0, at);
}

/**
 * The text of `item` AFTER `marker`, which MUST occur in the normalized text — `cutBefore`'s mirror, for a
 * list that begins part-way through an item instead of at its head. The failure it refuses is the other
 * half of TMUX-118's: a start marker that stopped matching would keep the prose BEFORE the list, and there
 * a name is an explanation rather than a declaration (item 4's per-session list has `reason`'s meaning in
 * front of it, `GONE` and `null` with it — read as declarations they would make the parse disagree with
 * itself, `reason` twice over). Absent is a hard failure, never a pass.
 */
export function cutAfter(item, marker, what) {
  const text = flatten(item);
  const at = text.indexOf(marker);
  assert.ok(at > -1, `the start marker "${marker}" no longer occurs in ${what} of VERSIONING.md — the list would then begin in the prose BEFORE it, where a backticked name explains a field instead of declaring one; a marker that stopped matching is a hard failure, not a pass`);
  return text.slice(at + marker.length);
}

/**
 * Refuse a name the item declares twice. A name parsed twice is what a cut that kept prose looks
 * like, and set equality against the built artefact cannot see it: the list mention and the second
 * mention are the same string, so both directions agree while the declaration is not what the parse
 * says it is (TMUX-118 for item 2, TMUX-122 for item 6).
 */
export function refuseDuplicates(names, what, noun) {
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort();
  assert.deepEqual(twice, [], `VERSIONING.md ${what} parses ${twice.join(", ")} more than once — either the doc declares a ${noun} twice or the cut kept text that names it`);
  return names;
}

/** Item 2's declared MCP tool names: the list, never the sentence after it, and each name once. */
export function declaredTools(doc) {
  const item = coveredItems(doc).get("2") ?? "";
  const names = nonEmpty(ticks(cutBefore(item, "Removing a tool", "item 2 (MCP tool names)")), "MCP tool names (item 2)");
  return refuseDuplicates(names, "item 2", "tool");
}

/**
 * A ledger event `type` as a doc writes it — `<word>.<word>`, never a file name. Item 3 backticks
 * field names (`v`, `data`, `session`) and a path beside its 23 types, so the SHAPE is what tells a
 * declaration from the vocabulary around it: the same filter idiom item 1 uses to keep `--flags`
 * apart from verbs.
 */
export function eventTicks(text) {
  return ticks(text).filter((t) => /^[a-z]+\.[a-z-]+$/.test(t) && !/\.(?:json|md|ts|js|sh|ya?ml)$/.test(t));
}

/**
 * Item 3's declared ledger event types: the list before the additive/breaking prose, each once, and
 * nothing from the prose after the cut — which must backtick no event-shaped name at all. That last
 * rule is item 6's, in the item it was measured missing from: item 3's three named types were all
 * *examples* in that prose ("e.g. `fleet.tmux` was added this way"), so a parse that read the whole
 * item would call three of 23 the declaration and agree with itself.
 */
export function declaredEventTypes(doc) {
  const item = coveredItems(doc).get("3") ?? "";
  const list = cutBefore(item, "New event types", "item 3 (ledger event types)");
  const inProse = eventTicks(flatten(item).slice(list.length));
  assert.deepEqual(inProse, [], `VERSIONING.md item 3 backticks ${inProse.join(", ")} in the prose AFTER its declared list, where an event type reads as declared and so as covered by semver — put it in item 3's list to declare it, or name it without backticks if it is only an example of what additive means`);
  return refuseDuplicates(nonEmpty(eventTicks(list), "ledger event types (item 3)"), "item 3", "event type");
}

/**
 * The types item 3's list marks `(reserved)` — declared and covered, but filed by nothing the package
 * ships yet. The reason for each lives in the RESERVED allowlist of test/versioning-contract.test.js,
 * which is checked against THIS set both ways: an English mark with no recorded reason, or a recorded
 * reason the doc does not mark, is exactly the drift TMUX-122 caught in item 6's prose.
 */
export function reservedEventTypes(doc) {
  const item = coveredItems(doc).get("3") ?? "";
  const list = cutBefore(item, "New event types", "item 3 (ledger event types)");
  return [...list.matchAll(/`([^`]+)` \(reserved/g)].map((m) => m[1]);
}

/**
 * A tmux session user-option as a doc writes it — `@agent_<name>`. Item 8 backticks nothing else today,
 * but the SHAPE is what gives the after-the-cut rule below something to refuse: it is how a flag or a
 * path named in item 8's prose stays out of the declaration, the way eventTicks() keeps `data` out of
 * item 3's.
 */
export function optionTicks(text) {
  return ticks(text).filter((t) => /^@agent_[A-Za-z0-9_]+$/.test(t));
}

/**
 * Item 8's declared tmux session user-options: the list before the sentence naming who reads them, each
 * once, and nothing from the prose after the cut. All three rules the parsed items already pay for apply
 * here for the same reasons — and with more at stake, since item 8's consumers are other people's scripts
 * reading tmux directly, which no test of ours can go red for.
 */
export function declaredUserOptions(doc) {
  const item = coveredItems(doc).get("8") ?? "";
  const list = cutBefore(item, "external tooling reads", "item 8 (tmux session user-options)");
  const inProse = optionTicks(flatten(item).slice(list.length));
  assert.deepEqual(inProse, [], `VERSIONING.md item 8 backticks ${inProse.join(", ")} in the prose AFTER its declared list, where a user-option reads as declared and so as covered by semver — put it in item 8's list to declare it, or name it without backticks if it is only an example`);
  return refuseDuplicates(nonEmpty(optionTicks(list), "tmux session user-options (item 8)"), "item 8", "user-option");
}

/**
 * The phrase item 4's cut runs at: the sentence that hands the rest of the item to a list living
 * elsewhere. Named so the test that plants a REWORDED marker and the doc comment quoting it cannot
 * drift from the parse.
 */
export const STATUS_CUT = "and the documented per-session fields";

/**
 * Item 4's two declarations of the `status.json` shape — `{ top, tmux }`: the file's top-level keys and
 * the keys of its `tmux` block. It joined the parsed items in TMUX-133, and it is the item whose consumer
 * is a FILE rather than an import: item 2 defers to it twice ("the tmux block item 4 describes", "the
 * snapshot fields item 4 describes") and README sends a collector to parse it. Measured on 6bd630e
 * (scratch/ga-fire-2026-09-19-06Z/probe/): deleting `checkedAt` from the declaration while the code still
 * wrote it, and shipping a fifth top-level key the doc never names, EACH left the whole unit suite
 * byte-identical to its control; the one edit that WAS caught — renaming `checkedAt` in dist — reddened 7
 * tests asserting that same list as their own literal, none naming VERSIONING.md, so an author who renames
 * the field edits those lines in the same commit and lands back in the invisible case.
 *
 * Item 4 is prose with a list inside it, not a list with prose after it, so two STRUCTURAL rules stand in
 * for item 6's "nothing backticked after the cut": the `tmux` keys are the item's one backticked `{ … }`
 * block, and the top-level keys are what is left of the half before the cut once that block, the item's own
 * bolded subject and every parenthetical are gone. A parenthetical is prose ABOUT what precedes it — today's
 * re-mentions of `sessions` and `error` are exactly that — and the subject names the file, not a key in it.
 * The three rules the other parsed items pay for apply unchanged: the cut runs on whitespace-NORMALIZED text
 * with its marker asserted present, and nonEmpty()/refuseDuplicates() guard both sets.
 *
 * The per-session half AFTER the cut is read by declaredSessionFields() below, which TMUX-134 could only add
 * once that half was WRITTEN: until then item 4 deferred it to "the documented per-session fields", a list
 * that existed nowhere — of the 14 keys the package writes per session, item 4 named one (`reason`) and the
 * whole of VERSIONING.md named four.
 */
export function declaredStatusShape(doc) {
  const item = coveredItems(doc).get("4") ?? "";
  const half = cutBefore(item, STATUS_CUT, "item 4 (status.json shape)");
  const brace = /`\{([^{}]*)\}`/.exec(half);
  assert.ok(brace, `VERSIONING.md item 4 no longer declares its tmux block as one backticked \`{ … }\` before "${STATUS_CUT}" — the keys of status.json's tmux block would then be declared by nothing and compared against the file as an empty set; a block that stopped matching is a hard failure, not a pass`);
  // Strip the subject ("4. **`status.json` shape**"), the block itself, then every parenthetical —
  // innermost-first to a fixpoint, so one nested inside another cannot leave its contents behind.
  let rest = half.replace(/^\d+[a-z]?\. \*\*.*?\*\*/, " ").replace(brace[0], " ");
  for (let before = ""; before !== rest; ) {
    before = rest;
    rest = rest.replace(/\([^()]*\)/g, " ");
  }
  return {
    // `sessions[]` is how a doc writes an array-valued key; the key itself is `sessions`.
    top: refuseDuplicates(nonEmpty(ticks(rest).map((t) => t.replace(/\[\]$/, "")), "status.json top-level keys (item 4)"), "item 4", "top-level key"),
    tmux: refuseDuplicates(nonEmpty(brace[1].split(",").map((k) => k.trim()).filter(Boolean), "status.json tmux keys (item 4)"), "item 4's tmux block", "tmux key"),
  };
}

/**
 * The phrases item 4's per-session list lies between: the sentence that introduces it, and the clause that
 * starts explaining what the fields do. Named for the same reason STATUS_CUT is — the cases that plant a
 * REWORDED marker, and the doc comment quoting both, cannot drift from the parse.
 */
export const SESSION_START = "Each `sessions[]` record carries:";
export const SESSION_END = "all of them on every record";

/**
 * Item 4's declared per-session fields: the keys of every `sessions[]` record of `status.json`. This half was
 * declared by NO list until TMUX-134 — measured on 153a8be (scratch/ga-fire-2026-09-19-10Z/probe/), shipping a
 * fifteenth per-session key, dropping one the writer wrote (`task`), and deleting `reason` — the one field the
 * half named — from the doc EACH left the whole unit suite byte-identical to its control, while the same class of
 * plant on the top-level half (parsed two hours earlier) reddened three cases naming the key. The record is the
 * part an external reader loops over, and it is no single module's shape: ten fields come from the Monitor
 * snapshot, four are added by publishStatus itself.
 *
 * It is a list in the MIDDLE of an item, so it is cut at both ends and both markers are asserted present. The
 * prose on either side declares nothing, and that is load-bearing rather than tidy: before the list stands
 * `reason`'s meaning with `GONE`, `null`, `session-status` and `/api/session` beside it — none of them a field of
 * anything, and `reason` itself a second time, which refuseDuplicates() would fail. After it, item 6's rule
 * applies unchanged: the text past SESSION_END must backtick NOTHING, since there is nothing a
 * name could mean there except a declaration. nonEmpty() guards the vacuous parse.
 */
export function declaredSessionFields(doc) {
  const item = coveredItems(doc).get("4") ?? "";
  const what = "item 4's per-session list (status.json session records)";
  const after = cutAfter(item, SESSION_START, what);
  const list = cutBefore(after, SESSION_END, what);
  const inProse = ticks(after.slice(list.length));
  assert.deepEqual(inProse, [], `VERSIONING.md item 4 backticks ${inProse.join(", ")} in the prose AFTER its per-session list, where a field name reads as declared and so as covered by semver — put it in the list to declare it, or name it without backticks if it is only an example`);
  return refuseDuplicates(nonEmpty(ticks(list), "status.json per-session fields (item 4)"), "item 4's per-session list", "field");
}

/**
 * The phrases item 5's two lists lie between: the sentence that turns from the file's keys to the actions an
 * allow- or deny-list is keyed by, then that list's own two ends. Named for the reason STATUS_CUT and
 * SESSION_START/END are — the cases that plant a REWORDED marker, and the reader's note quoting all three,
 * cannot drift from the parse.
 */
export const POLICY_TOP_END = "An allow- or deny-list is keyed by action";
export const POLICY_ACTION_START = "the action names are:";
export const POLICY_ACTION_END = "Tightening the default posture";

/**
 * Item 5's two declarations of the policy-file schema — `{ top, actions }`: the top-level keys of
 * `policy.json` and the action names an `allow`/`deny` entry is keyed by. It joined the parsed items in
 * TMUX-135, and it is the covered item whose artefact the OPERATOR writes rather than the package emits —
 * the file that gates every mutating action. Measured on e005f19 (scratch/ga-fire-2026-09-19-14Z/probe/):
 * the built Policy honoured FOUR top-level keys and item 5 declared THREE, `surfaces` — the documented fix
 * for THREAT-MODEL finding 6, and the key the tool's own refusal text tells an operator to set — being
 * backticked nowhere in this doc or any .md the package ships; and "the action names" resolved to no list
 * at all, so of the five names `policy-status` hands a client, four were backticked only in item 1 as CLI
 * VERBS (a different artefact, unborrowable) and `adopt` nowhere. Dropping `readOnly` from the declaration,
 * a fifth honoured key in dist, and a sixth action name in the reply were EACH invisible to the whole unit
 * suite.
 *
 * The top half is prose with a list at its head, so it takes item 4's two structural rules: the
 * item's bolded subject is dropped, then every parenthetical — a parenthetical is prose ABOUT what precedes
 * it, which is what keeps the path in the subject and today's `web`/`mcp`/`cli` (the surfaces a `surfaces`
 * entry may name, no keys of anything) out of the declaration. The action half is a list in the MIDDLE of
 * the item, so it is cut at both ends like item 4's per-session list, and item 6's rule applies after it
 *: the text past POLICY_ACTION_END must backtick nothing, since there is nothing a name
 * could mean there except a declaration. The three rules every parsed item pays for are unchanged — each
 * cut on whitespace-NORMALIZED text with its marker asserted present, nonEmpty() and
 * refuseDuplicates() on both sets.
 *
 * The prose BETWEEN the halves names `policy-status`, the surface that answers the action list; it is after
 * the top half's cut and before the action list's, so it declares nothing on either side — the same shape
 * as item 4, whose two halves also have prose between them.
 */
export function declaredPolicyShape(doc) {
  const item = coveredItems(doc).get("5") ?? "";
  const what = "item 5 (policy file schema)";
  const actionsWhat = "item 5's action list (the actions an allow/deny entry is keyed by)";
  // Top-level keys: the head of the item, less its subject and every parenthetical (innermost-first to a
  // fixpoint, so one nested inside another cannot leave its contents behind).
  let head = cutBefore(item, POLICY_TOP_END, what).replace(/^\d+[a-z]?\. \*\*.*?\*\*/, " ");
  for (let before = ""; before !== head; ) {
    before = head;
    head = head.replace(/\([^()]*\)/g, " ");
  }
  const after = cutAfter(item, POLICY_ACTION_START, actionsWhat);
  const list = cutBefore(after, POLICY_ACTION_END, actionsWhat);
  const inProse = ticks(after.slice(list.length));
  assert.deepEqual(inProse, [], `VERSIONING.md item 5 backticks ${inProse.join(", ")} in the prose AFTER its action list, where an action name reads as declared and so as covered by semver — put it in the list to declare it, or name it without backticks if it is only an example`);
  return {
    top: refuseDuplicates(nonEmpty(ticks(head), "policy.json top-level keys (item 5)"), "item 5", "top-level key"),
    actions: refuseDuplicates(nonEmpty(ticks(list), "policy action names (item 5)"), "item 5's action list", "action name"),
  };
}

/**
 * The five phrases item 5b's four lists lie between: each list starts at its own marker and ends where the
 * next one starts, the last running to LEX_END. Named for the reason STATUS_CUT and SESSION_START/END are —
 * the cases that plant a REWORDED marker, and the reader's note quoting all five, cannot drift from the parse.
 */
export const LEX_TOP_START = "Its top-level keys are:";
export const LEX_PROFILE_START = "A `profiles[]` entry carries:";
export const LEX_PARENTS_START = "The `parents` block carries:";
export const LEX_REDACT_START = "A `redact[]` rule carries:";
export const LEX_END = "New optional keys are additive";

/** The list boundaries in reading order, so the parse and the cases that plant a marker share one table. */
const LEX_LISTS = [
  ["top", LEX_TOP_START, LEX_PROFILE_START],
  ["profile", LEX_PROFILE_START, LEX_PARENTS_START],
  ["parents", LEX_PARENTS_START, LEX_REDACT_START],
  ["redact", LEX_REDACT_START, LEX_END],
];

/**
 * Item 5b's four declarations of the lexicon-file schema — `{ top, profile, parents, redact }`: the keys of
 * the file itself, the fields of a `profiles[]` entry, the fields of the `parents` block and the fields of a
 * `redact[]` rule. It joined the parsed items in TMUX-137, and it is the covered item an operator writes to
 * make a security property STRONGER — src/core/lexicon.ts records the failure its additive-redaction promise
 * exists for, an adopter on a provider we do not use getting silent non-redaction.
 *
 * FOUR lists rather than one, because the file is nested and a flat read is wrong twice over: a field of a
 * redact rule is not a key of the file, and `name` belongs to both `profiles[]` and `redact[]`, so one flat
 * set under refuseDuplicates() fails on the shipped doc. Both guards therefore run PER LIST.
 *
 * Every rule the items before it pay for applies unchanged. The five markers are asserted present on
 * whitespace-NORMALIZED text. Every parenthetical inside a list is dropped, innermost-first
 * (item 4/5's structural rule, TMUX-133) — which is the rule this card was filed about: measured on
 * b0fe063, item 5b wrote all 15 nested keys inside parentheticals, so it declared 4 of the 19 the package
 * honours. Nothing may be backticked after the last list (item 6's rule, TMUX-122/126), since there is
 * nothing a name could mean there except a declaration. And `profiles[]`/`redact[]` are reduced to the keys
 * `profiles`/`redact` the package actually reads, item 4's `sessions[]` shape.
 *
 * The item's subject is BEFORE the first list, so the `~/.tmux-agent/lexicon.json` in it declares no key of
 * the file — it is the path item 7 takes by reference (declaredHomeLayout above).
 */
export function declaredLexiconShape(doc) {
  const item = coveredItems(doc).get("5b") ?? "";
  const out = {};
  for (const [group, start, end] of LEX_LISTS) {
    const what = `item 5b's ${group} list (the lexicon file schema)`;
    let list = cutBefore(cutAfter(item, start, what), end, what);
    // A parenthetical is prose ABOUT what precedes it, never a key of its own — innermost-first to a
    // fixpoint so one nested inside another cannot leave its contents behind.
    for (let before = ""; before !== list; ) {
      before = list;
      list = list.replace(/\([^()]*\)/g, " ");
    }
    out[group] = refuseDuplicates(
      nonEmpty(ticks(list).map((t) => t.replace(/\[\]$/, "")), `lexicon ${group} keys (item 5b)`),
      `item 5b's ${group} list`,
      "key",
    );
  }
  const inProse = ticks(cutAfter(item, LEX_END, "item 5b (lexicon file schema)"));
  assert.deepEqual(inProse, [], `VERSIONING.md item 5b backticks ${inProse.join(", ")} in the prose AFTER its last list, where a key name reads as declared and so as covered by semver — put it in one of item 5b's four lists to declare it, or name it without backticks if it is only an example`);
  return out;
}

/**
 * The phrases item 7's home half lies between, and the sentence it defers two paths with. Item 7 is the
 * first parsed item with a SECOND half after the list — "Shipped layout:", which backticks paths of its
 * own — so the end of the home half is a marker too, and the "nothing backticked after the list" rule is
 * bounded by it rather than running to the end of the item. Named for the reason STATUS_CUT and
 * SESSION_START/END are: the cases that plant a REWORDED marker, and the reader's note quoting all four,
 * cannot drift from the parse.
 */
export const HOME_SHIPPED = "**Shipped layout:**";
export const HOME_START = "Under the home:";
export const HOME_END = "that is the whole of the layout";
export const HOME_BYREF = "takes by reference rather than repeating: items";

/** A home-relative path as items 5 and 5b write theirs, without the home: `~/.tmux-agent/policy.json`. */
const HOME_PREFIX = "~/.tmux-agent/";
function homeRelative(text) {
  return ticks(text).filter((t) => t.startsWith(HOME_PREFIX)).map((t) => t.slice(HOME_PREFIX.length));
}

/**
 * The first path segment of each declared path — what a promise about the LAYOUT is about, and the unit
 * the live side can answer in: `ledger/archive/events-*.ndjson.gz` and `ledger/events-*.ndjson` are two
 * declarations of one directory, and every `health/<file>` is the `health/` directory item 7 gained in
 * TMUX-136. Distinct, order-independent.
 */
export function homeFirstSegments(paths) {
  return [...new Set(paths.map((p) => p.split("/")[0]))];
}

/**
 * Item 7's declared home layout: the paths the package writes under `$TMUX_AGENT_HOME`. It joined the
 * parsed items in TMUX-136, and it is the covered item about a shape on DISK — what a backup script, a
 * log collector and crash forensics read. Measured on b243565 (scratch/ga-fire-2026-09-19-18Z/probe/),
 * its declaration was both unparsed AND incomplete: the built Blackbox, which the dashboard daemon
 * constructs, creates a `health/` directory (mode 0700) of four files under the home, `health/` was
 * backticked 0 times in the whole of VERSIONING.md and 0 times in README.md, and item 7's six-path list
 * named none of them — so the directory an operator's crash forensics live in was covered by nothing and
 * a patch release could have moved it. Dropping `web-token` from the declaration, and a SEVENTH path the
 * daemon's own constructor creates, were each invisible to the whole unit suite.
 *
 * Four rules, all of them already paid for by the items before it. The list is cut at both ends like item
 * 4's per-session list, inside the half that ends at HOME_SHIPPED, and every marker is asserted present on
 * normalized text. Every parenthetical is dropped (item 4/5's structural rule, TMUX-133), which
 * is what keeps `ledgerKeepDays`, `ledgerDeleteAfterDays` and the aside's second mention of `health.json`
 * out of the declaration — and refuseDuplicates() below is what would catch that rule silently lapsing.
 * The text between the list's end and HOME_SHIPPED must backtick nothing (item 6's rule, TMUX-122/126):
 * there is nothing a path could mean there except a declaration, and the shipped half's own backticks are
 * why that rule needs an end marker instead of running to the end of the item. The home itself is named
 * BEFORE the list, so the item's subject declares no path in it.
 *
 * `policy.json` and `lexicon.json` sit in the same home and are declared BY REFERENCE: item 7 names the
 * items that own them (5 and 5b) and this parse reads the `~/.tmux-agent/<file>` each of THOSE items
 * backticks. Repeating the names here instead would let item 5 rename its file and leave item 7 declaring
 * a path nothing writes — the drift the two-directional comparison exists to refuse, reintroduced by the
 * doc. A deferral to an item that backticks no such path is a hard failure, not an empty contribution.
 */
export function declaredHomeLayout(doc) {
  const items = coveredItems(doc);
  const item = items.get("7") ?? "";
  const what = "item 7's home half (the $TMUX_AGENT_HOME layout)";
  const half = cutBefore(item, HOME_SHIPPED, "item 7 (on-disk layout)");
  const after = cutAfter(half, HOME_START, what);
  const list = cutBefore(after, HOME_END, what);
  const inProse = ticks(after.slice(list.length));
  assert.deepEqual(inProse, [], `VERSIONING.md item 7 backticks ${inProse.join(", ")} between the end of its home list and "${HOME_SHIPPED}", where a path reads as declared and so as covered by semver — put it in the list to declare it, or name it without backticks if it is only an example`);
  // Every parenthetical dropped, innermost-first to a fixpoint so one nested inside another cannot leave
  // its contents behind — a parenthetical is prose ABOUT the path it follows, never a path of its own.
  let listed = list;
  for (let before = ""; before !== listed; ) {
    before = listed;
    listed = listed.replace(/\([^()]*\)/g, " ");
  }
  const refs = cutAfter(half, HOME_BYREF, what);
  const stop = refs.indexOf(".");
  assert.ok(stop > 0, `VERSIONING.md item 7's "${HOME_BYREF}" sentence does not end — the parse cannot tell which items it defers to from an unterminated clause`);
  const numbers = nonEmpty([...refs.slice(0, stop).matchAll(/\b(\d+[a-z]?)\b/g)].map((m) => m[1]), "item numbers in item 7's by-reference sentence");
  const byRef = [];
  for (const n of numbers) {
    const paths = homeRelative(items.get(n) ?? "");
    assert.ok(paths.length > 0, `VERSIONING.md item 7 defers a home path to item ${n}, which backticks no \`${HOME_PREFIX}<file>\` of its own — the deferral declares nothing, so the file would be covered by neither item`);
    byRef.push(...paths);
  }
  return refuseDuplicates(nonEmpty([...ticks(listed), ...byRef], "home paths (item 7)"), "item 7's home layout", "path");
}

/**
 * The five phrases item 7's SHIPPED half is read by: three lists and a verdict, each beginning at its own
 * marker and ending where the next begins, the last running to SHIPPED_END. Named for the reason STATUS_CUT
 * and HOME_START/END are — the cases that plant a REWORDED marker, and the reader's note quoting all five,
 * cannot drift from the parse. HOME_SHIPPED starts this half and is the home half's end, so it is not
 * repeated here.
 */
export const SHIPPED_PATH_START = "The file it carries is:";
export const SHIPPED_FIELDS_START = "Its fields are:";
export const SHIPPED_REPORTERS_START = "The stamp is reported by:";
export const SHIPPED_VERDICT_START = "reports the verdict:";
export const SHIPPED_END = "New fields in the stamp are additive";

/** The regions in reading order, so the parse and the cases that plant a marker share one table. */
const SHIPPED_REGIONS = [
  ["path", SHIPPED_PATH_START, SHIPPED_FIELDS_START, "path"],
  ["fields", SHIPPED_FIELDS_START, SHIPPED_REPORTERS_START, "field"],
  ["reporters", SHIPPED_REPORTERS_START, SHIPPED_VERDICT_START, "reporter"],
  ["verdict", SHIPPED_VERDICT_START, SHIPPED_END, "verdict"],
];

/**
 * One region of item 7's shipped half: the backticked names between its two markers, with every
 * parenthetical dropped innermost-first to a fixpoint — a parenthetical is prose ABOUT what precedes it,
 * so the writer script beside the path and the NOT-covered aside beside the reporters declare nothing
 * (item 4/5/7's structural rule, TMUX-133). nonEmpty() and refuseDuplicates() run PER REGION, never
 * across them: `--version` is a reporter and `version` a field, and a flat read of the half is what
 * declared neither.
 */
function shippedRegion(item, group, start, end, noun) {
  const what = `item 7's shipped ${group} (the build stamp the package carries)`;
  let list = cutBefore(cutAfter(item, start, what), end, what);
  for (let before = ""; before !== list; ) {
    before = list;
    list = list.replace(/\([^()]*\)/g, " ");
  }
  return refuseDuplicates(nonEmpty(ticks(list), `stamp ${group} (item 7's shipped half)`), `item 7's shipped ${group}`, noun);
}

/**
 * Item 7's shipped half: the build stamp the PACKAGE carries, as `{ path, fields, reporters }`. It joined
 * the parsed items in TMUX-138 — the first half read after the other half of its own item already was, and
 * the last unparsed thing in the covered list. Measured on 0fefe2d (scratch/ga-fire-2026-09-20-02Z/probe/):
 * declaredHomeLayout() cuts at HOME_SHIPPED, so 306 of item 7's 1838 normalized chars were read by nothing,
 * and the one case naming those tokens asserted only that they are not home paths. Moving the cut would not
 * have helped: the half's payload sat inside a parenthetical, where item 7's OWN rule says a name declares
 * nothing, so of its 9 backticked tokens exactly 4 survived — the path, and the three reporters — while
 * `version`, `commit`, `builtAt` and `stale` survived as nothing at all. `builtAt`, `commit`, `stale` and
 * `dist/build.json` were each backticked ONCE in the whole file, in that aside; README.md names `builtAt`
 * and `dist/build.json` 0 times. Item 7 ceasing to name `builtAt` while the build still wrote it, and the
 * shipped stamp carrying a FOURTH field declared nowhere, were each invisible to the whole unit suite.
 *
 * THREE lists rather than one, and that is the whole shape of the fix: a file, the fields inside it, and the
 * surfaces that report it are three different promises, and reading the survivors as one flat list would
 * have declared `/api/health.build` covered — a surface this same file's NOT-covered section calls private.
 * So the contract test holds the reporters only to REPORTING the stamp and never freezes a reply's shape.
 *
 * The verdict is read separately by declaredStampVerdict() below: `stale` is no field of the stamp (the
 * built reader normalises to three) but the name a daemon reports a moved stamp under, so it is declared in
 * a position of its own rather than folded into the fields.
 *
 * Every rule the items before it pay for applies. The five markers are asserted present on whitespace-
 * NORMALIZED text. Every parenthetical is dropped. Nothing may be backticked after
 * the verdict (item 6's rule, TMUX-122/126), since there is nothing a name could mean there except a
 * declaration. The item's home half is BEFORE all five markers, so no path under the home is read here.
 */
export function declaredShippedStamp(doc) {
  const item = coveredItems(doc).get("7") ?? "";
  const out = {};
  for (const [group, start, end, noun] of SHIPPED_REGIONS) {
    if (group === "verdict") continue; // read by declaredStampVerdict(): the verdict is no field of the stamp
    out[group] = shippedRegion(item, group, start, end, noun);
  }
  assert.equal(out.path.length, 1,
    `VERSIONING.md item 7's shipped half backticks ${out.path.length} names where the file the package carries is declared (${out.path.join(", ")}) — the stamp is one file, and a second name there would be compared against it as though it were the same one`);
  out.path = out.path[0];
  const inProse = ticks(cutAfter(item, SHIPPED_END, "item 7's shipped half (the build stamp the package carries)"));
  assert.deepEqual(inProse, [], `VERSIONING.md item 7 backticks ${inProse.join(", ")} in the prose AFTER its shipped half's last region, where a name reads as declared and so as covered by semver — put it in the path, field, reporter or verdict position to declare it, or name it without backticks if it is only an example`);
  return out;
}

/**
 * The name item 7's shipped half declares the staleness verdict under — what a daemon whose on-disk stamp
 * has moved under it reports itself as. Its own position, for the reason declaredShippedStamp() gives: the
 * verdict is not a field of the stamp, so a fields comparison that swallowed it would go red against the
 * three the built reader normalises to.
 */
export function declaredStampVerdict(doc) {
  const item = coveredItems(doc).get("7") ?? "";
  const names = shippedRegion(item, "verdict", SHIPPED_VERDICT_START, SHIPPED_END, "verdict");
  assert.equal(names.length, 1,
    `VERSIONING.md item 7's shipped half declares ${names.length} names as the staleness verdict (${names.join(", ")}) — a daemon reports one, so the extra names are covered by semver with nothing answering for them`);
  return names[0];
}

/** Item 1's declared CLI verbs (before the global-flag sentence) and its declared global flags. */
export function declaredCli(doc) {
  const item = coveredItems(doc).get("1") ?? "";
  const verbText = cutBefore(item, "global flags", "item 1 (CLI verbs)");
  return {
    verbs: nonEmpty(ticks(verbText).filter((t) => !t.startsWith("--")).map((t) => t.split(/\s/)[0]), "CLI verbs (item 1)"),
    flags: nonEmpty(ticks(flatten(item)).filter((t) => t.startsWith("--")).map((t) => t.slice(2)), "global flags (item 1)"),
  };
}

/**
 * Item 6's declared root exports: the names listed before the sentence about signatures, each once,
 * and nothing from the prose after the cut — which must therefore backtick nothing at all. An export
 * meant to stay internal is recorded in the INTERNAL allowlist of test/versioning-contract.test.js,
 * where the decision is visible; saying "internal" in English beside a backticked name declares it.
 */
export function declaredExports(doc) {
  const item = coveredItems(doc).get("6") ?? "";
  const list = cutBefore(item, "and their signatures", "item 6 (root exports)");
  const inProse = ticks(flatten(item).slice(list.length));
  assert.deepEqual(inProse, [], `VERSIONING.md item 6 backticks ${inProse.join(", ")} in the prose AFTER its declared list, where a name reads as declared and so as covered by semver — put it in item 6's list to declare it, or record the decision to keep it internal in the INTERNAL allowlist of test/versioning-contract.test.js`);
  return refuseDuplicates(nonEmpty(ticks(list), "root exports (item 6)"), "item 6", "root export");
}

/**
 * The phrase item 6's list turns from values to types at. Named for the reason STATUS_CUT is — the case
 * that plants a REWORDED marker, and the reader's note quoting it, cannot drift from the parse.
 */
export const EXPORT_TYPES_START = "; types";

/**
 * Item 6's declared list read as the TWO halves it is written in — `{ values, types }`: the names that
 * exist at runtime, and the names that exist only in the declarations. declaredExports() above reads the
 * same list FLAT, which is all its check needs (a root export is a root export); this split is what the
 * item's last four words, "and their signatures", need in order to mean anything — a signature belongs to
 * a type, and until TMUX-147 those four words were read only as declaredExports()' cut marker, so the
 * MEMBERS of every covered type could change, vanish or ship dead with nothing failing.
 *
 * The marker is asserted present on whitespace-NORMALIZED text like every other cut here, both
 * halves are guarded by nonEmpty() and refuseDuplicates(), and the two counts must add up to
 * the flat list's: a name that fell into neither half — the shape a drifted marker takes — would otherwise
 * be silently unheld by both this parse and the flat one.
 */
export function declaredExportKinds(doc) {
  const item = coveredItems(doc).get("6") ?? "";
  const list = cutBefore(item, "and their signatures", "item 6 (root exports)");
  // ONE label for both cuts: the marker is a single boundary, and whichever side is read first is the
  // side that fails when it drifts — a reader (and the marker-rewording case that plants it) should not
  // have to know which.
  const what = "item 6's value/type split (the names \"and their signatures\" is about)";
  const values = refuseDuplicates(nonEmpty(ticks(cutBefore(list, EXPORT_TYPES_START, what)), "root export values (item 6)"), "item 6's value half", "root export");
  const types = refuseDuplicates(nonEmpty(ticks(cutAfter(list, EXPORT_TYPES_START, what)), "root export types (item 6)"), "item 6's type half", "type");
  const flat = declaredExports(doc).length;
  assert.equal(values.length + types.length, flat,
    `VERSIONING.md item 6 parses ${values.length} values + ${types.length} types for the ${flat} names its flat list carries — a name on neither side of "${EXPORT_TYPES_START}" is held by neither half's check, which is what a drifted marker looks like`);
  return { values, types };
}

/**
 * The three phrases item 9's two lists lie between: each list begins at its own marker and ends where the
 * next begins, the second running to ENV_END. Named for the reason STATUS_CUT and LEX_TOP_START are — the
 * cases that plant a REWORDED marker, and the reader's note quoting all three, cannot drift from the parse.
 */
export const ENV_COVERED_START = "The covered variables are:";
export const ENV_UNCOVERED_START = "The variables it reads but does NOT cover are:";
export const ENV_END = "New variables are additive";

/** The list boundaries in reading order, so the parse and the cases that plant a marker share one table. */
const ENV_LISTS = [
  ["covered", ENV_COVERED_START, ENV_UNCOVERED_START],
  ["notCovered", ENV_UNCOVERED_START, ENV_END],
];

/**
 * An environment variable as a doc writes it — SHOUTY_SNAKE, with item 7's `$` sigil normalized away.
 * The SHAPE is what keeps a value or a flag out of the declaration, the way eventTicks() keeps `data` out
 * of item 3's and optionTicks() keeps a path out of item 8's: `1`, `--socket` and `64 MiB` are all
 * backticked inside item 9's asides. The sigil matters because item 7 writes the same variable as
 * `$TMUX_AGENT_HOME` — the only name in this file written that way — so a copy of that style into item 9
 * must declare the same name rather than a second one the package never reads. Deliberately NOT limited to
 * the `TMUX_AGENT_` prefix: a variable outside it would still be a configuration surface, and a shape that
 * silently dropped it would let one be read with nothing declaring it.
 */
export function envTicks(text) {
  return ticks(text).filter((t) => /^\$?[A-Z][A-Z0-9_]*$/.test(t)).map((t) => t.replace(/^\$/, ""));
}

/**
 * Item 9's two declarations of the environment surface — `{ covered, notCovered }`: the variables semver
 * covers, and the ones the package reads but this item explicitly does not cover. It joined the parsed
 * items in TMUX-142, and it is the item about how the tool is CONFIGURED rather than what it emits.
 *
 * TWO lists rather than one because the split is an author's judgement — a health tick and two watchdog
 * knobs read like internal tuning while a webhook and a policy path read like configuration a user sets —
 * and a parse that could not see the split would have to promise all 11 or none. That is also why the
 * guards run across the two as well as inside each: a name in BOTH lists is covered and not covered at
 * once, and set equality against the live side could not see it (the union carries it either way).
 *
 * Every rule the items before it pay for applies. The three markers are asserted present on whitespace-
 * NORMALIZED text. Every parenthetical is dropped innermost-first — which is what
 * lets each name carry its meaning beside it without the meaning declaring anything. Nothing may be
 * backticked after the last list (item 6's rule, TMUX-122/126), since there is nothing a name could mean
 * there except a declaration. The item's subject is before the first marker, so the parenthetical of
 * examples in it declares nothing either.
 */
export function declaredEnvVars(doc) {
  const item = coveredItems(doc).get("9") ?? "";
  const out = {};
  for (const [group, start, end] of ENV_LISTS) {
    const what = `item 9's ${group} list (the environment variables)`;
    let list = cutBefore(cutAfter(item, start, what), end, what);
    // A parenthetical is prose ABOUT the name it follows, never a variable of its own — innermost-first to
    // a fixpoint so one nested inside another cannot leave its contents behind.
    for (let before = ""; before !== list; ) {
      before = list;
      list = list.replace(/\([^()]*\)/g, " ");
    }
    out[group] = refuseDuplicates(nonEmpty(envTicks(list), `environment variables (item 9's ${group} list)`), `item 9's ${group} list`, "variable");
  }
  const both = out.covered.filter((n) => out.notCovered.includes(n)).sort();
  assert.deepEqual(both, [], `VERSIONING.md item 9 lists ${both.join(", ")} as BOTH covered and not covered — the union the live side is compared with carries the name either way, so the contradiction would pass; put each variable in exactly one of the two lists`);
  const inProse = envTicks(cutAfter(item, ENV_END, "item 9 (the environment variables)"));
  assert.deepEqual(inProse, [], `VERSIONING.md item 9 backticks ${inProse.join(", ")} in the prose AFTER its last list, where a variable name reads as declared and so as covered by semver — put it in item 9's covered or not-covered list, or name it without backticks if it is only an example`);
  return out;
}

/**
 * The phrases the preamble's "which items are parsed" sentence lies between. PARSED_ITEMS_END is the claim
 * itself, so a reworded one is loud rather than silently leaving the enumeration unread.
 */
export const PARSED_ITEMS_START = "Items";
export const PARSED_ITEMS_END = "below are parsed as data by";

/** The preamble: everything before the covered list, where the file says what it is and what checks it. */
export function preambleText(doc) {
  const at = doc.indexOf("## Covered by semver");
  assert.ok(at > -1, "VERSIONING.md must keep its 'Covered by semver' heading — the preamble the parse below reads is the text before it");
  return flatten(doc.slice(0, at));
}

/**
 * The item numbers the preamble claims are parsed as data. Read in a position of its own rather than with
 * ticks() because the enumeration is NOT backticked: every other parse in this file reads
 * `names`, and a sentence of bare numbers yields nothing to them — which is how "Items 1, 2, 3, 4, 5, 5b,
 * 6, 7 and 8 below are parsed as data by test/versioning-contract.test.js" stood unread from TMUX-83 to
 * TMUX-142 while items joined the list one card at a time.
 *
 * The region between the two markers must be numbers, commas and the word "and" — nothing else. That
 * structural assert is what stands in for a backtick here: a cut that drifted, or a sentence reworded around
 * the enumeration, keeps prose and fails loudly instead of parsing "5" out of a sentence about item 5.
 * `5b` is why the numbers are `\d+[a-z]?` rather than `\d+`, the shape coveredItems() keys by.
 */
export function declaredParsedItems(doc) {
  const what = "VERSIONING.md's preamble (the sentence naming which items are parsed as data)";
  const region = cutBefore(cutAfter(preambleText(doc), PARSED_ITEMS_START, what), PARSED_ITEMS_END, what);
  const junk = region.replace(/\b\d+[a-z]?\b|,|\band\b|\s+/g, "");
  assert.equal(junk, "", `VERSIONING.md's preamble reads "${region.trim()}" between "${PARSED_ITEMS_START}" and "${PARSED_ITEMS_END}" — an enumeration of parsed items is item numbers, commas and "and", so ${JSON.stringify(junk)} means the cut moved or the sentence was reworded around it`);
  const numbers = [...region.matchAll(/\b(\d+[a-z]?)\b/g)].map((m) => m[1]);
  return refuseDuplicates(nonEmpty(numbers, "parsed item numbers (the preamble)"), "the preamble's enumeration", "item number");
}

/**
 * The four phrases the NOT-covered section's three lists lie between: each list begins at its own marker
 * and ends where the next begins, the last running to NOT_END. Named for the reason STATUS_CUT and
 * LEX_TOP_START are — the cases that plant a REWORDED marker, and the reader's note quoting all four,
 * cannot drift from the parse.
 */
export const NOT_PATHS_START = "The internal module paths are:";
export const NOT_EXPORTS_START = "The internal root exports are:";
export const NOT_DIRS_START = "The excluded directories are:";
export const NOT_END = "Nothing in this section is covered by semver";

/** The list boundaries in reading order, so the parse and the cases that plant a marker share one table. */
const NOT_LISTS = [
  ["paths", NOT_PATHS_START, NOT_EXPORTS_START, "module path"],
  ["exports", NOT_EXPORTS_START, NOT_DIRS_START, "root export"],
  ["dirs", NOT_DIRS_START, NOT_END, "directory"],
];

/**
 * The "NOT covered" section's own text — its heading to the next one. coveredItems() above already finds
 * the heading, as the END anchor of the covered list, and asserts it present; that anchor plus the
 * assertion was the WHOLE of the suite's contact with this section until TMUX-139.
 */
export function notCoveredSection(doc) {
  const start = doc.indexOf("## NOT covered");
  assert.ok(start > -1, "VERSIONING.md must keep its 'NOT covered' section — it is where the file records what semver does not promise");
  const end = doc.indexOf("\n## ", start + 1);
  assert.ok(end > start, "VERSIONING.md's 'NOT covered' section is no longer followed by another heading — the parse cannot tell where it ends and would read the rest of the file as exclusions");
  return doc.slice(start, end);
}

/**
 * The NOT-covered section's three declarations — `{ paths, exports, dirs }`: the internal module paths,
 * the internal root exports, and the directories the published package excludes. It joined the parsed
 * text in TMUX-139, and it is the first parse in this file that is not about the covered list at all:
 * the section that says what semver does NOT promise, which every covered item defers to (item 5b sends
 * built-in regexes here, item 7's shipped half sends `/api/*` here) while nothing read a byte of it.
 * Measured on 6d2faff (scratch/ga-fire-2026-09-20-08Z/probe/): its heading was used once as the END
 * anchor of coveredItems(), not one of its 811 normalized chars was parsed, and under the file's own
 * parenthetical rule 4 of its 10 backticked tokens survived — the 6 dropped being the whole payload, the
 * deep-import path, the glob and the four built-in profile objects. The section stopping to name
 * `aiderProfile` while the export and the INTERNAL allowlist both kept it, an exports map that RESOLVED
 * the deep import this section calls internal, and a `files` list that shipped `scratch/` were each
 * invisible to the whole unit suite.
 *
 * THREE lists because they answer to three different live authorities: what the package's exports map
 * refuses a consumer outside it, the root barrel's own exports, and the file list of the published
 * tarball. Both guards run PER LIST, as item 5b's four do.
 *
 * Every rule the parsed items pay for applies. The four markers are asserted present on whitespace-
 * NORMALIZED text. Every parenthetical inside a list is dropped, innermost-first —
 * which is what keeps the INTERNAL allowlist's own path and the `dist/` in the aside about item 7 out of
 * the declaration. Nothing may be backticked after the last list (item 6's rule, TMUX-122/126).
 *
 * The prose BEFORE the first marker is where the exclusions no list can answer for stay, and that
 * position is load-bearing rather than tidy: `/api/*` is a glob with no member to resolve which the
 * package's own CLI and MCP surfaces read, so a check shaped like the module-path one would go red on
 * the shipped tree; and `SessionState` and `resolveProfiles()` are names item 6 DECLARES, standing here
 * as pointers — read as declarations they would put two names on both lists and trip the contract test's
 * own contradiction rule on the shipped doc.
 */
export function declaredNotCovered(doc) {
  const section = notCoveredSection(doc);
  const out = {};
  for (const [group, start, end, noun] of NOT_LISTS) {
    const what = `the NOT-covered section's ${group} list`;
    let list = cutBefore(cutAfter(section, start, what), end, what);
    // A parenthetical is prose ABOUT what precedes it, never an exclusion of its own — innermost-first
    // to a fixpoint so one nested inside another cannot leave its contents behind.
    for (let before = ""; before !== list; ) {
      before = list;
      list = list.replace(/\([^()]*\)/g, " ");
    }
    out[group] = refuseDuplicates(nonEmpty(ticks(list), `NOT-covered ${group} (${what})`), what, noun);
  }
  const inProse = ticks(cutAfter(section, NOT_END, "the NOT-covered section"));
  assert.deepEqual(inProse, [], `VERSIONING.md's NOT-covered section backticks ${inProse.join(", ")} AFTER its last list, where a name reads as an exclusion the suite must answer for — put it in the paths, exports or directories list to declare it, or name it without backticks if it is only an example`);
  return out;
}
