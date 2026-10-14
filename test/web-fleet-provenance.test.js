/**
 * Every fleet row says where its state came from, and the health tick carries the last deep verdict into the fast rows
 *. `/api/fleet` rows gain `observed: { source: "cpu" | "profile", profile, at, ageSecs }`: `profile` when the
 * daemon's own tick read the pane and a profile had an opinion — the row's `state` and `classifiedBy` are then that
 * verdict — and `cpu` when the state is the CPU-delta verdict alone, which the UI labels `cpu-only`.
 *
 * Measured 2026-10-13 14:00Z on the live fleet by the review: the fleet table said 26 of 31 WORKING while the per-pane
 * classifier said 8, and a session parked on a codex menu read IDLE on every poll until a human clicked it. The fast
 * path reads no pane text by design; the only deep reads were the detail view's. The north star's worst output is a
 * waiting session that reads as calm — this was its mirror image, and the one row that needed a human read IDLE.
 *
 * On a real isolated tmux server, through the built dashboard with a 1 s health tick. Each check FAILS if the property
 * is removed (RED on 7a9193d quoted in the messages):
 *   (1) a pane painted with codex's update menu (a real BLOCKED a human must answer) → within a few ticks its row reads
 *       state BLOCKED, classifiedBy "codex", observed.source "profile", observed.profile "codex", observed.at an ISO
 *       stamp, observed.ageSecs a small number — RED: no `observed`, state UNKNOWN/IDLE, classifiedBy null, forever;
 *   (2) a plain shell at its prompt → observed.source "cpu", observed.profile null, classifiedBy null, and its state is
 *       the CPU verdict (UNKNOWN / IDLE / WORKING, never BLOCKED) — a profile with no opinion does not get to speak;
 *   (3) the ledger is not churned by the tick's pass: across the window no `session.state` row for the codex session
 *       carries `to: "BLOCKED"` — the pass observes, the fast path's `via: "cpu"` rows stay the ledger's (TMUX-89's
 *       budget);
 *   (4) the deep-inspected row (the detail view's `focus` set, via /api/session/<name>) also says `profile`.
 *
 * Run: npm run build && node --test test/web-fleet-provenance.test.js   (needs a tmux binary)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, startWeb, stopWeb } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";
import { quietServer } from "./helpers/quiet-server.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const BOUND_MS = 15_000;
const tmuxRaw = (sock, args) => execFileSync("tmux", ["-L", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function rows(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** Paint codex's menu as the pane's last lines and block, so a profile read gives BLOCKED for the whole case. */
async function paintMenu(sock, name) {
  tmuxRaw(sock, ["send-keys", "-t", `=${name}:`, "clear; printf '%s\\n' '  Update available! 0.142.5 -> 0.144.4' '› 1. Update now' '  2. Skip' '  3. Skip until next version' '  Press enter to continue'; sleep 180", "Enter"]);
  for (let i = 0; i < 60; i++) {
    const text = tmuxRaw(sock, ["capture-pane", "-p", "-J", "-t", `=${name}:`]);
    if (/Press enter to continue/.test(text) && !/printf/.test(text.split("\n").filter(Boolean).at(-1) ?? "")) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail(`test setup: ${name} never showed the menu`);
}
async function getJson(port, path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(BOUND_MS) });
  assert.equal(r.status, 200, `${path} answered ${r.status}`);
  return r.json();
}

