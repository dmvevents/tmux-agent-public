# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver as defined by
[VERSIONING.md](VERSIONING.md). The changelog gate (`test/changelog-current.sh`) fails a commit that changes what a user
installs without an entry here, unless its subject says `[no-changelog]`.

## [Unreleased]

### Security

- **zod 3 → 4 and `@modelcontextprotocol/sdk` 1.12 → 1.32 clear the runtime advisories.** `npm audit --omit=dev` read 7
  on `e88b415` (2 high: zod can exhaust memory validating oversized constrained collections; body-parser DoS on
  trailing bytes after a compressed body. Plus 5 moderate: hono, @hono/node-server, fast-uri, ip-address, qs) and 0 on
  this change. SDK 1.32.2 declares `zod: "^3.25 || ^4.0"`. `zodToJsonSchema` in `src/mcp/server.ts` follows the zod 4
  API (`AnyZodObject` is gone; `ZodDefault` holds its default as a value, not a thunk). The MCP `tools/list` reply is
  byte-identical to `e88b415`'s (5963 bytes). Reported by aws-do-agent's security scan of its vendored copy.

## [0.1.0] - 2026-10-14

### Added

- First public release of tmux-agent: the `tmux-agent` CLI (spawn, send, exec, status, watch, kill, lineage, msg,
  waste, log, web, doctor, calibrate, help), the `tmux-agent-mcp` MCP server with the same verbs as tools, and the
  loopback-only web dashboard (fleet tree with the provenance of every row's state, workstream history, waste
  ranking, per-session drill-in, a verified send box).
- Sessions carry their lineage as tmux options; input is pasted and verified before Enter is sent; every pane read
  passes through redaction; the ledger is append-only NDJSON with retention and archiving; policy files make any
  surface read-only or add per-action allow and deny lists, and an unusable policy or lexicon file is refused with
  exit 78 rather than treated as absent.
- Agent CLI profiles for Claude Code and Codex (verified against captured pane text), a best-effort aider profile and
  a generic-shell fallback; a lexicon file (`$TMUX_AGENT_HOME/lexicon.json`) and the `calibrate` verb to fit the
  vocabulary to another fleet without a fork.
- Health watch with thresholds, a re-warn hold-down, Slack or stderr notification, and `doctor` to compare the
  running dashboard with the build on disk.
- The suite described in [docs/TESTING.md](docs/TESTING.md): unit suites, three smokes on an isolated tmux socket, a
  changelog gate, a pre-push gate and two browser layers, run by CI on Ubuntu and macOS.
