/**
 * AgentProfile tests — GA card TMUX-30 (KR3: universality).
 *
 * Every fixture below is REAL captured pane text from driving that CLI through tmux-agent, not
 * invented strings. That distinction is the point: the codex profile exists because a live
 * `codex` session sat on a blocking update prompt and the claude-code profile reported IDLE — a
 * supervisor would never have learned the session was waiting on a human.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeCodeProfile, codexProfile, aiderProfile, genericShellProfile } from "../dist/core/monitor.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProfiles } from "../dist/core/monitor.js";

// ── captured 2026-08-25 from `codex` running in a tmux-agent session ──
const CODEX_UPDATE_PROMPT = [
  "  ✨ Update available! 0.142.5 -> 0.144.4",
  "  Release notes: https://github.com/openai/codex/releases/latest",
  "› 1. Update now (runs `npm install -g @openai/codex`)",
  "  2. Skip",
  "  3. Skip until next version",
  "  Press enter to continue",
];
// captured from `codex --help` completing back to a shell prompt
const CODEX_AT_SHELL = ["  -V, --version", "          Print version", "ubuntu@host:/tmp$"];

test("codex: a real blocking update prompt is BLOCKED, not IDLE (the bug this profile fixes)", () => {
  assert.equal(codexProfile.classify(CODEX_UPDATE_PROMPT), "BLOCKED");
  // the regression: claude-code's ❯ does not match codex's ›, so it saw nothing
  assert.equal(claudeCodeProfile.classify(CODEX_UPDATE_PROMPT), null);
});

test("codex: back at a shell prompt is not classified as busy or blocked", () => {
  assert.equal(codexProfile.classify(CODEX_AT_SHELL), null, "no opinion -> core signals decide");
});

test("codex: spinner and interrupt hint read WORKING; errors outrank both", () => {
  assert.equal(codexProfile.classify(["⠹ thinking… (Esc to interrupt)"]), "WORKING");
  assert.equal(codexProfile.classify(["stream error: rate limited, retrying"]), "ERROR");
  assert.equal(codexProfile.classify(["⠹ working", "error: unauthorized"]), "ERROR");
});

test("codex: approval prompts block (the case that matters for unattended fleets)", () => {
  assert.equal(codexProfile.classify(["Allow command? (y/n)"]), "BLOCKED");
  assert.equal(codexProfile.classify(["› 2. Skip"]), "BLOCKED");
});

test("aider: documented prompts classify; marked best-effort until run for real", () => {
  assert.equal(aiderProfile.classify(["Apply edit to main.py? (Y)es/(N)o [Y]"]), "BLOCKED");
  assert.equal(aiderProfile.classify(["Add src/foo.py to the chat?"]), "BLOCKED");
  assert.equal(aiderProfile.classify(["Applying edit to main.py"]), "WORKING");
  assert.equal(aiderProfile.classify(["RateLimitError: slow down"]), "ERROR");
  assert.equal(aiderProfile.classify(["> "]), null);
});

test("generic-shell holds no opinion so core signals (CPU delta) decide", () => {
  assert.equal(genericShellProfile.classify(["anything at all"]), null);
});

test("profiles do not cross-fire on each other's fixtures", () => {
  // a claude-code idle footer must not read as a codex block
  assert.notEqual(codexProfile.classify(["new task? /clear to save 130.3k tokens"]), "BLOCKED");
  // a codex menu must not read as claude WORKING
  assert.notEqual(claudeCodeProfile.classify(CODEX_UPDATE_PROMPT), "WORKING");
});

test("every shipped profile has a name and a classify function (contract for third parties)", () => {
  for (const p of [claudeCodeProfile, codexProfile, aiderProfile, genericShellProfile]) {
    assert.equal(typeof p.name, "string");
    assert.ok(p.name.length > 0);
    assert.equal(typeof p.classify, "function");
    assert.doesNotThrow(() => p.classify([]), `${p.name} must tolerate an empty tail`);
  }
});

// ── TMUX-209: the codex profile fired on generic English — live tails, redacted, as the regression fixture ──
// Measured 2026-10-13 14:00Z on the live fleet and again on 396cb03 (the RED below): three Claude Code panes read
// codex.WORKING because their status line carries the mode word `thinking` between pipes; a bash prompt after a
// finished `codex exec` read codex.BLOCKED because the review's closing prose said `approved with nits`; the only true
// codex hit was a real `› 3.` menu. The codex rules were `|approve` (BLOCKED) and `thinking|working` (WORKING) —
// generic words no CLI owns. Anchored now to codex's own rendering: BLOCKED is its menu glyph before a numbered item,
// `Press enter to continue`, `(y/n)` and `Allow command?`; WORKING is its braille spinner or `Esc to interrupt`. The
// fixture file test/fixtures/live-tails-2026-10-13.json holds the tails scrubbed (hosts, users, paths, branch and
// repository names and the review's prose replaced by neutral placeholders; every glyph and status-bar token kept).

const LIVE_TAILS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "live-tails-2026-10-13.json"), "utf8"));
/** The shipped chain's verdict for a tail: the first profile with an opinion, else null (the generic floor). */
function chainVerdict(tail) {
  const p = resolveProfiles({}).find((p) => p.name !== "generic-shell" && p.classify(tail) !== null);
  return p ? p.name : null;
}

