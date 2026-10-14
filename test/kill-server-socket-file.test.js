/**
 * An isolated tmux server's socket FILE goes when its server goes (TMUX-163 — gate G3 "resource bounds", of the
 * test harness itself; G1 beside it).
 *
 * tmux does not unlink its socket when the server exits. Measured on tmux 3.4 this fire
 * (scratch/ga-fire-2026-09-24-18Z/probe-socket-unlink.log): `kill-server`, then `list-sessions` answering
 * "no server running on /tmp/tmux-1000/<sock>" on its FIRST poll, and the file still present 2.5 s later with no
 * `tmux -L <sock>` process alive. Every unit file that spawns a pane starts its own `tmux -L ta-<label>-<pid>-<rand>`
 * server and tore it down with a bare `kill-server`, so one `npm run test:coverage` left +44 `ta-*` files in
 * /tmp/tmux-<uid> (2,588 → 2,632 on the 4814277 tree; the hundred-and-sixty-first fire counted 21,608 before the
 * 2026-09-24 reboot) — a directory every socket lookup of the fleet's own default server has to walk, and the one
 * host-side footprint TMUX-161's "no server left behind" criterion cannot see, because it counts processes.
 *
 * The fix is one teardown, test/helpers/kill-server.sh (`ta_kill_server`, sourced by both smokes) wrapped for the
 * unit files by test/helpers/kill-server.js (`killServerSync`): kill-server, poll until tmux ITSELF says there is no
 * server on the name (bounded, 5 s, the bound named in the failure), THEN unlink the path tmux named — never before,
 * never a socket it did not name. The contract, measured against REAL tmux on throwaway sockets (every socket here
 * carries this process's pid and a random suffix; the operator's fleet is never touched):
 *   (a) a live server: killServerSync() returns removed:true with the path tmux answered for `#{socket_path}` while
 *       alive, the file is gone, and `list-sessions` on the name says no server — the plain teardown 27 files now run;
 *   (b) control — a LIVE server on a second socket is untouched: its file is present and it still answers
 *       `display -p '#{version}'` after the helper ran against the first;
 *   (c) control — a name with no file and no server is a no-op, not a throw: removed:false, the path tmux named in
 *       its refusal has this name as its basename, and nothing was created;
 *   (d) a server already DEAD with its file still present — the shape the *-tmux-down suites' FIXTURE kills leave,
 *       whose assertions read "no server running on <path>" from the dead-but-present socket — is removed by the
 *       teardown that follows; the file's presence is asserted as the precondition, not assumed;
 *   (e) the shell function on its own, the way the smokes run it: `bash test/helpers/kill-server.sh <sock>` prints
 *       `removed <path>` and the file is gone;
 *   (f) drift guard (TMUX-158's (h) shape, over a MEASURED population): every file under test/ whose text names
 *       `kill-server` either calls the helper (`killServerSync(` in .js, `ta_kill_server` in .sh, the script's path
 *       `test/helpers/kill-server.sh` in .py — TMUX-182) or is on the literal allowlist below with the reason written
 *       beside its name — and an allowlist entry that no longer names kill-server is a failure too (a stale exemption
 *       is not a clean pass); the population is asserted non-empty;
 *   (g) the names themselves: socket() is unique per process BY CONSTRUCTION — a monotonic counter beside the
 *       random suffix, `ta-ksf-<pid>-<n>-<rand>` — measured as 10,000 draws, a Set of 10,000. The shipped `ta-ksf-<pid>-<rand>`
 *       drew from 10,000 names and (b), which draws two and starts a server on each, drew one name twice in 1 of 6 coverage
 *       reads on 645bf4b: B's new-session landed on A's live server (`duplicate session: hold`), the precondition threw
 *       BEFORE (b)'s try, and A stayed alive for its 300 s hold with its file after it. (b) now asserts A ≠ B before either
 *       server starts and opens its try right after liveServer(A), so a refusal on B tears A down.
 *
 * FAIL-first on the parent 4814277: (f) reds naming every .test.js that kills a server and the two smokes (none carried
 * the helper's name); the meter read +44 (2,588 → 2,632) over one coverage read. Output on TMUX-163.
 * FAIL-first for TMUX-165 on the parent 9679050 (its test/ tree byte-identical to 645bf4b's): (g) over the shipped socket()
 * red with 3,715 duplicate names in 10,000 draws (6,285 distinct); (b) with its two draws forced to ONE name red
 * `duplicate session: hold` from the second liveServer() and left ONE `tmux -L ta-ksf` server alive with its socket file
 * present after the throw (torn down by the helper: `removed /tmp/tmux-1000/ta-ksf-2442292-32`); the reshaped (b) on the same
 * forced input red at the distinctness precondition with 0 servers and no file, and with that guard removed liveServer(B)
 * threw the same `duplicate session` and the outer finally tore A down — 0 servers, no file. Output on TMUX-165.
 * FAIL-first for TMUX-182 on the parent 477db7a: (f) with its two Python allowlist entries removed and the `.py` needle added
 * red `2 problem(s) over 35 file(s)` naming browser-audit/audit.py and ui-acceptance.py (neither carried the script's path);
 * on the same tree `npm run test:browser-audit` (29/29, 0 findings) left `ta-audit-276603` in /tmp/tmux-1000 (7 → 8 `ta-*`
 * files) and `npm run test:ui` (11/11) left `ta-ui-285569` (8 → 9), each a socket file with its pid gone and tmux answering
 * "no server running" on the name. Output on TMUX-182.
 *
 * Run: node --test test/kill-server-socket-file.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { KILL_SERVER_SH, KILL_SERVER_BOUND_S, killServerSync } from "./helpers/kill-server.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * A throwaway socket name, unique within this process BY CONSTRUCTION: a monotonic per-process counter beside the
 * random suffix. The shipped `ta-ksf-<pid>-<rand>` drew from 10,000 names, and case (b) — which draws two
 * and starts a server on each — drew the same one twice in 1 of 6 coverage reads on 645bf4b: B's new-session landed
 * on A's live server (`duplicate session: hold`), the precondition threw before (b)'s try, and A stayed alive for its
 * 300 s hold with its file after it. The counter makes any two draws in one process distinct whatever the random
 * part does; the random part stays for what the counter cannot see — a dead-but-present file left under this pid by
 * an earlier process. Case (g) measures the promise: 10,000 draws, a Set of 10,000.
 */
