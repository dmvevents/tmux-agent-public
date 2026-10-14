/**
 * Process-level error boundary (src/core/boundary.ts) — gate G3 "runs unattended".
 *
 * The boundary shipped on 2026-08-25 with "verified by killing the tmux server underneath a running
 * dashboard" — once, by hand. Measured 2026-09-11: nothing in test/ named the module and
 * `boundary.js` sat at 30.00% lines / 25% functions in every coverage run — the record() handler
 * body had never executed under test. A tmux-kill chaos step cannot reach it either: the tmux
 * driver reports a dead server as an empty fleet and the request handler has its own try/catch,
 * so tmux death never becomes a process-level rejection. The boundary is the last-resort net for
 * rejections OUTSIDE a request (the 30 s health tick, the watcher, the stdio MCP loop), which is
 * why it needs direct fault injection rather than a scenario.
 *
 * Three checks, all against the BUILT module in a real child process (the contract is "the
 * process stays up and the ledger has the event" — only a separate process can prove the first):
 *  1. Fault injection: an unhandled rejection and an uncaught exception thrown from a timer, each
 *     with a planted message > 400 chars and a stack > 4 frames, are both ledgered as
 *     `control.denied` with the documented truncations (boundary.ts:21-22) and the child is still
 *     alive 300 ms later, exiting 0. Watched FAIL first with the installErrorBoundary() call
 *     removed from the probe — node's default terminates it non-zero (output on TMUX-86).
 *  2. The boundary survives its own ledger failing (the inner try/catch): stay alive, still say so
 *     on stderr. A boundary that dies when the disk is full is no boundary.
 *  3. Both long-running entry points install it — read from the built tree, set-equal both ways
 *     ({web, mcp}), so removing either install or adding an undocumented third goes red.
 *     Structural, and stated as such: a behavioural check of the web install would need a fault
 *     hook in the server, and a hook that weakens the process is out of the question.
 *
 * The end-to-end survival + recovery check (tmux killed under a live dashboard with polls in
 * flight, a revived fleet listed again) is test/smoke-web.sh step 25.
 *
 * Run: node --test test/boundary.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSameSet } from "./helpers/mcp-contract.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOUNDARY_URL = pathToFileURL(join(ROOT, "dist", "core", "boundary.js")).href;
const LEDGER_URL = pathToFileURL(join(ROOT, "dist", "core", "ledger.js")).href;

/**
 * The probe is a REAL node process using the production module and the production Ledger on a
 * temp TMUX_AGENT_HOME — exactly how the two entry points build theirs. `deep()` plants a stack
 * deeper than the 4-frame cap; the messages are longer than the 400-char cap. The first stdout
 * line reports the ORIGINAL frame counts so the parent can prove the truncation happened rather
 * than assume it. `ledger` is a template slot: the production Ledger, or one that throws.
 */
function probe({ ledger, install = true }) {
  return `
import { installErrorBoundary } from ${JSON.stringify(BOUNDARY_URL)};
import { Ledger } from ${JSON.stringify(LEDGER_URL)};
const ledger = ${ledger};
${install ? 'installErrorBoundary(ledger, "probe");' : "/* boundary NOT installed */"}
const deep = (n, make) => (n === 0 ? make() : deep(n - 1, make));
const rej = deep(6, () => new Error("planted-rejection " + "R".repeat(1000)));
const exc = deep(6, () => new Error("planted-exception " + "E".repeat(401)));
console.log(JSON.stringify({ rejFrames: rej.stack.split("\\n").length, excFrames: exc.stack.split("\\n").length }));
Promise.reject(rej);                          // (a) unhandled rejection — nothing awaits it
setTimeout(() => { throw exc; }, 50);         // (b) uncaught exception from a timer, outside any request
setTimeout(() => { console.log("alive"); process.exit(0); }, 300);
`;
}

function run(script, home) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { ...process.env, TMUX_AGENT_HOME: home }, timeout: 20_000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

/** Every event in every day file under <home>/ledger (a midnight-crossing run splits across two). */
function events(home) {
  const dir = join(home, "ledger");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith("events-") && f.endsWith(".ndjson"));
  } catch {
    return [];
  }
  return files.flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

