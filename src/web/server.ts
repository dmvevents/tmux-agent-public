/**
 * Web dashboard — the human view of the fleet, LOOPBACK-ONLY by design.
 *
 * Threat model: this server can read every pane and (policy permitting) type into them, so it
 * binds 127.0.0.1 and is reached through an SSH tunnel (`ssh -L 7337:localhost:7337 host`).
 * Binding any non-loopback address requires --dangerously-allow-remote AND an auth token —
 * the "never expose services publicly" rule is enforced in code, not convention.
 *
 * Prior art considered: agent-of-empires ships a web UI but is its own
 * orchestrator; ttyd shares ONE terminal; neither reads our ledger/lineage/policy. This is a
 * thin view over data tmux-agent already produces: fleet snapshots, lineage options, the
 * NDJSON ledger (active AND decommissioned sessions), and the audited send path.
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Tmux } from "../core/tmux.js";
import { Ledger } from "../core/ledger.js";
import { Policy } from "../core/policy.js";
import { Orchestrator } from "../core/orchestrator.js";
import { Monitor } from "../core/monitor.js";
import { redact } from "../core/redact.js";
import { LedgerIndex } from "../analytics/ledger-index.js";
import { archivedDaysInWindow, archivedWindowNote } from "../analytics/status.js";
import { computeEngagement, ENGAGEMENT_RANK } from "../core/engagement.js";
import { collectHostVitals } from "../core/health.js";
import { HealthWatcher, loadThresholds, evaluateHealth, HealthAlert, HealthThresholds } from "../core/healthwatch.js";
import { ledgerFootprint } from "../core/ledger-retention.js";
import { mailboxFootprint } from "../adapters/messaging/mailbox.js";
import { buildStatus, readBuildStamp, runningBuild } from "../core/build.js";
import { Blackbox } from "../core/blackbox.js";
import { predictExhaustion, Prediction } from "../core/trend.js";
import { processTree, hostTopProcesses } from "../core/activity.js";
import type { NotifySink } from "../adapters/notify/slack.js";
import { renderDashboardHtml, UNAUTHORIZED_HTML } from "./ui.js";

/**
 * Single-flight + TTL cache. Five open browser tabs must not become five concurrent fleet
 * sweeps (measured: 5 parallel naive polls took 2.76s and 700 tmux execs). Concurrent
 * callers share ONE in-flight computation; results are reused for `ttlMs`.
 */
function singleFlight<T>(fn: () => Promise<T>, ttlMs: number): (() => Promise<T>) & { invalidate(): void } {
  let inflight: Promise<T> | null = null;
  let value: T | null = null;
  let at = 0;
  const get = () => {
    const now = Date.now();
    if (value !== null && now - at < ttlMs) return Promise.resolve(value);
    if (inflight) return inflight;
    inflight = fn().then(
      (v) => { value = v; at = Date.now(); inflight = null; return v; },
      (e) => { inflight = null; throw e; },
    );
    return inflight;
  };
  // A TTL cache must never outlive a state CHANGE: spawning/killing a session has to show up
  // on the very next poll, or an operator sees a session that is already gone (or misses a new
  // one) for the length of the TTL. Mutating paths call invalidate().
  get.invalidate = () => { value = null; at = 0; };
  return get as (() => Promise<T>) & { invalidate(): void };
}

export interface WebOpts {
  port: number;
  host: string; // refuse non-loopback unless allowRemote
  allowRemote?: boolean;
  token?: string; // required when allowRemote — and then only the value the operator typed, never the stored file's; optional hardening on loopback
  /** where health.critical transitions go (H3) — the CLI passes its configured sink */
  sink?: NotifySink;
  /** already-loaded health.json thresholds (the CLI loads them once for retention + doctor); absent = load here */
  thresholds?: HealthThresholds;
  /**
   * TMUX_AGENT_PUBLIC_HINT / TMUX_AGENT_PUBLIC_URL: how a person reaches this UI when something else
   * serves it (a harness proxy). Rendered into the page's access note and printed by the CLI banner in place of
   * the `ssh -L` tunnel line; unset = the loopback sentence with the bound port. A sentence, never a bind.
   */
  publicHint?: string;
  publicUrl?: string;
  /** health-tick cadence in ms (default 30 s, floor 1 s) — the CLI passes TMUX_AGENT_HEALTH_TICK_MS; the suites tick fast to prove transitions without waiting on the wall clock */
  healthTickMs?: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * CSRF + DNS-rebinding defense. PROVEN NECESSARY: without this, any page the operator
 * visits could `fetch('http://127.0.0.1:7337/api/send', {method:'POST', ...})` and inject
 * arbitrary commands into an agent's terminal (verified exploit, 2026-08-25 — the request
 * succeeded and the command executed). A browser will happily send that request; only the
 * server can refuse it.
 *
 * Three independent checks, any failure = 403:
 *  1. Sec-Fetch-Site: browsers set this on every fetch; anything but same-origin/none is
 *     cross-site by the browser's own admission (non-browser clients omit it).
 *  2. Origin: if present, must be one of our own origins (a cross-site fetch cannot forge it).
 *  3. Host: must be a loopback literal — blocks DNS rebinding, where evil.com resolves to
 *     127.0.0.1 so the browser treats our API as same-origin for evil.com.
 */
