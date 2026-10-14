/**
 * CONTRIBUTING.md, SECURITY.md and docs/THREAT-MODEL.md are CHECKED contracts, not descriptions
 *. README.md became one in TMUX-84 — and it sends a stranger on to exactly these two
 * root pages (README.md:217 → CONTRIBUTING for the six design rules, README.md:230 → SECURITY for
 * how to report), and SECURITY sends a reporter on to the threat model. Gate G6 (Docs) / KR3 and
 * gate G2 (Security) / KR2 stand on them being true.
 *
 * Measured 2026-09-11 against the built tree on 8af5a10: CONTRIBUTING.md:9 promised a "10-step"
 * smoke where test/smoke.sh has run 16 steps since 32fe705; CONTRIBUTING.md:12 said `node >= 18`
 * where engines.node is `>=20` (ae613a3 — a stranger on node 18 is told they are supported and
 * gets a red suite); CONTRIBUTING.md:48 said CI runs `node 18/20/22` where ci.yml is
 * [ubuntu-latest, macos-latest] × [20, 22, 24]; SECURITY.md:29-30 listed "configurable redaction
 * rules" as a known gap two weeks after lexicon.json `redact[]` shipped (6c5ae8d) — the security
 * page told a reporter a control does not exist. No test read any of the three pages
 * (`grep -ln 'CONTRIBUTING\|SECURITY' test/` → one comment and the SECURITY: step labels), so
 * nothing went red. Same class as TMUX-82 (CHANGELOG), TMUX-83 (VERSIONING), TMUX-84 (README).
 *
 * This file parses the three pages AS DATA (and, since TMUX-174, the one line of VERSIONING.md that
 * names a CI matrix) and asserts, against the built artefacts and the suites themselves:
 *  (a) CONTRIBUTING's node floor ≡ package.json engines.node;
 *  (b) CONTRIBUTING's CI matrix (os × node) ≡ the os×node `test` job in .github/workflows/ci.yml,
 *      both directions;
 *  (c) no N-step / suite-count / coverage literal on CONTRIBUTING — the numbers live in
 *      docs/TESTING.md's measured table, which the page points at instead;
 *  (d) on CONTRIBUTING and SECURITY: every backticked `src/…` path exists and every `symbol()`,
 *      `src/path.ts#member`, PascalCase type and `a.b` ledger event resolves in the built dist/
 *      declarations; on all three pages every relative link resolves, every `npm run <script>`
 *      exists and every `test/…` file named exists;
 *  (e) CONTRIBUTING's isolation promise (socket name, temp TMUX_AGENT_HOME) ≡ test/smoke.sh;
 *  (f) SECURITY's "known gaps" sentence is a LEDGER: each listed gap maps to a code probe and the
 *      test FAILS when a listed gap has shipped — a shipped control may not be described as
 *      missing, and must be described somewhere on the page;
 *  (g) the findings count SECURITY and THREAT-MODEL state ≡ the `### N.` headings under
 *      THREAT-MODEL's Findings section;
 *  (h) THREAT-MODEL's attack-class case count ≡ the test("guard: cases in test/unit.test.js, and
 *      its "web-smoke steps N–M" / "`smoke.sh` step N" are exactly the steps whose titles carry
 *      the CSRF block / the cross-contamination race — both directions;
 *  (i) VERSIONING.md's Node line: the majors it names as tested in CI ≡ ci.yml's node matrix (and
 *      its platforms ≡ the os matrix), both directions, through the SAME matrix reader as (b).
 *      Added by TMUX-174 (2026-09-29): the line's policy — "current, active, and maintenance LTS" —
 *      had been untrue since Node 26 went current on 2026-05-05 with no CI cell, and no test could
 *      say so; a policy sentence cannot be read against a release calendar, a list beside it can
 *      be read against ci.yml.
 *
 * BANLIST discipline: an empty parsed list is a hard failure, never a vacuous pass; and the check
 * was watched FAIL first on the untouched pages (CONTRIBUTING.md:9/12/48, SECURITY.md:30 — with
 * the THREAT-MODEL assertions green on the untouched doc, which proves it true rather than merely
 * unread) before the reconciliation that made it pass — output on TMUX-85.
 *
 * Run: node --test test/root-docs-contract.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSameSet } from "./helpers/mcp-contract.js";
import { shippedEventTypes } from "./helpers/ledger-events.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const PAGES = {
  "CONTRIBUTING.md": read("CONTRIBUTING.md"),
  "SECURITY.md": read("SECURITY.md"),
  "docs/THREAT-MODEL.md": read("docs/THREAT-MODEL.md"),
};
const CONTRIB = PAGES["CONTRIBUTING.md"];
// one line of VERSIONING.md is a contract HERE — (i), the CI matrix; the rest of the page is
// test/versioning-contract.test.js's. Not in PAGES: the link / script / test-file sweep stays theirs.
const VERSIONING = read("VERSIONING.md");
const SECURITY = PAGES["SECURITY.md"];
const THREAT = PAGES["docs/THREAT-MODEL.md"];
const lines = (text) => text.split("\n");

/** Every `backticked` token in a run of text. */
function ticks(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function nonEmpty(list, what, page) {
  assert.ok(list.length > 0, `parsed ZERO ${what} from ${page} — an empty contract is a hard failure, not a pass`);
  return list;
}

/** "page:N" of the first line matching re (1-indexed) so a failure names where to edit. */
function cite(page, re, text = PAGES[page]) {
  const i = lines(text).findIndex((l) => re.test(l));
  return i === -1 ? page : `${page}:${i + 1}`;
}

/** Body of the `## heading` section whose heading starts with prefix, up to the next `## `. */
function section(text, prefix, page) {
  const L = lines(text);
  const start = L.findIndex((l) => l.startsWith(prefix));
  assert.ok(start > -1, `${page} must keep its "${prefix}" section`);
  let end = L.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = L.length;
  return L.slice(start + 1, end).join("\n");
}

/** `step "N. title"` lines of a smoke script → Map(N → title). Both smoke scripts label steps this way. */
function smokeSteps(script) {
  const steps = new Map([...read(script).matchAll(/^step "(\d+)\. ([^"]*)"/gm)].map((m) => [Number(m[1]), m[2]]));
  assert.ok(steps.size > 0, `parsed ZERO step "N. title" lines from ${script} — cannot check a step reference against nothing`);
  return steps;
}

/** Built declarations keyed by the src path they came from ("src/core/tmux.ts" → dist/core/tmux.d.ts text). */
function declarations() {
  const out = new Map();
  const walk = (dir) => {
    for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".d.ts")) out.set(rel.replace(/^dist\//, "src/").replace(/\.d\.ts$/, ".ts"), readFileSync(join(ROOT, rel), "utf8"));
    }
  };
  walk("dist");
  assert.ok(out.size > 0, "found no dist/**/*.d.ts — is the tree built?");
  return out;
}

/** Every src/**\/*.ts concatenated (and the src/mcp/ subset) — the observable for "has control X shipped". */
function sources() {
  const out = { all: "", mcp: "" };
  const walk = (dir) => {
    for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".ts")) {
        const text = readFileSync(join(ROOT, rel), "utf8");
        out.all += text;
        if (rel.startsWith("src/mcp/")) out.mcp += text;
      }
    }
  };
  walk("src");
  assert.ok(out.all.length > 0 && out.mcp.length > 0, "read no src/**/*.ts (or no src/mcp/) — cannot probe for shipped controls against nothing");
  return out;
}

