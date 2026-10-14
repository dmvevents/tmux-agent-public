/**
 * `waste --since` honours a window it can read and refuses one it cannot — the reader and the CLI
 * verb (TMUX-103; gates G1 a load-bearing demo path with no test, G3 a silent no-op where README
 * says failures are loud, G6 README.md:54 true only for a well-formed value).
 *
 * README.md:54 is step 5 of the 5-minute demo: `tmux-agent waste --since 2026-08-18T00:00:00Z`;
 * src/bin/tmux-agent.ts:14 documents `waste [--since ISO]`; the MCP `waste-report` tool takes
 * `since`. All of them reach analytics/status.wasteReport, which until 2026-09-14 did
 * `since = sinceIso ? Date.parse(sinceIso) : 0` and skipped events with `Date.parse(ev.ts) < since`.
 * Date.parse returns NaN for anything it cannot read and every comparison with NaN is false — so a
 * mistyped `--since yesterday` filtered nothing and the verb printed the whole ledger with exit 0,
 * indistinguishable from "no window". Measured 2026-09-14 06:3xZ on af231ba and 10:2xZ on cf8321e
 * (scratch/ga-fire-2026-09-14-10Z/since-probe/run1-cf8321e.log): `yesterday`, `2026-13-45T99:00:00Z`
 * and an empty value each printed all three planted sessions, rc=0; and nothing in test/ passed
 * --since or a since: argument, so the flag had no guard at all.
 *
 * The fixture is test/helpers/waste-fixture.js — two live day files, three sessions — shared with
 * test/mcp.test.js so the CLI verb and the MCP tool are held to the same rows. The contract, each
 * line a check that FAILS if the property is removed:
 *   (a) no window: every planted session, errors-first (the control every other case is read against);
 *   (b) a mid-day instant on the 13th returns `late` alone; a date-only day returns `early` and `late`
 *       from UTC midnight — RED when the filter is ignored;
 *   (c) a well-formed window after every event is zero rows and NOT an error;
 *   (d) `yesterday`, a month-13 value, an empty and a blank value are each refused with one message
 *       naming --since, the value and the accepted form — RED on cf8321e, which returned three rows;
 *   (e) the refusal comes BEFORE any file is read: a ledger directory that does not exist still gets
 *       the --since message, never ENOENT (RED on cf8321e: ENOENT is all there is);
 *   (f) the CLI verb: `--since yesterday`, `--since ""` and `--since` as the last argument each exit 64
 *       (EX_USAGE — the code the binary already returns for a bad verb) with no rows on stdout and the
 *       one-line message on stderr, while `--since <mid-day>` exits 0 with the `late` row alone
 *       (RED on cf8321e: exit 0 and three rows for all three).
 *
 * Run: node --test test/waste-since.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./helpers/built-web.js";
import { plantTwoDays, SINCE, ALL_SESSIONS } from "./helpers/waste-fixture.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

import { wasteReport } from "../dist/analytics/status.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const ACCEPTED_FORM = /2026-08-18T00:00:00Z/; // README.md:54's own value is the example the message gives
const sessions = (rows) => rows.map((r) => r.session);
const planted = () => plantTwoDays(join(tempHome("ta-since-"), "ledger"));
after(() => removeTempHomes()); // every home this file made, once its last test has run

/** The one message every surface must give: the flag, the rejected value (or that none was given), the form. */
function assertRefusal(message, value) {
  assert.match(message, /^--since: /, `the message names the flag first: ${message}`);
  if (value.trim() === "") assert.match(message, /no value given/, `an empty value is named as such: ${message}`);
  else assert.ok(message.includes(JSON.stringify(value)), `the rejected value is quoted: ${message}`);
  assert.match(message, ACCEPTED_FORM, `the accepted form is shown: ${message}`);
  assert.equal(message.trim().split("\n").length, 1, `one line, not a stack trace: ${message}`);
}

// (a) the control
test("waste --since: no window lists every planted session, errors first (TMUX-103 control)", () => {
  assert.deepEqual(sessions(wasteReport(planted())), ALL_SESSIONS);
});

// (b) a readable window filters
test("waste --since: a mid-day instant keeps only the later session; a date-only day keeps both from UTC midnight", () => {
  const dir = planted();
  assert.deepEqual(sessions(wasteReport(dir, SINCE.midDay)), ["late"], `--since ${SINCE.midDay}`);
  assert.deepEqual(sessions(wasteReport(dir, SINCE.dayOnly)), ["early", "late"], `--since ${SINCE.dayOnly}`);
});

// (c) empty window ≠ error
test("waste --since: a well-formed window that matches no event is zero rows, not a refusal", () => {
  assert.deepEqual(wasteReport(planted(), SINCE.afterAll), []);
});

// (d) unreadable values are refused
test("waste --since: yesterday, a month-13 value, an empty and a blank value are each refused with one message", () => {
  const dir = planted();
  for (const v of SINCE.unreadable) {
    assert.throws(
      () => wasteReport(dir, v),
      (e) => {
        assertRefusal(String(e.message), v);
        return true;
      },
      `wasteReport(dir, ${JSON.stringify(v)}) must refuse — on cf8321e it returned every session with the window ignored`,
    );
  }
});

// (e) refused before any file is read
test("waste --since: the refusal comes before the ledger is opened — a missing directory still gets the --since message", () => {
  const nowhere = join(tempHome("ta-since-nowhere-"), "no-such-ledger");
  assert.throws(
    () => wasteReport(nowhere, "yesterday"),
    (e) => {
      assert.doesNotMatch(String(e.message), /ENOENT/, "the directory was opened before the window was checked");
      assertRefusal(String(e.message), "yesterday");
      return true;
    },
  );
});

// (f) the CLI verb: exit code, streams
test("waste --since: the CLI exits 64 with one stderr line and no rows on an unreadable value, 0 with the filtered rows on a readable one", () => {
  const home = tempHome("ta-since-cli-");
  plantTwoDays(join(home, "ledger"));
  const cli = (...args) =>
    spawnSync(process.execPath, [BIN, "waste", ...args], {
      env: { ...process.env, TMUX_AGENT_HOME: home, TMUX_AGENT_SOCKET: `ta-since-${process.pid}` },
      encoding: "utf8",
      timeout: 20_000,
    });

  const ok = cli("--since", SINCE.midDay);
  assert.equal(ok.status, 0, `--since ${SINCE.midDay} exited ${ok.status}: ${ok.stderr}`);
  assert.deepEqual(ok.stdout.trim().split("\n").map((l) => l.split("\t")[0]), ["late"], `rows for --since ${SINCE.midDay}`);
  assert.equal(ok.stderr, "", "a readable window says nothing on stderr");

  // `--since` as the last argument has no value to read; the CLI must hand that to the same refusal
  for (const args of [["--since", "yesterday"], ["--since", ""], ["--since"]]) {
    const r = cli(...args);
    const label = `waste ${args.map((a) => JSON.stringify(a)).join(" ")}`;
    assert.equal(r.status, 64, `${label} exited ${r.status}, want 64 (EX_USAGE) — on cf8321e this was 0 with every row (stdout: ${JSON.stringify(r.stdout)})`);
    assert.equal(r.stdout, "", `${label} printed rows it should have refused`);
    assertRefusal(r.stderr, args[1] ?? "");
  }
});
