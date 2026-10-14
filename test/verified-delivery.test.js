/**
 * A verified send verifies THIS paste: the text must appear in pane lines that are NEW since the capture taken just
 * before the paste — not anywhere in the last 30 lines — and a send whose paste did not land submits nothing and wipes
 * nothing (TMUX-206; THREAT-MODEL finding 4).
 *
 * Measured 2026-10-13 on d542ddf (and e757b28 before it): sendVerified() captured the pane once, AFTER the paste, and
 * called the text landed when `flat.includes(needle)` for the first 40 normalized characters — anywhere in the capture
 * — or when the text was empty (`needle.length === 0 || …`). So (a) a re-send whose first 40 characters were still on
 * screen from an earlier turn read as landed with the paste dropped, Enter went in and the input.sent row said
 * attempt:0; (b) a text sharing its first 40 characters with an earlier one — the same command, a different suffix —
 * read as landed on the earlier echo; (c) an empty text always landed: Enter alone, verified; and (d) on a failed
 * verification the retry path sent `C-u` to the pane first — wiping whatever the RECIPIENT had on its input line (an
 * agent's half-typed reply, a shell's pending command) before pasting again. Three independent reproductions (two
 * reviews and a source-check lane: S3, FM-03, SC06/SC07).
 *
 * Now the pane is captured BEFORE the paste as well, and the needle must appear in the lines the paste ADDED — the
 * multiset difference of the normalized non-empty lines after minus before, so a line changed in place (a prompt
 * redrawn with the text, a TUI input box) counts as new and a line that was already there, even twice, does not. On a
 * failed verification nothing is typed into the pane: no Enter, no C-u; the pane is looked at twice, 400 ms apart,
 * before a paste is called dropped, and one more paste is attempted only when the pane shows NO trace of the text
 * (nothing could be doubled), else the send returns false and the caller decides. An
 * empty or whitespace-only text is refused before the policy gate and before any tmux call — `EmptyTextError`, a typed
 * no-op: nothing pasted, nothing submitted, no row.
 *
 * All through the built Orchestrator on a FakeTmux whose capture-pane answers are SCRIPTED per phase (before the
 * paste, after the paste, after a second paste) and whose every tmux verb — captures included — is recorded in order,
 * so a check can say what was and was not typed. Each case FAILS if its property is removed (RED on d542ddf quoted in
 * the messages):
 *   (1) fresh full input: the paste puts the text on the prompt line → landed, Enter (C-j) sent once, input.sent
 *       attempt:0, no C-u;
 *   (2) stale echo + dropped paste: the text is on screen from an earlier turn, the paste adds nothing → NOT landed,
 *       no Enter, no C-u, input.verified ok:false, the send returns false — RED: landed on the echo, Enter sent;
 *   (3) same prefix, different suffix: an earlier command sharing the first 40 characters is on screen, this paste
 *       adds nothing → NOT landed, no Enter — RED: landed on the earlier line;
 *   (4) dropped paste on a clean prompt → NOT landed, no Enter, no C-u — RED: C-u typed into the pane;
 *   (5) redraw: the prompt line is repainted in place with the text (a line editor) → landed;
 *   (6) wrapped / re-spaced: the text comes back as one long -J-joined line with its runs of blanks collapsed → landed;
 *   (7) repeat of a line already on screen: before holds one copy, after holds two → landed (a multiset, not a set);
 *   (8) retry without a wipe: the first paste leaves no trace, the second lands → landed on attempt 1 with an
 *       input.verified ok:false for attempt 0 and NO C-u between them — RED: C-u before the retry;
 *   (9) a partial trace is not retried: the pane shows the text's opening but not the needle → one attempt, false,
 *       no second paste, no C-u;
 *  (10) empty and whitespace-only text → EmptyTextError before the gate: no paste-buffer, no C-j, no C-u, no ledger
 *       row; a read-only policy is not even consulted (nothing to audit) — RED: Enter sent, input.sent attempt:0;
 *  (11) the same rule on the program path (cleared:false): a failed verification wipes nothing there either;
 *  (12) a late echo: the pane is looked at twice, 400 ms apart, before a paste is called dropped — the text that
 *       appears only on the second look lands on attempt 0 with ONE paste (a second paste would have doubled it).
 *
 * Run: npm run build && node --test test/verified-delivery.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Orchestrator } from "../dist/core/orchestrator.js";
import { Policy } from "../dist/core/policy.js";
import { Ledger } from "../dist/core/ledger.js";
import { ROOT } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const ORCH_JS = pathToFileURL(join(ROOT, "dist", "core", "orchestrator.js")).href;
const TEXT = "echo hello-world-distinctive-marker-for-this-send";
/** Shares its first 40 characters with TEXT; differs after them. */
const SAME_PREFIX = "echo hello-world-distinctive-marker-for-THAT-send";
assert.equal(TEXT.slice(0, 40), SAME_PREFIX.slice(0, 40), "fixture: the two texts must share their first 40 characters");
assert.notEqual(TEXT, SAME_PREFIX, "fixture: the two texts must differ");

