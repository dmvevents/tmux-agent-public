#!/usr/bin/env bash
# Vertical-slice smoke: spawn → monitor → capture → message round-trip → notify → status.json.
# Runs on an ISOLATED tmux socket + throwaway TMUX_AGENT_HOME; leaves nothing behind.
set -euo pipefail
cd "$(dirname "$0")/.."
. test/helpers/kill-server.sh   # ta_kill_server: kill-server, wait until tmux says the server is gone, unlink its socket file

export TMUX_AGENT_HOME="$(mktemp -d)"
SOCKET="ta-smoke-$$"
CLI="node dist/bin/tmux-agent.js --socket $SOCKET --actor smoke-supervisor"
FAILED=0
step() { echo "== $1"; }
die() { echo "SMOKE FAIL: $1" >&2; FAILED=1; }

# type_until <target> <text> <predicate-fn>: raw-tmux typing that survives the shell-init
# window. Keys sent while the shell is still sourcing init files are swallowed (2026-08-26),
# and the window is tmux-VERSION dependent: 3.2a defaults TERM=screen, which makes some
# hosts' shell init slow enough to eat sends that 3.4 (tmux-256color) survives (TMUX-67 —
# steps 12/15 failed on 3.2a while the product's own verified send passed). tty-level echo
# is NOT receipt — the kernel echoes bytes the shell later discards when init redraws the
# line — so the only trustworthy verification is the command's EFFECT: send, poll the
# caller's predicate, clear the line and resend if it never came true.
#
# wait_quiet <target>: hold typing until the pane has drawn something and STOPPED changing
# (two identical captures 0.5s apart). Effect-verification alone is not enough on a host
# whose shell init loads a line editor: ble.sh BUFFERS keys that arrive during init and
# replays them after the first prompt, so a send whose predicate had already come true
# executed a second time — split at its \n escapes into five garbage commands — and the
# noise scrolled the marker out of the 6-line classification tail (dev host, 2026-08-27;
# CI shells load no ble.sh and never saw it). Typing only into a settled pane leaves
# nothing in the replay buffer for init to fire back at us.
wait_quiet() {
  local tgt="$1" prev="" cur="" i
  for i in $(seq 1 40); do
    cur=$(tmux -L "$SOCKET" capture-pane -t "$tgt" -p 2>/dev/null) || return 1
    [ -n "${cur//[[:space:]]/}" ] && [ "$cur" = "$prev" ] && return 0
    prev="$cur"
    sleep 0.5
  done
  return 1   # never settled — the caller's effect predicate stays the real gate
}

type_until() {
  local tgt="$1" text="$2" pred="$3" try poll
  for try in 1 2 3 4 5; do
    wait_quiet "$tgt" || true   # best-effort; a still-moving pane just risks one retry
    tmux -L "$SOCKET" send-keys -t "$tgt" "$text" Enter
    for poll in $(seq 1 15); do
      "$pred" && return 0
      sleep 0.2
    done
    tmux -L "$SOCKET" send-keys -t "$tgt" C-u   # clear any half-eaten line before retyping
  done
  return 1
}

cleanup() {
  ta_kill_server "$SOCKET" >/dev/null || true
  rm -rf "$TMUX_AGENT_HOME"
}
trap cleanup EXIT

# Taken BEFORE the first spawn: step 8's `waste --since $SMOKE_T0` must list a session whose every
# event is younger than this instant. Second granularity is enough — an event in the same
# second has milliseconds on top and compares later.
SMOKE_T0=$(date -u +%FT%TZ)

step "1. spawn child session with lineage"
$CLI spawn smoke-child --cwd /tmp --parent smoke-supervisor --task demo | grep -q "spawned" || die "spawn"
$CLI spawn smoke-child --cwd /tmp --parent smoke-supervisor | grep -q "no-op" || die "idempotent spawn"
# TMUX-106: the dispatch read each verb's positionals with no count check — `spawn --cwd /tmp` with the
# name forgotten created a session literally named undefined and exited 0 (34c9f04). Now every verb's
# count is judged before a tmux server or the home is touched: exit 64, the verb and the missing argument.
$CLI spawn --cwd /tmp >"$TMUX_AGENT_HOME/noname.out" 2>"$TMUX_AGENT_HOME/noname.err" && NONAME_RC=0 || NONAME_RC=$?
[ "$NONAME_RC" -eq 64 ] || die "spawn --cwd /tmp (no name) exited $NONAME_RC, want 64 (EX_USAGE) — the missing name was accepted (stdout: $(head -c 120 "$TMUX_AGENT_HOME/noname.out"); stderr: $(head -c 200 "$TMUX_AGENT_HOME/noname.err"))"
if tmux -L "$SOCKET" list-sessions -F '#S' 2>/dev/null | grep -qx undefined; then die "spawn --cwd /tmp (no name) created a session named undefined"; fi
grep -q -- '^spawn: needs <name> — tmux-agent spawn <name> --cwd DIR' "$TMUX_AGENT_HOME/noname.err" \
  || die "spawn (no name) did not name the missing argument in the header's words (got: $(cat "$TMUX_AGENT_HOME/noname.err"))"
echo "   spawn --cwd /tmp (no name): rc=$NONAME_RC, $(cat "$TMUX_AGENT_HOME/noname.err")"
# TMUX-108: `--cwd DIR` went straight into new-session -c; tmux chdir()s in the server and falls back to $HOME in
# silence, so `spawn X --cwd /srv/example/tmux-agnet` (a typo) printed "spawned X", exit 0, with the shell — and any
# --cmd launch command — in $HOME and the ledger recording the typo (3b9b838). Now the value is resolved and judged
# before a tmux call: exit 64 naming --cwd, the value as typed and the reason; no session is born, no --cmd runs.
NODIR="$TMUX_AGENT_HOME/no-such-dir"
$CLI spawn smoke-cwd --cwd "$NODIR" --cmd "touch $TMUX_AGENT_HOME/cwd-cmd-ran" >"$TMUX_AGENT_HOME/cwd.out" 2>"$TMUX_AGENT_HOME/cwd.err" && CWD_RC=0 || CWD_RC=$?
[ "$CWD_RC" -eq 64 ] || die "spawn smoke-cwd --cwd <home>/no-such-dir exited $CWD_RC, want 64 (EX_USAGE) — the missing directory was accepted (stdout: $(head -c 120 "$TMUX_AGENT_HOME/cwd.out"); stderr: $(head -c 200 "$TMUX_AGENT_HOME/cwd.err"))"
[ ! -s "$TMUX_AGENT_HOME/cwd.out" ] || die "a refused spawn wrote to stdout: $(head -c 120 "$TMUX_AGENT_HOME/cwd.out")"
grep -qxF -- "--cwd: no such directory \"$NODIR\" — give a directory" "$TMUX_AGENT_HOME/cwd.err" \
  || die "the refusal does not name --cwd, the reason, the value as typed and what it takes (got: $(cat "$TMUX_AGENT_HOME/cwd.err"))"
