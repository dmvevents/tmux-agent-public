// waitForShell — the one place the unit suite waits for a freshly spawned pane to present a SHELL to
// exec's own guard before it types. A pane passes through a window in which its
// deepest foreground process is the host's pty wrapper (kiro-cli-term here, `script`/`expect`
// elsewhere) or the `sleep` of a still-running login rc, and exec's guard is RIGHT to refuse an
// injection there. The smoke and exec-ready-wait suites already waited via test/helpers/wait-shell.sh;
// the CLI-driven unit files typed on the watch `--idle-secs` exit or on a quiet-capture loop, neither
// of which is the guard's question — an idle pane can still be held by kiro-cli. This asks the SHIPPED
// binary the same no-op `exec … true` the shell script does, so it cannot drift from the guard, and it
// THROWS with the helper's own stderr when the pane never becomes ready, so a caller can neither type
// into a pane the guard would refuse nor forget the assertion.
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WAIT = join(HERE, "wait-shell.sh");
const BIN = join(HERE, "..", "..", "dist", "bin", "tmux-agent.js");

/**
 * Resolve once `sess` on `sock` presents a shell to exec's guard; reject (THROW) with wait-shell.sh's
 * stderr — which names what holds the pane — if it never does within `bound` seconds.
 * @param {string} sock  tmux -L socket the session lives on
 * @param {string} sess  session name
 * @param {{home?: string, bound?: number}} [opts]  home = TMUX_AGENT_HOME the caller drove the CLI with;
 *   bound = wall-clock seconds (default 20; the helper bounds each attempt at 5 s under this).
 * @returns {Promise<string>} the helper's "ready after N attempt(s)" line
 */
export function waitForShell(sock, sess, opts = {}) {
  const { home, bound = 20 } = opts;
  const env = { ...process.env, CLI_BIN: BIN };
  if (home !== undefined) env.TMUX_AGENT_HOME = home;
  return new Promise((resolve, reject) => {
    execFile(
      "bash",
      [WAIT, sock, sess, String(bound)],
      { env, timeout: (bound + 10) * 1000, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        if (err) {
          const why = String(stderr).trim() || String(err.message).trim();
          reject(new Error(`waitForShell(${sess}): ${why}`));
          return;
        }
        resolve(String(stdout).trim());
      },
    );
  });
}
