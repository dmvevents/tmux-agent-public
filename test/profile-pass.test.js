/**
 * `Monitor.peekProfiles(names)` — a profile pass that OBSERVES and reports but changes nothing: each named session's
 * last six pane lines through the profile chain, the verdict the detail view would give, with no ledger row filed and
 * no state-transition bookkeeping moved. It is what the dashboard's health tick runs over the whole fleet
 * so the fast rows can carry the last deep verdict and say where their state came from.
 *
 * Measured 2026-10-13 14:00Z on the live fleet by the review and reproduced on 7a9193d with a fake: the fleet table
 * (fleetFast, the 2-exec fast path) said 26 of 31 sessions were WORKING while the per-pane classifier said 8, and a
 * session parked on a codex menu — a human must answer it — read IDLE on the fast path and BLOCKED only when a human
 * clicked it. The fast path reads no pane text by design (that is what keeps it O(1) in tmux calls), and the only deep
 * reads were the detail view's. The north star's worst output is a waiting session that reads as calm.
 *
 * Why a separate pass and not `snapshot()`: snapshot() files a `session.state` row on every change and moves the
 * monitor's transition bookkeeping; the fast path files `via: "cpu"` rows from the same bookkeeping. Two classifiers
 * writing one state machine every 30 s would alternate on any session whose CPU verdict and profile verdict disagree
 * — a transition per tick per session, the churn TMUX-89 spent a card removing. The pass therefore reads and returns;
 * the fast path's ledger stays the ledger.
 *
 * Each check FAILS if the property is removed (RED on 7a9193d quoted in the messages):
 *   (1) the limitation, pinned: fleetFast({deep: []}) over a pane whose text is a codex menu answers classifiedBy null
 *       and never BLOCKED — the fast path does not read the pane (this is the row the review saw);
 *   (2) peekProfiles([name]) answers { state: "BLOCKED", classifiedBy: "codex" } for that pane — RED: no such method;
 *   (3) the pass files NO ledger row and moves NO bookkeeping: the row count is unchanged across the pass, and the
 *       fast poll after it answers exactly what it answered before (a pass that moved lastState would make the next
 *       fast poll file a transition or report the deep state);
 *   (4) a pane no profile has an opinion on answers { state: null, classifiedBy: null } — the caller keeps its CPU
 *       verdict and says so; a session the server cannot read is absent from the map, not a faked entry;
 *   (5) the control: snapshot() on the codex pane still answers BLOCKED / codex — the pass agrees with the detail view.
 *
 * Run: npm run build && node --test test/profile-pass.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Monitor } from "../dist/core/monitor.js";
import { Ledger } from "../dist/core/ledger.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

// captured 2026-08-25 from a live `codex` (the same lines test/profiles.test.js pins); a shell prompt beside it
const CODEX_MENU = ["  ✨ Update available! 0.142.5 -> 0.144.4", "› 1. Update now (runs `npm install -g @openai/codex`)", "  2. Skip", "  3. Skip until next version", "  Press enter to continue"].join("\n");
const SHELL_PROMPT = "user@host:~$ ";

function rows(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** Two reachable sessions; `panes` text per session; a session named in `unreadable` throws on capture. */
function fakeTmux(panes, unreadable = new Set()) {
  const names = Object.keys(panes);
  return {
    async listFleetReachable() {
      return {
        reachable: true,
        error: null,
        sessions: names.map((name) => ({ name, parent: null, owner: null, task: null, created: 0, activity: 0, attached: false, windows: 1 })),
        panes: new Map(names.map((name, i) => [name, { pid: 4_000_000 + i, currentCmd: "bash", cwd: "/tmp", dead: false }])), // pids no host process holds: the CPU tracker reads nothing, the verdict stays UNKNOWN
      };
    },
    async listSessionsReachable() {
      return { reachable: true, error: null, sessions: names.map((name) => ({ name })) };
    },
    async capturePane(name) {
      if (unreadable.has(name)) throw new Error(`can't find pane: ${name}`);
      return `${panes[name]}\n`;
    },
    async paneInfo(name) {
      return { pid: 4_000_000 + names.indexOf(name), currentCmd: "bash", cwd: "/tmp", dead: false };
    },
    async hasSessionChecked(name) {
      return { present: names.includes(name), unreachable: null };
    },
  };
}

