/**
 * The BUILT package as the doc contracts read it: the ledger's event vocabulary, the JS the package
 * actually runs, and the MEMBERS of the types it declares — read in ONE place so no two contract
 * tests can disagree about what a type, a member or a comment is.
 *
 * test/root-docs-contract.test.js has parsed the `EventType` union out of the built declaration since
 * TMUX-85, to check that the event names CONTRIBUTING.md and SECURITY.md use resolve. TMUX-126 needs
 * the same union to compare against VERSIONING.md item 3's declared list — and two copies of one
 * regex is how the two pages end up judged against different vocabularies. So both import this.
 *
 * The second question is not "what is declared" but "what does the code FILE": three of the 23 types
 * (measured 2026-09-18 on a0eeb1e) occur nowhere as a literal in the shipped JS, so a client is
 * promised names the package cannot produce. filedTypes() is that reader; the decision about each
 * unfiled name is recorded in test/versioning-contract.test.js's RESERVED allowlist.
 *
 * The third question is TMUX-147's: item 6 declares 15 type names "and their signatures", and the
 * members INSIDE those signatures answered to nothing. shippedTypeMembers() and honoursMember() are
 * that reader, and two of their rules were measured rather than assumed (2026-09-21 on 1747fde,
 * scratch/ga-fire-2026-09-21-12Z/probe/): the authority must be the `.d.ts`, because tsc erases an
 * interface from the JS entirely — dist/core/calibrate.js carries no member list at all; and the
 * occurrence must be PROPERTY-shaped, because a bare-word scan for a short member (`v`, `at`, `ts`,
 * `name`) passes on almost any input, which made a bare-word probe right by luck on 1 violation where
 * the property-shaped one finds 16 at module scope.
 *
 * The fourth is TMUX-149's: a member's own TYPE is part of the signature item 6 promises, and 5 types
 * were reachable from a covered signature while item 6 named none of them and the package root
 * re-exported none of them — 16 members a consumer received and could not annotate. declaredTypeNames()
 * and reachableUndeclared() are that reader, and the walk must be TRANSITIVE: a one-level read returns
 * only 4 of the 5, which is exactly the answer three fires carried forward before it was measured.
 *
 * The fifth is TMUX-150's: the closure above walks item 6's TYPE half, so the 24 names a consumer CALLS
 * or `new`s were seeded from nothing — a parameter's type, a return's type and every type a covered CLASS
 * hands back from a method were outside the whole suite. Measured on afccbee, 10 types the built tree
 * declares were reachable from a covered VALUE's signature with item 6 naming none of them
 * (8 object types / 35 members plus the two unions `Action` and `Surface`).
 * shippedValueDeclarations() and reachableFromValues() are that reader, and BOTH of its rules had to be
 * measured rather than assumed: a class's signature surface is its whole BODY (a head-only read reaches
 * 1 of the 10, `WasteRow`, because `wasteReport()`'s declaration fits on one line), and the walk is
 * TRANSITIVE again (a one-level walk reaches 9 — `SurfaceRules` hangs off `PolicyConfig`).
 *
 * The sixth is TMUX-152's, and it is the first one about a union whose members are PROSE elsewhere:
 * `SessionState` shipped 7 members while three surfaces enumerated them and two disagreed — README.md's
 * architecture tree named 5 and the MCP `session-status` description 6 — because every enumeration was a
 * hand-typed COPY, test/a11y.test.js's included, under a comment claiming it covered "every state the
 * monitor can emit". shippedSessionStates() and enumeratedStates() are that reader and that cut, and the
 * reason they live here is the reason the EventType union does: a11y's copy and a doc contract's copy are
 * how one tree ends up judged by two vocabularies.
 *
 * stripComments() lives here for the same reason the union does: three suites read the built JS and a
 * fourth private copy of the strip is how they end up judging it differently (TMUX-147's criterion).
 *
 * See test/helpers/mcp-contract.js on why helpers are not *.test.js files.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every event type the built package declares: the `EventType` union of dist/core/ledger.d.ts. */
