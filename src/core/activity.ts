/**
 * Activity + memory accounting from /proc, not from terminal text.
 *
 * Why not tmux's own timestamps: `session_activity` only advances on client attach, and
 * `window_activity` does NOT move when a pane produces output (both verified empirically on
 * tmux 3.4 — a genuinely-busy unattached session reported "idle 345h"). Using them as a
 * liveness signal silently mislabels every detached agent lane, which is exactly the workload this tool watches.
 *
 * Why not pane text: spinner/verb regexes drift with every CLI release, and hint lines
 * false-positive (a Claude Code idle footer literally contains the word "tokens").
 *
 * CPU jiffies of the pane's process tree are release-proof, CLI-agnostic, and free: one
 * /proc pass, no subprocess. An agent that is thinking burns CPU; one waiting at a prompt
 * does not. RSS rides the SAME stat line (field 24), so per-session memory accounting —
 * H2 of the health epic, docs/HEALTH-CRASH-OBSERVABILITY.md — costs zero additional I/O.
 * Idle is not safe: upstream claude-code #18859/#41765 document idle processes leaking
 * hundreds of MB/min, which is why memory is tracked for every session, not just busy ones.
 */
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** RSS in /proc/<pid>/stat is in PAGES; jiffies are CLK_TCK-per-second. Both are kernel
 * config, not constants — 64K pages exist on arm64 — so ask getconf once and cache.
 * The fallbacks (4096 / 100) are correct for every x86_64 and default-arm64 Linux. */
let PAGE = 0;
let CLK = 0;
function pageSize(): number {
  if (!PAGE) {
    try { PAGE = Number(execFileSync("getconf", ["PAGESIZE"], { timeout: 2000 }).toString().trim()) || 4096; }
    catch { PAGE = 4096; }
  }
  return PAGE;
}
function clockTick(): number {
  if (!CLK) {
    try { CLK = Number(execFileSync("getconf", ["CLK_TCK"], { timeout: 2000 }).toString().trim()) || 100; }
    catch { CLK = 100; }
  }
  return CLK;
}

export interface CpuSample {
  at: number; // ms epoch
  byPid: Map<number, { jiffies: number; rssBytes: number }>; // root pid -> totals of pid + descendants
}

interface ProcRow {
  pid: number;
  ppid: number;
  comm: string;
  jiffies: number;
  rssBytes: number;
}

function scanProc(procRoot = "/proc"): ProcRow[] {
  const rows: ProcRow[] = [];
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return rows; // no /proc (macOS): honest empty — callers surface null, never a fake
  }
  const page = pageSize();
  for (const d of names) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const raw = readFileSync(`${procRoot}/${d}/stat`, "utf8");
      // comm can contain spaces/parens: it spans the FIRST '(' to the LAST ')'
      const open = raw.indexOf("(");
      const close = raw.lastIndexOf(")");
      const comm = open > -1 && close > open ? raw.slice(open + 1, close) : "?";
      const after = raw.slice(close + 1).trim().split(/\s+/);
      // after[0]=state, after[1]=ppid ... utime=after[11], stime=after[12], rss=after[21]
      // (stat fields 14, 15 and 24 1-based; index = field - 3 once state is after[0])
      const ppid = Number(after[1]);
      const jiffies = Number(after[11]) + Number(after[12]);
      const rssPages = Number(after[21]);
      if (Number.isFinite(ppid) && Number.isFinite(jiffies)) {
        rows.push({ pid: Number(d), ppid, comm, jiffies, rssBytes: Number.isFinite(rssPages) ? rssPages * page : 0 });
      }
    } catch {
      /* process exited mid-scan — normal */
    }
  }
  return rows;
}

function childIndex(rows: ProcRow[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const r of rows) {
    const list = children.get(r.ppid);
    if (list) list.push(r.pid);
    else children.set(r.ppid, [r.pid]);
  }
  return children;
}

/** One pass over /proc; sums each root's whole descendant tree (agents spawn workers). */
export function sampleCpu(rootPids: number[], procRoot = "/proc"): CpuSample {
  const byPid = new Map<number, { jiffies: number; rssBytes: number }>();
  if (rootPids.length === 0) return { at: Date.now(), byPid };
  const rows = scanProc(procRoot);
  // no /proc at all (macOS): NO entries — callers must see null, never a faked zero
  if (rows.length === 0) return { at: Date.now(), byPid };
  const children = childIndex(rows);
  const byId = new Map(rows.map((r) => [r.pid, r]));

  for (const root of rootPids) {
    let jiffies = 0;
    let rssBytes = 0;
    let found = false;
    const stack = [root];
    const seen = new Set<number>();
    while (stack.length) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p);
      const row = byId.get(p);
      if (row) {
        found = true;
        jiffies += row.jiffies;
        rssBytes += row.rssBytes;
      }
      for (const c of children.get(p) ?? []) stack.push(c);
    }
    // a root that vanished between the pane listing and this scan gets no entry (reads null
    // upstream) rather than a zero that looks like a measurement
    if (found) byPid.set(root, { jiffies, rssBytes });
  }
  return { at: Date.now(), byPid };
}

