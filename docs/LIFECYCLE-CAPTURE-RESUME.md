# Lifecycle capture → archive → resume

> **Status: DESIGN (feasibility verified 2026-08-25).** Not built. This doc is the architecture +
> the honest gap list for the epic **TMUX-LC**. It consolidates three items
> (hooks-as-telemetry, registry + resurrect, session
> identity hardening) — into one story, because the operator's ask ("catch an explicit start/shutdown,
> route it to the substrate, document everything to a persistent store, be able to resume it, across
> all sessions") is exactly their synthesis.

## The ask, restated

When any session is **explicitly started or shut down**, a mechanism must:
1. **Catch** the lifecycle event (start / shutdown).
2. **Route** it to the tmux-agent substrate.
3. **Document** everything durably: the tmux session, the *Claude session it is associated with*,
   what the work was, and enough to **resume** it later — persistable/pushable to GitHub.
4. Do this **across all sessions**, not one.

## Feasibility verdict: YES — with two catch points, because neither alone is complete

The core question was "does Claude Code or the agent runtime even expose these events?" Verified
against `code.claude.com/docs` (hooks.md, sessions.md, settings.md, v2.1.240+) and against the
substrate source + live `tmux 3.4`:

| Capability | Verified | Consequence for the design |
|---|---|---|
| **Claude `SessionStart` hook** | fires on `startup\|resume\|clear\|compact\|fork`; stdin carries `session_id`, `transcript_path`, `cwd`, `permission_mode`; **stdout is injected as context** | the rich catch on *start*; on `resume` it can **re-hydrate** the session from our DB automatically |
| **Claude `SessionEnd` hook** | fires on `clear\|resume\|logout\|prompt_input_exit\|other`; **fire-and-forget (cannot block shutdown)**; **~1.5 s budget** (tunable to 60 s) | the rich catch on *shutdown* — but the snapshot must be a *fast local append*, not an inline git push |
| **`SessionEnd` has NO "killed"/"crash" reason** | confirmed — a hard `tmux kill-session` / SIGKILL fires **no Claude hook at all** | **the tmux hook is mandatory, not optional** — it is the only thing that catches an out-of-band kill |
| **tmux `session-closed` global hook** | exists in 3.4; `set-hook -g session-closed 'run-shell "…#{session_name}…"'` passes the closed session name | the backstop catch; fires **after** destroy, so user-options are gone but the **log file + ledger survive** |
| **Native resume** | `claude --resume <id>` and **`claude -p --resume <id>` (non-interactive)**; `session_id` is **stable across resume**; transcript at `projects/<slug>/<id>.jsonl` under Claude Code's home directory | resume is one command; our manifest just needs to store that id + a pointer |
| **Native session DB / remote handoff** | **does not exist** — only `/export` and `-p --output-format json` | the DB + GitHub-push layer is **ours to build** on the substrate |
| **Substrate ledger** | append-only NDJSON, event types incl. `session.spawned` (cwd/command/task), `session.killed` (force), `session.state`, `session.meta` (repo/branch/role/verdict) | we **extend** it with `session.snapshot` + `session.closed`; the join key is the missing piece |
| **Substrate kill path** | `tmux-agent kill` **is** ledgered (`session.killed`); a raw `tmux kill-session` is **NOT** — the monitor later just sees `GONE` | confirms the gap: out-of-band shutdowns are invisible today. This epic closes it. |

**Bottom line:** the runtime gives us everything except the store and the resume glue. Both catch
points are needed — Claude hooks for the rich "graceful" path (they carry the `session_id` ↔ work
link), the tmux hook as the guaranteed backstop for kills the Claude hook never sees.

## Architecture — three layers

```
        ┌───────────────── CATCH ─────────────────┐
 start  │  Claude SessionStart hook  ──┐           │
 ───────┤   (startup|resume|fork)      │           │
        │                              ▼           │
 stop   │  Claude SessionEnd hook  ─► tmux-agent   │ ─► append event (fast, local, redacted)
 ───────┤   (clear|logout|exit)      hooks-recv    │        session.snapshot / session.state
        │                              ▲           │
 KILL   │  tmux session-closed hook ───┘           │ ─► session.closed  (backstop for SIGKILL)
 ───────┤   run-shell on-session-closed.sh         │
        └──────────────────────────────────────────┘
                          │
        ┌───────────── ARCHIVE ──────────────┐
        │  NDJSON ledger  (source of truth)  │
        │        │                            │
        │        ▼  projection                │
        │  SQLite  sessions / snapshots       │  ◄── "documents everything inside a database"
        │        │                            │
        │        ▼  supervisor cycle          │
        │  state-report.md     + resume/*.json│  ◄── scrubbed, committed, pushed to GitHub
        └─────────────────────────────────────┘
                          │
        ┌───────────── RESUME ───────────────┐
        │  tmux-agent resume <session>       │
        │   → spawn tmux (same name/cwd/task)│
        │   → claude --resume <claude_id>    │
        │   → SessionStart(resume) re-hydrates from DB │
        └─────────────────────────────────────┘
```

