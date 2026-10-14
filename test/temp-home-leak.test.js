/**
 * A test file's throwaway TMUX_AGENT_HOME goes when the file's last test goes (TMUX-166 — gate G3 "resource bounds",
 * of the test harness itself; G1 beside it). The sibling of the TMUX-163 socket-file suite (killServerSync): that one closed the
 * socket FILES an isolated tmux server leaves under /tmp/tmux-<uid>; this one closes the HOME DIRECTORIES the fixtures
 * leave directly under /tmp.
 *
 * Measured on the parent 5781e97 (scratch/ga-fire-2026-09-26-04Z/delta-parent.log, each file run ALONE with `ls /tmp |
 * grep -c '^ta-'` read immediately before and after): eleven files left 63 `ta-*` directories per `npm test` —
 * orchestrator 21, unit 12, blackbox 8, waste-since 6, web-remote-bind 4, healthwatch 4, health 3, agnostic-contract 2,
 * exec-timeout 1, foreground 1, root-error-classes 1 — nine of them with no rmSync call in the file at all, and /tmp held
 * 6,447 of them 51 h after the reboot that had wiped it. The fix is one helper, test/helpers/temp-home.js
 * (`tempHome(prefix)` remembers what it made; `removeTempHomes()` removes it), called once per file from an `after()`
 * hook, and one meter, test/helpers/temp-home-meter.sh, that runs a file ALONE under a private empty TMPDIR and reds
 * with the file's name and its count when anything `ta-*` is left. The contract, measured against the REAL files:
 *   (a) the helper: tempHome() makes a directory directly under os.tmpdir() carrying the prefix and remembers it;
 *       removeTempHomes() removes every remembered directory, returns their paths in creation order, and a second call
 *       returns [] — idempotent, so an `after()` hook and a `finally` may both call it;
 *   (b) the meter over a NAMED set — the seven of the eleven that start no tmux server and open no listener
 *       (orchestrator, unit, blackbox, waste-since, healthwatch, health, root-error-classes): exit 0, one `DELTA=0` line per
 *       file with the file named and a non-zero `tests=` count (a `node --test` child that inherits the suite's
 *       NODE_TEST_CONTEXT skips the file and exits 0 in milliseconds — the meter scrubs it and reds `tests=0`), no `left:` line. The other four (exec-timeout, foreground, web-remote-bind,
 *       agnostic-contract) are measured per file on the card and guarded statically by (d) rather than run here: they
 *       start real tmux servers or bind a fixed port (web-remote-bind's 47391 would collide with its own sibling run) and
 *       exec-timeout alone takes 10 s. A named set that is too slow or flaky is a meter the next contributor disables;
 *   (c) the meter FAILS when the property is removed, self-contained: a planted .mjs that mkdtemps `ta-plant-` under
 *       tmpdir() and never removes it reds the meter (exit 1, `DELTA=1 <file>`, `left: ta-plant-…`); the same plant with
 *       the removal added reads DELTA=0 and exit 0 (the control); a plant whose one test FAILS but leaks nothing still
 *       exits 1 — a red test file is not a measured file; a child that runs nothing and exits 0 (planted as a fake node via
 *       TA_NODE — the shape the inherited-context skip leaves) reds `tests=0` — an empty run is not a measurement; and
 *       driven with NODE_TEST_CONTEXT set, the meter still reds the leaker with `tests=1` — the scrub is measured, not assumed;
 *   (d) drift guard (TMUX-158's (h) shape, over a MEASURED population): every file under test/ whose text calls
 *       `mkdtempSync(` or `tempHome(` also calls `rmSync(` or `removeTempHomes(`, and every file that calls `tempHome(`
 *       calls `removeTempHomes(` — the exact call criterion 3 of the card deletes; the population is asserted non-empty
 *       and asserted to contain each of the eleven files named above, so a renamed file is a stale fixture, not a pass.
 *
 * FAIL-first on the parent 5781e97: the meter over the eleven red on all eleven, `DELTA=21 test/orchestrator.test.js` down
 * to `DELTA=1 test/root-error-classes.test.js`, 63 in all (scratch/ga-fire-2026-09-26-04Z/meter-parent.log); (d) reds
 * naming the nine files with no removal call. Output on TMUX-166.
 * The first CI run of the shipped meter (36218630831 on 7f4a4c5) was RED in both node-24 cells and green on 20 and 22: node 24
 * defaults to the `spec` reporter on every destination, so the child's summary read `ℹ tests N`, the meter's `# tests` grep
 * found nothing and every file red `tests=0` — the guard doing its job on a line it could not read. The meter now pins
 * `--test-reporter=tap` and reads either spelling; reproduced and fixed against a local node 24 (scratch/…/node24-*.log).
 *
 * Run: node --test test/temp-home-leak.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempHome, removeTempHomes, pendingTempHomes } from "./helpers/temp-home.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_DIR, "..");
const METER = join(TEST_DIR, "helpers", "temp-home-meter.sh");

/** The seven files (b) runs — fixture-only, no tmux server, no listener — and the four the card measures per file. */
const METERED = [
  "test/orchestrator.test.js", "test/unit.test.js", "test/blackbox.test.js", "test/waste-since.test.js",
  "test/healthwatch.test.js", "test/health.test.js", "test/root-error-classes.test.js",
];
const CARD_ONLY = ["test/exec-timeout.test.js", "test/foreground.test.js", "test/web-remote-bind.test.js", "test/agnostic-contract.test.js"];