export function shippedEventTypes(root = ROOT) {
  const dts = readFileSync(join(root, "dist/core/ledger.d.ts"), "utf8");
  const union = /^export type EventType =([^;]+);/m.exec(dts);
  assert.ok(union, "no `export type EventType = …;` in dist/core/ledger.d.ts — is the tree built?");
  const names = [...union[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length > 0, "parsed ZERO event types from dist/core/ledger.d.ts's EventType union — an empty vocabulary is a hard failure, not a pass");
  return names;
}

/**
 * Every state the built package declares: the `SessionState` union of dist/core/monitor.d.ts. Read
 * comment-stripped, so a member commented out of the declaration stops counting.
 *
 * `root` is a parameter for the reason shippedEventTypes()' is, and TMUX-152 needs it: a suite can
 * point the reader at a planted fixture tree and watch its own check demand a glyph for an EIGHTH
 * member, which is the only way to prove a check READS the union instead of repeating it.
 */
export function shippedSessionStates(root = ROOT) {
  const dts = stripComments(readFileSync(join(root, "dist/core/monitor.d.ts"), "utf8"));
  const union = /^export type SessionState =([^;]+);/m.exec(dts);
  assert.ok(union, `no \`export type SessionState = …;\` in ${root}/dist/core/monitor.d.ts — is the tree built?`);
  const names = [...union[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length > 0, "parsed ZERO members from dist/core/monitor.d.ts's SessionState union — an empty vocabulary is a hard failure, not a pass");
  return names;
}

/**
 * The state names ONE prose surface enumerates, cut between its own two markers and returned as data
 *. `text` is passed in rather than read here so a case can plant a REWORDED marker or a
 * drifted name in a STRING and assert what the cut yields — the rule test/helpers/readme-doc.js
 * states, and the reason no tree copy is needed to prove this cut cannot go vacuous.
 *
 * Four rules, each one a BANLIST entry already paid for next door: every marker is asserted PRESENT
 * (a reworded surface must FAIL naming the marker, never pass with an empty set), asserted UNIQUE
 * (a marker occurring twice makes "which list did it answer for" undecidable), the token set is
 * asserted non-empty, and a name read twice is refused — both directions of a set comparison agree
 * while the surface is not what the cut says it is (TMUX-118's shape for VERSIONING item 2).
 */
export function enumeratedStates(text, { after, before, what }) {
  const start = text.indexOf(after);
  assert.ok(start > -1, `no ${JSON.stringify(after)} in ${what} — the cut's opening marker is gone, so the state list it names cannot be read. Reword the check WITH the surface; never let the cut answer with an empty set`);
  assert.equal(start, text.lastIndexOf(after), `${JSON.stringify(after)} occurs more than once in ${what} — the cut reads whichever comes first, so which list it answers for is no longer decidable`);
  const rest = text.slice(start + after.length);
  const end = rest.indexOf(before);
  assert.ok(end > -1, `${JSON.stringify(before)} does not follow ${JSON.stringify(after)} in ${what} — the cut's closing marker is gone and the list has no end`);
  const names = [...rest.slice(0, end).matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map((m) => m[0]);
  assert.ok(names.length > 0, `cut ZERO state names out of ${what}, between ${JSON.stringify(after)} and ${JSON.stringify(before)} — an empty candidate set is a hard failure, not a pass`);
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort();
  assert.deepEqual(twice, [], `${what} names ${twice.join(", ")} more than once between its markers — either the surface says it twice or the cut read text beside the list`);
  return names;
}

/** Every file under dist/ whose name ends in `ext`, repo-relative — the walk builtJs() and the
 * declaration reader share, so they cannot disagree about what the built tree contains. */
function distFiles(ext, root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(ext)) out.push(rel);
    }
  };
  walk("dist");
  return out;
}

/** Every dist/**\/*.js concatenated: the code the package actually runs, where a type is filed or is not. */
export function builtJs(root = ROOT) {
  const parts = distFiles(".js", root).map((rel) => readFileSync(join(root, rel), "utf8"));
  assert.ok(parts.length > 0, "found no dist/**/*.js — is the tree built?");
  return parts.join("\n");
}

/**
 * Of `types`, those the built JS files: the name occurs as a QUOTED string literal, which is what an
 * append site looks like once tsc has erased the union. A type mentioned in a comment is not filed,
 * and a type that exists only in the union compiles to nothing at all.
 */
