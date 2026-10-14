# Contributing to tmux-agent

Thanks for helping! Ground rules, short version:

## Setup

```bash
git clone https://github.com/dmvevents/tmux-agent-public && cd tmux-agent-public
npm install && npm run build && npm test   # unit + e2e smoke on an isolated tmux socket
```

Requirements: node >= 20, tmux >= 3.2 (`tmux -V`). The smoke test never touches your own tmux
server — everything runs on socket `ta-smoke-$$` and a temp `TMUX_AGENT_HOME`.

## Design rules (PRs are reviewed against these)

1. **argv-only tmux.** Every tmux call goes through `src/core/tmux.ts#exec` (`execFile`). No
   shell strings, ever — that's how the incumbent shipped an RCE.
2. **Exact targets.** Use `sessionTarget()`/`paneTarget()`; never hand-build `-t` strings.
   The two target grains are non-interchangeable and fail silently when mixed.
3. **Events, not scrapes.** New observable behavior = a new `EventType` in the ledger first;
   pane-regex heuristics belong in an `AgentProfile`, not core.
4. **Safety is core.** Mutating capabilities must respect `Policy` and emit audit events —
   including refusals (`control.denied`).
5. **Agnostic core.** Anything specific to one agent CLI / notifier / harness goes in
   `src/adapters/`. Core must run for a user with nothing but tmux + node.
   **Our fleet is the test subject, never the specification.** Before adding any literal — a CLI
   name, a prompt glyph, a session-naming convention, a provider's key format — ask whether it is
   true for *every* fleet or only ours. If only ours, it is data: `lexicon.json`, not source. This
   rule was broken three times (classification regexes, non-session parent names, secret shapes)
   and each break shipped a bug an adopter could only fix by forking — see
   [docs/AGNOSTIC-DESIGN.md](docs/AGNOSTIC-DESIGN.md). Do not add a config path that *weakens*
   redaction; user rules are additive by construction.
6. **Redact at the boundary.** Anything read from a pane passes through `redact()` before it
   is returned or persisted outside the raw chmod-600 log.

## Tests

`test/smoke.sh` is the acceptance path (spawn → verify-send → exec-sync → capture → message →
notify → status.json → waste → policy → audited kill). New features extend it or add a sibling
script wired into `npm test`. Known tmux footguns (target grains, pipe-pane replace/toggle,
history-limit-at-creation) should keep regression coverage. The suite's layers and how to
run each one are in [docs/TESTING.md](docs/TESTING.md), not their counts —
this page is checked against the tree by `test/root-docs-contract.test.js` and fails on drift.

## Commits / PRs

- Conventional-ish subjects (`feat:`, `fix:`, `docs:` ...), imperative mood.
- One logical change per PR; include the "why" in the body.
- CI (ubuntu + macos × node 20/22/24/26) must be green.

## Security

No secrets in issues/PRs. Vulnerabilities: see [SECURITY.md](SECURITY.md).
