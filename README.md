# tmux-agent

**Unified tmux orchestration + observability for AI agent workflows.**

A supervisor agent (or you) spawns tmux sessions running agent CLIs — Claude Code, Codex, aider,
anything — and needs to know: who owns what, is it working or stuck, what did it type, what did it
cost, and how do I talk to it safely. `tmux-agent` is that layer: spawn with lineage, verified
input injection, durable structured logs, state classification, cross-agent messaging, pluggable
notifications, waste analytics — all exposed as both a CLI and an MCP server, with a full audit
trail and safe-by-default policy.

Distilled from months of running a 12–26 session agent fleet in production. Every "weird" design
choice below is a paid-for lesson.

## Why not X?

- **Plain tmux MCP servers** (tmux-mcp and friends) give you `send-keys` and `capture-pane` — no
  lineage, no verified input, no logging, no analytics, no audit, and the most popular one is
  unmaintained with an open command-injection issue. We keep the good ideas (marker-based exec,
  resources) and build the missing layers, injection-proof (`execFile` argv only, never a shell).
- **Full orchestration frameworks** (e.g. awslabs/cli-agent-orchestrator) own your whole workflow.
  `tmux-agent` is a *substrate*: bring your own supervisor brain; we make the tmux layer safe,
  observable, and machine-readable.

## Install

```bash
tmux -V                                                    # needs tmux >= 3.2
node --version                                             # and node >= 20
git clone https://github.com/dmvevents/tmux-agent-public && cd tmux-agent-public
npm install && npm run build && npm install -g .           # today's path: from the clone
tmux-agent help                                            # every verb; `tmux-agent help web` lists one verb's flags
```

> **Status: v0.1.0, not published to npm.** The npm package named `tmux-agent` is a different project, so do not
> `npm install` it; the clone above IS the install (its `npm link` puts `tmux-agent` and `tmux-agent-mcp` on your PATH),
> and `test/smoke-readme.sh` runs this block and the demo below from a fresh home on every push.

## 5-minute demo (no config)

```bash
# 1. spawn a monitored child session in the current directory (isolated agent socket; your tmux is untouched)
tmux-agent spawn worker-1 --cwd "$PWD" --parent me --task "run the tests"

# 2. run something in it and BLOCK until it finishes (exit code propagates)
tmux-agent exec worker-1 "ls -la"

# 3. see the whole fleet: state, context%, lineage — and publish status.json
tmux-agent status

# 4. watch until it goes idle/stuck/dead; get a notification (Slack if configured)
tmux-agent watch worker-1 --idle-secs 5

# 5. what happened? durable log + audit ledger + waste report
tmux-agent log worker-1
tmux-agent waste --since 2026-08-18T00:00:00Z

# 6. done — kill what you spawned (your own tmux was never touched)
tmux-agent kill worker-1
```

Every verb's usage is `tmux-agent help`; one verb's flags, `tmux-agent help <verb>` (or `<verb> --help`).

## MCP server (drive it from any agent)

```jsonc
// .mcp.json / claude_desktop_config.json
{
  "mcpServers": {
    "tmux-agent": {
      "command": "tmux-agent-mcp",
      "env": { "TMUX_AGENT_ACTOR": "my-supervisor" }
    }
  }
}
```

Tools: `spawn-session`, `send-input` (verified two-step), `exec-sync` (blocking, exit code),
`capture-pane` (redacted), `session-status`, `fleet-status`, `kill-session` (ownership-checked),
`list-lineage`, `message-send`/`message-receive`, `waste-report`, `read-log`, `policy-status`
(what the active policy hides from this surface, and why).

## The model

```
supervisor (you, or an agent via MCP)
  └─ spawn-session: every session records @agent_parent / @agent_owner / @agent_task
       ├─ verified input: paste → verify it landed → Enter                 (kills the lost-Enter race)
       ├─ pipe-pane → ~/.tmux-agent/logs/<name>.log                        (byte-faithful, chmod 600)
       ├─ state: WORKING / IDLE / BLOCKED / ERROR / DEAD / GONE / UNKNOWN  (profile-driven, event-ledgered)
       └─ ledger: ~/.tmux-agent/ledger/events-YYYY-MM-DD.ndjson  ← analytics + log-consumer input
```

