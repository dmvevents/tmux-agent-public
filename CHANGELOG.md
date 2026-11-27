# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver as defined by
[VERSIONING.md](VERSIONING.md). The changelog gate (`test/changelog-current.sh`) fails a commit that changes what a user
installs without an entry here, unless its subject says `[no-changelog]`.

## [Unreleased]

## [0.1.1] - 2026-11-27

### Security

- **zod 4 and `@modelcontextprotocol/sdk` 1.32.2 clear the runtime advisories (#5).** On 2026-11-27,
  `npm audit --omit=dev` reports 7 vulnerable packages on 0.1.0 and 0 on 0.1.1. The 2 high: zod can exhaust memory
  validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5), and body-parser is open to a DoS via trailing
  bytes after a compressed request body (GHSA-27r3-jxmh-p828). The 5 moderate: hono, @hono/node-server, fast-uri,
  ip-address, qs. The declared ranges move from `zod ^3.24.0` to `^4.6.7` and from `@modelcontextprotocol/sdk ^1.12.0`
  to `^1.32.2`; the lockfile moves zod 3.25.76 → 4.6.7, the SDK 1.32.1 → 1.32.2, body-parser 2.3.0 → 2.4.0, hono
  4.13.7 → 4.13.18, @hono/node-server 2.1.1 → 2.1.7, fast-uri 3.1.8 → 3.1.9, ip-address 10.7.2 → 10.7.6 and qs
  6.16.0 → 6.17.1, and nothing else. SDK 1.32.2 declares `zod: "^3.25 || ^4.0"`. `zodToJsonSchema` in
  `src/mcp/server.ts` follows the zod 4 API (`AnyZodObject` is gone; `ZodDefault` holds its default as a value, not a
  thunk). The MCP `tools/list` reply is byte-identical before and after the change (5963 bytes, measured in #5).
  Reported by a downstream project's security scan of its vendored copy.

### Fixed

- README: the install note names the command its install block runs, `npm install -g .`; it said `npm link` (#4).
- Tests: a new boundary test asserts that a ledgered uncaught-exception stack is the header plus exactly its first
  3 frames; the existing test's long messages reach the 600-character cap before the 4-line cap acts, so it bounded
  the stack only from above (#4). The ledger fixture in `test/meta-decay-note.test.js` is dated relative to today, so
  the 30-day retention sweep no longer archives it and turns the test red on an unchanged tree (#5).

### Changed

- CI: `actions/checkout` v4 → v7 (#3), `actions/setup-node` v4 → v7 (#2) and `actions/cache` v4 → v6 (#1).
- AGENTS.md drops a rate-limit note for the maintainers' project board, which nothing in this repository calls (#4).

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
