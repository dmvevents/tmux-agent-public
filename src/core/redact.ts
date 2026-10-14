/**
 * Redaction at the READ boundary. Everything this tool *returns or serves* — pane captures, log
 * tails, timelines, dashboard payloads, MCP results, calibration reports — passes through here
 * first.
 *
 * IT IS NOT redaction-at-write, and the distinction is load-bearing: `pipe-pane` streams raw bytes
 * straight to `logs/<session>.log`, so unredacted secrets CAN reach disk there. That is a
 * documented accepted residual risk (THREAT-MODEL residual 1: logs are 0600 in a 0700 home and
 * never leave the host; if plaintext at rest is unacceptable, do not enable capture) — not an
 * oversight. An earlier version of this header claimed "logs pass through here BEFORE hitting
 * disk", which was simply false and was caught by an external reviewer reading our own docs
 * against each other. A safety claim that overstates its own scope is worse than no claim: it
 * tells an operator not to worry about a file they should be deciding about.
 *
 * The built-in patterns cover the providers WE use. That was a silent hole for anyone else:
 * an adopter on a cloud we do not use got no redaction of their credentials and no signal that
 * anything was missing — the failure writes plaintext secrets to disk. Extra shapes now come
 * from `lexicon.json` (see core/lexicon.ts, docs/AGNOSTIC-DESIGN.md).
 *
 * ADDITIVE BY CONSTRUCTION: user rules run AFTER the built-ins and there is deliberately no way
 * to disable a built-in from config. A lexicon can only make redaction stronger. The worst bug
 * this file could ship is one where a config typo lets a credential through, so that path does
 * not exist.
 *
 * The bytes on the read path are what the PANE DREW, not what was typed: a syntax-highlighting
 * shell puts colour codes between the parts of a `KEY=value` pair, and a rule that wants the
 * separator right after the name sees nothing (the note above PATTERNS).
 */
import { LexiconConfig, compileRedactRules } from "./lexicon.js";

// What a syntax-highlighting shell leaves between the parts of a pair. ble.sh, zsh-syntax-highlighting and
// fish draw a typed line token by token, so the raw pipe-pane capture — the bytes MCP `read-log` and the dashboard's
// log tail serve — holds `PLANE_API_KEY\x1b[0;38;5;33m=\x1b[0mSMK2…`: SGR colour codes between the name, the
// separator and the value. The pair-shaped rules below wanted `KEY=value` and saw nothing; the value reached the
// caller verbatim (measured 2026-09-15 on the dev host, where the smoke's own step 5 went red on every dist while
// CI's plain shells stayed green). CTRL is one control sequence as a terminal draws it — a CSI sequence (ESC [
// parameters intermediates final: SGR colours, cursor hide/show, erase-to-end) or a shift-in/out byte, which ble.sh
// emits after every reset — and each pair rule admits any run of them, beside its own blanks, wherever a highlighter
// can split: after the name, around the separator, around a quote, after an Authorization scheme. Tolerated, not
// removed: the kept name and separator ($1, $2) still carry their codes, so a renderer shows the same colours with
// the value gone. The value class is unchanged ([^\s"'], to the next blank), so a code run inside or after the value
// goes with it — and counts toward the 6/8-char floor, which can redact a short highlighted value the plain rule
// would leave alone; that is the safe direction. On a plain line every CTRL fails at once and each rule is
// byte-for-byte the pattern it replaced (test/redact-highlighted.test.js pins both).
const CTRL = String.raw`(?:\x1b\[[0-?]*[ -/]*[@-~]|[\x0e\x0f])`;
const CODES = `${CTRL}*`;                       // any run of control sequences, possibly none
const GAP = String.raw`(?:${CTRL}|[ \t])*`;     // codes and blanks on one line (the header rules stay single-line)
const GAP_NL = String.raw`(?:${CTRL}|\s)*`;     // the same where the rule already allowed a line break

