/**
 * Every spawn of the built tree resolves dist/ from the test file's own directory, never from the
 * process's cwd.
 *
 * Why: a ship's FAIL-first red and a groom's second-hand re-run both copy the parent's dist/ under
 * scratch/<fire>/parent-tree/ (package.json, a node_modules link, the shipped test/) and run the shipped
 * test file THERE. A test that spawns the CLI or the MCP server by a bare string —
 * spawn(process.execPath, ["dist/mcp/server.js"], …) — resolves that string against the PROCESS's cwd,
 * so run from the repo root it drives the tree's (fixed) dist and passes: a green that checked nothing,
 * indistinguishable from a real one. Measured 2026-09-30 18:32–18:37Z on fe21de9
 * (scratch/ga-fire-2026-09-30-18Z/second-hand.log): TMUX-187's MCP case against a parent-tree copy of
 * 0cd6bb1's dist read 1/1 from the tree's cwd and 0/1 from the copy's. Every other suite resolves dist
 * through `join(ROOT, …)` with ROOT built from import.meta.url, and reds correctly on a copy.
 *
 * What the population really was: the card counted "20 sites in 8 files" by grepping the literal
 * `"dist/(bin/tmux-agent|mcp/server).js"` — a grep that also matched `join(ROOT, "dist/…")` arguments,
 * which resolve correctly. Read by call site, the bare spawn literals were FIVE in TWO files:
 * test/mcp.test.js (4 — two spawn()s of the server, two spawnSync()s of the CLI) and test/watch.test.js
 * (1 — `const CLI = "dist/bin/tmux-agent.js"`, spread into every execFile()). The other six of the
 * card's eight already resolved from their own directory.
 *
 * How the detector reads (a static read, TMUX-158's (h) shape, on the TypeScript compiler's parser — a
 * devDependency `npm run lint` already needs; the first cut was a regex tokenizer and it lost sync on the
 * quote characters inside this file's own regex literals, which is exactly how such a scanner also HIDES
 * a real spawn): every call whose callee is the bare identifier of a node:child_process spawner — spawn,
 * spawnSync, execFile, execFileSync, exec, execSync, fork (`orch.spawn(` and a RegExp's `.exec(` are
 * property accesses, not these) — is a finding for every string literal beginning with `dist/` or
 * `./dist/` anywhere in its arguments except inside a `join(`/`resolve(` call, plus every identifier in
 * its arguments whose `const|let|var` initialiser is such a literal or an array literal holding one.
 * A finding names file:line of the literal.
 *
 * Cases:
 *   (a) the detector on planted text — each shape it must catch is caught and named by line (a bare
 *       literal in a spawner's argument array; one behind a constant; one behind an array constant; a
 *       template literal; a "./dist/" spelling; a call spread over lines; a fork()), and each shape it
 *       must pass is passed (join(ROOT, "dist/…") inside the spawn; a constant built with join(); a
 *       readFileSync of the built file; an expected-value object; an assertion message; a RegExp's
 *       .exec(); a commented-out spawn; the same text inside a string; a relative path used only through
 *       join(); an Orchestrator's own spawn()/execSync()).
 *   (b) the guard, over a MEASURED population: every .js/.cjs/.mjs under test/ (the suites, their
 *       helpers and fixtures; not node_modules) is parsed; the two files TMUX-189 fixed are in the
 *       population and each still holds at least one spawner call the parser saw, and the whole
 *       population holds at least 100 (the figure measured when this file was written is in the
 *       message) — so an empty scan is a red, not a pass; zero findings.
 *
 * FAIL-first on the parent 964dc7a (this file copied beside the parent's test/): (b) reds naming
 * test/mcp.test.js:27, :275, :356, :455 and test/watch.test.js:23 — 5 findings in 2 files; on a copy of
 * the fixed tree with one bare literal planted back, (b) reds naming that line. Not this file's
 * business: test/smoke.sh and test/smoke-web.sh, which run from the repo root by design and are never
 * re-run against a parent tree.
 *
 * Run: node --test test/dist-from-file.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_DIR, "..");

/** node:child_process spawners, as a bare callee. */
const SPAWNERS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]);
/** Path builders whose arguments may name dist/ relative to a root — not descended into. */
const BUILDERS = new Set(["join", "resolve"]);