if tmux -L "$SOCKET" list-sessions -F '#S' 2>/dev/null | grep -qx smoke-cwd; then die "spawn smoke-cwd --cwd <home>/no-such-dir birthed the session (in \$HOME)"; fi
[ ! -e "$TMUX_AGENT_HOME/cwd-cmd-ran" ] || die "the launch command of a refused spawn ran"
[ ! -e "$TMUX_AGENT_HOME/logs/smoke-cwd.log" ] || die "a refused spawn started a capture log"
echo "   spawn smoke-cwd --cwd <home>/no-such-dir: rc=$CWD_RC, $(sed "s#$TMUX_AGENT_HOME#<home>#" "$TMUX_AGENT_HOME/cwd.err"); no session, no --cmd, no capture log"
# TMUX-109: the session NAME was judged only by tmux, after the constructor had made the 0700 home — `spawn 'vp bad'`
# (a space) exited 1 in tmux's words with the session born anyway, one that kill/send/exec then refused to address;
# `spawn ../evil` left a half-made `__/evil` (tmux rewrites . and : to _); `watch 'vp bad'` reported GONE, exit 2 — the
# code a supervising script reads as "the session died"; `log ../evil` printed a path outside logs/ (296272c). Now every
# verb's <name> is judged through the driver's one rule before a tmux call or the home: exit 64, the verb, the value as
# typed and the rule; no session is born, not under the typed name and not under tmux's rewrite of it.
$CLI spawn 'smoke bad' --cwd /tmp >"$TMUX_AGENT_HOME/name.out" 2>"$TMUX_AGENT_HOME/name.err" && NAME_RC=0 || NAME_RC=$?
[ "$NAME_RC" -eq 64 ] || die "spawn 'smoke bad' --cwd /tmp exited $NAME_RC, want 64 (EX_USAGE) — the name was accepted (stdout: $(head -c 120 "$TMUX_AGENT_HOME/name.out"); stderr: $(head -c 200 "$TMUX_AGENT_HOME/name.err"))"
[ ! -s "$TMUX_AGENT_HOME/name.out" ] || die "a refused spawn wrote to stdout: $(head -c 120 "$TMUX_AGENT_HOME/name.out")"
grep -qxF -- 'spawn: invalid session name: "smoke bad" (alnum start, [A-Za-z0-9._-], <=64)' "$TMUX_AGENT_HOME/name.err" \
  || die "the refusal does not name the verb, the value as typed and the rule (got: $(cat "$TMUX_AGENT_HOME/name.err"))"
if tmux -L "$SOCKET" list-sessions -F '#S' 2>/dev/null | grep -qx 'smoke bad'; then die "spawn 'smoke bad' birthed the session"; fi
$CLI watch 'smoke bad' --idle-secs 1 >"$TMUX_AGENT_HOME/wname.out" 2>"$TMUX_AGENT_HOME/wname.err" && WNAME_RC=0 || WNAME_RC=$?
[ "$WNAME_RC" -eq 64 ] || die "watch 'smoke bad' --idle-secs 1 exited $WNAME_RC, want 64 (EX_USAGE) — a name that can never exist was reported as a session state (stdout: $(head -c 120 "$TMUX_AGENT_HOME/wname.out"))"
echo "   spawn 'smoke bad': rc=$NAME_RC, $(cat "$TMUX_AGENT_HOME/name.err"); watch 'smoke bad': rc=$WNAME_RC; no session"
# TMUX-110: `--parent` and the actor (`--actor`, else TMUX_AGENT_ACTOR) were judged by nobody — `spawn X --parent 'not a
# name!'` printed "spawned X", exit 0, the value landing in tmux's @agent_parent, `lineage` and the ledger's session.spawned
# row, the child ORPHANED by construction (e254450). Now both are judged through the driver's one rule before a tmux call
# or the home: exit 64 naming the source, the value as typed and the rule; no session is born.
$CLI spawn smoke-lin --cwd /tmp --parent 'smoke bad' >"$TMUX_AGENT_HOME/lin.out" 2>"$TMUX_AGENT_HOME/lin.err" && LIN_RC=0 || LIN_RC=$?
[ "$LIN_RC" -eq 64 ] || die "spawn smoke-lin --cwd /tmp --parent 'smoke bad' exited $LIN_RC, want 64 (EX_USAGE) — the parent was accepted (stdout: $(head -c 120 "$TMUX_AGENT_HOME/lin.out"); stderr: $(head -c 200 "$TMUX_AGENT_HOME/lin.err"))"
[ ! -s "$TMUX_AGENT_HOME/lin.out" ] || die "a refused spawn wrote to stdout: $(head -c 120 "$TMUX_AGENT_HOME/lin.out")"
grep -qxF -- '--parent: invalid session name: "smoke bad" (alnum start, [A-Za-z0-9._-], <=64)' "$TMUX_AGENT_HOME/lin.err" \
  || die "the refusal does not name --parent, the value as typed and the rule (got: $(cat "$TMUX_AGENT_HOME/lin.err"))"
if tmux -L "$SOCKET" list-sessions -F '#S' 2>/dev/null | grep -qx smoke-lin; then die "spawn smoke-lin --parent 'smoke bad' birthed the session"; fi
echo "   spawn smoke-lin --parent 'smoke bad': rc=$LIN_RC, $(cat "$TMUX_AGENT_HOME/lin.err"); no session"
# TMUX-113: --socket (else TMUX_AGENT_SOCKET) — the one global value every verb reads — was judged only by the driver's
# socketArgs at the first tmux call: exit 1 in its words, no source, the 0700 home already made; `watch` read the refusal
# as the session dying (GONE, exit 2, a notify.sent row); doctor/waste/msg ran to completion, exit 0 (7b1e542). Now the
# CLI judges it where every other value is judged: exit 64 naming the source, the value as typed and the rule; nothing
# touched — a home that did not exist still does not. $CLI carries the smoke's own --socket, so the binary is called bare.
SOCKHOME="$TMUX_AGENT_HOME/sock-home"
env TMUX_AGENT_HOME="$SOCKHOME" node dist/bin/tmux-agent.js --socket ../x status >"$TMUX_AGENT_HOME/sock.out" 2>"$TMUX_AGENT_HOME/sock.err" && SOCK_RC=0 || SOCK_RC=$?
[ "$SOCK_RC" -eq 64 ] || die "--socket ../x status exited $SOCK_RC, want 64 (EX_USAGE) — the socket name was judged late (stdout: $(head -c 120 "$TMUX_AGENT_HOME/sock.out"); stderr: $(head -c 200 "$TMUX_AGENT_HOME/sock.err"))"
[ ! -s "$TMUX_AGENT_HOME/sock.out" ] || die "--socket ../x status wrote to stdout what it should have refused before: $(head -c 120 "$TMUX_AGENT_HOME/sock.out")"
grep -qxF -- '--socket: invalid socket name: "../x" ([A-Za-z0-9._-], 1 or more)' "$TMUX_AGENT_HOME/sock.err" \
  || die "the refusal does not name --socket, the value as typed and the rule (got: $(cat "$TMUX_AGENT_HOME/sock.err"))"
[ ! -e "$SOCKHOME" ] || die "--socket ../x status made the home before the socket name was judged (entries: $(ls -A "$SOCKHOME" | tr '\n' ' '))"
echo "   --socket ../x status: rc=$SOCK_RC, $(cat "$TMUX_AGENT_HOME/sock.err"); no home"

step "2. lineage recorded in tmux user options"
$CLI lineage | grep -q "smoke-child.*parent=smoke-supervisor" || die "lineage"

step "3. verified send + sync exec"
$CLI send smoke-child "echo hello-from-supervisor" | grep -q "sent+verified" || die "verified send"
# TMUX-121: a freshly spawned pane passes through a window in which the DEEPEST foreground process
# under it is the host's pty wrapper (kiro-cli-term here; `script`, `asciinema rec`, `expect`
# elsewhere), not the shell it is about to start — and exec's guard is RIGHT to refuse there
# (TMUX-97/99: a keystroke in that window reaches the wrapper). Measured ~0.7 s wide on this host
# (scratch/ga-fire-2026-09-17-10Z/fgprobe/probe-c0012ef.log), which reddened this step on 2 of 2 runs
# while CI — whose shells load no wrapper — stayed 13/13 green. So wait for the pane to present a
# shell instead of racing it. The wait fails LOUD: a pane a real pager holds never becomes ready and
# the step dies naming it, so this can never become a silent skip (test/exec-ready-wait.test.js).
READY=$(TMUX_AGENT_ACTOR=smoke-supervisor bash test/helpers/wait-shell.sh "$SOCKET" smoke-child 20 2>&1) \
  || die "smoke-child never presented a shell to exec's guard: $READY"
OUT=$($CLI exec smoke-child "echo marker-\$((6*7))")
echo "$OUT" | grep -q "marker-42" || die "exec-sync output (got: $OUT)"
echo "   exec $READY"

step "4. durable capture log has content"
sleep 1
LOG=$($CLI log smoke-child)
[ -s "$LOG" ] || die "capture log empty at $LOG"
grep -q "hello-from-supervisor" "$LOG" || die "capture log missing our command"

