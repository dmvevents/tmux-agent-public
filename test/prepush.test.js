/**
 * Pre-push gate regression (TMUX-68a): concurrent-writer safety is a CHECK, not etiquette.
 *
 * The gate (scripts/pre-push) builds `git archive HEAD` in a throwaway dir, so a commit
 * that references files existing only in the working tree cannot leave the host. That is
 * the exact half-commit shape that reached master on 2026-08-26 and broke every CI job
 * (run 33004314830) before a heal commit.
 *
 * BANLIST discipline: a control is verified by watching it FAIL on planted input first —
 * so this file replays the half-commit (gate must block) BEFORE trusting the healthy-tree
 * pass (gate must not be over-broad). Removing or breaking scripts/pre-push fails both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "pre-push");

/** git in the fixture must never inherit this checkout's identity/hooks/config */
function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=fixture@test", "-c", "user.name=fixture", ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGate(cwd) {
  return spawnSync("bash", [GATE], { cwd, encoding: "utf8" });
}

test("pre-push gate blocks a half-commit, then passes once the file is committed", () => {
  const repo = mkdtempSync(join(tmpdir(), "prepush-fixture-"));
  try {
    git(repo, "init", "-q");
    // a "build" that needs needed.cjs — node exits non-zero if the module is absent
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ name: "fixture", private: true, scripts: { build: "node needed.cjs" } }),
    );
    mkdirSync(join(repo, "node_modules")); // gate symlinks deps; the fixture needs none
    git(repo, "add", "package.json");
    git(repo, "commit", "-q", "-m", "half-commit: build needs a file that is not committed");

    // the planted input: the file the build needs exists ONLY in the working tree
    writeFileSync(join(repo, "needed.cjs"), "process.exit(0);\n");
    const blocked = runGate(repo);
    assert.notEqual(blocked.status, 0, "gate must FAIL while needed.cjs is uncommitted");
    assert.match(blocked.stderr, /committed tree alone/, "block message names the trap");

    // heal: commit the file — the gate must not be over-broad
    git(repo, "add", "needed.cjs");
    git(repo, "commit", "-q", "-m", "heal: commit the needed file");
    const healthy = runGate(repo);
    assert.equal(healthy.status, 0, `gate must pass a fully committed tree (stderr: ${healthy.stderr})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
