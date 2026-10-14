# Threat model

`tmux-agent` types into terminals, runs shell commands, and reads everything those terminals
print. That is the whole point of it, and it means the interesting question is not "is it
secure" but **"what exactly is it trusted to do, by whom, and what happens when that trust is
misplaced."** This document answers that, and states the risks we accept rather than pretending
there are none.

Every finding below was **reproduced before it was fixed**, and each carries a regression test.
None came from reading the code — all eleven came from attacking it.

## Assets

| Asset | Why an attacker wants it |
|---|---|
| **The ability to type into a pane** | An agent session is usually authenticated to something (git, cloud, a package registry). Typing into it is code execution *with that agent's privileges*, not just text. |
| **Pane content** | Terminals show tokens, presigned URLs, connection strings. We found live STS credentials in a real capture log during this project. |
| **Capture logs + event ledger** | The same content, durable on disk, plus a record of every command an operator ran. Both are bounded: capture logs rotate by size; ledger day files older than 30 days are gzip-archived under `ledger/archive/` and never deleted by default (`health.json` `ledgerDeleteAfterDays` opts in); the footprint is on `/api/health` and `doctor`. |
| **The control surface itself** (CLI / MCP / HTTP) | Reaching any one of them is equivalent to sitting at the keyboard. |
| **Session lineage** | Knowing which session owns which repo/task is reconnaissance. |

## Actors and trust boundaries

| Actor | Trusted? | Boundary |
|---|---|---|
| The operator running the tool | Yes — same UID, already has a shell | none (they could do this by hand) |
| **A web page in the operator's browser** | **No** | The loopback HTTP API. A page cannot read our responses cross-origin, but it *can send requests* — and sending is what matters here. |
| **Another local UID on a shared host** | **No** | Any loopback port; the filesystem under `$TMUX_AGENT_HOME`. |
| **An MCP client / another agent** | Partially | Tool surface + policy. It may drive the fleet, but must not be able to escalate past the policy or discover state it was denied. |
| **A session created outside tmux-agent** | **No** | Its *name* and *pane content* are attacker-controlled data that flow into our UI and logs. |
| Remote network | N/A | We never bind non-loopback without an explicit `--dangerously-allow-remote` **and** a token. |

The load-bearing insight: **loopback is a reachability boundary, not an authorization
boundary.** Two of the eleven findings existed because that distinction was blurred.

## Findings (all fixed, all regression-tested)

### 1. CRITICAL — CSRF on `POST /api/send`: any web page could type into your agents
A page at `evil.example` could `fetch('http://127.0.0.1:7337/api/send', …)`. The browser sends
it; the server executed it. **Verified end-to-end:** the forged request returned
`{"verified":true}` and the command ran in the victim pane.
**Fix:** three independent checks on every request — `Sec-Fetch-Site` (browser-declared, cannot
be forged by page JS), an `Origin` allowlist, and a loopback `Host`+port assertion that also
defeats DNS rebinding. Refusals are ledgered as `control.denied`.
**Tests:** 11 attack-class unit cases (`test/unit.test.js`) + web-smoke steps 11–14.
**Lesson:** the only thing protecting the live instance was a read-only policy set for an
unrelated reason. Defense in depth is what saved us; it should not have been the sole control.

### 2. HIGH — XSS via a foreign session name, chaining into finding 1
Session names went into an inline `onclick` as a JS string, and the escaper did not cover `'`.
A session created outside tmux-agent (trivial with `--default-server`) could carry a name that
executes JS in the operator's **same-origin** context — which then drives `/api/send`
*legitimately*, defeating the CSRF fix entirely.
**Fix:** no generated JS. Names travel as `data-` attributes read by a delegated listener;
`esc()` covers `'` and `/`.
**Lesson:** fixing CSRF is worthless if the attacker can get code into your own origin.

### 3. HIGH — commands landing in the wrong terminal
A fixed tmux buffer name meant two concurrent sends clobbered each other: **verified** session
B's text pasted into session A's pane while B received nothing. For a tool whose job is typing
into terminals, this is the worst possible failure.
**Fix:** unique buffer + temp file per paste; the file is removed in `finally`, the buffer by the paste's own `-d` — a `delete-buffer` after that named a buffer tmux through 3.3a answers by deleting the newest one, another send's (TMUX-231, `test/paste-buffer-cleanup.test.js`).
**Test:** `smoke.sh` step 11 asserts zero cross-contamination under concurrency.

