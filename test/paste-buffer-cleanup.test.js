/**
 * A send's paste buffer is deleted exactly once — by `paste-buffer -d` — and never by a `delete-buffer` after that paste
 * completed.
 *
 * Why. `pasteText` gave every paste a unique buffer name (the 2026-08-25 cross-contamination fix) and pasted it with
 * `paste-buffer -d`, which deletes the buffer once it is written to the pane; then a belt-and-braces
 * `delete-buffer -b <name>` ran in `finally`, naming a buffer that no longer existed. tmux through 3.3a answers an
 * unknown `-b` name on delete-buffer by deleting the NEWEST buffer instead (cmd-set-buffer.c: `if (pb == NULL) pb =
 * paste_get_top(&bufname)`, 3.2a and 3.3a alike); 3.4 refuses it ("unknown buffer: <name>"). So under two concurrent
 * sends on tmux 3.2a, send
 * A's stray delete landed between send B's set-buffer and its paste-buffer and removed B's buffer, and B died at
 * `paste-buffer -d -b <name>` with "no buffer <name>" — nothing pasted, no Enter, the pane at its bare prompt. CI's
 * tmux-versions (3.2a) job lost test/smoke.sh step 11 that way twice on 2026-10-13 (`race-b lost its own input`, 16:36Z on
 * 92f59a6; `race-a`, 17:06Z on a2192f0); replayed here with a built 3.2a: 13 of 160 panes on the parent trees (a2192f0 and
 * its pre-TMUX-206 parent fe4cf19 alike), 0 of 160 under 3.4, the losing send's own line reading
 * `tmux paste-buffer failed: no buffer ta-…`. Deterministically: scratch/tmux-3.2a/delete-buffer-fallback.sh.
 *
 * The fake below is a tmux 3.2a buffer store: set-buffer/load-buffer create a named buffer; paste-buffer -d writes it to
 * the pane and deletes it, or fails "no buffer <name>"; delete-buffer deletes the named buffer, or — what 3.2a does —
 * the newest one when the name is unknown. Each check FAILS if the property is removed (RED on a2192f0 quoted in the
 * messages):
 *   (1) one send: after a completed `paste-buffer -d` no `delete-buffer` follows for that name — RED: it does;
 *   (2) two concurrent sends in CI's interleave — A sets and pastes; B sets; whatever A deletes in its finally is applied
 *       now (the fake holds a delete-buffer until B's set-buffer has landed, and holds B's paste-buffer until every
 *       pending delete has applied); B pastes: both sends land and both panes show their own text — RED: B rejects with
 *       `tmux paste-buffer failed: no buffer <B's name>`, the line CI's step 11 die now quotes;
 *   (3) the control that the cleanup still exists: a paste-buffer that fails for another reason (the pane is gone) is
 *       followed by `delete-buffer -b <name>` — the buffer is still in the server and ours to remove;
 *   (4) a paste-buffer that fails "no buffer" is NOT followed by a delete-buffer — there is nothing of ours left, and on
 *       3.2a that delete would take the newest buffer, someone else's.
 *
 * Run: npm run build && node --test test/paste-buffer-cleanup.test.js
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { Orchestrator } from "../dist/core/orchestrator.js";
import { Policy } from "../dist/core/policy.js";
import { Ledger } from "../dist/core/ledger.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A tmux 3.2a buffer store under the orchestrator's verbs. `opts.interleave` sequences two sends the way CI's step 11
 * lost them: a delete-buffer is held until a SECOND set-buffer has landed, and a paste-buffer is held while a delete is
 * pending — so send A's finally, whatever it does, is applied between send B's set-buffer and B's paste-buffer.
 * `opts.paneGone` makes every paste-buffer fail as tmux does when the target pane is not there; `opts.buffersGone` makes
 * every paste-buffer fail "no buffer <name>" (the buffer was taken first).
 */
