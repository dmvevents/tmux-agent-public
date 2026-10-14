/**
 * A pane with syntax highlighting defeats the pair-shaped redaction rules on the capture-log read path (TMUX-111;
 * gates G2 the served surfaces — the dashboard's log tail, src/web/server.ts; MCP read-log, src/mcp/server.ts — trust
 * redact() to take the value out of the raw pipe-pane bytes; G1 no test planted a highlighted line — `grep -rn
 * 'x1b\|u001b' test/*.test.js` → 0 on any redaction case).
 *
 * Measured 2026-09-15 20:23Z on the clean tree 5700f1d (scratch/ga-fire-2026-09-15-20Z/npm-test-pre.log): test/smoke.sh
 * step 5 red — `SMOKE FAIL: redaction (rc=3 — … 3 api-key pair survived on the read path)` — on every run since the
 * host's shells started drawing a typed line token by token (ble.sh). The sixty-fourth fire reproduced it 3/3 with
 * redact() alone (scratch/ga-fire-2026-09-15-18Z/s5probe): the raw capture holds `PLANE_API_KEY\x1b[0;38;5;33m=\x1b[0m
 * SMK2…` — SGR colour codes between the name, the separator and the value — and every pair-shaped rule requires the
 * separator to follow the name directly, so none of them sees the pair and the value is served verbatim. The
 * one-token shapes (AKIA, ghp_, sk-, a JWT) are drawn as one token and still redact; the ledger takes the typed text,
 * not pane bytes, and is unaffected. CI's shells load no highlighter, so its smoke stayed green: the gate could not
 * see this.
 *
 * The contract, each line a check that FAILS if the property is removed (RED on the 5700f1d dist: the value survives):
 *   (a) the ble.sh line as captured → the value gone, `[REDACTED]` in its place, the name kept;
 *   (b) the same for each pair-shaped rule — api[-_]?key, password|passwd|token|secret, aws_secret_access_key, the
 *       authorization envelope — with the codes in every placement a highlighter or colouring pager produces: between
 *       name and separator, between separator and value, the value in its own colour closed by a reset, the quotes
 *       coloured apart from what they quote, the scheme coloured apart from the token, ble.sh's reset + shift-in
 *       (\x1b[m\x0f) alone, and the non-SGR CSI a redraw leaves (cursor hide/show, erase-to-end). Only ble.sh was
 *       on the host to capture from; the other placements are planted, not captured;
 *   (c) the controls: every plain form redacts EXACTLY as before (the TMUX-95 outputs, byte for byte) — the rules
 *       become tolerant of what sits between the parts, never wider in what they treat as a name — `api_key_file=`
 *       is still left alone, highlighted or not, and a highlighted line with no secret comes back byte-identical.
 *
 * Run: node --test test/redact-highlighted.test.js   (needs `npm run build` first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../dist/core/redact.js";
import { APIKEY_VALUE as APIKEY, BLE_CAPTURED_LINE } from "./helpers/highlighted-capture.js";

// Synthetic values, one per rule: the unit suite's own password, a base64-looking token, AWS's documented example
// secret, and the TMUX-95 envelope credential. None is real.
const PASSWORD = "hunter2hunter2";
const TOKEN = "dG9rZW4tc3ludGhldGljLTEyMw";
const AWS_SECRET = "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY";
const BEARER = "Zm9vYmFyYmF6cXV1eHNlY3JldDEyMzQ1Ng";

/** Control characters made visible in a failure message, so a red run shows the shape and not a colour. */
const show = (s) => JSON.stringify(s).replace(/\\u001b/g, "\\x1b");

/** [line, the value that must be gone, the name that must survive] */
const HIGHLIGHTED = [
  // (a) ble.sh, as captured: codes between the name and `=`, and between `=` and the value
  [BLE_CAPTURED_LINE, APIKEY, "PLANE_API_KEY"],
  // (b) the same placement on each other pair-shaped rule
  [`\x1b[0;38;5;34mpassword\x1b[0;38;5;33m=\x1b[0m${PASSWORD} \x1b[0;91mtrue\x1b[m\x0f`, PASSWORD, "password"],
  [`\x1b[0;38;5;34mTOKEN\x1b[0;38;5;33m=\x1b[0m${TOKEN}\x1b[m\x0f`, TOKEN, "TOKEN"],
  [`\x1b[0;38;5;34maws_secret_access_key\x1b[0;38;5;33m=\x1b[0m${AWS_SECRET}\x1b[m\x0f`, AWS_SECRET, "aws_secret_access_key"],
  // the value in its own colour, closed by a reset; the quotes coloured apart from what they quote
  [`export PLANE_API_KEY\x1b[0m=\x1b[33m"\x1b[0m${APIKEY}\x1b[33m"\x1b[0m`, APIKEY, "PLANE_API_KEY"],
  [`password\x1b[0m: \x1b[33m${PASSWORD}\x1b[0m`, PASSWORD, "password"],
  // the header form: blanks and codes around the colon; the scheme coloured apart from the token
  [`curl -H \x1b[33m'\x1b[0mX-Api-Key\x1b[1m:\x1b[0m \x1b[33m${APIKEY}'\x1b[0m http://127.0.0.1:7337/api/health`, APIKEY, "X-Api-Key"],
  [`Authorization\x1b[1m:\x1b[0m \x1b[1;32mBearer\x1b[0m \x1b[33m${BEARER}\x1b[0m`, BEARER, "Bearer"],
  [`\x1b[1mAuthorization: \x1b[0mBearer\x1b[0m\x1b[33m ${BEARER}`, BEARER, "Authorization"],
  // ble.sh's reset + shift-in as the only thing between the parts
  [`SECRET\x1b[m\x0f=\x1b[m\x0f${TOKEN}`, TOKEN, "SECRET"],
  [`aws_secret_access_key\x1b[m\x0f = \x1b[m\x0f${AWS_SECRET}`, AWS_SECRET, "aws_secret_access_key"],
  // non-SGR CSI a redraw leaves inside the pair: cursor hide/show, erase-to-end
  [`api_key\x1b[?25l=\x1b[?25h${APIKEY}\x1b[K`, APIKEY, "api_key"],
];

