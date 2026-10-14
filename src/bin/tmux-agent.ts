#!/usr/bin/env node
/**
 * tmux-agent CLI — same verbs as the MCP server, for humans and shell scripts.
 *
 *   tmux-agent spawn <name> --cwd DIR [--cmd "..."] [--parent WHO] [--task T]
 *   tmux-agent send <name> "text" [--no-enter]
 *   tmux-agent exec <name> "command"            # sync, prints output, exits with its code
 *   tmux-agent status [--json FILE] [--profile NAME]      # fleet snapshot + publish status.json (FILE, if given, judged before the fleet is read); a dead or absent tmux server: one stderr line, tmux.reachable false in the file, exit 0
 *   tmux-agent watch <name> [--idle-secs N] [--profile NAME]  # block until state change / idle (N whole seconds, 1 or more; default 30); NAME judges the pane by that one profile (else the auto chain)
 *   tmux-agent kill <name> [--force]
 *   tmux-agent lineage                          # parent→child tree; a dead or absent tmux server: one stderr line, rows and exit 0 unchanged
 *   tmux-agent msg send <from> <to> <subject> [body...]
 *   tmux-agent msg recv <agent>
 *   tmux-agent waste [--since ISO]
 *   tmux-agent log <name>                       # print capture log path
 *   tmux-agent doctor [--port 7337] [--parent WHO,...]  # vocabulary in effect + the dashboard on this host (its build; its tmux server)
 *   tmux-agent calibrate [--out FILE]           # PROPOSE a lexicon from the live fleet: stdout, or FILE at 0600 (judged before a pane is captured)
 *   tmux-agent web [--port 7337] [--host 127.0.0.1]   # loopback dashboard (ssh -L to view)
 *   tmux-agent help [verb]                      # every verb's usage, or one verb's flags in the refusals' words — exit 0 (--help too)
 * Global: --socket NAME (the -L name: [A-Za-z0-9._-], 1 or more) | --default-server | --actor WHO | --lexicon FILE | --version
 *         (env parity with MCP: TMUX_AGENT_SOCKET, TMUX_AGENT_DEFAULT_SERVER=1, TMUX_AGENT_ACTOR;
 *          TMUX_AGENT_HEALTH_TICK_MS sets the dashboard's health-tick cadence, default 30 s)
 * Exit 64 (EX_USAGE): a bad verb, a verb given too few or too many arguments, a flag the CLI does not declare,
 *         a value flag with no value, a flag value the verb cannot read (--since, --idle-secs, --port), a --profile
 *         (status, watch) naming a profile this Monitor does not hold (the lexicon's, then the built-ins; names exact —
 *         judged once the lexicon is read, before a tmux server is asked or a verdict ledgered), a session
 *         name the tool cannot use (<name> on spawn, send, exec, watch, kill, log: alnum start, [A-Za-z0-9._-],
 *         <=64), a --parent (spawn; each name of doctor's list) or an actor (--actor, else TMUX_AGENT_ACTOR) that
 *         is not a name by the same rule, a --socket (else TMUX_AGENT_SOCKET) that is not a socket name
 *         ([A-Za-z0-9._-], 1 or more — on every verb, --default-server typed or not), a --cwd that is not a
 *         directory this user can enter (spawn), a --json (status) or --out (calibrate) FILE the tool cannot write
 *         (no such directory, not a directory, is a directory, permission denied — judged before the fleet is read or
 *         a pane captured; a write that still fails is exit 1 in the same words), an agent name the mailbox cannot
 *         use (msg send|recv: the same rule), or a `send` text that is empty or whitespace only (nothing to paste;
 *         judged before policy and before any tmux call) — each refused before anything is touched
 * Exit 78 (EX_CONFIG): a lexicon the tool cannot use — named by --lexicon or TMUX_AGENT_LEXICON and not readable (no such
 *         file, a directory, permission denied) or not valid, or the default $TMUX_AGENT_HOME/lexicon.json present but
 *         unreadable — one stderr line naming the source, the path as given and the reason, before any verb acts; only
 *         the ABSENT default is silently the shipped vocabulary. The policy file by the same rule: one named
 *         by TMUX_AGENT_POLICY and not readable, or the default $TMUX_AGENT_HOME/policy.json present but unreadable, or
 *         either not valid for the schema (not JSON, not an object, a readOnly that is not a boolean, a key, surface or
 *         action the schema does not know, an allow/deny entry that is not an array of strings) — `policy config error:`,
 *         one line, before any verb acts and before `web` binds; only the ABSENT default is silently permissive
 * Exit 75 (EX_TEMPFAIL) / 71 (EX_OSERR): web — the dashboard socket did not bind: one stderr line, no banner. 75 when the
 *         port is in use under --strict-port (the default scans forward from the requested port over EADDRINUSE — and
 *         only EADDRINUSE — printing `port A busy — using B`, and exits 1 with `no free port in A..B` once twenty in a row
 *         are in use); 71 for any other listen() failure — EACCES on a privileged port, EADDRNOTAVAIL on a --host not on
 *         this machine — naming the code, host and port, with or without --strict-port: the finder
 *         stops at the first such error instead of burning twenty probes and blaming port pressure
 */
import { once } from "node:events";
import { statSync } from "node:fs";
import { join } from "node:path";
import { Tmux, assertName, SessionNameError, assertSocketName, SocketNameError, socketLabel, serverGoneNote } from "../core/tmux.js";
import { Ledger } from "../core/ledger.js";
import { Policy, PolicyError } from "../core/policy.js";
import { Orchestrator, assertCwd, CwdError, EmptyTextError } from "../core/orchestrator.js";
import { Monitor, resolveProfiles, assertProfileName, ProfileNameError, type AgentProfile } from "../core/monitor.js";
import { CaptureWatchdog } from "../core/watchdog.js";
import { loadLexicon, LexiconError } from "../core/lexicon.js";
import { configureRedaction, extraRedactionRuleCount, redact } from "../core/redact.js";
import { configureEngagement } from "../core/engagement.js";
import { Mailbox, AgentNameError, assertAgentName, mailboxFootprint, malformedNote, unknownAgentNote } from "../adapters/messaging/mailbox.js";
import { ConsoleSink, SlackWebhookSink } from "../adapters/notify/slack.js";
import { loadThresholds, retentionFromThresholds } from "../core/healthwatch.js";
import { ledgerFootprint } from "../core/ledger-retention.js";
import { formatBuild, runningBuild } from "../core/build.js";
import { probeDashboard, DEFAULT_WEB_PORT } from "../core/dashboard-probe.js";
import { publishStatus, wasteReport, latestSessionMeta, metaDecayNote, SinceError, SINCE_FORM, assertOutPath, OutPathError, writeOutPath, archivedDaysInWindow, archivedWindowNote } from "../analytics/status.js";

const VALUE_FLAGS = new Set(["socket", "actor", "cwd", "cmd", "parent", "task", "json", "idle-secs", "since", "port", "host", "token", "lexicon", "out", "profile"]);
const BOOL_FLAGS = new Set(["default-server", "no-enter", "force", "dangerously-allow-remote", "strict-port", "no-token", "version", "help"]);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
/** positional args = argv minus flags (+ their values), regardless of ordering */
function positionals(): string[] {
  const out: string[] = [];
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) {
      const bare = a[i].slice(2);
      if (VALUE_FLAGS.has(bare)) i++; // skip its value
      else if (!BOOL_FLAGS.has(bare)) i++; // undeclared: judgeFlags() refuses it before any verb runs; only --help gets past, to the usage line
      continue;
    }
    out.push(a[i]);
  }
  return out;
}

