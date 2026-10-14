/**
 * Shared harness for the suites that run the BUILT dashboard end to end — test/build-stamp.test.js
 * and test/doctor-dashboard.test.js. Both need the same three things: a copy of
 * dist/ they may rewrite (the repo's own dist/build.json is read by every other suite running in
 * parallel and must never move under them), a way to start `tmux-agent web` from that copy on a
 * throwaway home and learn the port it actually bound — asked for at a port the OS has just released,
 * never a dice roll — and a way to stop it that returns only once the daemon is GONE, so
 * the home can be removed without racing its last writes.
 *
 * Lives outside test/*.test.js on purpose: `npm run test:unit` globs that pattern one level deep,
 * so a file here is imported by suites, never run as a suite of its own (see helpers/mcp-contract.js).
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, copyFileSync, existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A COPY of the built tree: dist/ (with its stamp), package.json (the version fallback), and a
 * symlinked node_modules. A test that plants a stamp rewrites THIS copy's dist/build.json.
 */
export function copyTree() {
  const tree = mkdtempSync(join(tmpdir(), "ta-built-tree-"));
  cpSync(join(ROOT, "dist"), join(tree, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "package.json"), join(tree, "package.json"));
  if (existsSync(join(ROOT, "node_modules"))) symlinkSync(join(ROOT, "node_modules"), join(tree, "node_modules"));
  return tree;
}

/**
 * A loopback port the OS has just released: bind 127.0.0.1:0, read the port, close — the idiom of
 * test/doctor-dashboard.test.js and the two mailbox suites, and the harness's default pick since
 * TMUX-176. Until then startWeb() asked for a dice roll — 21000 plus a random offset below 15000 — and on
 * 2026-09-29 16:23Z the dice drew 24283 while 127.0.0.1:24282..24304 — twenty-three consecutive
 * ports — were held by twenty-three `serena start-mcp-server` processes, one per Claude Code session
 * on the host: the CLI's finder (src/web/server.ts findFreePort, twenty ports) gave up inside the
 * block and test/versioning-contract.test.js's daemon case red on a clean tree (npm test 540/541 on
 * 6b8dc30; four of the 15,000 bases did it, and the block grows by one port per session). The OS
 * never hands out a bound port; a stranger taking this one between the close and the daemon's bind is
 * what the CLI's forward scan is for, and the banner — not the request — stays the truth about the port.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** How many ports startWeb() asks for before giving up — stated once, named in the give-up. */
export const PICK_ATTEMPTS = 3;

/** The finder's give-up as the CLI prints it — the tell that the window was squatted, not that the daemon is broken. */
const SQUATTED = /no free port in (\d+)\.\.(\d+) on \S+/;

/**
 * Start the built dashboard from `tree` on `home` and resolve `{ child, port, picks }` once the
 * startup banner appears: `port` is the one the banner names (the CLI scans forward if the one asked
 * for is busy, so the banner — not the request — is the truth about the port), `picks` every port
 * asked for, in order. The banner embeds the web token: it is kept in memory and never printed — an
 * early exit is reported with the token redacted. `args` are appended to the `web` verb (e.g.
 * ["--no-token"]). `pickPort` (default freePort) chooses the port asked for on each attempt; when the
 * daemon exits before its banner with the finder's `no free port in A..B`, the pick is drawn again, up
 * to `attempts` (default PICK_ATTEMPTS) — the give-up names the count and every window scanned and
 * carries `picks`, `windows` and `exits`. Any other early exit is reported at once.
 */
export async function startWeb(tree, home, env = {}, args = [], { pickPort = freePort, attempts = PICK_ATTEMPTS } = {}) {
  const picks = [];
  const windows = [];
  const exits = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const port = await pickPort(attempt);
    picks.push(port);
    const r = await launch(tree, home, env, args, port);
    if (r.child) return { child: r.child, port: r.port, picks };
    const m = SQUATTED.exec(r.out);
    if (!m) throw new Error(`web exited early (${r.code}): ${r.out.replace(/token=\S+/g, "token=<redacted>")}`);
    windows.push(`${m[1]}..${m[2]}`);
    exits.push(r.code);
  }
  const err = new Error(`no free port for the built dashboard after ${attempts} picks — the CLI's finder gave up in every window it was asked to scan: ${windows.join(", ")}`);
  Object.assign(err, { picks, windows, exits });
  throw err;
}

/**
 * One attempt: spawn the daemon asking for `port`. Resolves `{ child, port }` on the banner, `{ code, out }`
 * when the child exits before it (the caller reads the finder's window out of `out`), rejects when no
 * banner arrives in 20 s.
 */
function launch(tree, home, env, args, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(tree, "dist", "bin", "tmux-agent.js"), "--socket", `ta-built-${process.pid}`, "--actor", "built-test", "web", "--port", String(port), ...args],
      { env: { ...process.env, TMUX_AGENT_HOME: home, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buf = "";
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); reject(new Error("no dashboard banner within 20 s")); } }, 20_000);
    const onData = (d) => {
      buf += String(d);
      const m = /dashboard: http:\/\/127\.0\.0\.1:(\d+)\//.exec(buf);
      if (m && !done) { done = true; clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      if (!done) { done = true; clearTimeout(timer); resolve({ code, out: buf }); }
    });
  });
}

/** How long stopWeb() gives a signalled dashboard to exit before SIGKILL — stated once, named in the failure. */
export const STOP_BOUND_MS = 5_000;

/**
 * Stop a dashboard startWeb() started and WAIT until it is gone. `child.kill()` is a signal, not a
 * state: the daemon's SIGTERM handler still writes its clean-shutdown marker under `<home>/health`
 * (src/web/server.ts onStop → Blackbox.markCleanShutdown) and a tick in flight is still appending to
 * the ledger, so a caller that removes the home in the same tick races those writes — and loses
 * ENOTEMPTY on a loaded host: CI run 35966537723 attempt 1 (ubuntu-latest, node 24) failed
 * test/versioning-contract.test.js's /api/health.build reporter at its rmSync(home) with every
 * assertion passed, the class TMUX-129 closed for test/web-archived-window.test.js.
 * Resolves once the child has exited. A child that has not exited `boundMs` after SIGTERM is
 * SIGKILLed, its exit awaited, and the failure names the bound — a wedged daemon fails the case
 * instead of hanging the suite. A `null` child (startWeb() rejected before it resolved) is nothing
 * to stop; a child already gone is not signalled again.
 */
export async function stopWeb(child, { boundMs = STOP_BOUND_MS } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); // subscribed BEFORE the signal, so a fast exit cannot be missed
  child.kill("SIGTERM");
  let timer;
  const inBound = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), boundMs); }),
  ]);
  clearTimeout(timer);
  if (inBound) return;
  child.kill("SIGKILL");
  await exited;
  throw new Error(`the built dashboard (pid ${child.pid}) did not exit within ${boundMs} ms of SIGTERM — SIGKILLed; its home may hold a torn tail`);
}
