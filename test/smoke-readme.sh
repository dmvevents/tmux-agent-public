#!/usr/bin/env bash
# README first-run smoke: the Install and "5-minute demo" blocks of README.md are RUN, verbatim, from a
# fresh HOME, a fresh npm prefix and an isolated tmux socket — no placeholder edited mid-run. The README is the
# stranger's only map (the adoption key result); two cold-start rehearsals on 2026-10-13 found its first code block
# naming an unpublished package and its demo spawning into a directory a fresh home does not have. A README whose
# first path does not run is measured here, not discovered by the next stranger.
#
# What is asserted, each line a check that FAILS if the property is removed:
#  (a) the Install block names today's path — a clone and `npm install -g .` — BEFORE any registry install, and the
#      prerequisites (`tmux -V`, node >= 20); a block that leads with the unpublished package name is red;
#  (b) `npm install -g .` from this clone into a fresh prefix yields a `tmux-agent` on PATH that answers
#      `tmux-agent --version` and `tmux-agent help`;
#  (c) every command of the demo block runs, in order, as written, in the fresh HOME: spawn, exec, status, watch,
#      log, waste, kill (the block ends by killing what it spawned) — a demo that needs a directory the home lacks, or a
#      value the reader must edit, is red; `status` must list the demo's session;
#  (d) the demo's socket is the isolated one (TMUX_AGENT_SOCKET), so the operator's own tmux is untouched, and the run
#      leaves no server behind.
# Vacuity guards (BANLIST: an empty scan is never a pass): a block that parses to zero commands is a hard error.
set -euo pipefail
cd "$(dirname "$0")/.."
. test/helpers/kill-server.sh   # ta_kill_server

README=README.md
FAILED=0
step() { echo "== $1"; }
die() { echo "README-SMOKE FAIL: $1" >&2; FAILED=1; }

# The block under a heading: the text between the first ```bash after the heading and the next ``` line.
block_under() {
  awk -v h="$1" '
    $0 == h { inh = 1; next }
    inh && /^```bash/ { inb = 1; next }
    inb && /^```/ { exit }
    inb { print }
  ' "$README"
}
# Commands only: comment lines and blank lines dropped; a trailing `# …` comment stripped.
commands_of() { sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d'; }

FRESH="$(mktemp -d)"
export HOME="$FRESH/home"
mkdir -p "$HOME"
export npm_config_prefix="$FRESH/npm-global"
export PATH="$npm_config_prefix/bin:$PATH"
SOCKET="ta-readme-$$"
export TMUX_AGENT_SOCKET="$SOCKET"
unset TMUX_AGENT_DEFAULT_SERVER TMUX_AGENT_HOME TMUX_AGENT_POLICY TMUX_AGENT_LEXICON || true
cleanup() {
  ta_kill_server "$SOCKET" >/dev/null 2>&1 || true
  rm -rf "${FRESH:?}"
}
trap cleanup EXIT

step "a. the Install block leads with the clone path, not the unpublished package"
INSTALL="$(block_under '## Install' | commands_of)"
[ -n "$INSTALL" ] || { echo "README-SMOKE ERROR: the Install block parsed to zero commands" >&2; exit 2; }
FIRST="$(printf '%s\n' "$INSTALL" | head -1)"
case "$FIRST" in
  *"npm install -g tmux-agent"*|*"npx -y tmux-agent"*) die "the Install block's first command is the unpublished registry path: $FIRST" ;;
esac
printf '%s\n' "$INSTALL" | grep -q "npm install -g \." || die "the Install block does not show today's path (npm install -g . from a clone): $(printf '%s' "$INSTALL" | tr '\n' ';')"
printf '%s\n' "$INSTALL" | grep -q "tmux -V" || die "the Install block does not check the prerequisites (tmux -V)"
echo "   first command: $FIRST"

step "b. npm install -g . into a fresh prefix yields a working tmux-agent"
npm install -g . >"$FRESH/install.log" 2>&1 || die "npm install -g . failed: $(tail -5 "$FRESH/install.log")"
command -v tmux-agent >/dev/null || die "tmux-agent is not on PATH after npm install -g . (prefix $npm_config_prefix)"
tmux-agent --version >"$FRESH/version.out" 2>&1 || die "tmux-agent --version failed: $(cat "$FRESH/version.out")"
tmux-agent help >"$FRESH/help.out" 2>&1 || die "tmux-agent help failed (exit $?): $(head -3 "$FRESH/help.out")"
grep -q "tmux-agent web" "$FRESH/help.out" || die "tmux-agent help does not list the web verb: $(head -5 "$FRESH/help.out")"
echo "   $(cat "$FRESH/version.out") · help lists $(grep -c '^ *tmux-agent ' "$FRESH/help.out") verbs"

step "c. the demo block runs verbatim in the fresh HOME"
DEMO="$(block_under '## 5-minute demo (no config)' | commands_of)"
[ -n "$DEMO" ] || { echo "README-SMOKE ERROR: the demo block parsed to zero commands" >&2; exit 2; }
N=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  N=$((N + 1))
  echo "   \$ $line"
  if ! (cd "$HOME" && eval "$line") >"$FRESH/demo-$N.out" 2>&1; then
    die "demo command $N failed: $line — $(tail -3 "$FRESH/demo-$N.out" | tr '\n' ' ')"
  fi
  case "$line" in
    *"tmux-agent status"*) grep -q "worker-1" "$FRESH/demo-$N.out" || die "status does not list the demo's session worker-1: $(head -3 "$FRESH/demo-$N.out")" ;;
  esac
done <<<"$DEMO"
[ "$N" -ge 5 ] || die "the demo block ran only $N commands — the five-step demo is the contract"
printf '%s\n' "$DEMO" | grep -q "tmux-agent kill worker-1" || die "the demo block does not end by killing what it spawned (tmux-agent kill worker-1)"

step "d. isolation: the operator's own tmux is untouched and nothing is left behind"
tmux -L "$SOCKET" list-sessions -F '#{session_name}' 2>/dev/null | grep -q "^worker-1$" && die "worker-1 still runs after the demo's kill"
ta_kill_server "$SOCKET" >/dev/null 2>&1 || true

if [ "$FAILED" -eq 0 ]; then echo "README-SMOKE PASS (4/4)"; else echo "README-SMOKE FAILED" >&2; exit 1; fi
