/**
 * Per-session memory accounting — H2 of the health epic (TMUX-53,
 * docs/HEALTH-CRASH-OBSERVABILITY.md). What a refactor can silently break here:
 * RSS must come from the SAME /proc pass as CPU (no extra I/O), must aggregate the whole
 * descendant tree (agents spawn workers), and must degrade to ABSENT — never a faked zero —
 * when /proc is missing (macOS) or a pid vanished mid-scan.
 *
 * End-to-end acceptance (fleet row reflects a real ~200MB allocation over HTTP) lives in
 * test/smoke-web.sh step 23; this file pins the pure logic against a real child process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";

import { sampleCpu, processTree, ActivityTracker } from "../dist/core/activity.js";

const HAS_PROC = existsSync("/proc/self/stat");
const ALLOC = "const a=Buffer.alloc(200000000,7);a[0]=1;setInterval(()=>{},1000)";

/** spawn a node child holding ~200MB, resolve once its RSS is visible */
async function spawnHog() {
  const child = spawn(process.execPath, ["-e", ALLOC], { stdio: "ignore" });
  // Buffer.alloc touches every page up front, but give the allocator a beat to settle
  for (let i = 0; i < 40; i++) {
    const got = sampleCpu([child.pid]).byPid.get(child.pid);
    if (got && got.rssBytes >= 180_000_000) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  return child; // let the assertion produce the real number
}

test("memory: a real ~200MB allocation is visible in the tree RSS", { skip: !HAS_PROC }, async () => {
  const child = await spawnHog();
  try {
    const got = sampleCpu([child.pid]).byPid.get(child.pid);
    assert.ok(got, "child pid must have an entry while alive");
    assert.ok(
      got.rssBytes >= 180_000_000,
      `expected >=180MB for a 200MB Buffer, saw ${got.rssBytes} bytes`,
    );
  } finally {
    child.kill("SIGKILL");
  }
});

test("memory: processTree lists the process with comm + rss, largest first", { skip: !HAS_PROC }, async () => {
  const child = await spawnHog();
  try {
    const rows = processTree(child.pid);
    assert.ok(rows.length >= 1, "tree must include the root");
    const me = rows.find((r) => r.pid === child.pid);
    assert.ok(me, "root pid present");
    /**
     * `comm` must be NON-EMPTY, not literally "node".
     *
     * On node 24 `/proc/<pid>/comm` reads **"MainThread"**, because comm is the *thread* name and
     * newer node builds name their main thread — so the stricter assertion was red on
     * ubuntu-latest/24 while passing on 20/22. What processTree actually promises is a populated
     * comm field per row, and pinning a runtime's internal thread name is asserting on something
     * the product neither controls nor cares about.
     */
    assert.ok(typeof me.comm === "string" && me.comm.length > 0, `comm must be populated, saw "${me.comm}"`);
    assert.ok(me.rssBytes >= 180_000_000, `rss on the row itself, saw ${me.rssBytes}`);
    assert.ok(Number.isInteger(me.cpuSecs) && me.cpuSecs >= 0, "cpuSecs is cumulative seconds");
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].rssBytes >= rows[i].rssBytes, "sorted by rss desc");
    }
  } finally {
    child.kill("SIGKILL");
  }
});

test("memory: no /proc → NO entries and an empty tree — absent, never a faked zero", () => {
  const s = sampleCpu([process.pid], "/nonexistent-proc-root");
  assert.equal(s.byPid.get(process.pid), undefined);
  assert.deepEqual(processTree(process.pid, "/nonexistent-proc-root"), []);
});

test("memory: a pid that exited gets no entry (vanished ≠ zero bytes)", { skip: !HAS_PROC }, async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await once(child, "exit"); // reaped: /proc/<pid> is gone
  const s = sampleCpu([child.pid]);
  assert.equal(s.byPid.get(child.pid), undefined, "exited pid must be absent");
});

test("memory: ActivityTracker reports rss on the FIRST pass (busy needs a baseline, rss does not)", { skip: !HAS_PROC }, () => {
  const t = new ActivityTracker();
  const first = t.update([process.pid]).get(process.pid);
  assert.ok(first, "entry on first pass");
  assert.equal(first.busy, null, "cpu verdict needs two samples");
  assert.ok(first.rssBytes > 0, "rss is point-in-time — available immediately");
});