let drawn = 0;
function socket() {
  drawn += 1;
  return `ta-ksf-${process.pid}-${drawn}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}
/** Raw tmux, rc and its own words together — the wording is the evidence, so it is never thrown away. */
function tmuxRaw(sock, args) {
  try {
    return { rc: 0, out: String(execFileSync("tmux", ["-L", sock, ...args], { stdio: ["ignore", "pipe", "pipe"] })).trim() };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${String(e.stdout ?? "")}${String(e.stderr ?? "")}`.trim() };
  }
}
/** True when no tmux server exists on the socket at all — tmux's own words, either of its two refusals. */
function serverAbsent(sock) {
  const { rc, out } = tmuxRaw(sock, ["list-sessions"]);
  return rc !== 0 && /no server running|error connecting/.test(out);
}
/**
 * A live server on `sock` holding one detached session, and the socket path tmux answers for it while alive —
 * asserted, not assumed: new-session returns before the server can answer for it, so the presence is polled.
 */
function liveServer(sock) {
  const r = tmuxRaw(sock, ["new-session", "-d", "-s", "hold", "-x", "80", "-y", "24", "sleep 300"]);
  assert.equal(r.rc, 0, `precondition: tmux could not start the server the case needs on ${sock}: ${r.out}`);
  let listed = false;
  for (let i = 0; i < 50 && !listed; i++) {
    listed = tmuxRaw(sock, ["list-sessions", "-F", "#S"]).out.split("\n").includes("hold");
    if (!listed) execFileSync("sleep", ["0.1"]);
  }
  assert.ok(listed, `precondition: the server on ${sock} never listed its session`);
  const p = tmuxRaw(sock, ["display", "-p", "#{socket_path}"]);
  assert.equal(p.rc, 0, `precondition: a live server did not answer #{socket_path}: ${p.out}`);
  assert.ok(existsSync(p.out), `precondition: tmux named ${p.out} but nothing is there`);
  return p.out;
}
/** A poll until tmux says no server — bounded like the helper; the return is the verdict, never assumed. */
function untilServerAbsent(sock, ms = KILL_SERVER_BOUND_S * 1000) {
  const t0 = Date.now();
  while (!serverAbsent(sock)) {
    if (Date.now() - t0 > ms) return false;
    execFileSync("sleep", ["0.05"]);
  }
  return true;
}