export interface GuardHeaders {
  host?: string;
  origin?: string;
  "sec-fetch-site"?: string;
}

/** Pure predicate form — unit-testable without an HTTP server. Returns a reason, or null if allowed. */
export function checkBrowserOrigin(headers: GuardHeaders, port: number): string | null {
  const host = (headers.host ?? "").toLowerCase();
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(hostname)) return `Host header ${host} is not loopback (DNS-rebinding guard)`;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}`) {
    return `Host header ${host} does not match the bound port ${port}`;
  }
  const sfs = headers["sec-fetch-site"];
  if (typeof sfs === "string" && sfs !== "same-origin" && sfs !== "none") {
    return `cross-site request refused (Sec-Fetch-Site: ${sfs})`;
  }
  const origin = headers.origin;
  if (typeof origin === "string" && origin !== "null") {
    const ok = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    if (!ok.includes(origin.toLowerCase())) return `cross-origin request refused (Origin: ${origin})`;
  }
  return null;
}

function guardBrowserOrigin(req: IncomingMessage, port: number): string | null {
  return checkBrowserOrigin(
    {
      host: req.headers.host,
      origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
      "sec-fetch-site": typeof req.headers["sec-fetch-site"] === "string" ? (req.headers["sec-fetch-site"] as string) : undefined,
    },
    port,
  );
}

/**
 * Loopback is NOT a single-user boundary. On a shared host (dev VM, cluster login node) any
 * local UID can curl a loopback port — and this port can type into the operator's agents.
 * So a token is generated on first run, stored 0600, and required by default. The dashboard
 * URL printed at startup embeds it, so the human workflow is unchanged; `--no-token` is an
 * explicit opt-out for a single-user machine.
 */
export function resolveToken(home: string, explicit?: string, disable?: boolean): string | undefined {
  if (disable) return undefined;
  if (explicit) return explicit;
  const f = join(home, "web-token");
  try {
    const existing = readFileSync(f, "utf8").trim();
    if (existing) return existing;
  } catch { /* first run */ }
  const tok = randomBytes(24).toString("base64url");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(f, tok + "\n", { mode: 0o600 });
  return tok;
}

/** True for the hosts the dashboard may bind without an override (README "Security posture"). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host);
}

/**
 * The loopback decision — ONE function, called by the CLI before it opens any socket and again by
 * startWeb (a caller that bypasses the CLI still cannot bind remotely). Measured 2026-09-14
 * (probed on 192.0.2.1 so a passed guard could not listen): this check lived only in
 * startWeb, third in the web verb's order — after findFreePort had listen()ed on the requested host
 * up to twenty times and after resolveToken had read or minted the stored web-token. So smoke-web's
 * remote-bind step was green on 0.0.0.0 while a probe socket had sat on all interfaces for one
 * round-trip, and `--dangerously-allow-remote` alone passed the token half on the auto-generated
 * token where the README says both flags are required. Off loopback `token` is only ever the
 * value the operator typed (`--token <value>`): the CLI never passes the stored file's here, so that
 * file keeps serving loopback alone.
 */
export function assertBindAllowed(host: string, allowRemote: boolean | undefined, token: string | undefined): void {
  if (isLoopbackHost(host)) return;
  if (!allowRemote) throw new Error(`refusing to bind ${host}: loopback only (use ssh -L). Override requires --dangerously-allow-remote AND --token.`);
  if (!token) throw new Error(`--dangerously-allow-remote requires --token <value> — the stored web-token serves loopback only`);
}

/** The web verb's exit codes for a dashboard socket that never bound — stated once here, pinned by test/web-listen-error.test.js. */
export const EX_TEMPFAIL = 75; // the port is in use: another port will cure it (sysexits.h)
export const EX_OSERR = 71; // the OS refused the bind for a cause another port will not cure: a privileged port, a host not on this machine

/**
 * The ONE stderr line a bind that never happened gets — `tmux-agent web: listen <CODE> on <host>:<port> — <reason>`.
 * Node phrases a bind error `listen <CODE>: <reason> <host>:<port>`, so the reason is kept and the rest said
 * once; a message of any other shape is printed whole. Shared by startWeb's `error` handler (the --strict-port path) and
 * the web verb's finder path, so the same failure reads the same with or without the flag.
 */
export function bindFailureLine(e: NodeJS.ErrnoException, host: string, port: number): string {
  const reason = /^listen \S+: (.*) \S+:\d+$/.exec(e.message)?.[1] ?? e.message;
  return `tmux-agent web: listen ${e.code ?? e.name} on ${host}:${port} — ${reason}`;
}

export function startWeb(orch: Orchestrator, monitor: Monitor, tmux: Tmux, ledger: Ledger, policy: Policy, opts: WebOpts) {
  assertBindAllowed(opts.host, opts.allowRemote, opts.token);

  const ledgerDir = join(orch.home, "ledger");
  // The other directory the tool writes into a home — read per health tick and per
  // /api/health, exactly as the ledger's footprint is, and never created here: an absent root is an
  // empty footprint, which is what a home that has never sent a message must report.
  const mailboxDir = join(orch.home, "mailbox");
  const index = new LedgerIndex(ledgerDir);
  // deep-inspect only what a human selected; everything else uses the 2-exec fast path
  const focus = new Set<string>();
  // The health tick's profile pass: the last deep verdict per session, read with no side effects
  // (Monitor.peekProfiles), so a fast row can show the state a human would see on clicking it and say so. Entries
  // outlive one failed read and age out at two ticks; a row with no fresh verdict is labelled cpu-only.
  const tickMs = Math.max(1000, opts.healthTickMs ?? 30_000);
  const observed = new Map<string, { state: string | null; classifiedBy: string | null; contextPct: number | null; at: string }>();
  const FRESH_MS = tickMs * 2 + 5000;

  /**
   * "The history behind this answer was archived and I did not read it" — for the views that take no
   * caller-named window: /api/fleet's waste ranking, /api/history and
   * /api/timeline. One helper, so the four dashboard surfaces and the CLI/MCP ones cannot drift into
   * four phrasings of one fact (the wording itself is archivedWindowNote). No `since`: these
   * views ask about a session's whole life, so every day under archive/ is inside the question
   * (parseSince(undefined) === 0) and no filter logic exists here. No archive is OPENED — this is the
   * file NAMES, and the retention design's live-only reader rule is unchanged. An empty list is the honest empty
   * answer and renders nothing at all in the UI.
   */
  const archivedNotes = (): string[] => {
    const days = archivedDaysInWindow(ledgerDir);
    return days.length ? [archivedWindowNote(days)] : [];
  };

  // The CPU-delta tracker needs two samples; without priming, the first fleet render every
  // restart shows every session as UNKNOWN (and the 2s cache serves that to whoever looked).
  let primed = false;
  const fleet = singleFlight(async () => {
    if (!primed) {
      await monitor.fleetFast({ deep: [] }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1100));
      primed = true;
    }
    const { sessions: snaps, tmux: tmuxStatus } = await monitor.fleetFast({ deep: [...focus] });
    const detail = await tmux.listSessionsDetailed();
    const meta = new Map(detail.map((d) => [d.name, d]));
    // census/supervisor enrichment (role, verdict, repo@branch) — the only lineage adopted
    // sessions have, since they carry no tmux user-options and no spawn event
    const rolls = new Map(index.sessions().map((r) => [r.session, r]));
    const rows = snaps.map((s) => {
      const m = meta.get(s.session);
      const enrich = rolls.get(s.session)?.meta ?? null;
      return {
        ...s,
        parent: m?.parent ?? enrich?.parent ?? null,
        task: m?.task ?? null,
        owner: m?.owner ?? null,
        windows: m?.windows ?? 1,
        attached: m?.attached ?? false,
        meta: enrich,
      };
    });
    // Provenance: where this row's state came from. A deep-inspected row (the focus set) carries its own
    // profile verdict; a fast row carries the tick's last verdict when a profile spoke within FRESH_MS — state,
    // classifiedBy and contextPct become that verdict — else its CPU verdict, labelled cpu-only. DEAD and GONE are the
    // server's word about the pane and are never overridden. Measured 2026-10-13: 26 of 31 WORKING by CPU where the
    // classifier said 8, and a parked codex menu IDLE until clicked — the waiting session the north star is about.
    const now = Date.now();
    const ageOf = (iso: string) => Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    const withProvenance = rows.map((r) => {
      if (r.classifiedBy) return { ...r, observed: { source: "profile" as const, profile: r.classifiedBy, at: r.at, ageSecs: ageOf(r.at) } };
      const o = observed.get(r.session);
      const fresh = o !== undefined && now - Date.parse(o.at) <= FRESH_MS;
      if (fresh && o.state !== null && o.classifiedBy && r.state !== "DEAD" && r.state !== "GONE") {
        return { ...r, state: o.state as typeof r.state, classifiedBy: o.classifiedBy, contextPct: r.contextPct ?? o.contextPct, observed: { source: "profile" as const, profile: o.classifiedBy, at: o.at, ageSecs: ageOf(o.at) } };
      }
      return { ...r, observed: { source: "cpu" as const, profile: null, at: r.at, ageSecs: ageOf(r.at) } };
    });
    // engagement: who is actually being driven right now (see core/engagement.ts)
    const eng = computeEngagement(withProvenance.map((r) => ({ session: r.session, state: r.state, attached: r.attached, parent: r.parent })), index);
    const withEng = withProvenance.map((r) => ({ ...r, ...(eng.get(r.session) ?? {}) }));
    // hot spots first: an operator should not have to hunt for the sessions being steered
    withEng.sort((a, b) => (ENGAGEMENT_RANK[a.engagement!] ?? 9) - (ENGAGEMENT_RANK[b.engagement!] ?? 9) || a.session.localeCompare(b.session));
    return { rows: withEng, tmux: tmuxStatus };
  }, 2000);

  /**
   * H3: the dashboard server is the fleet's long-lived process, so it carries the health
   * sampler. This is a deliberate semantic change from "poll only when a browser asks":
   * alarms and the crash black box are worthless if they only run while someone watches.
   * Cost: one fleet() (2 tmux execs + 1 /proc pass, shared with the request cache) per 30s.
   * A failed tick must never take the server down — health is observability, not load-bearing.
   */
  const thresholds = opts.thresholds ?? loadThresholds(orch.home);
  const watcher = new HealthWatcher(ledger, opts.sink ? (t, b) => void opts.sink!.notify(t, b).catch(() => {}) : undefined);

  // tmux-server death rides the SAME notify sink as health criticals — one page on the
  // way down, one on the way back up, never per poll (the transition gating lives in the Monitor).
  // Losing the tmux server is the fleet's worst failure; it must reach the operator, not just the
  // ledger. Set only here, so the CLI's `watch`/`status` (same Monitor class) never page on it.
  if (opts.sink) {
    monitor.onTmuxTransition = (st) => {
      const [title, body] = st.reachable
        ? ["tmux server reachable", `tmux server is answering again (since ${st.since})`]
        : ["tmux server UNREACHABLE", `tmux server unreachable since ${st.since}${st.error ? ` — ${st.error}` : ""}`];
      void opts.sink!.notify(title, body).catch(() => {});
    };
  }

  // H4: the black box. Startup answers "did the host die under us last time?" — a heartbeat
  // that predates this boot with no clean-shutdown marker after it is a suspected host crash,
  // and the final pre-crash snapshot names the top memory consumers of the last known moment.
  const bb = new Blackbox(orch.home);
  const crashCheck = bb.checkUncleanShutdown();
  if (crashCheck.suspected) {
    bb.noteCrash(crashCheck);
    ledger.emit({
      type: "host.crash-suspected",
      data: {
        lastHeartbeatAt: crashCheck.lastHeartbeatAt,
        top: crashCheck.lastSnapshot?.top ?? [],
        availableBytes: crashCheck.lastSnapshot?.mem.availableBytes ?? null,
      },
    });
  }
  const onStop = (sig: NodeJS.Signals) => { bb.markCleanShutdown(); process.kill(process.pid, sig); };
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  // SIGHUP too — the pane's hangup. In the pane form this daemon commonly runs in
  // (`sh -c "cd … && node … web --port 7337; exec bash"`, same pgid and tty as its sh) an orderly host
  // shutdown stops the user's session scope, the tmux server tears its panes down and the pty hangup
  // reaches this process before the SIGTERM handler above gets an event-loop turn; node's default for
  // SIGHUP is to die at once, so no marker was written and the next start called a power-off a crash.
  // Measured 2026-09-28: on an orderly power-off the heartbeat was written about a second before logind's power-key
  // event, the clean-shutdown marker was still the previous day's, and the next start ledgered host.crash-suspected. A hangup is a
  // stop the host chose: the marker is written first and the process still exits by SIGHUP — no reload
  // semantics. A real host crash delivers no signal at all, so hooking one masks nothing.
  process.once("SIGHUP", onStop);

  // H5: prediction rides the same tick — served on /api/health, alarmed through the watcher
  let lastPrediction: Prediction | null = null;

  // What this process is RUNNING against what dist/ holds now. The running stamp is fixed
  // at start; the on-disk one is re-read per call (one small file), so /api/health answers per
  // request and the tick alarms through the watcher — the same split the ledger footprint uses.
  const running = runningBuild();
  const build = () => buildStatus(running, readBuildStamp());

  const healthTick = async () => {
    try {
      const { rows } = await fleet();
      // the profile pass over every listed session — reads only; a pane that fails to read keeps its last
      // verdict until it ages out, a session no longer listed is forgotten
      const peek = await monitor.peekProfiles(rows.map((r) => r.session)).catch(() => null);
      if (peek) {
        for (const [name, verdict] of peek) observed.set(name, verdict);
        const listed = new Set(rows.map((r) => r.session));
        for (const name of [...observed.keys()]) if (!listed.has(name)) observed.delete(name);
      }
      const vitals = collectHostVitals(orch.home);
      // host-wide top-8 by RSS (names only): the black box and the mem/swap crit events name the
      // culprit even when it is not a pane tree — the 2026-09-23 crash's swap fill was not ours
      const hostTop = hostTopProcesses(8);
      bb.record(vitals, rows, hostTop);
      lastPrediction = predictExhaustion(bb.tail(40));
      // The tick is the daemon's retention trigger too — a quiet fleet may write nothing
      // for hours, so day rollover alone would never fire. A no-op after its first run each day;
      // the footprint judged below is the post-sweep one.
      ledger.sweep();
      const alerts: HealthAlert[] = evaluateHealth(vitals, rows, thresholds, ledgerFootprint(ledgerDir), build(), mailboxFootprint(mailboxDir));
      if (lastPrediction) {
        const p = lastPrediction;
        const who = p.culprits.length ? ` — driven by ${p.culprits.map((c) => c.session).join(", ")}` : "";
        alerts.push({
          rule: "prediction",
          sev: p.etaMinutes < 10 ? "crit" : "warn",
          value: `~${p.etaMinutes}min`,
          detail: `~${Math.round(p.etaMinutes)} min to OOM at current trend${who}`,
        });
      }
      for (const a of alerts) if (a.sev === "crit" && (a.rule === "mem" || a.rule === "swap")) a.hostTop = hostTop;
      // the thresholds' re-warn hold-down rides along: a rule hovering at its threshold is one warning and
      // one recovery per window, not a pair per tick
      watcher.apply(alerts, { holdDownMs: thresholds.rewarnHoldDownMinutes * 60_000 });
    } catch { /* next tick retries; the ledger already has whatever failed upstream */ }
  };
  void healthTick();
  const healthTimer = setInterval(healthTick, tickMs);
  healthTimer.unref(); // never the reason a short-lived embedder cannot exit

  let lastLiveCount = -1;
  const history = singleFlight(async () => {
    const live = new Set((await tmux.listSessions()).map((s) => s.name));
    return index
      .sessions(true) // force: the 1s scan limiter must not hide a just-recorded spawn/kill
      .map((r) => ({ session: r.session, parent: r.parent, task: r.task, spawnedAt: r.spawnedAt, killedAt: r.killedAt, live: live.has(r.session), verdict: r.meta?.verdict ?? null }))
      .sort((a, b) => (b.spawnedAt ?? "").localeCompare(a.spawnedAt ?? ""));
  }, 3000);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const denied = guardBrowserOrigin(req, opts.port);
    if (denied) {
      ledger.emit({ type: "control.denied", actor: "web", data: { reason: denied, path: url.pathname, method: req.method } });
      return send(res, 403, { error: denied });
    }
    // Served BEFORE the auth gate on purpose: browsers auto-request /favicon.ico, and a 401 there
    // is a permanent red error in the operator's console that masks genuine failures. It exposes
    // no data — it is a static inline SVG.
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
        '<rect width="16" height="16" rx="3" fill="#0f1420"/>' +
        '<rect x="3" y="4" width="10" height="2" fill="#37b26c"/>' +
        '<rect x="3" y="7" width="7" height="2" fill="#5b8def"/>' +
        '<rect x="3" y="10" width="4" height="2" fill="#8494b4"/></svg>';
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=86400" });
      return res.end(svg);
    }
    if (opts.token) {
      const cookie = /(?:^|;\s*)ta_token=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const got =
        req.headers.authorization?.replace(/^Bearer /, "") ??
        url.searchParams.get("token") ??
        (cookie ? decodeURIComponent(cookie) : undefined);
      if (got !== opts.token) {
        /**
         * A browser asking for a PAGE must get a page, not raw JSON. Reported as "I click on
         * tmux and nothing happens / the button doesn't work": an operator opening
         * http://localhost:7337 without the token saw `{"error":"unauthorized …"}` rendered as
         * bare text — no UI, nothing clickable — which is indistinguishable from a broken app.
         * API callers still get machine-readable JSON.
         */
        const wantsHtml = (req.headers.accept ?? "").includes("text/html");
        if (wantsHtml) {
          res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
          return res.end(UNAUTHORIZED_HTML);
        }
        return send(res, 401, { error: "unauthorized — append ?token=… (printed at startup, also in ~/.tmux-agent/web-token)" });
      }
    }
    try {
      if (req.method === "GET" && url.pathname === "/") {
        const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
        if (opts.token) headers["set-cookie"] = `ta_token=${encodeURIComponent(opts.token)}; Path=/; HttpOnly; SameSite=Strict`;
        res.writeHead(200, headers);
        // The note names the port the socket BOUND (the CLI may have scanned forward from the one asked for),
        // or the operator's own words when a proxy serves the page.
        const bound = server.address();
        const boundPort = bound !== null && typeof bound === "object" ? bound.port : opts.port;
        return res.end(renderDashboardHtml({ port: boundPort, publicHint: opts.publicHint, publicUrl: opts.publicUrl }));
      }
      if (req.method === "GET" && url.pathname === "/api/fleet") {
        const f = await fleet();
        // alerts = the LEDGERED breach set from the last health tick (H3) — the banner's source.
        // While tmux is unreachable prepend a crit entry synthesised from THIS poll's
        // status, so the banner shows it on the very poll that detects the death, not 30s later
        // when the health tick next runs. It rides the same alerts[] the banner already reads.
        const alerts = f.tmux.reachable
          ? watcher.current
          : [
              {
                rule: "tmux",
                kind: "tmux.unreachable",
                sev: "crit",
                since: f.tmux.since,
                value: "unreachable",
                detail: `tmux server unreachable since ${f.tmux.since}${f.tmux.error ? ` (${f.tmux.error})` : ""}`,
              },
              ...watcher.current,
            ];
        // The waste ranking below reads LIVE days only (LedgerIndex, by design),
        // so when history has been archived under this home the panel ranked a TRUNCATED window, not
        // an empty one. `notes` qualifies the answer in the SAME wording the CLI verb and the MCP
        // tool print (archivedWindowNote) — never a second phrasing, and never an alerts[]
        // entry: alerts is the ledgered breach set the banner reads, and a window the reader declined
        // to open is not a breach. The panel has no caller-named window, so every archived day is
        // inside it (parseSince(undefined) === 0) and no filter logic is added. Cost: one readdir of
        // ledger/archive per poll — the same one /api/health's ledgerFootprint already pays for.
        // (The two lines this was are factored into `archivedNotes` above, unchanged in wording.)
        return send(res, 200, { generatedAt: new Date().toISOString(), readOnly: policy.isReadOnly(), sessions: f.rows, waste: index.waste(8), notes: archivedNotes(), alerts, tmux: f.tmux });
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        // sampled per request (two file reads + two statfs + one readdir of ledger/ and of mailbox/) —
        // scrape-friendly for an operator who already runs monitoring; the dashboard strip is just
        // another consumer. prediction/lastCrash come from the daemon's tick + black box (H4/H5);
        // ledger is the tool's own footprint, live and archived counted apart; mailbox is
        // the mail nobody has collected, the same block doctor prints minus its `dir` (until
        // it landed, three messages rotting one directory from the ledger this payload does
        // report were on no surface the dashboard polls); build is the stamp this process
        // runs, the one on disk now, and whether they differ; tmux is the Monitor's last
        // fleet-poll verdict — kept fresh by the H3 tick, so the endpoint stays the cheap
        // per-request sampler (no tmux exec per scrape) and a scraper learns of the server's death
        // from the daemon's own tick, not from a browser happening to poll /api/fleet.
        return send(res, 200, { ...collectHostVitals(orch.home), ledger: ledgerFootprint(ledgerDir), mailbox: mailboxFootprint(mailboxDir), build: build(), prediction: lastPrediction, tmux: monitor.tmuxStatus(), lastCrash: bb.lastCrash() });
      }
      if (req.method === "GET" && url.pathname === "/api/history") {
        // cheap freshness guard: if the live session set changed since the cached view, drop it
        const liveNow = (await tmux.listSessions()).length;
        if (liveNow !== lastLiveCount) { lastLiveCount = liveNow; history.invalidate(); fleet.invalidate(); }
        /**
         * An ENVELOPE, not the bare array this answered with before. The rows come from
         * LedgerIndex — live days only — so on a home whose history has been archived this
         * silently DROPPED every session that lives only in the archive, under a panel headed "from
         * ledger — live + decommissioned": measured on an earlier build, 134 bytes before and 134 bytes after
         * two archived days appeared under the running server, byte-identical.
         *
         * Why an envelope and not a key the History panel already reads: there is none. Every key in
         * this payload belongs to ONE session row (`session`, `parent`, `live`, …), so a fleet-wide
         * note would have to be smuggled onto an arbitrary row or into a row of its own — either one
         * a lie about a session. `sessions` + `notes` is the shape /api/fleet already answers with, so
         * the UI reads the same two names on both polls. The HTTP API is private by declaration
         * (VERSIONING.md:120 — "treat it as private"), so the shape owes semver nothing; src/web/ui.ts
         * is the only consumer in the tree and moves with it.
         */
        return send(res, 200, { sessions: await history(), notes: archivedNotes() });
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/session/")) {
        const name = decodeURIComponent(url.pathname.slice("/api/session/".length));
        focus.add(name);                       // selected -> deep-classified on later fleet polls
        if (focus.size > 8) focus.delete([...focus][0]);
        const snapshot = await monitor.snapshot(name);
        let info = null, pane = "";
        if (snapshot.state !== "GONE") {
          info = await tmux.paneInfo(name).catch(() => null);
          pane = redact(await tmux.capturePane(name, 60).catch(() => ""));
        }
        let logTail = "";
        try {
          const raw = readFileSync(join(orch.home, "logs", `${name}.log`), "utf8");
          logTail = redact(raw.split("\n").slice(-80).join("\n"));
        } catch { /* no log */ }
        // H2 deep dive: which CHILD of this session is eating the box. Top 12 by RSS —
        // process names only, never argv (argv can carry tokens/paths a pane would redact).
        const procs = info?.pid ? processTree(info.pid).slice(0, 12) : [];
        return send(res, 200, { snapshot, info, pane, procs, logTail, events: index.events(name, 60) });
      }
      /**
       * This was decided, rather than forgotten, for the other two live-only readers here. Neither carries the
       * archived-window note, for two different reasons a reviewer can disagree with:
       *  - `/api/session.events` (above) is the detail panel's recent-events list, and the Timeline
       *    panel DIRECTLY BELOW IT in that same pane now carries the note. One qualification per pane
       *    is the honest count; two copies of one sentence in one view is noise, not disclosure.
       *  - `/api/events` has no consumer in src/web/ui.ts at all (grep finds none) — it is a raw tail
       *    for a scraper, and the tool's machine-readable answer about archived history is
       *    /api/health.ledger's archiveFiles/archiveBytes, which every scraper of this API already has.
       * If either grows a reader, `archivedNotes()` is one call away.
       */
      if (req.method === "GET" && url.pathname === "/api/events") return send(res, 200, index.events(undefined, 120));
      if (req.method === "GET" && url.pathname.startsWith("/api/timeline/")) {
        /**
         * A session's life as durations, not a raw event list. The ledger already records every
         * state transition; nobody was consuming it. "WORKING 2h -> IDLE 15m -> ERROR 40m" is
         * the difference between "it is stuck" and "it finished and went quiet" — the single
         * most-requested diagnostic at fleet scale.
         */
        const name = decodeURIComponent(url.pathname.slice("/api/timeline/".length));
        const evs = index.events(name, 400, true);
        const spans: Array<{ state: string; from: string; to: string | null; seconds: number | null; note?: string }> = [];
        let cur: { state: string; from: string } | null = null;
        const marks: Array<{ ts: string; type: string; detail: string }> = [];
        for (const e of evs) {
          if (e.type === "session.state") {
            const to = String((e.data as { to?: string })?.to ?? "UNKNOWN");
            // Coalesce repeats: a restart re-emits the same state, which would otherwise show
            // as two adjacent IDLE bars and make a long quiet period look like activity.
            if (cur && cur.state === to) continue;
            if (cur) {
              spans.push({ state: cur.state, from: cur.from, to: e.ts, seconds: Math.round((Date.parse(e.ts) - Date.parse(cur.from)) / 1000) });
            }
            cur = { state: to, from: e.ts };
          } else if (e.type === "input.sent" || e.type === "exec.done" || e.type === "exec.timeout" || e.type === "session.spawned" || e.type === "session.killed" || e.type === "capture.rotated" || e.type === "control.denied") {
            const d = (e.data ?? {}) as Record<string, unknown>;
            const detail =
              e.type === "input.sent" ? String(d.preview ?? "").slice(0, 90) :
              e.type === "exec.done" ? `exit ${d.exitCode}` :
              // a timed-out exec has no exit code; without this mark it read exactly like one still running
              e.type === "exec.timeout" ? `timeout after ${d.timeoutMs}ms` :
              e.type === "session.spawned" ? String(d.cwd ?? "") :
              e.type === "control.denied" ? String(d.reason ?? d.action ?? "") : "";
            marks.push({ ts: e.ts, type: e.type, detail });
          }
        }
        if (cur) spans.push({ state: cur.state, from: cur.from, to: null, seconds: Math.round((Date.now() - Date.parse(cur.from)) / 1000), note: "current" });
        /**
         * The same note, on the view an operator opens per session. This one was not merely
         * silent — a session whose whole life had been archived answered `{spans:[],marks:[]}`, and the
         * UI's empty branch rendered "sessions spawned before tmux-agent existed have none". Both
         * halves were false: the tool observed that session, and its own retention sweep gzipped the
         * history (measured on an earlier build — an archived spawn, ERROR transition and kill, all three
         * present under archive/). A confident wrong answer about the tool's own data is worse than
         * silence, so the note replaces that sentence whenever there IS an archive, and the sentence
         * stays for the honest case (no archive anywhere), where it is still true.
         */
        return send(res, 200, { session: name, spans: spans.slice(-40), marks: marks.slice(-40), notes: archivedNotes() });
      }
      if (req.method === "POST" && url.pathname === "/api/send") {
        const body = JSON.parse(await readBody(req)) as { name: string; text: string; enter?: boolean };
        if (!body?.name || typeof body.text !== "string") return send(res, 400, { error: "need {name, text}" });
        // same policy + verified path + audit ledger as CLI/MCP — the web UI gets no special powers
        const verified = await orch.sendVerified(body.name, body.text, { enter: body.enter ?? true });
        return send(res, verified ? 200 : 502, { verified });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      // A policy refusal is the server working as configured, not a fault — and the 500 it used
      // to return surfaced as a browser console error on every read-only send attempt.
      return send(res, msg.startsWith("policy:") ? 403 : 500, { error: msg });
    }
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    // A RUNNING daemon's error — `accept EMFILE`/`ENFILE`, what libuv reports under file-descriptor pressure once
    // the socket is listening — is the boundary's, not a bind failure: rethrown, it reaches installErrorBoundary
    // as an uncaughtException, is recorded to the ledger and stderr, and the dashboard keeps serving (the
    // moment visibility matters most is exactly when the host is under pressure). Nothing awaits once() by
    // then. Code review caught that exiting here would have taken a live dashboard down. Everything
    // below this line is a bind that never happened.
    if (server.listening) throw e;
    if (e.code === "EADDRINUSE") {
      console.error(`tmux-agent web: port ${opts.port} already in use on ${opts.host} — pick another with --port, or let the CLI auto-scan (default)`);
      process.exit(EX_TEMPFAIL);
    }
    // Every OTHER bind failure exits too — from here, never by rethrowing. Until 2026-09-30 this
    // handler ended by rethrowing the error, which left emit("error") before once(server, "listening")'s own
    // rejection listener in the web verb could run, surfaced as an uncaughtException, and the process boundary
    // the verb installs just before startWeb (src/core/boundary.ts — record it, keep serving) wrote one
    // `[web] uncaughtException: listen EACCES …` line and kept the process alive; the readiness wait stayed
    // pending, a pending promise holds nothing open, the loop drained and node exited 0 — no banner, a success
    // code on a failure. Measured on an earlier built CLI:
    // EACCES planted on this listen() → exit 0 after 1,245 ms; `--strict-port --dangerously-allow-remote
    // --token <typed> --host 192.0.2.1` → exit 0 after 1,241 ms, EADDRNOTAVAIL — a typo in a pinned tunnel
    // host reaches this. One line naming the code, host and port — node phrases a bind error
    // `listen <CODE>: <reason> <host>:<port>`, so the reason is kept and the rest said once; a message of
    // any other shape is printed whole (bindFailureLine, above) — then EX_OSERR: the OS refused the bind for a
    // cause another port will not cure (a privileged port, a host not on this machine), unlike the in-use port
    // above, which is the temporary failure 75 is for.
    console.error(bindFailureLine(e, opts.host, opts.port));
    process.exit(EX_OSERR);
  });
  server.listen(opts.port, opts.host);
  return server;
}

