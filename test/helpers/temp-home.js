// tempHome / removeTempHomes — the unit suite's one way to make a throwaway TMUX_AGENT_HOME under os.tmpdir() AND
// take it away again. The sibling of killServerSync (TMUX-163, beside this file): that helper closed the socket FILES an
// isolated tmux server leaves behind; this one closes the HOME DIRECTORIES the fixtures leave behind.
//
// Measured on 5781e97 (scratch/ga-fire-2026-09-26-04Z/delta-parent.log): eleven test files mkdtemp'd a home and
// nine of them never called rmSync at all, so every `npm test` left 63 `ta-*` directories directly under /tmp —
// 21 from orchestrator.test.js alone — and the host held 6,447 of them 51 h after the reboot that wiped /tmp.
// The bytes are trivial (2.8 MB for 5,929); the cost is a /tmp nobody can read while debugging on the host and a
// suite that does not clean up after itself, the reason TMUX-163 was worth shipping.
//
// Contract: tempHome(prefix) is mkdtempSync(join(tmpdir(), prefix)) that REMEMBERS what it made; removeTempHomes()
// removes everything remembered (recursive, force — a home a child process is still holding open is removed all the
// same on Linux and macOS) and returns the list, so a caller can assert what went. A file calls
// `after(() => removeTempHomes())` once at top level: node:test runs it after the file's last test whatever the
// verdicts were. The meter that FAILS when a file forgets is test/helpers/temp-home-meter.sh, driven by
// test/temp-home-leak.test.js over a named set of files; that suite's drift guard also reds a file that calls
// tempHome() without ever calling removeTempHomes().
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Every directory tempHome() made in this process that removeTempHomes() has not yet removed. */
const made = new Set();

/**
 * A fresh directory directly under os.tmpdir(), named `<prefix>XXXXXX`, remembered for removeTempHomes().
 * @param {string} prefix  the fixture's label, `ta-<something>-` by convention (the meters count `ta-*`)
 * @returns {string} absolute path
 */
export function tempHome(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.add(dir);
  return dir;
}

/**
 * Remove every directory tempHome() made and forget it. Idempotent: a second call removes nothing and returns [].
 * @returns {string[]} the paths removed, in creation order
 */
export function removeTempHomes() {
  const gone = [...made];
  for (const dir of gone) {
    rmSync(dir, { recursive: true, force: true });
    made.delete(dir);
  }
  return gone;
}

/** How many homes are currently remembered — the meter's own self-check, never a fixture's. */
export function pendingTempHomes() {
  return made.size;
}