export interface ProcessRow {
  pid: number;
  comm: string;
  rssBytes: number;
  /** cumulative CPU seconds since the process started — honest without a sampling delay
   * (a rate would need two passes and would add latency to every detail request) */
  cpuSecs: number;
}

/**
 * The per-process breakdown of one session's tree, largest RSS first — the H2 "deep dive":
 * which CHILD of which session is eating the box. Empty on hosts without /proc.
 */
export function processTree(rootPid: number, procRoot = "/proc"): ProcessRow[] {
  if (!rootPid || rootPid <= 0) return [];
  const rows = scanProc(procRoot);
  const children = childIndex(rows);
  const byId = new Map(rows.map((r) => [r.pid, r]));
  const clk = clockTick();
  const out: ProcessRow[] = [];
  const stack = [rootPid];
  const seen = new Set<number>();
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const row = byId.get(p);
    if (row) out.push({ pid: row.pid, comm: row.comm, rssBytes: row.rssBytes, cpuSecs: Math.round(row.jiffies / clk) });
    for (const c of children.get(p) ?? []) stack.push(c);
  }
  return out.sort((a, b) => b.rssBytes - a.rssBytes);
}

/** One host process by resident size — names only, never argv (argv can carry tokens and paths a pane would redact). */
export interface HostProc {
  pid: number;
  comm: string;
  rssBytes: number;
}

/**
 * The host's top-N processes by RSS, regardless of tmux membership — the H4 gap the 2026-09-23
 * crash exposed: swap went 0→100 % inside one 30 s tick while every tracked pane tree summed to
 * under 6 G, and the black box could not name the culprit because it only knew tmux trees. Same
 * single /proc pass as everything else here; `comm` is the kernel's 16-char thread name (node 24
 * reports "MainThread"), never the command line. Empty on hosts without /proc.
 */
export function hostTopProcesses(n = 8, procRoot = "/proc"): HostProc[] {
  return scanProc(procRoot)
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, Math.max(0, n))
    .map((r) => ({ pid: r.pid, comm: r.comm, rssBytes: r.rssBytes }));
}

/**
 * Verdict thresholds (jiffies per second of wall time) and dwell (samples). Measured, not chosen:
 *
 * On a development host's ledger (2026-09-10, 22 sessions unattended, 30,964 `session.state` events)
 * the idle heartbeat of the CLIs we run (footer redraw, polling) reads 0.2–1.2 jiffies/s
 * and ALIASES against the 30 s poll, so consecutive windows alternate 0.90 / 0.37 (the p50s at
 * flip time). The old single-sample compare against one threshold (0.75) flipped on 83 % of
 * ticks: 100 % of ledger volume was classifier noise, `waste` ranked the fleet by flap count and
 * the timeline drew 30-second stripes. The band and the dwell come from that distribution:
 *   idleBelow 0.5 — every WORKING→IDLE flip reading was ≤ 0.73 (p90 0.63, p50 0.37); a working
 *                   agent never reads this low (a spinner alone costs a few jiffies/s).
 *   busyAbove 2.0 — the heartbeat's high phase tops out at 1.83 (p99) / 2.43 (p99.5); readings
 *                   ≥ 2.0 were 0.7 % of a day. An agent turn (streaming, tool calls) reads tens.
 *   dwell 2       — a change must hold for two consecutive decisive samples (60 s at the 30 s
 *                   tick). An A→B→A flap never sustains B for two samples, by definition, so the
 *                   dwell silences whatever the band lets through: replaying the day's recorded
 *                   readings gives 30,922 flips as shipped, 207 with the band alone, 6 with both.
 * Readings inside the band are neutral — they neither advance nor reset a pending flip — so a
 * session that returns to the idle heartbeat (0.37 / 0.90 / 0.37 …) still reaches IDLE: the two
 * 0.37s count although a 0.90 sits between them. A reading that agrees with the current verdict
 * resets the pending run: "sustained" means uninterrupted by evidence to the contrary.
 */
export interface ActivityThresholds {
  /** jiffies/s at or above which a window votes WORKING */
  busyAbove: number;
  /** jiffies/s at or below which a window votes IDLE */
  idleBelow: number;
  /** consecutive opposing votes before the verdict flips (>= 1; 1 = no dwell) */
  dwell: number;
}
export const DEFAULT_ACTIVITY_THRESHOLDS: Readonly<ActivityThresholds> = { busyAbove: 2.0, idleBelow: 0.5, dwell: 2 };