function fakeTmux32a(opts = {}) {
  const calls = [];
  const buffers = new Map(); // name -> { text, order }
  const panes = new Map(); // session -> text
  let order = 0;
  let sets = 0;
  let pendingDeletes = 0;
  const until = async (pred, ms) => {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await sleep(2);
  };
  const target = (args) => {
    const t = args[args.indexOf("-t") + 1] ?? "";
    return t.replace(/^=/, "").replace(/:.*$/, "");
  };
  const bufname = (args) => args[args.indexOf("-b") + 1];
  const newest = () => [...buffers.entries()].sort((a, b) => b[1].order - a[1].order)[0]?.[0];
  return {
    calls,
    buffers,
    panes,
    socketArgs: () => ["-L", "test"],
    exec: async (args) => {
      calls.push(args);
      const verb = args[0];
      if (verb === "set-buffer") {
        buffers.set(bufname(args), { text: args[args.length - 1], order: order++ });
        sets++;
        return { stdout: "", stderr: "" };
      }
      if (verb === "paste-buffer") {
        if (opts.interleave) await until(() => pendingDeletes === 0, 1000);
        const n = bufname(args);
        if (opts.buffersGone || !buffers.has(n)) throw new Error(`tmux paste-buffer failed: no buffer ${n}`);
        if (opts.paneGone) throw new Error(`tmux paste-buffer failed: can't find pane: ${target(args)}`);
        const s = target(args);
        panes.set(s, `${panes.get(s) ?? "$ "}${buffers.get(n).text}`);
        buffers.delete(n);
        return { stdout: "", stderr: "" };
      }
      if (verb === "delete-buffer") {
        if (opts.interleave) {
          pendingDeletes++;
          await until(() => sets >= 2, 1000);
        }
        const n = bufname(args);
        try {
          if (buffers.has(n)) buffers.delete(n);
          else if (buffers.size > 0) buffers.delete(newest()); // tmux through 3.3a: an unknown name deletes the newest buffer
          else throw new Error("tmux delete-buffer failed: no buffer");
        } finally {
          if (opts.interleave) pendingDeletes--;
        }
        return { stdout: "", stderr: "" };
      }
      if (verb === "send-keys" && args.includes("C-j")) {
        const s = target(args);
        const line = (panes.get(s) ?? "$ ").split("\n").at(-1).replace(/^\$ /, "");
        panes.set(s, `${panes.get(s)}\n${line.replace(/^echo /, "")}\n$ `);
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    capturePane: async (name) => panes.get(name) ?? "$ ",
    paneInfo: async () => ({ pid: 4242, currentCmd: "bash", cwd: "/tmp", dead: false }),
    hasSession: async () => true,
    listSessions: async () => [],
    listSessionsReachable: async () => ({ reachable: true, error: null, sessions: [] }),
  };
}
function mkOrch(tmux) {
  const home = tempHome("ta-pbc-");
  process.env.TMUX_AGENT_HOME = home;
  return new Orchestrator(tmux, new Ledger(join(home, "ledger")), new Policy({}), "pbc-test");
}
const verbs = (tmux, name) => tmux.calls.filter((c) => c.includes(name)).map((c) => c[0]);
/** The buffer name a send used: the -b argument of its set-buffer (or load-buffer). */
const bufOf = (tmux, session) => {
  const i = tmux.calls.findIndex((c) => c[0] === "paste-buffer" && c.includes(`=${session}:`));
  return i >= 0 ? tmux.calls[i][tmux.calls[i].indexOf("-b") + 1] : null;
};

test("(1) one send: after a completed paste-buffer -d, no delete-buffer follows for that buffer", async () => {
  const tmux = fakeTmux32a();
  const ok = await mkOrch(tmux).sendVerified("pbc-one", "echo ONE", { enter: true });
  assert.equal(ok, true, "the control send did not verify");
  const name = bufOf(tmux, "pbc-one");
  assert.ok(name, "no paste-buffer was issued");
  const seq = verbs(tmux, name);
  assert.ok(seq.includes("paste-buffer"), `no paste-buffer for ${name}: ${seq}`);
  assert.deepEqual(
    seq.filter((v) => v === "delete-buffer"),
    [],
    `a delete-buffer followed the completed paste of ${name} (${seq.join(" → ")}) — tmux through 3.3a deletes the NEWEST buffer when the named one is gone, another send's`,
  );
});

test("(2) two concurrent sends on a 3.2a store: both land and each pane shows its own text — the CI miss `no buffer`", async () => {
  // The interleave CI hit: A sets and pastes; B sets its buffer; A's finally applies; B pastes. The fake sequences it (see
  // fakeTmux32a): a delete A still issues is applied after B's set-buffer and before B's paste-buffer — on the parent, on B.
  const tmux = fakeTmux32a({ interleave: true });
  const orch = mkOrch(tmux);
  const a = orch.sendVerified("pbc-a", "echo AAAA", { enter: true });
  // B starts once A's paste-buffer has run: poll the recorded calls
  for (let i = 0; i < 200 && !tmux.calls.some((c) => c[0] === "paste-buffer" && c.includes("=pbc-a:")); i++) await sleep(5);
  assert.ok(tmux.calls.some((c) => c[0] === "paste-buffer" && c.includes("=pbc-a:")), "test setup: A never pasted");
  const b = orch.sendVerified("pbc-b", "echo BBBB", { enter: true });
  const [ra, rb] = await Promise.allSettled([a, b]);
  assert.equal(ra.status, "fulfilled", `send A rejected: ${ra.reason}`);
  assert.equal(rb.status, "fulfilled", `send B rejected: ${rb.reason} — on a2192f0 A's stray delete-buffer took B's buffer and B's paste found no buffer`);
  assert.equal(ra.value, true, "send A did not verify");
  assert.equal(rb.value, true, "send B did not verify");
  assert.match(tmux.panes.get("pbc-a") ?? "", /echo AAAA/, `pane A: ${JSON.stringify(tmux.panes.get("pbc-a"))}`);
  assert.match(tmux.panes.get("pbc-b") ?? "", /echo BBBB/, `pane B: ${JSON.stringify(tmux.panes.get("pbc-b"))}`);
  assert.doesNotMatch(tmux.panes.get("pbc-a") ?? "", /BBBB/, "B's text landed in A");
  assert.doesNotMatch(tmux.panes.get("pbc-b") ?? "", /AAAA/, "A's text landed in B");
  assert.equal(tmux.buffers.size, 0, `buffers left in the server: ${[...tmux.buffers.keys()]}`);
});

test("(3) the control: a paste-buffer that fails because the pane is gone IS followed by delete-buffer for that buffer", async () => {
  const tmux = fakeTmux32a({ paneGone: true });
  await assert.rejects(() => mkOrch(tmux).sendVerified("pbc-gone", "echo GONE", { enter: true }), /can't find pane/);
  const name = tmux.calls.find((c) => c[0] === "set-buffer")?.[2];
  assert.ok(name, "no set-buffer was issued");
  assert.deepEqual(verbs(tmux, name), ["set-buffer", "paste-buffer", "delete-buffer"], `the buffer ${name} is still in the server and must be removed: ${verbs(tmux, name).join(" → ")}`);
  assert.equal(tmux.buffers.size, 0, "the failed paste left its buffer behind");
});

test("(4) a paste-buffer that fails `no buffer` is NOT followed by a delete-buffer — on 3.2a that would take the newest buffer, someone else's", async () => {
  const tmux = fakeTmux32a({ buffersGone: true });
  // someone else's buffer, the newest in the server
  await tmux.exec(["set-buffer", "-b", "theirs", "echo THEIRS"]);
  await assert.rejects(() => mkOrch(tmux).sendVerified("pbc-nobuf", "echo NOBUF", { enter: true }), /no buffer/);
  const name = tmux.calls.find((c) => c[0] === "set-buffer" && c[2] !== "theirs")?.[2];
  assert.ok(name, "no set-buffer was issued");
  assert.deepEqual(verbs(tmux, name), ["set-buffer", "paste-buffer"], `a delete-buffer followed a paste that found no buffer: ${verbs(tmux, name).join(" → ")}`);
  assert.ok(tmux.buffers.has("theirs"), "the other client's buffer was deleted");
});