test("boundary: unhandled rejection + uncaught exception are ledgered (truncated) and the process stays alive", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-boundary-"));
  try {
    const r = await run(probe({ ledger: "new Ledger()" }), home);
    assert.equal(r.code, 0, `probe exited ${r.code} — the boundary did not keep it alive\nstderr: ${r.stderr}`);
    const [first, ...rest] = r.stdout.trim().split("\n");
    const planted = JSON.parse(first);
    assert.ok(planted.rejFrames > 4 && planted.excFrames > 4, `planted stacks must exceed the 4-frame cap (got ${first})`);
    assert.ok(rest.includes("alive"), `probe never reported alive after both faults\nstdout: ${r.stdout}`);
    assert.match(r.stderr, /\[probe\] unhandledRejection: planted-rejection/);
    assert.match(r.stderr, /\[probe\] uncaughtException: planted-exception/);

    const denied = events(home).filter((e) => e.type === "control.denied");
    assert.equal(denied.length, 2, `expected exactly 2 control.denied events, got ${denied.length}`);
    assertSameSet(
      ["unhandledRejection", "uncaughtException"],
      denied.map((e) => e.data.boundary.kind),
      { declaredAs: "the two process events the boundary hooks", liveAs: "control.denied kinds in the ledger" },
    );
    for (const e of denied) {
      const b = e.data.boundary;
      assert.equal(e.actor, "probe");
      assert.equal(b.component, "probe");
      assert.equal(b.message.length, 400, `message not capped at 400 (boundary.ts:21): ${b.message.length}`);
      assert.ok(b.stack.length <= 600, `stack not capped at 600 chars (boundary.ts:22): ${b.stack.length}`);
      assert.ok(b.stack.split(" | ").length <= 4, `stack not capped at 4 frames (boundary.ts:22): ${b.stack}`);
    }
    // the 401-char message fills most of the 600-char stack cap, so how many of the > 4 planted frames survive depends on the
    // length of each frame line (the checkout path): the frame cap must still hold, at least one real frame must survive,
    // and every surviving line must be a frame, never padding
    const exc = denied.find((e) => e.data.boundary.kind === "uncaughtException").data.boundary;
    assert.match(exc.message, /^planted-exception E+$/);
    const excLines = exc.stack.split(" | ");
    assert.ok(excLines.length >= 2 && excLines.length <= 4, `expected the header plus 1-3 frames after truncation, got ${excLines.length}: ${exc.stack}`);
    assert.ok(excLines.slice(1).every((l) => /^\s*at /.test(l)), `a truncated line is not a frame: ${exc.stack}`);
    assert.match(exc.stack, /at deep /, "truncated stack lost the planted frames");
    const rej = denied.find((e) => e.data.boundary.kind === "unhandledRejection").data.boundary;
    assert.match(rej.message, /^planted-rejection R+$/);
    assert.equal(rej.stack.length, 600, "the 1000-char message must hit the 600-char stack cap");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("boundary: a ledger that throws does not take the process down (the boundary's own failure is absorbed)", async () => {
  const home = mkdtempSync(join(tmpdir(), "ta-boundary-"));
  try {
    const r = await run(probe({ ledger: '{ emit() { throw new Error("ENOSPC: disk full"); } }' }), home);
    assert.equal(r.code, 0, `probe exited ${r.code} — a throwing ledger killed the boundary\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("alive"), `probe never reported alive\nstdout: ${r.stdout}`);
    assert.match(r.stderr, /\[probe\] unhandledRejection: planted-rejection/, "stderr line must still be written when the ledger fails");
    assert.match(r.stderr, /\[probe\] uncaughtException: planted-exception/);
    assert.equal(events(home).length, 0, "the throwing ledger must not have produced a day file");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("boundary: both long-running entry points install it — {web, mcp}, from the built tree, both directions", () => {
  // every installErrorBoundary("<component>") call site in dist/, excluding the module that defines it.
  // Block comments are stripped and the match is anchored at statement start: the first version of
  // this check matched the call inside a `/* ... REMOVED */` comment on the planted red build and
  // stayed green — a commented-out install must read as absent, not present.
  const installs = [];
  const walk = (dir) => {
    for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".js") && rel !== "dist/core/boundary.js") {
        const text = readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of text.matchAll(/^[ \t]*installErrorBoundary\(\s*[\w.]+\s*,\s*"([^"]+)"\s*\)/gm)) installs.push({ component: m[1], file: rel, at: m.index, text });
      }
    }
  };
  walk("dist");
  assert.ok(installs.length > 0, "parsed ZERO installErrorBoundary(...) calls from dist/ — cannot check the install set against nothing");
  assertSameSet(["web", "mcp"], installs.map((i) => i.component), {
    declaredAs: "the two long-running entry points (the web dashboard and the MCP server)",
    liveAs: "installErrorBoundary(...) call sites in dist/**/*.js",
  });
  assert.deepEqual(
    Object.fromEntries(installs.map((i) => [i.component, i.file])),
    { web: "dist/bin/tmux-agent.js", mcp: "dist/mcp/server.js" },
    "each install must live in the entry point it protects",
  );
  // ...and each precedes the long-running thing it protects, inside the code path that starts it
  const web = installs.find((i) => i.component === "web");
  const webVerb = web.text.indexOf('case "web"');
  const startWeb = web.text.indexOf("startWeb(", web.at);
  assert.ok(webVerb !== -1 && webVerb < web.at && startWeb !== -1, "web install must sit inside the `web` verb, before startWeb()");
  const mcp = installs.find((i) => i.component === "mcp");
  const newServer = mcp.text.indexOf("new Server(");
  assert.ok(newServer !== -1 && mcp.at < newServer, "mcp install must precede the MCP Server construction");
});