// ── TMUX-215: the pass reads the context figure the way the status line draws it — for a pane a profile claimed ──
// A working Claude Code pane: the spinner's `esc to interrupt` is what the claude-code profile claims the pane on, and
// the status line beneath it draws the context figure as a bar, `ctx:[#######---]71%`. On 313ffda the pass answered
// { state: "WORKING", classifiedBy: "claude-code", contextPct: null } for it — the profile's regex knew `ctx:NN%` only.
// The idle control is the limit, pinned as it stands: contextPct is read from the profile that CLASSIFIED the pane
// (the same `profile` in inspect(); `spoke ? profile.contextPct?.(tail)` here), and an idle pane — prompt at ❯, the same
// status line, no marker — is claimed by none, so the figure is never read. Measured 2026-10-13 22:32Z on the live
// fleet: 26 of 26 panes carrying the token were idle. That is TMUX-236's card; when it ships, this pin flips with it.
const CLAUDE_WORKING_BAR = ["✻ Thinking… (esc to interrupt)", "  [OMC#5.5.0] -> 5.7.1 omc update | Model: Fable 5.1 | thinking | session:12m | ctx:[#######---]71% | 🔧41"].join("\n");
const CLAUDE_IDLE_BAR = ["❯", "  [OMC#5.5.0] -> 5.7.1 omc update | Model: Fable 5.1 | thinking | session:12m | ctx:[#######---]71% | 🔧41", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join("\n");

test("peekProfiles: a working Claude Code pane whose status line draws the context bar answers contextPct 71 as claude-code; the idle control stays null — no profile claimed it", async () => {
  const home = tempHome("ta-peek-ctx-");
  const ledger = new Ledger(join(home, "ledger"));
  const m = new Monitor(fakeTmux({ "pk-ctx-working": CLAUDE_WORKING_BAR, "pk-ctx-idle": CLAUDE_IDLE_BAR }), ledger, home);
  const peek = await m.peekProfiles(["pk-ctx-working", "pk-ctx-idle"]);
  const pick = (name) => { const e = peek.get(name); return e && { state: e.state, classifiedBy: e.classifiedBy, contextPct: e.contextPct }; };
  assert.deepEqual(pick("pk-ctx-working"), { state: "WORKING", classifiedBy: "claude-code", contextPct: 71 },
    "the working pane: claimed by claude-code, its status line's bar must read 71 (on 313ffda: contextPct null)");
  assert.deepEqual(pick("pk-ctx-idle"), { state: null, classifiedBy: null, contextPct: null },
    "the idle pane: no profile claims it, so its figure is not read — the limit TMUX-236 flips; if this reads 71, that card shipped and this pin moves with it");
});

test("peekProfiles: the fast path's limitation is pinned, the pass gives the deep verdict, files nothing and moves nothing, and agrees with snapshot", async () => {
  const home = tempHome("ta-peek-");
  const ledger = new Ledger(join(home, "ledger"));
  const tmux = fakeTmux({ "pk-codex": CODEX_MENU, "pk-shell": SHELL_PROMPT, "pk-gone": SHELL_PROMPT }, new Set(["pk-gone"]));
  const m = new Monitor(tmux, ledger, home);
  // (1) the limitation: two fast polls (the first is the CPU baseline), the codex pane never reads BLOCKED on this path
  await m.fleetFast({ deep: [] });
  const before = await m.fleetFast({ deep: [] });
  const fastCodex = before.sessions.find((s) => s.session === "pk-codex");
  assert.ok(fastCodex, "the fake's codex session is not in the fast fleet");
  assert.notEqual(fastCodex.state, "BLOCKED", "the fast path read the pane — this case pins the limitation the pass exists for");
  assert.equal(fastCodex.classifiedBy, null, "the fast path claims a profile spoke");
  const rowsBefore = rows(home).length;
  // (2) the pass
  assert.equal(typeof m.peekProfiles, "function", "Monitor has no peekProfiles() — on 7a9193d the only deep reads were the detail view's, so a parked codex menu read IDLE on every fleet row until clicked");
  const peek = await m.peekProfiles(["pk-codex", "pk-shell", "pk-gone"]);
  const codex = peek.get("pk-codex");
  assert.ok(codex, "no verdict for the codex pane");
  assert.equal(codex.state, "BLOCKED", `the codex menu read ${codex.state} on the pass, want BLOCKED`);
  assert.equal(codex.classifiedBy, "codex", `classifiedBy ${JSON.stringify(codex.classifiedBy)}, want "codex"`);
  assert.match(String(codex.at), /^\d{4}-\d{2}-\d{2}T/, "the verdict carries when it was taken");
  // (4) no opinion stays null; an unreadable pane is absent
  const shell = peek.get("pk-shell");
  assert.ok(shell, "no entry for the shell pane");
  assert.equal(shell.state, null, `a bare prompt read ${shell.state} on the pass — no profile should have an opinion`);
  assert.equal(shell.classifiedBy, null);
  assert.equal(peek.has("pk-gone"), false, "a pane the server could not read got a faked verdict");
  // (3) nothing filed, nothing moved
  assert.equal(rows(home).length, rowsBefore, `the pass filed ${rows(home).length - rowsBefore} ledger row(s) — it must observe only`);
  const after = await m.fleetFast({ deep: [] });
  const fastCodexAfter = after.sessions.find((s) => s.session === "pk-codex");
  assert.equal(fastCodexAfter.state, fastCodex.state, `the fast poll after the pass answers ${fastCodexAfter.state} where before it answered ${fastCodex.state} — the pass moved the bookkeeping`);
  assert.equal(fastCodexAfter.classifiedBy, null, "the fast poll after the pass claims a profile spoke");
  assert.equal(rows(home).length, rowsBefore, "the fast poll after the pass filed a transition the pass caused");
  // (5) the control
  const deep = await m.snapshot("pk-codex");
  assert.equal(deep.state, "BLOCKED", "snapshot() no longer reads the codex menu as BLOCKED — then the pass agreeing with it would mean nothing");
  assert.equal(deep.classifiedBy, "codex");
});
