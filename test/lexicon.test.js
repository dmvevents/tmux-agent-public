/**
 * Lexicon tests — the executable form of the claim "agnostic".
 *
 * KR3 previously measured OUR coverage ("3 agent CLIs exercised") which we could satisfy by
 * writing all three profiles ourselves. That is not extensibility. The load-bearing test in this
 * file is the last one: a stranger's NEW CLI, NEW supervisor naming scheme, and NEW secret shape
 * all take effect from config alone, asserted by behaviour change — no fork, no rebuild.
 *
 * Run: node --test test/lexicon.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLexicon,
  validateLexicon,
  compilePattern,
  compileRedactRules,
  compileParentRules,
  LexiconError,
} from "../dist/core/lexicon.js";
import { profileFromLexicon, resolveProfiles, claudeCodeProfile, genericShellProfile } from "../dist/core/monitor.js";
import { redact, configureRedaction, extraRedactionRuleCount } from "../dist/core/redact.js";
import { calibrate, entropy, escapeRegex } from "../dist/core/calibrate.js";
import { killServerSync } from "./helpers/kill-server.js";

function home(cfg) {
  const h = mkdtempSync(join(tmpdir(), "ta-lex-"));
  if (cfg !== undefined) writeFileSync(join(h, "lexicon.json"), typeof cfg === "string" ? cfg : JSON.stringify(cfg));
  return h;
}

// ── loading: absent file must be a no-op, not an error ──────────────────────────────

test("no lexicon file => empty config (v0.1.0 behaviour is unchanged by this feature)", () => {
  const h = home();
  assert.deepEqual(loadLexicon(h), {});
  rmSync(h, { recursive: true, force: true });
});

// ── loading: a lexicon that was NAMED and cannot be read is refused — never silently the defaults ──

test("a named lexicon the tool cannot read is a LexiconError naming the source, the path as given and the OS reason; only the absent default is silently {}", (t) => {
  // Measured 2026-09-15 on 85d3ba7 and 2026-09-16 on bc8b2ea (scratch/ga-fire-2026-09-16-00Z/lexicon-probe/probe-bc8b2ea.log):
  // one bare `catch { return {}; }` around readFileSync, meant for the absent default, also swallowed --lexicon FILE and
  // TMUX_AGENT_LEXICON on a path that does not exist, a directory (EISDIR) and a file this user cannot read (EACCES) —
  // the operator's redact rules silently not applied, exit 0 on every verb, doctor alone reading loaded:false. One rule:
  // {} only when nothing was named AND the default path is absent (the test above); every other read failure throws,
  // naming the source, the path as given and the OS reason in words, and the caller refuses (CLI 78, MCP startup 78).
  const h = home(); // the default absent
  const T = mkdtempSync(join(tmpdir(), "ta-lex-unread-"));
  const missing = join(T, "nope", "lex.json");
  const dir = join(T, "adir");
  mkdirSync(dir);
  const locked = join(T, "locked.json");
  writeFileSync(locked, '{"version":1}');
  chmodSync(locked, 0o000);
  // root reads a 000 file (accessSync R_OK passes), so the case would be a false red there — skip it, named
  let canRead = true;
  try {
    accessSync(locked, constants.R_OK);
  } catch {
    canRead = false;
  }
  if (canRead) t.diagnostic("000-mode cases skipped: this user can read a 000 file (running as root?)");
  const thrown = (fn) => {
    try {
      return { value: fn() };
    } catch (e) {
      return { error: e };
    }
  };
  const refused = (fn, source, p, reason, label) => {
    const got = thrown(fn);
    assert.ok(
      got.error instanceof LexiconError,
      `${label}: want a LexiconError, got ${got.error ? `${got.error.constructor.name}: ${got.error.message}` : `no throw — loaded as ${JSON.stringify(got.value)} (the defaults, silently)`}`,
    );
    assert.equal(got.error.message, `${source} ${JSON.stringify(p)}: cannot be read — ${reason}`, `${label}: the source, the path as given and the OS reason in words`);
  };
  const prev = process.env.TMUX_AGENT_LEXICON;
  const lockedHome = home({ version: 1 });
  chmodSync(join(lockedHome, "lexicon.json"), 0o000);
  const dirHome = home();
  mkdirSync(join(dirHome, "lexicon.json"));
  const linkHome = home(); // lexicon.json a symbolic link whose target is missing
  const liveLinkHome = home(); // lexicon.json a symbolic link to a readable file
  try {
    delete process.env.TMUX_AGENT_LEXICON;
    // the flag's path: does not exist, a directory, unreadable
    refused(() => loadLexicon(h, missing), "--lexicon", missing, "no such file or directory (ENOENT)", "--lexicon <missing>");
    refused(() => loadLexicon(h, dir), "--lexicon", dir, "is a directory, not a file (EISDIR)", "--lexicon <a directory>");
    if (!canRead) refused(() => loadLexicon(h, locked), "--lexicon", locked, "permission denied for this user (EACCES)", "--lexicon <000 file>");
    // the variable: the same rule under its own name; set-but-empty is a lexicon named nothing, refused like the actor's
    process.env.TMUX_AGENT_LEXICON = missing;
    refused(() => loadLexicon(h), "TMUX_AGENT_LEXICON", missing, "no such file or directory (ENOENT)", "TMUX_AGENT_LEXICON=<missing>");
    process.env.TMUX_AGENT_LEXICON = "";
    refused(() => loadLexicon(h), "TMUX_AGENT_LEXICON", "", "no such file or directory (ENOENT)", "TMUX_AGENT_LEXICON= (set, empty)");
    // the flag still outranks the variable: a readable --lexicon loads while TMUX_AGENT_LEXICON names a missing path
    process.env.TMUX_AGENT_LEXICON = missing;
    writeFileSync(join(T, "ok.json"), '{"version":1}');
    assert.deepEqual(loadLexicon(h, join(T, "ok.json")), { version: 1 }, "a readable --lexicon FILE no longer wins over TMUX_AGENT_LEXICON");
    delete process.env.TMUX_AGENT_LEXICON;
    // the default path: absent stays {} (the one silent case); present and unreadable, or a directory, is refused
    assert.deepEqual(loadLexicon(h), {}, "the absent default is no longer the empty lexicon (v0.1.0 behaviour)");
    if (!canRead) refused(() => loadLexicon(lockedHome), "default path", join(lockedHome, "lexicon.json"), "permission denied for this user (EACCES)", "$TMUX_AGENT_HOME/lexicon.json present at mode 000");
    refused(() => loadLexicon(dirHome), "default path", join(dirHome, "lexicon.json"), "is a directory, not a file (EISDIR)", "$TMUX_AGENT_HOME/lexicon.json a directory");
    // a symbolic link whose target is missing reads ENOENT like the absent file; the entry exists, so it is refused naming
    // the link and its target (TMUX-226 — on cd44cf1 it loaded as {}, the operator's redact rules silently not applied);
    // a link whose target exists is the file it points to
    const target = join(T, "moved-dotfiles", "lex.json"); // never created
    symlinkSync(target, join(linkHome, "lexicon.json"));
    const DANGLING = `a symbolic link to ${JSON.stringify(target)}, which does not exist (ENOENT)`;
    refused(() => loadLexicon(linkHome), "default path", join(linkHome, "lexicon.json"), DANGLING, "$TMUX_AGENT_HOME/lexicon.json a symbolic link whose target is missing");
    symlinkSync(target, join(T, "dangling.json"));
    refused(() => loadLexicon(h, join(T, "dangling.json")), "--lexicon", join(T, "dangling.json"), DANGLING, "--lexicon <a symbolic link whose target is missing>");
    symlinkSync(join(T, "ok.json"), join(liveLinkHome, "lexicon.json"));
    assert.deepEqual(loadLexicon(liveLinkHome), { version: 1 }, "a default-path link to a readable lexicon no longer loads as that file (TMUX-226's control)");
  } finally {
    if (prev === undefined) delete process.env.TMUX_AGENT_LEXICON;
    else process.env.TMUX_AGENT_LEXICON = prev;
    chmodSync(locked, 0o600);
    chmodSync(join(lockedHome, "lexicon.json"), 0o600);
    for (const d of [h, T, lockedHome, dirHome, linkHome, liveLinkHome]) rmSync(d, { recursive: true, force: true });
  }
});

test("malformed JSON throws LexiconError naming the file, never silently ignored", () => {
  const h = home("{ this is not json ");
  // Silent fallback here would be the worst outcome: the operator believes their customisation
  // (possibly including redaction rules) is active when nothing loaded.
  assert.throws(() => loadLexicon(h), (e) => e instanceof LexiconError && e.message.includes("not valid JSON"));
  rmSync(h, { recursive: true, force: true });
});

test("a future version is refused rather than half-understood", () => {
  const h = home({ version: 99 });
  assert.throws(() => loadLexicon(h), /unsupported version 99/);
  rmSync(h, { recursive: true, force: true });
});

// ── validation: every failure names the offending rule ──────────────────────────────

test("an invalid regex reports WHICH rule broke, not just that something did", () => {
  assert.throws(
    () => validateLexicon({ profiles: [{ name: "mine", blocked: ["([unclosed"] }] }),
    (e) => e instanceof LexiconError && e.message.includes('profile "mine".blocked[0]'),
  );
});

test("contextPct without a capture group is rejected (it would yield null forever)", () => {
  assert.throws(() => validateLexicon({ profiles: [{ name: "mine", contextPct: "ctx: \\d+%" }] }), /needs one capture group/);
  // a non-capturing group must not satisfy it either
  assert.throws(() => validateLexicon({ profiles: [{ name: "m2", contextPct: "(?:\\d+)%" }] }), /needs one capture group/);
  // and the valid form passes
  validateLexicon({ profiles: [{ name: "ok", contextPct: "ctx:(\\d+)%" }] });
});

test("a redact rule without a name is refused — the name is what makes failures diagnosable", () => {
  assert.throws(() => validateLexicon({ redact: [{ pattern: "x", replacement: "y" }] }), /needs a "name"/);
});

// ── ReDoS screening: a config typo must not hang the poll loop ──────────────────────

test("nested unbounded quantifiers are rejected at load (JS has no regex timeout)", () => {
  // (a+)+ against a long non-matching string is the classic catastrophic-backtracking shape.
  // Since we cannot interrupt a running regex, the only defence is refusing it up front.
  assert.throws(() => compilePattern("(a+)+$", "i", "test"), /nested unbounded quantifier/);
  assert.throws(() => compilePattern("(\\d*)*x", "i", "test"), /nested unbounded quantifier/);
  // legitimate patterns with a single quantifier are unaffected
  assert.ok(compilePattern("^\\s*[›❯]\\s*\\d+\\.", "i", "test") instanceof RegExp);
});

test("an over-long pattern is refused with its length", () => {
  assert.throws(() => compilePattern("a".repeat(600), "i", "test"), /longer than 512 chars \(got 600\)/);
});

// ── redaction: additive by construction, and that property is enforced ──────────────

test("user redaction rules ADD to the built-ins; built-ins keep working", () => {
  configureRedaction({ redact: [{ name: "azure", pattern: "AZ-[0-9a-f]{8}", replacement: "[REDACTED_AZURE]" }] });
  const out = redact("aws=AKIAIOSFODNN7EXAMPLE azure=AZ-deadbeef");
  assert.match(out, /\[REDACTED_AWS_KEY\]/, "built-in must still fire after configuring extras");
  assert.match(out, /\[REDACTED_AZURE\]/, "user rule must fire");
  assert.equal(extraRedactionRuleCount(), 1);
  configureRedaction({}); // reset for other tests
});

test("there is NO config path that disables a built-in redaction pattern", () => {
  // The security property: a lexicon can only make redaction stronger. Even a config that tries
  // to look like a replacement leaves the built-ins in force.
  configureRedaction({ redact: [], replaceRedact: true, redactReplace: true });
  assert.match(redact("key=AKIAIOSFODNN7EXAMPLE"), /\[REDACTED_AWS_KEY\]/);
  configureRedaction({});
});

test('redaction flags always include "g" — a rule that scrubs only the first match leaks the rest', () => {
  configureRedaction({ redact: [{ name: "tok", pattern: "TOK-\\d+", replacement: "[R]", flags: "i" }] });
  assert.equal(redact("TOK-1 TOK-2 TOK-3"), "[R] [R] [R]");
  configureRedaction({});
});

// ── profiles: user vocabulary wins, and can describe a CLI we have never seen ───────

test("a lexicon profile classifies a CLI nobody has profiled", () => {
  const p = profileFromLexicon({
    name: "my-cli",
    error: ["quota exceeded"],
    blocked: ["^\\s*»\\s*\\d+\\."],
    working: ["cogitating"],
  });
  assert.equal(p.classify(["» 1. Apply", "  2. Skip"]), "BLOCKED");
  assert.equal(p.classify(["cogitating…"]), "WORKING");
  assert.equal(p.classify(["quota exceeded, retrying"]), "ERROR");
  assert.equal(p.classify(["nothing interesting"]), null);
  // the built-in profile is blind to this CLI's glyph — which is the whole reason config exists
  assert.equal(claudeCodeProfile.classify(["» 1. Apply"]), null);
});

test("ERROR outranks BLOCKED and WORKING (a CLI erroring every turn looks idle but is stuck)", () => {
  const p = profileFromLexicon({ name: "x", error: ["fatal"], blocked: ["\\[y/n\\]"], working: ["busy"] });
  assert.equal(p.classify(["busy", "fatal: out of quota", "[y/n]"]), "ERROR");
});

test("contextPct supports CLIs reporting REMAINING context, not just used", () => {
  const used = profileFromLexicon({ name: "u", contextPct: "ctx:(\\d+)%" });
  assert.equal(used.contextPct(["ctx:42%"]), 42);
  const left = profileFromLexicon({ name: "l", contextPct: "(\\d+)% left", contextPctInverted: true });
  assert.equal(left.contextPct(["30% left"]), 70);
  // out-of-range input is clamped rather than propagating a nonsense percentage into the UI
  const wild = profileFromLexicon({ name: "w", contextPct: "ctx:(\\d+)%" });
  assert.equal(wild.contextPct(["ctx:999%"]), 100);
  assert.equal(wild.contextPct(["no match"]), null);
});

test("user profiles are tried BEFORE built-ins, so an adopter can correct one of ours", () => {
  const order = resolveProfiles({ profiles: [{ name: "mine", blocked: ["x"] }] }).map((p) => p.name);
  assert.deepEqual(order, ["mine", "claude-code", "codex", "aider", "generic-shell"]);
});

test("replaceProfiles drops the built-ins but keeps the no-opinion floor", () => {
  const order = resolveProfiles({ profiles: [{ name: "only" }], replaceProfiles: true }).map((p) => p.name);
  assert.deepEqual(order, ["only", "generic-shell"], "generic-shell must remain or core signals lose their fallback");
});

test("absent lexicon yields exactly the shipped chain", () => {
  assert.deepEqual(resolveProfiles().map((p) => p.name), ["claude-code", "codex", "aider", "generic-shell"]);
});

// ── parents: the 27-of-31 bug, made fixable without a fork ──────────────────────────

test("lexicon parent names extend the built-ins (both still recognised)", () => {
  const builtinNames = new Set(["operator", "cron"]);
  const builtinRe = /watchdog/i;
  const isProc = compileParentRules({ parents: { nonSession: ["boss"], nonSessionPattern: "^orchestrator-\\d+$" } }, builtinNames, builtinRe);
  assert.equal(isProc("boss"), true, "user name");
  assert.equal(isProc("BOSS"), true, "case-insensitive");
  assert.equal(isProc("orchestrator-7"), true, "user pattern");
  assert.equal(isProc("operator"), true, "built-in name still honoured");
  assert.equal(isProc("cron-watchdog"), true, "built-in pattern still honoured");
  assert.equal(isProc("lane-a"), false, "an ordinary session name is NOT a supervisor");
});

test("parents.replace drops the built-ins for a fleet with different conventions", () => {
  const isProc = compileParentRules({ parents: { nonSession: ["boss"], replace: true } }, new Set(["operator"]), /watchdog/i);
  assert.equal(isProc("boss"), true);
  assert.equal(isProc("operator"), false, "replace:true means ONLY the operator's vocabulary");
  assert.equal(isProc("cron-watchdog"), false);
});

// ── calibrate: proposes with evidence, never applies ────────────────────────────────

test("calibrate proposes a shared non-session parent and explains why", () => {
  const r = calibrate([
    { session: "a", parent: "k8s-job", tail: [] },
    { session: "b", parent: "k8s-job", tail: [] },
    { session: "c", parent: "a", tail: [] },
  ]);
  assert.equal(r.parents.length, 1);
  assert.equal(r.parents[0].name, "k8s-job");
  assert.equal(r.parents[0].evidence.seenInSessions, 2);
  assert.match(r.parents[0].reason, /rather than 2 orphans/);
  assert.deepEqual(r.draft.parents.nonSession, ["k8s-job"]);
  // "c" names a LIVE session as parent, so it is not proposed as a process
  assert.ok(!r.parents.some((p) => p.name === "a"));
});

test("a parent named by only ONE session is not proposed (it may be a genuine orphan)", () => {
  const r = calibrate([{ session: "a", parent: "ghost", tail: [] }]);
  assert.equal(r.parents.length, 0);
  assert.match(r.notes.join(" "), /may be genuine orphans/);
});

test("calibrate finds a blocking-prompt SHAPE for an unknown glyph", () => {
  // This is the codex `›` bug generalised: match the shape (marker + numbered option), not the
  // glyph, so a CLI nobody has profiled still gets detected.
  const r = calibrate([
    { session: "a", parent: null, tail: ["» 1. Apply patch", "  2. Skip"] },
    { session: "b", parent: null, tail: ["» 1. Continue"] },
  ]);
  assert.equal(r.prompts.length, 1);
  assert.equal(r.prompts[0].evidence.seenInSessions, 2);
  const p = profileFromLexicon({ name: "t", blocked: [r.prompts[0].suggestedPattern] });
  assert.equal(p.classify(["» 1. Apply patch"]), "BLOCKED", "the proposed pattern must actually work");
});

test("calibrate proposes BLOCKED only — guessing WORKING/ERROR would misclassify confidently", () => {
  const r = calibrate([
    { session: "a", parent: null, tail: ["› 1. Update now"] },
    { session: "b", parent: null, tail: ["› 1. Update now"] },
  ]);
  assert.ok(r.draft.profiles[0].blocked.length > 0);
  assert.equal(r.draft.profiles[0].working, undefined);
  assert.equal(r.draft.profiles[0].error, undefined);
  assert.match(r.notes.join(" "), /BLOCKED only/);
});

test("calibrate reports credential SHAPES without ever copying the secret", () => {
  const secret = "Zx8Q2mKp7Lw4Rt9YbN3vHs6Ge1Dj5Fa0";
  const r = calibrate([{ session: "a", parent: null, tail: [`export MYCLOUD_API_KEY=${secret}`] }]);
  assert.equal(r.secretShapes.length, 1);
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes(secret), "the secret value must NEVER appear in the report");
  assert.match(r.secretShapes[0].shape, /32 chars/);
});

test("calibrate ignores values the built-in redactor already handled", () => {
  const r = calibrate([{ session: "a", parent: null, tail: ["token=[REDACTED]"] }]);
  assert.equal(r.secretShapes.length, 0, "already-redacted text is the built-ins working, not a gap");
});

test("calibrate never claims to have applied anything", () => {
  const r = calibrate([{ session: "a", parent: null, tail: [] }]);
  assert.match(r.notes.join(" "), /NOTHING here has been applied/);
});

test("calibrate is deterministic for the same fleet", () => {
  const input = [
    { session: "a", parent: "boss", tail: ["» 1. x"] },
    { session: "b", parent: "boss", tail: ["» 1. y"] },
  ];
  const at = "2026-08-26T00:00:00.000Z";
  assert.deepEqual(calibrate(input, at), calibrate(input, at));
});

test("entropy separates tokens from prose; escapeRegex neutralises metacharacters", () => {
  assert.ok(entropy("Zx8Q2mKp7Lw4Rt9YbN3v") > 3.2);
  assert.ok(entropy("aaaaaaaaaaaaaaaaaaaa") < 3.2);
  const p = new RegExp(escapeRegex("a.b(c)"));
  assert.ok(p.test("a.b(c)"));
  assert.ok(!p.test("axbXcX"));
});

// ── THE KR3 TEST: a stranger's three customisations, config only ────────────────────

test("KR3: a new CLI, a new supervisor scheme, and a new secret shape all work from config alone", () => {
  // Everything below is what an adopter writes; nothing is what we shipped. If any of the three
  // required a code change, "agnostic" would be a README claim rather than a property.
  const strangerConfig = {
    version: 1,
    profiles: [
      { name: "acme-agent", blocked: ["^\\s*»\\s*\\d+\\."], working: ["ruminating"], error: ["ACME-FATAL"], contextPct: "budget (\\d+)% left", contextPctInverted: true },
    ],
    parents: { nonSession: ["acme-boss"], nonSessionPattern: "^worker-pool-\\d+$" },
    redact: [{ name: "acme-key", pattern: "ACME_[A-Z0-9]{10}", replacement: "[REDACTED_ACME]" }],
  };
  const h = home(strangerConfig);
  const cfg = loadLexicon(h);

  // 1. their CLI is classified, and their profile outranks ours
  const chain = resolveProfiles(cfg);
  assert.equal(chain[0].name, "acme-agent");
  const theirs = chain[0];
  assert.equal(theirs.classify(["» 1. Deploy to prod?"]), "BLOCKED");
  assert.equal(theirs.classify(["ruminating about types"]), "WORKING");
  assert.equal(theirs.contextPct(["budget 20% left"]), 80);

  // 2. their supervisors are not mistaken for dead parents
  const isProc = compileParentRules(cfg, new Set(["operator"]), /watchdog/i);
  assert.equal(isProc("acme-boss"), true);
  assert.equal(isProc("worker-pool-3"), true);
  assert.equal(isProc("their-lane-1"), false);

  // 3. their secret shape is redacted — AND ours still is
  configureRedaction(cfg);
  const scrubbed = redact("k=ACME_ABCDE12345 and aws=AKIAIOSFODNN7EXAMPLE");
  assert.match(scrubbed, /\[REDACTED_ACME\]/, "their shape");
  assert.match(scrubbed, /\[REDACTED_AWS_KEY\]/, "ours is not lost by configuring theirs");
  assert.ok(!scrubbed.includes("ACME_ABCDE12345"));

  configureRedaction({});
  rmSync(h, { recursive: true, force: true });
});

// ── classifiedBy: the honest signal that no profile spoke ───────────────────────────

test("classifiedBy names the profile that decided, or is null when the tool guessed", async () => {
  // Verified against a live fleet 2026-08-26: three sessions painted with an UNPROFILED CLI's
  // blocking prompt ("» 1. Deploy to prod") all reported IDLE with classifiedBy=null. The
  // screenshot in scratch/vocab-banner/ shows the pane waiting on a human while the state reads
  // IDLE — that ambiguity is the codex bug generalised, and this field is what makes it visible.
  const { Monitor } = await import("../dist/core/monitor.js");
  const { Tmux } = await import("../dist/core/tmux.js");
  const { Ledger } = await import("../dist/core/ledger.js");
  const { execFileSync } = await import("node:child_process");
  const S = `ta-cb-${process.pid}`;
  const H = mkdtempSync(join(tmpdir(), "ta-cb-"));
  const t = new Tmux({ socket: S });
  try {
    execFileSync("tmux", ["-L", S, "new-session", "-d", "-s", "cb1", "-c", "/tmp"], { stdio: "ignore" });
    const m = new Monitor(t, new Ledger(join(H, "ledger")), H);
    /**
     * Paint an unprofiled CLI's prompt, and VERIFY it reached the pane tail before asserting.
     *
     * A single send + fixed sleep passed on Linux and failed every macOS CI leg (`expected
     * 'BLOCKED', actual 'IDLE'`): a freshly-spawned shell keeps emitting rc-file noise for
     * seconds, which both swallows keys typed mid-init and pushes the prompt out of the
     * classifier's 6-line tail. Same trap, same fix as test/watch.test.js — a test that depends
     * on unverified setup reports a product bug that does not exist.
     *
     * That first guard (re-paint until the substring "@@ 1." is in the tail) fixed the swallow and
     * left a second race, red in 2 of 4 coverage-mode runs on the dev host (TMUX-88, 2026-09-11;
     * the same `'IDLE' !== 'BLOCKED'`, lastLine a shell prompt or an rc-file line). The tty ECHOES
     * typed keys before the shell has consumed them — echo is not receipt — so a substring guard is
     * satisfied by the command line itself (`…$ clear; printf '\n@@ 1. …'`) while the classifier,
     * anchored at line start, still reads IDLE; whatever the shell prints next (the prompt,
     * `ble.sh: modified USER=…`) is the last line the snapshot then sees. Coverage instrumentation
     * slows the run enough to widen that window; plain runs stayed green. Reproduced
     * deterministically by typing the command WITHOUT Enter into a settled pane
     * (scratch/ga-fire-20260911-14/failfirst/guard-weakness.log). Hence the discipline below,
     * borrowed from `wait_quiet()` in test/smoke.sh: never type into a pane that is still changing,
     * and accept the paint only once the marker sits on an ANCHORED line of a tail that has stopped
     * changing (two identical captures 500 ms apart) — the very tail the snapshot is about to
     * classify. The assertions themselves are never retried: a genuine classifier regression still
     * goes red, now with the pane the monitor actually read attached to the message.
     *
     * The marker is deliberately ASCII (`@@ 1.`) rather than the `»` this feature was designed
     * around: macOS CI runners often have no UTF-8 locale, so a multi-byte glyph can be mangled
     * before any profile sees it — a second, independent way for this to go red that has nothing
     * to do with what the test asserts. `@@ 1.` is matched by none of the four built-in profiles
     * (codex claims `[›❯>]`, so `>>` would NOT be a valid choice here), which is the property the
     * test actually needs. UTF-8 glyph handling is covered by the pure-function profile tests
     * above, where no terminal or locale is involved.
     */
    // same flags as Tmux.capturePane (monitor reads 40 lines, joined), so tails compare like-for-like
    const capture = () => execFileSync("tmux", ["-L", S, "capture-pane", "-p", "-J", "-t", "=cb1:", "-S", "-40"], { encoding: "utf8" });
    // the classifier's view of a pane (monitor.ts snapshot(): last 6 non-empty, right-trimmed lines)
    const tailOf = (pane) => pane.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-6);
    // anchored like the acme profile below — an echoed command line merely CONTAINING "@@ 1." must not count
    const marker = /^\s*@@\s*\d+\./;
    /** two identical non-blank captures 500 ms apart whose tail satisfies `ok` → that pane; null on timeout */
    const settled = async (ok, tries) => {
      let prev = null;
      for (let i = 0; i < tries; i++) {
        const cur = capture();
        if (cur.trim() && cur === prev && ok(tailOf(cur))) return cur;
        prev = cur;
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    };
    // 1. never type into a shell still sourcing its rc files (ble.sh buffers those keys and replays them)
    assert.ok((await settled(() => true, 40)) !== null,
      `test setup: the fresh shell never went quiet (20 s). Pane:\n${capture().slice(-400)}`);
    // 2. paint, and accept only a quiet tail with the marker on an anchored line
    let painted = null;
    for (let i = 0; i < 3 && painted === null; i++) {
      execFileSync("tmux", ["-L", S, "send-keys", "-t", "=cb1:", "clear; printf '\\n@@ 1. Deploy\\n'", "Enter"], { stdio: "ignore" });
      painted = await settled((tail) => tail.some((l) => marker.test(l)), 20);
    }
    // print the evidence, not just the verdict: a failure here is about test SETUP, and the pane
    // text is the only thing that distinguishes that from a classifier bug on a machine we cannot see
    assert.ok(painted !== null, `test setup: the prompt never settled on an anchored tail line. Pane:\n${capture().slice(-400)}`);

    // 3. record what each snapshot actually read, so a failure shows the pane AT SNAPSHOT TIME rather
    //    than the guard's earlier capture. Both monitors share `t`, so wrapping it covers both.
    const seen = [];
    const capturePane = t.capturePane.bind(t);
    t.capturePane = async (name, lines) => { const pane = await capturePane(name, lines); seen.push(pane); return pane; };
    const evidence = () => seen.map((pane, i) =>
      `--- pane as read by snapshot ${i + 1}${tailOf(pane).join("\n") === tailOf(painted).join("\n") ? "" : " (DRIFTED since the guard)"}:\n${pane.trimEnd().slice(-400)}`).join("\n");

    const guessed = await m.snapshot("cb1");
    assert.equal(guessed.classifiedBy, null, `no profile matched, so the tool must admit it guessed\n${evidence()}`);

    // now give it the vocabulary, and the SAME pane becomes a confident BLOCKED
    const m2 = new Monitor(t, new Ledger(join(H, "ledger")), H, resolveProfiles({ profiles: [{ name: "acme", blocked: ["^\\s*@@\\s*\\d+\\."] }] }));
    const known = await m2.snapshot("cb1");
    assert.equal(known.state, "BLOCKED", `the lexicon profile must change the verdict (lastLine: ${known.lastLine})\n${evidence()}`);
    assert.equal(known.classifiedBy, "acme", `and name itself as the classifier\n${evidence()}`);
  } finally {
    killServerSync(S); // and its socket file, once tmux says the server is gone
    rmSync(H, { recursive: true, force: true });
  }
});

