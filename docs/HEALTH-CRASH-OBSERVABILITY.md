# Host health & crash observability — design (epic TMUX-HC, 2026-08-26)

## Problem

The host running the fleet (an EC2 instance or a laptop) sometimes crashes or freezes, taking
every session down at once. The dashboard answers *"which session needs me"* but not *"is the
substrate about to die"* — and after a crash there is no forensic record of which process ate
the memory.

This is not host flakiness; it is a documented failure class of the CLIs we run. Upstream
`anthropics/claude-code` has **212 issues matching "memory leak" in the title** (searched
2026-08-26), including:

| Issue | What it documents |
|---|---|
| #4953 (open, 75 reactions) | single process grows to **120+ GB**, OOM-killed |
| #11315 (open, 57) | 129 GB consumed → whole-system freeze |
| #18859 (open, 34) | leak in **long-running idle** sessions — exactly our fleet profile |
| #41765 (closed) | **idle** process grows ~500 MB/min; OOM within minutes on a 16 GB host |
| #22042 (closed, 92) | a version regression (2.1.27) that OOM'd on simple input |
| #20412 (closed, 142) | auto-injected MCP servers → OOM on constrained systems |
| #33350 (open) | terminal freeze **in tmux sessions**, memory-related |

Two conclusions drive the design: (1) **idle ≠ safe** — PARKED sessions leak too, so every
session needs memory accounting, not just busy ones; (2) **a CLI upgrade can change the whole
fleet's memory profile overnight** (#22042), so trends matter more than absolute thresholds.

## Design principles (house rules applied)

- **Derived from what we already collect.** `activity.ts#scanProc()` already reads every
  `/proc/<pid>/stat` line to walk CPU jiffies per pane process tree. RSS is field 24 of that
  *same line* — per-session memory accounting costs **zero additional I/O**.
- **Zero new dependencies.** Host vitals come from node built-ins (`os.totalmem/freemem/loadavg`,
  `fs.statfsSync`) plus `/proc/meminfo` on Linux (`MemAvailable`, `SwapFree` — `os.freemem()`
  under-reports available memory on Linux because it ignores reclaimable page cache).
- **Honest degradation** (the `activity.ts` precedent): no `/proc` (macOS) → host vitals from
  `os.*` + `statfsSync`, per-session RSS reads `null`, never a faked number.
- **The ledger is the flight recorder.** Health events are ledger events; the existing
  watch/notify path (tested incl. unreachable-webhook degradation) is the alarm channel; the
  dashboard is the surface. No new storage systems.