function freshHome() {
  const h = tempHome("ta-vdel-");
  process.env.TMUX_AGENT_HOME = h;
  return h;
}
function rows(home) {
  const dir = join(home, "ledger");
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/**
 * A FakeTmux whose capture answers follow the paste count: `screens[0]` before any paste, `screens[1]` after the first
 * paste-buffer, `screens[2]` after the second, … (the last entry repeats). Every verb is recorded in `calls`, captures
 * as ["capture-pane", lines], so a case can assert order and absence. `shell` decides the pre-paste clear.
 */
function fakeTmux(screens, { shell = true, late = false } = {}) {
  const calls = [];
  let pastes = 0;
  let looks = 0; // captures since the last paste — `late` makes the first one still show the pre-paste screen
  return {
    calls,
    socketArgs: () => ["-L", "test"],
    exec: async (args) => {
      calls.push(args);
      if (args[0] === "paste-buffer") { pastes++; looks = 0; }
      if (args[0] === "show-options") return { stdout: "\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
    hasSession: async () => true,
    capturePane: async (_name, lines) => {
      calls.push(["capture-pane", lines]);
      looks++;
      const shown = late && pastes > 0 && looks === 1 ? pastes - 1 : pastes; // the echo lags one look
      return screens[Math.min(shown, screens.length - 1)];
    },
    paneInfo: async () => ({ pid: 4242, currentCmd: shell ? "bash" : "python3", cwd: "/tmp", dead: false }),
    listSessions: async () => [],
    listSessionsReachable: async () => ({ reachable: true, error: null, sessions: [] }),
  };
}
const mkOrch = (tmux, policy = new Policy({})) => new Orchestrator(tmux, new Ledger(join(process.env.TMUX_AGENT_HOME, "ledger")), policy, "vdel-test");
const keys = (tmux, key) => tmux.calls.filter((c) => c[0] === "send-keys" && c.includes(key)).length;
const pastes = (tmux) => tmux.calls.filter((c) => c[0] === "paste-buffer").length;
/** Every C-u is a wipe of the recipient's line: the count a failed verification must leave at zero. */
const wipes = (tmux) => keys(tmux, "C-u");
const enters = (tmux) => keys(tmux, "C-j");

test("(1) fresh input: the paste puts the text on the prompt line → landed, Enter once, attempt 0, no wipe", async () => {
  const home = freshHome();
  const tmux = fakeTmux(["$ ", `$ ${TEXT}`]);
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true });
  assert.equal(ok, true, "a paste that changed the prompt line did not verify");
  assert.equal(enters(tmux), 1, `Enter sent ${enters(tmux)} times, want 1`);
  assert.equal(wipes(tmux), 0, "a landed send wiped the line");
  const sent = rows(home).filter((e) => e.type === "input.sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.attempt, 0);
});

test("(2) stale echo + dropped paste: the text was on screen before the paste and the paste added nothing → not landed, no Enter, no wipe, returns false", async () => {
  const home = freshHome();
  const stale = `$ ${TEXT}\nhello-world-distinctive-marker-for-this-send\n$ `;
  const tmux = fakeTmux([stale, stale]); // the paste changes nothing
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 0 });
  assert.equal(ok, false, "a dropped paste read as landed on the stale echo (on d542ddf: `flat.includes(needle)` over the whole capture)");
  assert.equal(enters(tmux), 0, `Enter was sent ${enters(tmux)} times after a dropped paste — the recipient ran whatever was on its line`);
  assert.equal(wipes(tmux), 0, `C-u was sent ${wipes(tmux)} times — the recipient's input line was wiped`);
  const r = rows(home);
  assert.equal(r.filter((e) => e.type === "input.sent").length, 0, "an input.sent row claims a send that did not land");
  assert.deepEqual(r.filter((e) => e.type === "input.verified").map((e) => e.data), [{ attempt: 0, ok: false }], "the failed verification was not ledgered as input.verified ok:false");
});

