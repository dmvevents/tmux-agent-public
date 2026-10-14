/**
 * Health thresholds → ledger events + notification — H3 of the health epic
 * (docs/HEALTH-CRASH-OBSERVABILITY.md).
 *
 * Two hard rules learned from every alerting system that came before:
 *   1. Events fire on STATE TRANSITIONS, never per poll. A steady breach is one
 *      `health.warning`, not one per 30s — event spam trains operators to ignore the ledger.
 *   2. Recovery is an event too (`health.recovered`): a warning with no closure leaves the
 *      operator asking "is that still true?" — the exact ambiguity the ledger exists to kill.
 *
 * Trends beat absolute thresholds for the leak class we actually face (upstream claude-code
 * #18859/#41765: idle sessions leaking ~500MB/min), which is what H5's prediction adds on top.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HostVitals } from "./health.js";
import { HostProc } from "./activity.js";
import { Ledger } from "./ledger.js";
import { LedgerFootprint, LedgerRetention } from "./ledger-retention.js";
import { BuildStatus, describeBuildPair } from "./build.js";

export interface HealthThresholds {
  /** warn/crit when available memory falls below this % of total */
  memAvailWarnPct: number;
  memAvailCritPct: number;
  /** warn/crit when this % of swap is in use (leaking fleets swap before they OOM) */
  swapUsedWarnPct: number;
  swapUsedCritPct: number;
  /** warn/crit when a tracked filesystem's free space falls below this many bytes */
  diskFreeWarnBytes: number;
  diskFreeCritBytes: number;
  /** warn/crit when ONE session's process tree holds this % of total RAM */
  sessionRssWarnPct: number;
  sessionRssCritPct: number;
  /**
   * The ledger's own footprint. Day files older than ledgerKeepDays are gzip-archived
   * under ledger/archive/ (today's never is); archives older than ledgerDeleteAfterDays are
   * unlinked — 0, the default, means never: archiving is the bound, deletion is an opt-in. The
   * H3 `ledger` rule warns when LIVE day files exceed ledgerWarnBytes (0 disables the rule).
   */
  ledgerKeepDays: number;
  ledgerDeleteAfterDays: number;
  ledgerWarnBytes: number;
  /**
   * The other directory the tool writes into a home. The H3 `mailbox` rule warns when the
   * OLDEST unread message has sat for this many hours (0 disables it). AGE, never count: mail seconds
   * old is healthy flow — the fleet is talking — and only mail nobody came back for is a failure.
   */
  mailboxOldestPendingWarnHours: number;
  /**
   * After a rule's `health.recovered`, a new WARNING for that rule inside this many minutes is not filed and not
   * notified; a CRITICAL always is. 0 disables the hold-down. Why: a value hovering at one threshold is a
   * transition on every tick — a development host filed 12 swap warning/recovered rows in 15 minutes on 2026-10-13 — and
   * rule 1 above exists exactly so that the ledger is not trained into noise.
   */
  rewarnHoldDownMinutes: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  memAvailWarnPct: 10,
  memAvailCritPct: 5,
  swapUsedWarnPct: 50,
  swapUsedCritPct: 90,
  diskFreeWarnBytes: 10e9,
  diskFreeCritBytes: 5e9,
  sessionRssWarnPct: 25,
  sessionRssCritPct: 40,
  ledgerKeepDays: 30,
  ledgerDeleteAfterDays: 0,
  ledgerWarnBytes: 256 * 1024 * 1024,
  mailboxOldestPendingWarnHours: 24,
  rewarnHoldDownMinutes: 10,
};

/** The retention half of the thresholds, in the shape the Ledger applies on day rollover. */
export function retentionFromThresholds(t: HealthThresholds): LedgerRetention {
  return { keepDays: t.ledgerKeepDays, deleteAfterDays: t.ledgerDeleteAfterDays };
}