export function filedTypes(types, js = builtJs()) {
  return types.filter((t) => new RegExp(`["'\`]${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).test(js));
}

/**
 * Comments removed, string and template literals kept — one alternation, so a `//` inside a string
 * cannot eat the rest of its line. Measured on a3450d6 (scratch/ga-fire-2026-09-19-04Z/extract-probe.log):
 * of the 18 `@agent_*` mentions dist carries, the strip drops 7 and not one of the 7 quoted hits, i.e.
 * every name it removes is prose. An over-eager strip is loud rather than silent: a real occurrence it
 * swallowed leaves a declared name ABSENT from the live side, and the comparison fails naming it.
 *
 * One copy, three readers: test/versioning-contract.test.js and test/agnostic-contract.test.js
 * each carried this function privately, so a fix to one strip left the other suite judging the same built
 * tree by the older rule.
 */
export function stripComments(js) {
  return js.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (whole, literal) => literal ?? "");
}

/** The declared members of one brace body: the names at its OWN depth, never a nested type's keys.
 * Nested `{ … }` blocks are collapsed innermost-first to a fixpoint (item 4's parenthetical rule, in
 * TypeScript) so `sampled: { sessions: number }` declares `sampled` and not `sessions`. An index
 * signature (`[k: string]: …`) declares no member name and does not match. */
function membersOf(body) {
  let flat = body;
  for (let before = ""; before !== flat; ) {
    before = flat;
    flat = flat.replace(/\{[^{}]*\}/g, " ");
  }
  return [...new Set([...flat.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*[:(]/gm)].map((m) => m[1]))];
}

/** The declaration-head shape, as a source fragment so the per-name resolver below and the whole-tree
 * index share ONE rule about what declaring a type looks like: a name the index holds but the resolver
 * cannot find (or the reverse) would make the closure's filter and its walk disagree.
 *
 * A CLASS head counts. `activity: ActivityTracker` is a member of a covered signature, so a
 * consumer must be able to annotate it; and the cost of dropping a class is never one name, because the
 * class's declaration body then goes UNREAD and every type reachable only THROUGH it disappears too.
 * Measured on 54dcdb1: dropping classes hid `ActivityTracker` plus `ActivityThresholds` and `CpuSample`
 * — two INTERFACES this same index already accepted, unreachable by any other path. `abstract` is
 * optional for the reason the fragment is shared at all: VALUE_HEAD below already reads it, and a head
 * one reader accepts while the other does not is the disagreement this constant exists to prevent. */
const DECL_HEAD = "(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:interface|type|class)\\s+";

/**
 * The type names `names` as the BUILT declarations carry them — `{ objects, aliases, missing, bodies }`:
 * `objects` maps each brace-bodied type to `{ file, members }`, `aliases` lists the ones declared as
 * something else (item 6's two string unions), `missing` names the ones no dist/**\/*.d.ts declares
 * at all, and `bodies` carries the raw declaration body of every name that resolved — objects and
 * aliases alike — which is where a reference to ANOTHER declared type hides (TMUX-149's closure reads
 * it). A covered type that leaves the build lands in `missing` rather than quietly shrinking the walk.
 *
 * The `.d.ts` is the only authority available: tsc erases an interface from the emitted JS completely,
 * so nothing in dist/**\/*.js knows that `CalibrateInput` ever had a member.
 */
export function shippedTypeMembers(names, root = ROOT) {
  const files = distFiles(".d.ts", root).map((rel) => [rel, readFileSync(join(root, rel), "utf8")]);
  assert.ok(files.length > 0, "found no dist/**/*.d.ts — is the tree built?");
  const objects = new Map();
  const aliases = [];
  const missing = [];
  const bodies = new Map();
  for (const name of names) {
    let found = null;
    for (const [rel, text] of files) {
      const m = new RegExp(`^\\s*${DECL_HEAD}${name}\\b`, "m").exec(text);
      if (m) { found = [rel, text, m]; break; }
    }
    if (!found) { missing.push(name); continue; }
    const [rel, text, m] = found;
    // A brace before the declaration's terminating `;` is an object type; anything else (a union, a
    // primitive, a mapped alias) is read as an alias and answered elsewhere.
    const open = text.indexOf("{", m.index);
    const semi = text.indexOf(";", m.index);
    if (open === -1 || (semi > -1 && semi < open)) {
      aliases.push(name);
      // An alias's body is what it aliases TO — everything after the `=` up to that `;`. Sliced from the
      // declaration head when there is no `=` (a shape no built alias has today) rather than dropped, so
      // an alias whose references stopped being read would be visible as a changed count, not as silence.
      const eq = text.indexOf("=", m.index);
      bodies.set(name, text.slice(eq > -1 && (semi === -1 || eq < semi) ? eq + 1 : m.index, semi === -1 ? undefined : semi));
      continue;
    }
    let depth = 0, end = open;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    const body = text.slice(open + 1, end);
    objects.set(name, { file: rel, members: membersOf(body) });
    bodies.set(name, body);
  }
  return { objects, aliases, missing, bodies };
}

/**
 * Every type name the BUILT declarations declare — the filter the closure below cannot work without.
 * An unfiltered reference scan reports the standard library (`Date`, `Promise`, `Partial`) as types the
 * package owes a consumer a name for, which is the trap TMUX-149 measured onto its card rather than
 * rediscovering here. Comment-stripped and sharing DECL_HEAD with the resolver above.
 */
export function declaredTypeNames(root = ROOT) {
  const names = new Set();
  for (const rel of distFiles(".d.ts", root)) {
    const text = stripComments(readFileSync(join(root, rel), "utf8"));
    for (const m of text.matchAll(new RegExp(`^\\s*${DECL_HEAD}([A-Za-z_][A-Za-z0-9_]*)\\b`, "gm"))) names.add(m[1]);
  }
  return names;
}

/** The declaration-head shape of a VALUE — the 33 names of item 6's value half (24 when TMUX-150 wrote this
 * reader, 25 after TMUX-151, 32 after TMUX-154 declared the seven error classes, 33 after TMUX-155 declared the
 * eighth), as the built `.d.ts`
 * carries them. Its capture group is the KIND, because the end of the declaration depends on it: a class
 * body closes with a brace, a function or a const with a semicolon. */
const VALUE_HEAD = "(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(class|function|const|let|var)\\s+";

/**
 * The declaration TEXT of each value in `names` — `{ bodies, kinds, missing }`. Item 6's
 * value half promises "their signatures" too, and a value's signature is where a consumer meets a type
 * they must be able to NAME: what `new Tmux({…})` takes, what `Monitor.tmuxStatus()` hands back, what
 * `wasteReport()` returns. Read off comment-STRIPPED declarations, so a type named only in a doc-comment
 * contributes no reference.
 *
 * A class's signature surface is its whole BODY, and that is measured rather than assumed: `headOnly`
 * drives the degraded arm a control below needs — on afccbee it reaches 1 of the 10 types the full read
 * finds, because every method of `Tmux`, `Ledger`, `Monitor`, `Mailbox` and `Policy` sits below the
 * declaration's first line. So a class is read to its matching closing brace; anything else to its
 * terminating `;` at brace- AND paren-depth zero, since `f(o: { a: string; b: Deep }): void;` carries a
 * semicolon inside its own parameter and a reader that stopped at the first one would lose `Deep`.
 */
export function shippedValueDeclarations(names, root = ROOT, headOnly = false) {
  const files = distFiles(".d.ts", root).map((rel) => [rel, stripComments(readFileSync(join(root, rel), "utf8"))]);
  assert.ok(files.length > 0, "found no dist/**/*.d.ts — is the tree built?");
  const bodies = new Map();
  const kinds = new Map();
  const missing = [];
  for (const name of names) {
    let found = null;
    for (const [rel, text] of files) {
      const m = new RegExp(`^\\s*${VALUE_HEAD}${name}\\b`, "m").exec(text);
      if (m) { found = [rel, text, m]; break; }
    }
    if (!found) { missing.push(name); continue; }
    const [, text, m] = found;
    kinds.set(name, m[1]);
    if (headOnly) {
      const nl = text.indexOf("\n", m.index + 1);
      bodies.set(name, text.slice(m.index, nl === -1 ? undefined : nl));
      continue;
    }
    let end = m.index;
    const open = text.indexOf("{", m.index);
    if (m[1] === "class") {
      assert.ok(open > -1, `dist declares \`class ${name}\` with no body brace after it — the read would run to the end of the file, so the walk is refusing rather than over-reading`);
      let depth = 0;
      for (end = open; end < text.length; end++) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}" && --depth === 0) break;
      }
    } else {
      for (let brace = 0, paren = 0; end < text.length; end++) {
        const c = text[end];
        if (c === "{") brace++;
        else if (c === "}") brace--;
        else if (c === "(") paren++;
        else if (c === ")") paren--;
        else if (c === ";" && brace === 0 && paren === 0) break;
      }
    }
    bodies.set(name, text.slice(m.index, end));
  }
  return { bodies, kinds, missing };
}

