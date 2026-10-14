---
name: tmux-agent-adopt
description: Use when bringing an UNKNOWN tmux fleet under tmux-agent management for the first time — installing, verifying the loopback dashboard, confirming policy, proving lineage on a canary, then calibrating the fleet's own vocabulary. Fires on "adopt this fleet", "set up tmux-agent here", "onboard my sessions".
---

# Adopting a fleet you have never seen

The goal is the OKR's bar: **a stranger trusting this with a fleet they care about, in under five
minutes.** So this is ordered by *risk*, not by feature: prove you cannot damage the fleet, then
prove you can observe it, and only then prove you can drive it.

## The rule that makes this safe

**Read before write, canary before fleet.** Every step below is read-only until step 5, and step 5
touches a session you created. Never send input to a pre-existing session while adopting — you do
not yet know what state it is in, and a stray keystroke into a live agent is unrecoverable.

## 1. Install and confirm the binary runs

```bash
node --version          # must be >= 20
tmux -V                 # must be >= 3.2
tmux-agent doctor       # or: node dist/bin/tmux-agent.js doctor
```

`doctor` is the first command for a reason: it prints the vocabulary actually in effect (profile
chain, redaction rule count, policy). If it errors with `lexicon config error` (exit 78), a config
file is malformed — fix that before believing anything else the tool says.

## 2. Look, without touching

```bash
tmux-agent status                    # every session: state, ctx%, lineage
tmux-agent status --json | head -40
```

Read the states critically. **If most sessions show `UNKNOWN`, the fleet's CLI is not one of the
four shipped profiles** — that is expected, not broken, and step 6 fixes it. If most show
`ORPHANED` in the dashboard, the fleet's supervisor naming is not in the built-in list — also
step 6.

## 3. Confirm the security posture before opening anything

```bash
tmux-agent doctor | grep -A5 policy      # what each surface may do
ss -ltnp | grep 7337                     # after starting web: MUST be 127.0.0.1, never 0.0.0.0
```

The dashboard is loopback-only and reached over `ssh -L PORT:localhost:PORT host`. **Never bind a
non-loopback address**; `--dangerously-allow-remote` exists and is named as the warning it is.
Never print or paste the web token — it grants the ability to type into terminals.

Consider starting read-only while you learn the fleet:

```json
// $TMUX_AGENT_HOME/policy.json
{ "surfaces": { "web": { "readOnly": true } } }
```

## 4. Start the dashboard and verify it renders the fleet

```bash
tmux-agent web            # prints the URL with token, and the ssh -L line
```

Acceptance, not vibes: the rendered row count must equal `/api/fleet`'s session count. A dashboard
that silently drops sessions is worse than no dashboard.

## 5. Canary: prove lineage and verified send on a session you own

```bash
tmux-agent spawn canary --cwd /tmp --parent adopt-test --task "adoption canary"
tmux-agent exec canary "echo hello" --timeout 30      # exit code propagates
tmux-agent lineage canary                             # parent/task/owner recorded
tmux-agent log canary                                 # durable capture path
tmux-agent kill canary
```

If `exec` hangs or returns unrelated text, stop and investigate before adopting anything real —
that is the failure class the verified-send path exists to prevent.

## 6. Calibrate the fleet's own vocabulary

This is what makes the tool fit *their* fleet instead of ours. See the
`tmux-agent-calibrate` skill for the full loop; the short version:

```bash
tmux-agent calibrate --out lexicon.draft.json     # PROPOSES; never applies
# review every rule against its cited evidence, edit, then:
cp lexicon.draft.json "$TMUX_AGENT_HOME/lexicon.json"   # a HUMAN decides this
tmux-agent doctor                                  # confirm it loaded
tmux-agent status                                  # states should now be meaningful
```

## Report what you actually verified

State, per step, the command and its output — not "adoption complete". If a step was skipped
(no capacity for a canary, dashboard not started), say which and why.

## Anti-patterns

- **Sending input to a pre-existing session during adoption.** You do not know its state yet.
- **Believing `status` before checking `doctor`.** A malformed lexicon changes what states mean.
- **Binding the dashboard off-loopback "just to check from my laptop."** Use the tunnel.
- **Copying `lexicon.draft.json` into place unreviewed.** A confidently-wrong classifier is worse
  than an honest `UNKNOWN`, because people act on it.
- **Reporting adoption done with `UNKNOWN` states unexplained.** That is the fleet telling you its
  vocabulary is not yet described.
