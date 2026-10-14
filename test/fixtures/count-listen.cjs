/**
 * Counting preload for test/web-listen-error.test.js's finder cases. Loaded into the BUILT CLI through
 * NODE_OPTIONS=--require, it wraps net.Server.prototype.listen and appends to TA_COUNT_LISTEN_LOG one line per call —
 * `listen <port> <host> request-listeners=<n>` — and, when that call fails, `error <port> <host> code=<CODE>`; so a suite
 * can read back how many probes the CLI's finder (src/web/server.ts findFreePort) burned, on which ports, and what the
 * kernel said to each. Every call passes through untouched unless:
 *
 *   TA_COUNT_LISTEN_PLANT=<CODE>  a listen() with NO request listener — the finder's probe, an http server nothing
 *                                 handles; the dashboard's own listen() carries request listeners and passes through —
 *                                 emits that error on the next tick instead of binding, errno/syscall/address/port filled
 *                                 the way node fills them. For the hosts whose kernel will not plant EACCES on port 80:
 *                                 macOS grants any user the ports below 1024 since 10.14, root has them everywhere, and a
 *                                 container whose ip_unprivileged_port_start is 0 hands them out too. Logged as
 *                                 `error <port> <host> code=<CODE> planted`, so a plant that never bit reds the case.
 *
 * Promoted from the probe of the 237th GA fire (scratch/ga-fire-2026-09-30-06Z/count-listen.cjs), which measured the
 * defect those cases pin: `web --no-token --port 80` as uid 1000 → 20 listen() calls on 80..99, 20 EACCES, exit 1 after
 * 81 ms with `no free port in 80..99 on 127.0.0.1` and the code named nowhere. CommonJS on purpose: --require preloads
 * a CJS module ahead of an ESM main; built-in modules are singletons, so the `createServer` in dist/ sees this prototype.
 * The complement of test/fixtures/fail-listen.cjs, which plants on the DASHBOARD and passes the probes
 * through: that one exercises the --strict-port path, this one the finder's. Nothing here reaches the shipped tree:
 * test/fixtures/ is neither built nor globbed as a suite.
 */
"use strict";
const net = require("node:net");
const os = require("node:os");
const { appendFileSync } = require("node:fs");

const logPath = process.env.TA_COUNT_LISTEN_LOG;
const plant = process.env.TA_COUNT_LISTEN_PLANT || "";
const note = (line) => { if (logPath) appendFileSync(logPath, `${line}\n`); };
const errnoOf = (name) => -(os.constants.errno[name] ?? 0);

const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...args) {
  const port = args[0], host = args[1];
  const probe = this.listenerCount("request") === 0;
  note(`listen ${port} ${host} request-listeners=${this.listenerCount("request")}`);
  if (plant && probe) {
    note(`error ${port} ${host} code=${plant} planted`);
    const err = Object.assign(new Error(`listen ${plant}: planted by count-listen.cjs ${host}:${port}`), {
      code: plant, errno: errnoOf(plant), syscall: "listen", address: host, port,
    });
    process.nextTick(() => this.emit("error", err));
    return this;
  }
  this.once("error", (e) => note(`error ${port} ${host} code=${e && e.code}`));
  return realListen.apply(this, args);
};
