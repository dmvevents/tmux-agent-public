/**
 * Slack notification sink (webhook). First of the pluggable sinks; the interface is the
 * contract — webhook/telegram/etc are drop-ins. No token = no-op with a ledger record,
 * so pipelines don't fail because notifications aren't configured.
 *
 * Every send files ONE `notify.sent` row (VERSIONING item 3), and the row's own fields win over a
 * caller's `meta` — `{ ...meta, sink, ok, title }` — so an embedder cannot file a row that says a
 * sink failed when it succeeded, or under a sink name that does not exist, while meta's other keys
 * (the CLI's `session`) still land. A failed send says WHY in `reason`, one non-empty
 * line per arm: the HTTP status for an answer that is not ok, the thrown error's name and message
 * with every `cause` down the chain (its `code` when it has one — ECONNREFUSED, ERR_INVALID_URL —
 * else its message) for a fetch that failed, and the timeout's own name plus the bound for a webhook
 * that never answered. The audit row the threat model relies on can then tell a mistyped URL from a
 * Slack outage from a firewall. The no-URL arm's wording is byte-for-byte what it was
 * (test/versioning-contract.test.js reads it).
 */
import { Ledger } from "../../core/ledger.js";

export interface NotifySink {
  name: string;
  notify(title: string, body: string, meta?: Record<string, unknown>): Promise<boolean>;
}

/**
 * How long one POST may wait for the webhook's answer before the send is filed as failed. Measured
 * 2026-09-23 on an earlier build without a bound:
 * a webhook that accepted the POST and never answered held notify() — and the `watch` loop, which
 * awaits it — for 300.8 s, the runtime's own fetch bound, with nothing printed and nothing ledgered
 * until it settled. A bounded single attempt: there is no retry (that would be a separate change).
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Why a fetch threw, as one line: `<name>: <message>` and then, in parentheses, each `cause` down
 * the chain — its `code` when undici gives one, its message otherwise — so a refused connection reads
 * `TypeError: fetch failed (ECONNREFUSED)` and a bad URL `TypeError: Failed to parse URL from …
 * (ERR_INVALID_URL)`. The bound's own rejection is a `TimeoutError`, and it names the bound.
 */
function failureReason(e: unknown, timeoutMs: number): string {
  const err = e as { name?: unknown; message?: unknown; cause?: unknown } | null;
  const name = typeof err?.name === "string" && err.name ? err.name : "Error";
  const message = typeof err?.message === "string" && err.message ? err.message : String(e);
  const causes: string[] = [];
  for (let c = err?.cause as { code?: unknown; message?: unknown; cause?: unknown } | undefined, depth = 0; c && depth < 5; c = c.cause as typeof c, depth++) {
    const detail = typeof c.code === "string" && c.code ? c.code : typeof c.message === "string" ? c.message : "";
    if (detail) causes.push(detail);
  }
  const why = causes.length ? ` (${causes.join("; ")})` : "";
  const bound = name === "TimeoutError" ? ` after ${timeoutMs} ms` : "";
  return `${name}: ${message}${why}${bound}`;
}

export class SlackWebhookSink implements NotifySink {
  name = "slack";
  /**
   * @param webhookUrl where the alert is POSTed — `TMUX_AGENT_SLACK_WEBHOOK` when not given (item 9);
   *   the argument wins over the environment.
   * @param timeoutMs the bound on one send, `DEFAULT_TIMEOUT_MS` when not given — additive to the
   *   covered constructor signature (item 6, minor); no new environment name.
   */
  constructor(
    private readonly ledger: Ledger,
    private readonly webhookUrl = process.env.TMUX_AGENT_SLACK_WEBHOOK,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async notify(title: string, body: string, meta?: Record<string, unknown>): Promise<boolean> {
    if (!this.webhookUrl) {
      this.ledger.emit({ type: "notify.sent", data: { ...meta, sink: "slack", ok: false, reason: "no TMUX_AGENT_SLACK_WEBHOOK", title } });
      return false;
    }
    let res: Response;
    try {
      res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${body}` }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      this.ledger.emit({ type: "notify.sent", data: { ...meta, sink: "slack", ok: false, reason: failureReason(e, this.timeoutMs), title } });
      return false;
    }
    if (!res.ok) {
      const reason = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
      this.ledger.emit({ type: "notify.sent", data: { ...meta, sink: "slack", ok: false, reason, title } });
      return false;
    }
    this.ledger.emit({ type: "notify.sent", data: { ...meta, sink: "slack", ok: true, title } });
    return true;
  }
}

/**
 * stderr sink — default when nothing is configured; keeps demos honest. It writes stderr on purpose:
 * `watch` prints its verdict JSON on stdout (src/bin/tmux-agent.ts), and a `[notify]` line there would
 * corrupt the consumer parsing it. Its row is shaped like the Slack sink's — meta first, own fields win.
 */
export class ConsoleSink implements NotifySink {
  name = "console";
  constructor(private readonly ledger: Ledger) {}
  async notify(title: string, body: string, meta?: Record<string, unknown>): Promise<boolean> {
    console.error(`[notify] ${title}: ${body}`);
    this.ledger.emit({ type: "notify.sent", data: { ...meta, sink: "console", ok: true, title } });
    return true;
  }
}
