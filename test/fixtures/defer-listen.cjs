/**
 * Preload fixture for test/web-banner-listening.test.js. Loaded into the BUILT CLI through
 * NODE_OPTIONS=--require, it wraps net.Server.prototype.listen — the one method every listener in the
 * child goes through, the finder's probes and the dashboard alike — so the suite can plant, on demand,
 * the two shapes the card is about:
 *
 *   TA_DEFER_LISTEN_MS=<ms>  the real listen() runs <ms> later (default 300); `listening` still fires, just
 *                            late. A CLI that prints its banner in the tick startWeb() returns now precedes
 *                            readiness by the whole deferral, so ONE fetch on the banner line is refused every
 *                            time — the deterministic form of the 85 ms race the card measured on 2026-09-29
 *                            (test/built-web-port.test.js's control, `fetch failed`).
 *   TA_LISTEN_PORT_ZERO=1    the port asked for is replaced by 0 — the OS picks — so a banner that names the
 *                            REQUESTED port names one nothing of the daemon's is bound to, and one that reads
 *                            server.address() names the socket's own.
 *   TA_DEFER_LISTEN_LOG=<f>  every intercepted call appends `listen requested=<p> deferMs=<ms> asked=<p'>`, and
 *                            `bound=<q>` once that socket says `listening` (this listener is PREPENDED, so it
 *                            reads the address before a probe's own listener closes the socket). The suite reads
 *                            the log back: a fixture that never bit reds the case instead of passing it vacuously
 *                            (BANLIST — an unplanted control is not a control).
 *
 * CommonJS on purpose: --require preloads a CJS module ahead of an ESM main. Built-in modules are singletons,
 * so the `import { createServer } from "node:net"` in dist/ sees this prototype. Nothing here reaches the
 * shipped tree: test/fixtures/ is neither built nor globbed as a suite.
 */
"use strict";
const net = require("node:net");
const { appendFileSync } = require("node:fs");

const deferMs = Number(process.env.TA_DEFER_LISTEN_MS ?? 300);
const portZero = process.env.TA_LISTEN_PORT_ZERO === "1";
const logPath = process.env.TA_DEFER_LISTEN_LOG;
const note = (line) => { if (logPath) appendFileSync(logPath, `${line}\n`); };

const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...args) {
  const requested = args[0];
  if (portZero && typeof requested === "number") args[0] = 0;
  note(`listen requested=${requested} deferMs=${deferMs} asked=${args[0]}`);
  this.prependOnceListener("listening", () => {
    const a = this.address();
    note(`bound=${a && typeof a === "object" ? a.port : "?"}`);
  });
  setTimeout(() => realListen.apply(this, args), deferMs);
  return this;
};