/** Names a .d.ts exports: declarations plus `export { a, b as c }` re-export lists. */
function exportedNames(dts) {
  return [
    ...[...dts.matchAll(/^export (?:declare )?(?:abstract )?(?:function|class|const|let|var|type|interface|enum) (\w+)/gm)].map((m) => m[1]),
    ...[...dts.matchAll(/^export (?:type )?\{([^}]*)\}/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
  ];
}

/** A public class member `name(` / `name<` / `name:` at member indentation in a .d.ts (private members carry no signature and are not a contract). */
function hasMember(dts, name) {
  return new RegExp(`^\\s+(?:(?:static|readonly|get|set|protected|public|abstract)\\s+)*${name}\\s*[(<:?]`, "m").test(dts);
}

/**
 * The `test` job's os × node matrix in .github/workflows/ci.yml — the ONE reader for every page
 * that declares it ((b) CONTRIBUTING, (i) VERSIONING): two copies of these regexes is how two
 * pages end up judged against different matrices (the TMUX-126 lesson, one reader per vocabulary).
 * No YAML dependency: the `test:` job block runs up to the next 2-space-indented job header. The
 * os names come back without their `-latest` suffix — the pages name the platform, not the runner.
 */
function ciTestMatrix() {
  const job = /^  test:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:$)/m.exec(read(".github/workflows/ci.yml"));
  assert.ok(job, "ci.yml must keep its `test:` job (the os×node matrix)");
  const os = /^\s+os: \[([^\]]*)\]/m.exec(job[1]);
  const node = /^\s+node: \[([^\]]*)\]/m.exec(job[1]);
  assert.ok(os && node, "ci.yml's test job must carry a matrix with `os: [...]` and `node: [...]`");
  const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return {
    os: nonEmpty(list(os[1]), "os entries", "ci.yml test.strategy.matrix.os").map((o) => o.replace(/-latest$/, "")),
    node: nonEmpty(list(node[1]), "node majors", "ci.yml test.strategy.matrix.node"),
  };
}

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const toNumber = (w) => WORD_NUMBERS[w.toLowerCase()] ?? (/^\d+$/.test(w) ? Number(w) : NaN);