/** The accepted shape of a whole-number flag: its bounds, and the form the refusal names. */
interface IntFlagSpec {
  min: number;
  max: number;
  form: string;
}
const IDLE_SECS: IntFlagSpec = { min: 1, max: Number.MAX_SAFE_INTEGER, form: "a whole number of seconds (1 or more) such as 60" };
const PORT: IntFlagSpec = { min: 1, max: 65535, form: "a port between 1 and 65535" };
/** What each value flag takes, in the words its refusal uses when the value is missing. */
const VALUE_FORMS: Partial<Record<string, string>> = {
  socket: "a tmux socket name (the -L name)",
  actor: "a name for the caller, such as boss (alnum start, [A-Za-z0-9._-], <=64)",
  cwd: "a directory",
  cmd: "a command line",
  parent: "a session name (alnum start, [A-Za-z0-9._-], <=64; doctor: names separated by commas)",
  task: "a few words",
  json: "a file path",
  "idle-secs": IDLE_SECS.form,
  since: SINCE_FORM,
  port: PORT.form,
  host: "a host address, such as 127.0.0.1",
  token: "the dashboard token",
  lexicon: "a lexicon.json path",
  out: "a file path for the draft",
  profile: "a profile name this Monitor holds (a lexicon profile, or claude-code, codex, aider, generic-shell)",
};

/** A flag, a flag value, a positional count or an agent name the verb cannot use: exit 64 (EX_USAGE) with this one line — never a stack trace, never silence. */
class FlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlagError";
  }
}

/**
 * The one reading of a whole-number flag, for `watch --idle-secs` and `web --port` alike, so the two
 * cannot drift. `Number()` returns NaN for anything it cannot read and every comparison with NaN is
 * false — so until 2026-09-14 (measured on earlier builds) `watch --idle-secs 3O` could never
 * take the idle exit the README promises: it blocked for ever, printed nothing, notified nobody —
 * a typo in a cron job was a watcher that never woke; an empty value was 0 and fired at once as
 * "idle 0s"; and `web --port abc` died with Node's own `options.port should be >= 0 and < 65536`,
 * the flag unnamed. An absent flag is the verb's default. Anything else is a whole number inside the
 * range, or refused — the flag as the last argument, an empty value, a unit suffix, a fraction, a
 * negative, out of range — with the flag, the value and the accepted form in one line. Digits only:
 * "1e3" is not how anyone types seconds, and a value that is not obviously a number is a typo.
 */
function intFlag(name: string, fallback: number, spec: IntFlagSpec): number {
  if (!has(name)) return fallback;
  const raw = flag(name) ?? "";
  if (raw.trim() === "") throw new FlagError(`--${name}: no value given — give ${spec.form}`);
  const n = /^-?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n)) throw new FlagError(`--${name}: cannot read ${JSON.stringify(raw)} — give ${spec.form}`);
  if (n < spec.min || n > spec.max) throw new FlagError(`--${name}: cannot use ${JSON.stringify(raw)} — give ${spec.form}`);
  return n;
}

/**
 * The nearest declared flag to a typo, within two edits, or none: a hint in the refusal, never a
 * guess acted on. Plain Levenshtein over the two declared sets — `--jsn` → --json, `--prent` →
 * --parent, `--idle-sec` → --idle-secs, `--no-entr` → --no-enter; `--bogus-flag-xyz` → nothing.
 */
function nearestFlag(typed: string): string | undefined {
  const distance = (a: string, b: string): number => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  let best: { name: string; d: number } | undefined;
  for (const name of [...VALUE_FLAGS, ...BOOL_FLAGS]) {
    const d = distance(typed, name);
    if (d <= 2 && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}

/**
 * The one judgement of every `--x` in argv against the declared sets, before any verb runs.
 * Until 2026-09-14 (measured on earlier builds) positionals() took a flag in neither set for one
 * that takes a value and skipped the argument after it, and flag()/has() read argv by exact name — so
 * a mistyped flag was never refused: `send … --no-entr` pressed Enter, `spawn … --prent me` recorded
 * parent=cli, `watch … --idle-sec 2` swallowed the 2 and blocked on the 30 s default in silence,
 * `status --jsn FILE` wrote no file and exited 0, and `send --no-entr X "text"` refused the text as a
 * session name with the typo unnamed. An undeclared flag is refused naming it as typed, with the
 * nearest declared name when one is close. A declared value flag as the last argument, or with an
 * empty value, is refused naming the flag and what it takes — intFlag's rule for two flags, on every
 * value flag (`--since` in parseSince's own words). The argument after a declared value flag is its
 * value whatever it looks like — unchanged, so `--json --jsn` names a file. `--help` is left to the
 * usage line below (exit 64; there is no separate help text yet).
 */
function judgeFlags(argv: string[]): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const bare = arg.slice(2);
    if (VALUE_FLAGS.has(bare)) {
      const value = argv[++i];
      if (value === undefined || value.trim() === "") throw new FlagError(`${arg}: no value given — give ${VALUE_FORMS[bare] ?? "a value"}`);
      continue;
    }
    if (BOOL_FLAGS.has(bare) || bare === "help") continue;
    const near = nearestFlag(bare);
    throw new FlagError(near ? `${arg}: unknown flag — did you mean --${near}?` : `${arg}: unknown flag (see the usage line: tmux-agent --help)`);
  }
}

/**
 * Each verb's positional shape, in the header's own words: the arguments it needs, in order;
 * whether more may follow; the flags the header shows after them. Every refusal below is built from this
 * table, and test/positional-count.test.js checks each built usage against the header above, so the two
 * cannot drift. `msg` is two verbs here ("msg send", "msg recv"); `msg` alone keeps the usage line.
 */
interface Shape {
  args: string[];
  more?: string;
  flags?: string;
}
const SHAPES: Record<string, Shape> = {
  spawn: { args: ["<name>"], flags: '--cwd DIR [--cmd "..."] [--parent WHO] [--task T]' },
  send: { args: ["<name>", '"text"'], flags: "[--no-enter]" },
  exec: { args: ["<name>", '"command"'] },
  status: { args: [], flags: "[--json FILE] [--profile NAME]" },
  watch: { args: ["<name>"], flags: "[--idle-secs N] [--profile NAME]" },
  kill: { args: ["<name>"], flags: "[--force]" },
  lineage: { args: [] },
  "msg send": { args: ["<from>", "<to>", "<subject>"], more: "[body...]" },
  "msg recv": { args: ["<agent>"] },
  waste: { args: [], flags: "[--since ISO]" },
  log: { args: ["<name>"] },
  doctor: { args: [], flags: "[--port 7337] [--parent WHO,...]" },
  calibrate: { args: [], flags: "[--out FILE]" },
  web: { args: [], flags: "[--port 7337] [--host 127.0.0.1]" },
  help: { args: [], more: "[verb]" },
};
/** What the boolean flags do, one line each — the words `help` prints beside VALUE_FORMS'. */
const BOOL_FORMS: Record<string, string> = {
  "default-server": "drive tmux's default server instead of the tool's own -L socket (env: TMUX_AGENT_DEFAULT_SERVER=1)",
  "no-enter": "paste the text but do not press Enter",
  force: "kill a session another actor owns (policy permitting)",
  "dangerously-allow-remote": "bind the dashboard off loopback — requires --token; prefer an SSH tunnel",
  "strict-port": "exit 75 when --port is busy instead of scanning forward",
  "no-token": "serve the dashboard without a token (a single-user machine only)",
  version: "print the running build and exit",
  help: "print this text, or one verb's usage with its flags: tmux-agent help <verb>",
};
/** The global flags every verb takes, in the order `help` lists them. */
const GLOBAL_FLAGS = ["socket", "default-server", "actor", "lexicon", "version", "help"];
/** Flags a verb reads beyond the ones its SHAPES line shows — the line stays short for refusals, `help` lists them all. */
const VERB_EXTRA_FLAGS: Partial<Record<string, string[]>> = {
  web: ["token", "no-token", "strict-port", "dangerously-allow-remote"],
};
const flagLine = (name: string): string => `    --${name}  ${VALUE_FORMS[name] ?? BOOL_FORMS[name] ?? ""}`.trimEnd();
/**
 * `help [verb]` / `--help`: the verbs and their flags, generated from SHAPES and VALUE_FORMS — the data the
 * refusals already speak — so the text cannot drift from what the CLI accepts. Until then `--help` reached the usage line
 * (exit 64, "see source header") and no flag reference existed anywhere a user could reach: two cold-start rehearsals
 * on 2026-10-13 found `--port` only by grepping the planning docs. Answers before the home, the ledger or tmux exist.
 */
