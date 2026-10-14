/**
 * The two FILEs a verb WRITES to — `status --json FILE` and `calibrate --out FILE` — are judged before anything is touched,
 * through one exported rule beside publishStatus, `assertOutPath` in src/analytics/status.ts: exit 64 at the CLI, one
 * stderr line naming the source, the value as typed and the reason in words (TMUX-114; gates G1 no test named a FILE
 * the tool cannot write, the exit code, the source, the home, the fleet lines withheld or the panes captured first; G3
 * a supervisor reading exit 1 could not tell a mistyped directory from a broken tool; G6 the header's exit-64 sentence
 * named no output path). TMUX-104 to TMUX-113 moved every value the CLI READS into one named refusal before a tmux
 * server, the 0700 home, the ledger or a lexicon file is touched; these two were judged by nobody but the operating
 * system, at the end, after the work.
 *
 * Measured 2026-09-16 06:2xZ on 83b0287 (scratch/ga-fire-2026-09-16-06Z/outpath-probe/probe-83b0287.log): `status
 * --json <nodir>/x.json` exited 1 with Node's `ENOENT: no such file or directory, open '…'` — the flag unnamed — after
 * the fleet was read (2 session.state rows), the home made, and the fleet lines the operator asked for withheld from
 * stdout (publishStatus precedes the print loop); a path through a file (ENOTDIR), a directory (EISDIR), a 000 parent
 * and an existing 000 file (EACCES) the same; `calibrate --out` on the same four shapes exited 1 after 40 lines of every
 * session's pane had been captured and redacted, the draft lost with the write. The empty value was already judgeFlags'
 * exit 64; no --json / no --out — the home's status.json, the draft on stdout — were and are unchanged.
 *
 * Black-box through the built CLI like test/spawn-cwd.test.js: the contract is the exit code, the streams and what did
 * NOT happen. Every run is bounded by its own execFile timeout with SIGKILL so a red run cannot hang the suite.
 * The contract, each line a check that FAILS if the property is removed:
 *   (a) the rule: `assertOutPath(value, source)` refuses a missing parent, a component that is a file, a parent that is
 *       a file, a directory, a 000 parent and an existing 000 file (the two skipped, named, where this user can write
 *       them — root), a non-string and "" — an `OutPathError`, `<source>: cannot write <as typed> — <reason>`, the
 *       reason one of `no such directory`, `not a directory`, `is a directory`, `permission denied`; the controls — a new
 *       name in a writable directory, a relative value (resolved against the caller's directory), an existing writable
 *       file, /dev/stdout — return the absolute path; the judgement creates nothing — RED on 2f910df: no such export;
 *   (b) `status --json` and `calibrate --out` on each refused shape, on a socket with no server → 64, that one line,
 *       nothing on stdout, the not-yet-existing home still absent (no ledger row), no server started, nothing written
 *       — RED on 2f910df: exit 1 in Node's words, the home made;
 *   (c) beside a live throwaway server the controls: `status --json <ok>` → 0, the file present, the fleet's line on
 *       stdout; `calibrate --out <ok>` → 0, the draft at 0600 sampling the session; and a refused `status --json` there
 *       adds no session.state row — the fleet was not read — RED on 2f910df: 2 rows per refusal;
 *   (d) the residual failure at write time — `/dev/full` passes the judgement (a writable character device) and fails
 *       the write with ENOSPC → exit 1 (not 64: the tool could not do what the judgement said it could), one line in
 *       the same `cannot write` shape naming the source, the path and the reason in words, never Node's `…, open '…'`
 *       or `…, write` — on both verbs; skipped, named, where /dev/full is absent (macOS) — RED on 2f910df: Node's line;
 *   (e) one rule, not two: the CLI's line IS `assertOutPath`'s message for the same value and source.
 *
 * Run: node --test test/out-path.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./helpers/built-web.js";
import { killServerSync } from "./helpers/kill-server.js";

const BIN = join(ROOT, "dist", "bin", "tmux-agent.js");
const STATUS = pathToFileURL(join(ROOT, "dist", "analytics", "status.js")).href;
// A refusal is one process start; a red run on 2f910df (the fleet read on an empty socket, then the failed open) ends
// inside the bound too.
const BOUND_MS = 5_000;
// A run that is meant to reach tmux: a spawn (new-session, the hasSession poll, set-option, pipe-pane), a fleet read.
const SPAWN_MS = 20_000;

function socket() {
  return `ta-outpath-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** { code, stdout, stderr }; code is the string "killed" when the bound fired — a hang, not a refusal. */
