/**
 * `lineage` merges two sources per row — the tmux user-options a session is BORN with (`spawn --parent/--task`, the
 * actor as owner) and the `session.meta` enrichment a census or supervisor appends to the ledger for the adopted fleet
 * — and prints `-` where a row has neither. The rule is written over the loop itself (src/bin/tmux-agent.ts, case
 * "lineage": "tmux user-options only exist on sessions WE spawned; census session.meta events are the lineage source for
 * the (typical) adopted fleet. Options win when both exist"), the ledger shape in test/unit.test.js's ledger-index cases
 * — and nothing drove the enrichment side through the built CLI: every lineage run in the suite listed sessions with no
 * session.meta row, so `m` was undefined on every line and the verdict/repo/role columns were only ever `-`.
 *
 * Found by TMUX-190's attribution (scratch/ga-fire-2026-10-01-14Z/v8fragile-{1..4}.log): the nine optional-chain ranges
 * of that one console.log line were zero in the four lineage runs of a coverage read and reported as covered in none,
 * so node's coverage merge kept or dropped them by the order it read the dump directory in — the 68.22 / 67.62 reads of
 * dist/bin/tmux-agent.js's branches column on a tree whose src/ had not moved. Once one process evaluates each of them
 * (a fleet where some rows have a meta row and some do not), the merge keeps them as covered whatever the order.
 *
 * Black-box through the built CLI on a throwaway socket and home, a fleet of three on one quiet server:
 *   (a) a session the CLI spawned (options: parent, owner = the actor, task) WITH a session.meta row that also names a
 *       parent — the row carries the options' parent (options win), the actor as owner, the task, and the meta's
 *       verdict, repo@branch and role;
 *   (b) a bare `tmux new-session`, no options and no meta — the adopted session nobody enriched: `-` in every column;
 *   (c) a bare session WITH a session.meta row (a repo without a branch, a parent, a verdict, no role) — the parent comes
 *       from the meta, the repo prints without `@`, the role is `-`;
 *   and exactly three rows, each a single line.
 * FAIL-first (scratch/ga-fire-2026-10-01-14Z/red/): a dist copy whose loop never reads the meta (`const m = undefined`)
 * prints `-` for (a)'s and (c)'s verdict/repo/role and for (c)'s parent; the unmutated copy is green.
 *
 * Run: node --test test/lineage-meta.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";
import { quietServer } from "./helpers/quiet-server.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
// Every CLI run is bounded so a red run cannot hang the suite (a spawn under load has taken ~2 s; lineage well under 1 s).
const BOUND_MS = 30_000;
after(() => removeTempHomes()); // every home this file made

function socket() {
  return `ta-linmeta-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is a string naming the bound when it fired. */
function cli(args, env, timeout = BOUND_MS) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** One census row, appended to the home's ledger the way a supervisor writes it (the shape test/unit.test.js plants). */
function enrich(home, session, data) {
  const dir = join(home, "ledger");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();
  appendFileSync(join(dir, `events-${ts.slice(0, 10)}.ndjson`), JSON.stringify({ v: 1, ts, type: "session.meta", session, data }) + "\n");
}
/** The one lineage line for a session — the whole row, tabs included, so a column cannot drift unnoticed. */
function rowOf(stdout, name) {
  const rows = stdout.split("\n").filter((l) => l.startsWith(`${name}\t`));
  assert.equal(rows.length, 1, `${name}: expected exactly one lineage row, got ${rows.length} in ${JSON.stringify(stdout)}`);
  return rows[0];
}

test("lineage: tmux options and census session.meta rows are merged per session — options win, the meta fills in for an adopted session, a row with neither prints `-` in every column", async () => {
  const H = tempHome("ta-linmeta-");
  const S = socket();
  const env = { TMUX_AGENT_HOME: H, TMUX_AGENT_SOCKET: S };
  const spawned = `lm-spawned-${process.pid}`;
  const bare = `lm-bare-${process.pid}`;
  const adopted = `lm-adopted-${process.pid}`;
  try {
    quietServer(S);
    const sp = await cli(["--socket", S, "--actor", "lm-boss", "spawn", spawned, "--cwd", "/tmp", "--parent", "lm-parent", "--task", "lm-task"], env);
    assert.equal(sp.code, 0, `test setup: spawn exited ${sp.code}: ${sp.stderr.slice(0, 300)}`);
    // the adopted fleet: sessions tmux-agent never spawned, so no user-options and no session.spawned row
    execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", bare, "-c", "/tmp"], { stdio: "ignore" });
    execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", adopted, "-c", "/tmp"], { stdio: "ignore" });
    // the census's view: the spawned one with a parent it GUESSED (the option must win), the adopted one enriched
    enrich(H, spawned, { repo: "org/app", branch: "main", verdict: "KEEP", role: "builds the app", parent: "census-guess" });
    enrich(H, adopted, { repo: "org/lib", parent: "census", verdict: "CLOSE" });

    const r = await cli(["--socket", S, "lineage"], env);
    assert.equal(r.code, 0, `lineage exited ${r.code}: ${r.stderr.slice(0, 300)}`);
    assert.equal(
      rowOf(r.stdout, spawned),
      `${spawned}\tparent=lm-parent\towner=lm-boss\ttask=lm-task\tverdict=KEEP\trepo=org/app@main\trole=builds the app`,
      "(a) the spawned session: options for parent/owner/task (the meta's parent must NOT win), the meta for verdict/repo@branch/role",
    );
    assert.equal(rowOf(r.stdout, bare), `${bare}\tparent=-\towner=-\ttask=-\tverdict=-\trepo=-\trole=-`, "(b) an adopted session nobody enriched prints `-` in every column");
    assert.equal(
      rowOf(r.stdout, adopted),
      `${adopted}\tparent=census\towner=-\ttask=-\tverdict=CLOSE\trepo=org/lib\trole=-`,
      "(c) an adopted session with a meta row: the parent from the meta, the repo without a branch, `-` for the owner, task and role it lacks",
    );
    assert.equal(r.stdout.trim().split("\n").length, 3, `exactly the three sessions, one line each: ${JSON.stringify(r.stdout)}`);
    assert.equal(r.stderr, "", `a live server with sessions warns about nothing: ${JSON.stringify(r.stderr)}`);
  } finally {
    killServerSync(S);
  }
});