function helpText(topic?: string): string {
  const out: string[] = [];
  if (topic === undefined) {
    out.push("tmux-agent — a universal tmux layer for agent workflows: spawn, drive and observe sessions with lineage, verified input, an audit ledger, an MCP surface and a loopback dashboard.", "");
    for (const verb of Object.keys(SHAPES)) out.push(`  ${usageOf(verb)}`);
    out.push("", "Global flags (every verb):");
    for (const f of GLOBAL_FLAGS) out.push(flagLine(f));
    out.push(
      "",
      "Exit codes: 0 ok · 64 usage (a value the verb cannot use, refused before anything is touched) · 78 config (a lexicon or policy file the tool cannot use) · 75 the dashboard's port is busy under --strict-port · 71 the dashboard could not bind.",
      "tmux-agent help <verb> shows one verb's flags; README.md has the five-minute path.",
    );
    return out.join("\n") + "\n";
  }
  const keys = topic === "msg" ? ["msg send", "msg recv"] : SHAPES[topic] ? [topic] : null;
  // ends with the header line, as every refusal's usage does (test/positional-count.test.js (k): the table cannot drift)
  if (!keys) throw new FlagError(`help: no such verb ${JSON.stringify(topic)} (the verbs are: ${Object.keys(SHAPES).join(", ")}) — ${usageOf("help")}`);
  for (const key of keys) out.push(`  ${usageOf(key)}`);
  const own = [...new Set(keys.flatMap((k) => [...(SHAPES[k].flags ?? "").matchAll(/--([a-z-]+)/g)].map((m) => m[1])).concat(VERB_EXTRA_FLAGS[topic] ?? []))];
  if (own.length) {
    out.push("", "Flags:");
    for (const f of own) out.push(flagLine(f));
  }
  out.push("", "Global flags (every verb):");
  for (const f of GLOBAL_FLAGS) out.push(flagLine(f));
  return out.join("\n") + "\n";
}
function usageOf(verb: string): string {
  const s = SHAPES[verb];
  return ["tmux-agent", verb, ...s.args, s.more, s.flags].filter(Boolean).join(" ");
}

/**
 * The one judgement of a verb's positional count against SHAPES, before any verb runs. Until
 * 2026-09-15 (measured on an earlier build) the dispatch read rest[0],
 * rest[1] with no count check: `spawn --cwd DIR` with the name forgotten created a session literally named
 * undefined and exited 0 (assertName's regex coerces undefined to the string, which it accepts); a bare
 * `kill` then killed that session and a bare `watch` blocked on it — or, on a fleet without one, reported
 * `undefined → GONE`, exit 2, the code a supervising script reads as "the session died"; `exec NAME` with
 * no command ran `true` and reported success; `exec NAME echo A B` unquoted ran `echo` alone and dropped
 * A B; `send NAME "cmd" -no-enter` (one dash) took -no-enter for a positional and pressed Enter; `status
 * -json FILE` wrote no file, exit 0; a bare `log` printed a path to undefined.log; `msg send a` died in
 * Node's words. Too few → the verb and the missing arguments in the header's words. Too many → the first
 * extra as typed: the two-dash hint when a single-dash token is within two edits of a declared flag
 * (nearestFlag), the quoting hint for `exec` and `send` (a command typed unquoted is the likely cause),
 * the usage otherwise. A verb the table does not know is left to the usage line. Over MCP none of this
 * is reachable — src/mcp/server.ts requires the fields — so the CLI is the one caller that could hand
 * undefined to the orchestrator.
 */
function judgePositionals(verb: string, args: string[]): void {
  const s = SHAPES[verb];
  if (!s) return;
  if (args.length < s.args.length) throw new FlagError(`${verb}: needs ${s.args.slice(args.length).join(" ")} — ${usageOf(verb)}`);
  if (s.more || args.length === s.args.length) return;
  const extra = args[s.args.length];
  const near = /^-[^-]/.test(extra) ? nearestFlag(extra.slice(1)) : undefined;
  if (near) throw new FlagError(`${extra}: one dash is not a flag — did you mean --${near}?`);
  if (verb === "exec" || verb === "send") {
    throw new FlagError(`${verb}: ${JSON.stringify(extra)} is a third argument — quote the ${verb === "exec" ? "command" : "text"} as one string: ${usageOf(verb)}`);
  }
  throw new FlagError(`${verb}: ${JSON.stringify(extra)} is an extra argument — ${usageOf(verb)}`);
}

/**
 * The session name a verb acts on — every `<name>` in SHAPES: spawn, send, exec, watch, kill, log — judged HERE
 * through the driver's one exported rule before the home or a server is touched. Until 2026-09-15
 * (measured on an earlier build) assertName was reached only through
 * sessionTarget/paneTarget, and hasSession swallows its throw, so the name went into `new-session -s` unjudged after
 * `new Orchestrator` had made the 0700 home: `spawn 'vp bad'` exited 1 in tmux's words with the session born anyway
 * — one kill/send/exec then refused to address, exit 1; `spawn ../evil` left tmux's `__/evil` half-made; `watch 'vp
 * bad'` reported GONE, exit 2 — the code a supervising script reads as "the session died"; `log ../evil` printed a
 * path outside logs/. The count is judged first (judgePositionals), so a missing name is "needs <name>", never
 * `undefined` refused as a name. Orchestrator.spawn judges its spec again — over MCP that throw IS the isError reply.
 */
function judgeName(verb: string, args: string[]): void {
  if (SHAPES[verb]?.args[0] !== "<name>") return;
  try {
    assertName(args[0]);
  } catch (e) {
    if (e instanceof SessionNameError) throw new FlagError(`${verb}: ${e.message}`);
    throw e;
  }
}

