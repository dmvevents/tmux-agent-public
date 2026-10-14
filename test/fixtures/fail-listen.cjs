/**
 * Preload fixture for test/web-listen-error.test.js. Loaded into the BUILT CLI through
 * NODE_OPTIONS=--require, it wraps net.Server.prototype.listen and plants, on the DASHBOARD server only — the
 * http.Server that carries request listeners; the finder's probes (src/web/server.ts findFreePort: http servers
 * with NO request listener) pass through untouched, so the CLI's port scan behaves as on any host — one of two
 * shapes:
 *
 *   the default: listen() emits an `error` on the next tick instead of binding, the shape libuv reports for a
 *                privileged port (EACCES) or a host not on this machine (EADDRNOTAVAIL) — a bind that never happened;
 *   TA_FAIL_ACCEPT_AFTER_MS=<ms>  the RUNNING daemon's shape: listen() binds normally and, <ms> after `listening`, the
 *                server emits an `error` with syscall `accept` — what libuv reports under file-descriptor pressure
 *                (EMFILE/ENFILE) on a socket that is already serving. The product must treat the two differently.
 *
 *   TA_FAIL_LISTEN_CODE=<CODE>  the errno name planted in either shape (default EACCES); errno/syscall/address/port
 *                               are filled the way node fills them, so the product's handler sees a real-looking error.
 *   TA_FAIL_LISTEN_LOG=<file>   every intercepted call appends one line — `passed through` for a probe, `planted <CODE>`
 *                               for the dashboard, `accept <CODE> emitted` when the running-daemon plant fires — so the
 *                               suite can read back that the fixture bit: a fixture that never bit reds the case
 *                               instead of passing it vacuously (BANLIST — an unplanted control is not a control).
 *
 * First written as the probe of the 235th GA fire (scratch/ga-fire-2026-09-30-02Z/fail-listen.cjs), which measured
 * the defect the suite pins: exit 0, no banner, one `[web] uncaughtException:` line. CommonJS on purpose: --require
 * preloads a CJS module ahead of an ESM main. Built-in modules are singletons, so the `createServer` in dist/ sees
 * this prototype. Nothing here reaches the shipped tree: test/fixtures/ is neither built nor globbed as a suite (its
 * sibling is test/fixtures/defer-listen.cjs, TMUX-178).
 */
"use strict";
const net = require("node:net");
const os = require("node:os");
const { appendFileSync } = require("node:fs");

const code = process.env.TA_FAIL_LISTEN_CODE || "EACCES";
const acceptAfterMs = Number(process.env.TA_FAIL_ACCEPT_AFTER_MS ?? 0);
const logPath = process.env.TA_FAIL_LISTEN_LOG;
const note = (line) => { if (logPath) appendFileSync(logPath, `${line}\n`); };
const errnoOf = (name) => -(os.constants.errno[name] ?? 0);

const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...args) {
  if (this.listenerCount("request") === 0) {
    note(`listen requested=${args[0]} (no request listener: the finder's probe) -> passed through`);
    return realListen.apply(this, args);
  }
  const port = args[0], host = args[1];
  if (acceptAfterMs > 0) {
    note(`listen requested=${port} host=${host} (http.Server: the dashboard) -> passed through; accept ${code} planted ${acceptAfterMs} ms after listening`);
    this.once("listening", () => setTimeout(() => {
      note(`accept ${code} emitted on the listening dashboard`);
      this.emit("error", Object.assign(new Error(`accept ${code}: planted by fail-listen.cjs`), { code, errno: errnoOf(code), syscall: "accept" }));
    }, acceptAfterMs));
    return realListen.apply(this, args);
  }
  note(`listen requested=${port} host=${host} (http.Server: the dashboard) -> planted ${code}`);
  const err = Object.assign(new Error(`listen ${code}: planted by fail-listen.cjs ${host}:${port}`), {
    code, errno: errnoOf(code), syscall: "listen", address: host, port,
  });
  process.nextTick(() => this.emit("error", err));
  return this;
};
