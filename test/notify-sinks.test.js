/**
 * The notify sinks' covered contract — `SlackWebhookSink`, `ConsoleSink`, the `notify.sent` row (VERSIONING
 * items 3, 6, 9) — driven through the BUILT root and the built CLI (TMUX-157; gates G3 — a webhook that never
 * answers must not hold the watcher, and a failed page must be tellable from a mistyped one in the audit row —
 * with G1 and G4 beside it).
 *
 * Measured 2026-09-23 04:23Z on 5e91398 by driving the built root against loopback stubs on 127.0.0.1 port 0
 * (scratch/ga-fire-2026-09-23-04Z/probe-sinks.log, probe-blackhole-settle.log): the sinks were driven by
 * TMUX-9's test/watch.test.js (a POST arrives, ok: true / ok: false ledgered, the console fallback) and one
 * versioning-contract fixture (the no-URL reason), and nothing else the covered signatures promise. (1) The
 * `webhookUrl` argument was honoured and passed by nothing — `new SlackWebhookSink(` appeared twice in the tree,
 * each with the ledger alone. (2) HTTP 500, connection refused, not-a-URL and a black hole each ledgered the
 * identical `{ sink, ok: false, title }`; only the no-URL arm said why. (3) `...meta` was spread AFTER the row's
 * own fields: `notify(t, b, { ok: false, sink: "evil", title: "X" })` ledgered `{ sink: "evil", ok: false,
 * title: "X" }` on a sink that returned true. (4) A webhook that accepted the POST and never answered held
 * notify() — and `watch`, which awaits it — STILL PENDING at 5 / 60 / 240 s and settled false after 300.8 s,
 * node v22.21.1's own fetch bound; the sink set none. (5) ConsoleSink's declaration comment said stdout; it
 * wrote stderr — the RIGHT stream, since `watch` prints its verdict JSON on stdout.
 *
 * Two measurements this file's arms rest on, made here on e427e0c (scratch/ga-fire-2026-09-23-10Z/
 * probe-undici-cause-chain.log): `http://127.0.0.1:1/` is refused by undici's bad-port list — the cause reads
 * `bad port`, not ECONNREFUSED — so the refused arm below binds a port and CLOSES it; and a thrown fetch's
 * `cause.code` sits one level down (`ECONNREFUSED`, `ERR_INVALID_URL`), which is why the reason walks the chain.
 *
 * The contract, each line a check that FAILS if the property is removed (RED on the e427e0c dist, the parent's
 * rows quoted in the messages — logs under scratch/ga-fire-2026-09-23-10Z/red/):
 *   (1) with the env UNSET, `new SlackWebhookSink(ledger, A)` POSTs to A — A's hit count, the body and the
 *       content-type read FROM THE STUB, never from the return value; with the env SET to B and the argument
 *       A, A takes it and B has 0; with no argument, B takes it. GREEN on the parent (it pins a property that
 *       already held) — RED once the argument is replaced by the env read (A 0, B 1).
 *   (2) every failed send ledgers a non-empty `reason` naming its cause, and the HTTP-500, refused, not-a-URL
 *       and timed-out reasons are pairwise DISTINCT — on rows read back from the ledger FILE, `ok: false` and
 *       the false return unchanged; the no-URL arm's reason stays byte-for-byte `no TMUX_AGENT_SLACK_WEBHOOK`.
 *   (3) `notify(t, b, { ok: false, sink: "evil", title: "X", session: "s" })` on BOTH sinks ledgers the sink's
 *       own name, the send's own outcome and `t` — AND `session: "s"` still lands. Both halves asserted (an
 *       absence alone is vacuous: TMUX-96's lesson).
 *   (4) against a stub that accepts and never answers, a 500 ms bound settles false within the bound + 1 s
 *       with a reason naming the timeout, raced against the case's OWN deadline so a hang is a red naming the
 *       bound, never a hung suite; the DEFAULT bound is read off the built object and its settle MEASURED
 *       against it; and through the built CLI, `watch <s> --idle-secs 1` with `TMUX_AGENT_SLACK_WEBHOOK` at the
 *       black hole exits 0 within that default + slack, the default named in the message.
 *   (5) ConsoleSink writes `[notify] <title>: <body>` on stderr and NOTHING on stdout — a child process, so the
 *       streams are the real ones; its declaration comment says stderr and why; `stdout sink` occurs 0 times
 *       in src/adapters/notify/slack.ts, so the comment cannot drift back.
 *
 * Run: npm run build && node --test test/notify-sinks.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ta from "../dist/index.js";
import { killServerSync } from "./helpers/kill-server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist/bin/tmux-agent.js");
const SRC = join(ROOT, "src/adapters/notify/slack.ts");
const ENV = "TMUX_AGENT_SLACK_WEBHOOK";

const home = () => mkdtempSync(join(tmpdir(), "ta-notify-sinks-"));
const socket = () => `ta-nsink-${process.pid}-${Math.floor(Math.random() * 1e4).toString(36)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A loopback webhook stub on port 0. `blackhole` reads the POST and never answers. */
function stub(status = 200, opts = {}) {
  const hits = [];
  const srv = createServer((req, rsp) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ method: req.method, url: req.url, contentType: req.headers["content-type"], body });
      if (opts.blackhole) return;
      rsp.statusCode = status;
      rsp.end(opts.text ?? "ok");
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        hits,
        url: `http://127.0.0.1:${srv.address().port}/hook`,
        close: () => { srv.closeAllConnections(); srv.close(); },
      })),
  );
}