### 1. CATCH — two hooks, one receiver

**Claude Code hooks** (the graceful, high-value path). A new verb `tmux-agent hooks install [--scope
project|user]` writes hook entries into `.claude/settings.json` (per-repo opt-in) or
`~/.claude/settings.json` (fleet-wide):
- `SessionStart` → `tmux-agent hooks recv start` — records `session.state{to:WORKING}` + captures the
  `session_id`↔`tmux session` binding (ground truth, replaces pane-regex classification — this is the
  release-fragility). On `source=resume`, its **stdout** re-injects
  the archived work-summary so the resumed agent knows where it left off.
- `SessionEnd` → `tmux-agent hooks recv end` — appends `session.snapshot` with the shutdown reason.
  **Must complete in <1.5 s**: it writes a *pointer* (`session_id`, `transcript_path`, `reason`, `cwd`),
  not a summary and not a push.
- `PreCompact` (optional) → snapshot before context is summarized away (useful for long autonomous lanes).

The receiver is loopback-only and inherits the substrate's existing **CSRF/Origin/redaction** guards
(the six audit findings in THREAT-MODEL.md already hardened this surface — reuse, do not reinvent).

**tmux `session-closed` hook** (the backstop). Installed once, globally:
```bash
tmux set-hook -g session-closed 'run-shell "~/.tmux-agent/bin/on-session-closed.sh #{session_name}"'
```
`on-session-closed.sh` appends a `session.closed` event, archives `~/.tmux-agent/logs/<name>.log`, and
reads the **last** `session.meta`/`session.spawned` for that name (user-options are already gone
post-destroy, so we rely on what the ledger already captured). This is the only catch that fires on a
hard `tmux kill-session`/SIGKILL — where Claude's SessionEnd never runs.

### 2. ARCHIVE — extend the ledger, project to SQLite, push scrubbed

**New event types** (additive to the versioned schema):
- `session.snapshot` — `{claude_session_id, transcript_path, repo, branch, cwd, role, last_prompt_id,
  resume_cmd, work_summary?}`. Emitted on SessionEnd, PreCompact, and periodically by the monitor.
- `session.closed` — `{reason, source:"tmux-hook"|"claude-hook"|"substrate-kill", log_archive_path}`.

**Identity (folded in):** primary key `name + session_created` (tmux side) **joined to**
`claude_session_id` (from the hook). This join is the literal answer to "what Claude session is
associated with it" — today the ledger has no such link.

**Persistence:** NDJSON stays the append-only **source of truth**; add a **SQLite projection** (a
`sessions` table + a `snapshots` table, rebuildable from NDJSON) so the store is *queryable* — that is
what "documents everything inside a database" means operationally. The dashboard reads the projection.

**GitHub push:** a supervisor's existing cycle (one that already commits a state report)
gains a `resume-manifests/<name>.json` per live/recently-closed session, **run through `redact.ts`
before commit**. This is deferred out of the 1.5 s hook path on purpose. Keep that repository private.

### 3. RESUME — one command, native under the hood

`tmux-agent resume <session>`:
1. read `resume-manifests/<name>.json` (or the SQLite `sessions` row);
2. `spawn` a tmux session with the same `name`/`cwd`/`parent`/`task` (existing orchestrator path);
3. launch `claude --resume <claude_session_id>` in it (interactive) or `claude -p --resume <id> "<re-entry
   prompt>"` (headless);
4. the `SessionStart(source=resume)` hook fires and re-injects the archived work-summary as context.

Same-host resume is fully covered by native mechanisms. **Cross-host resume** additionally needs the
the `projects/.../<id>.jsonl` transcript under Claude Code's home directory synced to the target host — out of scope for v1, noted
here so it isn't mistaken for done.

## Risks / constraints (the honest list)

- **1.5 s SessionEnd budget.** The exit snapshot is a pointer-write only. Summary generation and any
  git push are deferred to the supervisor cycle. Violating this drops snapshots on slow exits.
- **No "killed" reason from Claude.** Already handled by the tmux backstop; do not rely on SessionEnd
  alone or hard kills go unrecorded.
- **tmux hook fires post-destroy.** User-options are unreadable at that point; the archive must lean on
  what the ledger *already* holds (`session.meta`/`session.spawned`). If a session never emitted those,
  the closed record is thin — acceptable, and a reason to keep `session.meta` fresh.
- **Work-summary cost.** Can't run an LLM in 1.5 s. v1 stores the transcript pointer + a cheap
  heuristic (last N user prompts); a richer summary is a deferred supervisor-cycle job.
- **Redaction before push** is mandatory (reuse `redact.ts`); the manifest carries cwd/branch/role which
  are low-risk, but transcripts can carry secrets — never push raw transcripts, only manifests + pointers.
- **Hook receiver is an exec surface** — loopback-only, inherit the CSRF/Origin/Host guards already built.

## Scope

This epic covers hooks-as-telemetry, registry + resurrect and session identity. It is not a release blocker on its own.
