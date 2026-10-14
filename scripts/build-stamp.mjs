#!/usr/bin/env node
/**
 * Build stamp: runs after tsc in `npm run build` and writes dist/build.json
 * { version, commit, builtAt } — the one fact the product could not state about itself while
 * the operator's dashboard ran a 47-commit-stale build for 16 days (see src/core/build.ts).
 *
 *  - version: package.json's — the same number `npm pack` ships.
 *  - commit:  `git rev-parse --short HEAD`, argv form (never a shell string — eslint bans the
 *             class); null when there is no git tree, which is the honest answer for a tarball
 *             or the pre-push gate's `git archive` extraction, never a guess.
 *  - builtAt: now, ISO-8601. Two builds of one commit differ here on purpose: a daemon started
 *             from the earlier one is not running what is on disk.
 *
 * dist ships wholesale (package.json `files`), so the stamp travels with the code it describes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(dist)) {
  console.error("build-stamp: dist/ is missing — run tsc first (npm run build does both)");
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let commit = null;
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
} catch {
  /* not a git tree (tarball, git archive) — null, never invented */
}
const stamp = { version, commit, builtAt: new Date().toISOString() };
writeFileSync(join(dist, "build.json"), JSON.stringify(stamp, null, 2) + "\n");
console.error(`build-stamp: dist/build.json ${version} (${commit ?? "no git commit"}, built ${stamp.builtAt})`);
