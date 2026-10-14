#!/usr/bin/env node
/**
 * tmux-agent MCP server (stdio).
 *
 * Tool surface = the CLI verbs, exposed to any MCP client (Claude Code, other agents).
 * Safety: policy file gates mutating tools; read-only mode removes them from tools/list
 * entirely (an agent can't be tempted by a tool it can't see). Every control action lands
 * in the audit ledger with actor = the MCP client name.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Tmux, assertName, SessionNameError, assertSocketName, SocketNameError, socketLabel, serverGoneNote } from "../core/tmux.js";
import { Ledger } from "../core/ledger.js";
import { Policy, PolicyError, type Action } from "../core/policy.js";
import { Orchestrator } from "../core/orchestrator.js";
import { Monitor, resolveProfiles } from "../core/monitor.js";
import { CaptureWatchdog } from "../core/watchdog.js";
import { loadLexicon, LexiconError, type LexiconConfig } from "../core/lexicon.js";
import { configureEngagement } from "../core/engagement.js";
import { Mailbox, malformedNote, unknownAgentNote } from "../adapters/messaging/mailbox.js";
import { publishStatus, wasteReport, archivedDaysInWindow, archivedWindowNote, metaDecayNote } from "../analytics/status.js";
import { redact, configureRedaction } from "../core/redact.js";
import { installErrorBoundary } from "../core/boundary.js";
import { loadThresholds, retentionFromThresholds } from "../core/healthwatch.js";

const socketName = process.env.TMUX_AGENT_SOCKET;
const actor = process.env.TMUX_AGENT_ACTOR ?? "mcp-client";
// The two values the server reads from its environment before anything is built, judged HERE before the home, the
// ledger or a tmux server is touched — an operator's config error, not a crash: exit 78 (EX_CONFIG, the code a lexicon
// the CLI cannot read already uses) with one line naming the variable, the value as typed and the rule, before
// initialize is answered.
// The actor is the owner of every session this server spawns and the name on every ledger row — a name by the driver's
// rule. Until 2026-09-15 (measured on an earlier build)
// TMUX_AGENT_ACTOR=../mcp-who started the server and owned what it spawned, every other actor's
// kill refused in those words. The Orchestrator's constructor judges the value again, so an embedder cannot build one
// around a bad actor either.
// The socket is where every tmux call goes — a -L name by the driver's other rule. Until 2026-09-16
// (measured on an earlier build) TMUX_AGENT_SOCKET=../x
// started the server: it printed `ready (socket=../x, …)`, advertised 13 tools and answered every call isError with the
// driver's `unsafe socket name` — exit 0 when the transport closed, the home made — where the actor and the lexicon
// refused to start it. The Tmux constructor judges the value again (in the plain words), so a server could not be built
// around a bad socket either.
try {
  if (socketName !== undefined) assertSocketName(socketName, "TMUX_AGENT_SOCKET");
  assertName(actor, "TMUX_AGENT_ACTOR");
} catch (e) {
  if (e instanceof SocketNameError || e instanceof SessionNameError) {
    console.error(e.message);
    process.exit(78);
  }
  throw e;
}
const defaultServer = process.env.TMUX_AGENT_DEFAULT_SERVER === "1";
const tmux = new Tmux({ socket: socketName, defaultServer });
/** How this server's notes name the socket it drives — the CLI's derivation, not a second one. */
const label = socketLabel({ socket: socketName, defaultServer });
const ledger = new Ledger();
// The policy file is judged at startup as the lexicon is below: a TMUX_AGENT_POLICY path the server cannot
// read, or a default-path file it cannot read or that is not the schema, is the CLI's `policy config error:` line and
// exit 78 (EX_CONFIG) before initialize is answered. Until then the constructor's bare catch started the server with the
// permissive default — every mutating tool advertised and open, policy-status reporting a "global default" the
// operator never wrote — and a throw here would have been an uncaught exception at module load, exit 1 and a stack.
function policyOrExit(): Policy {
  try {
    return new Policy(undefined, "mcp");
  } catch (e) {
    if (e instanceof PolicyError) {
      console.error(`policy config error: ${e.message}`);
      process.exit(78);
    }
    throw e;
  }
}
const policy = policyOrExit();
const orch = new Orchestrator(tmux, ledger, policy, actor);
// Retention parity with the CLI: an MCP client's write can be the first of a new day.
ledger.retention = retentionFromThresholds(loadThresholds(orch.home));
// Lexicon parity with the CLI and dashboard. If only the CLI honoured lexicon.json, an MCP client
// would classify the same fleet with OUR vocabulary while the operator's own tooling used theirs —
// two surfaces disagreeing about whether a session is BLOCKED is worse than either being wrong.
// Loaded before the first capture so redaction is never installed late. Judged at startup as TMUX_AGENT_ACTOR is
// above: a TMUX_AGENT_LEXICON (or default-path file) the server cannot read, or cannot parse, is the CLI's
// `lexicon config error:` line and exit 78 (EX_CONFIG) before initialize is answered. Measured 2026-09-15 on an earlier build:
// an unreadable one started the server silent,
// exec-sync answering with the operator's redact shape in plain text; a malformed one was an uncaught throw — exit 1
// and a stack trace where the CLI gives 78 and one line.
function lexiconOrExit(home: string): LexiconConfig {
  try {
    return loadLexicon(home);
  } catch (e) {
    if (e instanceof LexiconError) {
      console.error(`lexicon config error: ${e.message}`);
      process.exit(78);
    }
    throw e;
  }
}
const lexicon = lexiconOrExit(orch.home);
configureRedaction(lexicon);
configureEngagement(lexicon);
const monitor = new Monitor(tmux, ledger, orch.home, resolveProfiles(lexicon));
// pipe-stall watchdog: session-status snapshots check that a captured session's log still
// grows when its pane does, and re-arm a dead pipe (stop-then-start via startCapture)
monitor.watchdog = new CaptureWatchdog(orch.home, ledger, (s) => orch.startCapture(s));
const mailbox = new Mailbox(join(orch.home, "mailbox"), ledger);

