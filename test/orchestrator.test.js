/**
 * Orchestrator error-path unit tests (GA gate 1 — Correctness).
 *
 * orchestrator.ts is the file that SPAWNS, TYPES INTO, and KILLS sessions, and it was 0%
 * unit-covered. These tests inject a FakeTmux (no live tmux server) and drive every guard/throw
 * branch plus the happy spawn/kill lineage, so a regression in the ownership check, the
 * dead-pane/foreground exec refusal, the policy gate, or the exec-timeout path fails the suite.
 *
 * Run: node --test test/orchestrator.test.js
 * Coverage: node --experimental-test-coverage --test test/orchestrator.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Orchestrator, GUARD_REREAD_MS } from "../dist/core/orchestrator.js";
import { Policy } from "../dist/core/policy.js";
import { Ledger } from "../dist/core/ledger.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

// Each test gets an isolated TMUX_AGENT_HOME so the ctor's mkdir/chmod + exec temp files never
// touch a real ~/.tmux-agent.
function freshHome() {
  const h = tempHome("ta-orch-");
  process.env.TMUX_AGENT_HOME = h;
  return h;
}
after(() => removeTempHomes()); // every home this file made, once its last test has run

// A fake Tmux implementing exactly the surface Orchestrator calls. Behaviour is scripted per-test
// via the `opts` overrides; every exec is recorded so we can assert what tmux commands were issued.
// Captures are recorded too, as ["capture-pane", lines] — until TMUX-206 the fake's capturePane bypassed
// `calls`, so an assertion that "no capture-pane call" occurred was satisfiable by any run at all (FM-07).
// `paneAfterPaste`: what capturePane answers once a paste-buffer has been issued (default: paneText),
// so a case can make the PASTE change the pane rather than start with the text already on screen.
function fakeTmux(opts = {}) {
  const calls = [];
  let pasted = false;
  return {
    calls,
    socketArgs: () => ["-L", "test"],
    exec: async (args) => {
      calls.push(args);
      if (args[0] === "paste-buffer") pasted = true;
      if (opts.execThrows && opts.execThrows(args)) throw new Error("exec failed: " + args.join(" "));
      // show-options -v <key>  → return a scripted option value (for getOption/ownership)
      if (args[0] === "show-options") {
        const key = args[args.length - 1];
        return { stdout: (opts.options?.[key] ?? "") + "\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    hasSession: async (name) => !!(opts.existingSessions?.includes(name)),
    capturePane: async (_name, lines) => {
      calls.push(["capture-pane", lines]);
      return pasted && opts.paneAfterPaste !== undefined ? opts.paneAfterPaste : (opts.paneText ?? "");
    },
    paneInfo: async () => {
      if (opts.paneInfoThrows) throw new Error("no such session");
      return opts.paneInfo ?? { pid: 4242, currentCmd: "bash", cwd: "/tmp", dead: false };
    },
    listSessions: async () => opts.sessions ?? [],
    // The reachability-aware twin lineageReport() reads. A faked fleet is a server that ANSWERED —
    // `unreachable: "<tmux's words>"` is how a case asks for the dead one instead.
    listSessionsReachable: async () =>
      opts.unreachable
        ? { reachable: false, error: opts.unreachable, sessions: [] }
        : { reachable: true, error: null, sessions: opts.sessions ?? [] },
  };
}

const mkOrch = (tmux, { policy, actor = "tmux-agent" } = {}) =>
  new Orchestrator(tmux, new Ledger(join(process.env.TMUX_AGENT_HOME, "ledger.jsonl")), policy ?? new Policy(), actor);

// The ledger mkOrch hands the orchestrator, read back. policy.ts:5 promises "every refusal is an
// auditable event (caller logs control.denied)"; on 17c5d2e ten refusal paths wrote one event —
// only kill's ownership check — while every case below asserted the throw and never looked
//. A refusal that only throws is now red here.
function denied(home) {
  const dir = join(home, "ledger.jsonl");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ndjson"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
    .filter((e) => e.type === "control.denied");
}
/** Exactly one control.denied, naming the refused session, the caller, the verb and a cause. */
function assertOneDenied(home, { session, action, reason, actor = "tmux-agent" }) {
  const d = denied(home);
  assert.equal(d.length, 1, `expected exactly one control.denied, got ${d.length}: ${JSON.stringify(d)}`);
  assert.equal(d[0].session, session, "control.denied names the refused session");
  assert.equal(d[0].actor, actor, "control.denied names the caller");
  assert.equal(d[0].data?.action, action, "data.action is the refused verb");
  assert.match(String(d[0].data?.reason ?? ""), reason, "data.reason names the cause");
  return d[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy gate — every mutating method must refuse when policy says no
// ─────────────────────────────────────────────────────────────────────────────
test("policy: read-only mode blocks spawn", async () => {
  const home = freshHome();
  const orch = mkOrch(fakeTmux(), { policy: new Policy({ readOnly: true }) });
  await assert.rejects(() => orch.spawn({ name: "s1", cwd: "/tmp", parent: "user" }), /read-only|denied/);
  // the session was never created; the event still names it
  assertOneDenied(home, { session: "s1", action: "spawn", reason: /read-only/ });
});

test("policy: read-only mode blocks kill", async () => {
  const home = freshHome();
  const orch = mkOrch(fakeTmux(), { policy: new Policy({ readOnly: true }) });
  await assert.rejects(() => orch.kill("s1"), /read-only|denied/);
  assertOneDenied(home, { session: "s1", action: "kill", reason: /read-only/ });
});

test("policy: read-only mode blocks execSync", async () => {
  const home = freshHome();
  const orch = mkOrch(fakeTmux(), { policy: new Policy({ readOnly: true }) });
  await assert.rejects(() => orch.execSync("s1", "echo hi"), /read-only|denied/);
  assertOneDenied(home, { session: "s1", action: "exec", reason: /read-only/ });
});

test("policy: deny-list blocks send (deny is keyed by action: {send:[...]})", async () => {
  const home = freshHome();
  const orch = mkOrch(fakeTmux(), { policy: new Policy({ deny: { send: ["prod-*"] } }) });
  await assert.rejects(() => orch.sendVerified("prod-db", "rm -rf /"), /denied|deny-list/);
  assertOneDenied(home, { session: "prod-db", action: "send", reason: /deny-list/ });
});

test("policy: allow-list blocks a send outside the allowed prefix", async () => {
  const home = freshHome();
  const orch = mkOrch(fakeTmux(), { policy: new Policy({ allow: { send: ["lane-*"] } }) });
  await assert.rejects(() => orch.sendVerified("other", "hi"), /not in allow-list|denied/);
  // the three policy causes stay distinguishable in the ledger, not just in the thrown text
  assertOneDenied(home, { session: "other", action: "send", reason: /allow-list/ });
});

// ─────────────────────────────────────────────────────────────────────────────
// spawn — idempotency + lineage side effects
// ─────────────────────────────────────────────────────────────────────────────
test("spawn: existing live session is a no-op (returns false, issues no new-session)", async () => {
  freshHome();
  const tmux = fakeTmux({ existingSessions: ["dupe"] });
  const orch = mkOrch(tmux);
  const created = await orch.spawn({ name: "dupe", cwd: "/tmp", parent: "user" });
  assert.equal(created, false);
  assert.equal(tmux.calls.some((c) => c[0] === "new-session"), false);
});

test("spawn: fresh session creates it and stamps lineage options", async () => {
  const home = freshHome();
  const tmux = fakeTmux();
  const orch = mkOrch(tmux);
  const created = await orch.spawn({ name: "lane1", cwd: "/tmp", parent: "user", task: "build" });
  assert.equal(created, true);
  assert.equal(denied(home).length, 0, "a permitted action emits no control.denied");
  assert.equal(tmux.calls.some((c) => c[0] === "new-session" && c.includes("lane1")), true);
  // lineage stamped: @agent_parent / @agent_owner / @agent_task
  const opts = tmux.calls.filter((c) => c[0] === "set-option").flat();
  assert.ok(opts.includes("@agent_parent") && opts.includes("@agent_owner") && opts.includes("@agent_task"));
});

// ─────────────────────────────────────────────────────────────────────────────
// execSync — the guard branches that must FAIL FAST (not block to timeout)
// ─────────────────────────────────────────────────────────────────────────────
test("execSync: refuses when pane is dead", async () => {
  const home = freshHome();
  const tmux = fakeTmux({ paneInfo: { pid: 1, currentCmd: "bash", cwd: "/tmp", dead: true } });
  const orch = mkOrch(tmux);
  await assert.rejects(() => orch.execSync("s1", "echo hi"), /is dead/);
  assertOneDenied(home, { session: "s1", action: "exec", reason: /dead/ });
});

test("execSync: refuses when a TUI (non-shell) holds the foreground — confirmed by a second read GUARD_REREAD_MS later", async () => {
  const home = freshHome();
  // currentCmd is a known non-shell → foregroundProgram returns it → refuse. The pid must be one no
  // process table contains: since TMUX-99 the tree walk decides whenever it can see the pane, and
  // pid 1 handed it the whole host — on the dev box the deepest foreground row under init was the
  // test runner itself, so the refusal named "node" and the fixture's "vim" was never what refused.
  const tmux = fakeTmux({ paneInfo: { pid: 2147483647, currentCmd: "vim", cwd: "/tmp", dead: false } });
  // Count the guard's reads: a TUI is still there on the second look, and that look is the whole of
  // what TMUX-197 costs it — one more read, GUARD_REREAD_MS later, before the same refusal.
  const readPane = tmux.paneInfo;
  let reads = 0;
  tmux.paneInfo = async (...a) => { reads++; return readPane(...a); };
  const orch = mkOrch(tmux);
  const t0 = Date.now();
  await assert.rejects(() => orch.execSync("s1", "echo hi"), /refusing exec|not a shell/);
  const elapsed = Date.now() - t0;
  assert.equal(reads, 2, `guard reads before the refusal: ${reads}`);
  assert.ok(elapsed >= GUARD_REREAD_MS, `refused after ${elapsed} ms — the confirming read waits GUARD_REREAD_MS (${GUARD_REREAD_MS})`);
  const ev = assertOneDenied(home, { session: "s1", action: "exec", reason: /foreground/ });
  assert.equal(ev.data.program, "vim", "the event names the program that holds the pane");
  assert.equal(ev.data.first, undefined, "both reads named vim: the event carries no `first`");
});

test("execSync: a non-shell that is GONE on the confirming read is a transient, not a TUI — exec proceeds, nothing is denied", async () => {
  const home = freshHome();
  // The 2026-10-02 shape: the guard's one read landed on a login shell's rc-time helper — `ps -p $$ -c -o comm=`
  // from brew shellenv for 121–124 ms, `kiro-cli init bash …` for 18–680 ms, measured 2026-10-13 at host load
  // 25–29 (scratch/ga-fire-2026-10-13-04Z/fastprobe.log) — and refused an exec the pane would have answered.
  // Scripted read by read: the pid is one no process table contains, so tmux's name decides each read.
  const seq = ["ps"];
  const tmux = fakeTmux({ paneText: "$ " }); // ready prompt — skip the readiness poll
  let reads = 0;
  tmux.paneInfo = async () => { reads++; return { pid: 2147483647, currentCmd: seq.shift() ?? "bash", cwd: "/tmp", dead: false }; };
  const origExec = tmux.exec;
  tmux.exec = async (args) => {
    const r = await origExec(args);
    if (args[0] === "wait-for" && args.length === 2) {
      writeFileSync(join(home, `.exec-${args[1]}.rc`), "0");
      writeFileSync(join(home, `.exec-${args[1]}.out`), "after the helper\n");
    }
    return r;
  };
  const orch = mkOrch(tmux);
  const t0 = Date.now();
  const { exitCode, output } = await orch.execSync("s1", "echo after the helper", 5_000);
  const elapsed = Date.now() - t0;
  assert.equal(exitCode, 0);
  assert.match(output, /after the helper/);
  assert.ok(reads >= 2, `the guard read the pane ${reads} time(s) — a non-shell is confirmed before it refuses`);
  assert.ok(elapsed >= GUARD_REREAD_MS, `exec took ${elapsed} ms — the confirming read waits GUARD_REREAD_MS (${GUARD_REREAD_MS})`);
  assert.equal(denied(home).length, 0, `a transient is not a refusal: ${JSON.stringify(denied(home))}`);
});

test("execSync: a non-shell on BOTH reads is refused by the program of the confirming read, the first read's name beside it", async () => {
  const home = freshHome();
  // A helper that hands the pane to a TUI, or a TUI whose own helper exits back into it: what the SECOND read
  // saw is what holds the pane and what the refusal must name; the first read's name rides along as `first`.
  const seq = ["ps", "vim"];
  const tmux = fakeTmux();
  tmux.paneInfo = async () => ({ pid: 2147483647, currentCmd: seq.shift() ?? "vim", cwd: "/tmp", dead: false });
  const orch = mkOrch(tmux);
  await assert.rejects(() => orch.execSync("s1", "echo hi"), /refusing exec in s1: foreground process is "vim"/);
  const ev = assertOneDenied(home, { session: "s1", action: "exec", reason: /foreground/ });
  assert.equal(ev.data.program, "vim", "the event names what the confirming read saw");
  assert.equal(ev.data.first, "ps", "…and what the first read saw, since the two differ");
});

// ─────────────────────────────────────────────────────────────────────────────
// kill — ownership check is the safety-critical branch
// ─────────────────────────────────────────────────────────────────────────────
test("kill: refuses a session owned by another actor (no force)", async () => {
  const home = freshHome();
  const tmux = fakeTmux({ options: { "@agent_owner": "someone-else" } });
  const orch = mkOrch(tmux, { actor: "tmux-agent" });
  await assert.rejects(() => orch.kill("theirs"), /refusing to kill|owned by/);
  assert.equal(tmux.calls.some((c) => c[0] === "kill-session"), false);
  // the one refusal that always ledgered keeps its {action, owner} keys and gains a reason
  const ev = assertOneDenied(home, { session: "theirs", action: "kill", reason: /owned/ });
  assert.equal(ev.data.owner, "someone-else");
});

test("kill: proceeds on our own session", async () => {
  freshHome();
  const tmux = fakeTmux({ options: { "@agent_owner": "tmux-agent" } });
  const orch = mkOrch(tmux, { actor: "tmux-agent" });
  await orch.kill("ours");
  assert.equal(tmux.calls.some((c) => c[0] === "kill-session"), true);
});

test("kill: force overrides ownership and kills", async () => {
  freshHome();
  const tmux = fakeTmux({ options: { "@agent_owner": "someone-else" } });
  const orch = mkOrch(tmux, { actor: "tmux-agent" });
  await orch.kill("theirs", true);
  assert.equal(tmux.calls.some((c) => c[0] === "kill-session"), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// getOption + lineage — read paths
// ─────────────────────────────────────────────────────────────────────────────
test("getOption: returns null when the option is empty", async () => {
  freshHome();
  const orch = mkOrch(fakeTmux({ options: {} }));
  assert.equal(await orch.getOption("s1", "@agent_task"), null);
});

test("getOption: returns null when tmux exec throws", async () => {
  freshHome();
  const orch = mkOrch(fakeTmux({ execThrows: (a) => a[0] === "show-options" }));
  assert.equal(await orch.getOption("s1", "@agent_owner"), null);
});

test("lineage: maps sessions to their stamped parent/owner/task", async () => {
  freshHome();
  const tmux = fakeTmux({
    sessions: [{ name: "a", created: 1, attached: false }],
    options: { "@agent_parent": "user", "@agent_owner": "tmux-agent", "@agent_task": "t" },
  });
  const orch = mkOrch(tmux);
  const rows = await orch.lineage();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "a");
  assert.equal(rows[0].parent, "user");
});

test("lineageReport: the rows are lineage()'s, and the server's verdict rides beside them — never inside", async () => {
  freshHome();
  const live = await mkOrch(fakeTmux({ sessions: [{ name: "a", created: 1, attached: false }], options: { "@agent_parent": "user" } })).lineageReport();
  assert.deepEqual(live.tmux, { reachable: true, error: null }, "a server that listed its sessions is reachable");
  assert.deepEqual(live.rows.map((r) => [r.name, r.parent]), [["a", "user"]], "the rows are what lineage() returns");
  const gone = "no server running on /tmp/tmux-1000/ta-fake";
  const dead = await mkOrch(fakeTmux({ unreachable: gone })).lineageReport();
  assert.deepEqual(dead.tmux, { reachable: false, error: gone }, "a dead server's own words reach the caller instead of being swallowed");
  assert.deepEqual(dead.rows, [], "and the rows stay the empty array every consumer already parses");
});

// ─────────────────────────────────────────────────────────────────────────────
// sendVerified — the happy (verified) path: pane echoes the text back → landed → Enter
// ─────────────────────────────────────────────────────────────────────────────
test("sendVerified: verified send succeeds when the PASTE puts the text on the pane — a prompt before, the text after (TMUX-206 re-shape of FM-07)", async () => {
  freshHome();
  const text = "echo hello-world-distinctive-marker";
  // Until TMUX-206 this case started with the text already on screen (`paneText: "$ <text>"`), so it could not
  // tell a paste that landed from one that was dropped onto a stale echo. The pane now reads "$ " before the
  // paste-buffer and "$ <text>" after it: the verification has to see the paste CHANGE the pane.
  const tmux = fakeTmux({ paneText: "$ ", paneAfterPaste: `$ ${text}` });
  const orch = mkOrch(tmux);
  const ok = await orch.sendVerified("s1", text, { enter: true });
  assert.equal(ok, true);
  // it must have pasted (load-buffer/paste-buffer) and submitted (send-keys Enter)
  assert.ok(tmux.calls.some((c) => c[0] === "paste-buffer"));
  assert.equal(tmux.calls.filter((c) => c[0] === "send-keys" && c.includes("C-j")).length, 1, "Enter sent once");
});

test("sendVerified: verify:false path pastes without a verification capture and still submits", async () => {
  freshHome();
  // paneText non-empty: a ready prompt, so the pre-paste readiness poll returns immediately
  const tmux = fakeTmux({ paneText: "$ " });
  const orch = mkOrch(tmux);
  const ok = await orch.sendVerified("s1", "some text", { enter: true, verify: false });
  assert.equal(ok, true);
  // No capture AFTER the paste: the readiness poll before it may capture (5 lines), the verification would capture
  // 30 after it. Until TMUX-206 the fake did not record captures at all, so `calls.some(capture-pane) === false`
  // held on every run (FM-07) — now the order is what is asserted.
  const paste = tmux.calls.findIndex((c) => c[0] === "paste-buffer");
  assert.ok(paste > -1, "no paste-buffer call");
  assert.deepEqual(tmux.calls.slice(paste + 1).filter((c) => c[0] === "capture-pane"), [], "verify:false captured the pane after the paste");
  assert.ok(tmux.calls.some((c) => c[0] === "send-keys" && c.includes("C-j")), "verify:false did not submit");
});

// ─────────────────────────────────────────────────────────────────────────────
// pasteText readiness gate — SIGINT into a shell that is still sourcing init files kills it
// (and tmux destroys the session), so the C-c must wait for the pane's first output.
// ─────────────────────────────────────────────────────────────────────────────
test("sendVerified: holds the C-c interrupt until the pane produces output (fresh-spawn SIGINT race)", async () => {
  freshHome();
  const events = [];
  const tmux = fakeTmux();
  // shell "prints its prompt" on the 3rd poll; every exec and capture lands in one ordered log
  tmux.capturePane = async () => {
    events.push("capture");
    return events.filter((e) => e === "capture").length >= 3 ? "$ " : "";
  };
  const origExec = tmux.exec;
  tmux.exec = async (args) => {
    events.push(args[0] === "send-keys" && args.includes("C-c") ? "C-c" : args[0]);
    return origExec(args);
  };
  const orch = mkOrch(tmux);
  const ok = await orch.sendVerified("s1", "echo hi", { enter: true, verify: false });
  assert.equal(ok, true);
  const firstInterrupt = events.indexOf("C-c");
  assert.ok(firstInterrupt > -1, "C-c interrupt was sent");
  assert.equal(events.slice(0, firstInterrupt).filter((e) => e === "capture").length, 3,
    "C-c must wait for the readiness poll to see pane output");
});

// ─────────────────────────────────────────────────────────────────────────────
// execSync — full happy path. The fake writes the rc file when it sees `wait-for <id>`,
// simulating the pane signalling completion, so the completion-wait loop resolves.
// ─────────────────────────────────────────────────────────────────────────────
test("execSync: completes and returns exitCode+output from the rc/out files", async () => {
  const home = freshHome();
  const tmux = fakeTmux({
    paneText: "sh ", // the injected ` sh <script>` line — needle is short, verify:false anyway
    execThrows: () => false,
  });
  // hook: when the orchestrator issues `wait-for <id>` (not the -S inside the script), write the
  // rc + out files the completion loop polls for. The id is the 2nd arg of the wait-for call.
  const origExec = tmux.exec;
  tmux.exec = async (args) => {
    const r = await origExec(args);
    if (args[0] === "wait-for" && args.length === 2) {
      const id = args[1];
      writeFileSync(join(home, `.exec-${id}.rc`), "0");
      writeFileSync(join(home, `.exec-${id}.out`), "hello from exec\n");
    }
    return r;
  };
  const orch = mkOrch(tmux);
  const { exitCode, output } = await orch.execSync("s1", "echo hello from exec", 5_000);
  assert.equal(exitCode, 0);
  assert.match(output, /hello from exec/);
  // temp files cleaned up
  assert.equal(readdirSync(home).filter((f) => f.startsWith(".exec-")).length, 0);
});

test("execSync: non-zero command exit is reported, not thrown", async () => {
  const home = freshHome();
  const tmux = fakeTmux({ paneText: "$ " }); // ready prompt — skip the readiness poll
  const origExec = tmux.exec;
  tmux.exec = async (args) => {
    const r = await origExec(args);
    if (args[0] === "wait-for" && args.length === 2) {
      writeFileSync(join(home, `.exec-${args[1]}.rc`), "3");
    }
    return r;
  };
  const orch = mkOrch(tmux);
  const { exitCode } = await orch.execSync("s1", "exit 3", 5_000);
  assert.equal(exitCode, 3);
});
