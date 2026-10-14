// onSignalTeardown — what a unit file can still do when it is killed mid-case. A case's `finally` and an
// `after()` hook are the suite's teardown, and neither runs in a process that dies of a signal: node:test installs no
// SIGTERM, SIGINT or SIGHUP listener in a test file's subprocess (measured on node 22.21.1, under `node --test` and run
// directly: scratch/ga-fire-2026-10-13-08Z/sigprobe/), so the default action ends the file at once — and every tmux
// server it had started outlives it. A server is a daemon, re-parented to init, never a descendant that a process-tree
// kill reaches; its socket and its throwaway home stay with it. The two-hundred-and-seventieth GA fire's TaskStop did
// exactly that at 2026-10-13T06:55:52Z — the harness SIGTERMs every descendant of the task, a setsid'd one included
// (scratch/ga-fire-2026-10-13-08Z/attrib/taskstop-probe.log) — and exec-ready-wait (g)'s held-js server sat on the host
// until a hand removed it eight minutes later (scratch/ga-fire-2026-10-13-06Z/leftover-evidence.log).
//
// Contract: onSignalTeardown(fn) adds ONE listener to each of SIGTERM (TaskStop, a plain `kill`), SIGINT (Ctrl-C at a
// terminal) and SIGHUP (a closed terminal, a dropped ssh). The first of them to arrive runs `fn(signal)` synchronously —
// once, however many signals follow — and the process then exits with 128 + the signal's number, the status a shell
// reads for a death by that signal (143 for SIGTERM). It exits rather than re-raising so that a child the suite spawns
// under --experimental-test-coverage still writes its coverage. A throw from `fn` is reported on stderr and the exit
// still happens: a teardown that fails must not turn a kill into a hang. SIGKILL cannot be caught by anything — that
// path stays the GA runner's hygiene line to report.
import { constants } from "node:os";

/** The catchable signals that end a test file early, in the order the contract above names them. */
export const TEARDOWN_SIGNALS = Object.freeze(["SIGTERM", "SIGINT", "SIGHUP"]);

/**
 * Run `fn(signal)` once when this process receives SIGTERM, SIGINT or SIGHUP, then exit 128 + that signal's number.
 * @param {(signal: string) => void} fn  synchronous teardown — a returned promise would not be awaited
 */
export function onSignalTeardown(fn) {
  let ran = false;
  const onSignal = (signal) => {
    if (!ran) {
      ran = true;
      try {
        fn(signal);
      } catch (e) {
        process.stderr.write(`onSignalTeardown(${signal}): the teardown threw — ${e?.stack ?? e}\n`);
      }
    }
    process.exit(128 + constants.signals[signal]);
  };
  // node hands a signal listener the signal's name as its first argument
  for (const s of TEARDOWN_SIGNALS) process.on(s, onSignal);
}
