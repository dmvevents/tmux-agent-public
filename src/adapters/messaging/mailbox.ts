/**
 * File-backed mailbox — the GENERIC cross-session messaging fallback.
 *
 * Claude Code sessions on one team should use native cross-session messaging (SendMessage);
 * this mailbox covers everything else: non-Claude CLIs, sessions in different teams, and
 * cross-host (put the mailbox dir on a shared/synced path). Design: one message = one file
 * (never merge-conflicts), receive = list+read+archive your own inbox.
 *
 * An agent name is a PATH SEGMENT under the root (`<root>/<agent>/inbox`), so every name the mailbox
 * touches is judged by the session-name rule before any directory exists. Until 2026-09-15
 * (measured on an earlier build) `msg send A ../../X hello` wrote a
 * 664 message file BESIDE the 0700 home and exited 0; `msg recv ../../X` read every *.json there and
 * renamed each into an archive/ it created; an empty name was an agent (`<home>/mailbox/inbox`); a
 * <from> with a slash was spliced into the file name and died in Node's words — and the same over MCP
 * message-send / message-receive with isError unset: an agent driving the server could write a file
 * with a body it chose at any writable path relative to the root, and move files out of any directory
 * it named. Directories are 0700 and message files 0600, as the ledger's (ledger.ts:95,107): a body is
 * whatever an agent chose to write, and the home is 0700 for the same reason (orchestrator.ts:39-43).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "../../core/ledger.js";
import { redact } from "../../core/redact.js";

/**
 * The session-name rule (src/core/tmux.ts assertName), verbatim: a mailbox agent IS a session name
 * (smoke-supervisor → smoke-child), and one rule means one set of names everywhere. A literal here rather
 * than an import so the messaging adapter does not depend on the tmux driver; test/agent-name.test.js
 * holds the two literals equal.
 */
export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The rule in the words every refusal of a name uses — the CLI's exit-64 line and the MCP isError text alike. */
export const AGENT_NAME_RULE = "alnum start, [A-Za-z0-9._-], at most 64";

/** An agent name the mailbox cannot use — <from>, <to> or <agent> — with the value as typed; the CLI turns it into exit 64, MCP into isError. */
export class AgentNameError extends Error {
  constructor(role: "from" | "to" | "agent", name: unknown) {
    super(`<${role}> ${JSON.stringify(name)} is not an agent name — ${AGENT_NAME_RULE}`);
    this.name = "AgentNameError";
  }
}

/**
 * The one judgement of a mailbox agent name, thrown before anything is created. typeof first: RegExp.test
 * coerces a non-string, and the pattern accepts the string "undefined". `role` is the header's
 * word for the argument — `<to>` — so the refusal names what the caller typed where they typed it.
 */
export function assertAgentName(name: unknown, role: "from" | "to" | "agent"): asserts name is string {
  if (typeof name !== "string" || !AGENT_NAME.test(name)) throw new AgentNameError(role, name);
}

/**
 * What a read of a name nobody has ever sent to says, in the ONE wording every surface uses —
 * AGENT_NAME_RULE's pattern applied to a note instead of a refusal. The CLI prints it on
 * stderr behind its own `msg recv: ` prefix; the MCP tool carries it in a second content block beside
 * the unchanged array of messages. A literal in each place is two wordings of one rule, and they drift:
 * test/mcp.test.js holds the two equal.
 */
export function unknownAgentNote(agent: string): string {
  return `no mailbox for ${JSON.stringify(agent)} — nothing has ever been sent to that agent (a mailbox is created by "msg send", not by this read); names are exact`;
}

/**
 * What a read that met a file it could not parse says, in the ONE wording every surface uses —
 * unknownAgentNote()'s route: the CLI prints it on stderr behind its own `msg recv: ` prefix, the MCP tool carries
 * it in a second content block beside the unchanged array of what WAS delivered. The file stays in the inbox under
 * the name given here. `file(s)` rather than a plural branch, so the wording has one shape and the tests one literal.
 */