- **Isolated by default:** everything runs on tmux socket `-L tmux-agent` (`--socket`, else
  `TMUX_AGENT_SOCKET`, names another; a value that is not a `-L` name — `[A-Za-z0-9._-]`, 1 or more — is
  refused with exit 64 before anything is touched). Your interactive tmux server is invisible to it. Opt
  into the default server with `--default-server` (adoption mode).
- **Safe by default:** kill refuses sessions another actor owns; a JSON policy file adds
  read-only mode and per-action allow/deny lists; denied tools vanish from MCP `tools/list`;
  every control action (and every refusal) is a ledger event; pane content is secret-redacted
  before it leaves the tool.
- **Agnostic core:** per-CLI specifics (context %, spinner/menu detection) live in an
  `AgentProfile` adapter — add one for your CLI in ~20 lines. Slack is one `NotifySink`
  implementation; webhook/Telegram are drop-ins.

  The built-in profiles, tried in this order:

  | Profile | Status |
  |---|---|
  | `claude-code` | **verified** against live sessions |
  | `codex` | **verified** — spawn/send/exec/status driven through a real `codex` CLI; fixtures are captured pane text |
  | `aider` | best-effort — written from documented prompts, not yet run against a live session |
  | `generic-shell` | fallback; holds no opinion, so CPU-delta signals decide |

  Why this matters concretely: a live Codex session parked on its `› 1. Update now` prompt was
  reported **IDLE** by the Claude Code profile (Codex uses `›`, Claude uses `❯`), so a supervisor
  would never learn it was waiting on a human. That is the class of bug a profile prevents.

## Messaging between agents