test("generic-shell is never reported as the classifier (it has no opinion by design)", () => {
  // generic-shell is the fallback floor; naming it would imply a profile recognised the CLI.
  assert.equal(resolveProfiles().at(-1).name, "generic-shell");
  assert.equal(genericShellProfile.classify(["anything at all"]), null);
});

test("VERSIONING's public-API claim resolves from the package root (not just from deep imports)", async () => {
  // VERSIONING.md item 6 lists these as semver-covered. Declaring an export in a doc while only
  // shipping it at dist/core/... is a promise the package cannot keep — an embedder following the
  // doc gets undefined. Caught exactly that way while writing the doc.
  const root = await import("../dist/index.js");
  for (const k of ["loadLexicon", "validateLexicon", "LexiconError", "resolveProfiles",
                   "profileFromLexicon", "configureRedaction", "configureEngagement", "calibrate"]) {
    assert.equal(typeof root[k], "function", `${k} must be exported from the package root`);
  }
});

test("an anchored pattern matches ANY line of the tail, not only the first (multiline flag)", () => {
  /**
   * Regression for a real product bug found by macOS CI, not by review.
   *
   * Patterns run against the tail joined with newlines. Without the `m` flag a `^` anchors to the
   * start of the WHOLE tail, so an anchored pattern matched only when its line happened to be
   * first. On macOS runners a 60-char hostname in the shell prompt pushed the marker off line 1
   * and the session reported IDLE while its pane plainly showed a blocking prompt — exactly the
   * silent failure this feature exists to remove, reintroduced by a missing flag. The built-in
   * aider profile already used /im; the lexicon path did not, making user patterns strictly weaker
   * than equivalent built-in ones.
   */
  const p = profileFromLexicon({ name: "anchored", blocked: ["^\\s*@@\\s*\\d+\\."] });
  assert.equal(p.classify(["@@ 1. Deploy", "prompt$"]), "BLOCKED", "marker first in tail");
  assert.equal(p.classify(["init noise", "@@ 1. Deploy", "verylonghostname:tmp runner$"]), "BLOCKED",
    "marker NOT first in tail — this is the case that was silently missing");
  assert.equal(p.classify(["nothing", "at all here"]), null, "and it must still not match noise");
  // validation compiles under the SAME flags, or a pattern could validate and then behave differently
  validateLexicon({ profiles: [{ name: "anchored", blocked: ["^\\s*@@\\s*\\d+\\."] }] });
});