test("live tails: the fixture file holds the tails the review measured, with both halves of every expectation stated", () => {
  const ids = LIVE_TAILS.tails.map((t) => t.id);
  assert.ok(ids.length >= 5, `fixture file lists ${ids.length} tails — the review's five scrubbed tails (plus CODEX_UPDATE_PROMPT above) are the regression`);
  assert.equal(new Set(ids).size, ids.length, "duplicate fixture ids");
  for (const t of LIVE_TAILS.tails) {
    assert.ok(Array.isArray(t.lines) && t.lines.length > 0, `${t.id}: no lines`);
    assert.ok(t.expect && "codex" in t.expect && "claude-code" in t.expect && "chain" in t.expect && "contextPct" in t.expect, `${t.id}: expectation must name codex, claude-code, the chain and contextPct (TMUX-215: the figure the claude-code profile reads from the status line, or null)`);
  }
});

test("live tails: the codex profile has NO opinion on Claude Code's status line or on a bash prompt that merely contains 'approved' — and still blocks on its own menu", () => {
  const problems = [];
  for (const t of LIVE_TAILS.tails) {
    const got = codexProfile.classify(t.lines);
    if (got !== t.expect.codex) problems.push(`${t.id}: codex read ${JSON.stringify(got)}, want ${JSON.stringify(t.expect.codex)} (on 396cb03: ${JSON.stringify(t.onParent?.codex)}) — tail: ${JSON.stringify(t.lines.slice(-3))}`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  // the controls: codex's own renderings still read as codex — the anchors hold what the generic words held before
  assert.equal(codexProfile.classify(CODEX_UPDATE_PROMPT), "BLOCKED", "codex's real update menu no longer blocks");
  assert.equal(codexProfile.classify(["⠹ thinking… (Esc to interrupt)"]), "WORKING", "codex's spinner line no longer reads WORKING");
  assert.equal(codexProfile.classify(["Allow command? (y/n)"]), "BLOCKED", "codex's approval question no longer blocks");
});

test("live tails: the shipped chain names no profile for an idle Claude pane or a bash prompt, and claude-code for its own permission dialog", () => {
  const problems = [];
  for (const t of LIVE_TAILS.tails) {
    const got = chainVerdict(t.lines);
    if (got !== t.expect.chain) problems.push(`${t.id}: the chain's first opinion is ${JSON.stringify(got)}, want ${JSON.stringify(t.expect.chain)} (on 396cb03: ${JSON.stringify(t.onParent?.chain)})`);
    const cc = claudeCodeProfile.classify(t.lines);
    if (cc !== t.expect["claude-code"]) problems.push(`${t.id}: claude-code read ${JSON.stringify(cc)}, want ${JSON.stringify(t.expect["claude-code"])}`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

// ── TMUX-215: Claude Code's status line draws the context figure as a bar — and the profile read only `ctx:NN%` ──
// Measured 2026-10-13 14:00Z on the live fleet by the wave-1 review: 19 of 31 panes carried a ctx token, every one in the
// bar form `ctx:[#######---]71%`, and claudeCodeProfile.contextPct — `ctx:(\d+)%` only — read null on all of them, so
// the dashboard's ctx badge (ui.ts buildTree's `.ctx` span, `hot` from 80) rendered for nobody and `status`'s context
// column read `-%` fleet-wide. The three Claude status lines in the live fixture draw the bar at 90, 79 and 67 and now
// state the figure in `expect.contextPct`; the card's own captured token is the fourth input. The controls: the plain
// form `ctx:84%` (a status line without the bar; test/unit.test.js pins the same) still reads 84, a tail with no token
// stays null. RED on 313ffda: the card token and all three fixture tails read null (`onParent.contextPct`).
// Not covered here, on purpose: Monitor.inspect()/peekProfiles() read contextPct from the profile that CLAIMED the pane,
// and an idle Claude pane — prompt at ❯, no WORKING/BLOCKED/ERROR marker — is claimed by none, so these three idle tails
// still read null through the Monitor (26 of 26 live token-bearing panes were idle at 22:32Z). That is TMUX-236;
// test/profile-pass.test.js pins both halves as they stand.
const CARD_TOKEN_LINE = "  [OMC#5.5.0] -> 5.7.1 omc update | Model: Fable 5.1 | thinking | session:12m | ctx:[#######---]71% | 🔧41";

test("claude-code contextPct: the bar form reads its number — the card's 71, the live fixture's 90/79/67 — and the plain form still reads its own", () => {
  assert.equal(claudeCodeProfile.contextPct([CARD_TOKEN_LINE]), 71, "the card's own token reads null — the bar between `ctx:` and the number is not accepted");
  const problems = [];
  let barTails = 0;
  for (const t of LIVE_TAILS.tails) {
    const got = claudeCodeProfile.contextPct(t.lines);
    if (got !== t.expect.contextPct) problems.push(`${t.id}: contextPct read ${JSON.stringify(got)}, want ${JSON.stringify(t.expect.contextPct)} (on 313ffda: ${JSON.stringify(t.onParent?.contextPct)})`);
    if (t.lines.some((l) => /ctx:\[/.test(l))) barTails++;
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(barTails >= 3, `the fixture holds ${barTails} bar-form tails — the regression needs the three live status lines`);
  // the controls, unchanged by the bar: the plain form and a tail without the token
  assert.equal(claudeCodeProfile.contextPct(["ctx:84% | 🔧12"]), 84, "the plain form stopped reading");
  assert.equal(claudeCodeProfile.contextPct(["❯", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"]), null, "a tail with no token reads a number");
});