const S = {
  spawn: z.object({ name: z.string(), cwd: z.string(), command: z.string().optional(), parent: z.string(), task: z.string().optional() }),
  send: z.object({ name: z.string(), text: z.string(), enter: z.boolean().default(true) }),
  exec: z.object({ name: z.string(), command: z.string(), timeoutMs: z.number().optional() }),
  capture: z.object({ name: z.string(), lines: z.number().default(200) }),
  // `profile`: the Monitor's covered profileName, at last reachable from this surface. It has to be DECLARED
  // here to exist at all — zod strips a key the schema does not name before `run` sees it, so until 2026-09-24
  // (measured on an earlier build) {"name":"p1","profile":"no-such-profile"}
  // answered the auto verdict with isError unset, byte-identical to {"name":"p1"}: a name the library refuses by class
  // was, one layer up, silently the auto chain's answer labelled as if honoured. Optional: absent is the auto chain.
  snapshot: z.object({ name: z.string(), profile: z.string().optional() }),
  fleet: z.object({ profile: z.string().optional() }),
  kill: z.object({ name: z.string(), force: z.boolean().default(false) }),
  msgSend: z.object({ from: z.string(), to: z.string(), subject: z.string(), body: z.string() }),
  msgRecv: z.object({ agent: z.string() }),
  waste: z.object({ since: z.string().optional() }),
  none: z.object({}),
};

interface ToolDef {
  desc: string;
  schema: z.ZodTypeAny;
  mutating: boolean;
  /** the orchestrator verb a mutating tool performs — what its read-only refusal is ledgered as */
  action?: Action;
  /**
   * What the RESULT cannot say — one extra text block per note, after the result's own.
   * Read BEFORE `run`, the CLI's order (`known()` then `receive()`), and never inside the result: three
   * of these tools answer a bare array, so a note folded into the value would break every client that
   * parses content[0].text. content[0] stays byte-identical to what it was before a note existed.
   */
  notes?(a: never): string[];
  /**
   * `note` is the same channel for a verdict only the READ can know — is the tmux server there?
   * `notes` above answers from the arguments alone, so a tool would have to ask tmux a second time to use it:
   * one more exec, and a window where the probe and the read disagree. Notes pushed here land after the
   * argument-derived ones, still outside the result.
   */
  run(a: never, note: (text: string) => void): Promise<unknown>;
}