/**
 * Find the first free port at or after `start` on `host` (collision-proof default). Only EADDRINUSE moves the scan on —
 * the one bind error the next port can cure; the give-up after `tries` ports in use is the Error with no `code` below.
 * Any other error — EACCES on a privileged port, EADDRNOTAVAIL on a host not on this machine — rejects at once with the
 * probe's own error (`code`, `address` and `port` as node fills them) for the caller to name: the web verb prints
 * bindFailureLine and exits EX_OSERR, the same line and code --strict-port gets from startWeb's handler. Until 2026-09-30
 * every probe error advanced the scan, so `web --no-token --port 80` as a normal user burned twenty EACCES probes on
 * 80..99 and gave up with `no free port in 80..99 on 127.0.0.1`, exit 1, EACCES named nowhere — port pressure blamed for
 * a permission error, and an operator sent looking for a squatter (measured on an earlier built CLI:
 * 20 listen() calls, exit 1 after 81 ms; `--host 192.0.2.1` with both
 * remote flags: 20 EADDRNOTAVAIL, 83 ms; the same two under --strict-port: one listen(), the code named, exit 71).
 */
export function findFreePort(start: number, host: string, tries = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (p: number) => {
      if (p >= start + tries) return reject(new Error(`no free port in ${start}..${start + tries - 1} on ${host}`));
      const probe = createServer();
      probe.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? attempt(p + 1) : reject(e)));
      probe.once("listening", () => probe.close(() => resolve(p)));
      probe.listen(p, host);
    };
    attempt(start);
  });
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 1_000_000) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}