/** [plain line, the exact output the TMUX-95 suite already pins] — tolerance must not move a single byte here */
const PLAIN = [
  [`PLANE_API_KEY=${APIKEY}`, "PLANE_API_KEY=[REDACTED]"],
  [`X-Api-Key: ${APIKEY}`, "X-Api-Key: [REDACTED]"],
  [`export PLANE_API_KEY="${APIKEY}"`, `export PLANE_API_KEY="[REDACTED]"`],
  [`password: ${PASSWORD}`, "password: [REDACTED]"],
  [`aws_secret_access_key = ${AWS_SECRET}`, "aws_secret_access_key=[REDACTED]"],
  [`Authorization: Bearer ${BEARER}`, "Authorization: Bearer [REDACTED]"],
  [`curl -H 'Authorization: Bearer ${BEARER}' http://127.0.0.1:7337/api/health`, "curl -H 'Authorization: Bearer [REDACTED]' http://127.0.0.1:7337/api/health"],
  [`Authorization: ${BEARER}`, "Authorization: [REDACTED]"],
];

/** lines that carry no credential and must come back byte-identical, codes and all */
const UNTOUCHED = [
  "api_key_file=/etc/plane/key",
  "api_key_file\x1b[0;38;5;33m=\x1b[0m/etc/plane/key",
  "\x1b[0;38;5;34mecho\x1b[0m \x1b[0;91mhello-from-supervisor\x1b[m\x0f\x1b[K",
  "\x1b[0;1;32mubuntu@host\x1b[m\x0f:\x1b[0;1;34m/tmp\x1b[m\x0f$ \x1b[?25h\x1b[?25l\x1b[0;38;5;34mnpm\x1b[0m test",
  "the bearer of this message needs an api key from the dashboard",
];

test("redact: the ble.sh line as captured — the highlighted api-key pair's value is gone, the name kept", () => {
  const out = redact(BLE_CAPTURED_LINE);
  assert.ok(!out.includes(APIKEY), `the value survived the read path: ${show(out)}`);
  assert.match(out, /PLANE_API_KEY.*\[REDACTED\]/s, `no [REDACTED] after the name: ${show(out)}`);
  // the codes are tolerated, not removed: what is not the value is still there for a renderer
  assert.ok(out.includes("\x1b[0;91mtrue"), `text after the pair was lost: ${show(out)}`);
});

test("redact: every pair-shaped rule tolerates a highlighter's codes between name, separator and value", () => {
  assert.ok(HIGHLIGHTED.length >= 12, "the placement set is the contract — an empty or shrunken list is a hard failure");
  const red = [];
  for (const [line, value, name] of HIGHLIGHTED) {
    const out = redact(line);
    if (out.includes(value)) red.push(`value survived: ${show(line)} -> ${show(out)}`);
    else if (!out.includes("[REDACTED]")) red.push(`no [REDACTED]: ${show(line)} -> ${show(out)}`);
    else if (!out.includes(name)) red.push(`name ${name} dropped: ${show(line)} -> ${show(out)}`);
  }
  assert.deepEqual(red, [], `${red.length} of ${HIGHLIGHTED.length} highlighted placements leak or over-scrub:\n  ${red.join("\n  ")}`);
});

test("redact: the plain forms are byte-identical to the TMUX-95 outputs — tolerant between the parts, not wider", () => {
  assert.ok(PLAIN.length >= 8, "the plain set is the contract — an empty list is a hard failure");
  for (const [line, want] of PLAIN) assert.equal(redact(line), want, `plain form moved: ${show(line)}`);
});

test("redact: no credential, no change — api_key_file= and highlighted prose come back byte-identical", () => {
  assert.ok(UNTOUCHED.length >= 5, "the negative set is the contract — an empty list is a hard failure");
  for (const line of UNTOUCHED) assert.equal(redact(line), line, `over-redaction: ${show(line)}`);
});