const tools: Record<string, ToolDef> = {
  "spawn-session": {
    desc: "Create a detached tmux session with parent lineage recorded, durable log capture started, and optional launch command (verified injection). Idempotent: existing name = no-op. A session that was created but whose launch command did not land is an isError reply naming it — the session is kept for diagnosis and the ledger's session.spawned row says commandDelivered:false.",
    schema: S.spawn,
    mutating: true,
    action: "spawn",
    run: async (a: z.infer<typeof S.spawn>) => ({ created: await orch.spawn(a) }),
  },
  "send-input": {
    desc: "Send text to a session's pane with two-step verification (paste, verify it landed, then Enter). Returns whether verification succeeded. Audited.",
    schema: S.send,
    mutating: true,
    action: "send",
    run: async (a: z.infer<typeof S.send>) => ({ verified: await orch.sendVerified(a.name, a.text, { enter: a.enter }) }),
  },
  "exec-sync": {
    desc: "Run a shell command inside a session's pane and BLOCK until it completes (unique marker + tmux wait-for). Returns {exitCode, output}. Use for shell panes, not inside TUI apps.",
    schema: S.exec,
    mutating: true,
    action: "exec",
    run: (a: z.infer<typeof S.exec>) => orch.execSync(a.name, a.command, a.timeoutMs),
  },
  "capture-pane": {
    desc: "Read the last N lines of a session's pane (secrets redacted).",
    schema: S.capture,
    mutating: false,
    run: async (a: z.infer<typeof S.capture>) => ({ text: redact(await tmux.capturePane(a.name, a.lines)) }),
  },
  "session-status": {
    desc: "Classify one session: WORKING / IDLE / BLOCKED / ERROR / DEAD / GONE / UNKNOWN, plus context% (agent-CLI profile) and last line. On a GONE, `reason` says WHY in tmux's own words when the server itself did not answer (its death, not this session's) and is null when the server answered and the session is simply absent — restart the session only in the second case. An `UNKNOWN` is a first poll's baseline rather than a verdict — the pane has been read once and not yet compared with itself, which is what a session you just spawned answers — so poll again instead of acting on it. Optional `profile` names ONE profile to judge the pane by (a lexicon profile or a built-in, exact) instead of the auto chain — `classifiedBy` is then that name or null; an unknown name is an isError reply naming the profiles this server holds, never a verdict.",
    schema: S.snapshot,
    mutating: false,
    // an unknown `profile` throws ProfileNameError before tmux is asked, and the catch below makes that the isError reply
    run: (a: z.infer<typeof S.snapshot>) => monitor.snapshot(a.name, a.profile),
  },
  "fleet-status": {
    desc: "Snapshot every session on the agent socket with lineage (parent/owner/task) and publish status.json for external consumers. `tmux` is the listing's own verdict on the server: reachable:false with tmux's words when it is dead or absent — an empty sessions[] is then not an idle fleet. Optional `profile` judges every session by that ONE profile (see session-status); the published file carries the same verdicts.",
    schema: S.fleet,
    mutating: false,
    run: async (a: z.infer<typeof S.fleet>, note) => {
      // the named profile decides the file's records and the reply alike; unknown → ProfileNameError → isError
      const file = await publishStatus(orch, monitor, undefined, a.profile);
      // the same listing the file was built from, with its verdict: an unreachable server is a fact the
      // tool reports beside its empty fleet, not a tool failure — isError stays false
      const { sessions, tmux } = await monitor.fleetReport(a.profile);
      // census enrichment the file could not carry because its day is archived: a second block from the
      // CLI's one wording, by the notes route — content[0] is the reply it always was
      const decay = metaDecayNote(join(orch.home, "ledger"), sessions.map((s) => s.session));
      if (decay) note(decay);
      return { statusFile: file, sessions, tmux };
    },
  },
  "kill-session": {
    desc: "Kill a session. Refuses sessions owned by another actor unless force=true AND policy allows.",
    schema: S.kill,
    mutating: true,
    action: "kill",
    run: async (a: z.infer<typeof S.kill>) => {
      await orch.kill(a.name, a.force);
      return { killed: a.name };
    },
  },
  "list-lineage": {
    desc: "Parent→child ownership tree of all sessions (from tmux user options; survives restarts). A dead or absent tmux server carries a second text block in tmux's own words — an empty tree is then not an idle fleet.",
    schema: S.none,
    mutating: false,
    // "Who owns whom" is the first question a supervising agent asks, and until this note a dead tmux server
    // answered it with the same `[]` an idle fleet gives — while fleet-status, /api/health and the CLI's
    // `status` all carried the death in tmux's own words. Additive by the notes route: content[0] is still
    // the array, byte for byte, and the verdict rides in a second block, from the CLI's one wording.
    run: async (_a: z.infer<typeof S.none>, note) => {
      const { tmux: server, rows } = await orch.lineageReport();
      if (!server.reachable) note(serverGoneNote(label, server.error));
      return rows;
    },
  },
  "message-send": {
    desc: "Send a message to another agent via the file mailbox (generic fallback when native cross-session messaging isn't available).",
    schema: S.msgSend,
    mutating: true,
    run: async (a: z.infer<typeof S.msgSend>) => mailbox.send(a.from, a.to, a.subject, a.body),
  },
  "message-receive": {
    desc: "Receive (and archive) pending mailbox messages for an agent. An empty result from a name nothing has ever been sent to carries a second text block saying so, naming the agent as typed; a known agent's merely-empty inbox carries none. A message file that will not parse is left in the inbox, never archived unread, and a second text block names it.",
    schema: S.msgRecv,
    mutating: false,
    // A name nobody has sent to is not the empty inbox of an agent we have heard of — the distinction the CLI
    // prints, which this surface answered "[]" to both of before the notes channel. Same source of
    // truth as the CLI's line: Mailbox.known() and unknownAgentNote(), never a second wording. Judged before
    // the read, and it judges the name too, so a bad name is the same isError reply it always was.
    notes: (a: z.infer<typeof S.msgRecv>) => (mailbox.known(a.agent) ? [] : [unknownAgentNote(a.agent)]),
    // The read's own verdict rides the same channel: a file that would not parse is left where it lies and
    // named from the CLI's one wording, malformedNote(); content[0] stays the array of what WAS delivered.
    run: async (a: z.infer<typeof S.msgRecv>, note) => {
      const { messages, malformed } = mailbox.collect(a.agent);
      if (malformed.length > 0) note(malformedNote(a.agent, malformed));
      return messages;
    },
  },
  "waste-report": {
    desc: "Per-session activity/waste table from the event ledger: error events, state churn, inputs sent, first/last seen. Answers 'which sessions wasted the most, and why'. Optional `since` (ISO-8601, e.g. 2026-08-18T00:00:00Z) narrows the window; a value that cannot be read is refused, never silently ignored. Readers see live days only, so when the window includes days the retention sweep has archived a second text block says how many and which — an empty table is then not a quiet fleet.",
    schema: S.waste,
    mutating: false,
    // A window whose days are all archived answered `[]` — the bytes of a fleet that did nothing — until
    // the archived-window note, while `doctor` on the same home already printed archiveFiles/archiveBytes. Additive by
    // the notes route: content[0] is still the rows, byte for byte, and the caveat rides in a second
    // block from the CLI's one wording. The window is read inside `run` so an unreadable `since` is the
    // same isError refusal it always was, reported on by nothing.
    run: async (a: z.infer<typeof S.waste>, note) => {
      const ledgerDir = join(orch.home, "ledger");
      const rows = wasteReport(ledgerDir, a.since);
      const archived = archivedDaysInWindow(ledgerDir, a.since);
      if (archived.length) note(archivedWindowNote(archived));
      return rows;
    },
  },
  "policy-status": {
    desc: "Explain this server's policy: whether it is read-only, which actions are therefore hidden from tools/list, and where that setting came from. ALWAYS visible — an agent must be able to discover why a tool it expected is absent.",
    schema: S.none,
    mutating: false,
    run: async () => policy.explain(),
  },
  "read-log": {
    desc: "Read the tail of a session's durable capture log (pipe-pane stream on disk, redacted).",
    schema: S.capture,
    mutating: false,
    run: async (a: z.infer<typeof S.capture>) => {
      const file = join(orch.home, "logs", `${a.name}.log`);
      try {
        const txt = readFileSync(file, "utf8");
        const lines = txt.split("\n");
        return { file, tail: redact(lines.slice(-a.lines).join("\n")) };
      } catch {
        return { file, tail: "", note: "no capture log for this session" };
      }
    },
  },
};