/**
 * The transitive reference walk both halves of item 6 are judged by — ONE copy, for the reason the
 * header states about stripComments(): two copies of this loop is how the type half and the value half
 * end up judged by different rules about what a reference is. `seedBodies` maps an already-resolved
 * name to the declaration text its references are read out of; every declared type a body names is
 * followed, and `exclude` is the set item 6 covers (so a covered name is walked but is no gap).
 *
 * `maxDepth = 1` reads the seeds and stops, which is the degraded arm every control drives: it is the
 * difference between reaching `SurfaceRules` through `PolicyConfig` and not reaching it at all.
 */
function walkRefs(seedBodies, seedNames, exclude, root, maxDepth) {
  const declared = declaredTypeNames(root);
  const refs = new Map(); // declared name -> the names whose bodies reach it
  const walked = [];
  const seen = new Set(seedNames);
  let frontier = seedBodies;
  for (let depth = 0; frontier.size && depth < maxDepth; depth++) {
    const next = [];
    for (const [name, body] of frontier) {
      walked.push(name);
      for (const m of stripComments(body).matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
        const ref = m[1];
        if (ref === name || !declared.has(ref)) continue;
        if (!refs.has(ref)) refs.set(ref, new Set());
        refs.get(ref).add(name);
        if (!seen.has(ref)) { seen.add(ref); next.push(ref); }
      }
    }
    // Resolved only when a deeper level will actually be read: a name nothing declares is dropped here
    // exactly as shippedTypeMembers() reports it missing, never walked as an empty body.
    frontier = next.length && depth + 1 < maxDepth ? shippedTypeMembers(next, root).bodies : new Map();
  }
  const gaps = [...refs.keys()].filter((r) => !exclude.includes(r)).sort();
  const { objects } = shippedTypeMembers(gaps, root);
  const reachable = new Map(gaps.map((name) => [name, {
    file: objects.get(name)?.file ?? null,
    members: objects.get(name)?.members ?? [],
    from: [...refs.get(name)].sort(),
  }]));
  return { reachable, refs: new Map([...refs].map(([k, v]) => [k, [...v].sort()])), walked };
}