interface Verdict {
  /** the sustained classification; null until the first decisive reading */
  busy: boolean | null;
  /** side of the pending flip and how many consecutive decisive votes it has collected */
  pending: boolean | null;
  run: number;
}

/**
 * Rolling CPU-activity tracker. Call `update(pids)` on each poll; it compares against the
 * previous sample and reports which roots burned CPU. The first call establishes a baseline
 * (everything reads UNKNOWN rather than falsely idle). RSS needs no baseline — it is a
 * point-in-time read and is reported from the first pass.
 *
 * The RATE is raw: `jiffiesPerSec` is this window's measurement, so the UI's "cpu 0.9/s" and the
 * `cpu` on a ledger event stay honest. Only the VERDICT (`busy`) carries hysteresis — it flips
 * when a change is sustained (ActivityThresholds above), never on one 30 s sample.
 */
export class ActivityTracker {
  private prev: CpuSample | null = null;
  /** per-root verdict state; pruned to the pids polled, so it is bounded by fleet size */
  private verdicts = new Map<number, Verdict>();
  private readonly t: ActivityThresholds;
  private readonly sample: (rootPids: number[]) => CpuSample;
  /**
   * `sample` is the test seam — scripted readings with scripted timestamps
   * (test/activity-hysteresis.test.js); production reads /proc via sampleCpu. `thresholds`
   * overrides exist for tests too: the defaults are the documented, measured constants.
   */
  constructor(opts: { thresholds?: Partial<ActivityThresholds>; sample?: (rootPids: number[]) => CpuSample } = {}) {
    this.t = { ...DEFAULT_ACTIVITY_THRESHOLDS, ...opts.thresholds };
    if (!(this.t.idleBelow < this.t.busyAbove) || this.t.dwell < 1) {
      throw new RangeError(`ActivityTracker: need idleBelow < busyAbove and dwell >= 1, got ${JSON.stringify(this.t)}`);
    }
    this.sample = opts.sample ?? sampleCpu;
  }

  update(rootPids: number[]): Map<number, { busy: boolean | null; jiffiesPerSec: number | null; rssBytes: number | null }> {
    const now = this.sample(rootPids);
    const out = new Map<number, { busy: boolean | null; jiffiesPerSec: number | null; rssBytes: number | null }>();
    const elapsedSec = this.prev ? (now.at - this.prev.at) / 1000 : 0;

    for (const pid of rootPids) {
      const cur = now.byPid.get(pid);
      const rssBytes = cur ? cur.rssBytes : null;
      if (!this.prev || elapsedSec <= 0) {
        out.set(pid, { busy: null, jiffiesPerSec: null, rssBytes }); // baseline pass
        continue;
      }
      const before = this.prev.byPid.get(pid);
      if (before === undefined || cur === undefined) {
        // no delta to measure: the pid is new (no baseline yet) or gone. A gone pid's verdict goes
        // with it — a later process reusing the number starts from UNKNOWN, not from a stale run.
        if (cur === undefined) this.verdicts.delete(pid);
        out.set(pid, { busy: null, jiffiesPerSec: null, rssBytes });
        continue;
      }
      const rate = Math.max(0, cur.jiffies - before.jiffies) / elapsedSec;
      out.set(pid, { busy: this.classify(pid, rate), jiffiesPerSec: Number(rate.toFixed(2)), rssBytes });
    }
    // verdict state lives exactly as long as the pid is polled (bounded — a resource-bounds property)
    for (const pid of this.verdicts.keys()) if (!rootPids.includes(pid)) this.verdicts.delete(pid);
    this.prev = now;
    return out;
  }

  /** Schmitt band + dwell — ActivityThresholds documents the measured rationale. */
  private classify(pid: number, rate: number): boolean | null {
    let v = this.verdicts.get(pid);
    if (!v) {
      v = { busy: null, pending: null, run: 0 };
      this.verdicts.set(pid, v);
    }
    const vote = rate >= this.t.busyAbove ? true : rate <= this.t.idleBelow ? false : null;
    if (vote === null) return v.busy; // in-band: no evidence either way, nothing moves
    if (v.busy === null) {
      v.busy = vote; // the first decisive reading is the baseline verdict — nothing to sustain against yet
      return v.busy;
    }
    if (vote === v.busy) {
      v.pending = null; // evidence for the current verdict interrupts any pending flip
      v.run = 0;
      return v.busy;
    }
    v.run = v.pending === vote ? v.run + 1 : 1;
    v.pending = vote;
    if (v.run >= this.t.dwell) {
      v.busy = vote;
      v.pending = null;
      v.run = 0;
    }
    return v.busy;
  }
}