installErrorBoundary(ledger, "mcp"); // stdio server runs as long as its client does

const server = new Server({ name: "tmux-agent", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools)
    .filter(([, t]) => !(policy.isReadOnly() && t.mutating)) // denied tools are REMOVED, not just erroring
    .map(([name, t]) => ({
      name,
      description: t.desc,
      inputSchema: zodToJsonSchema(t.schema),
    })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const t = tools[req.params.name];
  if (!t) return err(`unknown tool ${req.params.name}`);
  if (policy.isReadOnly() && t.mutating) {
    // Refused HERE, before the orchestrator's gate can see it, so this path ledgers its own
    // control.denied: a hidden tool an agent called anyway is exactly the attempt the
    // audit trail exists to show. The session is the tool's `name` argument when it carries one.
    const msg = `policy: read-only mode — ${req.params.name} unavailable`;
    const target = (req.params.arguments as Record<string, unknown> | undefined)?.name;
    ledger.emit({
      type: "control.denied",
      ...(typeof target === "string" ? { session: target } : {}),
      actor,
      data: { action: t.action ?? req.params.name, reason: "read-only surface", tool: req.params.name, message: msg },
    });
    return err(msg);
  }
  try {
    const args = t.schema.parse(req.params.arguments ?? {});
    const notes = t.notes?.(args as never) ?? []; // read before the call, and never folded into the result
    const result = await t.run(args as never, (text) => notes.push(text));
    const content = [{ type: "text" as const, text: JSON.stringify(result, null, 2) }];
    for (const note of notes) content.push({ type: "text" as const, text: note });
    return { content };
  } catch (e) {
    return err(String((e as Error).message ?? e));
  }
});

