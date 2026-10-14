#!/usr/bin/env bash
# wait-shell.sh <socket> <session> [bound_s] — hold an `exec` until the pane presents a SHELL to
# exec's own guard. Prints "ready after N attempt(s)" on stdout; exits 1 naming what holds the pane
# if it never does.
#
# Why this exists. A freshly spawned pane passes through a window in which the DEEPEST
# foreground process under it is the host's pty wrapper, not the shell it is about to start:
# kiro-cli-term here, `script` / `asciinema rec` / `expect` elsewhere. exec's guard is RIGHT to
# refuse there — TMUX-97/99 taught it that depth rule, because a keystroke in that window reaches
# the wrapper. Measured on this host 2026-09-17 against the c0012ef dist
# (scratch/ga-fire-2026-09-17-10Z/fgprobe/probe-c0012ef.log): the guard answered shell at t=0.01s,
# "kiro-cli-term" at t=0.66s and shell again from t=1.32s, so `spawn` followed straight by `exec` is
# a coin flip — smoke step 3 was red on 2 of 2 runs at 10:23Z and 2 of 5 on 2026-09-16, while CI
# (whose shells load no wrapper) stayed 13/13 green. So the pane's readiness is a PRECONDITION to
# wait for, not a product bug to route around.
#
# Three rules this helper keeps:
#   - it asks the SHIPPED binary the same question exec asks (a no-op `exec … true`), so it cannot
#     drift from the guard the way a bash re-implementation of the process walk would;
#   - it FAILS LOUD. A pane held by a real pager never becomes ready, and this exits 1 naming the
#     program, so a caller's step goes red instead of silently skipping the thing it meant to test;
#   - `bound_s` is a WALL-CLOCK bound and not a hope: every attempt is itself bounded, so
#     the answer arrives inside bound_s + one attempt bound even when an attempt cannot complete —
#     early enough for the caller's own timeout to be the backstop it was meant to be, never the
#     thing that decides. The overrun this replaced: 120 s measured on a 6 s bound.
#   - a cut names what HELD the pane: the guard's own reading at that moment, the
#     processes under the pane and its last drawn line — read by test/helpers/pane-holder.js the
#     instant after the cut, so an in-suite red says its cause instead of only its count.
#
# env: CLI_BIN (default dist/bin/tmux-agent.js), TMUX_AGENT_HOME as the caller set it.
# Portable to macOS CI's bash 3.2: no associative arrays, no `bc`, no `date +%N`.
set -u

SOCK="${1:?usage: wait-shell.sh <socket> <session> [bound_s]}"
SESS="${2:?usage: wait-shell.sh <socket> <session> [bound_s]}"
BOUND="${3:-15}"
BIN="${CLI_BIN:-dist/bin/tmux-agent.js}"

# Per-ATTEMPT bound. Until 2026-09-17 the bound above was checked only BETWEEN attempts,
# and one attempt is an `exec` — bounded by execSync's own default of 120 s (src/core/orchestrator.ts:315;
# the CLI verb passes no override). So an attempt that lands where the pane TAKES the injected line but
# nothing ever completes it — the `sleep`→`exec bash` handoff instant, a shell still running its init,
# or a pane with no `sh` on its PATH — blocked for two minutes, the stated bound (20 s at smoke steps 3
# and 12) was not a bound at all, and the caller's own timeout killed this script before the line below
# could name anything: `npm test` 18:23Z was red with case (b) "killed after 40000 ms" on a 30 s bound,
# stdout AND stderr empty, and the assertion then blamed the wait for "giving up" (measured in-suite by
# xtrace: attempt 13 started at s=5 and never returned; scratch/ga-fire-2026-09-17-18Z/wsprobe/).
# 5 s is ~10x the round trip measured idle on this host (13 attempts in 6 s ≈ 0.46 s each), so it cuts
# only an attempt that is genuinely stuck — and a cut is not a verdict: the loop retries inside BOUND,
# which is what makes a transitioning pane still become ready.
ATTEMPT_BOUND=5
# What a cut could not say. Three `npm run test:coverage` reads of six on the clean
# 62d7536 tree lost test/positional-count.test.js:102 to "(4 attempts, 4 cut, 0 refused)" — the
# guard had seen a shell four times (or it would have refused) and the pane completed nothing —
# and that line could name no cause: a shell still in its login rc, a key-replaying line editor,
# the host's pty wrapper and a wedged `tmux wait-for` all read the same. So after each cut the
# helper beside this one asks the SHIPPED guard what it sees, lists the processes under the pane
# and quotes its last drawn line (redacted, 120 chars); the give-up keeps the LAST cut's answer.
# Bounded like an attempt: a diagnostic must never hold the wait it serves.
HOLDER="$(dirname "${BASH_SOURCE[0]}")/pane-holder.js"
HOLDER_BOUND=4