### 4. HIGH — injections that silently never ran
After rapid prior input, `ble.sh` sits in `-- MULTILINE --`, where Enter inserts a newline
instead of executing. Every paste was swallowed and `exec` hung to timeout. A supervisor would
believe it had dispatched work that never happened.
**Fix:** `C-c` clears stale editor state before pasting **into a shell** — and only a shell: the
clear asks exec's own foreground guard, so a pane an agent TUI owns receives no SIGINT and
`input.sent` records `cleared: true|false` (TMUX-169; until then every paste interrupted a running
agent's turn); submit with `C-j`; the exec wrapper is written to a script file so the injected line
stays short and quote-free (a >220-column inline command was being truncated mid-quote by pane width).
The verification is of THIS paste (TMUX-206, measured 2026-10-13 on `d542ddf` by the review): the pane is
captured before and after the paste and the text must appear in the lines the paste ADDED — until then one
capture after the paste was searched whole for the first 40 characters, so a re-send whose opening was still
in scrollback, or a text sharing it with an earlier command, read as landed with the paste dropped and Enter
went in, and an empty text landed by definition. A failed verification types nothing — no Enter and no `C-u`
(the retry used to wipe whatever the recipient had on its input line); the pane is looked at twice before a
paste is called dropped, and a second paste is attempted only when the pane shows no trace of the text; an empty or whitespace-only text is refused before the policy gate
(`EmptyTextError`; exit 64 at the CLI).
**Test:** `test/send-no-interrupt.test.js` — a fixture TUI records zero SIGINTs across a verified send
and one from a raw `C-c` control; a shell left in an open-quote continuation state still runs the pasted command.
`test/verified-delivery.test.js` — a scripted pane: fresh input lands; a stale echo, a same-prefix line and a
dropped paste do not, with no Enter and no `C-u`; a redraw and a re-spaced line land; a retry pastes again only
over a traceless pane; empty text is refused before anything is typed.

### 5. HIGH — `exec-sync` returned unrelated scrollback as "the output"
A byte offset measured on a 5-line capture was applied to a 500-line capture: **verified** 55
lines of unrelated filler returned for `echo UNIQUE_MARKER`. Silent wrong answers to every
caller, including agents making decisions on it.
**Fix:** output and exit code come from temp **files**; pane text is never parsed for results.

### 6. HIGH — MCP silently advertised 7 of 12 tools
A single global `readOnly` set for the *browser dashboard* also removed every mutating tool from
MCP `tools/list`. The only hint was a stderr line most clients discard. An outside user would
install this, find a crippled server, and have no way to learn why.
**Fix:** policy is scoped per surface (`web` / `mcp` / `cli`), and an always-visible
`policy-status` tool reports what is hidden and which config produced it.
**Lesson:** a security control that silently removes capability is a reliability bug too. Denials
must be *discoverable*.

### 7. HIGH — shared-host exposure: any local UID could drive the fleet
Loopback with no auth. On a dev VM or login node, any other user or process could `curl` the API
and type into your agents.
**Fix:** a token is generated on first run (`~/.tmux-agent/web-token`, `0600`) and required by
default; accepted via `Authorization`, `?token=`, or an `HttpOnly; SameSite=Strict` cookie so the
browser flow is unchanged. `--no-token` is an explicit single-user opt-out.

### 8. MEDIUM — world-readable secrets on disk
`writeFileSync`'s mode applies only on *create*, so a pre-existing log stayed `0644`; the ledger
had no mode at all, and it stores command previews. Real exposure found in a sibling system: live
`ASIA…` STS credentials inside presigned S3 URLs in a capture log.
**Fix:** `chmod 0600` on every capture arm and new ledger file, inside a `0700` home.

### 9. MEDIUM — `isError` dropped from MCP responses
A schema violation returned a *successful* result whose text merely contained the word "error".
Any client branching on `isError` — all of them do — would treat a failed spawn as a success.
**Fix:** returned inside `result` where clients read it.

### 10. MEDIUM — mailbox agent names were path segments
`msg send <from> <to>` and `msg recv <agent>` built `<home>/mailbox/<name>/inbox` from the name with
no check on it, at the umask's modes. **Reproduced 2026-09-15 on `d8979b9`:** `msg send vp-a ../../X
hello` wrote a `0664` message file beside the `0700` home and exited 0; `msg recv ../../X` read every
`*.json` there and renamed each into an `archive/` it created; an empty name was an agent
(`<home>/mailbox/inbox`); the same over MCP `message-send` / `message-receive` with `isError` unset —
an agent driving the server could write a file with a body it chose at any writable path relative to
the mailbox, and move files out of any directory it named. The ledger recorded the path as the session.
**Fix:** every agent name the mailbox touches — `<from>` (spliced into the file name and the ledger's
actor), `<to>`, `<agent>` — is judged by the session-name rule (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`,
`typeof` first) before any directory exists: exit 64 at the CLI naming the argument, the value as typed
and the rule, where the flag names and positional counts are judged; `isError` over MCP through the
mailbox's own throw. Mailbox directories are `0700` and message files `0600`, as the ledger's (finding 8).
**Tests:** `test/agent-name.test.js` (CLI, modes, the rule's drift), the TMUX-107 case in
`test/mcp.test.js`, `test/smoke.sh` step 6.
The same rule judges every other name the tool records: each verb's `<name>` (TMUX-109,
`test/spawn-name.test.js`) and, since TMUX-110, the two lineage values — `--parent`, and the actor
(`--actor`, else `TMUX_AGENT_ACTOR`) that becomes a session's owner, the name on every ledger row and the
string `kill`'s ownership check compares. **Reproduced 2026-09-15 on `e254450`:** `--actor ../who spawn
vp-bad --parent 'not a name!'` exited 0 with both values in tmux's options and the audit envelope, and
every other actor's `kill` was refused `owned by ../who`. Now each is refused before the home exists — exit
64 at the CLI naming the source, `isError` over MCP for the parent, and an MCP server started under a
`TMUX_AGENT_ACTOR` the rule rejects exits 78 before it answers (`test/lineage-name.test.js`, the TMUX-110
case in `test/mcp.test.js`, `test/smoke.sh` step 1).

### 11. HIGH — a policy file the tool could not use silently became the permissive default
`Policy`'s constructor wrapped `JSON.parse(readFileSync(p))` in one bare `catch { this.cfg = {}; }`, meant for the
absent default. **Reproduced 2026-10-13 on `e757b28`** (review, offline, planted files): `{"readOnly":true,}` — a
trailing comma — a directory named `policy.json`, a file this user could not read (mode 000), a `TMUX_AGENT_POLICY` path
that did not exist, a JSON array and `{"readOnly":"yes"}` each built a policy with `isReadOnly() === false` and
`explain().source === "global default"`: every mutating verb open on every surface, `status`/`doctor`/`web` exit 0 with
no word about the file, MCP `policy-status` reporting a permissive default the operator never wrote. An operator who
edits the file to add a deny-list and leaves a trailing comma restarts `web` write-capable — the control finding 1
credits with saving the live instance, removed by a typo. The lexicon loader has refused exactly this class since
TMUX-112; this file had not.
**Fix:** only the absent default path is silently permissive. Every other failure is a `PolicyError` — a read failure
names the source (`TMUX_AGENT_POLICY`, `default path`), the path as given and the OS reason in the lexicon loader's
words; a content failure names the path and the field: not valid JSON, not a JSON object, a `readOnly` that is not a
boolean, a key outside VERSIONING item 5's four (a key beginning with `_` is a note), a surface that is not web/mcp/cli,
an action that is not one of the five, an allow/deny entry that is not an array of strings. The CLI prints
`policy config error: …` and exits 78 (EX_CONFIG) on every verb, `web` before it binds; the MCP server exits 78 with the
same line before `initialize` is answered.
**Reproduced again 2026-10-13 on `cd44cf1` (TMUX-226, `scratch/ga-fire-2026-10-13-20Z/probe-parent-cd44cf1.log`):** the
one silent case was read too widely. A `policy.json` at the default path that is a symbolic link whose target is missing —
a dotfiles or `/etc` checkout that has moved, a mount not yet there — reads ENOENT, and the loader took every ENOENT at
the default path as the absent file: the `Policy` loaded with source "global default", `status`/`doctor` exit 0 with no
word about the file, the MCP server answered `initialize` with `readOnly=false`. The directory entry is present, so it
is not the absent default this finding's fix promised was the only permissive case. **Fix:** on ENOENT the loader lstats
the path; an entry that exists as a symbolic link is refused naming the source, the link as given and its target —
`default path "<home>/policy.json": cannot be read — a symbolic link to "<target>", which does not exist (ENOENT)` — on
the CLI (78) and the MCP server alike, and in the same words for a link named by `TMUX_AGENT_POLICY`; a link whose
target exists loads as the file it points to; only a default path with no entry at all is the permissive default.
`loadLexicon` had the same gap at the default `lexicon.json` (TMUX-112 closed the named-and-unreadable class, not this
one) and takes the same rule: the shipped vocabulary — the operator's redact rules silently not applied — is now only
for a path with no entry.
**Tests:** `test/policy-load.test.js` (the rule in-process, table-driven over every refused shape — since TMUX-226 the
dangling link at the default path and under `TMUX_AGENT_POLICY`, a link to a readable file as the control; every verb and
`web --port` through the built CLI — 78, one line, no row, no server, no listener; the controls — the absent default
permissive, a valid read-only file still refusing `kill` with its `control.denied` row), the TMUX-204 and TMUX-112 cases
in `test/mcp.test.js` (each with its default-path dangling link), `test/lexicon-unreadable.test.js` (the lexicon's link,
named and at the default path, on every verb; a working link as the control), `test/smoke.sh` step 9.
**Lesson:** a loader whose error path installs the permissive default is a control that fails open. The fail-closed
rule the lexicon loader learned has to be applied to every operator-written file that gates an action, not only to the
file where the gap was first seen.

## Controls, and what each is actually for

| Control | Stops | Does **not** stop |
|---|---|---|
| argv-only `execFile` (never a shell string) | command injection through any tool argument | a caller legitimately asking us to run a command |
| Exact-match tmux targets (`=name` / `=name:`) | killing the wrong session by prefix match; silent wrong-grain failures | anything semantic |
| Dedicated tmux socket (`-L tmux-agent`) by default; a `--socket` / `TMUX_AGENT_SOCKET` that is not a `-L` name (`[A-Za-z0-9._-]`, 1 or more) is refused before the home exists — exit 64 at the CLI on every verb, 78 at MCP startup (TMUX-113; the driver already refused the shell-metacharacter shape, but at the first tmux call, after the home was made, and `watch` read that as the session dying) | touching the human's own sessions by accident; a socket name that is a path or carries a shell metacharacter reaching the generated exec script | `--default-server`, which is opt-in and adopts them deliberately |
| CSRF/rebinding guard | a browser page driving the API | a non-browser client on the same host (that is the token's job) |
| Token by default | another local UID driving the fleet | the operator's own processes |
| Policy (per-surface, read-only, allow/deny); a policy file that cannot be read or is not the schema is refused at startup, exit 78 (finding 11) | an agent exceeding its remit; a typo'd file silently becoming the permissive default | a policy that parses and says the wrong thing — so `policy-status` makes it inspectable |
| Ownership check on `kill` | one actor killing another's sessions | `force` plus policy permission |
| Redaction at every boundary | known secret shapes reaching a caller or the ledger | novel secret formats — see accepted risks |
| Append-only audit ledger (incl. refusals) | silent action; makes review possible | prevention — it is a record, not a gate |
| Session-name rule on every mailbox agent name (`<from>`, `<to>`, `<agent>`) | a message file or archive directory landing outside `<home>/mailbox/` through `..`, `/` or an empty name | an agent reading another agent's inbox — the mailbox is a shared drop-box under one UID, not an identity system |
| Session-name rule on every `<name>` and on the lineage values (`--parent`, `--actor` / `TMUX_AGENT_ACTOR`) | a session born under, or owned by, a name the tool cannot address — an orphan by construction, an owner no `kill` can name, a value in the audit envelope the tool's own rule rejects | an actor choosing a *valid* name that is not theirs — the actor is a label, not an identity (see the ownership row) |

## Non-goals (boundaries, not oversights)

- **We do not sandbox your agents.** tmux-agent never confines what the agent CLIs *inside* the
  panes may do — no seccomp, no container, no filesystem jail, no allowlist over the agent's own
  commands. Scoping an agent's powers (its credentials, its filesystem, its blast radius) is your
  runtime's job. What this threat model *does* own is every path by which **we** touch a terminal:
  policy-gated verbs, verified injection, the append-only ledger, redaction at every read
  boundary, loopback-plus-token. Stated here because a reviewer read our silence on it as an
  omission rather than a boundary — on a tool that types into terminals, an ambiguous security
  scope is itself a defect. Matching anti-goal in [NORTH-STAR.md](NORTH-STAR.md).

## Accepted residual risks (deliberate, not oversights)

1. **Raw `pipe-pane` capture logs are not redacted at write time.** `pipe-pane` streams bytes
   straight to disk; interposing a filter would add a process per session and risk losing data
   on stall. Mitigation: logs are `0600` inside a `0700` home, never leave the machine, and every
   *read* path (`read-log`, `capture-pane`, dashboard, timeline, the snapshot's `lastLine`) redacts.
   The last of those was measured raw on 2026-09-23: the last non-empty pane line that
   `Monitor.snapshot()` publishes — the body of every `watch` notification, a field of every
   `status.json` record and of the MCP `session-status` / `fleet-status` replies, the dashboard's
   *last line* cell — passed through unredacted while every other read path redacted, so a key printed
   by a program that then waits reached an outbound webhook. It is now redacted at its one producer,
   before the 160-character cut, with classification still reading the raw tail;
   `test/lastline-redaction.test.js` drives the field through the root, the CLI and the MCP server.
   The ledger's own text fields were the next door (TMUX-205, measured 2026-10-13 on `e757b28` by the review): the
   `input.sent` preview and the `exec.done` / `exec.timeout` command were `redact(text.slice(0, N))` — the cut BEFORE
   the redaction, so a key whose tail straddled column 120 or 200 was sliced below its pattern and survived in the row
   as a partial (`AKIAFAKEFAKEFAKEFAK`, AKIA + 15) — and `session.spawned` stored its `command` and `task` verbatim;
   `LedgerIndex.events()`, the dashboard's history and timeline served the rows as stored. Control: the ledger's
   `preview`, `command` and `task` fields are redacted before their cut at every producer, and `LedgerIndex` projects
   every row it reads through the same three-field redaction, so a row from before the fix that holds a whole shape is
   served redacted on every route (a row holding only a fragment carries nothing a pattern can match — the reason the
   producers had to change). The bytes on disk are not rewritten and the schema is unchanged. Regression-tested in
   `test/ledger-preview-redaction.test.js`: every producer on a fake pane with the plant straddling each cut, legacy
   rows planted on disk read back through the index and the built dashboard's four event routes. The two text paths
   that fix left were closed by TMUX-225 (measured 2026-10-13 on `fe4cf19`): the mailbox's `message.sent` `subject`
   is redacted at its producer and projected for legacy rows (the message file itself carries the subject as sent —
   delivery is the recipient's, the files are 0600 in a 0700 home), and the `@agent_task` tmux user option — set
   verbatim at spawn, since tmux is the operator's state and not a ledger — is redacted where the tool reads it back:
   `Tmux.listSessionsDetailed()` (the dashboard's fleet rows, `calibrate`) and the orchestrator's lineage rows
   (`lineage`, MCP `list-lineage`, `status.json`); the option itself is never rewritten. Regression-tested in
   `test/task-subject-redaction.test.js` on a real isolated tmux server and the built CLI and dashboard.
   **If you cannot accept plaintext secrets at rest on that host, do not enable capture.**
2. **Redaction is signature-based, not DLP.** It catches AWS keys, GitHub/Slack/OpenAI-style
   tokens, JWTs, PEM blocks, inline URL credentials, `password=` style pairs, and — since TMUX-95
   (2026-09-13) — the HTTP credential envelope every provider's token travels a command line in:
   `Authorization: Bearer|Basic <cred>` (any scheme case, bare or inside a quoted `-H` argument)
   and `X-Api-Key:` / `api_key=` / `*_API_KEY=` pairs, which is the form this tool's own dashboard
   token is accepted in (§7). Until then both passed through verbatim on every read path, found by
   a FAIL-first probe of the shipped `dist/`, not by reading the code. A novel secret format will
   pass through.

   Since TMUX-111 (2026-09-15) the pair-shaped rules also hold when a syntax-highlighting shell
   (ble.sh, zsh-syntax-highlighting, fish) has drawn the line: the raw capture then carries SGR
   colour codes between the name, the separator and the value
   (`PLANE_API_KEY\x1b[0;38;5;33m=\x1b[0m…`), and until then every pair rule wanted `KEY=value` and
   served the value verbatim on `read-log` and the dashboard's log tail — found when the smoke's own
   step 5 went red on a highlighting host while CI's plain shells stayed green. The rules admit any
   run of terminal control sequences between their parts and are byte-for-byte unchanged on a plain
   line (`test/redact-highlighted.test.js`, the TMUX-111 case in `test/mcp.test.js`, `test/smoke.sh`
   step 5).

   **This was a silent gap for anyone whose providers differ from ours** — the built-in shapes are
   the ones *we* use, so an adopter on another cloud got no redaction of their credentials and no
   signal that anything was missing. Since 2026-08-26 extra shapes are added at **config** time
   via `lexicon.json` (`redact[]`), no fork required — and `tmux-agent calibrate` will *find*
   credential-shaped values that survived redaction and propose rules for them, reporting only
   length/charset and never the value itself.

   The same gap had a second door until 2026-09-16 (TMUX-112, measured on `85d3ba7`): `loadLexicon` returned
   the empty lexicon for *every* read failure, not only the absent default, so a lexicon the operator named
   with `--lexicon` or `TMUX_AGENT_LEXICON` on a path that did not exist, a directory, or a file this user
   could not read (mode 000) ran every verb with the shipped defaults, exit 0 — the operator's `redact[]`
   rules not applied, the shape reaching `exec.done` and `input.sent` in plain text, `doctor` alone showing
   `"loaded": false`; the MCP server started silent under the same variable. Control: only the absent default
   is silent; every other read failure is a `LexiconError` naming the source, the path as given and the OS
   reason — exit 78 on every CLI verb before it acts, and the MCP server exits 78 with the same one line before
   `initialize` is answered. Regression-tested in `test/lexicon.test.js`, `test/lexicon-unreadable.test.js`
   (the redaction property through the built CLI: readable → `[PRB-REDACTED]` in the row; unreadable →
   refused, no row with the plain shape), the TMUX-112 case in `test/mcp.test.js`, and `test/smoke.sh` step 15.

   Two properties are enforced structurally rather than by discipline, because a config bug here
   would write plaintext credentials to disk:
   - **Additive only.** There is no config path that disables a built-in pattern. A lexicon can
     make redaction stronger, never weaker. Regression-tested in `test/lexicon.test.js`.
   - **`g` is forced** on every user rule; a pattern that scrubbed only the first match would
     leak every later occurrence.

   Residual risk *introduced* by this feature, and its control: a config-supplied regex runs in
   the poll loop, and JS has no regex timeout, so a catastrophically-backtracking pattern would
   hang the fleet view. `lexicon.json` is operator-owned local config at the same trust level as
   `policy.json` — not attacker input — but patterns are still capped at 512 chars and screened
   for nested unbounded quantifiers at load, with the offending rule named. Screening is a
   heuristic, not a proof: it rejects the shapes that cause ReDoS in practice.
3. **The operator's own UID is fully trusted.** Anyone who can run the CLI can already run
   commands. We defend against *other* origins and *other* UIDs, not against the user.
4. **`--dangerously-allow-remote` is a real hole if used.** It requires an explicit flag *and* a
   token, and the name is the warning. Prefer an SSH tunnel; there is no scenario where binding
   this publicly is correct.
5. **A compromised child session can lie to us.** State classification reads pane text and
   `/proc`; a hostile process can fake both. Engagement/state are operational signals, not
   security assertions — never gate a security decision on them.
6. **The dashboard's `/api/*` is private, not a public API.** It exists to serve our own UI. It is
   excluded from the semver contract (`VERSIONING.md`) precisely so we can harden it freely.

## Reporting

See [SECURITY.md](../SECURITY.md). Use GitHub private vulnerability reporting. Given what this
tool does, a report showing **any** path to injecting input into a session the reporter should not
control is treated as critical.