after(() => removeTempHomes()); // this file's own plants

/** Run the meter the way a contributor would, rc and stdout together — the wording is the evidence. */
function meter(files, env = {}) {
  try {
    return { rc: 0, out: String(execFileSync("bash", [METER, ...files], { cwd: ROOT, env: { ...process.env, TA_NODE: process.execPath, ...env }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" })) };
  } catch (e) {
    return { rc: e.status, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

test("(a) tempHome() makes and remembers a directory under os.tmpdir(); removeTempHomes() removes every one, in order, and is idempotent", () => {
  const before = pendingTempHomes();
  const a = tempHome("ta-thl-a-");
  const b = tempHome("ta-thl-b-");
  for (const d of [a, b]) {
    assert.equal(dirname(d), tmpdir(), `${d} is not directly under os.tmpdir()`);
    assert.ok(statSync(d).isDirectory(), `${d} is not a directory`);
  }
  assert.ok(basename(a).startsWith("ta-thl-a-") && basename(b).startsWith("ta-thl-b-"), "the prefix is the name's start");
  assert.equal(pendingTempHomes(), before + 2, "both are remembered");
  writeFileSync(join(a, "ledger.jsonl"), "{}\n"); // a non-empty home goes too — the fixtures write into theirs
  assert.deepEqual(removeTempHomes(), [a, b], "returns what it removed, creation order");
  assert.equal(existsSync(a) || existsSync(b), false, "both are gone");
  assert.equal(pendingTempHomes(), 0);
  assert.deepEqual(removeTempHomes(), [], "a second call removes nothing and throws nothing");
});

test("(b) the meter over the named seven — every file reads DELTA=0 and exits 0, nothing left", () => {
  const r = meter(METERED);
  const deltas = [...r.out.matchAll(/^DELTA=(\d+) (\S+) \(before=(\d+) after=(\d+) rc=(\d+) tests=(\d+)\)$/gm)];
  assert.equal(deltas.length, METERED.length, `one DELTA= line per file, got:\n${r.out}`);
  for (const [, delta, file, , , rc, tests] of deltas) {
    assert.ok(METERED.includes(file), `${file} is not a file this case named`);
    assert.ok(Number(tests) > 0, `${file} ran ${tests} tests under the meter — an empty run measures nothing (NODE_TEST_CONTEXT inherited?):\n${r.out}`);
    assert.equal(Number(rc), 0, `${file} exited ${rc} under the meter — a red file is not a measured file:\n${r.out}`);
    assert.equal(Number(delta), 0, `${file} left ${delta} ta-* directories under its private TMPDIR:\n${r.out}`);
  }
  assert.equal(r.out.includes("left:"), false, `something was left behind:\n${r.out}`);
  assert.equal(r.rc, 0, `meter exit ${r.rc}:\n${r.out}`);
});

test("(c) the meter FAILS when the property is removed — a planted leaker reds with its name and count, its control reads 0, a red child is not a measured file", () => {
  const plantDir = tempHome("ta-thl-plant-");
  const write = (name, body) => { const p = join(plantDir, name); writeFileSync(p, body); return p; };
  const head = 'import { test } from "node:test";\nimport { mkdtempSync, rmSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\n';
  const leaker = write("leaker.test.mjs", head + 'test("leaks", () => { mkdtempSync(join(tmpdir(), "ta-plant-")); });\n');
  const control = write("control.test.mjs", head + 'test("cleans", () => { const d = mkdtempSync(join(tmpdir(), "ta-plant-")); rmSync(d, { recursive: true, force: true }); });\n');
  const red = write("red.test.mjs", head + 'test("fails but leaks nothing", () => { throw new Error("planted failure"); });\n');

  const r1 = meter([leaker]);
  assert.equal(r1.rc, 1, `a leaking file must red the meter:\n${r1.out}`);
  assert.match(r1.out, new RegExp(`^DELTA=1 ${leaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(before=0 after=1 rc=0 tests=1\\)$`, "m"), `the red names the file and its count:\n${r1.out}`);
  assert.match(r1.out, /^ {2}left: ta-plant-\S+ $/m, `the red names what was left:\n${r1.out}`);

  const r2 = meter([control]);
  assert.equal(r2.rc, 0, `the control must pass:\n${r2.out}`);
  assert.match(r2.out, /^DELTA=0 \S+control\.test\.mjs \(before=0 after=0 rc=0 tests=1\)$/m, r2.out);
  assert.equal(r2.out.includes("left:"), false, r2.out);

  const r3 = meter([red]);
  assert.equal(r3.rc, 1, `a failing test file must red the meter even with nothing left:\n${r3.out}`);
  assert.match(r3.out, /^DELTA=0 \S+red\.test\.mjs \(before=0 after=0 rc=1 tests=1\)$/m, r3.out);

  // a child that runs NOTHING and exits 0 — the shape `node --test` takes when it inherits NODE_TEST_CONTEXT (a warning, no TAP
  // summary, exit 0). node counts even an empty loadable file as one test, so the shape is planted at the binary: a fake node.
  const fakeNode = write("fake-node", "#!/bin/sh\nexit 0\n");
  chmodSync(fakeNode, 0o755);
  const r4 = meter([control], { TA_NODE: fakeNode });
  assert.equal(r4.rc, 1, `a child that ran no test must red the meter:\n${r4.out}`);
  assert.match(r4.out, /^DELTA=0 \S+control\.test\.mjs \(before=0 after=0 rc=0 tests=0\)$/m, r4.out);
  assert.match(r4.out, /^ {2}tests=0: the file ran nothing/m, r4.out);

  // and the scrub itself: driven with NODE_TEST_CONTEXT set the way a runner above sets it, the meter still measures
  const r5 = meter([leaker], { NODE_TEST_CONTEXT: "child-v8" });
  assert.equal(r5.rc, 1, `under an inherited NODE_TEST_CONTEXT the meter must still red the leaker:\n${r5.out}`);
  assert.match(r5.out, /^DELTA=1 \S+leaker\.test\.mjs \(before=0 after=1 rc=0 tests=1\)$/m, `the child ran and leaked — the context was scrubbed:\n${r5.out}`);

  // and the plants' own leftovers were confined to the meter's private root, which it removed: nothing `ta-plant-` under ours
  assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.startsWith("ta-plant-")), [], "the meter's private root leaked into the real tmpdir");
});

test("(d) drift guard — every test file that makes a temp home also removes one; every tempHome() caller calls removeTempHomes(); the eleven are in the population", () => {
  const files = readdirSync(TEST_DIR).filter((f) => f.endsWith(".test.js")).map((f) => `test/${f}`);
  const population = files.filter((f) => /\b(mkdtempSync|tempHome)\(/.test(readFileSync(join(ROOT, f), "utf8")));
  assert.ok(population.length > 0, "no test file makes a temp directory — the population this guard measures is gone");
  for (const f of [...METERED, ...CARD_ONLY]) {
    assert.ok(population.includes(f), `fixture stale: ${f} no longer makes a temp home (renamed, or its fixture rewritten) — name its successor here`);
  }
  const noRemoval = population.filter((f) => !/\b(rmSync|removeTempHomes)\(/.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(noRemoval, [], `these files make a temp directory and never remove one: ${noRemoval.join(", ")}`);
  const helperUsers = population.filter((f) => /\btempHome\(/.test(readFileSync(join(ROOT, f), "utf8")));
  assert.ok(helperUsers.length >= METERED.length, `tempHome() callers: ${helperUsers.length}`);
  const forgot = helperUsers.filter((f) => !/\bremoveTempHomes\(/.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(forgot, [], `these files call tempHome() and never removeTempHomes(): ${forgot.join(", ")}`);
});
