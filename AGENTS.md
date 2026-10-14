# AGENTS.md — for an agent working ON tmux-agent

Companion to [CONTRIBUTING.md](CONTRIBUTING.md) (the six design rules). This file is the agent-shaped version:
what to check before you change something, and the traps that have already cost real time.

**What this project is.** Read **[docs/NORTH-STAR.md](docs/NORTH-STAR.md)** before your first
change — it is the one document that tells you what to say *no* to. Short form: a **substrate**
(not an orchestrator) that makes *any* fleet of tmux-hosted agent CLIs safely observable and
drivable, for an operator who is not us. **The objective is adoption by a stranger**, a harder bar than a checklist because it fails on anything we
only understand because we built it.

**Two tests to run against any change you are about to make:**
1. *Does this require the tool to decide what the fleet should DO?* → out of scope; we are the
   layer beneath the supervisor, not the supervisor.
2. *Is this true for every fleet, or only ours?* → if only ours, it is `lexicon.json` or
   `adapters/`, never `src/core`.

## The rule that generates most review comments

**Nothing about OUR fleet may be hardcoded in `src/core/`.** Our environment is the *test subject*,
never the *specification*. Three lexicons violated this and were extracted to `lexicon.json`
(see [docs/AGNOSTIC-DESIGN.md](docs/AGNOSTIC-DESIGN.md)):

| Vocabulary | Now configurable via |
|---|---|
| What `BLOCKED`/`WORKING`/`ERROR` look like per agent CLI | `profiles[]` |
| What counts as a legitimate non-tmux supervisor | `parents.nonSession` / `nonSessionPattern` |
| Which secret shapes to redact | `redact[]` (**additive only** — see below) |

Before adding any literal — a CLI name, a prompt glyph, a session-naming convention, a provider's
key format, a path — ask: *is this true for every fleet, or only for ours?* If only ours, it is
data, not code. `src/adapters/` and `lexicon.json` are where it goes.

**Do not add a config path that weakens redaction.** User rules are additive by construction and
`g` is forced. A config typo must never be able to write plaintext credentials to disk.

## Verify before claiming — five layers, and what only each one catches

```bash
# node >= 20 on PATH (with nvm: `nvm use 22`)
npm run lint            # eslint (two custom rules enforce CONTRIBUTING 1+2) + tsc --noEmit
npm test                # build + unit + smoke + web-smoke
npm run test:coverage
```

| Layer | Only it can catch |
|---|---|
| Unit (`test/*.test.js`) | pure logic, error paths, the 11 attack classes |
| `test/smoke.sh` | the real tmux verbs against a live server |
| `test/smoke-web.sh` | CSRF, DNS-rebinding, token, file modes |
| `npm run test:ui` | a JS throw, an unbound handler, a 401 where a UI belonged |
| `npm run test:browser-audit` | composited contrast, out-of-order renders, poll-vs-typing |

**Any `src/web/*` change requires the two browser layers.** Node suites string-match HTML source;
that passed while real rendering failed. This is not optional for a UI claim.

**Run the command, read the output, then claim.** Never "should pass".

## Traps that have already cost time here

- **Three of four CI portability failures were bugs in the TESTS, not the product.** When a test
  fails on a platform you cannot see, make it print its own evidence before you change the code
  under test. One "macOS TUI-guard bug" was `/etc/hostname` not existing on macOS.
- **A test that fails on working software is worse than no test.** The first browser-acceptance run
  scored 5/8; the screenshot proved three were my assertions (CSS `text-transform`, a re-render
  after filtering, a deliberately-ignored keydown while an input had focus).
- **tmux target grain is not interchangeable:** `=name` for session verbs, `=name:` for
  pane/window verbs. `set-option -t "=name"` fails on tmux 3.4. A lint rule enforces the helpers.
- **Verify what a process IS before acting on what a pattern suggests.** A `pkill` matching
  `tmux-agent.js.*web` once killed a live supervisor agent, not a duplicate dashboard.
- **A returning request proves nothing about the effect.** Assert the far end: the ledger event,
  the file on disk, the DOM row count equal to the served count.

## Where things are

| Where | What |
|---|---|
| `src/core/` | tmux driver, orchestrator, monitor/profiles, **lexicon** (per-fleet vocabulary), **calibrate** (derive it from evidence), activity, health, ledger, policy, redaction, watchdog |
| `src/web/` | loopback dashboard — `server.ts` (API) + `ui.ts` (single-file UI, no build step, no CDN) |
| `src/mcp/` | MCP server, 13 audited tools |
| `src/adapters/` | anything specific to one CLI / notifier / harness |
| `docs/AGNOSTIC-DESIGN.md` | why the vocabulary is data, and the calibrate→ratify framework |
| `docs/THREAT-MODEL.md` | assets, actors, 9 findings as case studies, accepted residual risks |
| `.claude/skills/tmux-agent-*` | skills for an agent *using* the tool to run a fleet |

## Board discipline

The maintainers' project board is the single source of truth. **No card reaches Done without the command
and its output in the body** — a green board that lies is worse than a red board that is true.
Plane rate-limits aggressively: pace calls ~15s, back off 45s+ on 429, cache issue ids.

Cards labelled `needs-decision` are owner-only. Escalate; never self-answer.