/**
 * Optional overrides from `$TMUX_AGENT_HOME/health.json` (`{"thresholds": {...}}`).
 * A malformed file warns loudly and falls back to defaults — health monitoring degrading to
 * known-good thresholds is safer than a fleet daemon that refuses to start over a typo
 * (contrast lexicon.json, which DOES abort: silent redaction failure leaks secrets; silent
 * threshold fallback does not).
 */
export function loadThresholds(home: string): HealthThresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  let raw: string;
  try {
    raw = readFileSync(join(home, "health.json"), "utf8");
  } catch {
    return out; // absent = defaults, silently — the common case
  }
  try {
    const t = (JSON.parse(raw) as { thresholds?: Record<string, unknown> }).thresholds ?? {};
    for (const k of Object.keys(out) as Array<keyof HealthThresholds>) {
      const v = t[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    }
  } catch (e) {
    console.error(`tmux-agent: ignoring malformed health.json (${String((e as Error).message)}) — using default thresholds`);
  }
  return out;
}

export type Severity = "warn" | "crit";

export interface HealthAlert {
  /** stable key a transition is tracked by: "mem", "swap", "disk:<path>", "session:<name>", "prediction", "ledger", "mailbox", "build" */
  rule: string;
  sev: Severity;
  /** the measured number, human-formatted */
  value: string;
  /** one sentence an operator can act on */
  detail: string;
  session?: string;
  /** for the mem/swap rules at crit: the host's top processes by RSS, so the ledger names the
   * culprit even when it is not one of ours (2026-09-23: swap 100 %, every tracked tree < 6 G) */
  hostTop?: HostProc[];
}

const gb = (b: number) => (b / 1e9).toFixed(1) + "G";
const mib = (b: number) => (b / 1048576).toFixed(1) + "M";

/**
 * What the `mailbox` rule needs of the mailbox root's footprint. Structural on purpose: the messaging
 * adapter depends on core, never the other way round (adapters/messaging/mailbox.ts keeps the same
 * direction by holding the session-name rule as a literal rather than importing the tmux driver), so
 * this states the three fields instead of importing `MailboxFootprint`. `mailboxFootprint()` is
 * assignable to it, and the suites pass the real one in.
 */
export interface MailboxPressure {
  /** message files sitting unread across every inbox */
  pending: number;
  /** the agents holding them, named — a warning about rotting mail must say WHOSE */
  pendingAgents: string[];
  /** when the oldest unread message landed (ISO), null when nothing is pending */
  oldestPending: string | null;
}

/**
 * Pure evaluation — returns only breaches (ok rules are absent). `ledger` is the tool's own
 * footprint, `build` its running-vs-on-disk stamp and `mailbox` the mail nobody
 * has collected; callers without them (the CLI's one-shot paths) are simply not judged
 * on them.
 */
