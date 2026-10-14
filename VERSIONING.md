# Versioning and the public API

`tmux-agent` follows [semver](https://semver.org/). Semver is only meaningful if the public
surface is written down, so this file **defines what is covered**. Anything not listed here is
internal and may change in a patch release. Items 1, 2, 3, 4, 5, 5b, 6, 7, 8 and 9 below are parsed as
data by `test/versioning-contract.test.js` and compared with the built package in **both** directions
on every `npm test` — item 4 in both of its halves, the file's own shape and the fields of each session
record, item 5 in both of its own, the policy file's top-level keys and the action
names an allow- or deny-list is keyed by, item 6 in both of ITS halves — every member of
every type it declares, and the types a declared VALUE hands a caller back through its parameters, its
return and the methods of a covered class, each closure walked transitively so a type reached two hops
down is one item 6 must NAME — item 7 in both of its halves — the home layout on
two authorities at once, what the built package *constructs* under the home and what a real home it
drove *ends up holding*, and the shipped build stamp on two more, the fields the stamped
`dist/build.json` holds and the fields the built reader normalises to — and item 5b in all
four of its lists, on the same two kinds of authority: which modules of the built package read a
lexicon key, and one fixture per key proving the built code *honours* it, and item 9 in both
of its lists on two authorities of its own, every `process.env` read the built package makes and one
fixture per name proving the built code *honours* that name — so this list
cannot drift from the tree without the suite going red. **That enumeration is itself parsed**
(TMUX-142): every item this sentence names must be read by a parser the suite invokes and asserts
non-empty, and no parser may claim an item the sentence leaves out — so the sentence cannot go on
describing a check that was deleted, which is what it did for the whole of its life until then. The **NOT covered** section below is parsed
the same way: its three lists — the internal module paths, the internal root exports and
the excluded directories — answer to live authorities of their own, the subpaths the package's
`exports` map refuses, the root barrel, and the file list of the published tarball, so an exclusion
this file claims cannot quietly become false either.

## Covered by semver (breaking changes require a major)

<!-- test/versioning-contract.test.js reads item 1 (verbs up to the words "global flags", then
     every --flag), item 2 (tool names up to "Removing a tool"), item 3 (event types up to
     "New event types"), item 4 (the status.json shape up to "and the documented per-session
     fields", compared with the keys the built CLI's `status --json` actually wrote — TMUX-133),
     item 5 (the policy file's top-level keys up to "An allow- or deny-list is keyed by action",
     compared with every this.cfg.<name> the built Policy reads — TMUX-135),
     item 7's home half (the paths between "Under the home:" and "that is the whole of the layout",
     within the half that ends at "Shipped layout:", compared with the first segments the built
     package joins onto the home AND with a real home the built CLI drove — TMUX-136),
     item 7's shipped half (the path after "The file it carries is:", the stamp fields after "Its
     fields are:", the surfaces after "The stamp is reported by:" and the verdict after "reports the
     verdict:", the last running to "New fields in the stamp are additive", compared with the fields
     the stamped dist/build.json holds AND the fields the built readBuildStamp() normalises to AND one
     fixture per field driven through the built code — TMUX-138),
     item 5b's FOUR lists, each beginning at its own phrase and ending where the next begins
     ("Its top-level keys are:", "A `profiles[]` entry carries:", "The `parents` block carries:",
     "A `redact[]` rule carries:", the last running to "New optional keys are additive"), compared
     with the keys the built package reads off a lexicon config, a profile, the parents block and a
     redact rule AND with one fixture per key driven through the built code — TMUX-137),
     item 6 (root exports up to "and their signatures", split at "; types" into the VALUE half and the
     TYPE half — the members of every declared type compared with the built JS that honours them
     (TMUX-147), and TWO reference closures over comment-stripped dist/**/*.d.ts, one seeded from the
     type half and one from the value half's 33 declarations, a class read to its closing
     brace and a function to its terminating `;`; both transitive, both set-equal with an
     allowlist in BOTH directions, and both filtered by a declaration index that reads interface, type
     AND class heads, so a type reachable only through a class is reached rather than dropped with it
     — TMUX-151) and item 8 (the
     user-options up to "external tooling reads", compared with the names the built package sets and
     reads — TMUX-132). Every one of those cut phrases is matched on whitespace-NORMALIZED item text and
     asserted present, so rewrapping a line cannot move a cut and rewording one of those phrases
     fails the suite loudly instead of silently declaring the prose after it.
     Items 2, 3, 4, 5, 6 and 8 also refuse a name declared twice, and the prose after items 3's, 6's and
     8's cuts must carry NO backticked name: a name there is not a declaration, and the suite fails
     naming it — an export you mean to keep internal is recorded in that test's
     INTERNAL allowlist, and an event type nothing files yet in its RESERVED allowlist, where the
     decisions are visible, never in English here. Item 4 is prose with a list inside it, so it gets
     two structural rules instead: its tmux keys are its one backticked { … } block, and its
     top-level keys are what is left of the half before the cut once that block, the item's own
     bolded subject and every parenthetical are dropped — a parenthetical explains what precedes it,
     so a key belongs in the list, never in the aside. Item 4's per-session half is read as a list of
     its own: the fields between "Each `sessions[]` record carries:" and "all of them on
     every record", compared with the keys the built writer wrote into a REAL session's record. Both
     of those phrases are asserted present as well, and the prose on either side of that list declares
     nothing — `reason`'s meaning stands before it, the null rule after it, and a backticked name
     after it fails the suite naming it, as items 3's, 6's and 8's do.
     Item 5 borrows both of item 4's structural rules for its top-level keys (the bolded subject and
     every parenthetical dropped, so the path it names and the surfaces a `surfaces` entry may name are
     no keys of the file) and reads its ACTION names as a list of its own: the names between
     "the action names are:" and "Tightening the default posture", compared with the list the built
     Policy answers as hiddenActions — the reply an MCP client reads from policy-status, never which
     names assertAllowed() happens to accept, since that is any string once tsc has erased the union.
     Both of those phrases are asserted present too, and the prose after that list must carry NO
     backticked name, as items 3's, 6's and 8's must. A key declared here must also be HONOURED: one
     case per key drives the built Policy on a fixture config and asserts the verdict changes, so a
     name this list gains that the package ignores fails as loudly as one it loses.
     Item 7's home half is a list in the MIDDLE of an item that has a SECOND half after it, so it is
     cut at both ends inside the half before "Shipped layout:", and all four rules the
     parsed items pay for apply: the three markers asserted present on normalized text,
     nonEmpty() + refuseDuplicates(), every parenthetical dropped so an aside declares
     nothing — which is why a re-mention of health.json beside ledgerKeepDays is not a second
     declaration — and NO backticked path between the list's end and "Shipped layout:",
     where a name could mean nothing but a declaration. The home itself is named before
     the list, so the item's subject declares no path in it. policy.json and lexicon.json are
     declared BY REFERENCE: item 7 names the items that own them and the parse reads the
     `~/.tmux-agent/<file>` each of THOSE items backticks, so renaming one there moves item 7's
     declaration with it instead of leaving a path nothing writes. Both authorities are compared, and
     neither may be dropped for the other: the first segments the built package joins onto the home
     (comment-STRIPPED, so a comment quoting a join contributes no path) equal the declaration in both
     directions, and every segment a REAL home the built CLI drove end to end is left holding must be
     declared or TRANSIENT — a static read alone would accept a path the package names but never
     writes, and a dynamic read alone reported item 7 complete while health/ was undeclared.
     Item 7's SHIPPED half joined in TMUX-138 — the first HALF read after the other half of its own item
     already was, and the last unparsed thing in this list. It declares four things, read as three lists
     and a verdict: the file the package carries, that file's fields, the surfaces that report the stamp,
     and the name of the staleness verdict. The four rules apply again — the five markers asserted present
     on normalized text, nonEmpty() + refuseDuplicates() per list, every
     parenthetical dropped, so the writer script in the path's aside declares no field, and
     nothing backticked after the verdict. Two authorities again, and they catch opposite
     drift: the fields the stamped dist/build.json HOLDS catch one the build started writing that this
     half does not declare, and the fields the built readBuildStamp() NORMALISES TO catch one declared
     here that the package would drop — plus one fixture per field driven through the built code, so
     "declared" means "honoured" (the TMUX-135 rule). The REPORTERS are held only to reporting the
     stamp, never to the shape of their replies: /api/* is in the NOT-covered section below, and a
     status reply carries four fields of its own that are no part of the stamp.
     Item 5b is the first item read as FOUR lists, because the file it declares is nested:
     a key of the file, a field of a profile, a field of the parents block and a field of a redact
     rule are four different promises, and `name` belongs to two of the lists — so nonEmpty() and
     refuseDuplicates() run PER LIST, never across them, and a key moved from a list into an aside
     stops being declared. All four rules the parsed items pay for apply: the five marker phrases are
     asserted present on normalized text, every parenthetical inside a list is dropped so an
     aside declares nothing, nothing may be backticked after the last list ends,
     and `profiles[]`/`redact[]` are read as the keys `profiles`/`redact` the package reads, item 4's
     `sessions[]` shape. The item's subject is before the first list, so the path in it declares no key
     — it is what item 7 takes by reference. Both authorities again, and both are needed: the STATIC
     one reads the keys off comment- and string-STRIPPED dist/ per (module, holder), since the holder
     names collide across the package (spec is a SpawnSpec in orchestrator.js, r a rollup in the CLI)
     and a key named in a message is not a read of one; it also asserts that the three modules which
     read a lexicon key are still the only ones that can. The DYNAMIC one drives the built code with
     one fixture per key against a control differing in that key ALONE, so "declared" means "honoured"
     rather than "mentioned" (the TMUX-135 rule), and the built CLI's own `doctor` reply is what proves
     the third module's reads.
     The NOT-covered section below is parsed too, by declaredNotCovered(): its three
     lists, each beginning at its own phrase and ending where the next begins ("The internal module
     paths are:", "The internal root exports are:", "The excluded directories are:", the last
     running to "Nothing in this section is covered by semver"), compared with what the package's
     exports map refuses a consumer outside it, the INTERNAL allowlist of that same test, and the
     file list npm pack ships. All four rules apply there as well — the markers asserted present on
     normalized text, nonEmpty() + refuseDuplicates() per list, every
     parenthetical dropped so the allowlist path in an aside declares no export, and
     nothing backticked after the last list. The prose BEFORE the first marker is where
     the exclusions no list can answer for stay: a wording, the `/api/*` glob (no member of its own
     to resolve, and read by the package's own CLI and MCP surfaces), and the two names item 6
     declares — read as declarations they would make this file call `SessionState` and
     `resolveProfiles` covered AND not covered at once.
     Item 9 joined in TMUX-142, and it is the first item about the surface an operator CONFIGURES the
     tool through rather than one they read: the environment. Read by declaredEnvVars() as TWO lists —
     the covered names and the ones this item reads but explicitly does not cover ("The covered
     variables are:", "The variables it reads but does NOT cover are:", the last running to "New
     variables are additive") — because the split is an author's judgement and a parse that could not
     see it would have to call every read name covered or none of them. Every rule the items before it
     pay for applies: the three markers asserted present on normalized text, nonEmpty() and
     refuseDuplicates() per list AND across the two, so a name in BOTH lists fails,
     every parenthetical dropped so the meaning beside a name declares nothing, and nothing
     backticked after the last list. A name the built package reads and NEITHER list carries
     fails the comparison, which is what makes the split complete rather than a matter of opinion. The
     `$` sigil is normalized away, since item 7 writes the same variable as `$TMUX_AGENT_HOME`; item 1's
     and item 7's own mentions declare nothing at all, being in other items. The live side is every
     `process.env.<NAME>` read of comment-STRIPPED dist/**/*.js — a mention-based authority would be
     satisfied by a comment that quotes this file, and the built package mentions those names 68 times
     while reading 25 — and "declared" means "honoured": one fixture per name drives the built code and
     a control differing in that variable ALONE must answer differently (the TMUX-135 rule).
     Still your part: keep covered names in backticks. -->