/** A loopback port that WAS listening and is now closed: a connection to it is refused by the kernel (ECONNREFUSED),
 * where port 1 is refused by undici's bad-port list before any connection is tried. */
async function closedPortUrl() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return `http://127.0.0.1:${port}/nope`;
}

/** The `notify.sent` rows the ledger FILE holds — the durable record, never the in-memory return. */
function sentRows(H) {
  const dir = join(H, "ledger");
  return readdirSync(dir)
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n"))
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "notify.sent")
    .map((e) => e.data);
}
const rowFor = (H, title) => {
  const rows = sentRows(H).filter((r) => r.title === title);
  assert.equal(rows.length, 1, `expected exactly one notify.sent row titled ${JSON.stringify(title)} in the ledger file, found ${rows.length}`);
  return rows[0];
};

async function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, ENV);
  const prev = process.env[ENV];
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  try {
    return await fn();
  } finally {
    if (had) process.env[ENV] = prev;
    else delete process.env[ENV];
  }
}

/** notify() raced against the case's own clock: `{ settled, value, ms }` — never a hung suite. */
async function raced(promise, deadlineMs) {
  const t0 = Date.now();
  let settled = false;
  let value;
  const done = promise.then((v) => { settled = true; value = v; return v; });
  await Promise.race([done, sleep(deadlineMs)]);
  return { settled, value, ms: Date.now() - t0 };
}

function cli(args, env, timeout) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, timeout }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? null : err.code) : 0, killed: !!err?.killed, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

test("(1) the webhookUrl argument is honoured and wins over TMUX_AGENT_SLACK_WEBHOOK — read from the stubs", async () => {
  const H = home();
  const ledger = new ta.Ledger(join(H, "ledger"));
  const A = await stub(200);
  const B = await stub(200);
  try {
    // env UNSET, argument A
    const r1 = await withEnv(undefined, () => new ta.SlackWebhookSink(ledger, A.url).notify("T1", "B1", { session: "w1" }));
    assert.deepEqual([A.hits.length, B.hits.length], [1, 0], `with the env unset and the argument A, A must take the POST: A ${A.hits.length}, B ${B.hits.length} (0, 0 is the argument ignored)`);
    assert.equal(r1, true, "a 200 from the argument's stub is a successful send");
    assert.equal(A.hits[0].method, "POST");
    assert.match(A.hits[0].contentType ?? "", /application\/json/, "content-type, read from the stub");
    assert.deepEqual(JSON.parse(A.hits[0].body), { text: "*T1*\nB1" }, "the body, read from the stub");
    // env SET to B, argument A — the argument wins
    const r2 = await withEnv(B.url, () => new ta.SlackWebhookSink(ledger, A.url).notify("T2", "B2"));
    assert.equal(r2, true);
    assert.deepEqual([A.hits.length, B.hits.length], [2, 0], `with the env at B and the argument A, the ARGUMENT must win: A ${A.hits.length}, B ${B.hits.length} (the env read winning is the drift)`);
    // env SET to B, no argument — the env is the fallback
    const r3 = await withEnv(B.url, () => new ta.SlackWebhookSink(ledger).notify("T3", "B3"));
    assert.equal(r3, true);
    assert.deepEqual([A.hits.length, B.hits.length], [2, 1], `with no argument the env must be read: A ${A.hits.length}, B ${B.hits.length}`);
    assert.deepEqual(rowFor(H, "T1"), { session: "w1", sink: "slack", ok: true, title: "T1" }, "the successful row: meta's key landed, own fields present, no reason");
  } finally {
    A.close(); B.close();
    rmSync(H, { recursive: true, force: true });
  }
});