test("fleet rows carry provenance; the tick's profile pass turns a parked codex menu BLOCKED on the fast path; a bare shell stays cpu-only; the ledger is not churned", async () => {
  const home = tempHome("ta-prov-");
  const S = `ta-built-${process.pid}`; // the socket the built-web helper's dashboard drives
  const codex = `prov-codex-${process.pid}`;
  const shell = `prov-shell-${process.pid}`;
  let child = null;
  try {
    quietServer(S);
    tmuxRaw(S, ["new-session", "-d", "-s", codex, "-x", "160", "-y", "40"]);
    tmuxRaw(S, ["new-session", "-d", "-s", shell, "-x", "160", "-y", "40"]);
    await paintMenu(S, codex);
    const started = await startWeb(ROOT, home, { TMUX_AGENT_HEALTH_TICK_MS: "1000" }, ["--no-token"]);
    child = started.child;
    // (1) poll until the tick has read the codex pane — bounded, the last body quoted on give-up
    let fleet = null;
    let codexRow = null;
    const deadline = Date.now() + BOUND_MS;
    while (Date.now() < deadline) {
      fleet = await getJson(started.port, "/api/fleet");
      codexRow = (fleet.sessions ?? []).find((s) => s.session === codex);
      if (codexRow?.observed?.source === "profile") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(codexRow, `no fleet row for ${codex}: ${JSON.stringify(fleet).slice(0, 300)}`);
    assert.equal(codexRow.observed?.source, "profile", `the codex row never carried a profile observation — on 7a9193d the fast row stayed ${codexRow.state} / classifiedBy ${JSON.stringify(codexRow.classifiedBy)} with no \`observed\` at all until a human clicked it: ${JSON.stringify(codexRow).slice(0, 400)}`);
    assert.equal(codexRow.state, "BLOCKED", `the codex row reads ${codexRow.state} on the fast path, want BLOCKED (the menu is waiting on a human)`);
    assert.equal(codexRow.classifiedBy, "codex", `classifiedBy ${JSON.stringify(codexRow.classifiedBy)}, want "codex"`);
    assert.equal(codexRow.observed.profile, "codex", "observed.profile names the profile that spoke");
    assert.match(String(codexRow.observed.at), /^\d{4}-\d{2}-\d{2}T/, "observed.at is an ISO stamp");
    assert.ok(typeof codexRow.observed.ageSecs === "number" && codexRow.observed.ageSecs >= 0 && codexRow.observed.ageSecs < 60, `observed.ageSecs is ${codexRow.observed.ageSecs}`);
    // (2) the shell: cpu-only, no profile, never BLOCKED
    const shellRow = (fleet.sessions ?? []).find((s) => s.session === shell);
    assert.ok(shellRow, `no fleet row for ${shell}`);
    assert.equal(shellRow.observed?.source, "cpu", `the bare shell's row says ${JSON.stringify(shellRow.observed)} — no profile has an opinion on a prompt, so its source is the CPU verdict`);
    assert.equal(shellRow.observed.profile, null);
    assert.equal(shellRow.classifiedBy, null, "a row no profile classified claims a profile");
    assert.notEqual(shellRow.state, "BLOCKED", "a bare shell reads BLOCKED");
    // (3) no churn, measured BEFORE any detail view is opened: the tick's pass filed no BLOCKED transition for the codex
    // session although it has read the menu on every tick — the fast path's `via: "cpu"` rows are the ledger's
    const blocked = rows(home).filter((e) => e.type === "session.state" && e.session === codex && e.data?.to === "BLOCKED");
    assert.deepEqual(blocked, [], `the tick's pass filed ${blocked.length} BLOCKED transition(s) — it must observe only: ${JSON.stringify(blocked).slice(0, 300)}`);
    for (const e of rows(home).filter((e) => e.type === "session.state" && e.session === codex)) {
      assert.equal(e.data?.via, "cpu", `a session.state row for the codex session did not come from the fast path: ${JSON.stringify(e.data)}`);
    }
    // (4) the deep-inspected row says profile too — the detail view's own snapshot() read, which DOES file the
    // transition a human-driven deep read always filed (the control that the pass's silence above is a choice, not an
    // inability to see the state)
    await getJson(started.port, `/api/session/${encodeURIComponent(codex)}`); // puts the session in the focus set
    const deepFleet = await getJson(started.port, "/api/fleet?x=1");
    const deepRow = (deepFleet.sessions ?? []).find((s) => s.session === codex);
    assert.equal(deepRow?.observed?.source, "profile", `the deep-inspected row says ${JSON.stringify(deepRow?.observed)}`);
    assert.equal(deepRow.state, "BLOCKED");
    const deepBlocked = rows(home).filter((e) => e.type === "session.state" && e.session === codex && e.data?.to === "BLOCKED");
    assert.equal(deepBlocked.length, 1, `the detail view's deep read filed ${deepBlocked.length} BLOCKED transition(s), want exactly one — the pass is silent, the human-driven read is not`);
  } finally {
    await stopWeb(child);
    killServerSync(S);
  }
});