test("(a) a live server: killServerSync() removes the socket file tmux named once tmux says the server is gone", () => {
  const S = socket();
  const path = liveServer(S);
  const r = killServerSync(S);
  assert.equal(r.removed, true, `the helper did not report a removal: ${r.line}`);
  assert.equal(r.path, path, "the path removed is the one tmux answered for #{socket_path} while the server was alive");
  assert.equal(existsSync(path), false, `the socket file is still there: ${path}`);
  assert.ok(serverAbsent(S), `tmux still answers on ${S}`);
});

test("(b) control: a LIVE server on a second socket keeps its file and still answers after the helper ran on the first", () => {
  const A = socket();
  const B = socket();
  // Distinct BEFORE either server starts: on one name B's new-session lands on A's server (`duplicate session: hold`)
  // and the case would be measuring one server, not two.
  assert.notEqual(A, B, `precondition: socket() drew one name twice — ${A} — so the case cannot start its second server`);
  const pathA = liveServer(A);
  try {
    // A is alive from here: whatever liveServer(B) throws, the outer finally tears A down (TMUX-165 — the shipped
    // shape opened its try only after BOTH preconditions, so a refusal on B left A's server alive for its hold).
    const pathB = liveServer(B);
    try {
      const r = killServerSync(A);
      assert.equal(r.removed, true, `A was not removed: ${r.line}`);
      assert.equal(existsSync(pathA), false, `A's file is still there: ${pathA}`);
      assert.equal(existsSync(pathB), true, `B's file went with A's — the helper removed a socket it was not given: ${pathB}`);
      const v = tmuxRaw(B, ["display", "-p", "#{version}"]);
      assert.equal(v.rc, 0, `B's server no longer answers after the helper ran against A: ${v.out}`);
    } finally {
      killServerSync(B);
    }
    assert.equal(existsSync(pathB), false, `B's own teardown left its file: ${pathB}`);
  } finally {
    killServerSync(A); // a no-op once the case's own kill ran (case (c)'s contract); the teardown when liveServer(B) threw
  }
});

test("(c) control: a name with no file and no server is a no-op, not a throw — and creates nothing", () => {
  const S = socket();
  assert.ok(serverAbsent(S), `precondition: ${S} must have no server`);
  let r;
  assert.doesNotThrow(() => { r = killServerSync(S); }, "the helper threw on a socket that was never started");
  assert.equal(r.removed, false, `the helper claims a removal where there was nothing: ${r.line}`);
  assert.ok(r.path, `tmux's refusal names the path — the helper should have read it: ${r.line}`);
  assert.equal(r.path.split("/").pop(), S, `the path tmux named is not this socket's: ${r.path}`);
  assert.equal(existsSync(r.path), false, `the no-op created something at ${r.path}`);
  assert.ok(serverAbsent(S), `the no-op started a server on ${S}`);
});

test("(d) a server already dead with its file present — the *-tmux-down fixtures' shape — is removed by the teardown that follows", () => {
  const S = socket();
  const path = liveServer(S);
  tmuxRaw(S, ["kill-server"]); // the FIXTURE kill: raw, so the dead socket keeps the file its cases read
  assert.ok(untilServerAbsent(S), `precondition: tmux still answers on ${S} ${KILL_SERVER_BOUND_S} s after kill-server`);
  assert.equal(
    existsSync(path),
    true,
    `precondition: tmux removed ${path} on its own after kill-server — the state this helper exists for is gone; TMUX-163's premise no longer holds on this tmux (${tmuxRaw(S, ["-V"]).out})`,
  );
  const r = killServerSync(S);
  assert.equal(r.removed, true, `the dead server's file was not removed: ${r.line}`);
  assert.equal(r.path, path, "the path tmux named in its refusal is the one it answered while alive");
  assert.equal(existsSync(path), false, `the socket file is still there: ${path}`);
});