- **Observability and prediction only — no auto-remediation.** Killing or restarting a leaking
  session is an operator action (the fleet's never-kill bounds apply). Any future auto-restart
  is policy-gated and OFF by default, behind its own `needs-decision` card.
- **Not an APM.** No Prometheus/agent stacks — the tool must stay drop-in (<5 min, KR3). If an
  operator already runs monitoring, our `/api/health` JSON is scrape-friendly; that is the
  integration point. It carries the host vitals (H1), the ledger's footprint, the running
  build, the OOM prediction (H5), the last suspected crash (H4) and — since TMUX-115 — the
  daemon's own verdict on its tmux server (`tmux: { reachable, since, error, checkedAt }`, the
  fleet's worst failure, from the same tick; never a tmux exec per scrape).

## Increments (each is a board card with executable acceptance criteria)

### H1 — Host vitals: `/api/health` + dashboard strip
Collector samples: mem total/available, swap total/free, load 1/5/15, disk free+total for
`$TMUX_AGENT_HOME` and `~`, uptime, and the sampling degradation mode (`proc` | `os-only`).
Served at `/api/health`; dashboard renders a vitals strip (mem/swap/disk/load) with AA-compliant
warn/crit tinting consistent with the existing badge system.
**Accept:** `curl /api/health` numbers match `free -b` / `df -B1` within 2%; strip visible in
the browser audit with 0 findings; on a host without `/proc` the endpoint still returns
`os-only` vitals rather than erroring.

### H2 — Per-session memory in fleet + detail (the deep dive)
Extend `scanProc()` to also return RSS (field 24, pages × pagesize); aggregate per pane process
tree exactly like jiffies. Fleet rows gain `rssBytes`; detail gains the **process-tree deep
dive**: per-process pid, comm, rss, cpu-rate — so "which child of which session" is one click.
Sortable in the fleet table; top consumer visible at a glance.
**Accept:** spawn a session, allocate ~200 MB in it (`node -e 'const a=Buffer.alloc(2e8,1);…'`),
its fleet `rssBytes` reflects it within one poll; killing the child drops it; O(1) tmux exec
batching preserved (web-smoke step 7 stays green); macOS/no-proc → `rssBytes:null`.

### H3 — Thresholds → `health.*` ledger events + notification
Watch gains host-health rules with defaults: `MemAvailable < 10%` warn / `< 5%` crit, swap-in
use, `disk < 5 GB`, any single session tree `rss > 25%` of total RAM. Crossings emit
`health.warning` / `health.critical` ledger events (rate-limited: one per rule per state
change, not per poll) and go through the existing notify path. Dashboard attention banner
includes host-health criticals.
**Accept:** with thresholds forced low in config, `watch` emits the ledger event + webhook
within one poll interval; clearing the pressure emits `health.recovered`; no event spam on a
steady breach (assert exactly 1 event per state transition in the unit test).
**Added 2026-10-13:** a per-rule **re-warn hold-down**. A value hovering at one threshold is a
transition on every tick — the fleet host filed 12 `swap` warning/recovered rows between 03:56Z and 04:11Z that
day, each pair a notify's worth of ledger — so after a rule's `health.recovered`, a new WARNING for that rule inside
`rewarnHoldDownMinutes` (default 10, `health.json` thresholds, 0 disables) is not filed and not notified; the breach
still shows in `/api/health` and the banner (what is true now), and because it was never announced its clearing files
no recovery either. A CRITICAL is never held — it is filed from `ok` and notified. Once the window has elapsed a
breach warns again. `test/health-rewarn-holddown.test.js` drives `HealthWatcher.apply()` with that series.
**Added 2026-09-11:** a `ledger` rule — the tool's own live day files over
`ledgerWarnBytes` (256 MiB default) warn, through the same transition machinery; the retention
that bounds them (`ledgerKeepDays`, `ledgerDeleteAfterDays`) lives in the same `health.json`.
**Added 2026-09-12:** a `build` rule — the dashboard daemon compares the build stamp it
loaded (`dist/build.json`: version / commit / builtAt, written by `npm run build`) with the one on
disk each tick and warns, never crits, when they differ ("dashboard runs X, disk has Y — restart to
pick up"); `health.recovered` after the restart. Served as `/api/health.build` (`stale`, `onDisk`,
`startedAt` and `processUptimeSec` — the process's clock, where `uptimeSec` is the host's) and lit
as a `build` tile on the vitals strip. Measured need: the operator's own daemon served a
47-commit-stale build for 16 days with nothing observable saying so. `TMUX_AGENT_HEALTH_TICK_MS`
sets the tick cadence (default 30 s, floor 1 s).
**Reworded 2026-09-24:** when the commits are equal and only the build time moved — `dist/`
rebuilt at the commit the daemon runs, which every `npm test` on the release host does — both sides name
their time ("running 278d5d0 built …T22:23:43Z, disk has 278d5d0 rebuilt …T02:23:41Z"), from one describer
(`describeBuildPair`) shared by the alarm, `doctor`'s reason and the strip (which prints
`/api/health.build.words`). Measured live 02:24Z that day: the alarm had read "running 278d5d0, disk has
278d5d0 — restart to pick it up", a sentence that contradicts itself; the verdict was right, the words were not.
**Added 2026-09-12:** the CLI side. `tmux-agent doctor [--port]` probes
`127.0.0.1:<port>/api/health` — the host is a literal, never a flag; the home's `web-token` rides as
a Bearer header and is never printed — and reports `dashboard: { url, reachable, build, onDisk,
stale, reason }`: the daemon's stamp beside the one on disk, judged by the same stale rule as
`/api/health.build`. A daemon that answers without a `build` key predates the stamp and is named as
such ("restart to pick up <commit>"): the `build` rule above runs *inside* the daemon, so a daemon
older than the rule can never raise it, and `doctor` is the only surface that can. Measured need:
this host's own dashboard, 17 days on the 2026-08-26 build, while `doctor` printed the disk's
`dcba589` and nothing about it. doctor stays a report — exit 0 in every case; a missing, unauthorized
or silent daemon is a value in the block, never a failure.
**Added 2026-09-16:** the tmux server's death — the fleet's worst failure, made observable
by TMUX-87 on `/api/fleet`, in the ledger (`fleet.tmux`) and through the notify sink — on the two
*pull* surfaces that did not carry it. `/api/health.tmux` is the Monitor's last fleet-poll verdict
(`{ reachable, since, error, checkedAt }`, null before the first poll), refreshed by the same tick as
`prediction` and never a tmux exec per scrape; `doctor.dashboard.tmux` is that object as the daemon
served it (null when the daemon does not report it), and `dashboard.reason` ends with one clause:
`; tmux server UNREACHABLE since <since> (<error>)`, `; tmux server reachable`, or `; tmux status not
reported by this daemon`. Measured need: on 854c572, with the tick at 1 s, the daemon had ledgered
the transition and paged within 3 s of a `kill-server` while `/api/health` served eleven keys and no
tmux and `doctor` said "dashboard runs the build on disk" — the same picture as an idle fleet, the
ambiguity TMUX-87 was filed to remove.
**Added 2026-09-16:** the same death on the two *consumer* surfaces — `status.json`
(the collector's file; README's "point your Kanban/dashboard at it") and MCP `fleet-status` (the
agent's tool). Both read `monitor.fleet()` = `tmux.listSessions()`, which swallows a dead server into
`[]` on purpose (spawn must start before a server exists), so both published `sessions: []` with no
word about tmux — identical in every key but `generatedAt` to a socket no server ever ran on — while
the CLI's one hint ("a collector is watching another tmux server. Try --default-server") misdiagnosed
the death as a socket mismatch, because the daemon's own `fleet.tmux`/`GONE` rows are what keep the
ledger fresh. `Monitor.fleetReport()` now lists through `listFleetReachable()` and carries the
listing's own verdict — `tmux: { reachable, since, error, checkedAt }` — beside the per-session
snapshots; `status.json` and the `fleet-status` reply carry it (additive; `isError` stays false — an
unreachable server is a fact, not a tool failure), and the `status` verb prints `status: tmux server
UNREACHABLE on <socket> — <error>` on stderr, the mismatch hint only when the server answers with no
sessions. A report is a read, not a poll: it ledgers nothing (a cron's `status` every minute on a
dead server writes no rows) and leaves the daemon's transition state alone; `since` is the daemon's
transition time when its polls have observed the state, else `checkedAt` — a one-shot process
invents no history. Measured need: on 1c4ae7f, three seconds after `kill-server`, with the tick
having ledgered `fleet.tmux` and two `GONE`, both surfaces answered an idle fleet and the operator
was told to change sockets.
**Added 2026-09-16:** the same death on the three *per-session* surfaces — the `watch` verb
(what a supervising script blocks on), MCP `session-status` and `/api/session/<name>` — all of which
read `Monitor.snapshot()`. `Snapshot.reason` is why a session is `GONE`: tmux's own words when the
server itself did not answer, `null` when it answered and the session is simply absent.
`Tmux.hasSessionChecked()` keeps the stderr of the presence check that already ran, so the live path
pays no extra exec and only tmux's own wording ever becomes a verdict; `watch` adds one stderr line
(`watch: tmux server UNREACHABLE on <socket> — <error>`) beside its unchanged JSON and exit code, and a
read still ledgers nothing and leaves the poll state alone. Measured need: on f1a60d9, a session killed
on a live server and a session whose whole server had died came back differing in NO key or value but
`session` and `at` on all three surfaces, with "no server" appearing 0 times in any of them — so exit 2
meant both "restart this session" and "the fleet has no server", and a supervisor acting on it
respawned once per session in its charter onto a dead socket.

**Added 2026-09-17:** the mailbox's own footprint on the surfaces the ledger's already
reaches. `mailboxFootprint()` (TMUX-120: `agents`, `pending`, `pendingBytes`, `pendingAgents`,
`oldestPending`) was on `doctor` and nowhere else, so `GET /api/health` reported the ledger's bytes and
carried **no mail key at all** — the payload the dashboard polls every tick could not see three
messages rotting one directory from the ledger it did report — and the H3 rules named the mailbox 0
times, so mail nobody collected for a month raised nothing where a ledger that grew raised
`health.warning`. `/api/health.mailbox` is now that block minus its `dir` (the same trim `/api/health`
already applies to the ledger's), read per request and asserted equal to `doctor.mailbox` key by key;
and a `mailbox` rule warns — warn-only, the read is the operator's move — when the OLDEST unread
message has sat past `mailboxOldestPendingWarnHours` (health.json, **24 h** default, 0 disables it),
naming the agents holding it, with `health.recovered` once the mail is read. **Age, never count:** a
message seconds old is a fleet talking, and TMUX-120's measured failure was two messages sent to a name
wrong by one character that nobody would ever come back for — so 500 fresh messages raise nothing and
one 30-hour-old one raises the warning. `/api/*` is outside `VERSIONING.md`'s covered surface, so the
new key is not a semver event; no UI is in scope (the vitals strip renders no ledger footprint either —
the banner gets the mailbox through the alert, which is the path the ledger uses).
**Accept:** `test/mailbox-surface.test.js` — five cases, red on `0f7804e` and green on the fix: the
numbers MOVE on `/api/health` (3 → 1 once `gamma` collects → 0), doctor and `/api/health` agree key by
key *with the comparator itself shown to fail on a planted one-key difference*, exactly one
`health.warning{rule:mailbox}` per transition with the recovery on the read, and the controls — mail
that has just arrived, a 0 threshold, and a caller that passes no footprint raise nothing.

### H4 — Crash forensics: heartbeat + "black box"
Collector maintains a heartbeat file (mtime = last sample) and appends a compact rolling
snapshot (top-N sessions by RSS + host vitals) to a size-capped ring file (reuse `rotate.ts`).
On startup: if the last heartbeat predates current boot (`/proc/uptime` vs heartbeat mtime, or
mtime staleness > 5× poll on macOS), emit `host.crash-suspected` with the final pre-crash
snapshot attached. Timeline/dashboard can then answer *"what was eating RAM right before the
box died"*.
**Accept:** simulate (write stale heartbeat + boot-time fake in a unit test): next start emits
`host.crash-suspected` whose payload names the top consumer from the last snapshot; clean
shutdown does NOT emit it.

**Addendum 2026-09-27 — `hostTop`, from the first real crash the box recorded.**
2026-09-23 22:33:23Z `health.critical swap 100 %` (0 → 100 inside one 30 s tick), last heartbeat
22:34:53Z, host down until 00:50:53Z. `crash-last.json` did its job — and its `top` list summed to
**under 6 G across every tracked pane tree** while swap had just filled 69 G. The pressure was not a
tmux tree, so a black box that knew only tmux trees could not name it. Every snapshot and every
`mem`/`swap` **crit** event now also carries `hostTop`: the host's top-8 processes by RSS from the
same `/proc` pass, regardless of tmux membership — `pid`, `comm`, `rssBytes`, **never argv** (argv
carries tokens). Ring lines written before this date lack the field and still parse.
**Accept (FAILS-if-removed, `test/hosttop.test.js`):** a ~200 MB child spawned outside any tmux
socket appears in `hostTopProcesses()`; a child launched with a token in its argv is listed and the
token appears nowhere; no `/proc` → `[]`; `record()` → ring → `crash-last.json` round-trips
`hostTop` with a legacy line beside it; a crit alert's `hostTop` reaches the ledger event and an
alert without one adds no key.

**Addendum 2026-09-28 — SIGHUP is a stop, not a crash, from the first FALSE crash the box recorded.**
2026-09-28 16:50:06Z `systemd-logind`: *Power key pressed short* — an orderly power-off (the instance was stopped
and started 17:10:16Z on the kernel unattended-upgrades had installed). systemd stopped the user session scopes,
the tmux server tore its panes down and the daemon — a pane's `sh -c "cd … && node … web; exec bash"`, same pgid
and tty — took the pty's SIGHUP with only SIGINT/SIGTERM hooked; node's default killed it before any marker, and
the 17:14:37Z start ledgered `host.crash-suspected` (heartbeat 16:50:04.868Z, boot 17:10:16Z, 367 of 397 GB
free). The marker is now written on SIGHUP too and the process still exits by SIGHUP. A real host crash delivers
no signal at all, so hooking one can mask nothing.
**Accept (FAILS-if-removed, `test/clean-shutdown-sighup.test.js`):** the built daemon sent SIGHUP after its first
heartbeat exits by SIGHUP with `health/clean-shutdown` at/after the heartbeat; a `Blackbox` on that home with the
boot forced after the heartbeat is not suspected; SIGTERM through `stopWeb()` still writes the marker.

### H5 — Prediction: time-to-exhaustion + culprit
Over the snapshot window (H4's ring), fit a linear slope to host `MemAvailable` and to each
session tree's RSS. When the host slope is negative and projected exhaustion `< 30 min`, emit
`health.prediction` naming the session(s) whose growth dominates the slope (attribution = the
leaking session, e.g. an idle CC process growing 500 MB/min per upstream #41765). Surface as a
dashboard banner: *"~22 min to OOM at current trend — driven by <session>"*.
**Accept:** unit test feeds a synthetic monotonic per-session leak series → prediction fires
with the right culprit and a sane ETA; flat/noisy series → no fire (assert zero false-positive
on the recorded real-fleet fixture).

### H6 (post-epic, optional) — Upstream signature tracking
Record the agent CLI + version per session (from the process cmdline we already walk) into
`session.meta`, so a fleet-wide memory-profile shift after an upgrade (#22042's class) is
attributable. A `docs/` watchlist maps known upstream leak issues to versions. No automated
GitHub polling — that is scope creep until proven needed.

## Non-goals

- Auto-kill/auto-restart of leaking sessions (operator decision; policy-gated future work).
- GPU/accelerator health (different substrate, different owner).
- Cross-host aggregation (single-host tool until the distribution decision lands).

## Sequencing

H1+H2 are one PR-sized change each and independently shippable; H3 depends on H1; H4 on H1;
H5 on H4. None are GA-blockers — GA gates are frozen (frozen for the release); this epic is the
first post-GA operability investment, driven by a real operator crash report (2026-08-26).
