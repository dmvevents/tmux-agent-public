# Testing

The suite runs on an isolated tmux socket and a throwaway `TMUX_AGENT_HOME`; your own tmux sessions and
`~/.tmux-agent` are never touched. Every layer is wired into `npm test` or CI; this page says what each one
catches and how to run it alone. Counts and coverage figures are deliberately not written here: they change
with every commit, and a literal on a page goes stale without anyone noticing. Run the commands instead.

| Layer | Command | Only it can catch |
|---|---|---|
| Unit suites (`test/*.test.js`, `node --test`) | `npm run test:unit` | pure logic, error paths, the attack-class guard suite, the contract tests that read README.md, VERSIONING.md, CONTRIBUTING.md, SECURITY.md and docs/THREAT-MODEL.md as data |
| End-to-end smoke (`test/smoke.sh`) | `npm run smoke` runs it with the two below | the real tmux verbs against a live server: spawn, verified send, exec, capture, message, notify, status.json, waste, policy, audited kill |
| Web/security smoke (`test/smoke-web.sh`) | part of `npm run smoke` | CSRF, DNS rebinding, the token, file modes, the dashboard's listen and stop behaviour |
| README first-run smoke (`test/smoke-readme.sh`) | part of `npm run smoke` | the Install and demo blocks of README.md run verbatim from a fresh HOME and npm prefix |
| Changelog gate (`test/changelog-current.sh`) | `npm run test:changelog` | a commit that changes what a user installs without a CHANGELOG entry (or a `[no-changelog]` subject) |
| Lint and typecheck | `npm run lint` | the design rules of CONTRIBUTING.md that two custom eslint rules enforce, and type errors tsc alone would report |
| Browser acceptance (`test/ui-acceptance.py`) | `npm run test:ui` (needs `pip install playwright && python3 -m playwright install chromium`) | a JS throw, an unbound handler, a 401 where a UI belonged |
| Browser audit (`test/browser-audit/audit.py`) | `npm run test:browser-audit` | composited contrast, out-of-order renders, poll-versus-typing races |
| Coverage | `npm run test:coverage` | per-file line, branch and function coverage of the unit suites |
| Pre-push gate (`scripts/pre-push`) | installed by `test/smoke.sh`; `test/prepush.test.js` proves it | a commit that builds only with files still in the working tree |

`npm test` is build, unit, changelog gate and the three smokes, in that order. CI runs the same on Ubuntu and macOS
across the Node majors VERSIONING.md names, builds tmux 3.2a and 3.4 from source for the smoke, and runs the two
browser layers on Ubuntu with Node 22.

Every `src/web/*` change needs the two browser layers: the Node suites string-match HTML source, and that has passed
while real rendering failed.

## Fixtures

`test/fixtures/state-corpus.json` is the labelled corpus `test/state-accuracy.test.js` grades the built-in profiles
against. Its pane tails are the CLIs' own output (prompts, spinners, permission dialogs); the session names, sources
and ids around them are synthetic. `test/fixtures/live-tails-2026-10-13.json` holds the status-line shapes
`test/profiles.test.js` drives the context-figure reader with. Add a fixture whenever a misclassification is found:
the corpus grows per incident, and a safety-critical class (BLOCKED, ERROR) can never be allow-listed away.