/**
 * The mailbox's agent names are path segments under <home>/mailbox — judged HERE, through the mailbox's
 * one exported rule, before the home exists. Until 2026-09-15 (measured on an earlier build)
 * `msg send vp-a ../../X hello` wrote a 664 message file
 * beside the 0700 home and exited 0; `msg recv ../../X` read every *.json there and renamed each into an
 * archive/ it created; `msg send vp-a '' hello` delivered to <home>/mailbox/inbox — an agent named
 * nothing; `msg send ../x vp-c hello` died in Node's ENOENT with the argument unnamed. The count is judged
 * first (judgePositionals), so a missing name is "needs <to>", never `undefined is not an agent name`;
 * <from> before <to>, the header's order. The mailbox throws the same error itself — defence in depth
 * here, and over MCP that throw IS the isError reply (src/mcp/server.ts catches it).
 */
function judgeAgentNames(verb: string, args: string[]): void {
  try {
    if (verb === "msg send") {
      assertAgentName(args[0], "from");
      assertAgentName(args[1], "to");
    } else if (verb === "msg recv") {
      assertAgentName(args[0], "agent");
    }
  } catch (e) {
    if (e instanceof AgentNameError) throw new FlagError(`${verb}: ${e.message}`);
    throw e;
  }
}

/**
 * The directory `spawn` is born in, judged HERE through the orchestrator's one exported rule before the home, the
 * ledger or a tmux server is touched — the flag values above, one level over, on the verb every workflow
 * starts with. Until 2026-09-15 (measured on an earlier build) the value went
 * straight into new-session -c: `spawn X --cwd /srv/example/tmux-agnet` printed `spawned X`, exit 0, the shell and
 * any --cmd in $HOME (tmux's silent fallback), the ledger recording the typo, and a not-yet-existing home was created
 * on the way. The absent flag is the caller's own directory, as before; the empty value is judgeFlags' refusal.
 * Orchestrator.spawn judges the spec again — defence in depth for a caller that constructs one directly, and over
 * MCP that throw IS the isError reply.
 */
function judgeCwd(verb: string): void {
  if (verb !== "spawn") return;
  try {
    assertCwd(flag("cwd") ?? process.cwd());
  } catch (e) {
    if (e instanceof CwdError) throw new FlagError(e.message);
    throw e;
  }
}

/**
 * The FILE a verb WRITES to — `status --json FILE`, `calibrate --out FILE` — judged HERE through the one exported rule
 * beside publishStatus before the home, the ledger, a lexicon file or a tmux server is touched: after earlier changes
 * moved every value the CLI READS into a named refusal, these two — the only values it writes to — were judged
 * by nobody but the operating system, at the end. Until 2026-09-16 (measured on an earlier build)
 * `status --json <nodir>/x.json` made the home, read the fleet (2
 * session.state rows) and died in the top-level catch with Node's `ENOENT: no such file or directory, open '…'`, exit 1
 * — the code VERSIONING reserves for "the tool broke" — the flag unnamed and the fleet lines it had read withheld from
 * stdout (the print loop follows the publish); `calibrate --out <adir>` captured and redacted 40 lines of every session's
 * pane first and lost the draft with the write, `EISDIR: illegal operation on a directory, open '…'`, exit 1. A supervisor
 * reading exit 1 could not tell a mistyped directory from a broken tool. The absent flag is the home's own status.json,
 * or the draft on stdout, as before; the empty value is judgeFlags' refusal. publishStatus judges its outFile again before
 * the fleet is read — defence in depth for an embedder, as spawn judges --cwd again; the write itself, in both verbs, turns
 * the residual failure (a race, a full disk) into the same line with exit 1 — the judgement said the write could be done.
 */
function judgeOutPath(verb: string): void {
  try {
    if (verb === "status" && has("json")) assertOutPath(flag("json"), "--json");
    if (verb === "calibrate" && has("out")) assertOutPath(flag("out"), "--out");
  } catch (e) {
    if (e instanceof OutPathError) throw new FlagError(e.message);
    throw e;
  }
}

/**
 * The LINEAGE a session is born with — `--parent`, and the actor every verb's Orchestrator is built with (`--actor`,
 * else TMUX_AGENT_ACTOR) — judged HERE through the driver's one exported rule before the home, the ledger or a tmux
 * server is touched; `doctor --parent A,B` judges each name of its list by the same rule. The header calls
 * each "a name", the ledger's public envelope carries both (VERSIONING item 3), and since the mailbox and session-name checks every
 * other name the tool records is judged first — these two were the last it read unjudged. Until 2026-09-15 (measured
 * on an earlier build) `--actor ../who spawn vp-bad --cwd /tmp --parent 'not
 * a name!'` printed `spawned vp-bad`, exit 0 — the values in tmux's @agent_parent/@agent_owner, `lineage` and the
 * session.spawned row; the child ORPHANED by construction (no session can bear that parent); `kill vp-bad` by every
 * other actor refused `owned by ../who`; `doctor --parent 'not a name!'` gave the name a verdict. The source opens the
 * line: `--parent: invalid session name: "not a name!" (…)`, `--actor: …`, `TMUX_AGENT_ACTOR: …`. The defaults (`cli`,
 * the parent defaulting to the actor) are never refused; a set-but-empty TMUX_AGENT_ACTOR is an owner named nothing,
 * refused like any other. judgeFlags has already refused `--parent`/`--actor` with no value, so the token after each is
 * its value whatever it looks like — `doctor --parent --prent` is the name "--prent", refused by the rule, not a flag.
 * The Orchestrator judges both again — its constructor the actor, spawn() the parent — defence in depth for an embedder,
 * and over MCP spawn's throw IS the isError reply; the MCP server judges TMUX_AGENT_ACTOR itself at startup (exit 78).
 */
function judgeLineage(verb: string): void {
  try {
    if (has("actor")) assertName(flag("actor") ?? "", "--actor");
    else if (process.env.TMUX_AGENT_ACTOR !== undefined) assertName(process.env.TMUX_AGENT_ACTOR, "TMUX_AGENT_ACTOR");
    if (verb === "spawn" && has("parent")) assertName(flag("parent") ?? "", "--parent");
    if (verb === "doctor") for (const name of (flag("parent") ?? "").split(",").filter(Boolean)) assertName(name, "--parent");
  } catch (e) {
    if (e instanceof SessionNameError) throw new FlagError(e.message);
    throw e;
  }
}

/**
 * The SOCKET every verb talks to — `--socket`, else TMUX_AGENT_SOCKET — judged HERE through the driver's one exported
 * rule before the home, the ledger, a lexicon file or a tmux server is touched: the one global value every
 * verb reads, the value the whole isolation story (README "Isolated by default", THREAT-MODEL's socket control) rests
 * on, and after the other value checks the last one the CLI read unjudged. Until 2026-09-16 (measured on an earlier build)
 * it was judged by Tmux.socketArgs() alone, a bare Error at the FIRST tmux
 * call: `--socket ../x status` exited 1 in the driver's words — no source, no rule — with the 0700 home already made;
 * `waste`, `log`, `msg send|recv` and `doctor` ran to completion under it, exit 0; `watch X` reported X → GONE, exit 2
 * — the code a supervising script reads as "the session died" — and wrote a notify.sent row, because hasSession's catch
 * swallowed the throw; `--socket ../x --default-server status` never looked at the value and read the operator's own
 * server; `web` served an error string on /api/fleet for as long as it ran. The source opens the line: `--socket:
 * invalid socket name: "../x" ([A-Za-z0-9._-], 1 or more)`, `TMUX_AGENT_SOCKET: …`. The flag wins over the variable
 * as it does below; a set-but-empty variable is a socket named nothing, refused like the actor's; the
 * default (nothing given) is never refused; judgeFlags has already refused `--socket` with no value in its own words.
 * `--default-server` exempts nothing typed: a name typed is a name judged. The Tmux constructor judges the value again
 * — defence in depth for an embedder — and the MCP server judges TMUX_AGENT_SOCKET itself at startup (exit 78).
 */