export function malformedNote(agent: string, files: string[]): string {
  return `${files.length} unreadable message file(s) for ${JSON.stringify(agent)} left in the inbox, not archived — ${files.join(", ")}`;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  ts: string;
  subject: string;
  body: string;
}

export class Mailbox {
  constructor(private readonly root: string, private readonly ledger: Ledger) {}

  /**
   * `<root>/<parts...>` at 0700 — the mkdir mode for what is created now, a best-effort chmod on every
   * level for what already existed: mkdirSync's mode applies only on create (THREAT-MODEL finding 8),
   * and a mailbox/ created before this rule sits at the umask's 775. Callers judge the name first.
   */
  private dir(...parts: string[]): string {
    const d = join(this.root, ...parts);
    mkdirSync(d, { recursive: true, mode: 0o700 });
    for (let i = 0; i <= parts.length; i++) {
      try { chmodSync(join(this.root, ...parts.slice(0, i)), 0o700); } catch { /* best effort */ }
    }
    return d;
  }

  private inbox(agent: string): string {
    return this.dir(agent, "inbox");
  }

  send(from: string, to: string, subject: string, body: string): Message {
    // <from> is judged too: it is spliced into the file name and becomes the ledger's actor
    assertAgentName(from, "from");
    assertAgentName(to, "to");
    const id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const msg: Message = { id, from, to, ts: new Date().toISOString(), subject, body };
    const inbox = this.inbox(to);
    const name = `${msg.ts.replace(/[:.]/g, "")}-${from}-${id}.json`;
    // Written beside its final name and renamed into place: writeFileSync is open(O_TRUNC) then write(),
    // and a receive() listing the inbox between the two saw an empty `.json`, took its skip-malformed catch and
    // archived it — the sender's bytes then landed in archive/ through the still-open descriptor, never delivered,
    // nothing on any stream (forced on an earlier build through test/fixtures/mailbox-fs.cjs). The temp name does not end in
    // `.json`, so both readers — receive() and mailboxFootprint() — skip it by the filter they already have, and
    // rename() within one directory is atomic: a `.json` is complete or absent. The shape core/ledger-retention.ts
    // uses for archives (dot-prefixed, per-process). A sender that dies between the two calls leaves that dot-file,
    // which nothing reads and nothing counts — never a torn message.
    const tmp = join(inbox, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(msg, null, 2), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* best effort */ }
    renameSync(tmp, join(inbox, name));
    // The subject is operator/agent prose and the one free-text ledger field the earlier redaction pass left as typed: redacted
    // here like every other text the ledger keeps. The message FILE carries the subject as sent — delivery is the
    // recipient's; the files are 0600 in a 0700 home, like capture logs — and the row is the audit trail.
    this.ledger.emit({ type: "message.sent", session: to, actor: from, data: { id, subject: redact(subject) } });
    return msg;
  }

  /**
   * Has anything ever been sent to `agent` — is there a mailbox at all? A read of a name nobody has
   * sent to is not the empty inbox of an agent we have heard of, and before this check both were exit 0
   * with nothing on either stream (and the read CREATED the directory it then found empty). Callers
   * judge the name first; this one judges it too, since it is a path segment either way.
   */
  known(agent: string): boolean {
    assertAgentName(agent, "agent");
    return existsSync(join(this.root, agent, "inbox"));
  }

  /**
   * Read new messages for `agent`, archiving them so a second call doesn't re-deliver — `collect()`'s messages
   * alone, the signature VERSIONING item 6 covers, unchanged.
   *
   * A read NEVER creates: the inbox path is joined, not `dir()`ed, and archive/ appears only
   * when there is something to move into it. Measured on an earlier build, `msg recv ghostagent` on a fresh home
   * left <home>/mailbox/ghostagent/{inbox,archive} behind — a typo'd recipient with a directory
   * byte-for-byte as legitimate as the real one's. `send` still creates on demand: send-before-spawn is
   * the documented cross-host case (smoke step 6).
   */
  receive(agent: string): Message[] {
    return this.collect(agent).messages;
  }