// ---------------------------------------------------------------------------------------------
// (a) node floor ≡ engines.node
// ---------------------------------------------------------------------------------------------
test("root-docs: CONTRIBUTING's node floor equals package.json engines.node", () => {
  const stated = nonEmpty([...CONTRIB.matchAll(/\bnode (>=\s*[\d.]+)/g)].map((m) => m[1].replace(/\s+/g, "")), "node floor statements (`node >= N`)", "CONTRIBUTING.md");
  const engines = JSON.parse(read("package.json")).engines?.node?.replace(/\s+/g, "");
  assert.ok(engines, "package.json must declare engines.node");
  const wrong = stated.filter((s) => s !== engines);
  assert.deepEqual(wrong, [], `${cite("CONTRIBUTING.md", /\bnode >=/)} says node ${wrong.join(", ")} but package.json engines.node is ${engines} — a stranger on an unsupported node is told they are supported and gets a red suite`);
});

// ---------------------------------------------------------------------------------------------
// (b) CI matrix ≡ ci.yml's os×node job, both directions
// ---------------------------------------------------------------------------------------------
test("root-docs: CONTRIBUTING's CI matrix (os × node) equals the test job's matrix in .github/workflows/ci.yml, both directions", () => {
  const m = /CI \(([^)]*?) × node ([0-9/]+)\)/.exec(CONTRIB);
  assert.ok(m, "CONTRIBUTING.md must state its CI matrix as `CI (<os> + <os> × node N/N/N)`");
  const docOs = nonEmpty(m[1].split("+").map((s) => s.trim()).filter(Boolean), "CI os names", "CONTRIBUTING.md");
  const docNode = nonEmpty(m[2].split("/").filter(Boolean), "CI node versions", "CONTRIBUTING.md");
  const ci = ciTestMatrix();
  const where = cite("CONTRIBUTING.md", /CI \(/);
  assertSameSet(docOs, ci.os, { declaredAs: `${where} (os)`, liveAs: "ci.yml test.strategy.matrix.os" });
  assertSameSet(docNode, ci.node, { declaredAs: `${where} (node)`, liveAs: "ci.yml test.strategy.matrix.node" });
});

