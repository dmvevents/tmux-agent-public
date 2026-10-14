/**
 * The OS reason a config file could not be read, in words with its code — what an operator acts on, not Node's
 * `EISDIR: illegal operation on a directory, read`. One vocabulary for the two operator-written files the tool refuses
 * to run without: the lexicon loader's and the policy loader's. Its own module rather than an
 * export of lexicon.ts because test/versioning-contract.test.js holds "the modules that import lexicon.js and read a
 * holder named cfg/r/…" to exactly three — a policy.js that imported lexicon.js for this helper read as a fourth lexicon
 * reader (measured on the policy-loader branch: item 5b's reader list grew to four).
 */
import { lstatSync, readlinkSync } from "node:fs";

export function readFailure(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  const words: Record<string, string> = {
    ENOENT: "no such file or directory",
    EISDIR: "is a directory, not a file",
    EACCES: "permission denied for this user",
    EPERM: "permission denied for this user",
    ENOTDIR: "a component of the path is not a directory",
  };
  if (code && words[code]) return `${words[code]} (${code})`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * What an ENOENT can hide: a directory entry that EXISTS — a symbolic link whose target is missing (a dotfiles or /etc
 * checkout that has moved, a mount not yet there). Both loaders keep one silent case, ENOENT at their default path, and
 * until this fix (measured 2026-10-13 on an earlier build) read a
 * dangling link there as the absent file: a dangling policy.json was the permissive default on every surface, a dangling
 * lexicon.json the shipped vocabulary with the operator's redact rules silently not applied. The words for that link —
 * its target as the link names it — when `p` is one; null when there is no entry at `p` (or it is not a link), so a caller
 * refuses on a string and keeps its one silent case for null. Nothing is created or followed: lstat and readlink only.
 */
export function danglingLink(p: string): string | null {
  try {
    if (!lstatSync(p).isSymbolicLink()) return null;
    return `a symbolic link to ${JSON.stringify(readlinkSync(p))}, which does not exist (ENOENT)`;
  } catch {
    return null;
  }
}
