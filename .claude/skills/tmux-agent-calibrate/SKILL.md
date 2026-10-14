---
name: tmux-agent-calibrate
description: Use when tmux-agent misreads a fleet — sessions stuck on UNKNOWN, everything labelled ORPHANED, a blocking prompt reported as IDLE, or credentials appearing unredacted in served pane text. Runs `tmux-agent calibrate`, interprets the evidence, and hands a human a reviewable lexicon diff. Fires on "calibrate", "why is my fleet UNKNOWN", "teach it my CLI".
---

# Calibrating a fleet's vocabulary

`tmux-agent calibrate` does the mechanical half — sampling, frequency analysis, credential-shape
screening — deterministically and offline. **Your job is the half a regex cannot do: naming what
the evidence means.** Then a human ratifies it.

## The hard rule

**Calibrate proposes; a human applies.** Never write `lexicon.json` yourself. A misclassifying
fleet view is worse than no fleet view because it is *trusted* — an operator who believes a session
is `IDLE` when it is waiting on them will leave it waiting for hours.

Your deliverable is a **reviewed draft plus a diff summary**, not a live config change.

## 1. Get the evidence

```bash
tmux-agent calibrate --out lexicon.draft.json
```

Every proposal carries `evidence`: the observed sample, the session it came from, and
`seenInSessions` — how many distinct sessions showed it. **Recurrence across sessions is the signal
that something is vocabulary rather than noise.** A pattern seen once is an anecdote.

## 2. Interpret each proposal class

### `parents[]` — non-session supervisors

The tool proposes a name when ≥2 live sessions claim it as parent but no tmux session has that
name. Decide: is this a **process** that legitimately owns sessions (a watchdog, a cron, a
scheduler, a human), or a session that **died** and left real orphans?

- Process → add it. Orphan-labelling every child of a watchdog is the 27-of-31 bug.
- Genuinely dead → do **not** add it. Suppressing a real orphan hides rot.

Ask the operator when the name is ambiguous (`boss`, `main`, `runner` could be either).

### `prompts[]` — blocking-prompt shapes

Proposed patterns match the *shape* (marker + numbered option, or y/n), which is how an unprofiled
CLI gets detected at all. Your work here:

1. **Verify the pattern actually matches** the cited line, and does not match ordinary output.
2. **Tighten it.** A bare `\d+\.` will match version strings and list output. Anchor it.
3. **Name the semantics.** Is this prompt *awaiting a human* (`BLOCKED`) or just a menu the CLI
   draws while working? Only the first is BLOCKED.

`calibrate` deliberately proposes **BLOCKED only**. Adding `working`/`error` patterns is your
contribution, and it requires reading the CLI's actual wording — check its docs or run it once and
capture the pane. **Do not guess spinner glyphs or error strings**; a wrong `working` pattern makes
a stuck session look busy forever, which is the worst possible failure of a monitoring tool.

### `secretShapes[]` — credentials that survived redaction

These are shapes the built-in patterns do not know. The report gives **length and charset only,
never the value** — keep it that way in anything you write or paste.

- Propose a **narrow, anchored** pattern (`ACME_[A-Z0-9]{10}`), never something broad like
  `[A-Za-z0-9]{20,}` which would redact ordinary output and make logs useless.
- Redaction is **additive**: your rule cannot disable a built-in, and you cannot weaken it.
- If a value looks like a real credential, tell the operator it is **already on disk** in the
  capture log (raw `pipe-pane` bytes are an accepted residual risk) — rotating it may matter more
  than the regex.

## 3. Hand over a reviewable diff

Present, per proposed rule: the rule, the evidence that justified it, your interpretation, and your
confidence. Flag anything you were unsure about rather than burying it. Then:

```bash
# the HUMAN does this
cp lexicon.draft.json "$TMUX_AGENT_HOME/lexicon.json"
tmux-agent doctor        # confirm: profile order, extraRules count, parent verdicts
tmux-agent status        # the states should now be meaningful
```

`doctor --parent name1,name2` prints the predicate's verdict on specific names — use it to prove a
parent rule does what the operator expects.

## 4. Prove it changed behaviour

A config that loaded is not a config that works. Show a **before/after** on the same session:
`UNKNOWN → BLOCKED`, or a session no longer labelled `ORPHANED`. If nothing changed, the pattern
does not match what you thought it did — go back to the pane text.

## Anti-patterns

- **Writing `lexicon.json` directly.** Not yours to ratify.
- **Guessing `working`/`error` patterns** to make a profile look complete. A stuck session reading
  as busy is the failure this tool exists to prevent.
- **Broad redaction patterns** that scrub normal output — an unusable log gets capture turned off,
  which is worse than a narrow rule.
- **Copying a secret value** into a report, card, or chat message. Shapes only.
- **Adding a proposed parent without deciding process-vs-dead.** One choice hides orphans; the
  other invents them.
- **Reporting "calibrated" without a before/after.** Loading is not working.