started=$(date +%s)
attempt=0
cuts=0
saw_refusal=0
last=""
last_refusal=""
cut_note=""
# The attempt's output goes to a FILE, not to a command substitution: a killed `exec` can leave an
# orphaned `tmux wait-for` client behind, and an orphan holding the caller's pipe would keep `$(...)`
# open long after this script exits (the class of hang test/smoke-web.sh already learned once).
attempt_out=$(mktemp "${TMPDIR:-/tmp}/wait-shell-XXXXXX") || {
  echo "wait-shell: cannot make a temp file under ${TMPDIR:-/tmp} — refusing to wait blind" >&2
  exit 1
}
trap 'rm -f "$attempt_out"' EXIT

while :; do
  left=$((BOUND - ($(date +%s) - started)))
  # One attempt always happens, however small the bound: a caller asking for readiness gets an answer
  # about the pane, never an answer about arithmetic.
  [ "$left" -le 0 ] && [ "$attempt" -gt 0 ] && break
  [ "$left" -lt 1 ] && left=1
  bound_now=$ATTEMPT_BOUND
  [ "$bound_now" -gt "$left" ] && bound_now=$left
  attempt=$((attempt + 1))
  # `true` is the smallest command the guard-then-inject path accepts: rc 0 means the pane was at a
  # shell prompt AND the injection round trip works, which is exactly the precondition the caller wants.
  node "$BIN" --socket "$SOCK" exec "$SESS" true > "$attempt_out" 2>&1 &
  probe=$!
  # The watchdog, not a poll: `kill -0` cannot tell a live process from a zombie, and `wait` reports the
  # signal (137) plainly. Its own output goes nowhere so it holds no descriptor of the caller's.
  ( sleep "$bound_now"; kill -9 "$probe" ) >/dev/null 2>&1 &
  killer=$!
  wait "$probe" 2>/dev/null
  rc=$?
  kill "$killer" >/dev/null 2>&1
  wait "$killer" 2>/dev/null
  last=$(cat "$attempt_out")
  if [ "$rc" -eq 0 ]; then
    echo "ready after $attempt attempt(s)"
    exit 0
  fi
  # >128 is the watchdog's SIGKILL: the pane took the line and nothing completed it, which is a
  # different fact from a refusal and the one the old diagnostic could never report. Both are
  # COUNTED, because the give-up line kept only the LAST cut and the LAST attempt's
  # output: a bound spent entirely on a wedged pane and a bound spent refusing every time read
  # identically, and they have different causes. The in-suite red that filed that card —
  # `npm test` on the clean 6b16055 tree, case (b), "(17 attempts) — attempt 17 cut at 4s" —
  # could be read either way from its one line, and the fire holding it could not reproduce it.
  if [ "$rc" -gt 128 ]; then
    cuts=$((cuts + 1))
    # The pane is unchanged by the kill above — it was the exec CLIENT that died — so what holds the
    # pane now is what held it at the attempt. Same watchdog shape as the attempt; the output file is
    # the attempt's, whose contents a cut has no further use for.
    node "$HOLDER" "$BIN" "$SOCK" "$SESS" > "$attempt_out" 2>&1 &
    holder_probe=$!
    ( sleep "$HOLDER_BOUND"; kill -9 "$holder_probe" ) >/dev/null 2>&1 &
    holder_killer=$!
    wait "$holder_probe" 2>/dev/null
    holder_rc=$?
    kill "$holder_killer" >/dev/null 2>&1
    wait "$holder_killer" 2>/dev/null
    if [ "$holder_rc" -gt 128 ]; then
      holder="the pane could not be read inside ${HOLDER_BOUND}s"
    else
      # 1200, not 400: since TMUX-170 the helper's line carries the wait channels, the unread bytes on each pty,
      # the verdict they earn and the pane's last three lines AFTER the product's own three facts — a 400 cut
      # kept the product's line and dropped everything the card asked for (measured ~950 chars on a wrapped pane).
      holder=$(tr '\n' ' ' < "$attempt_out" | cut -c1-1200 | sed 's/[[:space:]]*$//')
      [ -z "$holder" ] && holder="the pane could not be read (rc $holder_rc)"
    fi
    cut_note="attempt $attempt cut at ${bound_now}s still inside exec (the pane took the injected line, nothing completed it; $holder); "
  else
    saw_refusal=1
    last_refusal=$last
  fi
  [ $(($(date +%s) - started)) -ge "$BOUND" ] && break
  sleep 0.25
done

# A refusal can carry empty output, so what decides this clause is whether an attempt was refused —
# never whether there is text to quote. "no attempt was refused" is a statement about the pane.
if [ "$saw_refusal" -eq 1 ]; then
  refusal_note="last refusal: $(echo "$last_refusal" | tr '\n' ' ' | cut -c1-200)"
else
  refusal_note="no attempt was refused"
fi
echo "wait-shell: $SESS never presented a shell to exec's guard within ${BOUND}s ($attempt attempts, $cuts cut, $((attempt - cuts)) refused) — ${cut_note}${refusal_note}" >&2
exit 1
