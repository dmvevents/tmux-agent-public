#!/usr/bin/env bash
# Web dashboard smoke: loopback bind, fleet/history/session APIs, audited send via HTTP,
# and the remote-bind refusal (security invariant).
set -euo pipefail
cd "$(dirname "$0")/.."
. test/helpers/kill-server.sh   # ta_kill_server: kill-server, wait until tmux says the server is gone, unlink its socket file

export TMUX_AGENT_HOME="$(mktemp -d)"
SOCKET="ta-web-$$"
# free_port — a loopback port the OS has just released: bind 127.0.0.1:0 through node, print it,
# close (bash has no listen(0); the smoke shells out to node for everything else). The idiom of
# test/helpers/built-web.js and the node suites. Until TMUX-177 this script rolled ONE base from
# bash's own generator — 20000 plus an offset below 20000 — and bound six daemons at fixed offsets
# from it; each daemon's CLI scans twenty ports forward (src/web/server.ts findFreePort) and gives
# up with `no free port in A..A+19`, so a base whose window sat inside a block of squatters (on
# 2026-09-29 127.0.0.1:24282..24304 were held by one MCP server per Claude Code session on the
# host, the block growing by one per session) red the run at step 1 with "no dashboard banner" —
# ≈0.1% of runs, the class TMUX-176 closed in the node harness. The OS never hands out a bound
# port; a stranger taking this one between the close and the daemon's bind is what the CLI's
# forward scan is for, and the banner — not the request — stays the truth (start_web follows it).
free_port(){ node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
# pick_port <offset> — the port a later daemon is asked for: PORT+offset while SMOKE_WEB_PORT pins
# the base (the fixed layout TMUX-77's port-squatter regression run reproduces), else the OS's pick.
pick_port(){ if [ -n "${SMOKE_WEB_PORT:-}" ]; then echo $(( PORT + $1 )); else free_port; fi; }
# SMOKE_WEB_PORT pins the base so the port-squatter regression run is reproducible
PORT=${SMOKE_WEB_PORT:-$(free_port)}
CLI="node dist/bin/tmux-agent.js --socket $SOCKET --actor web-smoke"
FAILED=0
step(){ echo "== $1"; }
# portable mode read: GNU `stat -c` vs BSD `stat -f`
mode_of(){ stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null; }

die(){ echo "WEB-SMOKE FAIL: $1" >&2; FAILED=1; }
WEB_PIDS=""
cleanup(){ for p in $WEB_PIDS; do kill "$p" 2>/dev/null || true; done; ta_kill_server "$SOCKET" >/dev/null || true; rm -rf "$TMUX_AGENT_HOME"; }
trap cleanup EXIT

# start_web <logfile> <web args...> — sets WEB_PID and WEB_PORT (the port actually BOUND).
# The CLI auto-scans forward when the requested port is busy ("port X busy — using Y"), so a
# test that curls the port it asked for can hit a stranger's socket instead of ours — an
# ephemeral-port squatter turned step 21 into a false negative on 2026-09-02. The
# dashboard banner names the real port; follow it. Every server joins WEB_PIDS so cleanup
# reaps it even when set -e aborts a step mid-flight (the leaked server outlived the suite
# and held npm's stdout pipe open). The bound port is printed so a run's output shows where
# every daemon landed (the squatted-window evidence, TMUX-177).
start_web(){
  local log="$1"; shift
  $CLI web "$@" >"$log" 2>&1 & WEB_PID=$!
  WEB_PIDS="$WEB_PIDS $WEB_PID"
  for i in $(seq 1 40); do grep -q "dashboard:" "$log" 2>/dev/null && break; sleep 0.25; done
  WEB_PORT=$(sed -n 's|.*dashboard: http://127\.0\.0\.1:\([0-9][0-9]*\)/.*|\1|p' "$log" | head -1)
  [ -n "$WEB_PORT" ] || { echo "WEB-SMOKE FAIL: no dashboard banner in $log:" >&2; cat "$log" >&2; exit 1; }
  echo "   dashboard bound 127.0.0.1:$WEB_PORT"
}

step "0. spawn a session to look at"
$CLI spawn web-child --cwd /tmp --parent web-smoke --task "gui demo" >/dev/null

step "1. server starts on loopback (token disabled for test simplicity; token path covered in step 15)"
start_web "$TMUX_AGENT_HOME/web-main.log" --port "$PORT" --no-token
WEBPID=$WEB_PID; PORT=$WEB_PORT
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/api/fleet" >/dev/null 2>&1 && break; sleep 0.5; done
# grep a file, not a pipe (same race TMUX-47 fixed at step 19): grep -q exits at first match —
# the marker is in the page title, byte ~200 of a ~36KB body — closing the pipe, and a
# still-writing curl takes EPIPE (exit 23), so pipefail reads the successful match as failure.
curl -sf "http://127.0.0.1:$PORT/" >"$TMUX_AGENT_HOME/dashboard-step1.html" || die "dashboard html fetch"
grep -q "tmux-agent" "$TMUX_AGENT_HOME/dashboard-step1.html" || die "dashboard html"

step "2. fleet api shows session + lineage"
curl -sf "http://127.0.0.1:$PORT/api/fleet" | grep -q '"web-child"' || die "fleet api"
curl -sf "http://127.0.0.1:$PORT/api/fleet" | grep -q '"parent":"web-smoke"' || die "lineage in fleet"

step "3. session drill-in: pane + cwd + events"
# web-child may still be inside its startup window. On a host whose shell init starts a pty wrapper
# (kiro-cli-term here; `script`, `asciinema rec`, `expect` elsewhere) the deepest foreground process
# under a fresh pane is the wrapper until the nested shell exists, and exec's guard is RIGHT to refuse
# there. test/smoke.sh step 3 has waited for the shell since TMUX-121; this step ran its
# exec straight after step 0's spawn with only the dashboard start between them, and lost that race
# once in 484 fire runs — 2026-10-02 14:24Z, `refusing exec in web-child: foreground process is
# "kiro-cli-term"`, where `set -e` took the script before `die` could speak. Same wait,
# same loud failure: a pane a real pager holds never becomes ready, and the step dies naming it.
READY=$(TMUX_AGENT_ACTOR=web-smoke bash test/helpers/wait-shell.sh "$SOCKET" web-child 20 2>&1) \
  || die "web-child never presented a shell to exec's guard: $READY"
# exec output now comes from a file (pane text is unreliable — line-editor redraws), so
# assert exec's RETURN VALUE, and assert the pane view separately via a plain send.
EX=$($CLI exec web-child "echo dashboard-probe-ok")
echo "$EX" | grep -q "dashboard-probe-ok" || die "exec output (got: $EX)"
echo "   exec $READY"
$CLI send web-child "echo pane-visible-marker" >/dev/null; sleep 1
D=$(curl -sf "http://127.0.0.1:$PORT/api/session/web-child")
echo "$D" | grep -q "pane-visible-marker" || die "pane content"
echo "$D" | grep -q '"cwd":"/tmp"' || die "cwd"
echo "$D" | grep -q '"session.spawned"' || die "events"

step "4. send via HTTP → verified + audited"
curl -sf -X POST "http://127.0.0.1:$PORT/api/send" -H 'content-type: application/json' \
  -d '{"name":"web-child","text":"echo sent-from-gui"}' | grep -q '"verified":true' || die "http send"
sleep 1
curl -sf "http://127.0.0.1:$PORT/api/session/web-child" | grep -q "sent-from-gui" || die "sent text visible"
grep -q '"type":"input.sent".*web-smoke' "$TMUX_AGENT_HOME"/ledger/*.ndjson || die "send audited"

step "5. history shows live session; kill → decommissioned"
curl -sf "http://127.0.0.1:$PORT/api/history" | grep -q '"live":true' || die "history live"
$CLI kill web-child >/dev/null
curl -sf "http://127.0.0.1:$PORT/api/history" | grep -q '"killedAt":"2' || die "history killedAt"

step "6. SECURITY: non-loopback bind refused BEFORE any socket is opened; the override needs a typed token"
# 192.0.2.1 is TEST-NET-1 (RFC 5737): on no interface, so a bind on it can only fail — which makes
# the port finder's answer to a probe on it the tell that a socket was attempted before the refusal:
# "listen EADDRNOTAVAIL", named at once since TMUX-180 (the finder scans past EADDRINUSE alone now),
# "no free port" — twenty EADDRNOTAVAIL probes — before it; the grep below matches both shapes. Until
# TMUX-102 this step targeted 0.0.0.0 and was green while findFreePort had listen()ed on all
# interfaces for one round-trip before startWeb refused. Never 0.0.0.0 here: a guard that runs
# second still prints "refusing to bind" on that host, after the bind, and the step passes on the bug.
OUT=$(node dist/bin/tmux-agent.js --socket "$SOCKET" web --port $((PORT+1)) --host 192.0.2.1 2>&1 || true)
echo "$OUT" | grep -qi "refusing to bind" || die "remote-bind refusal (got: $OUT)"
if echo "$OUT" | grep -qiE "no free port|listen EADDRNOTAVAIL"; then die "a bind was attempted before the refusal (got: $OUT)"; fi
# the stored/auto-generated web-token serves loopback only — off loopback --token must be typed
OUT=$(node dist/bin/tmux-agent.js --socket "$SOCKET" web --port $((PORT+1)) --host 192.0.2.1 --dangerously-allow-remote 2>&1 || true)
echo "$OUT" | grep -q "requires --token" || die "remote override without a typed --token (got: $OUT)"
if echo "$OUT" | grep -qiE "no free port|listen EADDRNOTAVAIL"; then die "a bind was attempted before the token refusal (got: $OUT)"; fi


step "7. ROBUSTNESS: fleet poll cost is O(1) execs, not O(sessions)"
for n in 1 2 3 4; do $CLI spawn scale-$n --cwd /tmp --parent web-smoke >/dev/null; done
T0=$(date +%s%N); curl -sf "http://127.0.0.1:$PORT/api/fleet" >/dev/null; T1=$(date +%s%N)
MS=$(( (T1-T0)/1000000 )); echo "   5-session fleet poll: ${MS}ms"
[ "$MS" -lt 900 ] || die "fleet poll too slow (${MS}ms) — batching regressed"

step "8. ROBUSTNESS: concurrent polls are single-flighted"
T0=$(date +%s%N); PIDS=""
for i in 1 2 3 4 5; do curl -sf "http://127.0.0.1:$PORT/api/fleet" >/dev/null & PIDS="$PIDS $!"; done
wait $PIDS   # NOT bare `wait` — that would also block on the web server backgrounded in step 1
T1=$(date +%s%N)
MS5=$(( (T1-T0)/1000000 )); echo "   5 concurrent polls: ${MS5}ms"
[ "$MS5" -lt 1200 ] || die "concurrent polls stampeded (${MS5}ms)"

step "9. ROBUSTNESS: log rotation caps disk"
BIG="$TMUX_AGENT_HOME/logs/rot-test.log"; head -c 300000 /dev/zero | tr '\0' 'x' > "$BIG"
node --input-type=module -e "
import {rotateIfNeeded} from './dist/core/rotate.js';
const did=rotateIfNeeded('$BIG',{maxBytes:100000,keep:2});
if(!did) process.exit(1);
" || die "rotation did not fire"
[ -f "$BIG.1" ] || die "rotated generation missing"

step "10. ROBUSTNESS: ledger index parses incrementally"
node --input-type=module -e "
import {LedgerIndex} from './dist/analytics/ledger-index.js';
const ix=new LedgerIndex('$TMUX_AGENT_HOME/ledger',0);
const a=ix.sessions().length;
if(a===0) process.exit(1);
const w=ix.waste(3);
if(!Array.isArray(w)) process.exit(2);
" || die "ledger index"
for n in 1 2 3 4; do $CLI kill scale-$n >/dev/null 2>&1 || true; done

step "11. SECURITY: CSRF — cross-origin POST refused (proven exploit, 2026-08-25)"
CO=$(curl -s -X POST "http://127.0.0.1:$PORT/api/send" -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' -d '{"name":"web-child","text":"echo CSRF_MUST_NOT_RUN"}')
echo "$CO" | grep -qi "cross-origin request refused" || die "CSRF guard missing (got: $CO)"

step "12. SECURITY: Sec-Fetch-Site cross-site refused"
SF=$(curl -s "http://127.0.0.1:$PORT/api/fleet" -H 'Sec-Fetch-Site: cross-site')
echo "$SF" | grep -qi "cross-site request refused" || die "Sec-Fetch-Site guard missing"

step "13. SECURITY: DNS-rebinding — non-loopback Host refused"
DR=$(curl -s "http://127.0.0.1:$PORT/api/fleet" -H 'Host: evil.example')
echo "$DR" | grep -qi "not loopback" || die "DNS-rebinding guard missing"

step "14. legit same-origin request still allowed (guard is not over-broad)"
OK=$(curl -s "http://127.0.0.1:$PORT/api/fleet" -H "Origin: http://127.0.0.1:$PORT" -H 'Sec-Fetch-Site: same-origin')
echo "$OK" | grep -q '"sessions"' || die "guard blocks legitimate same-origin traffic"

step "15. SECURITY: token required by DEFAULT (shared-host defense)"
start_web "$TMUX_AGENT_HOME/tok.log" --port "$(pick_port 7)"
TPID=$WEB_PID; TPORT=$WEB_PORT
TOK=$(sed -n 's/.*token=\([A-Za-z0-9_-][A-Za-z0-9_-]*\).*/\1/p' "$TMUX_AGENT_HOME/tok.log" | head -1)
[ -n "$TOK" ] || die "no token generated by default"
UNAUTH=$(curl -s "http://127.0.0.1:$TPORT/api/fleet")
echo "$UNAUTH" | grep -qi "unauthorized" || die "token not enforced by default (got: $UNAUTH)"
curl -s "http://127.0.0.1:$TPORT/api/fleet?token=$TOK" | grep -q '"sessions"' || die "valid token rejected"
[ "$(mode_of "$TMUX_AGENT_HOME/web-token")" = "600" ] || die "token file not 0600"
kill "$TPID" 2>/dev/null || true

step "16. SECURITY: log + ledger files are 0600, home dir 0700"
[ "$(mode_of "$TMUX_AGENT_HOME")" = "700" ] || die "home dir not 0700"
for f in "$TMUX_AGENT_HOME"/ledger/*.ndjson; do
  [ "$(mode_of "$f")" = "600" ] || die "ledger $f not 0600 ($(mode_of "$f"))"
done

step "17. SECURITY: unsafe socket name refused (env footgun)"
# TMUX-113: until 7b1e542 the name was judged only by the driver's socketArgs at the first tmux call — exit 1 in its words,
# no source, the 0700 home already made; this step asserted the words alone, with `|| true`, no exit code. Now the CLI
# judges --socket (else TMUX_AGENT_SOCKET) before anything is touched: exit 64, one line naming the source, the value as
# typed and the rule. The shell-metacharacter shape is kept; the safe socket every other step runs on is the control.
BAD_RC=0; BAD=$(node dist/bin/tmux-agent.js --socket ';rm -rf /tmp/nope' lineage 2>&1) || BAD_RC=$?
[ "$BAD_RC" -eq 64 ] || die "--socket ';rm -rf /tmp/nope' lineage exited $BAD_RC, want 64 (EX_USAGE) — the socket name was judged late (got: $BAD)"
[ "$BAD" = '--socket: invalid socket name: ";rm -rf /tmp/nope" ([A-Za-z0-9._-], 1 or more)' ] \
  || die "the socket refusal does not name --socket, the value as typed and the rule in one line (got: $BAD)"

step "18. UX: timeline reconstructs state durations from the ledger"
TL=$(curl -sf "http://127.0.0.1:$PORT/api/timeline/web-child")
echo "$TL" | grep -q '"spans"' || die "timeline endpoint missing"
# no two adjacent spans may share a state (a restart re-emitting the same state would make a
# long quiet period look like activity)
echo "$TL" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const t=JSON.parse(s); let prev=null,dup=0;
  for(const sp of t.spans){ if(prev===sp.state) dup++; prev=sp.state; }
  if(dup){ console.error('adjacent duplicate spans: '+dup); process.exit(1); }
});" || die "timeline has adjacent duplicate states"
# A timed-out exec must read as a timeout, not as an exec still running. Plant the terminal event
# TMUX-98 ledgers (the CLI has no timeout flag, and a real one would cost 120 s here) and demand a
# mark that names the bound: the exec.done branch prints `exit N`, a timed-out exec has no exit
# code, and before TMUX-98 nothing was ledgered at all — the timeline ended at input.sent.
printf '{"v":1,"ts":"%s","type":"exec.timeout","session":"web-child","actor":"web-smoke","data":{"id":"tasmoke","timeoutMs":2000,"elapsedMs":2004,"command":"sleep 6"}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >> "$TMUX_AGENT_HOME/ledger/events-$(date -u +%Y-%m-%d).ndjson"
TL=$(curl -sf "http://127.0.0.1:$PORT/api/timeline/web-child")
echo "$TL" | grep -q '"type":"exec.timeout","detail":"timeout after 2000ms"' \
  || die "timeline does not render exec.timeout as a timeout (marks: $(echo "$TL" | grep -o '"marks":.*' | cut -c1-240))"

step "19. UX: dashboard serves the fleet-scale controls"
# grep a file, not a pipe: under pipefail, `echo "$page" | grep -q` races — grep exits at
# first match, a still-writing echo takes SIGPIPE, and the match reads as a failure
# (false negative on CI once the page outgrew the runner's pipe buffer).
HTML_FILE="$TMUX_AGENT_HOME/dashboard-smoke.html"
curl -sf "http://127.0.0.1:$PORT/" >"$HTML_FILE"
for marker in 'id="attn"' 'id="q"' 'id="autorefresh"' 'id="vitals"' 'th class="sortable' 'keydown' 'localStorage'; do
  grep -q "$marker" "$HTML_FILE" || die "dashboard missing UX surface: $marker"
done

step "20. UX: fleet API carries engagement + sorts driven sessions first"
# needs at least one live session: web-child was killed in step 5 and the scale-N sessions in
# step 10, so an empty fleet would make the field assertions vacuously fail.
$CLI spawn eng-probe --cwd /tmp --parent web-smoke >/dev/null
$CLI send eng-probe "echo engagement-probe" >/dev/null 2>&1 || true
sleep 3
FE=$(curl -sf "http://127.0.0.1:$PORT/api/fleet")
echo "$FE" | grep -q '"engagement"' || die "fleet rows missing engagement"
echo "$FE" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const f=JSON.parse(s).sessions;
  const RANK={ACTIVE:0,ATTACHED:1,AUTONOMOUS:2,PARKED:3,ORPHANED:4};
  let last=-1;
  for(const x of f){ const r=RANK[x.engagement]; if(r===undefined){console.error('bad engagement: '+x.engagement);process.exit(1)}
    if(r<last){console.error('not sorted by engagement');process.exit(1)} last=r; }
});" || die "engagement sort/shape"
echo "$FE" | grep -q '"lastDrivenBy"' || die "fleet rows missing lastDrivenBy"
# a session we just drove must read ACTIVE and name its driver
echo "$FE" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const p=JSON.parse(s).sessions.find(x=>x.session==='eng-probe');
  if(!p){console.error('eng-probe missing from fleet');process.exit(1)}
  if(p.engagement!=='ACTIVE'){console.error('driven session reads '+p.engagement+', want ACTIVE');process.exit(1)}
  if(p.lastDrivenBy!=='web-smoke'){console.error('lastDrivenBy='+p.lastDrivenBy);process.exit(1)}
});" || die "driven session not classified ACTIVE"
$CLI kill eng-probe >/dev/null 2>&1 || true

step "21. SECURITY/POLICY: web surface read-only → send refused with 403, not 500"
# a policy refusal must read as 'forbidden by configuration', not 'server fault' — a 500 here
# put a console error in the browser on every read-only send attempt (browser audit 2026-08-25)
printf '{ "surfaces": { "web": { "readOnly": true } } }\n' > "$TMUX_AGENT_HOME/policy.json"
$CLI spawn ro-probe --cwd /tmp --parent web-smoke >/dev/null
start_web "$TMUX_AGENT_HOME/ro.log" --port "$(pick_port 9)" --no-token
RPID=$WEB_PID; RPORT=$WEB_PORT
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$RPORT/api/fleet" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://127.0.0.1:$RPORT/api/fleet" | grep -q '"readOnly":true' || die "fleet api does not advertise read-only"
RCODE=$(curl -s -o "$TMUX_AGENT_HOME/ro.out" -w '%{http_code}' -X POST "http://127.0.0.1:$RPORT/api/send" \
  -H 'content-type: application/json' -d '{"name":"ro-probe","text":"echo RO_MUST_NOT_RUN"}')
[ "$RCODE" = "403" ] || die "read-only send returned HTTP $RCODE, want 403 ($(cat "$TMUX_AGENT_HOME/ro.out"))"
grep -qi "read-only" "$TMUX_AGENT_HOME/ro.out" || die "403 body does not explain the read-only policy"
sleep 1
curl -sf "http://127.0.0.1:$RPORT/api/session/ro-probe" | grep -q "RO_MUST_NOT_RUN" && die "read-only send REACHED the pane"
kill "$RPID" 2>/dev/null || true
rm -f "$TMUX_AGENT_HOME/policy.json"
$CLI kill ro-probe >/dev/null 2>&1 || true

step "22. H1: /api/health vitals match free -b / df -B1 within 2% (TMUX-52 acceptance)"
HJSON="$TMUX_AGENT_HOME/health.json"
curl -sf "http://127.0.0.1:$PORT/api/health" >"$HJSON" || die "health endpoint"
node -e "
const h=require('$HJSON');
if(!['proc','os-only'].includes(h.mode)) {console.error('bad mode '+h.mode); process.exit(1)}
if(!(h.mem.totalBytes>0 && h.mem.availableBytes>0)) {console.error('mem not sampled'); process.exit(1)}
if(!(Array.isArray(h.disk)&&h.disk.length>=1)) {console.error('disk not sampled'); process.exit(1)}
if(h.load.length!==3) {console.error('load not sampled'); process.exit(1)}
// H4/H5 contract: the keys are always present; values are null until there is real evidence
if(!('prediction' in h)) {console.error('prediction key missing (H5)'); process.exit(1)}
if(!('lastCrash' in h)) {console.error('lastCrash key missing (H4)'); process.exit(1)}
if(h.prediction!==null) {console.error('healthy smoke host must not predict OOM: '+JSON.stringify(h.prediction)); process.exit(1)}
" || die "health payload shape"
# the numbers must agree with the standard tools, not just exist (Linux: free/df -B1; macOS
# CI has neither GNU tool, so the shape check above is the honest bar there)
if command -v free >/dev/null 2>&1 && free -b >/dev/null 2>&1; then
  read -r FT FA <<<"$(free -b | awk '/^Mem:/{print $2, $7}')"
  node -e "
const h=require('$HJSON');
const within=(a,b,what)=>{ if(Math.abs(a-b)>0.02*Math.max(a,b)){console.error(what+': api='+a+' tool='+b); process.exit(1)} };
within(h.mem.totalBytes, $FT, 'mem total vs free -b');
within(h.mem.availableBytes, $FA, 'mem available vs free -b');
if(h.mode!=='proc'){console.error('host has /proc but mode='+h.mode); process.exit(1)}
" || die "health mem numbers disagree with free -b"
fi
if df -B1 "$HOME" >/dev/null 2>&1; then
  node -e "
const {execFileSync}=require('child_process');
const h=require('$HJSON');
const within=(a,b,what)=>{ if(Math.abs(a-b)>0.02*Math.max(a,b)){console.error(what+': api='+a+' tool='+b); process.exit(1)} };
for(const d of h.disk){
  const out=execFileSync('df',['-B1','--output=size,avail',d.path],{encoding:'utf8'}).trim().split('\n').pop().trim().split(/\s+/);
  within(d.totalBytes, Number(out[0]), 'disk total '+d.path+' vs df -B1');
  within(d.freeBytes, Number(out[1]), 'disk avail '+d.path+' vs df -B1');
}
" || die "health disk numbers disagree with df -B1"
fi

step "23. H2: fleet rssBytes reflects a real allocation; /api/session carries the process deep dive (TMUX-53 acceptance)"
if [ -e /proc/self/stat ]; then
  $CLI spawn mem-probe --cwd /tmp --parent web-smoke >/dev/null
  # The pane-startup window at its third site — and the first that is a `send`. Until the
  # shell exists, the deepest foreground process under a fresh pane is the host's pty wrapper (kiro-cli-term here), and a
  # paste there is ECHOED by the pty, so send's capture-pane verification passes and it exits 0 `sent+verified` with
  # `cleared:false` on its ledger row — while whether the shell ever RUNS the line is the wrapper's to decide. Measured
  # 2026-10-02 (scratch/ga-fire-2026-10-02-16Z/h2probe.log): at this step's own cadence 4 of 5 pastes found no shell and
  # the wrapper forwarded them anyway; the 16:24Z run was the one in 476 it did not — rssBytes 111136768 twelve seconds
  # later, kiro-cli-term + bash exactly, no node child. So wait for the shell the way step 3 does, and make the send's
  # own verdict fatal instead of discovering it 12 s later as a missing process.
  READY=$(TMUX_AGENT_ACTOR=web-smoke bash test/helpers/wait-shell.sh "$SOCKET" mem-probe 20 2>&1) \
    || die "mem-probe never presented a shell to exec's guard: $READY"
  echo "   exec $READY"
  # a ~200MB node child inside the pane's process tree (& so the shell stays interactive)
  $CLI send mem-probe "node -e 'const a=Buffer.alloc(200000000,7);a[0]=1;setInterval(()=>{},1000)' &" >/dev/null \
    || die "send into mem-probe was not verified — the allocation never ran"
  RSS=0
  for i in $(seq 1 12); do
    sleep 1  # allocation + the fleet cache TTL (2s) both need a beat
    RSS=$(curl -sf "http://127.0.0.1:$PORT/api/fleet" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const p=JSON.parse(s).sessions.find(x=>x.session==='mem-probe');
  console.log(p&&p.rssBytes!=null?p.rssBytes:0);
});")
    [ "$RSS" -ge 150000000 ] 2>/dev/null && break
  done
  [ "$RSS" -ge 150000000 ] 2>/dev/null || die "mem-probe rssBytes=$RSS, want >=150MB for a 200MB Buffer"
  D=$(curl -sf "http://127.0.0.1:$PORT/api/session/mem-probe")
  echo "$D" | grep -q '"procs":\[' || die "session detail missing procs deep dive"
  echo "$D" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const d=JSON.parse(s);
  // Assert on RSS and a POPULATED comm, not on comm=='node': /proc/<pid>/comm is the THREAD name
  // and node 24 names its main thread 'MainThread', which made this red on ubuntu-24 only. What
  // the deep dive promises is a per-process row carrying the allocation; the runtime's internal
  // thread name is not ours to pin. (Same fix as test/memory.test.js.)
  if(!d.procs.some(p=>typeof p.comm==='string'&&p.comm.length>0&&p.rssBytes>=150000000)){console.error('no proc >=150MB in '+JSON.stringify(d.procs.slice(0,4)));process.exit(1)}
  if(d.snapshot.rssBytes==null||d.snapshot.rssBytes<150000000){console.error('deep snapshot rssBytes='+d.snapshot.rssBytes);process.exit(1)}
});" || die "procs deep dive does not show the allocating node child"
  $CLI kill mem-probe >/dev/null 2>&1 || true
else
  echo "   skipped: no /proc on this host — rssBytes degrades to null by design (unit-tested)"
fi

step "24. H3: forced-low thresholds → health.critical in ledger + alerts on /api/fleet + notify (TMUX-54 acceptance)"
# thresholds impossible to satisfy => the startup tick must emit exactly one crit transition
printf '{ "thresholds": { "memAvailWarnPct": 100.5, "memAvailCritPct": 100.2 } }\n' > "$TMUX_AGENT_HOME/health.json"
start_web "$TMUX_AGENT_HOME/hcrit.log" --port "$(pick_port 11)" --no-token
HPID=$WEB_PID; HPORT=$WEB_PORT
AL=""
for i in $(seq 1 25); do
  AL=$(curl -sf "http://127.0.0.1:$HPORT/api/fleet" 2>/dev/null || true)
  echo "$AL" | grep -q '"rule":"mem","sev":"crit"' && break
  sleep 0.5
done
echo "$AL" | grep -q '"rule":"mem","sev":"crit"' || die "mem crit alert missing from /api/fleet under forced thresholds"
grep -q '"type":"health.critical"' "$TMUX_AGENT_HOME"/ledger/*.ndjson || die "health.critical not ledgered"
grep -q 'health CRITICAL' "$TMUX_AGENT_HOME"/ledger/*.ndjson || die "crit did not ride the notify path (no notify.sent title)"
kill "$HPID" 2>/dev/null || true
rm -f "$TMUX_AGENT_HOME/health.json"

step "25. G3 chaos: tmux server killed under a live dashboard — survives AND recovers (TMUX-86 acceptance)"
# The boundary's original "verified by killing the tmux server underneath a running dashboard" was a one-off
# manual check (2026-08-25); this is that check on every push. The dashboard is the observability
# plane, and losing it at the exact moment the fleet breaks is the worst failure mode. Kill the
# server with polls in flight, then prove the process is alive, every route still answers, AND a
# revived fleet is listed again — a process that stays up serving a stale empty fleet would pass
# a survival-only check. Survival rests on three layers (the tmux driver reports a dead server as
# an empty fleet; the request handler's try/catch; the process-level boundary, the last-resort
# net for rejections outside a request) — watched FAIL first on a scratch build with all three
# removed. The boundary's own fault injection is test/boundary.test.js.
# every curl carries --max-time: a build that keeps the process alive but never answers (boundary
# present, request catch gone) must go RED here, not stall the suite on a poll (seen on a scratch build)
# let the 2 s fleet cache expire first, or the six polls are answered from cache and never touch tmux
# while it dies — on a scratch build that crashes on tmux death, that made the crash land AFTER the
# liveness check instead of under it
sleep 2.1
PIDS=""
for i in 1 2 3 4 5 6; do curl -s --max-time 10 -o /dev/null "http://127.0.0.1:$PORT/api/fleet" & PIDS="$PIDS $!"; done
tmux -L "$SOCKET" kill-server 2>/dev/null || true
wait $PIDS || true   # the in-flight polls may have been answered, cut or timed out — survival is judged below
sleep 2
# alive AND not a zombie: a backgrounded child that crashed still answers kill -0 until it is reaped.
# `|| true` because a reaped pid makes ps exit 1, and under set -e + pipefail that would abort the
# script silently right here — red with no diagnostic, in exactly the case this step exists for
STAT=$(ps -o stat= -p "$WEBPID" 2>/dev/null | tr -d ' ' | cut -c1 || true)
if ! kill -0 "$WEBPID" 2>/dev/null || [ -z "$STAT" ] || [ "$STAT" = "Z" ]; then die "G3 chaos: dashboard (pid $WEBPID, stat '${STAT:-gone}') died with the tmux server"; fi
for route in fleet health; do
  CODE=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/$route" || true)
  [ "$CODE" = "200" ] || die "G3 chaos: /api/$route → HTTP ${CODE:-none} after tmux death (want 200)"
done
tmux -L "$SOCKET" new-session -d -s revived
# the fleet response is cached 2 s (server.ts singleFlight), so recovery = cache expiry + one poll:
# ~2250 ms measured here; the bound is 4 s so a slower macOS runner's poll does not turn this gate flaky
REVIVED=""
for i in $(seq 1 16); do
  curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/fleet" >"$TMUX_AGENT_HOME/fleet-revived.json" 2>/dev/null || true
  if grep -q '"revived"' "$TMUX_AGENT_HOME/fleet-revived.json" 2>/dev/null; then REVIVED=$i; break; fi
  sleep 0.25
done
if [ -n "$REVIVED" ]; then echo "   revived session listed after ~$(( REVIVED * 250 ))ms"
else die "G3 chaos: revived session not listed on /api/fleet within 4 s (survived, did not recover)"; fi

step "26. G3 observability: tmux death is OBSERVABLE, not a silent empty fleet (TMUX-87 acceptance) — on /api/health.tmux and doctor too"
# Step 25 proved the dashboard SURVIVES a tmux kill; this proves it SURFACES it. Measured on HEAD
# 9cd786c, after a kill /api/fleet was byte-for-byte a healthy idle fleet (sessions:[], alerts:[],
# no ledger event, no GONE) — the dashboard could not answer "is tmux dead or is the fleet idle?".
# Fresh HOME + socket so the fleet.tmux transition count is exactly 1 (the day file in the shared
# HOME already carries step-25's transitions from the main dashboard).
H26=$(mktemp -d); S26="ta-web26-$$"
CLI26="node dist/bin/tmux-agent.js --socket $S26 --actor web-smoke26"
TMUX_AGENT_HOME="$H26" $CLI26 spawn obs-child --cwd /tmp --parent web-smoke26 >/dev/null
TMUX_AGENT_HOME="$H26" $CLI26 web --port "$(pick_port 13)" --no-token >"$H26/web26.log" 2>&1 & W26=$!
WEB_PIDS="$WEB_PIDS $W26"
for i in $(seq 1 40); do grep -q "dashboard:" "$H26/web26.log" 2>/dev/null && break; sleep 0.25; done
P26=$(sed -n 's|.*dashboard: http://127\.0\.0\.1:\([0-9][0-9]*\)/.*|\1|p' "$H26/web26.log" | head -1)
[ -n "$P26" ] || die "step 26: no dashboard banner"
echo "   dashboard bound 127.0.0.1:$P26"
# reachable first: the healthy fleet must NOT carry a tmux.unreachable alert, and tmux.reachable is true
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$P26/api/fleet" >"$H26/f-up.json" 2>/dev/null && grep -q '"obs-child"' "$H26/f-up.json" && break; sleep 0.25; done
node -e "const f=require('$H26/f-up.json'); if(f.tmux&&f.tmux.reachable!==true){console.error('reachable not true: '+JSON.stringify(f.tmux));process.exit(1)} if((f.alerts||[]).some(a=>a.kind==='tmux.unreachable')){console.error('unreachable alert on a healthy fleet');process.exit(1)}" || die "step 26: healthy fleet mis-reports tmux status"
sleep 2.1  # let the 2 s fleet cache expire so the next poll actually hits tmux as it dies
tmux -L "$S26" kill-server 2>/dev/null || true
# tmux.reachable flips to false AND an alert appears — on the poll that detects the death
DOWN=""
for i in $(seq 1 20); do
  curl -sf --max-time 3 "http://127.0.0.1:$P26/api/fleet" >"$H26/f-down.json" 2>/dev/null || true
  node -e "const f=require('$H26/f-down.json'); process.exit(f.tmux&&f.tmux.reachable===false&&(f.alerts||[]).some(a=>a.kind==='tmux.unreachable')?0:1)" 2>/dev/null && { DOWN=$i; break; }
  sleep 0.3
done
[ -n "$DOWN" ] || die "step 26: /api/fleet did not report tmux.reachable=false + a tmux.unreachable alert after kill"
# TMUX-115: the two PULL surfaces that did not carry it (measured 2026-09-16 on 854c572: eleven health keys
# and none of them tmux; doctor "dashboard runs the build on disk" — while the daemon's own tick had ledgered
# fleet.tmux and paged). /api/health.tmux is the daemon's LAST poll — no tmux exec per scrape — and names the
# same transition /api/fleet does; doctor --port on this home reads it and ends its reason with a clause.
curl -sf --max-time 3 "http://127.0.0.1:$P26/api/health" >"$H26/h-down.json" || die "step 26: /api/health while tmux is down"
node -e "
const h=require('$H26/h-down.json'), f=require('$H26/f-down.json');
if(!h.tmux||h.tmux.reachable!==false){console.error('/api/health.tmux after kill-server: '+JSON.stringify(h.tmux)+' (keys: '+Object.keys(h).join(',')+')');process.exit(1)}
if(h.tmux.since!==f.tmux.since){console.error('since differs: /api/health '+h.tmux.since+' vs /api/fleet '+f.tmux.since);process.exit(1)}
if(!h.tmux.checkedAt||!h.tmux.error){console.error('unreachable verdict without checkedAt/error: '+JSON.stringify(h.tmux));process.exit(1)}
" || die "step 26: /api/health.tmux does not carry the death /api/fleet reports"
TMUX_AGENT_HOME="$H26" $CLI26 doctor --port "$P26" >"$H26/doctor26-down.json" 2>"$H26/doctor26-down.err" || die "step 26: doctor exited non-zero while tmux is down (a report, not a gate)"
node -e "
const d=require('$H26/doctor26-down.json').dashboard;
if(!d||!d.tmux||d.tmux.reachable!==false){console.error('doctor.dashboard.tmux after kill-server: '+JSON.stringify(d&&d.tmux));process.exit(1)}
if(!/; tmux server UNREACHABLE since \\S+ \\(.+\\)$/.test(d.reason)){console.error('doctor reason lacks the UNREACHABLE clause: '+d.reason);process.exit(1)}
" || die "step 26: doctor does not name the dead tmux server"
# poll a few more times: the ledger must have EXACTLY ONE fleet.tmux{unreachable} (not one-per-poll)
# and EXACTLY ONE GONE for the spawned session
for i in 1 2 3 4; do curl -sf --max-time 3 "http://127.0.0.1:$P26/api/fleet" >/dev/null 2>&1 || true; sleep 0.3; done
node -e "
const {readdirSync,readFileSync}=require('fs');
const dir='$H26/ledger';
const evs=readdirSync(dir).flatMap(f=>readFileSync(dir+'/'+f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)));
const un=evs.filter(e=>e.type==='fleet.tmux'&&e.data&&e.data.to==='unreachable');
const gone=evs.filter(e=>e.type==='session.state'&&e.data&&e.data.to==='GONE'&&e.session==='obs-child');
if(un.length!==1){console.error('fleet.tmux unreachable count='+un.length+' (want 1 — transition-only)');process.exit(1)}
if(gone.length!==1){console.error('GONE for obs-child count='+gone.length+' (want exactly 1)');process.exit(1)}
" || die "step 26: ledger not transition-only (one fleet.tmux + one GONE)"
# recovery: a new server → tmux.reachable=true, exactly one fleet.tmux{reachable}, alert cleared
tmux -L "$S26" new-session -d -s obs-revived
UP=""
for i in $(seq 1 20); do
  curl -sf --max-time 3 "http://127.0.0.1:$P26/api/fleet" >"$H26/f-rec.json" 2>/dev/null || true
  node -e "const f=require('$H26/f-rec.json'); process.exit(f.tmux&&f.tmux.reachable===true&&!(f.alerts||[]).some(a=>a.kind==='tmux.unreachable')?0:1)" 2>/dev/null && { UP=$i; break; }
  sleep 0.3
done
[ -n "$UP" ] || die "step 26: tmux.reachable did not return to true / alert not cleared after new-session"
node -e "
const {readdirSync,readFileSync}=require('fs');
const dir='$H26/ledger';
const evs=readdirSync(dir).flatMap(f=>readFileSync(dir+'/'+f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)));
const up=evs.filter(e=>e.type==='fleet.tmux'&&e.data&&e.data.to==='reachable');
if(up.length!==1){console.error('fleet.tmux reachable count='+up.length+' (want 1)');process.exit(1)}
" || die "step 26: recovery not a single reachable transition"
# TMUX-115: both surfaces follow the recovery, with /api/fleet's `since`
curl -sf --max-time 3 "http://127.0.0.1:$P26/api/health" >"$H26/h-rec.json" || die "step 26: /api/health after recovery"
TMUX_AGENT_HOME="$H26" $CLI26 doctor --port "$P26" >"$H26/doctor26-rec.json" 2>/dev/null || die "step 26: doctor exited non-zero after recovery"
node -e "
const h=require('$H26/h-rec.json'), f=require('$H26/f-rec.json'), d=require('$H26/doctor26-rec.json').dashboard;
if(!h.tmux||h.tmux.reachable!==true||h.tmux.since!==f.tmux.since){console.error('/api/health.tmux after recovery: '+JSON.stringify(h.tmux)+' vs /api/fleet '+JSON.stringify(f.tmux));process.exit(1)}
if(!d||!d.tmux||d.tmux.reachable!==true||!/; tmux server reachable$/.test(d.reason)){console.error('doctor after recovery: '+JSON.stringify(d&&d.tmux)+' reason: '+(d&&d.reason));process.exit(1)}
" || die "step 26: /api/health.tmux / doctor do not report the recovery"
echo "   tmux death surfaced (reachable=false + alert), one fleet.tmux + one GONE, recovered on new-session; /api/health.tmux and doctor said the same both ways"
kill "$W26" 2>/dev/null || true; ta_kill_server "$S26" >/dev/null || true; rm -rf "$H26"

step "27. G3 resource bounds: /api/health.ledger and doctor account for the ledger's own footprint exactly (TMUX-90 acceptance)"
# Measured 2026-09-11 on this host: 62.9 MB of ledger/ in 18 unattended days with no number anywhere
# and no bound (rotate.ts covers capture logs only). Plant three day files of known size into the
# live dashboard's home; the API and the CLI must both account for them — files exactly, bytes
# within 1 % (today's live file may take an append between the stat and the curl). Recent dates, so
# the retention sweep (unit: test/ledger-retention.test.js) leaves them alone; archive stays empty.
LDIR="$TMUX_AGENT_HOME/ledger"
BEFORE=$(ls "$LDIR"/events-*.ndjson | wc -l | tr -d ' ')
for ago in 1 2 3; do
  # dates via node, not date(1): GNU `-d` and BSD `-v` disagree and CI runs both
  node -e "
const {writeFileSync}=require('fs');
const day=new Date(Date.now()-$ago*86400000).toISOString().slice(0,10);
let s=''; for(let i=0;i<$ago*400;i++) s+=JSON.stringify({v:1,ts:day+'T00:00:00.000Z',type:'session.state',session:'planted-$ago',data:{to:i%2?'WORKING':'IDLE'}})+'\n';
writeFileSync('$LDIR/events-'+day+'.ndjson',s,{mode:0o600});"
done
AFTER=$(ls "$LDIR"/events-*.ndjson | wc -l | tr -d ' ')
[ "$AFTER" = "$((BEFORE + 3))" ] || die "step 27: planted 3 day files, live count went $BEFORE → $AFTER"
# the truth to compare against: every live day file, summed by stat
TRUTH=$(node -e "
const {readdirSync,statSync}=require('fs');
const d='$LDIR'; const fs=readdirSync(d).filter(f=>/^events-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort();
console.log(JSON.stringify({files:fs.length,bytes:fs.reduce((a,f)=>a+statSync(d+'/'+f).size,0),oldest:fs[0].slice(7,17)}))")
curl -sf "http://127.0.0.1:$PORT/api/health" >"$TMUX_AGENT_HOME/health27.json" || die "step 27: health endpoint"
$CLI doctor >"$TMUX_AGENT_HOME/doctor27.json" || die "step 27: doctor"
node -e "
const truth=$TRUTH;
const check=(who,l)=>{
  if(!l){console.error(who+': no ledger block');process.exit(1)}
  if(l.files!==truth.files){console.error(who+': ledger.files='+l.files+' want '+truth.files);process.exit(1)}
  if(Math.abs(l.bytes-truth.bytes)/truth.bytes>0.01){console.error(who+': ledger.bytes='+l.bytes+' vs stat sum '+truth.bytes+' (>1% off)');process.exit(1)}
  if(l.oldestDay!==truth.oldest){console.error(who+': oldestDay='+l.oldestDay+' want '+truth.oldest);process.exit(1)}
  if(l.archiveBytes!==0||l.archiveFiles!==0){console.error(who+': archive must be empty here: '+JSON.stringify(l));process.exit(1)}
  if(l.avgBytesPerDay!==Math.round(l.bytes/l.files)){console.error(who+': avgBytesPerDay inconsistent with bytes/files');process.exit(1)}
};
check('/api/health', require('$TMUX_AGENT_HOME/health27.json').ledger);
const d=require('$TMUX_AGENT_HOME/doctor27.json');
check('doctor', d.ledger);
const r=d.ledger.retention;
if(!(r&&r.keepDays===30&&r.deleteAfterDays===0&&r.warnBytes>0)){console.error('doctor: retention block wrong: '+JSON.stringify(r));process.exit(1)}
console.log('   ledger footprint: files='+truth.files+' bytes='+truth.bytes+' oldest='+truth.oldest+' — /api/health and doctor agree with the files on disk');
" || die "step 27: /api/health.ledger / doctor disagree with the files on disk"

step "28. G3 observability: /api/health.build names the running build and flags a stale dist/ (TMUX-92 acceptance)"
# Measured 2026-09-12 on this host: the operator's dashboard served build 37239eb for 16 days while HEAD
# moved 47 commits, and nothing on the API said so (no version, no commit; uptimeSec was the HOST's). A
# fresh server must report the stamp `npm run build` wrote and its OWN process start; planting a
# different stamp under it must flip .build.stale and raise a warn-only `build` alert within one tick;
# restoring it must clear both — transition-only in the ledger. The planted stamp goes into a COPY of
# dist/ (never the repo's own dist/build.json, which every other step and the unit suite read), served
# by a second dashboard ticking at 1 s.
PKGV=$(node -p "require('./package.json').version")
curl -sf "http://127.0.0.1:$PORT/api/health" >"$TMUX_AGENT_HOME/health28.json" || die "step 28: health endpoint"
node -e "
const h=require('$TMUX_AGENT_HOME/health28.json'), b=h.build, stamp=require('./dist/build.json');
const fail=m=>{console.error('step 28: '+m);process.exit(1)};
if(!b) fail('/api/health has no build block (keys: '+Object.keys(h).join(',')+')');
if(b.version!=='$PKGV') fail('build.version='+b.version+' want $PKGV');
if(b.commit!==stamp.commit||b.builtAt!==stamp.builtAt) fail('running stamp '+JSON.stringify(b)+' != dist/build.json '+JSON.stringify(stamp));
if(b.stale!==false) fail('fresh server reports stale='+b.stale);
if(!(typeof b.processUptimeSec==='number'&&b.processUptimeSec<h.uptimeSec)) fail('processUptimeSec '+b.processUptimeSec+' is not the process clock (host uptimeSec '+h.uptimeSec+')');
if(isNaN(Date.parse(b.startedAt))) fail('startedAt is not a date: '+b.startedAt);
console.log('   running '+b.version+' '+b.commit+' built '+b.builtAt+'; process up '+b.processUptimeSec+'s (host '+h.uptimeSec+'s); stale=false');
" || die "step 28: /api/health.build does not describe the running build"
H28=$(mktemp -d); T28="$H28/tree"; S28="ta-web28-$$"
mkdir -p "$T28" && cp -R dist "$T28/dist" && cp package.json "$T28/" && ln -s "$PWD/node_modules" "$T28/node_modules"
TMUX_AGENT_HOME="$H28" TMUX_AGENT_HEALTH_TICK_MS=1000 node "$T28/dist/bin/tmux-agent.js" --socket "$S28" --actor web-smoke28 web --port "$(pick_port 17)" --no-token >"$H28/web28.log" 2>&1 & W28=$!
WEB_PIDS="$WEB_PIDS $W28"
for i in $(seq 1 40); do grep -q "dashboard:" "$H28/web28.log" 2>/dev/null && break; sleep 0.25; done
P28=$(sed -n 's|.*dashboard: http://127\.0\.0\.1:\([0-9][0-9]*\)/.*|\1|p' "$H28/web28.log" | head -1)
[ -n "$P28" ] || die "step 28: no dashboard banner from the tree copy"
echo "   dashboard bound 127.0.0.1:$P28"
FRESH=""
for i in $(seq 1 20); do
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/health" >"$H28/h-fresh.json" 2>/dev/null || true
  node -e "const b=require('$H28/h-fresh.json').build; process.exit(b&&b.stale===false?0:1)" 2>/dev/null && { FRESH=1; break; }
  sleep 0.25
done
[ -n "$FRESH" ] || die "step 28: tree copy not reporting a fresh build at start"
# plant: same version, a different commit — the operator pulled and rebuilt under the running daemon
cp "$T28/dist/build.json" "$H28/stamp.orig.json"
node -e "const {readFileSync,writeFileSync}=require('fs');const s=JSON.parse(readFileSync('$H28/stamp.orig.json','utf8'));s.commit='feedbee';s.builtAt=new Date().toISOString();writeFileSync('$T28/dist/build.json',JSON.stringify(s));"
STALE=""
for i in $(seq 1 30); do
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/health" >"$H28/h-stale.json" 2>/dev/null || true
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/fleet" >"$H28/f-stale.json" 2>/dev/null || true
  node -e "const b=require('$H28/h-stale.json').build,f=require('$H28/f-stale.json'); process.exit(b&&b.stale===true&&b.onDisk&&b.onDisk.commit==='feedbee'&&(f.alerts||[]).some(a=>a.rule==='build'&&a.sev==='warn')?0:1)" 2>/dev/null && { STALE=$i; break; }
  sleep 0.3
done
[ -n "$STALE" ] || die "step 28: planted stamp did not flip .build.stale + raise a warn-only build alert on /api/fleet.alerts"
# TMUX-162: the alarm's COMMON shape on this host — dist/ rebuilt at the commit the daemon runs (every
# npm test does it). The verdict was always right (builtAt moved); the words read "running X, disk has X"
# (measured live 2026-09-24 02:24:06.800Z). Now both sides name their build time — on /api/health.build.words,
# which the strip prints, and in the alert's value/detail, the same describer. warn→warn is steady, so the
# ledger count below still holds ONE warning, and the restore below still closes it with ONE recovery.
node -e "const {readFileSync,writeFileSync}=require('fs');const s=JSON.parse(readFileSync('$H28/stamp.orig.json','utf8'));s.builtAt=new Date(Date.parse(s.builtAt)+60000).toISOString();writeFileSync('$T28/dist/build.json',JSON.stringify(s));writeFileSync('$H28/rebuilt-at.txt',s.builtAt);"
REBUILT=""
for i in $(seq 1 30); do
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/health" >"$H28/h-rebuilt.json" 2>/dev/null || true
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/fleet" >"$H28/f-rebuilt.json" 2>/dev/null || true
  node -e "const b=require('$H28/h-rebuilt.json').build,f=require('$H28/f-rebuilt.json'),at=require('fs').readFileSync('$H28/rebuilt-at.txt','utf8');const a=(f.alerts||[]).find(x=>x.rule==='build'); process.exit(b&&b.stale===true&&b.onDisk&&b.onDisk.builtAt===at&&a&&!/feedbee/.test(a.value)?0:1)" 2>/dev/null && { REBUILT=$i; break; }
  sleep 0.3
done
[ -n "$REBUILT" ] || die "step 28: same-commit rebuild did not reach /api/health.build.onDisk and the build alert within the poll"
node -e "
const b=require('$H28/h-rebuilt.json').build,f=require('$H28/f-rebuilt.json'),o=require('$H28/stamp.orig.json'),at=require('fs').readFileSync('$H28/rebuilt-at.txt','utf8');
const fail=m=>{console.error('step 28: '+m);process.exit(1)};
const a=(f.alerts||[]).find(x=>x.rule==='build');
const m=/^running (.+), disk has (.+)/.exec(a.value);
if(!m||m[1]===m[2]) fail('the build alert reads the same on both sides after a same-commit rebuild: '+a.value);
const w=b.words||{};
if(w.running!==o.commit+' built '+o.builtAt) fail('build.words.running='+JSON.stringify(w.running)+' want '+JSON.stringify(o.commit+' built '+o.builtAt));
if(w.onDisk!==o.commit+' rebuilt '+at) fail('build.words.onDisk='+JSON.stringify(w.onDisk)+' want '+JSON.stringify(o.commit+' rebuilt '+at));
if(a.value!=='running '+w.running+', disk has '+w.onDisk) fail('alert value '+JSON.stringify(a.value)+' is not the same describer as build.words');
if(!a.detail.includes(w.running)||!a.detail.includes(w.onDisk)) fail('alert detail does not carry both sides: '+a.detail);
console.log('   same-commit rebuild: '+a.value);
" || die "step 28: a rebuild at the same commit must name both build times, never the same commit twice"
# restore → stale false and the alert gone; then two more ticks must add nothing to the ledger
cp "$H28/stamp.orig.json" "$T28/dist/build.json"
REC=""
for i in $(seq 1 30); do
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/health" >"$H28/h-rec.json" 2>/dev/null || true
  curl -sf --max-time 3 "http://127.0.0.1:$P28/api/fleet" >"$H28/f-rec.json" 2>/dev/null || true
  node -e "const b=require('$H28/h-rec.json').build,f=require('$H28/f-rec.json'); process.exit(b&&b.stale===false&&!(f.alerts||[]).some(a=>a.rule==='build')?0:1)" 2>/dev/null && { REC=$i; break; }
  sleep 0.3
done
[ -n "$REC" ] || die "step 28: restoring the stamp did not clear .build.stale / the build alert"
sleep 2.2
node -e "
const {readdirSync,readFileSync}=require('fs');
const dir='$H28/ledger';
const evs=readdirSync(dir).filter(f=>/^events-.*\.ndjson$/.test(f)).flatMap(f=>readFileSync(dir+'/'+f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)));
const w=evs.filter(e=>e.type==='health.warning'&&e.data&&e.data.rule==='build');
const r=evs.filter(e=>e.type==='health.recovered'&&e.data&&e.data.rule==='build');
if(w.length!==1){console.error('health.warning rule=build count='+w.length+' (want 1 — transition-only)');process.exit(1)}
if(r.length!==1){console.error('health.recovered rule=build count='+r.length+' (want 1)');process.exit(1)}
if(!/feedbee/.test(w[0].data.detail)||!/restart/.test(w[0].data.detail)){console.error('warning detail does not name the on-disk commit and the remedy: '+w[0].data.detail);process.exit(1)}
console.log('   stale flipped after ~'+($STALE*300)+'ms, cleared after ~'+($REC*300)+'ms; ledger: 1 warning + 1 recovered for rule build');
" || die "step 28: ledger not transition-only for rule build"

step "29. G3 observability: doctor sees the running daemon — reachable, its build, and a stale verdict beside the on-disk stamp (TMUX-93 acceptance)"
# Measured 2026-09-12 04:26Z on this host: the operator's dashboard (up 16 d on 37239eb) served
# /api/health with no build key while `doctor` on the same disk printed dcba589 and not a word about
# the daemon — TMUX-92's stale alarm runs inside the daemon, so one older than the stamp can never
# raise it. doctor now probes 127.0.0.1:<--port>/api/health with the home's token (step 15 left one
# in this home; the main dashboard runs --no-token and ignores it) and reports what it found.
$CLI doctor --port "$PORT" >"$TMUX_AGENT_HOME/doctor29.json" || die "step 29: doctor exited non-zero against the main dashboard"
node -e "
const d=require('$TMUX_AGENT_HOME/doctor29.json').dashboard, stamp=require('./dist/build.json');
const fail=m=>{console.error('step 29: '+m);process.exit(1)};
if(!d) fail('doctor has no dashboard block');
if(d.url!=='http://127.0.0.1:$PORT/api/health') fail('probed '+d.url+', want the literal loopback address at --port');
if(d.reachable!==true) fail('main dashboard not reachable: '+JSON.stringify(d));
if(!d.build||d.build.commit!==stamp.commit||d.build.builtAt!==stamp.builtAt) fail('dashboard.build '+JSON.stringify(d.build)+' != dist/build.json '+JSON.stringify(stamp));
if(!d.onDisk||d.onDisk.commit!==stamp.commit) fail('onDisk '+JSON.stringify(d.onDisk)+' != dist/build.json');
if(d.stale!==false) fail('a fresh daemon reported stale='+d.stale+' ('+d.reason+')');
console.log('   main dashboard: reachable, runs '+d.build.commit+' = dist/build.json, stale=false');
" || die "step 29: doctor does not describe the running dashboard"
# `--` before the pattern: a base64url token can begin with '-' and the first run of this check
# had grep read one as an option — the check silently did nothing and printed the token into the
# log. Proven on a planted leak (scratch/ga-fire-2026-09-12-06Z/grep-leak-check-fail-first.txt).
if [ -s "$TMUX_AGENT_HOME/web-token" ] && grep -qF -- "$(cat "$TMUX_AGENT_HOME/web-token")" "$TMUX_AGENT_HOME/doctor29.json"; then
  die "step 29: the web token leaked into doctor's output"
fi
# The daemon from step 28's tree copy is still up, on the restored stamp. Plant a different stamp into
# that copy again and ask the copy's OWN CLI: it must say stale NOW — disk against the daemon's word,
# without waiting for the daemon's tick (the CLI is what an operator runs by hand).
cp "$H28/stamp.orig.json" "$H28/stamp29.orig.json"
node -e "const {readFileSync,writeFileSync}=require('fs');const s=JSON.parse(readFileSync('$H28/stamp29.orig.json','utf8'));s.commit='feedbee';s.builtAt=new Date().toISOString();writeFileSync('$T28/dist/build.json',JSON.stringify(s));"
TMUX_AGENT_HOME="$H28" node "$T28/dist/bin/tmux-agent.js" --socket "$S28" --actor web-smoke29 doctor --port "$P28" >"$H28/doctor29-stale.json" 2>"$H28/doctor29-stale.err" || die "step 29: doctor (tree copy) exited non-zero on a stale daemon"
node -e "
const d=require('$H28/doctor29-stale.json').dashboard, orig=require('$H28/stamp29.orig.json');
const fail=m=>{console.error('step 29: '+m);process.exit(1)};
if(!d||d.reachable!==true) fail('tree-copy dashboard not reachable: '+JSON.stringify(d));
if(d.stale!==true) fail('planted stamp not reported stale: '+JSON.stringify(d));
if(!d.onDisk||d.onDisk.commit!=='feedbee') fail('onDisk is not what dist/build.json says now: '+JSON.stringify(d.onDisk));
if(!d.build||d.build.commit!==orig.commit) fail('the running stamp of the daemon moved: '+JSON.stringify(d.build)+' want '+orig.commit);
if(!/restart/.test(d.reason)||!/feedbee/.test(d.reason)) fail('reason names neither the remedy nor the on-disk commit: '+d.reason);
console.log('   tree copy: daemon runs '+d.build.commit+', dist/ has feedbee → stale=true; reason: '+d.reason);
" || die "step 29: doctor does not flag the stale daemon"
cp "$H28/stamp29.orig.json" "$T28/dist/build.json"
kill "$W28" 2>/dev/null || true; rm -rf "$H28"

if [ "$FAILED" -eq 0 ]; then echo "WEB-SMOKE PASS (29/29)"; else echo "WEB-SMOKE FAILED"; exit 1; fi
