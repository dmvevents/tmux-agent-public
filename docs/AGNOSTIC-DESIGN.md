# Agnostic design — how tmux-agent serves a fleet it has never seen

**The problem this document exists to fix.** tmux-agent's *architecture* is agnostic: profiles,
notify sinks, messaging, and policy are all pluggable. But the **vocabulary** the tool reasons
with is not. Three lexicons live in `src/core` as TypeScript literals, and the only way to change
them is to fork and rebuild.

Every token of vocabulary that is ours rather than an adopter's, one row per lexicon:

| Lexicon | Where | Whose vocabulary is it? |
|---|---|---|
| Agent-CLI classification regexes (what `BLOCKED`/`WORKING`/`ERROR` *look like*) | `core/monitor.ts` | `claude-code`, `codex`, `aider` — the three CLIs **we** run |
| Non-session parent names (what counts as a legitimate non-tmux supervisor) | `core/engagement.ts` | `operator`, `user`, `cron`, `systemd`, `unknown`, `watchdog`, `daemon`, `supervisor`, `-loop$`, `^loop-` — **our** fleet's naming; the last two are patterns, anchored at the end and at the start of a parent's name |
| Secret shapes to redact | `core/redact.ts` | `AWS`, `GitHub`, `Slack`, `OpenAI`, `JWT`, `PEM` — **our** provider set; plus, since TMUX-95, the provider-neutral HTTP credential envelope every token travels in: `Authorization: Bearer`, `Authorization: Basic`, `X-Api-Key:`, `api_key=` (any `*_API_KEY=` spelling included) |

Read as data by the suite (`test/agnostic-contract.test.js`, TMUX-141): the third column of every
row above is parsed out of this page and held against the module the second column names — a
`src/` path, and `dist/` + the same name for what ships — so a token this table stops naming, or
one the code grows and this table never mentions, fails the suite instead of going quietly out of
date. The first column stays editorial: there is no live authority for what `BLOCKED` *looks like*.

