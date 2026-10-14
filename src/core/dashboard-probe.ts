/**
 * `doctor` sees the running daemon.
 *
 * Measured 2026-09-12 on a development host: the operator's dashboard — started 2026-08-26
 * on an older build, on 127.0.0.1 at the web verb's default port, its token in the same home doctor
 * reads — served /api/health with no `build` key, while `doctor` on the same disk printed
 * `build.commit` (the disk's commit) and nothing about the daemon. The build stamp's stale alarm (core/build.ts) runs
 * INSIDE the daemon, so a daemon older than the stamp can never raise it: the observable that says
 * "restart to pick up" only existed once the operator had already restarted onto a build that has
 * it. doctor is the verb the README sends a stranger to, and it reported the disk as if it were the
 * product.
 *
 * This module is the CLI side of the observable: one GET to the dashboard's /api/health, judged
 * into a report a stranger can read without knowing the key set.
 *   - The host is the literal loopback address. Never a flag, never an env var: the dashboard binds
 *     nowhere else without --dangerously-allow-remote, and doctor has no business on another
 *     machine (test/doctor-dashboard.test.js asserts this on the built source).
 *   - The port is --port's (default the web verb's), because that is where the operator started it.
 *   - Authorization: Bearer <home>/web-token when that 0600 file exists — read, sent, never returned
 *     in the report or in any error text.
 *   - ~1.5 s timeout; every outcome is a value, none is an exception. doctor is a report, not a
 *     gate: a missing, unauthorized, silent or stale daemon leaves its exit code at 0.
 *   - The verdict is the CLI's own: the daemon's running stamp against dist/build.json beside THIS
 *     binary, by the same rule as buildStatus() (commit OR builtAt differs); a daemon that already
 *     says stale:true is stale — the CLI agrees rather than recomputing differently.
 *   - The daemon's own tmux verdict — /api/health.tmux, its last fleet poll — is carried as
 *     `tmux` (null when the daemon does not report it: a 2026-08-26 daemon, or one that has not
 *     polled yet), and every reason judged from a health object ends with one clause: `; tmux server
 *     UNREACHABLE since <since> (<error>)`, `; tmux server reachable`, or `; tmux status not reported
 *     by this daemon`. Measured 2026-09-16 on an earlier build: the daemon's tick had ledgered fleet.tmux and
 *     paged within 3 s of a kill-server while this report said "dashboard runs the build on disk".
 */
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { describeBuild, describeBuildPair, readBuildStamp, type BuildStamp } from "./build.js";

/** The web verb's default port — `doctor --port` defaults to the same, so the two cannot drift. */
export const DEFAULT_WEB_PORT = 7337;

/** The daemon's own stamp, as /api/health.build reports it. */
export interface DashboardBuild extends BuildStamp {
  startedAt: string | null;
  processUptimeSec: number | null;
}

/** The daemon's last fleet-poll verdict on its tmux server, as /api/health.tmux reports it. */
export interface DashboardTmux {
  reachable: boolean;
  since: string | null;
  error: string | null;
  /** when the daemon last polled — a stale value here is a dead tick, not a live server */
  checkedAt: string | null;
}

export interface DashboardReport {
  url: string;
  /** something answered on the port — a 401 or a daemon older than the stamp is still reachable */
  reachable: boolean;
  /** the daemon's stamp; null when unreachable, unauthorized, or the daemon predates the stamp */
  build: DashboardBuild | null;
  /** dist/build.json beside THIS binary, right now — what a restart would run; null when unreadable */
  onDisk: { commit: string | null; builtAt: string | null } | null;
  /** true/false once both sides are known; null when the comparison cannot be made */
  stale: boolean | null;
  /** the daemon's own tmux verdict; null when unreachable, unauthorized, or the daemon does not report it */
  tmux: DashboardTmux | null;
  /** one sentence for a human: what was found and, when it applies, the remedy — ending with the tmux clause when a daemon answered */
  reason: string;
}

interface Judged {
  url: string;
  port: number;
  onDisk: DashboardReport["onDisk"];
  tokenFile: string;
  hadToken: boolean;
}

const errCode = (e: unknown): string => (e as NodeJS.ErrnoException | undefined)?.code ?? (e instanceof Error ? e.message : String(e));

/** GET /api/health on the loopback dashboard and judge the answer. Never throws; never prints the token. */
export function probeDashboard(home: string, port: number = DEFAULT_WEB_PORT, timeoutMs = 1500): Promise<DashboardReport> {
  const url = `http://127.0.0.1:${port}/api/health`;
  const disk = readBuildStamp();
  const onDisk = disk ? { commit: disk.commit, builtAt: disk.builtAt } : null;
  const unreachable = (why: string): DashboardReport => ({ url, reachable: false, build: null, onDisk, stale: null, tmux: null, reason: `no dashboard on 127.0.0.1:${port} (${why})` });
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ url, reachable: false, build: null, onDisk, stale: null, tmux: null, reason: `invalid port ${port} — nothing probed` });
  }
  const tokenFile = join(home, "web-token");
  let token: string | undefined;
  try {
    token = readFileSync(tokenFile, "utf8").trim() || undefined;
  } catch {
    /* no token file: the dashboard may run --no-token, or was started from another home — judged on the answer */
  }
  return new Promise((resolve) => {
    let done = false;
    // one clock for the whole exchange (connect + headers + body): a wedged daemon that accepts and
    // never answers must not wedge doctor. finish() first, then abort — the abort's own error event
    // is then a no-op through the `done` guard.
    const ac = new AbortController();
    const timer = setTimeout(() => {
      finish(unreachable(`timed out after ${timeoutMs} ms — a listener that never answers`));
      ac.abort();
    }, timeoutMs);
    const finish = (r: DashboardReport) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = request(
      { host: "127.0.0.1", port, path: "/api/health", method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {}, signal: ac.signal },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => { if (body.length < 1 << 20) body += c; });
        res.on("end", () => finish(judge(res.statusCode ?? 0, body, { url, port, onDisk, tokenFile, hadToken: token !== undefined })));
        res.on("error", (e) => finish(unreachable(`${errCode(e)} after the headers arrived`)));
      },
    );
    req.on("error", (e) => finish(unreachable(errCode(e))));
    req.end();
  });
}

