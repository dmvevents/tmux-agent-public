#!/usr/bin/env bash
# kill-server.sh — `ta_kill_server <socket> [bound_s]`: kill an isolated tmux server AND remove the socket
# file it leaves behind, once tmux itself says the server is gone.
#
# Why this exists. tmux does not unlink its socket when the server exits: after `kill-server`,
# `list-sessions` answers "no server running on <path>" on its first poll and the path is still there
# 2.5 s later (scratch/ga-fire-2026-09-24-18Z/probe-socket-unlink.log, tmux 3.4). Every unit file that
# spawns a pane starts its own `tmux -L ta-<label>-<pid>-<rand>` server, so one `npm run test:coverage`
# left +44 `ta-*` files in /tmp/tmux-<uid> (2,588 → 2,632 on the 4814277 tree, 0 servers alive after)
# and the directory held 21,608 before the 2026-09-24 reboot — a footprint TMUX-161's "no `tmux -L
# ta-*` server left behind" could not see, because it counted processes and the processes were gone.
#
# Three rules this helper keeps:
#   - the path is TMUX'S answer, never a literal: `display -p '#{socket_path}'` while the server is
#     alive (macOS puts it under $TMPDIR and $TMUX_TMPDIR moves it anywhere), or — for a server that is
#     already dead, the shape the *-tmux-down suites leave after their FIXTURE kill — the path tmux names
#     in its own refusal, "no server running on <path>" / "error connecting to <path> (…)";
#   - it unlinks only AFTER tmux says there is no server on the name (killing is a signal, not a state —
#     TMUX-116, f1a60d9: a file removed while its server still exits would be re-created or left
#     dangling), and only a path whose basename IS the socket it was given — never a socket it did not
#     name;
#   - the wait is bounded (bound_s, default 5 — the bound stopWeb() and the suites' untilServerAbsent()
#     already use) and an overrun FAILS LOUD on stderr with the file left in place: a server that still
#     answers is not one whose socket may be removed.
#
# stdout, one line: `removed <path>` | `no-op <path>` (nothing there to remove) | `no-op <no path from tmux>`.
# Exit 1 with the reason on stderr when a server still answers past the bound.
# Sourced by test/smoke.sh and test/smoke-web.sh (`. test/helpers/kill-server.sh`); run as a script by
# test/helpers/kill-server.js (`bash kill-server.sh <socket> [bound_s]`) — one implementation, two callers,
# the pairing wait-shell.js/wait-shell.sh already uses.
# Portable to macOS CI's bash 3.2: no associative arrays, no `date +%N`; BSD `sleep` takes 0.025.

ta_kill_server() {
  local sock="${1:?usage: ta_kill_server <socket> [bound_s]}" bound="${2:-5}"
  local path="" out="" started now
  # (1) the path while the server is alive — tmux's own words for where it listens
  if out=$(tmux -L "$sock" display -p '#{socket_path}' 2>/dev/null); then path="$out"; fi
  # (2) the signal
  tmux -L "$sock" kill-server >/dev/null 2>&1 || true
  # (3) the state: poll until tmux itself says there is no server on the name
  started=$(date +%s)
  while :; do
    if out=$(tmux -L "$sock" list-sessions 2>&1); then
      out=""            # rc 0: a server answered (even one with zero sessions) — still alive
    fi
    case "$out" in
      "no server running on "*)
        [ -n "$path" ] || path="${out#no server running on }"
        break ;;
      "error connecting to "*)   # `error connecting to <path> (No such file or directory)`: no file at all
        if [ -z "$path" ]; then path="${out#error connecting to }"; path="${path% (*}"; fi
        break ;;
    esac
    now=$(date +%s)
    if [ $((now - started)) -ge "$bound" ]; then
      echo "ta_kill_server: a server still answers on $sock ${bound}s after kill-server — its socket file is left in place" >&2
      return 1
    fi
    sleep 0.025
  done
  # (4) the unlink — only the socket this call was given
  if [ -z "$path" ]; then echo "no-op <no path from tmux>"; return 0; fi
  if [ "$(basename "$path")" != "$sock" ]; then
    echo "ta_kill_server: tmux named $path for socket $sock — not a path this call may remove" >&2
    return 1
  fi
  if [ -e "$path" ]; then
    rm -f "$path"
    echo "removed $path"
  else
    echo "no-op $path"
  fi
}

# Run as a script (`bash kill-server.sh <socket> [bound_s]`): do the one thing. Sourced: define only.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -u
  ta_kill_server "$@"
fi