step "5. redaction: secret never reaches the analyzer surface"
# Every synthetic credential planted here is checked on BOTH read paths, and each arrival exercises
# exactly one of them (TMUX-96, measured 2026-09-13): `exec` runs its script off-pane — the driver
# types only `sh <scriptFile>` — so an exec'd credential never reaches the pane or the raw capture
# log; it lands only in the ledger's exec.done command preview. A typed `send` lands on the pane
# (the capture log holds it twice: the typed line and the echo) and in the ledger's input.sent
# preview. So: exec arrivals exercise the ledger's exec.done path; sends exercise the capture log
# AND the input.sent path. An AKIA that arrived only by exec kept this step 17/17 green on a dist
# with the AWS-key rule deleted — the log assertion could not fire and the ledger grep did not look
# for it. All values are synthetic; the AWS-key shape is the smoke's own literal.
SYNTH_AWSKEY="AKIA1234567890ABCDEF"
# TMUX-95: the HTTP credential envelope — the form this tool's own dashboard token is accepted in
# (THREAT-MODEL §7) and the one every provider's token travels a command line in.
SYNTH_BEARER="SMK1Zm9vYmFyMDEyMzQ1Njc4OWFi"
SYNTH_APIKEY="SMK2YmF6cXV1eDk4NzY1NDMyMWNk"
# exec arrivals → ledger exec.done command preview only (off-pane; never in the capture log)
$CLI exec smoke-child "echo $SYNTH_AWSKEY" >/dev/null || true
$CLI exec smoke-child "echo 'Authorization: Bearer $SYNTH_BEARER'" >/dev/null || true
# typed arrivals → raw capture log (typed line + echo) and ledger input.sent preview
$CLI send smoke-child "echo $SYNTH_AWSKEY" | grep -q "sent+verified" || die "send of the AWS key id"
$CLI send smoke-child "echo 'Authorization: Bearer $SYNTH_BEARER'" | grep -q "sent+verified" || die "send of the bearer envelope"
$CLI send smoke-child "PLANE_API_KEY=$SYNTH_APIKEY true" | grep -q "sent+verified" || die "send of the api-key pair"
# TMUX-111: a shell with syntax highlighting (ble.sh here; zsh-syntax-highlighting, fish) draws a typed pair token by
# token, so the raw capture holds `PLANE_API_KEY<SGR>=<SGR>value` and the pair rules — which wanted `KEY=value` — never
# saw it: the line above went red on this host on every dist from 2026-09-15 18:33Z while CI's plain shells stayed
# green. Plant the shape on EVERY shell: the OUTPUT of this printf is the highlighted pair, byte for byte the ble.sh
# placement; the typed line carries the value split in two (`SMK3 cXV1eA1234`), so neither the echo of the typed line
# nor the ledger's input.sent preview ever holds the whole value — only the read path can be what removes it from the
# output line. (Not added to the ledger grep below for that reason: there it would be a vacuous check.)
SYNTH_HLKEY="SMK3cXV1eA1234"
$CLI send smoke-child "printf 'PLANE_API_KEY\\033[0;38;5;33m=\\033[0m%s%s\\n' SMK3 cXV1eA1234" | grep -q "sent+verified" || die "send of the highlighted api-key pair"
sleep 1
node --input-type=module -e "
import {redact} from './dist/core/redact.js';
import {readFileSync} from 'node:fs';
const t=redact(readFileSync('$LOG','utf8'));
if (t.includes('$SYNTH_AWSKEY')) process.exit(1);
if (t.includes('$SYNTH_BEARER')) process.exit(2);
if (t.includes('$SYNTH_APIKEY')) process.exit(3);
if (t.includes('$SYNTH_HLKEY')) process.exit(4);
" || die "redaction (rc=$? — 1 AKIA, 2 bearer envelope, 3 api-key pair, 4 highlighted api-key pair survived on the read path)"
# TMUX-216: a zero from an EMPTY scan is not a clean ledger. With no day file at all (`cat` fails, `grep -c`
# counts nothing, `|| true` keeps the pipeline alive) or with day files that never recorded this step's
# arrivals, the zero-check below read 0 and passed on nothing — the BANLIST's "nothing to check is not
# success", reproduced on two synthetic ledgers by the 2026-10-13 review. The presence half is asserted
# first, over the SAME concatenation the zero-check reads: this step typed four lines and ran two commands,
# and the redactor marks every value it removes, so the day files must hold at least those four input.sent
# rows, two exec.done rows and five redaction markers (AKIA and bearer envelope on the exec side; AKIA,
# bearer envelope and api-key pair on the typed side — the highlighted pair never travels whole, see above)
# before their silence about the raw values means anything. Each die names the count it found.
LEDGER_DAYS=$(find "$TMUX_AGENT_HOME/ledger" -maxdepth 1 -name 'events-*.ndjson' 2>/dev/null | wc -l | tr -d ' ' || true)
[ "${LEDGER_DAYS:-0}" -ge 1 ] || die "no ledger day file under \$TMUX_AGENT_HOME/ledger — the leak check would be judging an empty scan"
LEDGER_SENT=$(cat "$TMUX_AGENT_HOME"/ledger/events-*.ndjson 2>/dev/null | grep -c '"type":"input.sent"' || true)
LEDGER_EXEC=$(cat "$TMUX_AGENT_HOME"/ledger/events-*.ndjson 2>/dev/null | grep -c '"type":"exec.done"' || true)
LEDGER_MARKS=$(cat "$TMUX_AGENT_HOME"/ledger/events-*.ndjson 2>/dev/null | grep -o '\[REDACTED' | wc -l | tr -d ' ' || true)
[ "${LEDGER_SENT:-0}" -ge 4 ] || die "ledger holds $LEDGER_SENT input.sent row(s), want >= 4 — this step typed four lines the leak check must see"
[ "${LEDGER_EXEC:-0}" -ge 2 ] || die "ledger holds $LEDGER_EXEC exec.done row(s), want >= 2 — this step ran two commands the leak check must see"
[ "${LEDGER_MARKS:-0}" -ge 5 ] || die "ledger holds $LEDGER_MARKS [REDACTED marker(s), want >= 5 — the previews the leak check judges are not there to judge"
# The ledger is written through redact() (orchestrator: input.sent preview, exec.done command), so
# the raw synthetic values must appear in NO day file — `grep -c` over the concatenation, not per
# file, and for EVERY value the step planted, not a subset (the AKIA was the omission).
LEDGER_LEAKS=$(cat "$TMUX_AGENT_HOME"/ledger/events-*.ndjson | grep -c -e "$SYNTH_AWSKEY" -e "$SYNTH_BEARER" -e "$SYNTH_APIKEY" || true)
[ "$LEDGER_LEAKS" = "0" ] || die "synthetic credential reached the ledger verbatim ($LEDGER_LEAKS line(s))"
echo "   ledger: $LEDGER_DAYS day file(s), $LEDGER_SENT input.sent, $LEDGER_EXEC exec.done, $LEDGER_MARKS redaction markers, $LEDGER_LEAKS raw value(s)"

step "6. cross-agent message round-trip (mailbox fallback)"
$CLI msg send smoke-supervisor smoke-child status-check "how is it going" >/dev/null
$CLI msg recv smoke-child | grep -q "status-check" || die "mailbox round-trip"
# TMUX-107: an agent name is a path segment under <home>/mailbox. On d8979b9 `msg send A ../../X hello` wrote
# a 664 message file BESIDE the 0700 home and exited 0 (and `msg recv ../../X` read it back). The name is
# judged by the session-name rule before anything is created — exit 64 (EX_USAGE, as every other refusal)
# naming <to>, the value as typed and the rule; nothing lands beside the home. The target is a sibling of
# this run's throwaway home, so a regression is visible — and contained — in the same temp dir.
ESC="ta-smoke-escape-$$"
ESC_RC=0
ESC_OUT=$($CLI msg send smoke-supervisor "../../$ESC" hello body 2>"$TMUX_AGENT_HOME/escape.err") || ESC_RC=$?
[ "$ESC_RC" -eq 64 ] || die "msg send smoke-supervisor ../../$ESC exited $ESC_RC, want 64 (EX_USAGE); stdout: $ESC_OUT"
[ -z "$ESC_OUT" ] || die "a refused msg send wrote to stdout: $ESC_OUT"
grep -q -- "^msg send: <to> \"../../$ESC\" is not an agent name" "$TMUX_AGENT_HOME/escape.err" \
  || die "the refusal does not name <to>, the value as typed and the rule (got: $(cat "$TMUX_AGENT_HOME/escape.err"))"