/** Turn a status + body into the report. Split out so the rule reads top to bottom. */
function judge(status: number, body: string, c: Judged): DashboardReport {
  const at = `127.0.0.1:${c.port}`;
  const answered = (patch: Partial<DashboardReport> & { reason: string }): DashboardReport =>
    ({ url: c.url, reachable: true, build: null, onDisk: c.onDisk, stale: null, tmux: null, ...patch });
  if (status === 401) {
    // say what is POSSIBLE, not which it is: the daemon may have been started with --token, or
    // from another home whose web-token is not this one
    const file = c.hadToken ? `${c.tokenFile} does not match it` : `${c.tokenFile} is missing`;
    return answered({ reason: `unauthorized — the dashboard on ${at} requires a token and ${file} (started with --token, or from another home?)` });
  }
  if (status !== 200) return answered({ reason: `HTTP ${status} from ${c.url} — not a tmux-agent dashboard, or one that refused the request` });
  let h: Record<string, unknown> | null = null;
  try {
    const j: unknown = JSON.parse(body);
    if (j && typeof j === "object" && !Array.isArray(j)) h = j as Record<string, unknown>;
  } catch {
    /* judged below */
  }
  if (!h) return answered({ reason: `${at} answered /api/health but not as a tmux-agent dashboard (not a JSON object)` });
  // The daemon's own tmux verdict rides every reason judged from a health object — one
  // sentence tells a stranger about the fleet's worst failure, not only the build's state
  const tmux = judgeTmux(h.tmux);
  const health = (patch: Partial<DashboardReport> & { reason: string }): DashboardReport => answered({ tmux, ...patch, reason: `${patch.reason}${tmuxClause(tmux)}` });
  if (h.build === undefined) {
    // the 2026-08-26 key set — vitals, no stamp: a daemon started before the build stamp existed (2026-09-12). Its
    // own build rule cannot fire (it has none), so this line is the only surface that can say so.
    if (!("sampledAt" in h || "uptimeSec" in h || "mem" in h)) return answered({ reason: `${at} answered /api/health but not as a tmux-agent dashboard (no build, no vitals)` });
    return health({ reason: `daemon predates the build stamp (started before build stamps existed, 2026-09-12) — restart to pick up ${describeBuild(c.onDisk)}` });
  }
  const b = h.build as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return health({ reason: `${at} answered with a build key that is not a stamp (${JSON.stringify(h.build)})` });
  const s = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const build: DashboardBuild = {
    version: s(b.version),
    commit: s(b.commit),
    builtAt: s(b.builtAt),
    startedAt: s(b.startedAt),
    processUptimeSec: typeof b.processUptimeSec === "number" ? b.processUptimeSec : null,
  };
  const daemonSaysStale = b.stale === true;
  if (c.onDisk === null && !daemonSaysStale) {
    return health({ build, reason: `dashboard runs ${describeBuild(build)}; no dist/build.json beside this binary, so there is nothing to compare it with` });
  }
  // same rule as buildStatus(): commit OR builtAt differs — a rebuild at the same commit is still code the daemon is not running
  const differs = c.onDisk !== null && (c.onDisk.commit !== build.commit || c.onDisk.builtAt !== build.builtAt);
  if (differs) {
    // the PAIR describer: a rebuild at the same commit names both build times, never "runs X and dist/ has X"
    const pair = describeBuildPair(build, c.onDisk);
    return health({ build, stale: true, reason: `dashboard runs ${pair.running} and dist/ has ${pair.onDisk} — restart to pick up` });
  }
  if (daemonSaysStale) return health({ build, stale: true, reason: `dashboard runs ${describeBuild(build)} and reports its own dist/ has moved under it — restart to pick up` });
  return health({ build, stale: false, reason: `dashboard runs the build on disk (${describeBuild(build)}${build.startedAt ? `, started ${build.startedAt}` : ""})` });
}

/** The daemon's `/api/health.tmux` as a DashboardTmux — null when absent, null, or not a verdict. */
function judgeTmux(v: unknown): DashboardTmux | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const t = v as Record<string, unknown>;
  if (typeof t.reachable !== "boolean") return null;
  const s = (x: unknown) => (typeof x === "string" && x.length > 0 ? x : null);
  return { reachable: t.reachable, since: s(t.since), error: s(t.error), checkedAt: s(t.checkedAt) };
}

/** The clause every health-judged reason ends with — one of exactly three, so a script can match it too. */
function tmuxClause(t: DashboardTmux | null): string {
  if (t === null) return "; tmux status not reported by this daemon";
  if (t.reachable) return "; tmux server reachable";
  return `; tmux server UNREACHABLE since ${t.since ?? "an unknown time"}${t.error ? ` (${t.error})` : ""}`;
}