test("(e) the shell function the smokes source does the same on its own: `bash kill-server.sh <sock>` prints `removed <path>`", () => {
  const S = socket();
  const path = liveServer(S);
  const out = String(execFileSync("bash", [KILL_SERVER_SH, S], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).trim();
  assert.equal(out, `removed ${path}`, "the script's one-line report");
  assert.equal(existsSync(path), false, `the socket file is still there: ${path}`);
  assert.ok(serverAbsent(S), `tmux still answers on ${S}`);
});

/**
 * Files that may name `kill-server` without calling the helper, each with the reason written beside it. An entry
 * here is a DECISION, visible in the diff. Empty since TMUX-182: its only two entries were the Python harnesses
 * (ui-acceptance.py for `npm run test:ui`, browser-audit/audit.py for `npm run test:browser-audit`) — outside
 * `npm test`, one server per run, torn down with a bare kill-server that left one dead `ta-ui-<pid>` /
 * `ta-audit-<pid>` socket file in /tmp/tmux-<uid> per run. Both now run `bash test/helpers/kill-server.sh <sock>`
 * in their finally, the way kill-server.js does, so the `.py` needle is the script's path.
 */
const ALLOWLIST = {};
const NEEDLE = { ".js": "killServerSync(", ".mjs": "killServerSync(", ".sh": "ta_kill_server", ".py": "test/helpers/kill-server.sh" };

function* walk(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== "node_modules") yield* walk(p); }
    else if (d.isFile()) yield p;
  }
}

test("(f) every file under test/ that names kill-server calls the helper or is allowlisted with a reason (TMUX-163 drift guard)", () => {
  const population = [];
  for (const p of walk(TEST_DIR)) {
    if (!/\.(js|mjs|sh|py)$/.test(p)) continue;
    if (readFileSync(p, "utf8").includes("kill-server")) population.push(relative(TEST_DIR, p));
  }
  assert.ok(
    population.length >= 10,
    `only ${population.length} file(s) under test/ name kill-server — the population this guard measures has gone; refusing to pass on nothing: ${population.join(", ")}`,
  );
  const problems = [];
  for (const rel of population) {
    const src = readFileSync(join(TEST_DIR, rel), "utf8");
    if (rel in ALLOWLIST) {
      if (!ALLOWLIST[rel].trim()) problems.push(`${rel}: allowlisted without a reason`);
      continue;
    }
    const needle = NEEDLE[rel.slice(rel.lastIndexOf("."))];
    if (!needle) problems.push(`${rel}: names kill-server and is neither a .js/.sh/.py caller of the helper nor allowlisted`);
    else if (!src.includes(needle)) problems.push(`${rel}: kills a tmux server without \`${needle}\` — its socket file stays in /tmp/tmux-<uid>`);
  }
  for (const rel of Object.keys(ALLOWLIST)) {
    const p = join(TEST_DIR, rel);
    if (!existsSync(p)) problems.push(`allowlist: ${rel} no longer exists — a stale exemption`);
    else if (!readFileSync(p, "utf8").includes("kill-server")) problems.push(`allowlist: ${rel} no longer names kill-server — a stale exemption`);
  }
  assert.deepEqual(problems, [], `${problems.length} problem(s) over ${population.length} file(s):\n  ${problems.join("\n  ")}`);
});

test("(g) socket() is unique per process by construction: 10,000 draws, 10,000 distinct names", () => {
  const N = 10_000;
  const names = Array.from({ length: N }, () => socket());
  const distinct = new Set(names).size;
  assert.equal(
    distinct,
    N,
    `${N - distinct} duplicate name(s) in ${N} draws — two cases can start their servers on one socket`,
  );
  const offShape = names.filter((n) => !/^ta-ksf-\d+-\d+-[0-9a-z]{1,3}$/.test(n));
  assert.equal(offShape.length, 0, `${offShape.length} name(s) off the ta-ksf-<pid>-<n>-<rand> shape, e.g. ${offShape.slice(0, 3).join(", ")}`);
});
