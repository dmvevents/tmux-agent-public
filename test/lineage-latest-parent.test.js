/**
 * The latest census wins for an adopted session's parent, in EVERY projection — and a parent that came from a real
 * `session.spawned` row stays authoritative over census enrichment.
 *
 * The ledger's rule is written at the top of src/analytics/ledger-index.ts ("Latest event per session wins") and in
 * a design note ("rolled up by LedgerIndex (latest wins, spawn-parent stays authoritative)"), and two readers kept
 * it: `rollup.meta` is replaced wholesale by each `session.meta` row, and `latestSessionMeta()` (the CLI's one-shot
 * reader behind `lineage` and `status`) keeps the last row per session. The rollup's own `parent` did not: until
 * 2026-10-13 (91d9233) `ingest` ran `if (!r.parent && d.parent) r.parent = d.parent;` — first census wins — so an adopted
 * session whose census said parent A and later parent B had `rollup.meta.parent === "B"` and `rollup.parent === "A"`,
 * and `/api/history` (which serves `rollup.parent`) kept A after every other surface had moved on; a census that
 * withdrew the parent left A in place too (the review's `lineage-latest-parent` reproduction).
 *
 * Each check FAILS if the property is removed (RED on 91d9233 quoted in the messages):
 *   (1) LedgerIndex, one adopted session (no spawn row): census parent A, then B, then a row with no parent — after B
 *       `rollup.parent` is B (RED: A); after the withdrawal it is null (RED: A); at each step `rollup.meta.parent` and
 *       `latestSessionMeta()` say the same thing — the three projections agree;
 *   (2) the control: a session with a `session.spawned` row naming its parent keeps that parent through a census that
 *       says otherwise and through one that names none — a true spawn parent is authoritative;
 *   (3) `/api/history` through the built dashboard: planted A then B → the row says B (RED: A); the withdrawal appended
 *       while the daemon runs → the next read says null (the endpoint forces a refresh).
 *
 * Run: npm run build && node --test test/lineage-latest-parent.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { LedgerIndex } from "../dist/analytics/ledger-index.js";
import { latestSessionMeta } from "../dist/analytics/status.js";
import { ROOT, startWeb, stopWeb } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const DAY = "2026-10-01";
const row = (ts, type, session, extra) => JSON.stringify({ v: 1, ts: `${DAY}T${ts}.000Z`, type, session, ...extra });
/** A fresh home whose ledger holds exactly `lines` in one day file; returns [home, ledgerDir]. */
function plant(lines) {
  const home = tempHome("ta-llp-");
  const dir = join(home, "ledger");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `events-${DAY}.ndjson`), lines.join("\n") + "\n");
  return [home, dir];
}
const metaRow = (ts, session, data) => row(ts, "session.meta", session, { data });

test("(1) LedgerIndex: census parent A, then B, then withdrawn — the rollup's parent follows the LATEST census and agrees with meta.parent and latestSessionMeta", () => {
  const [, dir] = plant([metaRow("10:00:00", "adopted", { repo: "org/x", verdict: "KEEP", parent: "hub-a" })]);
  const read = () => {
    const r = new LedgerIndex(dir, 0).sessions(true).find((s) => s.session === "adopted");
    const m = latestSessionMeta(dir).get("adopted");
    return { parent: r?.parent ?? null, metaParent: r?.meta?.parent ?? null, oneShot: m?.parent ?? null };
  };
  assert.deepEqual(read(), { parent: "hub-a", metaParent: "hub-a", oneShot: "hub-a" }, "the first census does not fill the blank");
  appendFileSync(join(dir, `events-${DAY}.ndjson`), metaRow("11:00:00", "adopted", { repo: "org/x", verdict: "KEEP", parent: "hub-b" }) + "\n");
  const afterB = read();
  assert.equal(afterB.metaParent, "hub-b", "meta.parent does not follow the latest census (it always did — then the rollup's parent is the odd one out)");
  assert.equal(afterB.oneShot, "hub-b", "latestSessionMeta does not follow the latest census");
  assert.equal(afterB.parent, "hub-b", `rollup.parent stayed ${JSON.stringify(afterB.parent)} after the census said hub-b — on 91d9233 the first census won (\`if (!r.parent && d.parent)\`) while meta.parent and the one-shot reader said hub-b`);
  appendFileSync(join(dir, `events-${DAY}.ndjson`), metaRow("12:00:00", "adopted", { repo: "org/x", verdict: "RECOMMEND-CLOSE" }) + "\n");
  const withdrawn = read();
  assert.equal(withdrawn.metaParent, null, "a census row without a parent still shows one in meta.parent");
  assert.equal(withdrawn.oneShot, null, "a census row without a parent still shows one in latestSessionMeta");
  assert.equal(withdrawn.parent, null, `rollup.parent stayed ${JSON.stringify(withdrawn.parent)} after the latest census named no parent — the three projections must agree`);
});