const isDistLiteral = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /^(?:\.\/)?dist\//.test(n.text);
/** `join(…)`, `resolve(…)`, `path.join(…)`: the call whose arguments are root-relative by design. */
const isBuilderCall = (n) => ts.isCallExpression(n)
  && ((ts.isIdentifier(n.expression) && BUILDERS.has(n.expression.text))
    || (ts.isPropertyAccessExpression(n.expression) && BUILDERS.has(n.expression.name.text)));

/** Every dist/ literal under `node`, never descending into a path builder. */
function distLiterals(node, acc = []) {
  if (isBuilderCall(node)) return acc;
  if (isDistLiteral(node)) acc.push(node);
  ts.forEachChild(node, (c) => { distLiterals(c, acc); });
  return acc;
}

/** Identifiers under `node` that name a variable: not `.prop` of a property access, not an object key. */
function variableIdents(node, acc = []) {
  if (ts.isIdentifier(node)) {
    const p = node.parent;
    const isProp = (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node);
    if (!isProp) acc.push(node.text);
  }
  ts.forEachChild(node, (c) => { variableIdents(c, acc); });
  return acc;
}

/**
 * Findings for one file's text: `{ line, what }` per cwd-relative dist/ literal reaching a spawner, plus the
 * number of spawner calls parsed (the population figure the guard asserts on).
 */
export function findings(text) {
  const sf = ts.createSourceFile("scanned.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const decls = new Map();  // variable name -> initializer, whole file first (a use may precede its const in source order)
  const collect = (n) => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.set(n.name.text, n.initializer); ts.forEachChild(n, collect); };
  collect(sf);
  const out = [];
  const seen = new Set();
  const add = (line, what) => { const k = `${line}:${what}`; if (!seen.has(k)) { seen.add(k); out.push({ line, what }); } };
  let calls = 0;
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && SPAWNERS.has(n.expression.text)) {
      const callee = n.expression.text;
      calls++;
      for (const arg of n.arguments) {
        for (const lit of distLiterals(arg)) add(lineOf(lit), `${callee}(… ${JSON.stringify(lit.text)} …)`);
        for (const name of new Set(variableIdents(arg))) {
          const init = decls.get(name);
          if (!init) continue;
          if (isDistLiteral(init)) add(lineOf(init), `${name} = ${JSON.stringify(init.text)}, passed to ${callee}()`);
          else if (ts.isArrayLiteralExpression(init)) for (const lit of distLiterals(init)) add(lineOf(lit), `${name} = [… ${JSON.stringify(lit.text)} …], passed to ${callee}()`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { findings: out, calls };
}

/** Every .js/.cjs/.mjs under test/, recursively, node_modules excluded — the population the guard reads. */
function* walk(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== "node_modules") yield* walk(p); }
    else if (/\.(js|cjs|mjs)$/.test(d.name)) yield p;
  }
}