  /**
   * `receive()` with the read's own verdict beside the messages: `malformed` names every `.json` in the inbox that
   * would not parse, each LEFT WHERE IT LIES. Until then the catch below fell through to the rename, so an
   * unreadable file — the half-written message of a racing send, before send() wrote atomically — was archived
   * unread with nothing said on any surface. The two surfaces that read this print malformedNote() for it; doctor's
   * footprint keeps counting the file as pending, so mail that can never be read also ages into the H3 rule.
   * No ledger event: a supervising script polls this in a loop, and one row per poll per file would
   * flood the ledger with one fact. Two readers on one inbox is not the design (an agent reads its own), so a file
   * that vanished between readdir and read is reported the same way rather than guessed at.
   */
  collect(agent: string): { messages: Message[]; malformed: string[] } {
    assertAgentName(agent, "agent");
    const dir = join(this.root, agent, "inbox");
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return { messages: [], malformed: [] }; // no mailbox for that name — an empty read, never a new directory
    }
    const messages: Message[] = [];
    const malformed: string[] = [];
    let seen: string | null = null;
    for (const f of names) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      try {
        messages.push(JSON.parse(readFileSync(p, "utf8")));
      } catch {
        malformed.push(f); // named, not archived: the file stays in the inbox for someone to read
        continue;
      }
      seen ??= this.dir(agent, "archive"); // created on the first message to archive, not on every read
      renameSync(p, join(seen, f));
    }
    for (const m of messages) this.ledger.emit({ type: "message.received", session: agent, actor: m.from, data: { id: m.id, subject: m.subject } });
    return { messages, malformed };
  }
}

/** What the mailbox root holds right now — `ledgerFootprint()`'s shape (core/ledger-retention.ts) for the other directory the tool writes into a home. */
export interface MailboxFootprint {
  /** mailboxes that exist: one per agent something has been sent to, collected or not */
  agents: number;
  /** message files sitting unread across every inbox */
  pending: number;
  /** bytes of those unread files */
  pendingBytes: number;
  /** the agents holding unread mail, named and sorted — the one-character-wrong recipient nobody will ever read is named here */
  pendingAgents: string[];
  /** when the oldest unread message landed in its inbox (its file's mtime, ISO), null when nothing is pending — mail rotting reads differently from mail just arrived */
  oldestPending: string | null;
}

/**
 * Count the mail nobody has collected, so that this failure mode is observable. Reported by
 * `doctor` beside the ledger's footprint, which has met this standard since ledger retention landed: until this
 * existed, two messages sent to a name that was wrong by one character were on NO surface — not
 * doctor, not `status --json`, not the dashboard — and the only trace was a `message.sent` with no
 * matching `message.received`, an asymmetry nothing computed. Read-only, and an absent root is an
 * empty footprint, never an error: doctor runs on homes that have never sent a message.
 */
export function mailboxFootprint(root: string): MailboxFootprint {
  let agents = 0, pending = 0, pendingBytes = 0, oldest = Infinity;
  const pendingAgents: string[] = [];
  for (const agent of listDir(root)) {
    const inbox = join(root, agent, "inbox");
    if (!existsSync(inbox)) continue; // a directory under the root without an inbox/ is not a mailbox
    agents++;
    let mine = 0;
    for (const f of listDir(inbox)) {
      if (!f.endsWith(".json")) continue;
      try {
        const st = statSync(join(inbox, f));
        pendingBytes += st.size;
        oldest = Math.min(oldest, st.mtimeMs);
      } catch {
        continue; // received between readdir and stat
      }
      mine++;
    }
    if (mine > 0) {
      pending += mine;
      pendingAgents.push(agent);
    }
  }
  return { agents, pending, pendingBytes, pendingAgents: pendingAgents.sort(), oldestPending: oldest === Infinity ? null : new Date(oldest).toISOString() };
}

/** The listing of a directory that may not exist yet — an empty set, not an error (ledger-retention.ts's own). */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
