/**
 * Preload fixture for test/mailbox-atomic.test.js. Loaded into the BUILT CLI through NODE_OPTIONS=--require,
 * it wraps fs.writeFileSync and fs.renameSync — the two calls Mailbox.send() makes — and does two things:
 *
 *   TA_MAILBOX_LOG=<file>    every call whose path lies under a `mailbox/` directory appends one line, `writeFileSync <path>`
 *                            or `renameSync <from> -> <to>`, so the suite reads back WHICH path was written directly and which
 *                            appeared by rename — the atomicity claim measured, not inferred from the source. An empty log
 *                            under a send is a preload that never loaded, and the suite reds on it rather than passing.
 *   TA_MAILBOX_RACE=<agent>  on the FIRST writeFileSync into an inbox, the call is performed as the syscalls it stands for —
 *                            open(O_CREAT|O_TRUNC), then write(), then close() — and BETWEEN the open and the write this same
 *                            CLI is run again, `msg recv <agent>`, on the same home. That is the interleaving the race allows,
 *                            forced: on 0cd6bb1 the reader saw an empty `.json`, skipped it as malformed and archived it, and
 *                            the sender's write then landed in archive/ through its still-open descriptor — never delivered;
 *                            on the fix the reader sees only a dot-tmp it does not read. The reader keeps this preload
 *                            (NODE_OPTIONS is inherited, TA_MAILBOX_RACE is removed) so its renames are logged too and it
 *                            cannot recurse; its verdict is logged as `race: msg recv <agent> … -> exit N stdout … stderr …`.
 *
 * CommonJS on purpose: --require preloads a CJS module ahead of an ESM main, and module.syncBuiltinESMExports() carries the
 * patched functions into the `import { writeFileSync } from "node:fs"` bindings dist/ uses (measured to reach them on node 22
 * with and without the call, scratch/ga-fire-2026-09-30-16Z/probe-sync/; the call is kept for the other lanes). Nothing here
 * reaches the shipped tree: test/fixtures/ is neither built nor globbed as a suite (siblings: fail-listen.cjs, count-listen.cjs).
 */
"use strict";
const fs = require("node:fs");
const { basename, dirname } = require("node:path");
const { spawnSync } = require("node:child_process");

const logPath = process.env.TA_MAILBOX_LOG;
const raceAgent = process.env.TA_MAILBOX_RACE || "";
const note = (line) => { if (logPath) fs.appendFileSync(logPath, `${line}\n`); };
// <home>/mailbox/<agent>/inbox/<file> — judged by the directory names above the file, never by a substring of the home path
const inInbox = (p) => basename(dirname(String(p))) === "inbox" && basename(dirname(dirname(dirname(String(p))))) === "mailbox";
const underMailbox = (p) => String(p).split("/").includes("mailbox");

const realWrite = fs.writeFileSync;
const realRename = fs.renameSync;
let raced = false;

fs.writeFileSync = function writeFileSync(path, data, options) {
  if (underMailbox(path)) note(`writeFileSync ${path}`);
  if (!raceAgent || raced || !inInbox(path)) return realWrite.call(fs, path, data, options);
  raced = true;
  // the three syscalls writeFileSync stands for, with the reader run between the first two
  const mode = options && typeof options === "object" && options.mode !== undefined ? options.mode : 0o666;
  const fd = fs.openSync(path, "w", mode);
  try {
    const at = process.argv.indexOf("--socket");
    const args = [process.argv[1], ...(at > 0 ? process.argv.slice(at, at + 2) : []), "msg", "recv", raceAgent];
    const env = { ...process.env };
    delete env.TA_MAILBOX_RACE;
    const r = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL" });
    note(`race: msg recv ${raceAgent} between open and write -> exit ${r.status ?? `signal ${r.signal}`} stdout ${JSON.stringify(String(r.stdout ?? ""))} stderr ${JSON.stringify(String(r.stderr ?? ""))}`);
    fs.writeSync(fd, typeof data === "string" ? data : Buffer.from(data));
  } finally {
    fs.closeSync(fd);
  }
};

fs.renameSync = function renameSync(from, to) {
  if (underMailbox(from) || underMailbox(to)) note(`renameSync ${from} -> ${to}`);
  return realRename.call(fs, from, to);
};

require("node:module").syncBuiltinESMExports();