test("(2) every failed send says why — four distinct reasons on the ledger file, the no-URL wording unchanged", async () => {
  const H = home();
  const ledger = new ta.Ledger(join(H, "ledger"));
  const E500 = await stub(500, { text: "no_service" });
  const BH = await stub(200, { blackhole: true });
  try {
    // the three arms that ANSWER (or refuse) first, so on a tree with no reason the red quotes their rows
    await withEnv(undefined, async () => {
      assert.equal(await new ta.SlackWebhookSink(ledger, E500.url).notify("T500", "b"), false);
      assert.equal(await new ta.SlackWebhookSink(ledger, await closedPortUrl()).notify("Trefused", "b"), false);
      assert.equal(await new ta.SlackWebhookSink(ledger, "not a url").notify("Tnourl", "b"), false);
      assert.equal(await new ta.SlackWebhookSink(ledger).notify("Tnone", "b"), false);
    });
    const rows = Object.fromEntries(["T500", "Trefused", "Tnourl", "Tnone"].map((t) => [t, rowFor(H, t)]));
    for (const [t, row] of Object.entries(rows)) {
      assert.equal(row.ok, false, `${t}: ok`);
      assert.equal(row.sink, "slack", `${t}: sink`);
      assert.equal(typeof row.reason, "string", `${t}: the row carries no reason — the row was ${JSON.stringify(row)} (keys ${JSON.stringify(Object.keys(row))})`);
      assert.ok(row.reason.length > 0, `${t}: an empty reason`);
    }
    assert.match(rows.T500.reason, /HTTP 500/, `the 500 arm names the status: ${rows.T500.reason}`);
    assert.match(rows.Trefused.reason, /ECONNREFUSED/, `the refused arm names the socket error: ${rows.Trefused.reason}`);
    assert.match(rows.Tnourl.reason, /ERR_INVALID_URL/, `the not-a-URL arm names the parse error: ${rows.Tnourl.reason}`);
    assert.equal(rows.Tnone.reason, "no TMUX_AGENT_SLACK_WEBHOOK", "the no-URL wording is byte-for-byte what test/versioning-contract.test.js reads");
    // the arm that never answers, raced against this case's own clock
    const bh = await withEnv(undefined, () => raced(new ta.SlackWebhookSink(ledger, BH.url, 500).notify("Tbh", "b"), 500 + 1000));
    assert.ok(bh.settled, "the black-hole arm did not settle within 500 ms + 1 s — STILL PENDING at the deadline (the parent held it ~300 s)");
    assert.equal(bh.value, false);
    const bhRow = rowFor(H, "Tbh");
    assert.equal(bhRow.ok, false);
    assert.match(bhRow.reason ?? "", /TimeoutError/, `the timed-out arm names the timeout: ${JSON.stringify(bhRow)}`);
    assert.match(bhRow.reason ?? "", /500 ms/, `the timed-out arm names the bound: ${bhRow.reason}`);
    // pairwise distinct
    const four = [rows.T500.reason, rows.Trefused.reason, rows.Tnourl.reason, bhRow.reason];
    assert.equal(new Set(four).size, 4, `the four failure arms must be tellable apart by their reason: ${JSON.stringify(four)}`);
  } finally {
    E500.close(); BH.close();
    rmSync(H, { recursive: true, force: true });
  }
});