export function evaluateHealth(
  v: HostVitals,
  sessions: Array<{ session: string; rssBytes: number | null }>,
  t: HealthThresholds = DEFAULT_THRESHOLDS,
  ledger?: LedgerFootprint | null,
  build?: BuildStatus | null,
  mailbox?: MailboxPressure | null,
): HealthAlert[] {
  const alerts: HealthAlert[] = [];

  if (v.mem.totalBytes > 0) {
    const availPct = (v.mem.availableBytes / v.mem.totalBytes) * 100;
    const sev: Severity | null = availPct < t.memAvailCritPct ? "crit" : availPct < t.memAvailWarnPct ? "warn" : null;
    if (sev) {
      alerts.push({
        rule: "mem",
        sev,
        value: `${availPct.toFixed(1)}% available (${gb(v.mem.availableBytes)} of ${gb(v.mem.totalBytes)})`,
        detail: `host memory low: ${gb(v.mem.availableBytes)} available of ${gb(v.mem.totalBytes)}`,
      });
    }
  }

  if (v.swap && v.swap.totalBytes > 0) {
    const usedPct = ((v.swap.totalBytes - v.swap.freeBytes) / v.swap.totalBytes) * 100;
    const sev: Severity | null = usedPct >= t.swapUsedCritPct ? "crit" : usedPct >= t.swapUsedWarnPct ? "warn" : null;
    if (sev) {
      alerts.push({
        rule: "swap",
        sev,
        value: `${usedPct.toFixed(0)}% used`,
        detail: `swap in use (${usedPct.toFixed(0)}%) — leaking fleets swap before they OOM`,
      });
    }
  }

  for (const d of v.disk) {
    const sev: Severity | null = d.freeBytes < t.diskFreeCritBytes ? "crit" : d.freeBytes < t.diskFreeWarnBytes ? "warn" : null;
    if (sev) {
      alerts.push({
        rule: `disk:${d.path}`,
        sev,
        value: `${gb(d.freeBytes)} free`,
        detail: `low disk on ${d.path}: ${gb(d.freeBytes)} free`,
      });
    }
  }

  if (v.mem.totalBytes > 0) {
    for (const s of sessions) {
      if (s.rssBytes == null) continue; // no /proc — absent, never judged
      const pct = (s.rssBytes / v.mem.totalBytes) * 100;
      const sev: Severity | null = pct >= t.sessionRssCritPct ? "crit" : pct >= t.sessionRssWarnPct ? "warn" : null;
      if (sev) {
        alerts.push({
          rule: `session:${s.session}`,
          sev,
          value: `${gb(s.rssBytes)} (${pct.toFixed(0)}% of host RAM)`,
          detail: `session ${s.session} holds ${gb(s.rssBytes)} — ${pct.toFixed(0)}% of host RAM in one tree`,
          session: s.session,
        });
      }
    }
  }

  // The tool must notice when IT is what fills the disk. Warn-only — the disk rule above
  // owns the emergency tier — and judged on LIVE bytes, the number ledgerKeepDays controls.
  if (ledger && t.ledgerWarnBytes > 0 && ledger.bytes >= t.ledgerWarnBytes) {
    alerts.push({
      rule: "ledger",
      sev: "warn",
      value: `${mib(ledger.bytes)} in ${ledger.files} live day files`,
      detail: `ledger holds ${mib(ledger.bytes)} of live day files (oldest ${ledger.oldestDay ?? "n/a"}) — lower ledgerKeepDays in health.json to archive sooner, or raise ledgerWarnBytes`,
    });
  }

  // The same standard for the other directory the tool writes into a home — mail nobody
  // collected. Judged on the AGE of the oldest unread message, never the count: a message seconds old
  // is a fleet talking, and the measured failure was two messages sent to a name wrong by one
  // character that NOBODY would ever come back for. Warn-only (reading it is the operator's move) and
  // it recovers when the mail is read, so the banner tracks collection rather than sending.
  const waitHours = t.mailboxOldestPendingWarnHours;
  if (mailbox && waitHours > 0 && mailbox.pending > 0 && mailbox.oldestPending) {
    const hours = (Date.now() - Date.parse(mailbox.oldestPending)) / 3600_000;
    if (Number.isFinite(hours) && hours >= waitHours) {
      const who = mailbox.pendingAgents.join(", ");
      alerts.push({
        rule: "mailbox",
        sev: "warn",
        value: `${mailbox.pending} unread, oldest ${hours.toFixed(1)}h`,
        detail: `mail nobody collected: ${mailbox.pending} unread for ${who} — oldest ${hours.toFixed(1)}h old, past mailboxOldestPendingWarnHours (${waitHours}h). Read it (\`tmux-agent msg recv <agent>\`) — an agent that never collects may be a name wrong by one character — or raise the threshold in health.json (0 disables)`,
      });
    }
  }

  // The tool must notice when IT is not running what is on disk. Measured 2026-09-12: the
  // operator's dashboard served a 47-commit-stale build for 16 days and nothing said so. Warn-only —
  // the restart is the operator's call (the daemon may be KEEP-CRITICAL) — and judged on the stamp
  // pair alone, never on git: a tarball install with no commit still compares builtAt. The words are
  // the PAIR describer's: a rebuild at the same commit names both build times, where one
  // describeBuild() a side read "running 1a2b3c4, disk has 1a2b3c4" — measured live 2026-09-24 02:24Z.
  if (build?.stale) {
    const pair = describeBuildPair(build, build.onDisk);
    alerts.push({
      rule: "build",
      sev: "warn",
      value: `running ${pair.running}, disk has ${pair.onDisk}`,
      detail: `dashboard runs build ${pair.running} but dist/ now holds ${pair.onDisk} — restart tmux-agent web to pick it up`,
    });
  }

  return alerts;
}

