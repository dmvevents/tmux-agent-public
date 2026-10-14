# Security Policy

## Threat model

Read [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) first — it names the assets, the actors we do
and do not trust, all eleven findings (nine from the 2026-08 audit, one from the 2026-09 release probes, one from the 2026-10 review) as case studies, and the residual
risks we consciously accept (raw capture logs at rest; signature-based redaction is not DLP).

**Response commitment:** initial acknowledgement within 14 days of a report.

## Reporting

Please use GitHub private vulnerability reporting ("Report a vulnerability" under the Security
tab) on this repository. If that is unavailable, open an issue that says only "security — please
contact" without details, and a maintainer will reach out.

## Model

`tmux-agent` injects input into and reads output from terminal sessions — treat its control
surface like SSH:

- All tmux invocations are argv-only (`execFile`); user input is never interpolated into a shell.
- Sessions run on an isolated tmux socket by default; the operator's own server requires opt-in.
- Mutating actions (spawn/send/exec/kill) are policy-gated and audit-ledgered, including denials.
- Pane content is secret-redacted (`src/core/redact.ts`) before leaving the tool; raw capture
  logs are chmod 600 and stay on the local machine.
- Redaction rules are extensible at config time (`lexicon.json` `redact[]`) and additive only — a
  lexicon can strengthen redaction, never weaken it; see THREAT-MODEL residual risk 2.
- The MCP server hides mutating tools entirely in read-only mode.
- Mailbox agent names are path segments under the home and are judged by the session-name rule
  (`src/adapters/messaging/mailbox.ts#assertAgentName`) before any directory is created — exit 64 at
  the CLI, `isError` over MCP; message files are 0600 inside 0700 directories.

Hardening gaps we know about and welcome help on: finer-grained per-client MCP identity and rate
limits on send/exec.