function judgeSocket(): void {
  try {
    if (has("socket")) assertSocketName(flag("socket") ?? "", "--socket");
    else if (process.env.TMUX_AGENT_SOCKET !== undefined) assertSocketName(process.env.TMUX_AGENT_SOCKET, "TMUX_AGENT_SOCKET");
  } catch (e) {
    if (e instanceof SocketNameError) throw new FlagError(e.message);
    throw e;
  }
}

/**
 * The PROFILE `status` and `watch` judge a session by — `--profile NAME` — judged HERE through the Monitor's one exported
 * rule, against the chain the lexicon resolved, before a tmux server is asked or a verdict is ledgered. The
 * library has honoured `Monitor.snapshot(session, profileName)` — and fleet(), fleetReport(), fleetFast() through it —
 * already, refusing an unknown name with ProfileNameError; until 2026-09-24 (measured on earlier builds)
 * no shipped
 * surface could pass one: `status --profile codex` and `watch X --profile codex` were `--profile: unknown flag`, exit 64,
 * so a supervisor could only ever get the auto chain's verdict on a session the chain classifies wrong. The judgement
 * cannot come with the other flag judgements above: which names are held is the lexicon's to say, and the lexicon lives
 * in the home — so it comes as soon as the chain exists and before the switch, the same place for both verbs. The source
 * opens the line — `--profile: unknown profile name: "Acme" (this Monitor holds: acme, claude-code, codex, aider,
 * generic-shell)` — ProfileNameError's own words; judgeFlags has already refused `--profile` with no value. The Monitor
 * judges the name again inside every call the two verbs make (defence in depth for an embedder); over MCP that throw IS
 * the isError reply. Returns the name for the verb to pass, undefined when none was typed — the flag on any other verb
 * is not read, as `--idle-secs` is not read outside `watch`.
 */
function judgeProfile(verb: string, profiles: readonly AgentProfile[]): string | undefined {
  if ((verb !== "status" && verb !== "watch") || !has("profile")) return undefined;
  const name = flag("profile") ?? "";
  try {
    assertProfileName(name, profiles);
  } catch (e) {
    if (e instanceof ProfileNameError) throw new FlagError(`--profile: ${e.message}`);
    throw e;
  }
  return name;
}

