/**
 * Memory-exhaustion prediction — H5 of the health epic (docs/HEALTH-CRASH-OBSERVABILITY.md).
 *
 * Thresholds (H3) catch a host that is ALREADY low; the leak class we actually face gives you
 * a straight line instead: an idle claude-code process growing ~500MB/min (upstream #41765,
 * #18859) walks a 300GB host to OOM in hours, and every minute of that walk looks "healthy"
 * to a threshold. A linear fit over the black-box window turns the walk into an ETA — and,
 * because the same window holds per-session RSS, into a NAME.
 *
 * Honesty guards, in order of importance:
 *   - r² gate: a noisy scatter must not extrapolate to a scary ETA. Slope alone is not a trend.
 *   - minimum span + point count: two samples 30s apart are an anecdote, not a line.
 *   - horizon cap: "OOM in 26 hours" is not actionable and trains operators to dismiss the
 *     banner; predictions further out than the horizon stay silent.
 */
import { BlackboxSnapshot } from "./blackbox.js";

export interface TrendPoint {
  t: number; // ms epoch
  v: number;
}

export interface Fit {
  slopePerSec: number;
  r2: number;
}

/** Least-squares fit; null when there are fewer than 3 distinct-time points. */
export function linearFit(pts: TrendPoint[]): Fit | null {
  if (pts.length < 3) return null;
  const n = pts.length;
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / 1000); // seconds, offset to keep the math small
  const ys = pts.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null; // all samples at the same instant
  const slopePerSec = sxy / sxx;
  // r² = explained/total variance; a perfectly flat series (syy=0) is a perfect fit of slope 0
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slopePerSec, r2 };
}

export interface Culprit {
  session: string;
  slopeBytesPerSec: number;
  /** this session's growth as a share of the host's total loss rate, 0..1+ */
  share: number;
}

export interface Prediction {
  etaMinutes: number;
  availableBytes: number;
  slopeBytesPerSec: number; // negative: bytes of MemAvailable lost per second
  r2: number;
  culprits: Culprit[];
}

export interface PredictOpts {
  horizonMinutes?: number; // stay silent beyond this ETA
  minPoints?: number;
  minSpanSec?: number;
  minR2?: number;
  /** a culprit must explain at least this share of the host loss rate */
  minCulpritShare?: number;
}

/**
 * Project time-to-exhaustion from black-box snapshots; null = no credible trend.
 * Culprits are the sessions whose own RSS slope explains a meaningful share of the host's
 * loss rate — the difference between "the box is dying" and "kill THAT session".
 */
export function predictExhaustion(snaps: BlackboxSnapshot[], opts: PredictOpts = {}): Prediction | null {
  const horizonMin = opts.horizonMinutes ?? 30;
  const minPoints = opts.minPoints ?? 5;
  const minSpanSec = opts.minSpanSec ?? 120;
  const minR2 = opts.minR2 ?? 0.6;
  const minShare = opts.minCulpritShare ?? 0.2;

  const pts: TrendPoint[] = snaps
    .map((s) => ({ t: Date.parse(s.ts), v: s.mem.availableBytes }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (pts.length < minPoints) return null;
  if ((pts[pts.length - 1].t - pts[0].t) / 1000 < minSpanSec) return null;

  const fit = linearFit(pts);
  if (!fit || fit.slopePerSec >= 0 || fit.r2 < minR2) return null;

  const availableBytes = pts[pts.length - 1].v;
  const etaMinutes = availableBytes / -fit.slopePerSec / 60;
  if (!Number.isFinite(etaMinutes) || etaMinutes > horizonMin) return null;

  // attribute: per-session RSS slope over the same window
  const bySession = new Map<string, TrendPoint[]>();
  for (const s of snaps) {
    const t = Date.parse(s.ts);
    for (const row of s.top) {
      let list = bySession.get(row.session);
      if (!list) bySession.set(row.session, (list = []));
      list.push({ t, v: row.rssBytes });
    }
  }
  const culprits: Culprit[] = [];
  for (const [session, series] of bySession) {
    if (series.length < minPoints) continue; // joined the top-N too recently to judge
    const f = linearFit(series);
    if (!f || f.slopePerSec <= 0) continue;
    const share = f.slopePerSec / -fit.slopePerSec;
    if (share >= minShare) culprits.push({ session, slopeBytesPerSec: Math.round(f.slopePerSec), share: Number(share.toFixed(2)) });
  }
  culprits.sort((a, b) => b.slopeBytesPerSec - a.slopeBytesPerSec);

  return {
    etaMinutes: Number(etaMinutes.toFixed(1)),
    availableBytes,
    slopeBytesPerSec: Math.round(fit.slopePerSec),
    r2: Number(fit.r2.toFixed(3)),
    culprits: culprits.slice(0, 3),
  };
}