test("(2) the control: a parent from a session.spawned row stays authoritative through a census that says otherwise and one that names none", () => {
  const [, dir] = plant([
    row("09:00:00", "session.spawned", "mine", { parent: "boss", data: { cwd: "/tmp", command: null, task: null } }),
    metaRow("10:00:00", "mine", { verdict: "KEEP", parent: "census-guess" }),
  ]);
  const parentOf = () => new LedgerIndex(dir, 0).sessions(true).find((s) => s.session === "mine")?.parent ?? null;
  assert.equal(parentOf(), "boss", "a census guess displaced the spawn parent");
  appendFileSync(join(dir, `events-${DAY}.ndjson`), metaRow("11:00:00", "mine", { verdict: "KEEP" }) + "\n");
  assert.equal(parentOf(), "boss", "a census row without a parent cleared the spawn parent");
  const r = new LedgerIndex(dir, 0).sessions(true).find((s) => s.session === "mine");
  assert.equal(r.meta?.verdict, "KEEP", "the census enrichment is still attached beside the spawn parent");
  assert.equal(r.meta?.parent ?? null, null, "meta.parent keeps the latest census row's own value (none)");
});

test("(3) /api/history through the built dashboard serves the LATEST census parent, and a withdrawal appended while it runs", async () => {
  const [home, dir] = plant([
    metaRow("10:00:00", "adopted", { repo: "org/x", verdict: "KEEP", parent: "hub-a" }),
    metaRow("11:00:00", "adopted", { repo: "org/x", verdict: "KEEP", parent: "hub-b" }),
  ]);
  let child = null;
  try {
    const started = await startWeb(ROOT, home, {}, ["--no-token"]);
    child = started.child;
    const history = async () => {
      const r = await fetch(`http://127.0.0.1:${started.port}/api/history`, { signal: AbortSignal.timeout(15_000) });
      assert.equal(r.status, 200, `/api/history answered ${r.status}`);
      const body = await r.json(); // the TMUX-130 envelope: { sessions, notes }
      const rows = body.sessions ?? [];
      const hit = rows.find((x) => x.session === "adopted");
      assert.ok(hit, `no history row for the adopted session: ${JSON.stringify(body).slice(0, 300)}`);
      return hit;
    };
    const afterB = await history();
    assert.equal(afterB.parent, "hub-b", `/api/history says parent ${JSON.stringify(afterB.parent)} after the census said hub-b — on 91d9233 it served the first census's hub-a (rollup.parent) while /api/fleet's meta.parent said hub-b`);
    appendFileSync(join(dir, `events-${DAY}.ndjson`), metaRow("12:00:00", "adopted", { repo: "org/x", verdict: "RECOMMEND-CLOSE" }) + "\n");
    // the endpoint forces the index to re-read, and the fleet cache is not in this path; one short wait for the append to land
    let withdrawn = await history();
    for (let i = 0; i < 20 && withdrawn.parent !== null; i++) {
      await new Promise((r) => setTimeout(r, 250));
      withdrawn = await history();
    }
    assert.equal(withdrawn.parent, null, `/api/history still says parent ${JSON.stringify(withdrawn.parent)} after the latest census named none`);
    assert.equal(withdrawn.verdict, "RECOMMEND-CLOSE", "the latest census's verdict is served beside it");
  } finally {
    await stopWeb(child);
  }
});
