// killServerSync — the unit suite's one teardown for an isolated tmux server: `kill-server`, WAIT until tmux
// itself says "no server running", then unlink the socket file tmux leaves behind. A thin wrapper
// over test/helpers/kill-server.sh so the two shell smokes and the unit files share ONE implementation —
// the pairing wait-shell.js/wait-shell.sh already uses. Synchronous on purpose: it replaces a synchronous
// `execFileSync("tmux", ["-L", sock, "kill-server"], { stdio: "ignore" })` in `after()` hooks and `finally`
// blocks that are not async, and the wait is milliseconds on an idle host (the first poll after kill-server
// already read "no server running" when measured).
//
// Rules, from the script: the path comes from tmux (`#{socket_path}` while alive, or the path tmux names in
// its refusal for a server that already died — the *-tmux-down FIXTURE kills stay raw and read that dead
// socket's words), the unlink comes only AFTER tmux says the server is gone, only for a path whose basename
// is `sock`, and a bound overrun THROWS naming the bound with the file left in place — a caller cannot
// mistake a still-answering server for a clean teardown, the way stopWeb() names its own bound.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KILL_SERVER_SH = join(HERE, "kill-server.sh");

/** Seconds a killed server may take to be gone before the helper gives up — stated once, named in the failure. */
export const KILL_SERVER_BOUND_S = 5;

/**
 * Kill the tmux server on `sock` and remove its socket file once tmux says it is gone. No server and no
 * file is a no-op, not a throw — a `finally` may run after a fixture already killed the server, or after
 * a run that refused before starting one.
 * @param {string} sock  tmux -L socket name
 * @param {{bound?: number}} [opts]  bound = wall-clock seconds to wait for "no server running" (default 5)
 * @returns {{removed: boolean, path: string|null, line: string}}  the script's one-line report, parsed
 */
export function killServerSync(sock, opts = {}) {
  const { bound = KILL_SERVER_BOUND_S } = opts;
  let line;
  try {
    line = String(execFileSync("bash", [KILL_SERVER_SH, sock, String(bound)], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: (bound + 10) * 1000, // the script bounds itself; this is the backstop, never the verdict
      killSignal: "SIGKILL",
    })).trim();
  } catch (e) {
    const why = String(e.stderr ?? "").trim() || String(e.message).trim();
    throw new Error(`killServerSync(${sock}): ${why}`);
  }
  const m = /^(removed|no-op) (.+)$/.exec(line);
  if (!m) throw new Error(`killServerSync(${sock}): kill-server.sh printed ${JSON.stringify(line)}, not its one-line report`);
  return { removed: m[1] === "removed", path: m[2].startsWith("<") ? null : m[2], line };
}