[ ! -e "$(dirname "$TMUX_AGENT_HOME")/$ESC" ] || die "msg send ../../$ESC landed beside the home: $(dirname "$TMUX_AGENT_HOME")/$ESC exists"
# the delivered message's modes are the home's own — 0700 directories, a 0600 file (THREAT-MODEL finding 8's rule)
MB_MODES=$(node -e "const{statSync,readdirSync}=require('fs');const h=process.argv[1]+'/mailbox';const a=h+'/smoke-child/archive';const m=p=>(statSync(p).mode&0o777).toString(8);console.log([m(h),m(a),...readdirSync(a).map(f=>m(a+'/'+f))].join(' '))" "$TMUX_AGENT_HOME")
[ "$MB_MODES" = "700 700 600" ] || die "mailbox/, archive/ and the archived message are $MB_MODES, want 700 700 600"
echo "   msg send ../../$ESC: rc=$ESC_RC, $(cat "$TMUX_AGENT_HOME/escape.err"); nothing beside the home; modes $MB_MODES"

step "7. monitor + notification (console sink) + status.json"
$CLI status --json "$TMUX_AGENT_HOME/status.json" >/dev/null
node --input-type=module -e "
import {readFileSync} from 'node:fs';
const s=JSON.parse(readFileSync('$TMUX_AGENT_HOME/status.json','utf8'));
const c=s.sessions.find(x=>x.session==='smoke-child');
if(!c) process.exit(1);
if(c.parent!=='smoke-supervisor') process.exit(2);
" || die "status.json shape"
# TMUX-114: a FILE the tool cannot write was judged by the OS after the work — `status --json <nodir>/x.json`
# read the fleet, made the home and exited 1 in Node's words (83b0287), the flag unnamed and the fleet lines it
# had read withheld from stdout. Now it is refused before the fleet is read: exit 64, the flag, the value as
# typed and the reason in words; nothing written, nothing created.
$CLI status --json "$TMUX_AGENT_HOME/nodir/x.json" >"$TMUX_AGENT_HOME/outpath.out" 2>"$TMUX_AGENT_HOME/outpath.err" && OUTPATH_RC=0 || OUTPATH_RC=$?
[ "$OUTPATH_RC" -eq 64 ] || die "status --json <home>/nodir/x.json exited $OUTPATH_RC, want 64 (EX_USAGE) — the unwritable file was judged late (stderr: $(head -c 200 "$TMUX_AGENT_HOME/outpath.err"))"
[ ! -s "$TMUX_AGENT_HOME/outpath.out" ] || die "status --json <home>/nodir/x.json printed a fleet snapshot instead of refusing: $(head -c 200 "$TMUX_AGENT_HOME/outpath.out")"
[ "$(cat "$TMUX_AGENT_HOME/outpath.err")" = "--json: cannot write \"$TMUX_AGENT_HOME/nodir/x.json\" — no such directory" ] \
  || die "the refusal does not name --json, the value as typed and the reason (got: $(cat "$TMUX_AGENT_HOME/outpath.err"))"
