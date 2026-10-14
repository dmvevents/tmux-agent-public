/**
 * State-classification ACCURACY — GA card TMUX-69 (north-star run-2 finding F7).
 *
 * test/profiles.test.js proves the plumbing (a profile loads and fires). This proves the profiles
 * are RIGHT: it grades the built-in profile chain against a labelled corpus of REAL captured pane
 * tails (test/fixtures/state-corpus.json) and enforces a hard floor.
 *
 * Why a floor and not just a number: a wrong-but-plausible classification is the "plausible fake by
 * design" that the project's non-negotiables forbid. The single worst output this tool can produce
 * is a session that is WAITING ON A HUMAN (BLOCKED) or STUCK ERRORING (ERROR) reported as calm —
 * a supervisor would never learn to intervene. So BLOCKED and ERROR recall are floored at 100%, and
 * any NEW misclassification (a tail whose id is not on the documented allow-list) fails the suite
 * until it is fixed or explicitly, visibly accepted. Safety-critical classes can never be accepted.
 *
 * The corpus grows with every misclassification found in the wild (regression per incident).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveProfiles } from "../dist/core/monitor.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "fixtures", "state-corpus.json"), "utf8"));
const fixtures = corpus.fixtures;

// The states where a false "calm" reading is the worst failure mode: a human is waiting, or the
// CLI is wedged, and the operator is told nothing is wrong. Recall on these is floored at 100%.
const SAFETY_CRITICAL = new Set(["BLOCKED", "ERROR"]);

// Documented WORKING/IDLE boundary edges the built-in profiles currently get wrong. An id may sit
// here ONLY if its expected state is NOT safety-critical (guarded below). Each entry is a debt:
// the follow-up is to teach the profile the distinction, then delete the id from this set.
//   claude-completion-summary-idle — a past-tense "✻ Cogitated for 20m 8s" completion summary left
//     on an idle pane trips the claude profile's bare-✻ WORKING rule. Tracked for a profile fix.
const ALLOWED_MISSES = new Set(["claude-completion-summary-idle"]);

/**
 * Mirror Monitor.snapshot()'s classification EXACTLY: try the built-in profile chain in order, the
 * first profile with any opinion wins, and a non-dead pane with no opinion defaults to IDLE
 * (monitor.ts: `if (!state) state = "IDLE"`). No lexicon overrides — this is the stock install.
 */
const chain = resolveProfiles({});
function classify(tail) {
  const p = chain.find((prof) => prof.classify(tail) !== null);
  return p ? p.classify(tail) : "IDLE";
}

// grade the whole corpus once; individual tests read from these results
const graded = fixtures.map((f) => ({ ...f, got: classify(f.tail) }));
const misses = graded.filter((g) => g.got !== g.expected);
const correct = graded.length - misses.length;
const accuracy = correct / graded.length;

function recall(state) {
  const rel = graded.filter((g) => g.expected === state);
  if (rel.length === 0) return { hit: 0, total: 0, value: 1 };
  const hit = rel.filter((g) => g.got === state).length;
  return { hit, total: rel.length, value: hit / rel.length };
}

test("corpus is real, labelled, and covers every classifiable state", () => {
  assert.ok(fixtures.length >= 10, `corpus too thin (${fixtures.length}); needs breadth to mean anything`);
  for (const f of fixtures) {
    assert.ok(f.id && f.cli && f.expected && f.source, `fixture missing metadata: ${JSON.stringify(f).slice(0, 80)}`);
    assert.ok(Array.isArray(f.tail) && f.tail.length > 0, `fixture ${f.id} has no tail`);
  }
  const seen = new Set(graded.map((g) => g.expected));
  for (const s of ["BLOCKED", "WORKING", "ERROR", "IDLE"]) {
    assert.ok(seen.has(s), `corpus has no ${s} fixture — accuracy claim would be hollow`);
  }
  // guard the escape hatch: a safety-critical miss can NEVER be allow-listed away
  for (const id of ALLOWED_MISSES) {
    const f = fixtures.find((x) => x.id === id);
    assert.ok(f, `ALLOWED_MISSES names an unknown fixture: ${id}`);
    assert.ok(
      !SAFETY_CRITICAL.has(f.expected),
      `${id} expects ${f.expected}, a safety-critical state — it must never be allow-listed; fix the profile`,
    );
  }
});

test("BLOCKED recall is 100% — a session waiting on a human never reads calm", () => {
  const r = recall("BLOCKED");
  const missed = graded.filter((g) => g.expected === "BLOCKED" && g.got !== "BLOCKED");
  assert.equal(
    r.value,
    1,
    `BLOCKED recall ${r.hit}/${r.total}. Missed (read as calm): ` +
      missed.map((m) => `${m.id}→${m.got}`).join(", "),
  );
});

test("ERROR recall is 100% — a stuck-erroring session never reads calm", () => {
  const r = recall("ERROR");
  const missed = graded.filter((g) => g.expected === "ERROR" && g.got !== "ERROR");
  assert.equal(
    r.value,
    1,
    `ERROR recall ${r.hit}/${r.total}. Missed: ` + missed.map((m) => `${m.id}→${m.got}`).join(", "),
  );
});

test("no UNDOCUMENTED misclassification — new wild misses fail until fixed or accepted", () => {
  const surprises = misses.filter((m) => !ALLOWED_MISSES.has(m.id));
  assert.equal(
    surprises.length,
    0,
    "unexpected misclassifications (fix the profile, or add to ALLOWED_MISSES if it is a non-critical edge):\n" +
      surprises.map((m) => `  ${m.id} (${m.cli}): expected ${m.expected}, got ${m.got}`).join("\n"),
  );
});

test("overall accuracy is reported and does not regress below the recorded floor", () => {
  // Floor set at the count the corpus-as-committed achieves: every fixture correct except the
  // documented ALLOWED_MISSES. A regression that breaks a currently-correct fixture drops below.
  const floor = graded.length - ALLOWED_MISSES.size;
  const pct = (accuracy * 100).toFixed(1);
  console.error(
    `[state-accuracy] ${correct}/${graded.length} correct (${pct}%); ` +
      `BLOCKED ${recall("BLOCKED").hit}/${recall("BLOCKED").total}, ` +
      `ERROR ${recall("ERROR").hit}/${recall("ERROR").total}, ` +
      `WORKING ${recall("WORKING").hit}/${recall("WORKING").total}, ` +
      `IDLE ${recall("IDLE").hit}/${recall("IDLE").total}; ` +
      `documented edges: ${[...ALLOWED_MISSES].join(", ") || "none"}`,
  );
  assert.ok(
    correct >= floor,
    `accuracy regressed: ${correct}/${graded.length} correct, floor is ${floor}. ` +
      `Newly-wrong: ${misses.filter((m) => !ALLOWED_MISSES.has(m.id)).map((m) => m.id).join(", ")}`,
  );
});