test("(3) same prefix, different suffix: an earlier command sharing the first 40 characters is on screen, this paste adds nothing → not landed, no Enter", async () => {
  freshHome();
  const stale = `$ ${SAME_PREFIX}\n$ `;
  const tmux = fakeTmux([stale, stale]);
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 0 });
  assert.equal(ok, false, "a dropped paste read as landed on an earlier line that shares its first 40 characters");
  assert.equal(enters(tmux), 0, "Enter was sent on the strength of a same-prefix line");
  assert.equal(wipes(tmux), 0, "C-u was sent");
});

test("(4) dropped paste on a clean prompt → not landed, no Enter, no C-u", async () => {
  freshHome();
  const tmux = fakeTmux(["$ ", "$ "]);
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 0 });
  assert.equal(ok, false);
  assert.equal(enters(tmux), 0, "Enter was sent after a dropped paste");
  assert.equal(wipes(tmux), 0, `C-u was sent ${wipes(tmux)} times after a dropped paste (on d542ddf the retry path wiped the recipient's line first)`);
});

test("(5) redraw: a line editor repaints the prompt line in place with the text → landed", async () => {
  freshHome();
  const tmux = fakeTmux(["\u001b[?25l$ \u001b[?25h", `\u001b[?25l$ ${TEXT}\u001b[?25h\n-- INSERT --`]);
  assert.equal(await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true }), true, "a redrawn prompt line carrying the text did not verify");
  assert.equal(enters(tmux), 1);
});

test("(6) wrapped / re-spaced: the text comes back as one -J-joined line with its blanks collapsed → landed", async () => {
  freshHome();
  const spaced = "echo   hello-world-distinctive-marker-for-this-send    --flag   value";
  const tmux = fakeTmux(["$ ", `$ echo hello-world-distinctive-marker-for-this-send --flag value`]);
  assert.equal(await mkOrch(tmux).sendVerified("s1", spaced, { enter: true }), true, "a wrapped/re-spaced echo of the text did not verify");
});

test("(7) a repeat of a line already on screen: one copy before, two after → landed (the difference is a multiset)", async () => {
  freshHome();
  const tmux = fakeTmux([`$ ${TEXT}\nok\n$ `, `$ ${TEXT}\nok\n$ ${TEXT}`]);
  assert.equal(await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true }), true, "re-sending a command whose earlier echo is on screen did not verify although the paste added a second copy");
  assert.equal(enters(tmux), 1);
});