test("(a) the detector: every cwd-relative shape is caught and named by line; every file-relative or non-spawn shape is passed", () => {
  const caught = [
    ['spawn(process.execPath, ["dist/mcp/server.js"], { stdio: "pipe" });', [1]],
    ['const CLI = "dist/bin/tmux-agent.js";\nexecFile(process.execPath, [CLI, "--help"], cb);', [1]],
    ['const ARGS = ["dist/bin/tmux-agent.js", "status"];\nspawnSync(process.execPath, ARGS);', [1]],
    ["spawnSync(process.execPath, [`dist/bin/tmux-agent.js`]);", [1]],
    ['execFileSync(process.execPath, ["./dist/mcp/server.js"]);', [1]],
    ['const p = spawn(\n  process.execPath,\n  ["dist/mcp/server.js"],\n  { stdio: "pipe" },\n);', [3]],
    ['fork("dist/mcp/server.js");', [1]],
    ["exec('node dist/bin/tmux-agent.js status');\nspawn(process.execPath, ['dist/mcp/server.js']);", [2]],
    ['function cli(args) {\n  return execFile(process.execPath, [CLI, ...args], cb);\n}\nconst CLI = "dist/bin/tmux-agent.js";', [4]],
  ];
  for (const [text, lines] of caught) {
    const r = findings(text);
    assert.deepEqual(r.findings.map((f) => f.line), lines, `planted text not caught where expected: ${JSON.stringify(text)} → ${JSON.stringify(r.findings)}`);
    assert.ok(r.calls >= 1, `no spawner call parsed in ${JSON.stringify(text)}`);
  }
  const passed = [
    'spawn(process.execPath, [join(ROOT, "dist/mcp/server.js")], { stdio: "pipe" });',
    'const CLI = join(ROOT, "dist/bin/tmux-agent.js");\nexecFile(process.execPath, [CLI, "--help"], cb);',
    'const SERVER = path.resolve(ROOT, "dist/mcp/server.js");\nspawn(process.execPath, [SERVER]);',
    'const bin = readFileSync(join(ROOT, "dist/bin/tmux-agent.js"), "utf8");',
    'assert.deepEqual(files, { web: "dist/bin/tmux-agent.js", mcp: "dist/mcp/server.js" });',
    'assert.ok(existsSync(p), "dist/build.json missing — run npm run build");',
    '/x/.exec("dist/mcp/server.js");',
    '// spawn(process.execPath, ["dist/mcp/server.js"]);\n/* spawnSync(process.execPath, ["dist/bin/tmux-agent.js"]) */',
    'const s = `spawn(process.execPath, ["dist/mcp/server.js"])`;\nconst t = "execFile(node, [\\"dist/bin/tmux-agent.js\\"])";',
    'const rel = "dist/core/calibrate.js";\nconst text = readFileSync(join(ROOT, rel), "utf8");',
    'orch.spawn({ name: "x", cwd: tmpdir() });\nawait orch.execSync(NAME, "cat dist/build.json", 500);',
  ];
  for (const text of passed) {
    const r = findings(text);
    assert.deepEqual(r.findings, [], `file-relative or non-spawn text flagged: ${JSON.stringify(text)} → ${JSON.stringify(r.findings)}`);
  }
});

test("(b) guard — no test, helper or fixture under test/ spawns dist/ by a cwd-relative literal; the population is measured, not assumed", () => {
  const perFile = new Map();
  let calls = 0;
  const problems = [];
  for (const p of walk(TEST_DIR)) {
    const rel = relative(ROOT, p);
    const r = findings(readFileSync(p, "utf8"));
    perFile.set(rel, r.calls);
    calls += r.calls;
    for (const f of r.findings) problems.push(`${rel}:${f.line}: ${f.what} — resolves against the process's cwd, not this file's directory; build it with join(ROOT, "dist/…") from import.meta.url`);
  }
  assert.ok(perFile.size >= 60, `parsed only ${perFile.size} files under test/ — an empty scan is not a pass`);
  for (const fixed of ["test/mcp.test.js", "test/watch.test.js"]) {
    assert.ok(perFile.has(fixed), `${fixed} — a file TMUX-189 fixed — is not in the parsed population`);
    assert.ok(perFile.get(fixed) >= 1, `${fixed}: the parser saw no spawner call there, though it spawns the built tree — the read is blind`);
  }
  assert.ok(calls >= 100, `parsed ${calls} spawner calls across test/ (135 across 88 files when this guard was written) — too few for the read to mean anything`);
  assert.deepEqual(problems, [], `cwd-relative dist/ spawns:\n  ${problems.join("\n  ")}`);
});
