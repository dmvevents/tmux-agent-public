/**
 * OOM prediction — H5 of the health epic (TMUX-56, docs/HEALTH-CRASH-OBSERVABILITY.md).
 * The property that must never regress is the FALSE-POSITIVE guard set: noisy scatter,
 * short windows, positive slopes, and far-future ETAs all stay silent — a prediction banner
 * that cries wolf is worse than none. Then the true-positive: a genuine leak yields a sane
 * ETA and names the session driving it (the #41765 class: idle process, ~500MB/min).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { linearFit, predictExhaustion } from "../dist/core/trend.js";

const G = 1e9;
const M = 1e6;
const T0 = Date.parse("2026-08-26T12:00:00Z");

/** build snapshots at 30s cadence: hostAvail(i) bytes available, sessions = {name: rss(i)} */
function snaps(n, hostAvail, sessions) {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(T0 + i * 30_000).toISOString(),
    mem: { totalBytes: 64 * G, availableBytes: hostAvail(i) },
    swapFreeBytes: null,
    top: Object.entries(sessions).map(([session, f]) => ({ session, rssBytes: f(i) })),
  }));
}

test("trend: linearFit recovers a known slope with r2≈1; flat series is slope 0 r2 1", () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ t: T0 + i * 1000, v: 100 - 2 * i }));
  const f = linearFit(pts);
  assert.ok(Math.abs(f.slopePerSec - -2) < 1e-9);
  assert.ok(f.r2 > 0.999);
  const flat = linearFit(Array.from({ length: 5 }, (_, i) => ({ t: T0 + i * 1000, v: 7 })));
  assert.equal(flat.slopePerSec, 0);
  assert.equal(flat.r2, 1);
});

test("trend: a real leak predicts a sane ETA and names the culprit (the #41765 class)", () => {
  // host loses 8MB/s (≈480MB/min); 10G left → ~20.8min. 'leaky' grows 7MB/s, 'steady' is flat.
  const s = snaps(11, (i) => 10 * G - i * 30 * 8 * M, {
    leaky: (i) => 2 * G + i * 30 * 7 * M,
    steady: () => 1 * G,
  });
  const p = predictExhaustion(s);
  assert.ok(p, "a credible monotonic leak must predict");
  assert.ok(p.etaMinutes > 15 && p.etaMinutes < 26, `ETA ≈ 20.8min, got ${p.etaMinutes}`);
  assert.equal(p.culprits[0].session, "leaky", "attribution names the growing session");
  assert.ok(p.culprits[0].share > 0.7, `leaky drives ~87% of the loss, got share=${p.culprits[0].share}`);
  assert.ok(!p.culprits.some((c) => c.session === "steady"), "flat sessions are never blamed");
});

test("trend: flat host memory stays silent", () => {
  assert.equal(predictExhaustion(snaps(11, () => 30 * G, { a: () => G })), null);
});

test("trend: noisy scatter with no real trend stays silent (r² gate)", () => {
  // alternate ±3G around 30G — huge apparent motion, no direction
  const s = snaps(12, (i) => 30 * G + (i % 2 ? 3 * G : -3 * G), { a: () => G });
  assert.equal(predictExhaustion(s), null, "slope alone must not extrapolate from noise");
});

test("trend: recovering memory (positive slope) stays silent", () => {
  assert.equal(predictExhaustion(snaps(11, (i) => 10 * G + i * 30 * 8 * M, {})), null);
});

test("trend: a slow leak beyond the horizon stays silent — non-actionable ETAs train dismissal", () => {
  // 1MB/s against 60G → ~1000min ETA: real, but not a banner
  const s = snaps(11, (i) => 60 * G - i * 30 * M, { slow: (i) => G + i * 30 * M });
  assert.equal(predictExhaustion(s), null);
  // same leak with a wide-open horizon DOES predict — proving the horizon was the gate
  assert.ok(predictExhaustion(s, { horizonMinutes: 10_000 }));
});

test("trend: too few points or too short a window stays silent", () => {
  const leak = (i) => 10 * G - i * 30 * 8 * M;
  assert.equal(predictExhaustion(snaps(4, leak, {})), null, "4 points < minPoints");
  // 5 points but only 60s span
  const short = Array.from({ length: 5 }, (_, i) => ({
    ts: new Date(T0 + i * 15_000).toISOString(),
    mem: { totalBytes: 64 * G, availableBytes: leak(i) },
    swapFreeBytes: null,
    top: [],
  }));
  assert.equal(predictExhaustion(short), null, "60s span < minSpanSec");
});

test("trend: a session that only recently entered the top-N is not blamed on thin evidence", () => {
  const s = snaps(11, (i) => 10 * G - i * 30 * 8 * M, { leaky: (i) => 2 * G + i * 30 * 7 * M });
  // 'newcomer' appears only in the last 2 snapshots with big rss
  s[9].top.push({ session: "newcomer", rssBytes: 20 * G });
  s[10].top.push({ session: "newcomer", rssBytes: 21 * G });
  const p = predictExhaustion(s);
  assert.ok(p);
  assert.ok(!p.culprits.some((c) => c.session === "newcomer"), "needs minPoints of history to accuse");
});
