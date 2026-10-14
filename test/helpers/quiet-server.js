// quietServer — start the throwaway tmux server a CLI-driven unit file spawns on so that the pane the SHIPPED `spawn`
// creates is a BARE shell: `bash --norc --noprofile` as the pane's own command, nothing between tmux's keystrokes and
// the prompt that runs them.
//
// Why. `spawn` passes new-session no command, so the pane runs tmux's default: the operator's LOGIN shell, which on the
// release host reads a profile that execs a pty wrapper (kiro-cli-term) around a second shell that loads a key-replaying
// line editor (ble.sh). Four of twelve `npm run test:coverage` reads on the clean 3762586 tree (2026-09-28 00:33Z,
// scratch/ga-fire-2026-09-28-00Z/wedge-giveups.log) lost a CLI-driven case to waitForShell's 20 s give-up with the die
// reading `kiro-cli-term(S) > bash(S); its last line read "<the bare prompt>"` — the guard saw a shell, the injected line
// was drawn nowhere, and everything between tmux and the prompt was the host's, not this repo's. exec-ready-wait's own
// (a)/(b) have handed off to exactly this shell since TMUX-146 for the same reason; this routes the three files that
// spawn THROUGH the CLI (positional-count, unknown-flags, versioning-contract's driven home) the same way. What those
// files measure — argument counting, flag refusal, the paths a driven home carries — never depended on the pane's shell.
//
// How. `default-command` is the command new-session runs when given none; set on the GLOBAL session options of a server
// started here, every session the CLI then creates on this socket gets it, and tmux runs it non-login through its
// default-shell's `-c` — so no profile, no wrapper, no rc. `exit-empty off` keeps the sessionless server alive between
// this call and the CLI's new-session (tmux otherwise exits a server the moment it holds no session). The caller still
// owns teardown — killServerSync(sock) as before — and the CLI's spawn is unchanged: this is the server's configuration,
// not the product's.
//
// The check that fails when this is removed: exec-ready-wait (k) plants a login profile that installs a pty wrapper and
// asserts the CLI-spawned pane on a quiet server is the bare shell alone, while its control without this call is not.
import { execFileSync } from "node:child_process";

/** The shell the CLI-driven files' panes run — the same handoff shell exec-ready-wait's (a)/(b) use. */
export const QUIET_SHELL = "bash --norc --noprofile";

/**
 * Start the tmux server on `sock` (an isolated `-L` socket of the caller's own) with QUIET_SHELL as its
 * default-command. Idempotent on a server already running: the options are simply set again.
 * @param {string} sock  tmux -L socket name
 */
export function quietServer(sock) {
  execFileSync(
    "tmux",
    ["-L", sock, "start-server", ";", "set-option", "-s", "exit-empty", "off", ";", "set-option", "-g", "default-command", QUIET_SHELL],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}