/**
 * The types a consumer RECEIVES from the signatures of `names` but which `names` does not contain —
 * `{ reachable, refs, walked }`. VERSIONING.md item 6 declares type names "and their
 * signatures"; a member's own TYPE is part of that signature, so a name reachable from a covered
 * signature and declared nowhere is 3–4 members a consumer is handed and cannot write an annotation
 * for. `reachable` maps each such name to `{ file, members, from }`, `refs` is EVERY declared type the
 * closure reached (the covered names included) so a reference scan that silently stops matching is a
 * changed count rather than an empty answer, and `walked` lists the names whose bodies were read.
 *
 * TRANSITIVE, and that is the whole point: `maxDepth = 1` over item 6's pre-TMUX-149 fifteen returns
 * FOUR names, because `Evidence` is reachable only THROUGH `ParentProposal`/`PromptProposal`/
 * `SecretShapeProposal`. Three fires carried the one-level answer forward as "4 types / 13 members"
 * before the transitive walk measured 5 / 16 (scratch/ga-fire-2026-09-21-20Z/probe-closure2.log). The
 * depth is a PARAMETER so a case can drive both arms instead of trusting the deep one.
 *
 * `covered` defaults to the seeds and is separate from them since TMUX-151, because DECL_HEAD now reads
 * class heads: a class item 6 declares as a VALUE (`Ledger`, `Monitor`, `Policy`, `Tmux`, …) is a name a
 * consumer CAN write, and the type half alone as the exclude set would report it as one they cannot.
 * reachableFromValues() below has always taken the two separately for this reason.
 */
export function reachableUndeclared(names, root = ROOT, maxDepth = Infinity, covered = names) {
  return walkRefs(shippedTypeMembers(names, root).bodies, names, covered, root, maxDepth);
}

/**
 * The same judgement, seeded from item 6's VALUE half instead of its type half — `{ reachable, refs,
 * walked, missing, kinds }`. `covered` is everything item 6 declares, both halves, because a
 * type the TYPE half already names is one a consumer can annotate: the gap is what a value's signature
 * hands back that item 6 names NOWHERE. `headOnly` and `maxDepth` are the two degraded arms the controls
 * drive — 1 type and 9 types against the 10 the full transitive read finds, on the tree this shipped on.
 */
export function reachableFromValues(values, covered, root = ROOT, maxDepth = Infinity, headOnly = false) {
  const { bodies, kinds, missing } = shippedValueDeclarations(values, root, headOnly);
  return { ...walkRefs(bodies, values, covered, root, maxDepth), missing, kinds };
}

/**
 * Does `code` name `member` in a PROPERTY-shaped position — `.m`, `m:`, `"m"`, a shorthand `, m` mid
 * literal, or `obj["m"]`? The shape is the check: a bare-word scan for `v`, `at`, `ts` or `name` passes
 * on almost any input, so it cannot tell a read from a coincidence. The shorthand alternative is why the
 * first probe of this was wrong — `dist/core/calibrate.js` returns `prompts,` and `secretShapes,` inside
 * an object literal, which is neither `.m` nor `m:`, and a check without it invents two dead fields.
 */
export function honoursMember(member, code) {
  const m = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:\\.${m}\\b|\\b${m}\\s*:|["'\`]${m}["'\`]|[,{(]\\s*${m}\\s*[,}\\n]|\\[["']${m}["']\\])`).test(code);
}