const PATTERNS: Array<[RegExp, string]> = [
  [/(AKIA|ASIA)[A-Z0-9]{16}/g, "[REDACTED_AWS_KEY]"],
  [new RegExp(String.raw`aws_secret_access_key${GAP_NL}[=:]${GAP_NL}\S+`, "gi"), "aws_secret_access_key=[REDACTED]"],
  [/(gh[pousr]_[A-Za-z0-9]{20,})/g, "[REDACTED_GH_TOKEN]"],
  [/(xox[baprs]-[A-Za-z0-9-]{10,})/g, "[REDACTED_SLACK_TOKEN]"],
  [/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]"],
  [/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "[REDACTED_JWT]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [new RegExp(String.raw`(password|passwd|token|secret)(${CODES}["']?${GAP_NL}[=:]${GAP_NL}["']?${CODES})[^\s"']{6,}`, "gi"), "$1$2[REDACTED]"],
  // The HTTP credential envelope — the wrapper every provider's token travels a command
  // line in, and the form this tool's own dashboard token is accepted in (THREAT-MODEL §7). Found
  // by a FAIL-first probe of the shipped dist (2026-09-12): the provider-prefixed shapes above were
  // caught, `Authorization: Bearer <cred>` was not. Scheme kept, value gone; the scheme is optional
  // because some APIs take the bare token, and any case is accepted. Floor 8 non-space chars, so a
  // shell substitution such as `Bearer $(cat ~/.tmux-agent/web-token)` is left alone. Single-line
  // on purpose ([ \t], not \s): a header does not continue on the next pane row. The scheme may be drawn in its
  // own colour, so codes are admitted between it and the token as well.
  [new RegExp(String.raw`(authorization${CODES}["']?${GAP}[=:]${GAP}["']?${CODES}(?:(?:bearer|basic|digest|token|negotiate|ntlm|oauth)(?:${CTRL}|[ \t])+)?)[^\s"']{8,}`, "gi"), "$1[REDACTED]"],
  // Api-key header or pair in any spelling: X-Api-Key:, x-api-key=, api_key=, apikey:, PLANE_API_KEY=.
  // Name and separator kept, mirroring the password= rule. The match starts at `api`, so whatever
  // prefixes the name (X-, PLANE_) is left in place untouched rather than captured — that keeps the
  // scan linear on a long token-like line. `api_key_file=` does not match: nothing but a
  // highlighter's codes, a quote and blanks may sit between the word and the separator.
  [new RegExp(String.raw`(api[-_]?key)(${CODES}["']?${GAP}[=:]${GAP}["']?${CODES})[^\s"']{8,}`, "gi"), "$1$2[REDACTED]"],
  // no-proto bearer creds in URLs: https://user:pass@host
  [/(https?:\/\/[^\s:/]+):([^\s@/]+)@/g, "$1:[REDACTED]@"],
];

/** Extra rules from the lexicon, compiled once. Registered by the CLI/servers at startup. */
let extra: Array<[RegExp, string]> = [];

/**
 * Install lexicon redaction rules. Idempotent (replaces the previous extra set, never the
 * built-ins). Called once at process start; a throw here should abort startup rather than run
 * a fleet with redaction the operator believes is active but is not.
 */
export function configureRedaction(cfg: LexiconConfig): number {
  extra = compileRedactRules(cfg);
  return extra.length;
}

export function redact(text: string): string {
  let out = text;
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  for (const [re, sub] of extra) {
    // A single bad user rule must not abort the whole redaction pass and let raw text through:
    // the built-ins have already run, and the remaining user rules still get their turn.
    try {
      out = out.replace(re, sub);
    } catch {
      /* skip this rule; validation at load already reported anything malformed */
    }
  }
  return out;
}

/** Introspection for `doctor`/tests: how many extra rules are active. */
export function extraRedactionRuleCount(): number {
  return extra.length;
}