This violates our own CONTRIBUTING rule 5 ("anything specific to one agent CLI / harness goes in
`adapters/`"). The evidence that it was always meant to be otherwise: `src/adapters/profiles/` has
existed as an **empty directory** since the first commit.

**Why it matters more than it looks.** Each hardcoded lexicon has already produced a real,
diagnosed bug *for us* — and we fixed each one only for our own vocabulary:

- `codex` parked on a blocking update prompt and reported `IDLE`, because Codex draws `›` where
  Claude Code draws `❯`. We added a codex profile. **A fourth CLI still fails the same way.**
- 27 of 31 sessions were mislabelled `ORPHANED` because their parents (`cron-watchdog`,
  `pager-watchdog`, `operator`) are processes, not tmux sessions. We added *our* names to an
  allowlist. **An adopter whose supervisors are called `boss`, `orchestrator-1`, or `k8s-job`
  gets the identical 27-of-31 wrongness on day one, with no way to fix it but a fork.**
- Redaction covers the providers we use. **An adopter on Azure or GCP gets silent non-redaction
  of their keys** — the failure mode is invisible, and it writes secrets to disk.

That last one is the argument for treating this as a **GA blocker rather than a nice-to-have**:
"agnostic" is currently a claim in the README that the code does not honour, and one of the three
failures is a security failure that is silent by construction.

---

## 1. The fix: lexicons become data, with the shipped values as defaults

One file, `$TMUX_AGENT_HOME/lexicon.json` (override with `TMUX_AGENT_LEXICON`), mirroring how
`policy.json` already works — same location, same 0600 expectation, same "absent means defaults"
behaviour. Nothing about the current experience changes for someone who never writes one.

```jsonc
{
  "version": 1,
  "profiles": [                          // tried BEFORE built-ins: you know your CLI better than we do
    { "name": "my-cli",
      "error":   ["quota exceeded", "fatal:"],
      "blocked": ["\\[y/N\\]", "^\\s*»\\s*\\d+\\."],
      "working": ["thinking…", "⣾|⣽|⣻"],
      "contextPct": "context (\\d+)%" }   // one capture group = the percentage
  ],
  "parents": {                           // what a legitimate NON-tmux supervisor is called here
    "nonSession": ["boss", "k8s-job"],
    "nonSessionPattern": "^orchestrator-\\d+$"
  },
  "redact": [                            // ADDITIVE — built-ins always run, yours run after
    { "name": "azure-key", "pattern": "[0-9a-f]{32}\\.azure", "replacement": "[REDACTED_AZURE]" }
  ]
}
```

### Design decisions, and why each is the safe one

1. **Extend, never silently replace.** User entries are *added* to the built-ins; a release that
   ships a new profile must not be undone by an old config file. Wanting only your own vocabulary
   is available, spelled where the loader reads it and nowhere else: `replaceProfiles` at the top
   level drops the built-in profile chain, `parents.replace` drops the built-in supervisor names,
   and `redact` has no such key at all — decision 2 is why. *Prevents:* an adopter who wrote a
   lexicon in v1.0 silently losing v1.1's new CLI support.

2. **Redaction is additive-only, structurally.** Built-in secret patterns always run, before
   user patterns, and a user pattern that throws is skipped rather than aborting the pass.
   *Prevents:* the worst possible config bug — a typo'd lexicon making redaction *weaker* and
   writing plaintext credentials to disk. A user can strengthen redaction; they cannot weaken it.

3. **User profiles are tried first; built-ins are the fallback chain.** Overriding is the entire
   point. *Prevents:* an adopter being unable to correct a built-in profile that misreads their
   fork of a CLI.

4. **Validation is loud, per-rule, and never partial-silent.** Every pattern is compiled at load
   with the rule's `name` in the error. A bad lexicon must not degrade the fleet view into
   confident wrongness — the failure has to be visible at the moment of loading, because a
   classifier that is quietly wrong is indistinguishable from a fleet that is quietly fine.

5. **Patterns are capped and screened.** `lexicon.json` is operator-owned local config at the
   same trust level as `policy.json` — not attacker input — but a catastrophic backtracking
   pattern would hang the poll loop, so pattern length is capped and nested unbounded quantifiers
   are rejected with a named error. JS has no regex timeout; screening at load is the only
   available guard. Recorded as residual risk in [THREAT-MODEL.md](THREAT-MODEL.md).

6. **Config is a strict superset of today's behaviour.** No lexicon file at the default path ⇒ byte-identical
   classification to v0.1.0. This is what makes the change safe to ship at GA rather than after. A file that
   was *named* — `--lexicon FILE`, `TMUX_AGENT_LEXICON` — and cannot be read is not "no file": it is refused
   (exit 78, the reason in words), never silently the defaults.

---

## 2. The framework of analysis: an agent derives the lexicon, a human ratifies it

Handing an adopter an empty `lexicon.json` and a regex reference is not adoption — it is
homework. And it asks them to know things they cannot know yet: which glyph their CLI uses when
blocked, what their own supervisors are named, which secret shapes appear in their panes.

**We already know how that knowledge is actually acquired, because we acquired it the hard way:
by running the thing and reading what came out.** The codex `›` bug and the 27-of-31 orphan bug
were both found by observing a live fleet, not by reasoning about it. So the framework
*automates the observation*, and leaves the judgement to a human.

### `tmux-agent calibrate` — propose, never apply

```
tmux-agent calibrate [--out FILE]
```

Read as data by the suite (`test/agnostic-contract.test.js`, TMUX-143): the flags that line declares
are held against the built CLI's own table for this verb, both directions — a flag the code grows and
this line never names, or one this line promises and the binary refuses, fails the suite instead of
sending an adopter to type something that exits 64. A sampling count stood in this line until
TMUX-143, implemented by nothing and read by nothing: `calibrate` captures a fixed 40 lines per pane
and has no such flag. Promise 4 below is **driven** rather than read — a case runs the built binary
against a throwaway `$TMUX_AGENT_HOME` and fails if that home's `lexicon.json` moves by a byte.

Promises 1–3 are read as data too: promise 1's sources, promise 2's clustering criteria and
promise 3's evidence fields are each parsed as a list and held against the built `calibrate` — a source
with no live authority, or an evidence field that is not a key of the report's `evidence`, fails the
suite — and the promise COUNT is asserted, so a deleted promise fails rather than leaving a case reading
whichever prose happens to be third. Three claims stood in them until that card, and all three were
corrected on the **page** rather than implemented in the code: the ledger among promise 1's sources,
which the verb reads nothing from; a glyph made conditional on a session that stopped advancing, which
`CalibrateInput.looksStalled` never made it — that field was declared, read by nothing, and `false`,
`true` and absent gave byte-identical reports, so TMUX-147 **removed** it from the interface rather
than start honouring it (a semver decision, recorded in `CHANGELOG.md`); and the pane line as every
rule's evidence, which a prompt rule does not carry.

1. **Sample** the live fleet: pane tails, session names, `@agent_parent` values.
2. **Cluster** what recurs — repeated non-session parents, prompt glyphs at pane tails (the
   session's own state is never consulted), high-entropy strings shaped like credentials.
3. **Propose** a draft lexicon where **every rule carries the captured evidence that justified
   it** (the shape it was derived from, the session it came from, how often it recurred). A
   parent's shape is its `@agent_parent=` line and a credential's is a charset sketch that never
   copies the value; a prompt's is the glyph, not the pane line the glyph sat on.
4. **Never auto-apply.** The output is `lexicon.draft.json` plus a human-readable report; a human
   moves it into place. A misclassifying fleet view is worse than no fleet view, because it is
   trusted.

The evidence-per-rule requirement is what makes it reviewable in the sense the OKR means by
"acceptance criterion": a reviewer can read *why* a rule was proposed and get an unambiguous
opinion about whether it is right, without asking the author what they meant.

### Where an agent fits

Calibration is deliberately split so the mechanical half needs no model:

| Layer | Who does it | Why there |
|---|---|---|
| Sampling + frequency analysis + credential-shape screening | **Deterministic code** (`calibrate`) | Must be reproducible, offline, no creds, no model dependency |
| Naming the semantics ("this glyph means *awaiting human*", "`k8s-job` is a supervisor") | **An agent**, via the `tmux-agent-calibrate` skill | This is judgement over ambiguous text — exactly the part a model is good at and a regex is not |
| Ratifying the draft | **A human** | It changes what the tool believes about their fleet |

So: deterministic evidence → agent interpretation → human ratification. An agent is used where
its output can be checked against captured evidence, and nowhere that it silently becomes ground
truth.

Read as data by the suite: the table above is parsed as three rows, and every artefact a `Who does it`
cell names must resolve to exactly one live authority — `calibrate` to a verb the built CLI dispatches,
`tmux-agent-calibrate` to a skill directory in this repo. The human row names none, and is declared as
naming none rather than skipped. The row count is asserted, so a layer deleted from the split fails.

---

## 3. Agent-facing files an adopter needs (and what each is *for*)

Two distinct audiences, which is why this needs stating rather than one catch-all file:

| Audience | File | Contract it carries |
|---|---|---|
| An agent **working on** tmux-agent | [`AGENTS.md`](../AGENTS.md) (repo root) | The 6 design rules in agent-readable form, the three-lexicon rule, the five test layers, the evidence-before-Done rule |
| An agent **using** tmux-agent to run a fleet | `.claude/skills/tmux-agent-*` | How to adopt, calibrate, and supervise — task-shaped, not reference-shaped |

### Skills (in-repo, so they version with the code that they describe)

- **`tmux-agent-adopt`** — bring an unknown fleet under management: install, verify loopback,
  confirm policy, spawn a canary, prove lineage, then calibrate. The "first five minutes" path
  KR3 measures, written as a procedure instead of prose.
- **`tmux-agent-calibrate`** — run the draft, interpret the evidence, propose semantics, hand a
  human the diff. Carries the anti-patterns: never auto-apply, never weaken redaction, always
  cite the pane line.
- **`tmux-agent-supervise`** — the operating loop: read the attention banner, triage
  BLOCKED-vs-ERROR-vs-ORPHANED, drive with verified sends, escalate. This is the loop our own
  fleet runs; generalised, it is the product's actual use case.

Read as data by the suite: the audiences table and the list above are parsed together — the
directories matching this page's own `.claude/skills/tmux-agent-*` glob are set-equal with the names
these bullets carry, and the layers table's skill must be one of them. The authority is the repo tree:
`.claude/` is tracked in git and ships in no tarball. The `AGENTS.md` cell's link must resolve, and the
two counts that cell states are counted — the numbered rules under CONTRIBUTING's "Design rules"
heading, and the rows of AGENTS.md's own test-layers table.

### Memory: the ledger is the substrate, the lexicon is the learning

An adopter's agent accumulates two very different kinds of knowledge, and conflating them is how
agent memory rots:

- **Episodic** — what happened. Already durable and queryable: the NDJSON ledger + `status.json`
  + capture logs. No new mechanism; an agent should *query* this, never re-derive it from panes.
- **Semantic** — what things mean here. That is exactly `lexicon.json`. Calibration is the
  write path; classification is the read path.

The rule worth writing down: **when an agent learns a durable fact about the fleet's vocabulary,
it belongs in the lexicon, not in a prose note.** A fact in a lexicon changes the tool's
behaviour and is regression-tested; the same fact in a markdown file changes nothing and rots
silently. Prose notes are for *decisions and their rationale* (`docs/`), not for vocabulary.

---

## 4. What this changes about the GA definition

The OKR objective is *adoption by a stranger*, and KR3 is *universality*. Both were being
measured against things we could satisfy without ever removing our own vocabulary from the core:
"3 agent CLIs exercised" is satisfiable by us writing all three profiles ourselves. That is a
measure of **our** coverage, not of **their** extensibility.

So KR3 gains a criterion that only passes if a stranger can do it **without forking**: a new CLI,
a new supervisor naming scheme, and a new secret shape must each be addressable by config alone,
proven by a test that adds all three at runtime and asserts the behaviour changed.

Tracked on the board as the **TMUX-AG** epic; the security-relevant half (redaction) is a GA
blocker, the rest of the epic is not.