[ ! -e "$TMUX_AGENT_HOME/nodir" ] || die "status --json <home>/nodir/x.json created the directory it should have refused"
echo "   status --json <home>/nodir/x.json: rc=$OUTPATH_RC, $(cat "$TMUX_AGENT_HOME/outpath.err")"
# TMUX-116: a socket with no server — the tmux server's death, or one that never ran — is a fact the file and the
# verb carry: `tmux.reachable` false with tmux's own words, the UNREACHABLE line on stderr, exit 0. On 1c4ae7f the
# file was { v, generatedAt, sessions: [] } — identical to an idle fleet — and the one stderr line was the
# socket-mismatch hint ("Try --default-server"), because this home's ledger is fresh. The smoke's own server is not touched.
NOSRV="ta-smoke-nosrv-$$"
node dist/bin/tmux-agent.js --socket "$NOSRV" --actor smoke-supervisor status --json "$TMUX_AGENT_HOME/status-nosrv.json" >"$TMUX_AGENT_HOME/nosrv.out" 2>"$TMUX_AGENT_HOME/nosrv.err" && NOSRV_RC=0 || NOSRV_RC=$?
[ "$NOSRV_RC" -eq 0 ] || die "--socket $NOSRV status --json exited $NOSRV_RC, want 0 — the fact rides the file (stderr: $(head -c 200 "$TMUX_AGENT_HOME/nosrv.err"))"
NOSRV_ERR=$(node -e "
const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
if(!('tmux' in s)) { console.error('no tmux key: '+Object.keys(s).sort().join(',')); process.exit(1); }
if(s.tmux.reachable!==false) { console.error('reachable is '+JSON.stringify(s.tmux.reachable)); process.exit(2); }
if(!String(s.tmux.error).includes(process.argv[2])) { console.error('error does not name the socket: '+JSON.stringify(s.tmux.error)); process.exit(3); }
if(s.sessions.length!==0) { console.error('sessions: '+s.sessions.length); process.exit(4); }
console.log(s.tmux.error);
" "$TMUX_AGENT_HOME/status-nosrv.json" "$NOSRV" 2>&1) || die "status-nosrv.json does not carry the verdict — $NOSRV_ERR (on 1c4ae7f: three keys, no tmux, identical to an idle fleet)"
grep -q "^status: tmux server UNREACHABLE on $NOSRV — " "$TMUX_AGENT_HOME/nosrv.err" \
  || die "stderr lacks the UNREACHABLE line naming $NOSRV (got: $(tr '\n' ' ' < "$TMUX_AGENT_HOME/nosrv.err" | head -c 300))"
if grep -q -- '--default-server' "$TMUX_AGENT_HOME/nosrv.err"; then die "a socket with no server was diagnosed as a socket mismatch (--default-server hint on a fresh ledger): $(tr '\n' ' ' < "$TMUX_AGENT_HOME/nosrv.err" | head -c 300)"; fi
tmux -L "$SOCKET" has-session -t "=smoke-child" 2>/dev/null || die "the smoke's own server was touched by the $NOSRV read"
echo "   --socket $NOSRV status --json: rc=$NOSRV_RC, tmux.reachable=false — $NOSRV_ERR"
# TMUX-117: `watch` is what a supervising script BLOCKS on, and exit 2 is "gone" for both failures the fleet has —
# this session died, or the whole tmux server did. On 34d9785 the two were the same answer to the byte (a nine-key
# GONE, `reason` absent, neither the word "server" nor "tmux" anywhere in the output), so a supervisor respawned one
# session per charter entry onto a socket with no server. Now the JSON carries tmux's own words and stderr says so
# once; the exit code is unchanged (VERSIONING item 1). Bounded like the --idle-secs case: a watch that still runs
# after 10 s IS the regression this guards.
node dist/bin/tmux-agent.js --socket "$NOSRV" --actor smoke-supervisor watch smoke-child >"$TMUX_AGENT_HOME/wnosrv.out" 2>"$TMUX_AGENT_HOME/wnosrv.err" &
WNOSRV_PID=$!
for i in $(seq 1 50); do kill -0 "$WNOSRV_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$WNOSRV_PID" 2>/dev/null; then
  kill -9 "$WNOSRV_PID" 2>/dev/null || true; wait "$WNOSRV_PID" 2>/dev/null || true
  die "--socket $NOSRV watch smoke-child was still running after 10 s — a watch on a socket with no server must reach its verdict at once"
fi
WNOSRV_RC=0; wait "$WNOSRV_PID" || WNOSRV_RC=$?
[ "$WNOSRV_RC" -eq 2 ] || die "--socket $NOSRV watch smoke-child exited $WNOSRV_RC, want 2 (gone/dead, VERSIONING item 1 — unchanged by TMUX-117); stderr: $(tr '\n' ' ' < "$TMUX_AGENT_HOME/wnosrv.err" | head -c 300)"
WNOSRV_WHY=$(node -e "
const l=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').filter(Boolean).pop()||'{}';
const s=JSON.parse(l);
if(s.state!=='GONE') { console.error('state is '+JSON.stringify(s.state)); process.exit(1); }
if(!('reason' in s)) { console.error('no reason key: '+Object.keys(s).sort().join(',')); process.exit(2); }
if(typeof s.reason!=='string'||!s.reason.includes(process.argv[2])) { console.error('reason does not name the socket: '+JSON.stringify(s.reason)); process.exit(3); }
console.log(s.reason);
" "$TMUX_AGENT_HOME/wnosrv.out" "$NOSRV" 2>&1) || die "watch's JSON does not say why the session is GONE — $WNOSRV_WHY (on 34d9785: nine keys, no reason, identical to a session killed on a live server)"
grep -qxF "watch: tmux server UNREACHABLE on $NOSRV — $WNOSRV_WHY" "$TMUX_AGENT_HOME/wnosrv.err" \
  || die "watch's stderr lacks the UNREACHABLE line naming $NOSRV in the JSON's own words (got: $(tr '\n' ' ' < "$TMUX_AGENT_HOME/wnosrv.err" | head -c 300))"
tmux -L "$SOCKET" has-session -t "=smoke-child" 2>/dev/null || die "the smoke's own server was touched by the $NOSRV watch"
echo "   --socket $NOSRV watch smoke-child: rc=$WNOSRV_RC, reason — $WNOSRV_WHY"
# a session GONE on a server that ANSWERED carries no reason: one session died, not the fleet's server
$CLI watch smoke-nosuch-$$ >"$TMUX_AGENT_HOME/wgone.out" 2>"$TMUX_AGENT_HOME/wgone.err" && WGONE_RC=0 || WGONE_RC=$?
[ "$WGONE_RC" -eq 2 ] || die "watch on an absent session exited $WGONE_RC, want 2; stderr: $(tr '\n' ' ' < "$TMUX_AGENT_HOME/wgone.err" | head -c 300)"
node -e "
const l=require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').filter(Boolean).pop()||'{}';
const s=JSON.parse(l);
if(s.state!=='GONE') { console.error('state is '+JSON.stringify(s.state)); process.exit(1); }
if(s.reason!==null) { console.error('reason on a live server: '+JSON.stringify(s.reason)); process.exit(2); }
" "$TMUX_AGENT_HOME/wgone.out" || die "an absent session on a LIVE server was reported as the server's death"
if grep -q 'UNREACHABLE' "$TMUX_AGENT_HOME/wgone.err"; then die "a live server was called unreachable: $(tr '\n' ' ' < "$TMUX_AGENT_HOME/wgone.err" | head -c 300)"; fi
echo "   watch <absent session> on the live socket: rc=$WGONE_RC, reason=null"
# TMUX-105: a flag the CLI does not declare was assumed to take a value and the argument after it was
# swallowed — `status --jsn FILE` exited 0, wrote no FILE and published to the default path (ed161e6).
# Now every `--x` is judged against the declared sets before any verb runs: exit 64, the flag as typed.
$CLI status --jsn "$TMUX_AGENT_HOME/typo.json" >"$TMUX_AGENT_HOME/typo.out" 2>"$TMUX_AGENT_HOME/typo.err" && TYPO_RC=0 || TYPO_RC=$?
[ "$TYPO_RC" -eq 64 ] || die "status --jsn FILE exited $TYPO_RC, want 64 (EX_USAGE) — the undeclared flag was accepted (stderr: $(head -c 200 "$TMUX_AGENT_HOME/typo.err"))"
[ ! -e "$TMUX_AGENT_HOME/typo.json" ] || die "status --jsn FILE wrote the file it should have refused"
[ ! -s "$TMUX_AGENT_HOME/typo.out" ] || die "status --jsn FILE printed a fleet snapshot instead of refusing: $(head -c 200 "$TMUX_AGENT_HOME/typo.out")"
grep -q -- '^--jsn: unknown flag' "$TMUX_AGENT_HOME/typo.err" \
  || die "status --jsn FILE did not name the flag as typed on stderr (got: $(cat "$TMUX_AGENT_HOME/typo.err"))"
echo "   status --jsn FILE: rc=$TYPO_RC, $(cat "$TMUX_AGENT_HOME/typo.err")"
# TMUX-104: `watch --idle-secs` read its value with Number(); a value Number() cannot read is NaN,
# every comparison with NaN is false, and the idle exit could never be taken — `--idle-secs 3O` was
# still blocking with nothing on either stream when timeout(1) killed it at 20 s (caa6810). Now it is
# refused before any tmux call with exit 64 and the flag named. No GNU timeout on macOS: background
# the verb, poll, and kill it ourselves if it is still there — a kill here IS the old hang.
$CLI watch smoke-child --idle-secs 3O >"$TMUX_AGENT_HOME/idle.out" 2>"$TMUX_AGENT_HOME/idle.err" &
IDLE_PID=$!
for i in $(seq 1 50); do kill -0 "$IDLE_PID" 2>/dev/null || break; sleep 0.2; done
IDLE_RC=0
if kill -0 "$IDLE_PID" 2>/dev/null; then
  kill -9 "$IDLE_PID" 2>/dev/null || true; wait "$IDLE_PID" 2>/dev/null || true
  die "watch --idle-secs 3O was still running after 10 s — the silent hang measured before TMUX-104, not a refusal"
else
  wait "$IDLE_PID" || IDLE_RC=$?
  [ "$IDLE_RC" -eq 64 ] || die "watch --idle-secs 3O exited $IDLE_RC, want 64 (EX_USAGE); stdout: $(head -c 200 "$TMUX_AGENT_HOME/idle.out")"
  if [ -s "$TMUX_AGENT_HOME/idle.out" ]; then
    die "watch --idle-secs 3O printed a snapshot instead of refusing: $(head -c 200 "$TMUX_AGENT_HOME/idle.out")"
  fi
  grep -q -- '^--idle-secs: cannot read "3O"' "$TMUX_AGENT_HOME/idle.err" \
    || die "watch --idle-secs 3O did not name the flag and the value on stderr (got: $(cat "$TMUX_AGENT_HOME/idle.err"))"
  echo "   watch --idle-secs 3O: rc=$IDLE_RC in under 10 s, $(cat "$TMUX_AGENT_HOME/idle.err")"
fi

step "8. waste report answers over the ledger, and --since is honoured or refused"
$CLI waste | grep -q "smoke-child" || die "waste report"
# README.md:54's demo flag. A window opened before the first spawn must still list the session, and a
# value Date.parse cannot read must be refused — exit 64 (EX_USAGE, the bad-verb code), no rows, one
# stderr line naming the flag and the value — not the whole ledger with exit 0 as on cf8321e, where
# NaN compared false against every event and `--since yesterday` was indistinguishable from no window.
$CLI waste --since "$SMOKE_T0" | grep -q "smoke-child" || die "waste --since $SMOKE_T0 (taken before the first spawn) does not list smoke-child"
SINCE_RC=0
SINCE_OUT=$($CLI waste --since yesterday 2>"$TMUX_AGENT_HOME/since.err") || SINCE_RC=$?
[ "$SINCE_RC" -eq 64 ] || die "waste --since yesterday exited $SINCE_RC, want 64 (EX_USAGE); stdout: $(echo "$SINCE_OUT" | head -3)"
[ -z "$SINCE_OUT" ] || die "waste --since yesterday printed rows instead of refusing: $(echo "$SINCE_OUT" | head -3)"
grep -q -- '^--since: cannot read "yesterday"' "$TMUX_AGENT_HOME/since.err" \
  || die "waste --since yesterday did not name the flag and the value on stderr (got: $(cat "$TMUX_AGENT_HOME/since.err"))"
echo "   --since $SMOKE_T0 lists smoke-child; --since yesterday: rc=$SINCE_RC, $(cat "$TMUX_AGENT_HOME/since.err")"

step "9. policy: read-only mode blocks kill, and the refusal is ledgered"
echo '{"readOnly":true}' > "$TMUX_AGENT_HOME/ro-policy.json"
RO_OUT=$(TMUX_AGENT_POLICY="$TMUX_AGENT_HOME/ro-policy.json" $CLI kill smoke-child 2>&1 || true)
echo "$RO_OUT" | grep -qi "read-only" || die "read-only policy (got: $RO_OUT)"
# The message the caller sees is not the audit trail. policy.ts:5 promises a control.denied for
# every refusal; on 17c5d2e this kill left none, so the grep above passed on a ledger
# that could not show the operator an agent had tried.
grep -q '"type":"control.denied".*"action":"kill".*"reason":"read-only surface"' "$TMUX_AGENT_HOME"/ledger/*.ndjson \
  || die "read-only kill refusal left no control.denied in the ledger"
# ...and the refusal must count where README says the ledger's events aggregate: step 8's waste
# report, errors column. On 98514cc that column counted session.state→ERROR alone, so this row read
# errors=0 with the control.denied in the ledger beside it.
RO_WASTE=$($CLI waste) || die "waste after the refusal exited non-zero"
RO_ERR=$(echo "$RO_WASTE" | awk -F'\t' '$1=="smoke-child"{sub("errors=","",$3); print $3}')
[ "${RO_ERR:-0}" -ge 1 ] 2>/dev/null \
  || die "waste's errors column does not count the ledgered refusal (smoke-child row: $(echo "$RO_WASTE" | grep smoke-child || echo none); TMUX-101)"
# A policy file the tool cannot use is refused, never silently the permissive default: on e757b28 this
# `status` exited 0 and read the fleet with every surface open. Exit 78 (EX_CONFIG), nothing on stdout, one stderr
# line naming the file and the reason — the lexicon's rule (step 15) applied to the file that gates every verb.
printf '{"readOnly":true,}\n' > "$TMUX_AGENT_HOME/bad-policy.json"
BAD_RC=0
BAD_OUT=$(TMUX_AGENT_POLICY="$TMUX_AGENT_HOME/bad-policy.json" $CLI status 2>"$TMUX_AGENT_HOME/bad-policy.err") || BAD_RC=$?
[ "$BAD_RC" -eq 78 ] || die "status under a malformed policy file exited $BAD_RC, want 78 (EX_CONFIG); stdout: $(echo "$BAD_OUT" | head -3)"
[ -z "$BAD_OUT" ] || die "status under a malformed policy file printed the fleet instead of refusing: $(echo "$BAD_OUT" | head -3)"
[ "$(grep -c '' "$TMUX_AGENT_HOME/bad-policy.err")" -eq 1 ] || die "the policy refusal is not one line: $(cat "$TMUX_AGENT_HOME/bad-policy.err")"
grep -q '^policy config error: .*bad-policy.json: not valid JSON' "$TMUX_AGENT_HOME/bad-policy.err" \
  || die "status under a malformed policy file did not name the file and the reason on stderr (got: $(cat "$TMUX_AGENT_HOME/bad-policy.err"))"
echo "   malformed policy file: rc=$BAD_RC, $(cat "$TMUX_AGENT_HOME/bad-policy.err")"

step "10. ownership kill + audit trail"
$CLI kill smoke-child | grep -q "killed" || die "kill"
grep -q '"type":"session.killed"' "$TMUX_AGENT_HOME"/ledger/*.ndjson || die "audit event"

step "11. concurrent sends do not cross-contaminate panes (proven race, 2026-08-25)"
$CLI spawn race-a --cwd /tmp --parent smoke-supervisor >/dev/null
$CLI spawn race-b --cwd /tmp --parent smoke-supervisor >/dev/null
# Two fresh panes, two concurrent sends. CI's tmux-versions (3.2a) job lost this step twice on 2026-10-13
# (`race-b lost its own input` 16:36Z on 92f59a6, `race-a` 17:06Z on a2192f0; never 3.4, never the distro jobs) and the
# die said nothing else. Replayed under a built 3.2a (13 of 160 panes; 0 of 160 under 3.4; the pre-TMUX-206 tree lost as
# many) it was never the pane: the losing send died at `paste-buffer -d -b <name>` with "no buffer <name>", because the
# OTHER send's belt-and-braces delete-buffer, issued after its own -d had already deleted its buffer, named a buffer that
# no longer existed — and tmux through 3.3a answers that by deleting the NEWEST buffer (3.4 refuses: "unknown buffer").
# The product no longer deletes after a completed paste (src/core/orchestrator.ts pasteText;
# test/paste-buffer-cleanup.test.js). The two waits below are the pane-startup rule every other send site keeps
# (TMUX-121/195/196; drift guard (m) in test/exec-ready-wait.test.js) — they did not change this step's verdict (under a
# planted 2 s login profile the parent passed 17/17 on both versions) and they keep a send's C-c out of a shell's init.
READY_A=$(TMUX_AGENT_ACTOR=smoke-supervisor bash test/helpers/wait-shell.sh "$SOCKET" race-a 20 2>&1) \
  || die "race-a never presented a shell to exec's guard: $READY_A"
READY_B=$(TMUX_AGENT_ACTOR=smoke-supervisor bash test/helpers/wait-shell.sh "$SOCKET" race-b 20 2>&1) \
  || die "race-b never presented a shell to exec's guard: $READY_B"
( $CLI send race-a "echo RACE_AAAA" > "$TMUX_AGENT_HOME/race-a.send" 2>&1 & $CLI send race-b "echo RACE_BBBB" > "$TMUX_AGENT_HOME/race-b.send" 2>&1 & wait ) || true
sleep 2
# `|| die`: a vanished session must FAIL LOUD — bare $(...) under set -e aborted the whole
# script with no message when the fresh-spawn SIGINT race killed race-b (2026-08-26).
PA=$(tmux -L "$SOCKET" capture-pane -t "=race-a:" -p 2>/dev/null) || die "race-a session vanished after send (fresh-spawn SIGINT race?)"
PB=$(tmux -L "$SOCKET" capture-pane -t "=race-b:" -p 2>/dev/null) || die "race-b session vanished after send (fresh-spawn SIGINT race?)"
# A miss names what the pane held: the send's own words — `sent+verified` is a paste the pane echoed and the
# send submitted, which the shell then never ran; `FAILED to verify` one that never showed; `tmux paste-buffer failed:
# no buffer …` one that was never pasted (the 3.2a miss above) — and what holds the pane now, read the way wait-shell's
# give-up reads it (test/helpers/pane-holder.js: exec's guard, the processes under the pane, its last line). Until this,
# the die said only "lost its own input", and CI's two misses could say nothing about their cause.
held() { printf 'send said "%s"; %s' "$(tr '\n' ' ' < "$TMUX_AGENT_HOME/$1.send" | sed 's/[[:space:]]*$//' | cut -c1-80)" "$(node test/helpers/pane-holder.js dist/bin/tmux-agent.js "$SOCKET" "$1" 2>&1 | tr '\n' ' ' | cut -c1-600)"; }
echo "$PA" | grep -q RACE_AAAA || die "race-a lost its own input — $(held race-a)"
echo "$PB" | grep -q RACE_BBBB || die "race-b lost its own input — $(held race-b)"
echo "$PA" | grep -q RACE_BBBB && die "cross-contamination: b's text landed in a"
echo "$PB" | grep -q RACE_AAAA && die "cross-contamination: a's text landed in b"
$CLI kill race-a >/dev/null 2>&1 || true; $CLI kill race-b >/dev/null 2>&1 || true

step "12. exec refuses a TUI pane instead of hanging to timeout"
$CLI spawn tui-test --cwd /tmp --parent smoke-supervisor >/dev/null
# Wait for the shell's first output (its prompt) before typing: keys sent while the shell is
# still sourcing init files are swallowed and `less` never starts (2026-08-26 — the same
# init-window race that silently killed step 11's fresh sessions). Content alone is not
# readiness — init noise opens this gate early on tmux 3.2a — so the send itself verifies.
for i in $(seq 1 30); do
  [ -n "$(tmux -L "$SOCKET" capture-pane -t "=tui-test:" -p 2>/dev/null | tr -d '[:space:]')" ] && break
  sleep 0.2
done
# `less` anywhere under the pane's process tree — one pid, empty if none. tmux's
# pane_current_command and the pane pid's direct children both read ONE level, and behind a pty
# wrapper (kiro-cli-term on the dev host; `script`, `asciinema rec`, `expect` anywhere) the real
# shell sits on a nested pty and the pager is a grandchild: that reading printed SKIP on the one
# host that HAS the case — a check that could not fail whatever exec did. The walk is
# the same rule the guard now applies. One ps pass, no mapfile (macOS bash 3.2); comm is a full
# path on macOS, hence the basename.
less_under_pane() {
  local pp
  pp=$(tmux -L "$SOCKET" display-message -p -t '=tui-test:' '#{pane_pid}' 2>/dev/null) || return 1
  ps -eo pid=,ppid=,comm= 2>/dev/null | awk -v r="$pp" '
    { p[$1] = $2; c[$1] = $3; sub(".*/", "", c[$1]) }
    END { for (x in p) { y = x; n = 0; while ((y in p) && y != r && n++ < 200) y = p[y];
          if (y == r && x != r && c[x] == "less") { print x; exit } } }'
}
# Effect predicate doubles as the old FG poll: `less` owns the pane — as tmux reports it, or
# anywhere below it.
less_owns_pane() {
  [ "$(tmux -L "$SOCKET" display-message -p -t '=tui-test:' '#{pane_current_command}' 2>/dev/null)" = "less" ] && return 0
  [ -n "$(less_under_pane)" ]
}
type_until "=tui-test:" "less /etc/passwd" less_owns_pane || true   # SKIP path below decides
FG=$(tmux -L "$SOCKET" display-message -p -t "=tui-test:" '#{pane_current_command}')
LESS_PID=$(less_under_pane || true)
# Precondition: the TUI must actually be occupying the pane — and only `less` itself counts.
# (History: /etc/hostname does not exist on macOS, so less exited instantly there; and a bare
# "pane has children" fallback is fooled by lingering shell-init subprocesses, which made this
# step demand a refusal from a pane whose foreground was a plain shell.)
if [ "$FG" = "less" ] || [ -n "$LESS_PID" ]; then
  F0=$FAILED
  T0=$SECONDS
  TUI_OUT=$($CLI exec tui-test "echo NOPE" 2>&1 || true)
  TOOK=$((SECONDS - T0))
  if ! echo "$TUI_OUT" | grep -qi "not a shell"; then
    # diagnostic: what does this platform actually report while a TUI owns the pane?
    PP=$(tmux -L "$SOCKET" display-message -p -t "=tui-test:" '#{pane_pid}')
    echo "   DIAG pane_current_command=$(tmux -L "$SOCKET" display-message -p -t '=tui-test:' '#{pane_current_command}')"
    echo "   DIAG pane_pid=$PP less_under_pane=[$LESS_PID]"
    echo "   DIAG descendants (pid ppid pgid tpgid comm):"
    ps -eo pid=,ppid=,pgid=,tpgid=,comm= 2>/dev/null | awk -v r="$PP" '
      { p[$1] = $2; l[$1] = $0 }
      END { for (x in p) { y = x; n = 0; while ((y in p) && y != r && n++ < 200) y = p[y]; if (y == r) print "   DIAG   " l[x] } }'
    die "TUI guard missing (got: $TUI_OUT)"
  fi
  # The refusal must be the guard's, not the timeout's: fast, and nothing typed into the pager
  # (the FAIL-first record shows less's search prompt opened on the `/` of the script path).
  [ "$TOOK" -le 10 ] || die "TUI guard took ${TOOK}s — that is the timeout talking, not the guard"
  tmux -L "$SOCKET" capture-pane -t "=tui-test:" -p 2>/dev/null | grep -q 'Pattern not found\|\.exec-' \
    && die "exec's script line reached the pager"
  # Only a step that added no failure gets the success line: `die` records and continues, so
  # without this gate a red run ended on a misleading "refused in 126s" (first red harness run).
  if [ "$FAILED" -eq "$F0" ]; then
    echo "   refused in ${TOOK}s (fg=$FG less_pid=${LESS_PID:-none}): $(echo "$TUI_OUT" | grep -i 'not a shell' | head -1 | cut -c1-100)"
  fi
else
  echo "   SKIP: less never started on this platform (fg=$FG) — nothing to guard"
fi
tmux -L "$SOCKET" send-keys -t "=tui-test:" q 2>/dev/null; sleep 1
# Same class as step 3: the pane is handing the terminal back, so wait for the shell to be
# the foreground process again rather than trusting the sleep above — and let the wait's own failure
# say so, instead of blaming exec.
RECOV=$(TMUX_AGENT_ACTOR=smoke-supervisor bash test/helpers/wait-shell.sh "$SOCKET" tui-test 20 2>&1) \
  || die "tui-test never returned to a shell after the pager quit: $RECOV"
$CLI exec tui-test "echo RECOVERED" 2>&1 | grep -q RECOVERED || die "exec broken after TUI exits"
$CLI kill tui-test >/dev/null 2>&1 || true

step "13. baseline poll does not fabricate a state transition"
node --input-type=module -e "
import {Monitor} from './dist/core/monitor.js';
import {Tmux} from './dist/core/tmux.js';
import {Ledger} from './dist/core/ledger.js';
const t=new Tmux({socket:'$SOCKET'}); const l=new Ledger('$TMUX_AGENT_HOME/ledger2');
const m=new Monitor(t,l,'$TMUX_AGENT_HOME');
await m.fleetFast();                       // baseline pass: must emit nothing
import {readdirSync,readFileSync} from 'node:fs';
let unknowns=0;
for(const f of readdirSync('$TMUX_AGENT_HOME/ledger2')){
  for(const line of readFileSync('$TMUX_AGENT_HOME/ledger2/'+f,'utf8').split('\n')){
    if(!line.trim()) continue;
    const e=JSON.parse(line);
    if(e.type==='session.state' && e.data?.to==='UNKNOWN') unknowns++;
  }
}
if(unknowns>0){ console.error('fabricated '+unknowns+' UNKNOWN transitions'); process.exit(1); }
" || die "baseline emits spurious UNKNOWN transitions"

step "14. npm package ships only what it should"
PACK=$(npm pack --dry-run --json 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s)[0];
  const bad=j.files.map(f=>f.path).filter(p=>p.startsWith('src/')||p.startsWith('test/')||p.startsWith('docs/'));
  console.log(bad.length? 'LEAKED:'+bad.slice(0,3).join(',') : 'clean');
});")
[ "$PACK" = "clean" ] || die "npm package includes source/test/docs ($PACK)"