/**
 * Holds last-known severity per rule and turns evaluation into transition EVENTS.
 * `notify` fires only for crit entries and crit recoveries — warn-level noise stays in the
 * ledger where it belongs.
 */
export class HealthWatcher {
  /** the current breach set, for /api consumers (banner, strip) — refreshed each observe() */
  current: HealthAlert[] = [];
  private last = new Map<string, Severity>();

  constructor(
    private readonly ledger: Ledger,
    private readonly notify?: (title: string, body: string) => unknown,
  ) {}

  /** When each rule last recovered (ms since epoch) — the clock the re-warn hold-down is measured from. */
  private readonly recoveredAt = new Map<string, number>();

  observe(
    v: HostVitals,
    sessions: Array<{ session: string; rssBytes: number | null }>,
    t: HealthThresholds = DEFAULT_THRESHOLDS,
    ledger?: LedgerFootprint | null,
    build?: BuildStatus | null,
    mailbox?: MailboxPressure | null,
    now?: number,
  ): HealthAlert[] {
    return this.apply(evaluateHealth(v, sessions, t, ledger, build, mailbox), { holdDownMs: t.rewarnHoldDownMinutes * 60_000, now });
  }

  /**
   * Transition bookkeeping over an externally-built alert set (H5 feeds predictions in here; the dashboard's health
   * tick calls this directly with the thresholds' hold-down). `last` is the ANNOUNCED state — what the ledger has been
   * told — so a held re-warn (below) is in neither `last` nor the ledger, and its clearing files no recovery.
   *
   * The re-warn hold-down: after a rule's `health.recovered`, a WARNING for that same rule inside
   * `holdDownMs` is not filed and not notified — a value hovering at one threshold is a transition on every tick, and on
   * 2026-10-13 a development host filed 12 swap warning/recovered rows between 03:56Z and 04:11Z that way, each pair a
   * notify's worth of ledger. The breach is still what is true now (`current` carries it; the banner shows it). A
   * CRITICAL inside the window is filed (from "ok": nothing was announced in between) and notified — safety is never
   * held. Per rule, measured from the recovery; 0 disables it. `now` is a test seam.
   */
  apply(alerts: HealthAlert[], opts: { holdDownMs?: number; now?: number } = {}): HealthAlert[] {
    const now = opts.now ?? Date.now();
    const hold = Math.max(0, opts.holdDownMs ?? 0);
    const announced = new Map<string, Severity>();
    for (const a of alerts) {
      const prev = this.last.get(a.rule);
      if (prev === a.sev) {
        announced.set(a.rule, a.sev);
        continue; // steady state: no event
      }
      const since = this.recoveredAt.get(a.rule);
      if (a.sev === "warn" && prev === undefined && since !== undefined && now - since < hold) continue; // held: a recovery is not re-warned
      this.ledger.emit({
        type: a.sev === "crit" ? "health.critical" : "health.warning",
        session: a.session,
        data: { rule: a.rule, value: a.value, detail: a.detail, from: prev ?? "ok", ...(a.hostTop && a.hostTop.length ? { hostTop: a.hostTop } : {}) },
      });
      if (a.sev === "crit") this.notify?.(`health CRITICAL: ${a.rule}`, a.detail);
      announced.set(a.rule, a.sev);
    }
    for (const [rule, prevSev] of this.last) {
      if (announced.has(rule)) continue;
      this.ledger.emit({ type: "health.recovered", data: { rule, from: prevSev } });
      this.recoveredAt.set(rule, now);
      if (prevSev === "crit") this.notify?.(`health recovered: ${rule}`, `${rule} back under threshold`);
    }
    this.last = announced;
    this.current = alerts;
    return alerts;
  }
}