test("(3) a caller's meta cannot overwrite the row's own fields, and its other keys still land — both sinks", async () => {
  const homes = { console: home(), slack: home() };
  const A = await stub(200);
  const evil = { ok: false, sink: "evil", title: "X", session: "s" };
  const quiet = console.error;
  console.error = () => {};
  try {
    const rc = await new ta.ConsoleSink(new ta.Ledger(join(homes.console, "ledger"))).notify("Tc", "b", { ...evil });
    console.error = quiet;
    const rs = await withEnv(undefined, () => new ta.SlackWebhookSink(new ta.Ledger(join(homes.slack, "ledger")), A.url).notify("Ts", "b", { ...evil }));
    assert.equal(rc, true, "the console sink's own outcome is true");
    assert.equal(rs, true, "a 200 is a successful send — meta's ok: false must not change the return either");
    assert.equal(A.hits.length, 1, "the Slack sink POSTed once");
    for (const [sink, title] of [["console", "Tc"], ["slack", "Ts"]]) {
      const rows = sentRows(homes[sink]);
      assert.equal(rows.length, 1, `${sink}: one row for this send, found ${rows.length}: ${JSON.stringify(rows)}`);
      const row = rows[0];
      assert.equal(row.sink, sink, `${sink}: the row's sink is the sink's own name — this tree ledgered ${JSON.stringify(row)}`);
      assert.equal(row.ok, true, `${sink}: the row's ok is the send's own outcome — this tree ledgered ${JSON.stringify(row)}`);
      assert.equal(row.title, title, `${sink}: the row's title is the call's — this tree ledgered ${JSON.stringify(row)}`);
      assert.equal(row.session, "s", `${sink}: meta's other keys still land — this tree ledgered ${JSON.stringify(row)}`);
      assert.ok(!JSON.stringify(row).includes("evil"), `${sink}: the planted sink name must appear nowhere in the row: ${JSON.stringify(row)}`);
    }
  } finally {
    console.error = quiet;
    A.close();
    for (const H of Object.values(homes)) rmSync(H, { recursive: true, force: true });
  }
});