function cli(args, env, timeout = BOUND_MS, cwd = ROOT) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env }, timeout, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? `killed after ${timeout} ms` : err.code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
/** Session names on the isolated socket; a socket whose server never started has none. */
function sessions(sock) {
  try {
    return execFileSync("tmux", ["-L", sock, "list-sessions", "-F", "#S"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
/** True when no tmux server exists on the socket at all — not "no sessions", the server itself was never started. */
function serverAbsent(sock) {
  try {
    execFileSync("tmux", ["-L", sock, "list-sessions"], { stdio: ["ignore", "pipe", "pipe"] });
    return false;
  } catch (e) {
    return /no server running|error connecting/.test(String(e.stderr));
  }
}
/** Every ledger row under the home, oldest first; [] when the home has no ledger. */
function ledger(home) {
  const dir = join(home, "ledger");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort().flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}
/** A refusal is exit 64, nothing on stdout, exactly one stderr line: the source, the value as typed, the reason in words. */
function assertRefused(r, source, value, reason, label) {
  assert.equal(r.code, 64, `${label} exited ${r.code}, want 64 (EX_USAGE) (stdout: ${JSON.stringify(r.stdout.slice(0, 160))}; stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
  assert.equal(r.stdout, "", `${label} wrote to stdout what it should have refused before`);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1, `${label}: one line, not a stack trace: ${r.stderr}`);
  assert.equal(lines[0], `${source}: cannot write ${JSON.stringify(value)} — ${reason}`, `${label}: the source, the value as typed and the reason in words`);
}
/** True when this user can write /dev/full (a writable character device: the judgement passes, the write fails with ENOSPC). */
function devFullUsable() {
  try {
    accessSync("/dev/full", constants.W_OK);
    return statSync("/dev/full").isCharacterDevice();
  } catch {
    return false;
  }
}

test("a --json or --out FILE the tool cannot write is refused with exit 64, before the fleet is read, a pane captured or the home exists", async (t) => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-outpath-")));
  const S = socket();
  const home = join(T, "home"); // never created by a refusal
  const env = { TMUX_AGENT_HOME: home };
  const nodir = join(T, "nodir", "x.json"); // the parent is not there
  const adir = join(T, "adir");
  mkdirSync(adir);
  const afile = join(T, "afile");
  writeFileSync(afile, "a file\n");
  const throughFile = join(afile, "x.json"); // the parent is a file
  const deepThroughFile = join(afile, "a", "x.json"); // a component of the parent is a file (ENOTDIR on the parent)
  const locked = join(T, "locked");
  mkdirSync(locked, { mode: 0o000 });
  const inLocked = join(locked, "x.json"); // a 000 parent
  const file0 = join(T, "file0"); // an existing 000 file
  writeFileSync(file0, "");
  chmodSync(file0, 0o000);
  const rel = `no-such-rel-${process.pid}/x.json`; // named as typed, not as resolved
  // root writes into a 000 directory and onto a 000 file (accessSync W_OK passes), so the two permission cases would be a
  // false red there — skip them, named
  let canWriteLocked = true;
  try {
    accessSync(locked, constants.W_OK | constants.X_OK);
  } catch {
    canWriteLocked = false;
  }
  if (canWriteLocked) t.diagnostic("000-mode cases skipped: this user can write a 000 directory (running as root?)");
  const cases = [
    [nodir, "no such directory"],
    [deepThroughFile, "no such directory"],
    [throughFile, "not a directory"],
    [adir, "is a directory"],
    ...(canWriteLocked ? [] : [[inLocked, "permission denied"], [file0, "permission denied"]]),
  ];
  const plants = () => readdirSync(T).sort();
  const before = plants();
  try {
    // (b) each refused at the CLI, on both verbs, the value as typed
    for (const [value, reason] of cases) {
      let r = await cli(["--socket", S, "status", "--json", value], env);
      assertRefused(r, "--json", value, reason, `status --json ${value}`);
      r = await cli(["--socket", S, "calibrate", "--out", value], env);
      assertRefused(r, "--out", value, reason, `calibrate --out ${value}`);
    }
    let r = await cli(["--socket", S, "status", "--json", rel], env, BOUND_MS, T);
    assertRefused(r, "--json", rel, "no such directory", `(cd <T> && status --json ${rel})`);
    r = await cli(["--socket", S, "calibrate", "--out", rel], env, BOUND_MS, T);
    assertRefused(r, "--out", rel, "no such directory", `(cd <T> && calibrate --out ${rel})`);
    // nothing was touched: no server on the socket, no home (so no ledger row), nothing written beside the plants
    assert.ok(serverAbsent(S), `a refusal started a tmux server on ${S} (sessions: ${sessions(S).join(", ") || "none"})`);
    assert.equal(existsSync(home), false, "a refusal created the home before the file was judged (on 2f910df the home and 2 session.state rows were made first)");
    assert.deepEqual(plants(), before, `a refusal left something in the temp dir: ${plants().join(", ")}`);
    assert.deepEqual(readdirSync(adir), [], "a refusal wrote into the directory it should have refused");
    assert.equal(statSync(file0).size, 0, "a refusal wrote the 000 file");
    // (a) + (e) one rule: the exported check, the CLI's exact words, the resolved path returned, nothing created
    const status = await import(STATUS);
    assert.equal(typeof status.assertOutPath, "function", "src/analytics/status.ts exports no assertOutPath — the CLI has no one rule to judge --json / --out through");
    for (const [value, reason] of [...cases, [rel, "no such directory"], ["", "no such directory"], [undefined, "no such directory"], [42, "no such directory"]]) {
      for (const source of ["--json", "--out"]) {
        assert.throws(
          () => status.assertOutPath(value, source),
          (e) => e instanceof status.OutPathError && e.name === "OutPathError" && e.message === `${source}: cannot write ${JSON.stringify(value)} — ${reason}`,
          `assertOutPath(${JSON.stringify(value)}, ${JSON.stringify(source)}): the rule's line is not the CLI's`,
        );
      }
    }
    const fresh = join(T, "new.json");
    assert.equal(status.assertOutPath(fresh, "--json"), fresh, "a new name in a writable directory is not the absolute path");
    assert.equal(existsSync(fresh), false, "the judgement created the file");
    assert.equal(status.assertOutPath(afile, "--out"), afile, "an existing writable file is not the absolute path");
    assert.equal(status.assertOutPath("afile", "--json"), join(process.cwd(), "afile"), "a relative value does not resolve against the caller's directory");
    let canWriteStdout = true;
    try {
      accessSync("/dev/stdout", constants.W_OK);
    } catch {
      canWriteStdout = false;
    }
    if (canWriteStdout) assert.equal(status.assertOutPath("/dev/stdout", "--json"), "/dev/stdout", "an existing non-regular file this user can write is refused");
    else t.diagnostic("/dev/stdout control skipped: this process cannot write it");
    assert.deepEqual(plants(), before, `the judgement left something in the temp dir: ${plants().join(", ")}`);
  } finally {
    killServerSync(S);
    chmodSync(locked, 0o700);
    chmodSync(file0, 0o600);
    rmSync(T, { recursive: true, force: true });
  }
});

test("valid --json and --out FILEs write and print as before; beside a live server a refused FILE reads no fleet; a write that fails after the judgement is exit 1 in the same words", async (t) => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), "ta-outpath-live-")));
  const S = socket();
  const home = join(T, "home");
  const env = { TMUX_AGENT_HOME: home };
  try {
    let r = await cli(["--socket", S, "spawn", "op-live", "--cwd", T], env, SPAWN_MS);
    assert.equal(r.code, 0, `test setup: spawn op-live exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    // (c) status --json <ok>: exit 0, the file present and the fleet's line on stdout — the two things a refusal withholds
    const ok = join(T, "status.json");
    r = await cli(["--socket", S, "status", "--json", ok], env, SPAWN_MS);
    assert.equal(r.code, 0, `status --json <ok> exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.ok(existsSync(ok), "status --json FILE wrote nothing");
    assert.ok(JSON.parse(readFileSync(ok, "utf8")).sessions.some((s) => s.session === "op-live"), "the file is not the fleet");
    assert.match(r.stdout, /^op-live\t/m, `the fleet's line did not reach stdout: ${JSON.stringify(r.stdout.slice(0, 160))}`);
    assert.match(r.stderr, /^status\.json → /m, "the file's path was not announced on stderr");
    // calibrate --out <ok>: exit 0, the draft at 0600 sampling the live session — the capture a refusal never does
    const draft = join(T, "draft.json");
    r = await cli(["--socket", S, "calibrate", "--out", draft], env, SPAWN_MS);
    assert.equal(r.code, 0, `calibrate --out <ok> exited ${r.code}: ${r.stderr.slice(0, 200)}`);
    assert.equal(statSync(draft).mode & 0o777, 0o600, "the draft is not 0600");
    assert.equal(JSON.parse(readFileSync(draft, "utf8")).sampled.sessions, 1, "the draft did not sample the live session");
    assert.match(r.stderr, /calibration draft written to /, "the draft's path was not announced");
    // a refused status --json beside the running server and the existing home: 64, the line, and no session.state row
    const rows = () => ledger(home).filter((e) => e.type === "session.state").length;
    const rowsBefore = rows();
    const nodir = join(T, "nodir", "x.json");
    r = await cli(["--socket", S, "status", "--json", nodir], env);
    assertRefused(r, "--json", nodir, "no such directory", `status --json ${nodir} (home exists, server running)`);
    assert.equal(rows(), rowsBefore, "a refused status --json read the fleet (on 2f910df: 2 session.state rows per refusal)");
    r = await cli(["--socket", S, "calibrate", "--out", nodir], env);
    assertRefused(r, "--out", nodir, "no such directory", `calibrate --out ${nodir} (home exists, server running)`);
    assert.deepEqual(sessions(S), ["op-live"], `the live session did not stand: ${sessions(S).join(", ") || "none"}`);
    assert.equal(existsSync(join(T, "nodir")), false, "a refusal created the directory it should have refused");
    // (d) the residual: /dev/full passes the judgement and fails the write — exit 1, the same words, never Node's own
    if (!devFullUsable()) {
      t.diagnostic("/dev/full cases skipped: absent or not writable here (macOS)");
    } else {
      for (const [verb, flag] of [["status", "--json"], ["calibrate", "--out"]]) {
        r = await cli(["--socket", S, verb, flag, "/dev/full"], env, SPAWN_MS);
        assert.equal(r.code, 1, `${verb} ${flag} /dev/full exited ${r.code}, want 1 — the write failed after a judgement that passed, so not the operator's input (stderr: ${JSON.stringify(r.stderr.slice(0, 160))})`);
        assert.equal(r.stdout, "", `${verb} ${flag} /dev/full wrote to stdout: ${JSON.stringify(r.stdout.slice(0, 160))}`);
        const lines = r.stderr.trim().split("\n");
        assert.equal(lines.length, 1, `${verb} ${flag} /dev/full: one line, not a stack trace: ${r.stderr}`);
        assert.match(lines[0], new RegExp(`^${flag}: cannot write "/dev/full" — no space left on device`), `${verb} ${flag} /dev/full: the source, the path and the reason in words (got: ${lines[0]})`);
        assert.doesNotMatch(lines[0], /, (open|write)\b|open '/, `${verb} ${flag} /dev/full: Node's own words reached the operator: ${lines[0]}`);
      }
    }
  } finally {
    killServerSync(S);
    rmSync(T, { recursive: true, force: true });
  }
});