async function main(): Promise<number> {
  // --version answers before anything is constructed: no tmux, no home directory, no ledger file.
  // The stamp is what this binary was built from; `doctor` and /api/health carry the same.
  if (has("version")) {
    console.log(formatBuild(runningBuild()));
    return 0;
  }
  const [cmd, ...rest] = positionals();
  // Flag names, positional counts, session names, the mailbox's agent
  // names, spawn's directory, the file status --json / calibrate --out writes to,
  // the lineage values — --parent and the actor — the socket name, then whole-number values,
  // are judged HERE —
  // before a tmux server, the home directory, the ledger or a lexicon file is touched:
  // a refusal leaves nothing behind, and `watch` is the verb a supervising script blocks on. `doctor --port` is not in the
  // value list on purpose: doctor is a report, exit 0 in every case, and probeDashboard
  // names a bad port inside the block itself.
  let idleSecs = 30;
  let webPort = DEFAULT_WEB_PORT;
  try {
    judgeFlags(process.argv.slice(2));
    // `msg send` / `msg recv` are the table's verbs; `msg` alone, or with anything else, keeps the usage line
    const verb = cmd === "msg" && rest.length > 0 ? `msg ${rest[0]}` : (cmd ?? "");
    judgePositionals(verb, cmd === "msg" ? rest.slice(1) : rest);
    judgeName(verb, rest);
    judgeAgentNames(verb, rest.slice(1));
    judgeCwd(verb);
    judgeOutPath(verb);
    judgeLineage(verb);
    judgeSocket();
    if (cmd === "watch") idleSecs = intFlag("idle-secs", 30, IDLE_SECS);
    if (cmd === "web") webPort = intFlag("port", DEFAULT_WEB_PORT, PORT);
  } catch (e) {
    if (e instanceof FlagError) {
      console.error(e.message);
      return 64;
    }
    throw e;
  }
  // `help [verb]` and `--help` answer here — after the flags and positionals were judged (a bogus flag beside --help is
  // still refused), before the socket, the home, the ledger or a lexicon exist. One verb at a time.
  if (cmd === "help" || has("help")) {
    try {
      const topic = cmd === "help" ? rest[0] : cmd;
      if (cmd === "help" && rest.length > 1) throw new FlagError(`help: one verb at a time — ${usageOf("help")}`);
      process.stdout.write(helpText(topic));
      return 0;
    } catch (e) {
      if (e instanceof FlagError) {
        console.error(e.message);
        return 64;
      }
      throw e;
    }
  }
  // Env parity with the MCP server (which honors both vars). Without it, the collector runs
  // with --default-server while a bare CLI query silently reads the EMPTY isolated socket —
  // status.json said "0 sessions" on a 32-session fleet (verified 2026-08-25). Flags still win. The value
  // was judged by judgeSocket above; the constructor judges it again in the driver's plain words.
  const socketName = flag("socket") ?? process.env.TMUX_AGENT_SOCKET;
  const defaultServer = has("default-server") || process.env.TMUX_AGENT_DEFAULT_SERVER === "1";
  const tmux = new Tmux({ socket: socketName, defaultServer });
  /**
   * How the UNREACHABLE lines name the server the caller asked — `status`, `watch` and `lineage`.
   * Derived in the driver so the MCP server's note names one socket the same way, never a second derivation.
   */
  const label = socketLabel({ socket: socketName, defaultServer });
  const ledger = new Ledger();
  const policy = new Policy(undefined, cmd === "web" ? "web" : "cli");
  const actor = flag("actor") ?? process.env.TMUX_AGENT_ACTOR ?? "cli";
  const orch = new Orchestrator(tmux, ledger, policy, actor);
  // Ledger retention comes from the same health.json as every other operator-tunable bound.
  // Any verb's first write of a new day may be the sweep trigger, so it is set here,
  // once the home is known, not only for `web`.
  const thresholds = loadThresholds(orch.home);
  ledger.retention = retentionFromThresholds(thresholds);
  /**
   * Lexicon: per-fleet vocabulary (agent-CLI profiles, non-session parent names, extra secret
   * shapes). Loaded BEFORE anything captures a pane, because installing redaction late would
   * mean the first capture of the process writes unredacted text. A lexicon that cannot be read
   * or parsed aborts startup (LexiconError → exit 78 below, one line) rather than running a fleet
   * whose operator believes redaction is active when it is not — the whole point of the file is
   * that its failures are never silent. Only the ABSENT default is silently the shipped
   * vocabulary; a path named by --lexicon or TMUX_AGENT_LEXICON that is not there, a directory
   * or a file this user cannot read is refused like a malformed one.
   */
  const lexicon = loadLexicon(orch.home, flag("lexicon"));
  configureRedaction(lexicon);
  configureEngagement(lexicon);
  const profiles = resolveProfiles(lexicon);
  const monitor = new Monitor(tmux, ledger, orch.home, profiles);
  // `--profile NAME` (status, watch): the one judgement that has to wait for the lexicon — see judgeProfile.
  // Refused here, nothing below runs: no tmux call, no capture, no session.state row, no status.json.
  let profileName: string | undefined;
  try {
    profileName = judgeProfile(cmd ?? "", profiles);
  } catch (e) {
    if (e instanceof FlagError) {
      console.error(e.message);
      return 64;
    }
    throw e;
  }
  // pipe-stall watchdog: every deep snapshot (watch/status/dashboard inspect) checks that a
  // captured session's log still grows when its pane does, and re-arms a dead pipe
  monitor.watchdog = new CaptureWatchdog(orch.home, ledger, (s) => orch.startCapture(s));
  const mailboxDir = join(orch.home, "mailbox");
  const mailbox = new Mailbox(mailboxDir, ledger);
  const sink = process.env.TMUX_AGENT_SLACK_WEBHOOK ? new SlackWebhookSink(ledger) : new ConsoleSink(ledger);

  // Every rest[n] a verb reads below is present: judgePositionals refused a shorter argv above.
  switch (cmd) {
    case "spawn": {
      const name = rest[0];
      const created = await orch.spawn({
        name,
        cwd: flag("cwd") ?? process.cwd(),
        command: flag("cmd"),
        parent: flag("parent") ?? actor,
        task: flag("task"),
      });
      console.log(created ? `spawned ${name}` : `exists ${name} (no-op)`);
      return 0;
    }
    case "send": {
      const ok = await orch.sendVerified(rest[0], rest[1], { enter: !has("no-enter") });
      console.log(ok ? "sent+verified" : "FAILED to verify input landed");
      return ok ? 0 : 1;
    }
    case "exec": {
      const { exitCode, output } = await orch.execSync(rest[0], rest[1]);
      console.log(output.trim());
      return exitCode;
    }
    case "status": {
      // the named profile decides the file's records and the table alike — one verdict on both surfaces
      const file = await publishStatus(orch, monitor, flag("json"), profileName);
      const { sessions: snaps, tmux: server } = await monitor.fleetReport(profileName);
      const meta = latestSessionMeta(join(orch.home, "ledger"));
      let cut = false;
      for (const s of snaps) {
        const m = meta.get(s.session);
        const tag = m?.verdict ? `${m.verdict}${m.role ? ` · ${m.role.slice(0, 40)}` : ""}` : "";
        if (s.lastLine.length > 80) cut = true;
        console.log(`${s.session}\t${s.state}\t${s.contextPct ?? "-"}%\t${tag}\t${s.lastLine.slice(0, 80)}`);
      }
      // The table is for a glance and cuts each last line at 80 characters; until this line it did so in silence and the
      // cold-start rehearsal read the source to learn the file held the rest. One line, only when something was cut.
      if (cut) console.error("status: the table cuts each last line at 80 characters — status.json holds them whole");
      // the verdict/role column reads blank once a census's day is archived — say so, as `lineage` does
      const decay = metaDecayNote(join(orch.home, "ledger"), snaps.map((s) => s.session), meta);
      if (decay) console.error(`status: ${decay}`);
      if (!server.reachable) {
        // The fleet's worst failure, in tmux's own words. Until this check a dead server fell through to
        // the socket-mismatch hint below — 0 sessions and a ledger the daemon's own fleet.tmux/GONE rows had just
        // freshened satisfy it exactly — and the operator was told to change sockets. The fact rides the file too
        // (status.json.tmux); the exit code stays 0, as for any fleet the verb could describe.
        console.error(`status: ${serverGoneNote(label, server.error)}`);
      } else if (snaps.length === 0) {
        // The collector (dashboard/MCP) may observe a DIFFERENT tmux server than this query.
        // 0 sessions on a server that ANSWERS while the ledger is actively being written is that
        // mismatch, not an empty fleet — say so instead of silently publishing an empty status.json.
        try {
          if (Date.now() - statSync(ledger.path).mtimeMs < 10 * 60 * 1000) {
            console.error(
              "warning: 0 sessions on this socket, but the ledger has events from the last 10min — " +
                "a collector is watching another tmux server. Try --default-server (or TMUX_AGENT_DEFAULT_SERVER=1).",
            );
          }
        } catch { /* no ledger file — genuinely empty */ }
      }
      console.error(`status.json → ${file}`);
      return 0;
    }
    case "watch": {
      const name = rest[0];
      let last = "";
      let idleSince = Date.now();
      for (;;) {
        const s = await monitor.snapshot(name, profileName); // the named profile, or the auto chain
        if (s.state === "GONE" || s.state === "DEAD" || s.state === "ERROR" || s.state === "BLOCKED") {
          console.log(JSON.stringify(s));
          // The script blocking on this verb branches on the exit code, and 2 is "gone" for both failures the fleet
          // has: this one session died, or the whole tmux server did. Until the GONE reason was added they were the same answer to the
          // byte, so a supervisor respawned one session per charter entry onto a socket with no server. The reason —
          // tmux's own words, present only when the server did not answer — is on the JSON; this line is so it is
          // visible without parsing it. Exit code unchanged (VERSIONING item 1).
          if (s.reason) console.error(`watch: ${serverGoneNote(label, s.reason)}`);
          await sink.notify(`tmux-agent: ${name} → ${s.state}`, s.lastLine, { session: name });
          return s.state === "GONE" || s.state === "DEAD" ? 2 : 3;
        }
        if (s.lastLine !== last) {
          last = s.lastLine;
          idleSince = Date.now();
        } else if (Date.now() - idleSince > idleSecs * 1000 && s.state === "IDLE") {
          console.log(JSON.stringify(s));
          await sink.notify(`tmux-agent: ${name} idle ${idleSecs}s`, s.lastLine, { session: name });
          return 0;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    case "kill":
      await orch.kill(rest[0], has("force"));
      console.log(`killed ${rest[0]}`);
      return 0;
    case "lineage": {
      // tmux user-options only exist on sessions WE spawned; census session.meta events are
      // the lineage source for the (typical) adopted fleet. Options win when both exist.
      const meta = latestSessionMeta(join(orch.home, "ledger"));
      const { tmux: server, rows } = await orch.lineageReport();
      for (const l of rows) {
        const m = meta.get(l.name);
        const repo = m?.repo ? `${m.repo}${m.branch ? `@${m.branch}` : ""}` : "-";
        console.log(
          `${l.name}\tparent=${l.parent ?? m?.parent ?? "-"}\towner=${l.owner ?? "-"}\ttask=${l.task ?? "-"}\tverdict=${m?.verdict ?? "-"}\trepo=${repo}\trole=${m?.role ?? "-"}`,
        );
      }
      if (!server.reachable) {
        // The question this verb answers is "who owns whom", which a supervising agent asks FIRST — and until
        // this line a dead server answered it byte-identically to an idle fleet: rc 0, nothing on either stream,
        // the socket named nowhere, while `status` printed the death and status.json.tmux carried it. Same
        // wording as `status` and `watch`, behind this verb's own prefix; stdout and the exit code are untouched,
        // so nothing parsing the rows breaks (VERSIONING item 1).
        console.error(`lineage: ${serverGoneNote(label, server.error)}`);
      }
      // Census enrichment lives in the live ledger window only; once its day is archived the rows above read `-` where
      // a census had spoken — right, and until this line silent. One line, only when an archive exists AND a row has no
      // live meta; stdout and the exit code are untouched (VERSIONING item 1).
      const decay = metaDecayNote(join(orch.home, "ledger"), rows.map((l) => l.name), meta);
      if (decay) console.error(`lineage: ${decay}`);
      return 0;
    }
    case "msg": {
      if (rest[0] === "send") {
        const m = mailbox.send(rest[1], rest[2], rest[3], rest.slice(4).join(" "));
        console.log(`msg ${m.id} → ${rest[2]}`);
        return 0;
      }
      if (rest[0] === "recv") {
        // A name nobody has sent to is not the empty inbox of an agent we have heard of. On an earlier build both
        // were exit 0 with nothing on either stream — and the read CREATED the mailbox it then found
        // empty, so a typo was indistinguishable from a healthy quiet agent. Still exit 0:
        // reading an empty mailbox is not an error, and a supervising script polls this in a loop.
        const known = mailbox.known(rest[1]);
        const { messages, malformed } = mailbox.collect(rest[1]);
        for (const m of messages) console.log(JSON.stringify(m));
        if (!known) {
          console.error(`msg recv: ${unknownAgentNote(rest[1])}`); // the MCP tool's note too, from this one wording
        }
        // A file that would not parse is left where it lies and named here — until then it was archived
        // unread, silently. Still exit 0: what was readable was delivered, and the poll loop above must go on.
        if (malformed.length > 0) console.error(`msg recv: ${malformedNote(rest[1], malformed)}`);
        return 0;
      }
      break;
    }
    case "waste": {
      // `--since` as the last argument has no value to read: hand the empty string to the one
      // validator in wasteReport, so this refusal and the MCP tool's come from the same place.
      // No flag at all is no window.
      const since = has("since") ? (flag("since") ?? "") : undefined;
      const ledgerDir = join(orch.home, "ledger");
      try {
        for (const r of wasteReport(ledgerDir, since)) {
          console.log(`${r.session}\tevents=${r.events}\terrors=${r.errorEvents}\tchurn=${r.stateChurn}\tinputs=${r.inputsSent}\t${r.firstSeen}→${r.lastSeen}`);
        }
        // Zero rows over a window whose history was archived is not the same answer as zero rows over a
        // window where nothing happened, and until this note both were 0 bytes on both streams — after a
        // month of unattended running at the shipped keepDays: 30, every question about week one was
        // answered "nothing" in exactly the words a clean fleet gets. Still exit 0 with stdout untouched:
        // the rows are the answer, this is the caveat, and a script parsing stdout must not break.
        const archived = archivedDaysInWindow(ledgerDir, since);
        if (archived.length) console.error(`waste: ${archivedWindowNote(archived)}`); // the MCP tool's note too, from this one wording
      } catch (e) {
        // A window the reader cannot read is a usage error, not a crash and never a silent no-op:
        // exit 64 (EX_USAGE — the code a bad verb gets below) with the one line that names the flag,
        // the value and the accepted form. Until 2026-09-14 this printed the whole ledger.
        if (e instanceof SinceError) {
          console.error(e.message);
          return 64;
        }
        throw e;
      }
      return 0;
    }
    case "log":
      console.log(join(orch.home, "logs", `${rest[0]}.log`));
      return 0;
    /**
     * `doctor` — show the vocabulary actually in effect. Without this, lexicon config is
     * faith-based: an operator who writes a profile has no way to confirm the tool loaded it,
     * and the failure mode of a lexicon that silently did not apply is a fleet view that is
     * confidently wrong. Prints the resolved profile chain in precedence order, the parent
     * predicate's verdict on any names given, the redaction rule count, and the
     * ledger's footprint with the retention bound on it — the numbers /api/health serves, for an
     * operator without a dashboard — and the build stamp this binary runs — and
     * whether the dashboard on this host is reachable and runs that build: the daemon's own stale
     * alarm lives inside the daemon, so a daemon older than the stamp cannot say "restart"; this can.
     */
    /**
     * `calibrate` — sample the live fleet and PROPOSE a lexicon, with the evidence for each rule.
     * Never writes lexicon.json: the draft goes to stdout (or --out), a human ratifies it. See
     * core/calibrate.ts for why proposal-not-application is a hard rule here.
     */
    case "calibrate": {
      const { calibrate } = await import("../core/calibrate.js");
      const detail = await tmux.listSessionsDetailed();
      const inputs = await Promise.all(
        detail.map(async (d) => {
          // redact BEFORE the text enters the report — a calibration draft is a file people
          // paste into issues and chat, so it must never be the thing that leaks a credential
          const pane = redact(await tmux.capturePane(d.name, 40).catch(() => ""));
          return {
            session: d.name,
            parent: d.parent ?? null,
            tail: pane.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-8),
          };
        }),
      );
      const report = calibrate(inputs);
      const out = flag("out");
      const json = JSON.stringify(report, null, 2);
      if (out) {
        // judged by judgeOutPath before a pane was captured; a write that still fails (a race, a full disk) is the same
        // line with exit 1 — never Node's bare open error
        writeOutPath(out, "--out", json + "\n", 0o600);
        console.error(`calibration draft written to ${out} (0600) — review it, then merge into lexicon.json`);
        for (const n of report.notes) console.error(`  note: ${n}`);
      } else {
        console.log(json);
      }
      return 0;
    }
    case "doctor": {
      const profiles = resolveProfiles(lexicon);
      // --port is the web verb's flag with the web verb's default: the daemon is probed where the
      // operator started it; the host is the literal loopback address inside the probe, never a flag
      const dashboard = await probeDashboard(orch.home, Number(flag("port") ?? DEFAULT_WEB_PORT));
      const out = {
        home: orch.home,
        lexicon: {
          path: flag("lexicon") ?? process.env.TMUX_AGENT_LEXICON ?? join(orch.home, "lexicon.json"),
          loaded: Object.keys(lexicon).length > 0,
          version: lexicon.version ?? null,
        },
        profiles: { order: profiles.map((p) => p.name), userDefined: (lexicon.profiles ?? []).length, replaceBuiltins: !!lexicon.replaceProfiles },
        redaction: { builtin: "always on", extraRules: extraRedactionRuleCount() },
        parents: {
          extraNames: lexicon.parents?.nonSession ?? [],
          extraPattern: lexicon.parents?.nonSessionPattern ?? null,
          replaceBuiltins: !!lexicon.parents?.replace,
          // let the operator test their own names: --parent boss,k8s-job
          verdicts: Object.fromEntries(
            (flag("parent") ?? "").split(",").filter(Boolean).map((n) => [n, configureEngagement(lexicon)(n) ? "non-session supervisor (not orphaned)" : "expected to be a live tmux session"]),
          ),
        },
        ledger: { dir: ledger.dir, ...ledgerFootprint(ledger.dir), retention: { ...ledger.retention, warnBytes: thresholds.ledgerWarnBytes } },
        // The other directory the tool writes into a home, held to the ledger's own standard:
        // mail nobody collected was on no surface, so a message sent to a name wrong by one character
        // was reported nowhere — pendingAgents names it. Read-only; a home that never sent is all zeros.
        mailbox: { dir: mailboxDir, ...mailboxFootprint(mailboxDir) },
        build: runningBuild(),
        // There IS a daemon to compare against. This comment used to say the opposite —
        // "the CLI's own process is the one being asked, so there is no daemon to be stale against" —
        // and on 2026-09-12 a long-running dashboard had served a 17-day-old build with no stamp
        // while doctor printed the disk's commit. The daemon's stale rule runs inside the
        // daemon, so one older than the stamp can never raise it; this block is what says "restart".
        // The same block carries the daemon's own tmux verdict (dashboard.tmux) and its reason
        // ends with it — the fleet's worst failure was absent here while the daemon's tick had already paged.
        dashboard,
        policy: policy.explain(),
      };
      console.log(JSON.stringify(out, null, 2));
      return 0;
    }
    case "help": {
      // answered above, before anything was constructed; the label is here so the verb is dispatched like every other
      process.stdout.write(helpText(rest[0]));
      return 0;
    }
    case "web": {
      const { startWeb, findFreePort, resolveToken, assertBindAllowed, isLoopbackHost, bindFailureLine, EX_OSERR } = await import("../web/server.js");
      const requested = webPort; // judged above, before anything was constructed
      const host = flag("host") ?? "127.0.0.1";
      // The loopback decision comes FIRST — before findFreePort, whose probe listen()s on the
      // requested host, and before resolveToken, which reads or mints the stored web-token. Until
      // 2026-09-14 it ran third, inside startWeb: the finder had bound the very host the
      // guard then refused, and `--dangerously-allow-remote` alone passed on the auto-generated
      // token. Off loopback only a typed `--token <value>` counts (README: "both flags"), and
      // `--no-token` there is a refusal, never an unauthenticated remote dashboard.
      const typedToken = has("no-token") ? undefined : flag("token");
      assertBindAllowed(host, has("dangerously-allow-remote"), typedToken);
      // prerequisite on multi-service hosts: never fight another listener. Default scans
      // forward from the requested port; --strict-port fails instead (for pinned tunnels).
      let port: number;
      try {
        port = has("strict-port") ? requested : await findFreePort(requested, host);
      } catch (e) {
        // The finder's probe met a bind error another port will not cure — EACCES on a privileged port, EADDRNOTAVAIL
        // on a --host not on this machine: the same one line and exit 71 that --strict-port gets from startWeb's own
        // handler, so one failure has one code with or without the flag. Until 2026-09-30 the finder
        // advanced on ANY probe error and only its give-up reached main()'s catch — `no free port in 80..99 on
        // 127.0.0.1`, exit 1, after twenty EACCES probes, the code named nowhere (measured on an earlier built CLI:
        // `web --no-token --port 80` as uid 1000 → 20 listen() calls, 81 ms). The give-up itself — twenty ports in use —
        // is the one rejection with no `code`, and still exits 1 through main() as before.
        const err = e as NodeJS.ErrnoException & { port?: unknown };
        if (err.code === undefined) throw e;
        console.error(bindFailureLine(err, host, typeof err.port === "number" ? err.port : requested));
        return EX_OSERR;
      }
      if (port !== requested) console.error(`tmux-agent web: port ${requested} busy — using ${port}`);
      const { installErrorBoundary } = await import("../core/boundary.js");
      installErrorBoundary(ledger, "web"); // must outlive a session dying mid-request
      // loopback: the stored/auto-generated token by default, --no-token opts out (unchanged);
      // off loopback: the typed token only — assertBindAllowed has already required it
      const token = isLoopbackHost(host) ? resolveToken(orch.home, flag("token"), has("no-token")) : typedToken;
      // TMUX_AGENT_HEALTH_TICK_MS: the daemon's sampling cadence (default 30 s; the server floors it
      // at 1 s) — the suites tick at 1 s to prove transitions without waiting on the wall clock
      const tickMs = Number(process.env.TMUX_AGENT_HEALTH_TICK_MS);
      // sink: health.critical transitions (H3) ride the same notify path as watch triggers
      // When something else serves the dashboard (a harness home page that proxies it under /tmux-agent/, 7337 never
      // published) the loopback `ssh -L` sentence is wrong for the person reading it; these two knobs replace it in
      // the page's note and in the banner. Empty or whitespace counts as unset, so a harness may export them always.
      const publicHint = process.env.TMUX_AGENT_PUBLIC_HINT?.trim() || undefined;
      const publicUrl = process.env.TMUX_AGENT_PUBLIC_URL?.trim() || undefined;
      const server = startWeb(orch, monitor, tmux, ledger, policy, {
        port, host, allowRemote: has("dangerously-allow-remote"), token, sink, thresholds, publicHint, publicUrl,
        healthTickMs: Number.isFinite(tickMs) && tickMs > 0 ? tickMs : undefined,
      });
      // The banner is the truth about the port — and about readiness. startWeb() calls
      // server.listen() and returns in the same tick; the URL used to print right here, before the socket
      // accepted, so a client that took the banner at its word could be refused (measured 2026-09-29:
      // test/built-web-port.test.js's control got `fetch failed` 85 ms after the banner; the harnesses hid
      // the race behind polls). Print only once the server says `listening`, and name the port the socket
      // is bound to — server.address(), the socket's own word — never the one asked for. Every bind failure
      // exits from startWeb's own `error` handler before this wait can settle — 75 for EADDRINUSE, 71 for
      // anything else — and nothing in that handler throws inside emit any more: were an error ever
      // to fall through it, once() rejects here (node's own contract for `error`) and main() exits non-zero.
      // Until 2026-09-30 the handler's `throw e` for a non-EADDRINUSE error reached the boundary installed
      // above as an uncaughtException, which recorded it and kept the process alive; this wait then stayed
      // pending with no banner, the loop drained and node exited 0 (measured on an earlier built CLI: EACCES
      // planted → exit 0 after 1,245 ms; a --host not on this machine → exit 0, EADDRNOTAVAIL).
      await once(server, "listening");
      const bound = server.address();
      const boundPort = bound !== null && typeof bound === "object" ? bound.port : port; // a TCP listener's address() is an AddressInfo; the fallback only narrows the type
      const urlSuffix = token ? `/?token=${token}` : "/";
      console.error(`tmux-agent dashboard: http://${host}:${boundPort}${urlSuffix}`);
      if (publicHint || publicUrl) console.error(`  public:  ${publicHint ?? publicUrl}`);
      else console.error(`  tunnel:  ssh -L ${boundPort}:localhost:${boundPort} <this-host>   then open http://localhost:${boundPort}${urlSuffix}`);
      if (token) console.error(`  token stored at ${join(orch.home, "web-token")} (0600). --no-token to disable on a single-user machine.`);
      return await new Promise<number>(() => {}); // serve forever
    }
  }
  console.error("usage: tmux-agent <spawn|send|exec|status|watch|kill|lineage|msg|waste|log|doctor|calibrate|web|help> ... — tmux-agent help [verb] explains each");
  return 64;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    // A bad lexicon is an operator config error, not a crash: exit 78 (EX_CONFIG) so a
    // supervising script can tell "you typo'd your config" from "the tool broke", and print the
    // rule name the validator attached rather than a stack trace.
    if (e instanceof LexiconError) {
      console.error(`lexicon config error: ${e.message}`);
      process.exit(78);
    }
    // The policy file is the same class: the file that decides what every surface may do is refused in one
    // line before any verb acts — never silently the permissive default, which is what a malformed one was until then.
    if (e instanceof PolicyError) {
      console.error(`policy config error: ${e.message}`);
      process.exit(78);
    }
    // An empty send text is a usage error like a bad flag value: 64, one line, nothing typed.
    if (e instanceof EmptyTextError) {
      console.error(e.message);
      process.exit(64);
    }
    console.error(String(e?.message ?? e));
    process.exit(1);
  },
);
