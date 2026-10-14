/**
 * Changelog-drift gate regression: "CHANGELOG current" is a CHECK, not a checkmark.
 *
 * KR5 carried the ✅ for two weeks by inheritance while four shipped-tree commits landed with
 * no [Unreleased] entry (15afe63, TMUX-78/80 lock bumps, TMUX-79). test/changelog-current.sh
 * walks every commit since CHANGELOG.md last moved and fails on one that touched src/**,
 * package.json or package-lock.json without it.
 *
 * BANLIST discipline: watch the control FAIL on planted input before trusting a pass — so
 * this file plants an unrecorded src change first (gate must block, naming the commit and the
 * file), then proves the gate is not over-broad (docs-only commits ignored, [no-changelog]
 * excused, uncommitted CHANGELOG edits count as the pending entry), re-arms after the heal,
 * and refuses to pass vacuously (shallow clone, no anchor). Removing or breaking the script
 * fails all of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "changelog-current.sh");
/** git in the fixture must never inherit this checkout's identity/hooks/config */
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=fixture@test", "-c", "user.name=fixture", ...args], {
    cwd,
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGate(repo) {
  return spawnSync("bash", [GATE, repo], { encoding: "utf8", env: ENV });
}

/** write (or append to) a file and commit it alone, returning the short SHA */
function commit(repo, file, subject) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  appendFileSync(join(repo, file), `${subject}\n`);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", subject);
  return git(repo, "rev-parse", "--short", "HEAD").toString().trim();
}

test("changelog gate blocks an unrecorded shipped-tree commit, excuses what it should, re-arms after the heal", () => {
  const repo = mkdtempSync(join(tmpdir(), "changelog-fixture-"));
  try {
    git(repo, "init", "-q");
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, "add", "CHANGELOG.md", "src/a.ts");
    git(repo, "commit", "-q", "-m", "initial: code and its changelog land together");

    const clean = runGate(repo);
    assert.equal(clean.status, 0, `healthy repo must pass (stderr: ${clean.stderr})`);
    assert.match(clean.stdout, /scanning 0 commit/, "the scan size is printed — a silent pass does not exist");

    // the planted input: shipped code changes, changelog does not
    const bad = commit(repo, "src/a.ts", "fix: unrecorded behaviour change");
    const blocked = runGate(repo);
    assert.equal(blocked.status, 1, "gate must FAIL on the unrecorded src commit");
    assert.match(blocked.stderr, /CHANGELOG-CHECK FAIL: 1 commit/, "exactly the one offender");
    assert.match(blocked.stderr, new RegExp(`${bad} fix: unrecorded`), "the offender is named by SHA and subject");
    assert.match(blocked.stderr, /<src\/a\.ts>/, "and by the shipped file it touched");

    // not over-broad: a docs-only commit is not an offender (still the same single one)
    commit(repo, "README.md", "docs: readme only");
    assert.match(runGate(repo).stderr, /FAIL: 1 commit/, "docs-only commits are not offenders");

    // the lock file IS watched — lock-only security bumps were the unrecorded class
    const lock = commit(repo, "package-lock.json", "fix(deps): bump something");
    const two = runGate(repo);
    assert.match(two.stderr, /FAIL: 2 commit/, "a lock-only commit is an offender");
    assert.match(two.stderr, new RegExp(`${lock} fix\\(deps\\).*<package-lock\\.json>`));

    // the escape hatch is honoured, visibly
    const hatch = commit(repo, "src/b.ts", "chore: comment only [no-changelog]");
    const excused = runGate(repo);
    assert.equal(excused.status, 1, "an excused commit does not forgive the earlier offenders");
    assert.match(excused.stdout, new RegExp(`excused\\s+${hatch} chore: comment only`), "the excuse is printed, not silent");
    assert.match(excused.stderr, /FAIL: 2 commit/, "the excused commit is not counted");

    // uncommitted CHANGELOG edits are the pending entry (how entries and code land in one commit)
    appendFileSync(join(repo, "CHANGELOG.md"), "- recorded\n");
    const pending = runGate(repo);
    assert.equal(pending.status, 0, `dirty CHANGELOG.md must pass as pending (stderr: ${pending.stderr})`);
    assert.match(pending.stdout, /PASS \(pending\)/);
    assert.match(pending.stdout, new RegExp(`${bad} fix: unrecorded`), "and still names what it is covering");

    // heal: commit the changelog — the anchor moves and the scan is empty again
    git(repo, "add", "CHANGELOG.md");
    git(repo, "commit", "-q", "-m", "docs(changelog): record the fix and the bump");
    const healed = runGate(repo);
    assert.equal(healed.status, 0, `healed repo must pass (stderr: ${healed.stderr})`);
    assert.match(healed.stdout, /scanning 0 commit/);

    // re-arms: the next unrecorded src commit is caught against the NEW anchor
    const again = commit(repo, "src/a.ts", "feat: another unrecorded change");
    const rearmed = runGate(repo);
    assert.equal(rearmed.status, 1, "gate must re-arm after the heal");
    assert.match(rearmed.stderr, new RegExp(`FAIL: 1 commit[\\s\\S]*${again} feat: another`));

    // vacuity guard: a shallow clone cannot see the anchor and must refuse, not pass
    const shallow = mkdtempSync(join(tmpdir(), "changelog-shallow-"));
    try {
      git(shallow, "clone", "-q", "--depth", "1", `file://${repo}`, "clone");
      const refused = runGate(join(shallow, "clone"));
      assert.equal(refused.status, 2, "shallow clone must be refused (exit 2), never passed");
      assert.match(refused.stderr, /shallow clone.*vacuous[\s\S]*fetch-depth: 0/);
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("changelog gate refuses a history with no CHANGELOG.md commit at all", () => {
  const repo = mkdtempSync(join(tmpdir(), "changelog-noanchor-"));
  try {
    git(repo, "init", "-q");
    commit(repo, "src/a.ts", "feat: code with no changelog ever");
    const noAnchor = runGate(repo);
    assert.equal(noAnchor.status, 2, "no anchor is a hard error, not an empty (vacuous) pass");
    assert.match(noAnchor.stderr, /no commit touching CHANGELOG\.md.*refusing to pass/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