step "15. AGNOSTIC: a stranger's lexicon changes real behaviour with no code change (KR3)"
# The end-to-end form of the claim "agnostic". Unit tests prove the pieces; this proves the
# SHIPPED BINARY honours a config file written by someone who is not us: an unprofiled CLI's
# prompt classifies, their supervisor is not called an orphan, and their secret shape is redacted
# on the served path. If this step ever fails, "agnostic" is back to being a README claim.
LEXHOME="$TMUX_AGENT_HOME/lexhome"; mkdir -p "$LEXHOME"
cat > "$LEXHOME/lexicon.json" <<'LEXEOF'
{ "version": 1,
  "profiles": [{ "name": "acme-agent", "blocked": ["^\\s*»\\s*\\d+\\."] }],
  "parents": { "nonSession": ["acme-boss"] },
  "redact": [{ "name": "acme-key", "pattern": "ACME_[A-Z0-9]{10}", "replacement": "[REDACTED_ACME]" }] }
LEXEOF
TMUX_AGENT_HOME="$LEXHOME" $CLI spawn lex-e2e --cwd /tmp --parent acme-boss >/dev/null 2>&1 || die "lexicon spawn failed"
# doctor must SHOW the stranger's vocabulary in effect — config you cannot verify is faith-based
# `|| die` on every $(...) — see the note at step 6: a bare command substitution under
# `set -e` aborts the whole script silently, so a real failure prints no diagnosis at all.
DOC=$(TMUX_AGENT_HOME="$LEXHOME" $CLI doctor --parent acme-boss 2>/dev/null) || die "doctor exited non-zero"
echo "$DOC" | grep -q '"acme-agent"' || die "doctor does not list the user profile (chain: $(echo "$DOC" | tr -d '\n' | head -c 200))"
echo "$DOC" | grep -q 'non-session supervisor' || die "doctor does not treat acme-boss as a supervisor"
# their CLI's blocking prompt: unknown glyph, and a secret the built-ins do not know
# (typed with effect-verification: on 3.2a the raw send was eaten by shell init and the step
# read IDLE — correctly, of a bare prompt — the injection itself was the failure. TMUX-67.)
lex_prompt_rendered() {
  local pane
  pane=$(tmux -L "$SOCKET" capture-pane -t "=lex-e2e:" -p 2>/dev/null) || return 1
  # `clear` wipes the echoed input line on execution: output present + echo gone = it ran.
  echo "$pane" | grep -qF "Deploy to prod" && ! echo "$pane" | grep -qF "printf"
}
LEXCMD='clear; printf "\n» 1. Deploy to prod\n  2. Skip\nkey=ACME_ABCDE12345\n"'
type_until "=lex-e2e:" "$LEXCMD" lex_prompt_rendered || die "could not type into lex-e2e (init window)"
# Classify with a bounded retry that RE-RENDERS between reads: late init noise (ble.sh replay,
# kiro-cli check) can land after a good render and scroll the marker out of the tail. The
# command opens with `clear`, so re-typing HEALS a polluted pane rather than racing it —
# condition-based waiting, never one timed shot.
LEXSTATE=""
for lextry in 1 2 3; do
  sleep 1
  # an explicit row select: `status lex-e2e` was an extra positional `status` ignored until TMUX-106
  LEXSTATE=$(TMUX_AGENT_HOME="$LEXHOME" $CLI status 2>/dev/null | awk -F'\t' '$1=="lex-e2e"{print $2; exit}') || die "status exited non-zero"
  [ "$LEXSTATE" = "BLOCKED" ] && break
  type_until "=lex-e2e:" "$LEXCMD" lex_prompt_rendered || true