test("(4) a webhook that never answers is bounded — 500 ms explicitly, the default measured, and watch exits within it", async () => {
  const H = home();
  const ledger = new ta.Ledger(join(H, "ledger"));
  const BH = await stub(200, { blackhole: true });
  const S = socket();
  const HC = home();
  try {
    await withEnv(undefined, async () => {
      // the explicit bound, raced against this case's own deadline
      const short = await raced(new ta.SlackWebhookSink(ledger, BH.url, 500).notify("Tshort", "b"), 1500);
      assert.ok(short.settled, `a 500 ms bound must settle within 500 ms + 1 s — STILL PENDING at 1500 ms (the parent's dist has no bound: 300.8 s measured)`);
      assert.equal(short.value, false, "a send that never got its answer is a failed send");
      assert.ok(short.ms >= 400, `settled at ${short.ms} ms — before the 500 ms bound could have fired, so something other than the bound ended it`);
      assert.match(rowFor(H, "Tshort").reason ?? "", /TimeoutError.*500 ms/, `the row names the timeout and the bound: ${JSON.stringify(rowFor(H, "Tshort"))}`);
      assert.equal(BH.hits.length, 1, "the stub received the POST — it was the answer that never came");

      // the DEFAULT bound: read off the built object, then its settle measured against it
      const dflt = new ta.SlackWebhookSink(ledger, BH.url);
      const bound = dflt.timeoutMs;
      assert.ok(Number.isFinite(bound) && bound > 0 && bound <= 60_000, `the built sink's default bound must be a positive number of ms no longer than a minute, got ${JSON.stringify(bound)}`);
      const slackMs = 20_000;
      const [long, watched] = await Promise.all([
        raced(dflt.notify("Tdefault", "b"), bound + 2000),
        (async () => {
          const sp = await cli(["--socket", S, "spawn", "w-bh", "--cwd", "/tmp", "--parent", "notifytest"], { TMUX_AGENT_HOME: HC }, 60_000);
          assert.equal(sp.code, 0, `spawn failed: ${sp.stderr.slice(0, 200)}`);
          const t0 = Date.now();
          const r = await cli(["--socket", S, "watch", "w-bh", "--idle-secs", "1"], { TMUX_AGENT_HOME: HC, [ENV]: BH.url }, bound + slackMs);
          return { ...r, ms: Date.now() - t0 };
        })(),
      ]);
      assert.ok(long.settled, `the default bound (${bound} ms, read off the built sink) did not settle within ${bound + 2000} ms — STILL PENDING`);
      assert.equal(long.value, false);
      assert.ok(long.ms >= bound * 0.9, `the default settled at ${long.ms} ms, well before its ${bound} ms bound — the bound is not what ended it`);
      assert.ok(!watched.killed, `watch --idle-secs 1 against the black hole was still running at the default bound (${bound} ms) + ${slackMs} ms of slack and had to be killed — the unanswered webhook holds the watcher`);
      assert.equal(watched.code, 0, `watch must exit 0 on idle regardless of the sink: got ${watched.code} (${watched.stderr.slice(0, 200)})`);
      const row = sentRows(HC).find((r) => r.ok === false);
      assert.ok(row, `the CLI's ledger has no failed notify.sent row: ${JSON.stringify(sentRows(HC))}`);
      assert.match(row.reason ?? "", /TimeoutError/, `the CLI's row names the timeout: ${JSON.stringify(row)}`);
      assert.equal(row.session, "w-bh", "the CLI's meta (session) still lands beside the reason");
    });
  } finally {
    BH.close();
    killServerSync(S);
    rmSync(H, { recursive: true, force: true });
    rmSync(HC, { recursive: true, force: true });
  }
});

test("(5) ConsoleSink writes stderr and nothing on stdout — real streams, and the comment says so and why", async () => {
  const H = home();
  try {
    const script = `import { ConsoleSink, Ledger } from ${JSON.stringify(join(ROOT, "dist/index.js"))};
const ok = await new ConsoleSink(new Ledger(${JSON.stringify(join(H, "ledger"))})).notify("T5", "B5", { session: "s5" });
process.exitCode = ok ? 0 : 1;`;
    const r = await new Promise((resolve) =>
      execFile(process.execPath, ["--input-type=module", "-e", script], { timeout: 30_000 }, (err, stdout, stderr) =>
        resolve({ code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) })));
    assert.equal(r.code, 0, `the child failed: ${r.stderr}`);
    assert.equal(r.stderr.trim(), "[notify] T5: B5", `the line lands on stderr, exactly: ${JSON.stringify(r.stderr)}`);
    assert.equal(r.stdout, "", `NOTHING on stdout — watch's verdict JSON lives there: ${JSON.stringify(r.stdout)}`);
    assert.deepEqual(rowFor(H, "T5"), { session: "s5", sink: "console", ok: true, title: "T5" });
    // the declaration comment, pinned
    const src = readFileSync(SRC, "utf8");
    const at = src.indexOf("export class ConsoleSink");
    assert.ok(at > 0, "src/adapters/notify/slack.ts no longer declares ConsoleSink where this pin reads it");
    const open = src.lastIndexOf("/**", at);
    const comment = src.slice(open, at);
    assert.ok(open > 0 && comment.includes("*/"), "ConsoleSink has no declaration comment to pin");
    assert.match(comment, /stderr/, `ConsoleSink's comment must say which stream: ${comment.trim()}`);
    assert.match(comment, /stdout/, `…and WHY (what stdout carries that a notify line would corrupt): ${comment.trim()}`);
    assert.equal((src.match(/stdout sink/g) ?? []).length, 0, "the comment drifted back: 'stdout sink' occurs in src/adapters/notify/slack.ts (the parent's wording — it wrote stderr)");
  } finally {
    rmSync(H, { recursive: true, force: true });
  }
});
