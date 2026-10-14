/**
 * Pipe-stall watchdog — keeps the durable-log promise honest.
 *
 * VERIFIED FAILURE MODE: pipe-pane silently stalls after alternate-screen bursts — the pane
 * keeps rendering while the capture log stops growing, and nothing errors anywhere. A log
 * that dies with nobody noticing defeats the product's main promise, so divergence is
 * watched for: the pane advanced while the log stayed static. One such observation can be
 * a flush race; two CONSECUTIVE observations mean the pipe is dead (the 2-strike rule).
 *
 * Re-arm goes through the caller-supplied callback (the orchestrator's startCapture), which
 * already encodes the verified sequence: a repeat pipe-pane REPLACES the pipe and `-o`
 * TOGGLES it off, so re-arm must be stop (bare pipe-pane) then start.
 */
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Ledger } from "./ledger.js";

interface SessionWatch {
  paneHash: string;
  logBytes: number;
  strikes: number;
  reArms: number;
  /** grace anchor — set on first sight and again after every re-arm */
  graceStart: number;
  gaveUp: boolean;
}

export interface WatchdogOpts {
  /** cold-start grace: right after (re)arm, pane bursts can precede the pipe's first flush */
  graceMs?: number;
  /** re-arm budget per stall episode; recovery (log growing again) refunds it */
  maxReArms?: number;
  strikesToStall?: number;
}

export class CaptureWatchdog {
  private watches = new Map<string, SessionWatch>();
  private readonly graceMs: number;
  private readonly maxReArms: number;
  private readonly strikesToStall: number;

  constructor(
    private readonly home: string,
    private readonly ledger: Ledger,
    private readonly reArm: (session: string) => Promise<string>,
    opts: WatchdogOpts = {},
  ) {
    this.graceMs = opts.graceMs ?? Number(process.env.TMUX_AGENT_WATCHDOG_GRACE_MS ?? 10_000);
    this.maxReArms = opts.maxReArms ?? Number(process.env.TMUX_AGENT_WATCHDOG_MAX_REARMS ?? 3);
    this.strikesToStall = opts.strikesToStall ?? 2;
  }

  /**
   * Feed one observation. `paneText` is whatever the caller already captured (Monitor's
   * snapshot passes its 40-line capture), so a check costs zero extra tmux execs.
   * Returns true when this observation crossed the stall threshold.
   *
   * Known blind spot, accepted: the fingerprint is a hash of the visible pane, so output
   * that repaints the screen to IDENTICAL text (a spinner returning to the same frame)
   * does not count as "pane advanced". Real agent output differs frame to frame.
   */
  async observe(session: string, paneText: string): Promise<boolean> {
    let logBytes: number;
    try {
      logBytes = statSync(join(this.home, "logs", `${session}.log`)).size;
    } catch {
      // no capture log — a session we did not spawn (adopted), nothing to guard
      this.watches.delete(session);
      return false;
    }
    const paneHash = createHash("sha256").update(paneText).digest("hex");
    const prev = this.watches.get(session);
    if (!prev) {
      this.watches.set(session, { paneHash, logBytes, strikes: 0, reArms: 0, graceStart: Date.now(), gaveUp: false });
      return false;
    }

    const paneAdvanced = paneHash !== prev.paneHash;
    const logStatic = logBytes === prev.logBytes;
    prev.paneHash = paneHash;
    prev.logBytes = logBytes;

    if (!logStatic) {
      // the pipe is alive (or rotation moved the file) — full reset, including the re-arm
      // budget: the cap exists for re-arms that DON'T fix it, not for genuine recoveries
      prev.strikes = 0;
      prev.reArms = 0;
      prev.gaveUp = false;
      return false;
    }
    if (Date.now() - prev.graceStart < this.graceMs) return false;
    if (!paneAdvanced) return false; // quiet pane + quiet log = idle, not a stall

    prev.strikes++;
    if (prev.strikes < this.strikesToStall) return false;

    prev.strikes = 0;
    if (prev.gaveUp) return false; // exhaustion already reported once; stay quiet
    const exhausted = prev.reArms >= this.maxReArms;
    this.ledger.emit({
      type: "capture.stalled",
      session,
      data: { logBytes, reArms: prev.reArms, exhausted },
    });
    if (exhausted) {
      prev.gaveUp = true;
      return true;
    }
    prev.reArms++;
    prev.graceStart = Date.now(); // the fresh pipe gets the same first-flush grace
    try {
      await this.reArm(session);
    } catch {
      // session died between observation and re-arm; the next snapshot reports GONE
    }
    return true;
  }
}