done
[ "$LEXSTATE" = "BLOCKED" ] || die "stranger's profile did not classify their prompt (got '$LEXSTATE', want BLOCKED)"
# redaction on the SERVED path (raw pipe-pane bytes are a documented accepted risk, see THREAT-MODEL)
SERVED=$(TMUX_AGENT_HOME="$LEXHOME" node --input-type=module -e "
import {Tmux} from './dist/core/tmux.js';
import {redact,configureRedaction} from './dist/core/redact.js';
import {loadLexicon} from './dist/core/lexicon.js';
configureRedaction(loadLexicon('$LEXHOME'));
process.stdout.write(redact(await new Tmux({socket:'$SOCKET'}).capturePane('lex-e2e',40)));
" 2>/dev/null) || die "served-capture probe exited non-zero"
echo "$SERVED" | grep -q 'REDACTED_ACME' || die "stranger's secret shape not redacted on the served path"
# `grep -q X && die` is wrong under set -e style: use an explicit if, since a NON-match makes
# grep exit 1 and would abort the script on the success path.
if echo "$SERVED" | grep -q 'ACME_ABCDE12345'; then die "raw secret survived redaction on the served path"; fi
# a malformed lexicon must fail LOUDLY (exit 78 EX_CONFIG), never silently run with no rules
echo '{ bad json' > "$LEXHOME/lexicon.json"
RC=0; TMUX_AGENT_HOME="$LEXHOME" $CLI doctor >/dev/null 2>&1 || RC=$?
[ "$RC" = "78" ] || die "malformed lexicon should exit 78 (EX_CONFIG), got $RC"
# a lexicon NAMED on a path that does not exist is refused the same way — on bc8b2ea it was silently the
# shipped defaults, exit 0, the operator's redact rules not applied; only the ABSENT default is silent
RC=0; TMUX_AGENT_HOME="$LEXHOME" $CLI --lexicon "$LEXHOME/nope.json" status >"$LEXHOME/nope.out" 2>"$LEXHOME/nope.err" || RC=$?
[ "$RC" = "78" ] || die "--lexicon \$LEXHOME/nope.json status should exit 78 (EX_CONFIG), got $RC — a named lexicon that cannot be read ran as the defaults (stdout: $(head -c 120 "$LEXHOME/nope.out"))"
[ ! -s "$LEXHOME/nope.out" ] || die "--lexicon \$LEXHOME/nope.json status printed a fleet snapshot instead of refusing"
grep -q 'lexicon config error: --lexicon ".*/nope.json": cannot be read — no such file or directory (ENOENT)' "$LEXHOME/nope.err" \
  || die "the refusal does not name --lexicon, the path as given and the reason (got: $(cat "$LEXHOME/nope.err"))"
echo "   --lexicon \$LEXHOME/nope.json status: rc=$RC, $(cat "$LEXHOME/nope.err")"
rm -f "$LEXHOME/lexicon.json"
TMUX_AGENT_HOME="$LEXHOME" $CLI kill lex-e2e >/dev/null 2>&1 || true

step "16. pre-push gate installed (TMUX-68: pushes build from the COMMITTED tree only)"
# A green suite must MEAN the gate is in place — installation is a check, not etiquette.
# `.git` is a dir only in a primary checkout (worktrees share the primary's hooks; a
# tarball has no .git at all) — those are the only places a push can originate from here.
if [ -d .git ]; then
  [ -x scripts/pre-push ] || die "scripts/pre-push missing or not executable"
  ln -sf ../../scripts/pre-push .git/hooks/pre-push
  if ! bash .git/hooks/pre-push; then die "installed pre-push gate does not pass on the current HEAD"; fi
else
  echo "   (no .git dir — not a pushing checkout, install skipped)"
fi

step "17. the running build is observable: --version and doctor.build agree with package.json; doctor reports a missing dashboard, exit 0"
# Measured 2026-09-12: the operator's dashboard daemon served a 47-commit-stale build for 16 days and
# neither the CLI nor doctor could say which build anything was running — there was no --version at
# all. --version must answer from the build stamp without tmux or a home; doctor must carry the block.
PKGV=$(node -p "require('./package.json').version")
VOUT=$($CLI --version) || die "--version exited non-zero"
case "$VOUT" in "$PKGV ("*) ;; *) die "--version printed '$VOUT', want it to start with '$PKGV ('";; esac
echo "$VOUT" | grep -q "built " || die "--version does not name the build time ($VOUT)"
DOCV=$($CLI doctor | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(d.build&&d.build.version||'MISSING')})")
[ "$DOCV" = "$PKGV" ] || die "doctor.build.version is '$DOCV', want $PKGV"
echo "   --version: $VOUT"
# TMUX-93: doctor probes the dashboard on this host (127.0.0.1:<--port>/api/health). With no dashboard
# on the port asked about it must still exit 0 and SAY there is none — a missing daemon is a report,
# never a failure (doctor is the verb the README sends a stranger to). The port is one nothing
# listens on (bound once, released), so the probe is refused rather than answered.
FREEP=$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})") || die "could not find a free loopback port"
DOCD=$($CLI doctor --port "$FREEP") || die "doctor --port $FREEP (no dashboard) exited non-zero"
echo "$DOCD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).dashboard;if(!d||d.reachable!==false||d.stale!==null||d.build!==null||!d.reason.startsWith('no dashboard on 127.0.0.1:'+$FREEP)){console.error('dashboard block: '+JSON.stringify(d));process.exit(1)}})" || die "doctor does not report the missing dashboard as reachable=false / stale=null / build=null"
echo "   doctor --port $FREEP: dashboard.reachable=false (no daemon on that port), exit 0"

if [ "$FAILED" -eq 0 ]; then echo "SMOKE PASS (17/17)"; else echo "SMOKE FAILED"; exit 1; fi
