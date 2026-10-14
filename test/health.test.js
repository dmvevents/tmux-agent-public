/**
 * Host-vitals collector — H1 of the health/crash-observability epic (TMUX-52,
 * docs/HEALTH-CRASH-OBSERVABILITY.md). The parsing and the degradation contract are the parts
 * a refactor can silently break: MemAvailable (not os.freemem) on Linux, and an HONEST
 * `os-only` fallback on hosts without /proc — degraded values, never a throw, never a fake.
 *
 * The end-to-end acceptance (curl /api/health vs `free -b` / `df -B1` within 2%) lives in
 * test/smoke-web.sh step 22; this file pins the pure logic.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir, totalmem, homedir } from "node:os";
import { join } from "node:path";

import { parseMeminfo, collectHostVitals } from "../dist/core/health.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";
after(() => removeTempHomes()); // every home this file made, once its last test has run

const MEMINFO = [
  "MemTotal:       65229024 kB",
  "MemFree:         4801324 kB",
  "MemAvailable:   52014356 kB",
  "Buffers:         2097152 kB",
  "SwapTotal:       8388604 kB",
  "SwapFree:        8123392 kB",
  "",
].join("\n");

test("health: parseMeminfo converts the kB fields we serve to bytes", () => {
  const m = parseMeminfo(MEMINFO);
  assert.ok(m);
  assert.equal(m.memTotal, 65229024 * 1024);
  assert.equal(m.memAvailable, 52014356 * 1024);
  assert.equal(m.swapTotal, 8388604 * 1024);
  assert.equal(m.swapFree, 8123392 * 1024);
});

test("health: parseMeminfo refuses a meminfo missing MemAvailable (pre-3.14 kernels) — no guessing", () => {
  assert.equal(parseMeminfo("MemTotal: 100 kB\nMemFree: 50 kB\n"), null);
  assert.equal(parseMeminfo("not meminfo at all"), null);
});

test("health: proc mode — vitals come from the injected meminfo, swap present", () => {
  const fakeProc = tempHome("ta-health-");
  writeFileSync(join(fakeProc, "meminfo"), MEMINFO);
  const v = collectHostVitals(tmpdir(), fakeProc);
  assert.equal(v.mode, "proc");
  assert.equal(v.mem.totalBytes, 65229024 * 1024);
  assert.equal(v.mem.availableBytes, 52014356 * 1024);
  assert.deepEqual(v.swap, { totalBytes: 8388604 * 1024, freeBytes: 8123392 * 1024 });
});

test("health: NO /proc (macOS) — degrades to os-only, swap is null, never a throw", () => {
  const v = collectHostVitals(tmpdir(), "/nonexistent-proc-root");
  assert.equal(v.mode, "os-only");
  assert.equal(v.swap, null, "swap cannot be known without /proc — null, not a faked 0");
  assert.equal(v.mem.totalBytes, totalmem());
  assert.ok(v.mem.availableBytes > 0 && v.mem.availableBytes <= v.mem.totalBytes);
});

test("health: disk covers the agent home and ~, free <= total, both positive", () => {
  const home = tempHome("ta-health-home-");
  const v = collectHostVitals(home);
  const paths = v.disk.map((d) => d.path);
  assert.ok(paths.includes(home), `agent home missing from ${paths}`);
  assert.ok(paths.includes(homedir()), `~ missing from ${paths}`);
  for (const d of v.disk) {
    assert.ok(d.totalBytes > 0, `${d.path} totalBytes`);
    assert.ok(d.freeBytes >= 0 && d.freeBytes <= d.totalBytes, `${d.path} free within total`);
  }
});

test("health: a not-yet-created agent home is omitted from disk, not faked as zero", () => {
  const v = collectHostVitals("/nonexistent-agent-home");
  assert.ok(!v.disk.some((d) => d.path === "/nonexistent-agent-home"));
  assert.ok(v.disk.some((d) => d.path === homedir()), "~ still reported");
});

test("health: payload shape is stable for /api/health consumers", () => {
  const v = collectHostVitals(tempHome("ta-health-shape-"));
  assert.match(v.sampledAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(["proc", "os-only"].includes(v.mode));
  assert.equal(v.load.length, 3);
  assert.ok(v.load.every((x) => typeof x === "number" && x >= 0));
  assert.ok(Number.isInteger(v.uptimeSec) && v.uptimeSec > 0);
});
