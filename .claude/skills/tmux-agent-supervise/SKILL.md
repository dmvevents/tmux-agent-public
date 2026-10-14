---
name: tmux-agent-supervise
description: Use when running a multi-session agent fleet through tmux-agent — triaging which sessions need attention, driving them with verified sends, and escalating what a human must decide. Fires on "supervise the fleet", "what needs me", "check on my agents", "drive session X".
---

# Supervising a fleet

This is the loop the tool was built for, generalised. The whole point of the observability layer is
to answer one question fast: **what needs me right now?** Everything else is secondary.

## Triage order (states are not equally urgent)

```bash
tmux-agent status                # or open the dashboard: the attention banner is this, ranked
```

| State | What it means | Urgency |
|---|---|---|
| `BLOCKED` | waiting on a human **right now**; a prompt is on screen | **highest** — every second is idle time |
| `ERROR` | erroring, often *every turn*; looks quiet but is permanently stuck | high — it will never self-recover |
| `DEAD` / `GONE` | process exited / session vanished | high if unexpected, else housekeeping |
| `WORKING` | genuinely progressing | leave it alone |
| `IDLE` | alive, nothing to do | check whether it finished or was abandoned |
| `UNKNOWN` | **the tool cannot classify this CLI** | not a session problem — a vocabulary problem |

**`UNKNOWN` across many sessions means calibrate, not triage.** Use the `tmux-agent-calibrate`
skill; triaging sessions whose states you cannot trust wastes the operator's time.

Engagement is the second axis, and it changes what you do:

| Engagement | Reading |
|---|---|
| `ACTIVE` | someone is steering it — **do not interfere** |
| `ATTACHED` | a human is watching |
| `AUTONOMOUS` | running unsupervised — the ones that silently go wrong |
| `PARKED` | idle and undriven — did it finish, or was it forgotten? |
| `ORPHANED` | lineage points at a session that is gone — these quietly rot |

## Driving a session

```bash
tmux-agent send <name> "your text"      # verified: confirms it landed in the pane
tmux-agent exec <name> "cmd" --timeout 120   # blocks, real exit code, output from files
```

**Always prefer `exec` when you need output or an exit code.** `send` is for conversation with an
agent; `exec` is for commands whose result you will act on. Never parse pane scrollback for command
output — that path produced a real bug where unrelated scrollback was returned *as* the output.

Before sending to a `BLOCKED` session, **read the prompt**:

```bash
tmux-agent status <name>     # includes the last line
```

Answering a prompt you have not read is how a fleet gets `rm -rf` at a "are you sure?". If the
prompt is a permission or destructive-action confirmation, **escalate — do not answer it**.

## What to escalate rather than decide

- Any prompt asking to delete, force-push, deploy, spend money, or grant access.
- A session whose task you cannot determine (`tmux-agent lineage <name>` shows no task).
- Repeated `ERROR` after one corrective attempt — a second identical nudge is not a strategy.
- Anything requiring a credential, or a `needs-decision` question of policy.

## Housekeeping that is actually valuable

```bash
tmux-agent waste --since 24h      # error events, state churn, inputs per session
tmux-agent lineage <name>         # parent/task/owner — who asked for this?
```

`waste` answers "where did the fleet's time go". High state churn with many inputs usually means a
session being repeatedly nudged instead of fixed — that is a signal about the *supervisor's*
behaviour, not the session's.

## Safety bounds

- **Never kill a session you did not create** without explicit instruction. `kill` is policy-gated
  and ownership-checked for exactly this reason; surface it instead.
- **Verify what a process IS before acting on what a pattern suggests.** A pattern-matched `pkill`
  once killed a live supervisor agent that merely looked like a duplicate service.
- **A returning command proves nothing about its effect.** Check the far end: the ledger event, the
  file, the state transition.
- Never print the web token; never bind the dashboard off-loopback.

## Report honestly

Say what you observed, what you did, and what you left alone — with session names and the commands
you ran. "Fleet healthy" without evidence is not a report. If you could not classify sessions, say
so and name the vocabulary gap.

## Anti-patterns

- **Nudging an `ACTIVE` session** — someone else is driving it; you are now two writers.
- **Answering a blocking prompt without reading it.**
- **Treating `UNKNOWN` as broken sessions** rather than a missing profile.
- **Re-sending the same correction** to a session that errored on it once.
- **Reporting completion from a returning request** instead of a verified effect.
