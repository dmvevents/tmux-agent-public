/**
 * Ledger append atomicity under real concurrency (TMUX-68b).
 *
 * The whole evidence chain — analytics, waste, audit, crash forensics — rests on "one
 * event = one line = one atomic append" (src/core/ledger.ts). On this host that file IS
 * shared by concurrent writers (fleet hub, GA loop, a long-running dashboard), yet the
 * O_APPEND atomicity assumption had never been proven, only assumed. This test makes it a
 * check: 2 separate PROCESSES race 1000 emits each into one ledger dir; every line must
 * parse, the count must be exactly 2000, and each writer must land all 1000 (a torn line
 * fails JSON.parse; a lost write fails the per-writer count).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const LEDGER_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "core", "ledger.js"),
).href;

const N = 1000;
// each writer is a REAL process using the production Ledger; pad pushes lines past
// trivial sizes so an interleaved partial write cannot hide inside a short record
const WRITER = `
import { Ledger } from ${JSON.stringify(LEDGER_URL)};
const led = new Ledger(process.argv[1]);
for (let i = 0; i < ${N}; i++) {
  led.emit({ type: "session.state", session: "writer-" + process.argv[2], data: { i, pad: "x".repeat(200) } });
}
`;

test(`ledger: 2 processes x ${N} concurrent appends -> exactly ${2 * N} intact lines`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-race-"));
  try {
    await Promise.all(["a", "b"].map((id) =>
      execFileP(process.execPath, ["--input-type=module", "-e", WRITER, dir, id]),
    ));

    // read every day file — a midnight-crossing run legitimately splits across two
    const lines = readdirSync(dir)
      .filter((f) => f.startsWith("events-") && f.endsWith(".ndjson"))
      .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean));
    assert.equal(lines.length, 2 * N, `expected ${2 * N} lines, got ${lines.length} (lost or torn writes)`);

    const perWriter = { "writer-a": 0, "writer-b": 0 };
    for (const line of lines) {
      const ev = JSON.parse(line); // a torn/interleaved line throws right here
      assert.equal(ev.v, 1);
      perWriter[ev.session]++;
    }
    assert.equal(perWriter["writer-a"], N, "writer a lost events");
    assert.equal(perWriter["writer-b"], N, "writer b lost events");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
