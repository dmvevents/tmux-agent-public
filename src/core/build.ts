/**
 * The running build, observable.
 *
 * Measured 2026-09-12 on a development host: the operator's dashboard daemon had served since 2026-08-26
 * on an old build while HEAD moved 47 commits — four of them reliability fixes the
 * daemon did not run — and nothing in the product said so. /api/health had no version or
 * commit and its `uptimeSec` was the HOST's uptime; `doctor` printed only lexicon.version; there
 * was no --version. "Shipped" and "running" diverged for 16 days, visible only from ps, `git log
 * --until` and the key set of a JSON response. A stranger who pulls a fix and reloads the
 * dashboard sees a green board running the old bug.
 *
 * This module is the observable:
 *   - `npm run build` writes dist/build.json { version, commit, builtAt } (scripts/build-stamp.mjs
 *     runs after tsc; dist ships wholesale, so the tarball carries it);
 *   - `runningBuild()` is that stamp as loaded by THIS process — read once, at module load;
 *   - `readBuildStamp()` re-reads the file, so a long-lived process can compare what is on disk
 *     NOW with what it started from; `buildStatus()` turns the pair into a `stale` verdict the
 *     health watcher alarms on (warn-only: "dashboard runs X, disk has Y — restart to pick up").
 * No network and no upstream comparison: this is the tool's own build and nothing else.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildStamp {
  version: string | null;
  /** `git rev-parse --short HEAD` at build time; null when built outside a git tree (tarball, `git archive`) */
  commit: string | null;
  /** ISO-8601 instant the stamp was written */
  builtAt: string | null;
}

export interface BuildStatus extends BuildStamp {
  /** THIS process's start — not os.uptime(), which /api/health's `uptimeSec` already carries */
  startedAt: string;
  processUptimeSec: number;
  /** what dist/build.json says NOW; null when unreadable (then `stale` cannot be judged and is false) */
  onDisk: { commit: string | null; builtAt: string | null } | null;
  /** the on-disk stamp differs from the one this process loaded — a restart would run different code */
  stale: boolean;
  /**
   * The two sides in words — `describeBuildPair(running, onDisk)` — so every surface that says
   * "runs X, disk has Y" prints the SAME X and Y, and a rebuild at the same commit never reads
   * "runs 1a2b3c4, disk has 1a2b3c4". The dashboard strip prints these rather than
   * phrasing the pair a second time from `commit`/`builtAt`.
   */
  words: { running: string; onDisk: string };
}

// dist/core/build.js → dist/build.json; the package.json one level above dist/ is the version fallback
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..");
export const STAMP_PATH = join(DIST, "build.json");

/** dist/build.json as it is on disk right now, normalised to the three fields; null when unreadable. */
export function readBuildStamp(path = STAMP_PATH): BuildStamp | null {
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as Partial<Record<keyof BuildStamp, unknown>>;
    const s = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
    return { version: s(j.version), commit: s(j.commit), builtAt: s(j.builtAt) };
  } catch {
    return null;
  }
}

function packageVersion(): string | null {
  try {
    return (JSON.parse(readFileSync(join(DIST, "..", "package.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

// Read once: this is what the process IS running. A tree built by bare tsc (no stamp step) still
// knows its package version; commit/builtAt stay null rather than guessed.
const RUNNING: BuildStamp = readBuildStamp() ?? { version: packageVersion(), commit: null, builtAt: null };

/** The stamp this process loaded at start. */
export function runningBuild(): BuildStamp {
  return RUNNING;
}

/**
 * Pure: the running stamp against the on-disk one. Stale when EITHER commit or builtAt differs —
 * a rebuild at the same commit is still code this process is not running (uncommitted edits), and
 * a tarball install with no commit still compares builtAt. An unstamped start that later sees a
 * stamp appear is stale too (null !== "abc1234").
 */
export function buildStatus(running: BuildStamp, onDisk: BuildStamp | null, now = Date.now()): BuildStatus {
  const up = process.uptime();
  return {
    ...running,
    startedAt: new Date(now - up * 1000).toISOString(),
    processUptimeSec: Math.round(up),
    onDisk: onDisk ? { commit: onDisk.commit, builtAt: onDisk.builtAt } : null,
    stale: onDisk !== null && (onDisk.commit !== running.commit || onDisk.builtAt !== running.builtAt),
    words: describeBuildPair(running, onDisk),
  };
}

/** `0.1.0 (a1b2c3d, built 2026-09-12T02:40:00.000Z)` — what `--version` prints. */
export function formatBuild(b: BuildStamp): string {
  const v = b.version ?? "unknown";
  if (!b.commit && !b.builtAt) return `${v} (unstamped build)`;
  return `${v} (${b.commit ?? "no git commit"}, built ${b.builtAt ?? "unknown"})`;
}

/** Short human form of a stamp for alert text: the commit, else the build time, else "unknown". */
export function describeBuild(b: { commit: string | null; builtAt: string | null } | null): string {
  if (!b) return "unknown";
  return b.commit ?? (b.builtAt ? `built ${b.builtAt}` : "unknown");
}

/**
 * Both sides of a running-vs-on-disk comparison, worded so the two can never read the same.
 * Measured live 2026-09-24 02:24:06.800Z on a development host: `npm test` rebuilt dist/ at the
 * commit the dashboard daemon was running, `buildStatus()` rightly said stale (builtAt moved) and
 * the alarm — `describeBuild()` a side, which prints the commit whenever there is one — ledgered
 * "running 1a2b3c4, disk has 1a2b3c4 — restart to pick it up": a sentence that contradicts itself on
 * every surface a human reads, and the alarm's COMMON shape on a host where every test run rebuilds
 * at HEAD. When the commits are equal and the build times differ, each side names its time —
 * `1a2b3c4 built 2026-09-23T22:23:43.000Z` against `1a2b3c4 rebuilt 2026-09-24T02:23:41.000Z`; when
 * the commits differ, or a side has no commit, each side is `describeBuild()`'s own words, byte for
 * byte. The health rule, `doctor` and (through BuildStatus.words) the dashboard strip all print it.
 */
export function describeBuildPair(
  running: { commit: string | null; builtAt: string | null },
  onDisk: { commit: string | null; builtAt: string | null } | null,
): { running: string; onDisk: string } {
  if (onDisk !== null && running.commit !== null && onDisk.commit === running.commit && onDisk.builtAt !== running.builtAt) {
    const at = (t: string | null) => t ?? "at an unknown time";
    return { running: `${running.commit} built ${at(running.builtAt)}`, onDisk: `${onDisk.commit} rebuilt ${at(onDisk.builtAt)}` };
  }
  return { running: describeBuild(running), onDisk: describeBuild(onDisk) };
}