Three tiers, best-available wins at runtime:
1. **Native [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)**
   when both ends are Claude Code and the feature is present (it is version- and provider-gated:
   not available on Bedrock/GCP/Foundry deployments — probe, don't assume).
2. **File mailbox** (built in): one message = one file, archive-on-read — works for any CLI,
   cross-team, cross-host via a shared path.
3. **Verified `send-input`**: the universal floor into any CLI's stdin.

## Web dashboard (loopback-only)

```bash
tmux-agent web                                   # http://127.0.0.1:7337 (7337 busy? it scans forward and the banner names the port)
tmux-agent web --port 7338                       # or pick the port yourself; --strict-port exits 75 instead of scanning
ssh -L 7337:localhost:7337 user@host             # then open http://localhost:7337 locally
```

The banner prints the URL with the token; the page sets it as an `HttpOnly; SameSite=Strict` cookie. A script
reaches the same API with `?token=…` or `Authorization: Bearer …` (the token is at `~/.tmux-agent/web-token`,
mode 0600): `/api/health` is the daemon's vitals, build and tmux verdict, `/api/fleet` the rows the table shows,
`/api/session/<name>` one session's pane, process and events. `--no-token` opts out on a single-user machine.

Serving it through another tool's proxy instead? Set `TMUX_AGENT_PUBLIC_URL=http://localhost:8000/tmux-agent/`
(or a whole sentence in `TMUX_AGENT_PUBLIC_HINT`) and the page's access note and the startup banner say that in
place of the `ssh -L` line. The bind stays 127.0.0.1 either way.

A single-file GUI over the same data: **parent/child fleet tree** with live state dots and
context-pressure warnings — every row says where its state came from, `profile <name> · <age>` when the daemon's
health tick read the pane and a profile spoke, `cpu-only` when it is the CPU-delta verdict alone — **workstream history** (active *and* decommissioned sessions,
reconstructed from the ledger), top-waste table, and per-session drill-in — live pane (redacted),
cwd + process, recent events, capture-log tail — plus a **send box** that goes through the exact
same verified/policy-checked/audited path as the CLI and MCP (read-only mode disables it).

Security posture (loopback is **not** a trust boundary — we treat it as one only for network
reachability, never for authorization):
- Binds `127.0.0.1`; any other host is **refused** unless you pass both
  `--dangerously-allow-remote` and `--token`. The intended path is an SSH tunnel, always.
- **CSRF + DNS-rebinding guard on every request** (`Sec-Fetch-Site` + `Origin` allowlist +
  loopback `Host` assertion). Without it, any page your browser visits can POST to
  `/api/send` and type into your agents — we proved that exploit before fixing it.
- **A token is generated on first run** (`~/.tmux-agent/web-token`, 0600) and required by
  default, because any local UID on a shared host can reach a loopback port. The startup
  line prints a URL with the token in it; `--no-token` opts out on a single-user machine.
- Capture logs and the ledger are 0600 inside a 0700 home; pane content is redacted on every
  read path (raw `pipe-pane` bytes stay local and mode-restricted).
For a full interactive terminal alongside it, pair with [ttyd](https://github.com/tsl0922/ttyd)
(MIT) on the same tunnel: `ttyd -i 127.0.0.1 tmux -L tmux-agent attach`.

## Making it fit YOUR fleet (no fork required)

The shipped profiles describe the CLIs *we* run, and the built-in redaction patterns cover *our*
cloud. Neither is your fleet. `$TMUX_AGENT_HOME/lexicon.json` holds the vocabulary the tool reasons
with — write it yourself, or have `calibrate` propose it from your live fleet:

```bash
tmux-agent calibrate --out lexicon.draft.json   # PROPOSES, with the evidence for each rule
# review it, then:
cp lexicon.draft.json ~/.tmux-agent/lexicon.json
tmux-agent doctor                               # vocabulary in effect + whether the dashboard on this host runs the build on disk and still sees its tmux server
```

```jsonc
{
  "version": 1,
  "profiles": [{                                 // tried BEFORE the built-ins, so you can override ours
    "name": "my-cli",
    "blocked": ["^\\s*»\\s*\\d+\\."],            // what "waiting on a human" looks like in YOUR CLI
    "working": ["thinking…"],
    "error":   ["quota exceeded"],
    "contextPct": "budget (\\d+)% left", "contextPctInverted": true
  }],
  "parents": { "nonSession": ["my-boss"],        // your supervisors are processes, not tmux sessions
               "nonSessionPattern": "^worker-\\d+$" },
  "redact":  [{ "name": "my-key", "pattern": "MYC_[A-Z0-9]{10}", "replacement": "[REDACTED]" }]
}
```

Three properties worth knowing: **redaction is additive only** (a lexicon can strengthen it, never
weaken it — there is no config path to disable a built-in); **failures are loud** (a bad pattern
names its rule and exits `78`, and so does a file you named with `--lexicon` or `TMUX_AGENT_LEXICON`
that is not there, is a directory or cannot be read — never silently the defaults); and **no lexicon
file at the default path means behaviour identical to the defaults**.
Why any of this exists, and the framework for deriving it: [docs/AGNOSTIC-DESIGN.md](docs/AGNOSTIC-DESIGN.md).

If most inspected sessions report *"classified by no profile"* in the dashboard, that is the tool
being honest that it is guessing — their state came from core signals, so **a session waiting on you
can read as `IDLE`**. That banner is your cue to calibrate. And when the chain picks the wrong profile
for one session, name the right one from outside: `--profile` on `status` and `watch` (a lexicon
profile or a built-in, exact) judges by that one profile alone, as does `profile` on the MCP
`session-status` and `fleet-status` tools — a name the tool does not hold is refused with exit `64`
(or an MCP error), never silently the chain's verdict.

## Status & analytics

`status.json` (machine-readable fleet state: each session's `session`, `state`, `at`, `lastLine`,
`classifiedBy`, `contextPct`, `logBytes`, `rssBytes`, `cpuPerSec`, `reason`, `parent`, `task`,
`owner`, `meta` — those fields and no others, all of them on every record with a null where the value
is unknown rather than an absent key, each explained in item 4 of [VERSIONING.md](VERSIONING.md)) is
published on every `status`/`fleet-status` call — point your Kanban/dashboard at it instead of
attaching to tmux; `status --json FILE` publishes to FILE instead, and a FILE the tool cannot write
is refused (exit 64, the reason named) before the fleet is read. Its top-level `tmux` block —
`{ reachable, since, error, checkedAt }` — is the verdict of the very listing that produced
`sessions`: `sessions: []` with `reachable: false` is a dead or absent tmux server (`error` in tmux's
own words), with `reachable: true` an idle fleet. The `--socket` name (default `tmux-agent`) is a tmux `-L`
name: its file lives at `$TMUX_TMPDIR/tmux-<uid>/<name>` (`/tmp` by default), and a Unix socket path is capped at
108 bytes — a name whose path is longer is reported `UNREACHABLE` in tmux's own words (`File name too long`), like
a server that is not running, never as a raw error. The MCP `fleet-status` reply carries the same block
beside `sessions` and `statusFile`, and the `status` verb prints one stderr line, `status: tmux server
UNREACHABLE on <socket> — <error>` (exit 0 — the fact rides the file). Per session, a `GONE` says which
failure it was: `reason` carries tmux's own words when the *server* did not answer, and is `null` when
the server answered and that one session is simply absent — so `watch` (exit 2 either way, plus one
`watch: tmux server UNREACHABLE on <socket> — <error>` line on stderr), `session-status` and
`/api/session/<name>` tell "restart this session" from "there is no server to restart it on". The NDJSON ledger is the
log-consumer contract: flat, versioned events
(`session.spawned`, `input.sent`, `session.state`, `exec.done`, `exec.timeout`, `control.denied`, ...) that
aggregate into the built-in `waste` report (error events, state churn, inputs per session).

## Using it from aws-do-agent

The aws-do-agent harness serves this dashboard behind its home page at `/tmux-agent/`, built from this repository
at container start: `TMUX_AGENT_SRC` names the source (this repository's URL), `TMUX_AGENT_REF` the branch, tag or
commit to build, and `TMUX_AGENT_INSTALL_DIR` where the checkout and the build live. Its installer fetches the ref,
runs `npm ci` and `npm run build`, checks that `dist/bin/tmux-agent.js --version` answers, and starts the `web` verb
loopback-only behind its proxy, with `TMUX_AGENT_PUBLIC_URL` naming the proxied address in the page's access note.
Nothing in this repository is specific to that harness: any process that can run `node dist/bin/tmux-agent.js web`
on a loopback port can serve it the same way.

## Development

```bash
npm install && npm run build && npm test   # build + unit + changelog check + smoke + web-smoke
npm run lint                               # eslint (enforces the CONTRIBUTING rules) + tsc --noEmit
npm run test:coverage                      # per-file line / branch / function coverage
```

Suite sizes and coverage numbers are deliberately **not** printed here: they change with every commit;
the suite's layers and how to run each one are in [docs/TESTING.md](docs/TESTING.md).
(A literal on this page went two weeks stale before anyone noticed; `test/readme-contract.test.js`
now fails the build if a count or percentage comes back — and if this page's MCP tool list, verbs,
flags, `npm run` scripts or links stop matching the built tree.)

Two further layers need a browser and gate CI on ubuntu/node-22 (they catch what no node suite
can — a JS throw, an unbound handler, composited contrast):

```bash
pip install playwright && python3 -m playwright install chromium
npm run test:ui              # acceptance criteria: real clicks on a real fleet
npm run test:browser-audit   # headless-chromium audit, 0 findings required
```

Everything runs on an isolated tmux socket and a throwaway `TMUX_AGENT_HOME` — your own tmux
sessions are never touched. See [CONTRIBUTING.md](CONTRIBUTING.md) for the six design rules
(two of them are enforced by custom lint rules, not honour system).

## Roadmap & planning

| Doc | What it holds |
|---|---|
| **[docs/NORTH-STAR.md](docs/NORTH-STAR.md)** | **what this is and what it refuses to become** — the one sentence, ordered priorities, anti-goals, and the operator directive ledger. Read this first; everything below serves it. |
| [docs/NORTH-STAR-REVIEW.md](docs/NORTH-STAR-REVIEW.md) | the north star put past three independent frontier models prompted to *refute* it — verdict, confirmed drifts, and the board gate each became |
| [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) | assets, actors, all 9 findings as case studies, accepted residual risk |
| [SECURITY.md](SECURITY.md) | how to report a vulnerability (14-day response SLA) |
| [VERSIONING.md](VERSIONING.md) | what the public API *is*, so semver means something |

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
