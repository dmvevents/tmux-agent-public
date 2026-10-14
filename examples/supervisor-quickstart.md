# Example: a supervisor agent driving tmux-agent over MCP

The end-to-end loop from the acceptance criteria: spawn a child, exchange messages, monitor,
get a completion notification — all through this tool.

## 1. Wire the MCP server into your supervisor

```jsonc
{
  "mcpServers": {
    "tmux-agent": {
      "command": "tmux-agent-mcp",
      "env": {
        "TMUX_AGENT_ACTOR": "supervisor",
        "TMUX_AGENT_SLACK_WEBHOOK": "https://hooks.slack.com/services/..."  // optional
      }
    }
  }
}
```

## 2. The supervisor's loop (tool calls)

```text
spawn-session { name:"worker-tests", cwd:"/repo", parent:"supervisor",
                task:"run and fix the test suite",
                command:"claude --permission-mode acceptEdits" }

send-input    { name:"worker-tests",
                text:"Run the test suite; fix failures; say DONE when green." }

session-status{ name:"worker-tests" }        → { state:"WORKING", contextPct:12, ... }
capture-pane  { name:"worker-tests", lines:40 }   # spot-check, redacted

# messaging: if the child is a Claude Code teammate, use native cross-session messaging.
# generic fallback that works for ANY child:
message-send  { from:"supervisor", to:"worker-tests", subject:"scope",
                body:"skip the flaky e2e suite" }
# child (or its wrapper) polls: message-receive { agent:"worker-tests" }

fleet-status  {}                              → writes ~/.tmux-agent/status.json for dashboards
waste-report  { since:"2026-08-18T00:00:00Z" }

kill-session  { name:"worker-tests" }         # refused unless supervisor owns it (audit-logged)
```

## 3. Or from a shell / cron (same verbs)

```bash
tmux-agent spawn worker-tests --cwd /repo --parent supervisor --cmd "claude"
tmux-agent send worker-tests "Run the test suite; say DONE when green."
tmux-agent watch worker-tests --idle-secs 120   # blocks; Slack/console notify on idle/stuck/dead
tmux-agent waste
```

## Notes

- Everything runs on the isolated `tmux-agent` socket; attach manually with
  `tmux -L tmux-agent attach -t worker-tests` to watch a child live.
- A policy file (`~/.tmux-agent/policy.json`) can restrict which sessions this supervisor may
  touch: `{ "allow": { "kill": ["worker-*"], "send": ["worker-*"] } }`.
- Every control action (and refusal) lands in `~/.tmux-agent/ledger/events-*.ndjson` — that
  file is also the log-consumer input.