// ---------------------------------------------------------------------------------------------
// (c) no step / suite-count / coverage literals — they drift every fire; TESTING's table is restamped
// ---------------------------------------------------------------------------------------------
test("root-docs: CONTRIBUTING carries no step / suite-count / coverage literal and points at docs/TESTING.md for the measured numbers", () => {
  const STEP = /\b\d+-step\b/;
  const COUNT = /\b\d+ (?:unit|smoke|web-smoke|checks|acceptance criteria|steps)\b/;
  const PCT = /\d+(?:\.\d+)?% (?:lines|branches|functions)\b/;
  const hits = lines(CONTRIB).map((l, i) => (STEP.test(l) || COUNT.test(l) || PCT.test(l)) ? `CONTRIBUTING.md:${i + 1}: ${l.trim()}` : null).filter(Boolean);
  assert.deepEqual(hits, [], `CONTRIBUTING carries suite literals that drift every fire — point at docs/TESTING.md's measured table instead:\n${hits.join("\n")}`);
  assert.ok(/\(docs\/TESTING\.md\)/.test(CONTRIB), "CONTRIBUTING.md must link docs/TESTING.md, where the suite layers and their measured counts live");
});

// ---------------------------------------------------------------------------------------------
// (d) names resolve against the built declarations; links / scripts / test files resolve in the repo
// ---------------------------------------------------------------------------------------------
test("root-docs: every src/ path, symbol(), path#member, type and ledger event named on CONTRIBUTING and SECURITY resolves in the repo and the built declarations", () => {
  const decls = declarations();
  const exportsAll = new Set([...decls.values()].flatMap(exportedNames));
  // one reader for the vocabulary, shared with test/versioning-contract.test.js: two
  // copies of this regex is how two pages end up judged against different sets of event types
  const events = new Set(shippedEventTypes());
  assert.ok(exportsAll.size > 0, "built declarations export nothing — is the tree built?");

  const problems = [];
  let checked = 0;
  for (const page of ["CONTRIBUTING.md", "SECURITY.md"]) {
    lines(PAGES[page]).forEach((line, i) => {
      const where = `${page}:${i + 1}`;
      for (const tok of ticks(line)) {
        if (tok.startsWith("src/")) {                                          // `src/core/tmux.ts#exec`, `src/adapters/`
          const [path, member] = tok.split("#");
          checked++;
          if (!existsSync(join(ROOT, path))) { problems.push(`${where}: \`${path}\` does not exist`); continue; }
          if (!member) continue;
          const dts = decls.get(path);
          if (!dts) problems.push(`${where}: \`${tok}\` — no built declaration for ${path}`);
          else if (!exportedNames(dts).includes(member) && !hasMember(dts, member)) problems.push(`${where}: \`${tok}\` — ${member} is neither exported by nor a public class member of its built declaration`);
        } else if (/^\w+\(\)$/.test(tok)) {                                    // `redact()`, `sessionTarget()`
          checked++;
          const name = tok.slice(0, -2);
          if (!exportsAll.has(name)) problems.push(`${where}: \`${tok}\` is not exported by any built dist/ module`);
        } else if (/^[A-Z][A-Za-z0-9]+$/.test(tok)) {                          // `EventType`, `Policy` — the design rules' vocabulary
          checked++;
          if (!exportsAll.has(tok)) problems.push(`${where}: \`${tok}\` is not an exported type or class in the built declarations`);
        } else if (/^[a-z]+\.[a-z-]+$/.test(tok) && !/\.(?:json|md|ts|js|sh|ya?ml)$/.test(tok)) {  // `control.denied`
          checked++;
          if (!events.has(tok)) problems.push(`${where}: \`${tok}\` is not an EventType in dist/core/ledger.d.ts`);
        }
      }
    });
  }
  assert.ok(checked > 0, "checked ZERO names across CONTRIBUTING.md and SECURITY.md — an empty contract is a hard failure, not a pass");
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("root-docs: every relative link resolves, every npm run <script> exists, and every test/ file named exists — on all three pages", () => {
  const scripts = JSON.parse(read("package.json")).scripts ?? {};
  const problems = [];
  let links = 0, runs = 0, tests = 0;
  for (const [page, text] of Object.entries(PAGES)) {
    const base = dirname(page);   // docs/THREAT-MODEL.md links resolve relative to docs/
    lines(text).forEach((line, i) => {
      const where = `${page}:${i + 1}`;
      for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(?:[a-z][a-z+.-]*:|#)/.test(m[1])) continue;
        links++;
        if (!existsSync(join(ROOT, base, m[1].split("#")[0]))) problems.push(`${where}: link ${m[1]} resolves to nothing in the repo`);
      }
      for (const m of line.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
        runs++;
        if (!(m[1] in scripts)) problems.push(`${where}: npm run ${m[1]} is not a script in package.json`);
      }
      for (const t of ticks(line)) {
        if (!t.startsWith("test/")) continue;
        tests++;
        if (!existsSync(join(ROOT, t))) problems.push(`${where}: \`${t}\` does not exist`);
      }
    });
  }
  assert.ok(links > 0 && runs > 0 && tests > 0, `parsed ZERO of a kind (links ${links}, npm run ${runs}, test/ files ${tests}) — an empty contract is a hard failure, not a pass`);
  assert.deepEqual(problems, [], problems.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// (e) the isolation promise ≡ what test/smoke.sh actually does
// ---------------------------------------------------------------------------------------------
test("root-docs: CONTRIBUTING's isolation promise matches test/smoke.sh — the socket name and a temp TMUX_AGENT_HOME", () => {
  const sh = read("test/smoke.sh");
  const socket = /^SOCKET="([^"]+)"$/m.exec(sh);
  assert.ok(socket, 'test/smoke.sh must set SOCKET="..." at top level');
  const stated = /socket `([^`]+)`/.exec(CONTRIB);
  assert.ok(stated, "CONTRIBUTING.md must state the smoke socket as socket `name`");
  assert.equal(stated[1], socket[1], `${cite("CONTRIBUTING.md", /socket `/)} says the smoke runs on socket ${stated[1]} but test/smoke.sh sets SOCKET="${socket[1]}"`);
  assert.ok(/temp `TMUX_AGENT_HOME`/.test(CONTRIB), "CONTRIBUTING.md must promise a temp `TMUX_AGENT_HOME` — the other half of never touching the reader's own state");
  assert.ok(/^export TMUX_AGENT_HOME="\$\(mktemp -d\)"$/m.test(sh), 'test/smoke.sh must export TMUX_AGENT_HOME="$(mktemp -d)" — CONTRIBUTING promises a temp home');
});

// ---------------------------------------------------------------------------------------------
// (f) the known-gaps sentence is a ledger
// ---------------------------------------------------------------------------------------------
/**
 * One probe per gap SECURITY.md may list. `shipped` looks at the built declarations / src for the
 * control the gap describes; `described` is what the page must then say about it instead. A
 * listed gap with no probe is itself a failure, so the ledger stays complete. One direction only:
 * a gap that is real but unlisted cannot be enumerated by a test.
 */
const GAP_PROBES = [
  { gap: /redaction/i, control: "configurable redaction rules — LexiconConfig.redact[] in dist/core/lexicon.d.ts (lexicon.json redact[], 6c5ae8d, 2026-08-26)",
    shipped: (decls) => /^\s+redact\??:/m.test(decls.get("src/core/lexicon.ts") ?? ""), described: /lexicon\.json/ },
  { gap: /rate limits?/i, control: "rate limits on send/exec — an identifier matching rateLimit|throttle in src/",
    shipped: (decls, src) => /\b(?:rateLimit|throttle)/.test(src.all), described: /rate.?limit/i },
  { gap: /per-client|MCP identity/i, control: "per-client MCP identity — clientId|clientInfo|perClient in src/mcp/",
    shipped: (decls, src) => /\b(?:clientId|clientInfo|perClient)\b/.test(src.mcp), described: /per-client/i },
];

test("root-docs: SECURITY's known-gaps sentence is a ledger — a gap that has shipped may not be listed as missing, and every listed gap has a probe", () => {
  const paras = SECURITY.split(/\n[ \t]*\n/);
  const para = paras.find((p) => /^Hardening gaps we know about/.test(p));
  assert.ok(para, 'SECURITY.md must keep its "Hardening gaps we know about ..." sentence — the ledger of controls that do NOT exist yet');
  const listed = nonEmpty(
    para.replace(/\s+/g, " ").split(":").slice(1).join(":").replace(/\.\s*$/, "").split(/,\s*(?:and\s+)?|\s+and\s+/).map((s) => s.trim()).filter(Boolean),
    "known gaps", "SECURITY.md");
  const decls = declarations();
  const src = sources();
  const problems = [];
  for (const gap of listed) {
    // cite the line the gap's own words sit on (the sentence wraps), falling back to its first line
    const words = gap.split(" ").slice(0, 2).join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let where = cite("SECURITY.md", new RegExp(words));
    if (where === "SECURITY.md") where = cite("SECURITY.md", /^Hardening gaps/);
    const probe = GAP_PROBES.find((p) => p.gap.test(gap));
    if (!probe) { problems.push(`${where}: listed gap "${gap}" has no probe in GAP_PROBES — add one so the ledger can go red when it ships`); continue; }
    if (probe.shipped(decls, src)) problems.push(`${where}: lists "${gap}" as a known gap, but it has shipped (${probe.control}) — a shipped control may not be described as missing`);
  }
  // the other direction: a shipped control must be DESCRIBED on the page, not merely un-listed
  for (const p of GAP_PROBES) {
    if (p.shipped(decls, src) && !p.described.test(SECURITY)) problems.push(`SECURITY.md: ${p.control} has shipped but the page never describes it (expected ${p.described})`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// (g) findings count ≡ numbered headings
// ---------------------------------------------------------------------------------------------
test("root-docs: the findings count SECURITY and THREAT-MODEL state equals the numbered ### headings under THREAT-MODEL's Findings", () => {
  const headings = nonEmpty([...section(THREAT, "## Findings", "docs/THREAT-MODEL.md").matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1])), "`### N.` finding headings", "docs/THREAT-MODEL.md");
  assert.deepEqual(headings, headings.map((_, i) => i + 1), `THREAT-MODEL's findings must be numbered 1..N in order (got ${headings.join(", ")})`);
  const stated = nonEmpty([
    ...[...SECURITY.matchAll(/all (\w+) findings/g)].map((m) => ({ where: cite("SECURITY.md", new RegExp(m[0])), n: m[1] })),
    ...[...THREAT.matchAll(/all (\w+) came from attacking|of the (\w+) findings/g)].map((m) => ({ where: cite("docs/THREAT-MODEL.md", new RegExp(m[0])), n: m[1] ?? m[2] })),
  ], "findings-count statements", "SECURITY.md + docs/THREAT-MODEL.md");
  const wrong = stated.filter((s) => toNumber(s.n) !== headings.length).map((s) => `${s.where}: says ${s.n}`);
  assert.deepEqual(wrong, [], `stated findings count ≠ the ${headings.length} numbered headings:\n${wrong.join("\n")}`);
});

// ---------------------------------------------------------------------------------------------
// (h) THREAT-MODEL's cross-references name the suites' actual cases and steps
// ---------------------------------------------------------------------------------------------
test("root-docs: THREAT-MODEL's cross-references point at the suites — attack-class case count, web-smoke step range, smoke.sh step number (both directions)", () => {
  const problems = [];
  // "11 attack-class unit cases (`test/unit.test.js`)" ≡ the guard: cases in that file
  const cases = /(\d+) attack-class unit cases \(`test\/unit\.test\.js`\)/.exec(THREAT);
  assert.ok(cases, 'THREAT-MODEL must state "N attack-class unit cases (`test/unit.test.js`)"');
  const guards = (read("test/unit.test.js").match(/^\s*test\(["']guard:/gm) ?? []).length;
  assert.ok(guards > 0, 'found no test("guard: cases in test/unit.test.js — the executable threat model is gone');
  if (Number(cases[1]) !== guards) problems.push(`${cite("docs/THREAT-MODEL.md", /attack-class unit cases/)}: says ${cases[1]} attack-class unit cases; test/unit.test.js has ${guards} test("guard: cases`);

  // "web-smoke steps 11–14" ≡ exactly the steps titled CSRF / Sec-Fetch-Site / rebinding / same-origin
  const range = /web-smoke steps (\d+)[–-](\d+)/.exec(THREAT);
  assert.ok(range, 'THREAT-MODEL must cite "web-smoke steps N–M"');
  const lo = Number(range[1]), hi = Number(range[2]);
  assert.ok(hi >= lo, `web-smoke step range ${lo}–${hi} is empty`);
  const CSRF = /CSRF|Sec-Fetch|rebinding|same-origin/;
  const cited = Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i));
  const actual = [...smokeSteps("test/smoke-web.sh")].filter(([, t]) => CSRF.test(t)).map(([n]) => String(n));
  try {
    assertSameSet(cited, actual, { declaredAs: `${cite("docs/THREAT-MODEL.md", /web-smoke steps/)} (web-smoke steps ${lo}–${hi})`, liveAs: `the test/smoke-web.sh steps titled ${CSRF}` });
  } catch (e) { problems.push(e.message); }

  // "`smoke.sh` step 11" ≡ exactly the cross-contamination race
  const one = /`smoke\.sh` step (\d+)/.exec(THREAT);
  assert.ok(one, 'THREAT-MODEL must cite "`smoke.sh` step N"');
  const RACE = /cross-contaminat/;
  const race = [...smokeSteps("test/smoke.sh")].filter(([, t]) => RACE.test(t)).map(([n]) => String(n));
  try {
    assertSameSet([one[1]], race, { declaredAs: `${cite("docs/THREAT-MODEL.md", /`smoke\.sh` step/)} (smoke.sh step ${one[1]})`, liveAs: `the test/smoke.sh steps titled ${RACE}` });
  } catch (e) { problems.push(e.message); }

  assert.deepEqual(problems, [], problems.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// (i) VERSIONING's Node line ≡ ci.yml's test matrix, both directions
// ---------------------------------------------------------------------------------------------
test("root-docs: VERSIONING's Node line names the majors tested in CI, and that list equals the test job's node matrix in .github/workflows/ci.yml, both directions", () => {
  const body = section(VERSIONING, "## Node and tmux support", "VERSIONING.md");
  // the bullet runs from `- **Node:**` to the next `- **` bullet (or the section's end)
  const bullet = /^- \*\*Node:\*\*([\s\S]*?)(?=^- \*\*|(?![\s\S]))/m.exec(body);
  assert.ok(bullet, 'VERSIONING.md\'s "Node and tmux support" section must keep its `- **Node:**` bullet — the policy sentence the tested list sits beside');
  const policy = cite("VERSIONING.md", /^- \*\*Node:\*\*/, VERSIONING);
  const m = /tested in CI: ([0-9][0-9, ]*) \(([^)]+)\)/.exec(bullet[1]);
  assert.ok(m, `${policy} must name the majors tested in CI beside the policy sentence, as \`tested in CI: N, N, N (ubuntu + macOS)\` — "current, active, and maintenance LTS" is a promise no test can read against the Node release calendar (it was untrue from 2026-05-05, when Node 26 went current with no CI cell, until TMUX-174); the list is what this test reads against ci.yml test.strategy.matrix.node`);
  const docNode = nonEmpty(m[1].split(",").map((s) => s.trim()).filter(Boolean), "tested Node majors", "VERSIONING.md");
  const docOs = nonEmpty(m[2].split("+").map((s) => s.trim().toLowerCase()).filter(Boolean), "tested platforms", "VERSIONING.md");
  const ci = ciTestMatrix();
  const where = cite("VERSIONING.md", /tested in CI:/, VERSIONING);
  assertSameSet(docNode, ci.node, { declaredAs: `${where} (tested in CI)`, liveAs: "ci.yml test.strategy.matrix.node" });
  assertSameSet(docOs, ci.os.map((o) => o.toLowerCase()), { declaredAs: `${where} (platforms)`, liveAs: "ci.yml test.strategy.matrix.os" });
});
