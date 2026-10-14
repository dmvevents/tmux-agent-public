/**
 * The one arm of assertOutPath that no process in the suite takes, driven on purpose in ONE process.
 *
 * dist/analytics/status.js's row read 99.32 / 93.51 / 100.00 in most coverage reads of one tree and 98.64 / 92.31 (or
 * 91.14) with lines 113-114 "uncovered" in some — twelve such reads in the groom record by 2026-10-02 — with no change
 * under it. Five reporter-mode reads of the whole suite on d7645d0 with NODE_V8_COVERAGE kept (scratch/ga-fire-2026-10-02-08Z/
 * cov-raw-{1..5}.log, v8-{1..5}/) and an exact replay of node v22.21.1's coverage merge (v8file.py there, agreeing with the
 * reporter byte for byte in every read) say why, and it is not what the row seems to say:
 *   - lines 113-114 — `catch { throw new OutPathError(source, path, "permission denied"); }`, the parent's
 *     accessSync(W_OK | X_OK) failing for a path that does not exist yet — are executed by NO process of the 509 that load
 *     the file (linecov.py: covered in 0, zero in 509, in the reads that print 113-114 AND in the reads that do not). Every
 *     one of the 49 processes that call assertOutPath reports that catch at count 0 or inside a larger zero range.
 *     test/out-path.test.js's 000-mode parent never reaches it: statSync(<000 dir>/x.json) fails with EACCES, not ENOENT,
 *     which is line 96's arm.
 *   - The covered branch count is 72 in every read; only the TOTAL moves — 77, 78 or 79 — and the uncovered lines with it.
 *     Node's merge keeps a zero range only while every later dump either reports the same offsets or reports a zero range
 *     that nests with it, and the exact-offset check `break`s the scan: a later process whose zero range for the WHOLE
 *     `catch (pe)` block (or the whole outer catch) exactly matches a covered range already merged drops every zero range
 *     nested inside it before the scan reaches them (tracestep-18Z-2-471.log). Dump-directory order is ext4 hash order, so
 *     which of this function's two fragile zero ranges survive is a per-read lottery: [5772-5860] L112-114 (this catch) and
 *     [5540-5561] L105 (the `: "permission denied"` arm of the parent-stat catch). Both kept = 72/79 = 91.14 with 113-114
 *     printed; the catch alone = 72/78 = 92.31 with 113-114; the L105 arm alone = 72/78 = 92.31 with the lines intact;
 *     neither = 72/77 = 93.51 — the four values the record holds for this content (v8diff-2-1-status.log,
 *     v8file-18Z-2-status-k200.log).
 * A covered range survives every merge order, so one process that TAKES the catch pins it: this file. The L105 arm cannot
 * be taken: it needs statSync(parent) to fail with a code other than ENOENT/ENOTDIR right after statSync(child) failed with
 * one of them, and a child ENOENT means every component of the parent was just traversed — barring a race between the two
 * calls there is no such path. It stays a named lottery of ±1 on this row's total (73/78 = 93.59 against 73/79 = 92.41 once
 * this file runs), as does dist/mcp/server.js's `?? e` in `String(e.message ?? e)` (the tool-call catch, dist L291; 51/59 =
 * 86.44 against 51/60 = 85.00): no `throw` or `reject()` in src/ hands that catch anything but an Error, so the right
 * operand is a zero range in every process that reaches the catch and cannot be covered from the MCP surface
 * (v8diff-18Z-7-8-mcp.log names it as the ONE range differing between an 86.44 and an 85.00 read).
 *
 * The case: a directory of mode 0500 inside a throwaway home — this user may enter it and list it, not create in it — and
 * a file name under it that does not exist. The arm's three preconditions are asserted first, so the throw is line 112-114's
 * catch and no other: statSync(child) fails with ENOENT (not line 96's arm), statSync(parent) succeeds and is a directory
 * (not line 105's, not line 108's), accessSync(parent, W_OK | X_OK) fails with EACCES. Then assertOutPath on that path
 * throws OutPathError with the CLI's exact words for both sources; the same directory at 0700 returns the absolute path
 * (the control: nothing but the mode differs); and the judgement created nothing. Skipped, said out loud, where this user
 * can write a 0500 directory (root).
 * FAIL-first (scratch/ga-fire-2026-10-02-08Z/red/): a dist copy with the parent's accessSync try/catch removed returns the
 * path and is red; a test copy that makes the parent 0700 fails the on-disk mode check — asserted BEFORE the root skip, so a
 * missing driver can never pass as "root" — and is red; the unmutated copy is green.
 *
 * Run: node --test test/out-path-arms.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { accessSync, chmodSync, constants, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertOutPath, OutPathError } from "../dist/analytics/status.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

const HOME = tempHome("ta-outpath-arms-");
const RO = join(HOME, "ro");
after(() => {
  // an empty 0500 directory is removable (its parent is ours), but hand it back writable first so a red run strands nothing
  try {
    chmodSync(RO, 0o700);
  } catch {
    /* never made */
  }
  removeTempHomes(); // the one home this file makes
});

/** The code an fs call failed with, or null when it succeeded. */
function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e.code ?? String(e);
  }
}

test("assertOutPath: a parent this user can enter but not write — child ENOENT, the parent a directory, accessSync(W_OK | X_OK) EACCES — is `permission denied` from the parent arm", (t) => {
  mkdirSync(RO, { mode: 0o500 });
  const child = join(RO, "x.json");
  // the driver first, on disk: a copy of this file that makes the parent writable must be RED here, never skipped below
  assert.equal(statSync(RO).mode & 0o777, 0o500, "the fixture's parent is not 0500 — the arm's driver is gone");
  if (codeOf(() => accessSync(RO, constants.W_OK | constants.X_OK)) === null) {
    t.skip("this user can write a 0500 directory (running as root?) — the arm is unreachable here and the row's wobble stays");
    return;
  }
  // the arm's three preconditions, so the throw below is line 112-114's catch and not line 96's (EACCES on the child),
  // line 105's (the parent's stat failed) or line 108's (the parent is not a directory)
  assert.equal(codeOf(() => statSync(child)), "ENOENT", "the child must be absent through a searchable parent");
  assert.ok(statSync(RO).isDirectory(), "the parent must stat as a directory");
  assert.equal(codeOf(() => accessSync(RO, constants.W_OK | constants.X_OK)), "EACCES", "the parent must refuse W_OK | X_OK");
  for (const source of ["--json", "--out"]) {
    assert.throws(
      () => assertOutPath(child, source),
      (e) => e instanceof OutPathError && e.name === "OutPathError" && e.message === `${source}: cannot write ${JSON.stringify(child)} — permission denied`,
      `assertOutPath(<new name under a 0500 directory>, ${source}) did not throw the CLI's line`,
    );
  }
  assert.deepEqual(readdirSync(RO), [], "the judgement created something under the directory it refused");
  // the control: the same path with the one difference removed is the absolute path, and still nothing is created
  chmodSync(RO, 0o700);
  assert.equal(assertOutPath(child, "--json"), child, "a new name in a directory this user can write is not the absolute path");
  assert.deepEqual(readdirSync(RO), [], "the judgement created the file");
});