1. **CLI verbs and their flags** — `spawn`, `send`, `exec`, `status`, `watch`, `kill`,
   `lineage`, `msg send|recv`, `waste`, `log`, `web`, `doctor`, `calibrate`, `help` (one verb's usage and
   flags, or every verb's — generated from the same tables the refusals speak, exit 0; added 2026-10-13, TMUX-212), and the documented
   global flags (`--socket`, `--default-server`, `--actor`, `--port`, `--host`, `--token`,
   `--no-token`, `--strict-port`, `--dangerously-allow-remote`, `--lexicon`, `--help` (the `help` verb's text, exit 0 — TMUX-212), and `--version`,
   which prints `<version> (<commit>, built <builtAt>)` from the shipped build stamp — TMUX-92).
   Exit codes for
   `exec` (the command's own code), `watch` (0 idle, 2 gone/dead, 3 blocked/error), `spawn` (1 when the session was
   created but its `--cmd` did not land — one stderr line naming the session, which is kept for diagnosis; the
   `session.spawned` row says `commandDelivered: false` — TMUX-207), **64 (EX_USAGE)
   for a bad verb, a verb given too few or too many arguments, a flag the CLI does not declare, a value
   flag with no value, a flag value the verb cannot read — `--since`, `--idle-secs`, `--port` on
   `web` — a `--profile` (`status`, `watch`; added 2026-09-24, TMUX-159) naming a profile the tool does not hold
   (a lexicon profile or a built-in, names exact — refused in ProfileNameError's own words once the lexicon is read,
   before a tmux server is asked or a verdict ledgered; the name, when held, is the one profile the verb judges
   by, else the auto chain), a session name the tool cannot use (`<name>` on `spawn`, `send`, `exec`, `watch`, `kill`, `log`:
   `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), a `--parent` (`spawn`; each name of `doctor`'s list) or an actor
   (`--actor`, else `TMUX_AGENT_ACTOR`) that is not a name by the same rule, a `--socket` (else `TMUX_AGENT_SOCKET`)
   that is not a socket name (`[A-Za-z0-9._-]`, 1 or more — the `-L` name; judged on every verb, `--default-server`
   typed or not), a `--cwd` that is not a directory this user can enter (`spawn`), a `--json` (`status`) or `--out`
   (`calibrate`) FILE the tool cannot write (no such directory, not a directory, is a directory, permission denied —
   judged before the fleet is read or a pane captured; a write that still fails after the judgement is exit 1 in the
   same words), an agent name the mailbox cannot use (msg send / msg recv: the same session-name rule), or a `send`
   text that is empty or whitespace only (nothing to paste — judged before policy and before any tmux call,
   TMUX-206) — each
   refused before anything is touched, the refusal one stderr line naming the source, the value as typed and the rule**,
   and **78 (EX_CONFIG) on any verb for a lexicon the tool cannot use — one named by `--lexicon` or
   `TMUX_AGENT_LEXICON` that cannot be read (not there, a directory, permission denied) or parsed, or one at the
   default path that exists and cannot be read — a directory, a file this user cannot read, or a symbolic link whose
   target is missing, which is refused naming the link and its target — one stderr line naming the source,
   the path as given and the reason, before the verb acts; only a default path with no entry at all is silently the
   shipped vocabulary**, and **78 for a policy
   file the tool cannot use — one named by `TMUX_AGENT_POLICY` that cannot be read, or the default `policy.json`
   under the home present and unreadable (a directory, a file this user cannot read, or a symbolic link whose target is
   missing — TMUX-226), or either not valid for item 5's schema — `policy config error:`, one stderr line
   naming the path and the reason, before the verb acts and before `web` binds; only a default path with no entry at all
   is silently permissive** — a supervising
   script branches on those to tell an operator error from a tool fault. The MCP server refuses to start under a
   `TMUX_AGENT_ACTOR` the same rule rejects, under a `TMUX_AGENT_SOCKET` that is not a socket name, under a
   lexicon it cannot read or parse, and under a policy file it cannot use: exit 78, one stderr line naming the
   source, the value as typed and the rule or reason, before `initialize` is answered.
2. **MCP tool names and input schemas** — `spawn-session`, `send-input`, `exec-sync`,
   `capture-pane`, `session-status`, `fleet-status`, `kill-session`, `list-lineage`,
   `message-send`, `message-receive`, `waste-report`, `read-log`, `policy-status`. Removing a
   tool, renaming it, or making an optional argument required is breaking. `policy-status` is
   never hidden by policy: it is how a client learns *why* other tools are absent.
   Arguments are additive the same way: session-status takes an optional `profile` and fleet-status the same
   key (added 2026-09-24, TMUX-159) — the name of a profile this server holds (a lexicon profile or a built-in,
   exact), by which the reply's classifiedBy is decided instead of by the auto chain; an unknown name is an
   isError reply carrying ProfileNameError's message, never the auto verdict, and the key absent is the chain as
   before. Result fields are additive: fleet-status answers statusFile, sessions[] and the tmux block item 4
   describes (the listing's own verdict on the server it listed; added 2026-09-16, TMUX-116), and
   session-status answers the snapshot fields item 4 describes, reason among them — why a session is
   GONE, in tmux's own words when the server itself did not answer, else null (added 2026-09-16,
   TMUX-117). Result *content* is additive the same way, and the FIRST block is the value: a tool may
   add a further text block after it, never change that one. message-receive answers its JSON array of
   messages in content[0] as it always has, and a read of a name nothing has ever been sent to carries
   one note block after it, naming the agent as typed — the CLI's own words for that read, from the one
   wording both surfaces print (added 2026-09-18, TMUX-125); a known agent's merely-empty inbox carries
   none. A client that reads only content[0] sees no change at all.
3. **Event ledger format** — the `v` field, the meaning of `session` / `parent` / `actor` / `ts`,
   and every event `type` the ledger files: `session.spawned`, `session.adopted` (reserved),
   `session.killed`, `session.state` (a *sustained* classification change: the fleet poll's CPU
   verdict carries hysteresis, so a single 30 s sample never produces one — fewer events,
   same shape), `session.meta`, `fleet.tmux` (tmux-server reachability transitions, added this way
   in TMUX-87), `input.sent`, `input.verified`, `exec.done`, `exec.timeout`, `message.sent`,
   `message.received`, `trigger.fired` (reserved), `notify.sent`, `capture.rotated`,
   `capture.stalled`, `control.denied`, `health.warning`, `health.critical`, `health.recovered`,
   `health.prediction` (reserved), `host.crash-suspected`, `ledger.archived` (a retention sweep
   moved day files into `ledger/archive/`, TMUX-90 — added the same way). A type marked *(reserved)*
   is covered by this list but filed by nothing the package ships yet; what would file each is
   recorded in the RESERVED allowlist of `test/versioning-contract.test.js`, where the decision is
   visible, and the suite fails if a reserved type starts being filed, or if an unmarked one is
   filed by nothing.
   New event types and new `data` keys are *additive* (minor).
   Removing a type, or changing the semantics of an existing one, is breaking.
   Consumers should ignore unknown types and unknown `data` keys.
4. **`status.json` shape** — top-level `v`, `generatedAt`, `sessions[]`, `tmux`
   (`{ reachable, since, error, checkedAt }` — the verdict of the listing that produced `sessions`,
   tmux's own words in `error` when unreachable; added 2026-09-16, TMUX-116) and the documented
   per-session fields — including `reason`, why a session is `GONE`: tmux's own words when the server
   itself did not answer, `null` on every other state and on a `GONE` the server answered for (added
   2026-09-16, TMUX-117; the same field on the `session-status` reply and inside `/api/session`).
   Each `sessions[]` record carries: `session`, `state`, `at`, `lastLine`, `classifiedBy`,
   `contextPct`, `logBytes`, `rssBytes`, `cpuPerSec`, `reason`, `parent`, `task`, `owner`, `meta`
   — all of them on every record, a null where the value is unknown or the host did not answer rather
   than an absent key, so a collector reads one shape (written down 2026-09-19, TMUX-134).
   Additive fields are minor.
5. **Policy file schema** (`~/.tmux-agent/policy.json`): the top-level keys `readOnly`, `allow`, `deny`,
   `surfaces` — the last of the four scopes the other three to a single surface (`web`, `mcp`, `cli`), which
   is the documented fix for THREAT-MODEL finding 6 and the key the tool's own refusal text tells an operator
   to set, so it is covered here like the other three (written down 2026-09-19, TMUX-135). An allow- or
   deny-list is keyed by action; the actions a read-only surface hides are what `policy-status` answers as
   hiddenActions, and the action names are: `spawn`, `send`, `exec`, `kill`, `adopt`. Tightening the default
   posture, or ceasing to honour a documented key, is breaking. A file that exists and cannot be read, a
   TMUX_AGENT_POLICY path that cannot be read, or a file that is not this schema (not JSON, not an object, a readOnly
   that is not a boolean, a key, surface or action the schema does not know, an allow or deny entry that is not an
   array of strings) is refused at load rather than treated as absent, which is item 1's exit 78; only the
   absent default path is silently the permissive default.
5b. **Lexicon file schema** (`~/.tmux-agent/lexicon.json`) — the vocabulary an operator writes to
   teach the tool a fleet we have never seen, so every key it honours is written down here in full
   rather than left to the interfaces. Its top-level keys are: `version`, `profiles[]`,
   `replaceProfiles`, `parents`, `redact[]` — a version this build does not understand is refused at
   load rather than ignored, which is item 1's exit 78, and the three structured keys are written out
   one field at a time below. A `profiles[]` entry carries: `name`, `error`, `blocked`, `working`,
   `idle`, `contextPct`, `contextPctInverted` — the four state keys are arrays of regex strings tried
   against the live pane tail, and the last inverts a CLI that reports context REMAINING rather than
   used. The `parents` block carries: `nonSession`, `nonSessionPattern`, `replace` — which non-tmux
   supervisors are legitimate here, merged with the built-in names unless the last is true. A
   `redact[]` rule carries: `name`, `pattern`, `replacement`, `flags` — global matching is forced on
   whatever the last of those asks for, since a rule that scrubs only the first occurrence leaks the
   rest, and the first is the name the refusal for a bad rule is reported under (written down
   2026-09-20, TMUX-137). New optional keys are additive (minor). **Ceasing to honour a documented
   key, or making user rules non-additive for redaction, is breaking** — the additive guarantee is a
   security property people rely on, not an implementation detail. Note that *built-in* profile
   regexes are explicitly NOT covered (below): they track upstream CLIs.
6. **Exported TypeScript API** from the package root — values `Tmux`, `TmuxError`,
   `sessionTarget`, `paneTarget`, `Ledger`, `LedgerIndex`, `Orchestrator`, `Policy`, `Monitor`,
   `ActivityTracker`, `resolveProfiles`, `profileFromLexicon`, `loadLexicon`, `validateLexicon`, `LexiconError`,
   `calibrate`, `CaptureWatchdog`, `redact`, `configureRedaction`, `configureEngagement`,
   `Mailbox`, `SlackWebhookSink`, `ConsoleSink`, `publishStatus`, `wasteReport`, and the eight error
   classes those values throw at a caller — `AgentNameError`, `CwdError`, `OutPathError`,
   `PolicyDenied`, `ProfileNameError`, `SessionNameError`, `SinceError`, `SocketNameError` (the class is
   the stable handle a consumer catches on; the wording of its message is not covered, see below); types
   `LedgerEvent`, `EventType`, `SpawnSpec`, `AgentProfile`, `SessionState`, `Snapshot`,
   `ActivityThresholds`, `CpuSample`,
   `LexiconConfig`, `LexiconProfile`, `LexiconRedactRule`, `LexiconParents`, `CalibrationReport`,
   `CalibrateInput`, `Evidence`, `ParentProposal`, `PromptProposal`, `SecretShapeProposal`,
   `WatchdogOpts`, `NotifySink`, `SessionRollup`, `SessionMeta`, `TmuxOpts`, `TmuxStatus`,
   `Message`, `SweepResult`, `LedgerRetention`, `PolicyConfig`, `SurfaceRules`, `Action`,
   `Surface`, `DenialReason`, `WasteRow` — and their signatures. Every
   other root export is explicitly marked internal in the contract test (today: the four
   built-in profile objects, see below), so a new export forces a declared decision.
   The SlackWebhookSink constructor's third argument, the bound in milliseconds on one send (10 s when not
   given), was added in TMUX-157 as an additive change — a new optional parameter on a covered signature is minor.
7. **On-disk layout** under `$TMUX_AGENT_HOME` — the shape a backup script, a log collector and
   crash forensics read, so it is written down here in full rather than left to the code. A path the
   tool writes and removes inside a single verb is no part of it; each of those is recorded in the
   TRANSIENT allowlist of `test/versioning-contract.test.js`, where the decision is visible, never in
   English here. Under the home: `logs/<session>.log` (size-rotated at `TMUX_AGENT_LOG_MAX_BYTES`,
   default 64 MiB, keep 3, so numbered generations stand beside it and a `capture.rotated` event is
   filed — item 3), `ledger/events-*.ndjson`
   (live days), `ledger/archive/events-*.ndjson.gz` (days older than `ledgerKeepDays`, default 30,
   gzip-archived and never deleted unless `ledgerDeleteAfterDays` is set in `health.json` —
   TMUX-90), `mailbox/<agent>/inbox`, `web-token`, `status.json`, `health.json` (the daemon's own
   thresholds and retention knobs), `health/heartbeat`, `health/snapshots.ndjson` (size-rotated,
   keep 2, so numbered generations stand beside it), `health/clean-shutdown`,
   `health/crash-last.json` (the health directory is created mode 0700 by the dashboard daemon and is
   where crash forensics live, so a patch release may neither move nor rename it — TMUX-136) — that
   is the whole of the layout, and two further files sit in the same home declared by the items that
   own them, which this list takes by reference rather than repeating: items 5 and 5b. Adding a path
   is additive (minor); moving, renaming or removing one is breaking. **Shipped layout:** the package
   carries a build stamp, and four things about it are covered. The file it carries is:
   `dist/build.json` (written by `npm run build` after tsc — TMUX-92; `dist` ships wholesale, so the
   stamp travels with the code it describes). Its fields are: `version`, `commit`, `builtAt`. The
   stamp is reported by: `--version`, `doctor` and `/api/health.build` — that each of those surfaces
   reports it is covered, the shape of a reply is not (the dashboard's HTTP API is in the NOT-covered
   list below, and a status reply carries fields of its own). A daemon whose on-disk stamp has moved
   under it reports the verdict: `stale`. New fields in the stamp are additive (minor); moving,
   renaming or removing one, or a surface here ceasing to report the stamp, is breaking.
8. **tmux session user-options** used for lineage: `@agent_parent`, `@agent_owner`,
   `@agent_task` — external tooling reads these.
9. **Environment variables** — the surface an operator configures a run through when a flag will not
   do (a unit file, a cron line, a shell profile), so every name the package reads out of its own
   environment is written down here rather than left to the code that reads it. The covered variables
   are: `TMUX_AGENT_HOME` (the home every path in item 7 sits under — `~/.tmux-agent` unless it is
   set), `TMUX_AGENT_SOCKET` (the `-L` server name every verb drives — `--socket`'s fallback),
   `TMUX_AGENT_DEFAULT_SERVER` (`1` puts every verb on tmux's default server instead —
   `--default-server`'s fallback), `TMUX_AGENT_ACTOR` (who the ledger records as having acted —
   `--actor`'s fallback, `cli` when neither is given), `TMUX_AGENT_LEXICON` (the lexicon file item 5b
   declares — `--lexicon`'s fallback), `TMUX_AGENT_POLICY` (where the policy file item 5 declares is
   read from — the file that decides which actions are refused), `TMUX_AGENT_SLACK_WEBHOOK` (the
   webhook an alert is POSTed to; unset is the console sink), `TMUX_AGENT_PUBLIC_HINT` (the sentence the
   dashboard's access note shows in place of its loopback `ssh -L` one when something else serves the page —
   a harness proxy — HTML-escaped and verbatim, and what the startup banner prints as `public:`),
   `TMUX_AGENT_PUBLIC_URL` (where the dashboard is served, used when no hint is set: "This UI is served at
   <url>"; neither variable moves the bind, which stays 127.0.0.1) and `TMUX_AGENT_LOG_MAX_BYTES` (the size
   a capture log is rotated at, default 64 MiB — item 7's rotation bound). An operator's unit files
   and scripts set these, so renaming one, ceasing to read one, or changing what a value means is
   breaking. The variables it reads but does NOT cover are: `TMUX_AGENT_HEALTH_TICK_MS` (how often the
   dashboard daemon takes a health snapshot, default 30 s and floored at 1 s),
   `TMUX_AGENT_WATCHDOG_GRACE_MS` (how long a fresh pipe has to produce its first flush before a
   static log counts against it, default 10 s) and `TMUX_AGENT_WATCHDOG_MAX_REARMS` (how many times a
   stalled capture is re-armed before the watchdog gives up, default 3) — internal cadence, which our
   own suites drive and a patch release may retune. New variables are additive (minor). A name this
   item puts in neither list, or in both, fails the suite rather than being covered by opinion.

## NOT covered (may change any time)

Anything the covered list above does not name is internal. Three of these exclusions answer to a
live authority of their own — the package's own `exports` map, the root barrel, and the published
tarball — so they are written down here as lists and parsed as data beside the covered items
(written down 2026-09-20, TMUX-139). The rest of the section stays prose, because nothing can
answer for a wording:

- Log/pane text formatting, dashboard HTML/CSS, and the wording of human-readable messages.
- The HTTP API of the web dashboard (`/api/*`). It exists to serve our own bundled UI — which is
  why the package's own CLI and MCP surfaces read it themselves — so treat it as private and use
  the CLI or MCP surface for automation. It is a glob with no member of its own to resolve, so no
  list below names it.
- Agent-profile regexes and classification heuristics: they track upstream CLI changes and will be
  adjusted in patch releases. Depend on the `SessionState` *values*, not on how a given pane is
  classified, and reach the built-in profiles through `resolveProfiles()` — both of those names are
  declared by item 6 above and stand here as pointers, not as exclusions.

The internal module paths are: `dist/*` — a deep import of any module inside the built tree, which
the exports map refuses by defining the package root and nothing else; use the root. (That the
package *carries* a file under `dist/` is a separate promise: item 7's shipped half declares the
build stamp.) The internal root exports are: `claudeCodeProfile`, `codexProfile`, `aiderProfile`,
`genericShellProfile` — the four built-in profile objects reachable from the package root, whose
regexes are the patch-release churn the bullet above describes (the decision to keep each one
internal is recorded beside its name in the INTERNAL allowlist of
`test/versioning-contract.test.js`, and this list is checked against that allowlist both ways).
The excluded directories are: `scratch/` — working files, which the published
package does not carry. Nothing in this section is covered by semver: moving a name out of one of
those three lists into the covered items above is additive (minor), and the reverse is breaking.

## Node and tmux support

- **Node:** current, active, and maintenance LTS — tested in CI: 20, 22, 24, 26 (ubuntu + macOS).
  Dropping an EOL major is a **breaking** change and will land in a major release (node 18 was
  dropped pre-1.0 for this reason).
- **tmux:** >= 3.2. The claimed minimum (3.2a) and 3.4 are built from source and smoke-tested
  on every push (CI `tmux-versions` job); the distro jobs cover apt's 3.4 and brew's latest.
  Requiring a newer minimum is breaking.
- **Platforms:** Linux and macOS, both exercised in CI. Windows is out of scope (no native tmux).

## Deprecation policy

A covered item slated for removal is: (1) documented as deprecated in `CHANGELOG.md`,
(2) kept working for at least one minor release, emitting a warning to stderr when used, and
(3) removed only in the next major.

## Pre-1.0 note

While on `0.x`, minor versions may contain breaking changes — but they will still be listed in
`CHANGELOG.md` under a "Breaking" heading. `1.0.0` is the point at which the list above becomes
a promise rather than a description.
