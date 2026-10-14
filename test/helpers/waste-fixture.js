/**
 * The two-day ledger behind TMUX-103's `--since` checks. test/waste-since.test.js (the reader and
 * the CLI verb) and test/mcp.test.js (the `waste-report` tool) plant the same days, so a window that
 * lands between them means the same rows on every surface — the property under test is that the
 * two surfaces cannot drift. Event for event this is block A of the fire's probe
 * (scratch/ga-fire-2026-09-14-06Z/since-probe/probe.sh, run1-af231ba.log).
 *
 * Lives in test/helpers/ on purpose: `npm run test:unit` globs test/*.test.js one level deep, so a
 * file here is imported by suites, never run as a suite of its own.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Three sessions across two live day files: `old-day` on the 12th (events=3, errors=0, churn=1,
 * inputs=1); on the 13th `early` at 01:00Z (events=3, errors=1 — a control.denied — churn=1) and
 * `late` at 20:00Z (events=2, errors=1 — an exec.timeout — churn=0). The errors-first sort therefore
 * lists early, late, old-day when no window is given.
 */
const DAYS = {
  "2026-09-12": [
    ["2026-09-12T10:00:01.000Z", "session.spawned", "old-day", { cwd: "/tmp" }],
    ["2026-09-12T10:00:02.000Z", "input.sent", "old-day", { bytes: 4 }],
    ["2026-09-12T10:00:03.000Z", "session.state", "old-day", { from: "WORKING", to: "IDLE", via: "cpu" }],
  ],
  "2026-09-13": [
    ["2026-09-13T01:00:01.000Z", "session.spawned", "early", { cwd: "/tmp" }],
    ["2026-09-13T01:00:02.000Z", "control.denied", "early", { action: "exec", reason: "deny-list" }],
    ["2026-09-13T01:00:03.000Z", "session.state", "early", { from: "WORKING", to: "IDLE", via: "cpu" }],
    ["2026-09-13T20:00:01.000Z", "session.spawned", "late", { cwd: "/tmp" }],
    ["2026-09-13T20:00:02.000Z", "exec.timeout", "late", { id: "x", timeoutMs: 1000, elapsedMs: 1002, command: "sleep 5" }],
  ],
};

/** The windows the suites ask about, and what each must answer. */
export const SINCE = {
  /** a mid-day instant on the 13th: `late` only */
  midDay: "2026-09-13T12:00:00Z",
  /** a date-only day (UTC midnight): `early` and `late` */
  dayOnly: "2026-09-13",
  /** well-formed, after every planted event: no rows, and not an error */
  afterAll: "2027-01-01T00:00:00Z",
  /** values Date.parse cannot read — each is refused, none filters silently */
  unreadable: ["yesterday", "2026-13-45T99:00:00Z", "", "   "],
};
export const ALL_SESSIONS = ["early", "late", "old-day"];

/** Write the two day files under `ledgerDir` (created if absent); returns `ledgerDir`. */
export function plantTwoDays(ledgerDir) {
  mkdirSync(ledgerDir, { recursive: true });
  for (const [day, rows] of Object.entries(DAYS)) {
    const lines = rows.map(([ts, type, session, data]) => JSON.stringify({ v: 1, ts, type, session, actor: "fixture", data }));
    writeFileSync(join(ledgerDir, `events-${day}.ndjson`), lines.join("\n") + "\n");
  }
  return ledgerDir;
}
