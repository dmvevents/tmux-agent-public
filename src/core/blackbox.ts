/**
 * Crash forensics — H4 of the health epic (docs/HEALTH-CRASH-OBSERVABILITY.md).
 *
 * The question this answers is the one every host crash leaves behind: "what was eating RAM
 * right before the box died?" A monitoring view that only exists while someone watches cannot
 * answer it — so the black box is written continuously by the fleet daemon:
 *
 *   heartbeat            mtime = the last moment we know the host was alive
 *   snapshots.ndjson     rolling top-N-by-RSS + host memory, size-capped via rotate.ts
 *   clean-shutdown       marker written on SIGINT/SIGTERM/SIGHUP — separates "stopped" from "died"
 *                        (SIGHUP: the pane's hangup when the host stops cleanly)
 *
 * On startup: a heartbeat that PREDATES the current boot, with no clean-shutdown marker at or
 * after it, means the host went down while we were running — `host.crash-suspected`, with the
 * final pre-crash snapshot attached. A server that was merely killed (host stayed up) is NOT a
 * host crash and stays silent; a clean stop before a reboot stays silent too — including the stop an
 * orderly host shutdown hands a tmux pane as SIGHUP (a real crash delivers no signal at all).
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uptime } from "node:os";
import { rotateIfNeeded } from "./rotate.js";
import { HostVitals } from "./health.js";
import { HostProc } from "./activity.js";

export interface BlackboxSnapshot {
  ts: string;
  mem: { totalBytes: number; availableBytes: number };
  swapFreeBytes: number | null;
  top: Array<{ session: string; rssBytes: number }>;
  /** the host's top processes by RSS, tmux or not — absent on ring lines written before 2026-09-27 */
  hostTop?: HostProc[];
}

export interface CrashCheck {
  suspected: boolean;
  lastHeartbeatAt: string | null;
  lastSnapshot: BlackboxSnapshot | null;
}

export interface CrashReport extends CrashCheck {
  detectedAt: string;
}

export class Blackbox {
  private readonly hb: string;
  private readonly ring: string;
  private readonly clean: string;
  private readonly crash: string;
  /** ringMaxBytes is injectable for tests; 512K ≈ days of 30s snapshots, capped forever */
  constructor(home: string, private readonly ringMaxBytes = 512 * 1024) {
    const dir = join(home, "health");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.hb = join(dir, "heartbeat");
    this.ring = join(dir, "snapshots.ndjson");
    this.clean = join(dir, "clean-shutdown");
    this.crash = join(dir, "crash-last.json");
  }

  /** One tick: append a compact snapshot, then advance the heartbeat. Never throws. */
  record(v: HostVitals, sessions: Array<{ session: string; rssBytes: number | null }>, hostTop: HostProc[] = []): BlackboxSnapshot {
    const top = sessions
      .filter((s): s is { session: string; rssBytes: number } => s.rssBytes != null)
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, 8)
      .map((s) => ({ session: s.session, rssBytes: s.rssBytes }));
    const snap: BlackboxSnapshot = { ts: v.sampledAt, mem: v.mem, swapFreeBytes: v.swap?.freeBytes ?? null, top, hostTop };
    try {
      rotateIfNeeded(this.ring, { maxBytes: this.ringMaxBytes, keep: 2 });
      appendFileSync(this.ring, JSON.stringify(snap) + "\n");
      writeFileSync(this.hb, snap.ts + "\n"); // heartbeat LAST: it vouches for the snapshot
    } catch {
      /* forensics must never break the daemon */
    }
    return snap;
  }

  /** SIGINT/SIGTERM/SIGHUP hook — a stop we chose, or the host chose for us, is not a crash. */
  markCleanShutdown(): void {
    try {
      writeFileSync(this.clean, new Date().toISOString() + "\n");
    } catch {
      /* best effort */
    }
  }

  /** Last `n` snapshots across the live ring and its rotated generation. */
  tail(n: number): BlackboxSnapshot[] {
    const lines: string[] = [];
    for (const f of [`${this.ring}.1`, this.ring]) {
      try {
        lines.push(...readFileSync(f, "utf8").split("\n").filter(Boolean));
      } catch {
        /* generation absent */
      }
    }
    const out: BlackboxSnapshot[] = [];
    for (const l of lines.slice(-n)) {
      try {
        out.push(JSON.parse(l));
      } catch {
        /* torn write at crash time — exactly the case this file exists for; skip the torn line */
      }
    }
    return out;
  }

  /**
   * `bootMs` is injectable for tests; production default derives from os.uptime(), which works
   * on both Linux and macOS (no /proc needed).
   */
  checkUncleanShutdown(bootMs = Date.now() - uptime() * 1000): CrashCheck {
    let hbMtime: number;
    try {
      hbMtime = statSync(this.hb).mtimeMs;
    } catch {
      return { suspected: false, lastHeartbeatAt: null, lastSnapshot: null }; // first run ever
    }
    let cleanMtime = -1;
    try {
      cleanMtime = statSync(this.clean).mtimeMs;
    } catch {
      /* never cleanly stopped — fine */
    }
    const suspected = hbMtime < bootMs && cleanMtime < hbMtime;
    return {
      suspected,
      lastHeartbeatAt: new Date(hbMtime).toISOString(),
      lastSnapshot: this.tail(1)[0] ?? null,
    };
  }

  /** Persist the verdict so /api/health can answer "when did it last die, and who did it". */
  noteCrash(chk: CrashCheck): CrashReport {
    const report: CrashReport = { ...chk, detectedAt: new Date().toISOString() };
    try {
      writeFileSync(this.crash, JSON.stringify(report, null, 2) + "\n");
    } catch {
      /* best effort */
    }
    return report;
  }

  lastCrash(): CrashReport | null {
    try {
      return JSON.parse(readFileSync(this.crash, "utf8"));
    } catch {
      return null;
    }
  }
}
