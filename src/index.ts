export { Tmux, TmuxError, sessionTarget, paneTarget } from "./core/tmux.js";
// The two refusals the driver throws at a consumer — `new Tmux({ socket })` judges its socket name and
// sessionTarget()/paneTarget() their session name, each before any server is asked — were nameable from the
// root by nobody until they were exported here. The product's own instanceof sites reach them through `../core/tmux.js`, a
// path the exports map refuses to a consumer, so the only handle a library caller had was err.message, whose
// wording is NOT covered. The class is the stable handle; the message may still change.
export { SessionNameError, SocketNameError } from "./core/tmux.js";
// TmuxOpts is what `new Tmux({…})` takes — the first thing an embedder driving the library writes, and
// nameable from the root by nobody until the type closure of item 6's VALUE half was exported. Its four
// members decide which tmux server the fleet lands on, so a consumer building that object by hand had no
// annotation to catch a typo in `socketPath`.
export type { TmuxOpts } from "./core/tmux.js";
export { Ledger } from "./core/ledger.js";
export type { LedgerEvent, EventType } from "./core/ledger.js";
// The retention surface of Ledger: what `sweep()` reports it moved and the two-key window it honours.
// A supervising script that acts on the sweep's result received both through covered signatures and
// could annotate neither.
export type { LedgerRetention, SweepResult } from "./core/ledger-retention.js";
// Incremental reader of the ledger format VERSIONING item 3 covers. An embedder consuming the
// ledger (their own dashboard, a supervisor) would otherwise re-parse every .ndjson per poll —
// the exact cost this class exists to remove. VERSIONING item 6 had promised it since
// 2026-08-25 without it ever being exported.
export { LedgerIndex } from "./analytics/ledger-index.js";
export type { SessionRollup, SessionMeta } from "./analytics/ledger-index.js";
export { Orchestrator } from "./core/orchestrator.js";
// What `Orchestrator.spawn()` throws for a directory the session cannot be born in.
export { CwdError } from "./core/orchestrator.js";
export type { SpawnSpec } from "./core/orchestrator.js";
export { Policy } from "./core/policy.js";
// Policy's whole signature surface: what `new Policy(cfg, surface)` takes, the per-surface rules beneath
// it, and the two string unions both speak. `Action` and `Surface` are the vocabulary an embedder must
// write to build an allow- or deny-list at all — item 5 declares the same five action names and the same
// three surfaces, and until they were exported here neither was nameable from the root.
export type { PolicyConfig, SurfaceRules, Action, Surface } from "./core/policy.js";
// What `Policy.assertAllowed()` throws, and the one field it carries: `reason` is WHICH of the three rules said
// no — the value the orchestrator ledgers a refusal under — so a consumer discriminating on it needs the union's
// name as much as the class's. The three literals are held to the ones the built policy.js constructs
// the class with, in test/versioning-contract.test.js.
export { PolicyDenied } from "./core/policy.js";
export type { DenialReason } from "./core/policy.js";
export { Monitor, claudeCodeProfile, codexProfile, aiderProfile, genericShellProfile, resolveProfiles, profileFromLexicon } from "./core/monitor.js";
// What `Monitor.snapshot(session, profileName)` — and fleet(), fleetReport(), fleetFast({ profileName }) through it —
// throws for a profile name this Monitor does not hold; before ProfileNameError existed an unknown name silently fell back to the
// auto chain. The eighth error class of VERSIONING.md item 6, root-exported for the same reason as the classes above.
export { ProfileNameError } from "./core/monitor.js";
export type { AgentProfile, SessionState, Snapshot } from "./core/monitor.js";
// `Monitor.activity` is a documented test seam (src/core/monitor.ts: "Public so a test can substitute a
// tracker with scripted samples"), so substituting a tracker is supported — and until these exports a consumer
// doing it could name none of the three types involved: not the class, not the `thresholds` its
// constructor takes, not the `sample` reading it accepts. The class was invisible to the closure's
// declaration index, which took the two interfaces behind it down with it.
export { ActivityTracker } from "./core/activity.js";
export type { ActivityThresholds, CpuSample } from "./core/activity.js";
// What `Monitor.tmuxStatus()` hands back — the reachability of the tmux server, which is the one thing a
// supervisor polls before trusting any other reading.
export type { TmuxStatus } from "./core/monitor.js";
// Per-fleet vocabulary (docs/AGNOSTIC-DESIGN.md). Exported because an embedder driving the
// library directly — not via the CLI — must be able to honour the operator's lexicon too;
// otherwise their fleet is classified with our vocabulary and redacted with our patterns.
export { loadLexicon, validateLexicon, LexiconError } from "./core/lexicon.js";
export type { LexiconConfig, LexiconProfile, LexiconRedactRule } from "./core/lexicon.js";
// LexiconParents is the type of `LexiconConfig.parents` — the key an adopter writes BY HAND
// (docs/AGNOSTIC-DESIGN.md §1). It was reachable from a covered signature and nameable from the root
// by nobody, so an embedder building that object had no annotation to write.
export type { LexiconParents } from "./core/lexicon.js";
export { calibrate } from "./core/calibrate.js";
export type { CalibrationReport, CalibrateInput } from "./core/calibrate.js";
// The three proposal types are what `calibrate()`'s report hands back, and Evidence is what each of
// them carries — 16 members a consumer received through a covered signature and could not annotate
// until they were exported here. Additive: types only, so the emitted JS is unchanged.
export type { Evidence, ParentProposal, PromptProposal, SecretShapeProposal } from "./core/calibrate.js";
export { CaptureWatchdog } from "./core/watchdog.js";
export type { WatchdogOpts } from "./core/watchdog.js";
export { redact, configureRedaction } from "./core/redact.js";
export { configureEngagement } from "./core/engagement.js";
export { Mailbox } from "./adapters/messaging/mailbox.js";
// What `Mailbox.send()` throws for a <from> or <to> that is not an agent name.
export { AgentNameError } from "./adapters/messaging/mailbox.js";
// Every message the Mailbox hands back carries these six fields; a consumer reading an agent's inbox
// received them through a covered signature and could not annotate the row.
export type { Message } from "./adapters/messaging/mailbox.js";
export { SlackWebhookSink, ConsoleSink } from "./adapters/notify/slack.js";
export type { NotifySink } from "./adapters/notify/slack.js";
export { publishStatus, wasteReport } from "./analytics/status.js";
// What `publishStatus()` throws for a FILE it cannot write, and `wasteReport()` for a `since` it cannot read.
export { OutPathError, SinceError } from "./analytics/status.js";
// The analytics row `wasteReport()` returns — eight members a supervising script reads out of it. The one
// type of the ten added in the same change that a HEAD-ONLY read of item 6's value half could already reach,
// because this function's declaration fits on one line.
export type { WasteRow } from "./analytics/status.js";
