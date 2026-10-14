/**
 * Shared harness for the doc-contract tests — test/versioning-contract.test.js and
 * test/readme-contract.test.js. Both compare a document against the BUILT artefacts a
 * user installs, never against a hand-typed list, so they share the one way of asking the built
 * MCP server what it serves and the one way of reporting a set mismatch by name.
 *
 * Lives outside test/*.test.js on purpose: `npm run test:unit` globs that pattern one level deep,
 * so a file here is imported by suites, never run as a suite of its own (importing a *.test.js
 * from another would register its tests twice).
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** initialize + tools/list over stdio, the way any MCP client does it; resolves to tool names. */
export async function toolsList(env) {
  return (await toolsFull(env)).map((t) => t.name);
}

/**
 * The same tools/list, resolved to the tool objects the server advertised — name, description and inputSchema —
 * for a suite that asserts on a schema's PROPERTIES rather than its name (test/profile-flag.test.js, TMUX-159: an
 * argument a schema does not declare is stripped by zod before the tool sees it, so the advertised schema is the
 * one place a client can learn the key exists). toolsList() above is this list's names.
 */
export function toolsFull(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(ROOT, "dist/mcp/server.js")], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("MCP server timed out")); }, 25_000);
    let out = "", names = null;
    p.stdout.on("data", (chunk) => {
      out += chunk;
      for (const line of out.split("\n")) {
        try {
          const m = JSON.parse(line);
          if (m.id === 1 && m.result?.tools) {
            names = m.result.tools;
            setTimeout(() => p.stdin.end(), 80); // closing stdin is the server's shutdown signal
          }
        } catch { /* partial line or notification */ }
      }
    });
    p.on("close", () => { clearTimeout(timer); names ? resolve(names) : reject(new Error(`no tools/list reply; stdout was: ${out.slice(0, 400)}`)); });
    p.on("error", reject);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "doc-contract", version: "0" } } }) + "\n");
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n");
  });
}

/**
 * initialize + ONE tools/call over stdio, resolved to the raw `result` the server sent — its content blocks
 * and isError untouched, never re-shaped, because the BYTES of content[0] and the presence of a second block
 * are themselves what test/lineage-tmux-down.test.js asserts. One call per process: the state under
 * test is the tmux server's, and a fresh server per call cannot carry state between them.
 */
export function callTool(name, args, env, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(ROOT, "dist/mcp/server.js")], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`MCP ${name} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    let out = "", result = null, stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.stdout.on("data", (chunk) => {
      out += chunk;
      for (const line of out.split("\n")) {
        try {
          const m = JSON.parse(line);
          if (m.id === 1) {
            result = m.result ?? m;
            setTimeout(() => p.stdin.end(), 80); // closing stdin is the server's shutdown signal
          }
        } catch { /* partial line or notification */ }
      }
    });
    p.on("close", () => { clearTimeout(timer); result ? resolve(result) : reject(new Error(`no reply to ${name}; stdout ${out.slice(0, 300)} / stderr ${stderr.slice(0, 300)}`)); });
    p.on("error", reject);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mcp-contract", version: "0" } } }) + "\n");
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args ?? {} } }) + "\n");
  });
}

/** Named, sorted set difference so a failure names the offenders, not just "sets differ". */
export function assertSameSet(declared, live, { declaredAs, liveAs }) {
  const d = new Set(declared), l = new Set(live);
  const undeclared = [...l].filter((x) => !d.has(x)).sort();
  const phantom = [...d].filter((x) => !l.has(x)).sort();
  const problems = [];
  if (undeclared.length) problems.push(`present in ${liveAs} but NOT declared in ${declaredAs}: ${undeclared.join(", ")}`);
  if (phantom.length) problems.push(`declared in ${declaredAs} but ABSENT from ${liveAs}: ${phantom.join(", ")}`);
  assert.equal(problems.length, 0, problems.join("\n"));
}