test("(8) retry without a wipe: the first paste leaves no trace, the second lands → attempt 1, one input.verified ok:false, no C-u", async () => {
  const home = freshHome();
  const tmux = fakeTmux(["$ ", "$ ", `$ ${TEXT}`]);
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 1 });
  assert.equal(ok, true, "the retried paste did not verify");
  assert.equal(pastes(tmux), 2, `${pastes(tmux)} pastes, want 2`);
  assert.equal(wipes(tmux), 0, `C-u was sent ${wipes(tmux)} times between the attempts (on d542ddf the retry wiped the line first)`);
  assert.equal(enters(tmux), 1);
  const r = rows(home);
  assert.deepEqual(r.filter((e) => e.type === "input.verified").map((e) => e.data), [{ attempt: 0, ok: false }]);
  assert.equal(r.find((e) => e.type === "input.sent").data.attempt, 1);
});

test("(9) a partial trace is not retried: the pane shows the text's opening but not the needle → one paste, false, no C-u", async () => {
  freshHome();
  const tmux = fakeTmux(["$ ", `$ ${TEXT.slice(0, 12)}`]);
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 1 });
  assert.equal(ok, false);
  assert.equal(pastes(tmux), 1, `a second paste was attempted over a partial first one (${pastes(tmux)} pastes) — it would double the text`);
  assert.equal(enters(tmux), 0);
  assert.equal(wipes(tmux), 0);
});

test("(10) empty and whitespace-only text are refused before the gate — EmptyTextError, nothing pasted, nothing submitted, no row", async () => {
  const home = freshHome();
  const mod = await import(ORCH_JS);
  assert.equal(typeof mod.EmptyTextError, "function", "dist/core/orchestrator.js exports no EmptyTextError — on d542ddf an empty text was pasted (nothing), verified (`needle.length === 0`) and submitted");
  for (const text of ["", "   ", "\n\t"]) {
    const tmux = fakeTmux(["$ ", "$ "]);
    // a read-only policy would refuse a real send; an empty one is refused BEFORE the gate, so no control.denied is filed
    await assert.rejects(() => mkOrch(tmux, new Policy({ readOnly: true })).sendVerified("s1", text, { enter: true }), (e) => e instanceof mod.EmptyTextError && /empty/.test(e.message), `${JSON.stringify(text)}: want an EmptyTextError naming the empty text`);
    assert.equal(pastes(tmux), 0, `${JSON.stringify(text)}: a paste was attempted`);
    assert.equal(enters(tmux), 0, `${JSON.stringify(text)}: Enter was sent — on d542ddf an empty text landed by definition and Enter went in`);
    assert.equal(wipes(tmux), 0);
    assert.equal(tmux.calls.length, 0, `${JSON.stringify(text)}: tmux was asked ${tmux.calls.length} things for a text with nothing in it: ${JSON.stringify(tmux.calls.slice(0, 3))}`);
  }
  assert.equal(rows(home).length, 0, "an empty text left a ledger row");
});

test("(12) a late echo: the text appears only on the second look → landed on attempt 0 with ONE paste, no C-u", async () => {
  const home = freshHome();
  const tmux = fakeTmux(["$ ", `$ ${TEXT}`], { late: true });
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 1 });
  assert.equal(ok, true, "a paste whose echo lagged one look was called dropped");
  assert.equal(pastes(tmux), 1, `${pastes(tmux)} pastes — a late echo was pasted over, doubling the text`);
  assert.equal(enters(tmux), 1);
  assert.equal(wipes(tmux), 0);
  assert.equal(rows(home).find((e) => e.type === "input.sent").data.attempt, 0);
  assert.equal(rows(home).filter((e) => e.type === "input.verified").length, 0, "a landed paste was ledgered as a failed verification");
});

test("(11) the program path (cleared:false): a failed verification wipes nothing there either", async () => {
  const home = freshHome();
  const tmux = fakeTmux(["> ", "> "], { shell: false });
  const ok = await mkOrch(tmux).sendVerified("s1", TEXT, { enter: true, retries: 0 });
  assert.equal(ok, false);
  assert.equal(keys(tmux, "C-c"), 0, "a program's pane was interrupted");
  assert.equal(wipes(tmux), 0, "a program's input line was wiped after a failed verification");
  assert.equal(enters(tmux), 0);
  assert.equal(rows(home).filter((e) => e.type === "input.sent").length, 0);
});