/**
 * MCP error shape. `isError` MUST ride inside the result object — a probe found it being
 * dropped, so a schema violation looked like a SUCCESSFUL call whose text happened to contain
 * the word "error". Any client branching on isError (they all do) would have treated a failed
 * spawn as a success.
 */
function err(msg: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
    isError: true as const,
  };
}

/** minimal zod→JSON-schema for our flat object schemas */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const shape = (schema as z.AnyZodObject).shape ?? {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(shape) as Array<[string, z.ZodTypeAny]>) {
    let t: z.ZodTypeAny = v;
    let optional = false;
    let def: unknown;
    for (;;) {
      if (t instanceof z.ZodOptional) {
        optional = true;
        t = t.unwrap();
      } else if (t instanceof z.ZodDefault) {
        optional = true;
        def = (t as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue();
        t = (t as z.ZodDefault<z.ZodTypeAny>)._def.innerType;
      } else break;
    }
    const jt = t instanceof z.ZodNumber ? "number" : t instanceof z.ZodBoolean ? "boolean" : "string";
    properties[k] = def === undefined ? { type: jt } : { type: jt, default: def };
    if (!optional) required.push(k);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`tmux-agent MCP server ready (socket=${process.env.TMUX_AGENT_SOCKET ?? "tmux-agent"}, readOnly=${policy.isReadOnly()}, actor=${actor})`);
