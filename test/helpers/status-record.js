/**
 * The keys a REAL `status.json` session record carries, driven out of the SHIPPED path once per process.
 *
 * This moved out of test/versioning-contract.test.js in TMUX-153 for one reason: a second suite now owes
 * the same authority. README.md's `status.json` gloss (README.md:193) names the per-session fields a
 * collector reads, and the card's rule for it is "second authority, not a second copy" — if the README
 * check compared against a hand-typed key list, or against VERSIONING.md's declaration alone, a rename in
 * the declaration would make doc and doc agree while the package wrote something else. Both readers now
 * drive the same writer, so neither can be satisfied by a doc edit.
 *
 * Extracted VERBATIM (TMUX-134's function, its bounds and its comments) rather than re-derived: the
 * archive planter duplicated across three suites is the shape this avoids.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { killServerSync } from "./kill-server.js";

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** True when no tmux server exists on the socket at all — not "no sessions", the server itself is not there. */
export function serverAbsent(sock) {
  try {
    execFileSync("tmux", ["-L", sock, "list-sessions"], { stdio: ["ignore", "pipe", "pipe"] });
    return false;
  } catch (e) {
    return /no server running|error connecting/.test(String(e.stderr));
  }
}

/**
 * `kill-server` returns before the server has finished exiting (TMUX-116/f1a60d9: killing is a signal, not a
 * state), and a home removed while tmux is still writing its pipe-pane log into it is the macOS ENOTEMPTY
 * TMUX-129 paid for — so the teardown below waits for the server to be gone before the home goes, bounded.
 */
export async function untilServerAbsent(sock, ms = 5000) {
  const t0 = Date.now();
  while (!serverAbsent(sock)) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

/**
 * The keys of a status.json SESSION record the shipped path wrote for ONE REAL session, read once per run.
 * The suites' other status.json reader cannot serve this: it reads a socket no server has ever run on, so
 * `sessions` is [] and the fields would be compared against nothing — the vacuous pass these suites refuse
 * everywhere else. This one therefore drives real tmux on a throwaway socket and home (the recipe
 * test/status-tmux-down.test.js, test/gone-reason.test.js and test/empty-server-reachable.test.js already use —
 * the operator's fleet is never touched) and lets the built CLI write the file, because the FILE is what an
 * external reader parses and the record is assembled from two modules: ten fields come from the Monitor
 * snapshot, four are added by publishStatus itself.
 *
 * Which spawner made the session does not decide the shape: measured on bc2d872
 * (scratch/ga-fire-2026-09-19-12Z/probe/session-keys-bc2d872.log) a raw `tmux new-session` and the `spawn` verb
 * produce the SAME 14 keys, a spawned session differing only in `parent`/`owner` carrying values. The verb is
 * used here so the record is the one the whole shipped path produces. Bounded, so a run that hangs ends inside
 * the bound rather than taking the suite with it.
 *
 * `label` names the caller in the throwaway socket and home so two suites running concurrently under
 * `node --test` cannot collide on a socket name — the pid alone is not enough once more than one file calls this.
 */
const written = new Map();
export function shippedSessionRecord(label = "contract") {
  if (!written.has(label)) {
    written.set(label, (async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), `ta-${label}-session-`)));
      const sock = `ta-${label}-sess-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
      const name = `ta${label}-${process.pid}`;
      const out = join(dir, "live.json");
      const cli = (args) => execFileP(process.execPath, [join(ROOT, "dist", "bin", "tmux-agent.js"), "--socket", sock, ...args],
        { cwd: ROOT, env: { ...process.env, TMUX_AGENT_HOME: join(dir, "home") }, timeout: 25_000, killSignal: "SIGKILL" });
      try {
        assert.ok(serverAbsent(sock), `the throwaway socket ${sock} already has a tmux server`);
        await cli(["spawn", name, "--cwd", dir, "--parent", "versioning-contract"]);
        await cli(["status", "--json", out]);
        const s = JSON.parse(readFileSync(out, "utf8"));
        const record = s.sessions.find((r) => r.session === name);
        assert.ok(record, `the built CLI wrote a status.json without the session it had just spawned (sessions: ${s.sessions.map((r) => r.session).join(",") || "none"}; tmux: ${JSON.stringify(s.tmux)}) — refusing to judge a documented per-session list against nothing`);
        return Object.keys(record);
      } finally {
        killServerSync(sock);
        await untilServerAbsent(sock);
        rmSync(dir, { recursive: true, force: true });
      }
    })());
  }
  return written.get(label);
}
