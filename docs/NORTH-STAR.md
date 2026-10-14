# ★ North Star — what tmux-agent is, and what it refuses to become

> **Make tmux-agent a tool any engineer can drop into their agent workflow in under five minutes
> and trust with a fleet they care about.**

That sentence is the identity. Stated so it can be **falsified**: a
north star that only lives in commit messages is unfalsifiable, so this document exists to be
argued with — and it has been, by three independent frontier models
([NORTH-STAR-REVIEW.md](NORTH-STAR-REVIEW.md)).

## The one sentence, expanded

**tmux-agent is a *substrate*: it makes any fleet of tmux-hosted agent CLIs safely observable and
drivable — with lineage, verified input, durable structured evidence, and an audited control path
— for an operator who is not us.**

Three words carry the weight:

- **Substrate, not orchestrator.** Bring your own supervisor brain. **The line, written down
  because a reviewer asked where it was:** providing the *verb* (`spawn`, `send`, `kill`) is in
  scope; deciding *when* to spawn or kill is out. Mechanism is ours; policy is yours. *If a feature
  requires us to decide what the fleet should do, it is out of scope.* (Guarded by TMUX-64, not
  just asserted here.)
- **Any fleet.** Our own 12–26 session fleet is the **test subject, never the specification**
  (`AGENTS.md`). Anything true only of our fleet is data (`lexicon.json`), not code.
- **Not us.** The bar is **adoption by a stranger** — harder and more honest than a checklist,
  because it fails on everything we only understand because we built it.

## The four non-negotiables (from three days of directives)

1. **The board is the truth about the work; the ledger is the truth about what happened.** Work is
   designed as cards with executable acceptance criteria; nothing reaches Done without the command
   and its output. *A green board that lies is worse than a red board that is true.*
   **Precedence, because two "single sources of truth" is none:** the board is authoritative about
   *intent* (what we decided, what counts as done); the NDJSON ledger is authoritative about
   *events* (what the fleet actually did, when). On conflict the ledger wins about runtime facts and
   the board wins about intent — a card claiming an outcome the ledger does not show is wrong.
2. **Observation is honest.** States are inferred from process signals and named profiles;
   degraded data reads `null`, never a plausible fake; a declared claim never overrides an observed
   one. An honest `UNKNOWN` beats a confident wrong state — **a session waiting on a human that
   reads as calm is the worst output this tool can produce**, and it is the failure mode we keep
   rediscovering.
3. **Enforcement lives in code, not convention.** Loopback-only bind, token by default,
   CSRF/rebinding guards, argv-only exec, additive-only redaction, policy refusals as 403s — each
   one a test that fails if the property is removed.
4. **Autonomy is evidence-gated.** The product advances itself (a 2h cron lane, one card per fire;
   co-writers in one checkout) under the same Definition of Done a human is held to — autonomy
   grants widen *who decides*, never *what counts as done*.

## Anti-goals (saying no is the point)

- **Not an orchestrator.** No opinions about what your agents should work on.
- **Not a terminal sharing service.** Not ttyd, not web SSH.
- **Never publicly bound.** No non-loopback listener without an explicit dangerous flag *and* a
  token. There is no scenario where exposing this is correct.
- **No per-CLI logic in core.** If it names a specific agent CLI, it is config or an adapter.
- **Not a metrics *platform*.** No retention, no query language, no aggregation service — we
  publish a machine-readable contract (`status.json`, the NDJSON ledger) and expect you to point
  your own tooling at it. Threshold→event→notify for fleet triage is in scope; being your
  Prometheus is not. *(Wording sharpened after a reviewer read the blunter version as a
  contradiction — see the review.)*
- **Not a sandbox for your agents.** We do not confine what *your* agent CLIs may do — no seccomp,
  no container, no filesystem jail. Scoping an agent's own powers is your runtime's job. What we
  *do* own is the safety of **our** injection and control paths: policy-gated verbs, an audit
  ledger, redaction at the read boundary, loopback-plus-token. Stated explicitly because a reviewer
  read our silence on it as an omission rather than a boundary, and on a tool that types into
  terminals an ambiguous security scope is itself a defect.

## The Definition of Done that outranks the roadmap

**A gate is Done only when a check exists that FAILS if the property is removed.** Measured, not
asserted. The author does not self-approve; a separate lane confirms. This applies to the north
star itself: every drift the panel confirmed became a board card with a falsifiable acceptance line.

---

## Operator directive log

The north star was derived from the project owner's directives of 2026-08-25 to 2026-08-27, recorded verbatim
in the private working repository so that intent stays traceable to what was asked. That log names internal planning
pages, boards and sessions and is not part of this repository; the two directives that changed the product most are
summarised below.

### The two directives that changed the product most

**#10 reframed the goal** from "build the tool we need" to "build the tool anyone needs, using ours
as the test case." That exposed a structural defect no feature list would have caught: three
lexicons hardcoded in `src/core` meant *adapting to any other fleet required a fork*, and one of
the three (redaction) failed **silently and security-relevantly** for anyone on a different cloud.
See [AGNOSTIC-DESIGN.md](AGNOSTIC-DESIGN.md).

**#3 turned "acceptance criteria"** from a phrase into a definition with three required parts (the
command, the expected value, the failure it prevents) — and forced browser-level layers into the
suite, which immediately caught defects every node suite had missed.

### The "framework of analysis by agent" (#10, explicitly)

The operator asked for the keywords and values to be **derived by an agent**, not hand-authored per
adopter. That is `tmux-agent calibrate`, split three ways on purpose:

| Layer | Who | Why there |
|---|---|---|
| Sample the fleet, cluster recurrences, screen credential shapes | **deterministic code** | must be reproducible, offline, no creds, no model dependency |
| Name the semantics ("this glyph means awaiting-human") | **an agent** (skill `tmux-agent-calibrate`) | judgement over ambiguous text — what a model is good at and a regex is not |
| Ratify the draft | **a human** | it changes what the tool believes about their fleet |

Evidence → interpretation → ratification. An agent is used only where its output can be checked
against captured evidence, and **never** where it silently becomes ground truth.

---

## Validation — multi-LLM skeptic panel

Method: the `north-star-validation` skill. An **abstracted** product summary (never raw
commands/logs; redact-scanned as a hard gate before leaving the host) went to three independent
frontier models prompted to **refute, not agree**. Convergence across models is the signal; each
confirmed gap becomes a board card that fails if the property is removed.

**Run 2026-08-27 — verdict, confirmed drifts, refuted claims, and the four cards they became:
[NORTH-STAR-REVIEW.md](NORTH-STAR-REVIEW.md).**

Headline: two models independently named the same #1 risk — **the GA claim rests on the one
property that has never been measured** (adoption by a stranger). Both cleared the safety claims.
Three of their objections were artifacts of the prompt's abstraction rather than defects, which is
recorded in the review because a skeptic panel you accept wholesale is just a differently-shaped
cheerleader.
