/**
 * Lexicon — the vocabulary tmux-agent reasons with, as DATA rather than as source.
 *
 * Why this file exists (docs/AGNOSTIC-DESIGN.md has the full argument): the architecture was
 * pluggable but the vocabulary was not. Three lexicons lived as TypeScript literals in core, so
 * the only way to teach the tool about a different fleet was to fork it:
 *
 *   - what BLOCKED/WORKING/ERROR look like        -> core/monitor.ts, for OUR three agent CLIs
 *   - what a legitimate non-tmux supervisor is    -> core/engagement.ts, for OUR naming scheme
 *   - which secret shapes to redact               -> core/redact.ts, for OUR cloud providers
 *
 * Each one has already caused a real diagnosed bug for us, and we fixed each only for our own
 * vocabulary. The redaction one is the reason this is a GA blocker and not a nice-to-have: an
 * adopter on a provider we do not use gets SILENT non-redaction, which writes their credentials
 * to disk with no signal.
 *
 * Config: --lexicon FILE, else TMUX_AGENT_LEXICON, else $TMUX_AGENT_HOME/lexicon.json. NO ENTRY at the default path =>
 * byte-identical behaviour to v0.1.0, which is what makes this safe to ship at GA. A file that was NAMED (the flag, the
 * variable) and cannot be read — or one at the default path that exists and cannot be read, a symbolic link whose target
 * is missing among them — is refused, never silently the defaults: see loadLexicon.
 *
 * TRUST MODEL: this file is operator-owned local config, exactly like policy.json — NOT attacker
 * input. It is still validated strictly, because the failure mode of a bad lexicon is a fleet
 * view that is confidently wrong, and that is worse than one that is visibly broken.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { danglingLink, readFailure } from "./read-failure.js";

/** A user-defined agent-CLI profile: patterns per state, tried against the live pane tail. */
export interface LexiconProfile {
  name: string;
  error?: string[];
  blocked?: string[];
  working?: string[];
  idle?: string[];
  /** regex with ONE capture group yielding 0..100; `inverted` if the CLI reports context REMAINING */
  contextPct?: string;
  contextPctInverted?: boolean;
}

export interface LexiconParents {
  /** exact names (case-insensitive) that are legitimate non-tmux supervisors here */
  nonSession?: string[];
  /** regex for the same, e.g. "^orchestrator-\\d+$" */
  nonSessionPattern?: string;
  /** true = use ONLY these, dropping the built-ins (rarely what you want) */
  replace?: boolean;
}

export interface LexiconRedactRule {
  name: string;
  pattern: string;
  replacement: string;
  /** regex flags; "g" is forced on, since a rule that redacts only the first match is a bug */
  flags?: string;
}

export interface LexiconConfig {
  version?: number;
  profiles?: LexiconProfile[];
  /** true = user profiles ONLY; default false = user profiles tried first, built-ins as fallback */
  replaceProfiles?: boolean;
  parents?: LexiconParents;
  /** ADDITIVE ONLY by construction — see compileRedactRules(). There is no `replace` here. */
  redact?: LexiconRedactRule[];
}

export class LexiconError extends Error {}

/**
 * Pattern screening. JS has no regex timeout, so a catastrophically-backtracking pattern in a
 * config file would hang the fleet poll loop with no way to interrupt it. We cannot detect
 * ReDoS in general, but we can cheaply reject the shapes that cause it in practice — nested
 * unbounded quantifiers like (a+)+ or (\d*)* — and cap length so a pathological pattern cannot
 * be smuggled in as sheer size. Rejected at LOAD, named, and loud.
 */
const MAX_PATTERN_LEN = 512;
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*[+*]/;

export function compilePattern(pattern: string, flags: string, where: string): RegExp {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new LexiconError(`${where}: pattern must be a non-empty string`);
  }
  if (pattern.length > MAX_PATTERN_LEN) {
    throw new LexiconError(`${where}: pattern longer than ${MAX_PATTERN_LEN} chars (got ${pattern.length})`);
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw new LexiconError(
      `${where}: pattern has a nested unbounded quantifier (e.g. "(a+)+"), which can hang the poll loop — rewrite it more specifically`,
    );
  }
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    throw new LexiconError(`${where}: invalid regex — ${(e as Error).message}`);
  }
}

/** Where the path came from — the first word of a refusal. Only the default may be silently absent. */
type LexiconSource = "--lexicon" | "TMUX_AGENT_LEXICON" | "default path";

/** The flag, else the variable (set is set — an empty value is a lexicon named nothing), else lexicon.json under the home. */
function resolveLexiconPath(home?: string, explicitPath?: string): { source: LexiconSource; path: string } {
  if (explicitPath !== undefined) return { source: "--lexicon", path: explicitPath };
  if (process.env.TMUX_AGENT_LEXICON !== undefined) return { source: "TMUX_AGENT_LEXICON", path: process.env.TMUX_AGENT_LEXICON };
  return { source: "default path", path: join(home ?? process.env.TMUX_AGENT_HOME ?? join(homedir(), ".tmux-agent"), "lexicon.json") };
}

/**
 * Load + validate. The empty lexicon — shipped defaults, v0.1.0 behaviour — is returned in exactly ONE case: nothing was
 * named and the default $TMUX_AGENT_HOME/lexicon.json has no entry at all — not a symbolic link whose target is missing,
 * which reads ENOENT too and is refused naming the link and its target. Every other failure to read (a path
 * named by --lexicon or TMUX_AGENT_LEXICON that does not exist, a directory, a file this user cannot read, a default-path
 * file that exists and cannot be read) is a LexiconError naming the source, the path as given and the OS reason, so the caller
 * refuses before anything acts — the CLI's exit 78 on every verb, the MCP server's startup. Absent-by-default and
 * named-but-unreadable are told apart HERE, not by the caller. Until this fix (measured 2026-09-15 on an earlier build)
 * one bare `catch { return {}; }` covered them all: the operator's redact
 * rules silently not applied, the shape reaching the ledger in plain text, exit 0 — the failure the header above calls
 * the GA blocker, on the file meant to close it.
 */
export function loadLexicon(home?: string, explicitPath?: string): LexiconConfig {
  const { source, path: p } = resolveLexiconPath(home, explicitPath);
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // ENOENT is also what a symbolic link whose target is missing reads as — a lexicon.json linked into a dotfiles
      // checkout that moved. The entry exists, so it is not the absent file: refused, naming the link and its target
      // (Before this fix this was the shipped vocabulary, the operator's redact rules silently not applied.)
      const dangling = danglingLink(p);
      if (dangling !== null) throw new LexiconError(`${source} ${JSON.stringify(p)}: cannot be read — ${dangling}`);
      // the one silent case: no lexicon => shipped defaults only. The overwhelmingly common case.
      if (source === "default path") return {};
    }
    throw new LexiconError(`${source} ${JSON.stringify(p)}: cannot be read — ${readFailure(e)}`);
  }
  let cfg: LexiconConfig;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    // Loud, not silent: a typo'd lexicon must never look like "no customisation".
    throw new LexiconError(`${p}: not valid JSON — ${(e as Error).message}`);
  }
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    throw new LexiconError(`${p}: expected a JSON object`);
  }
  validateLexicon(cfg, p);
  return cfg;
}

/** Compile every pattern up front so a bad rule fails at load with its own name attached. */
export function validateLexicon(cfg: LexiconConfig, where = "lexicon"): void {
  if (cfg.version !== undefined && cfg.version !== 1) {
    throw new LexiconError(`${where}: unsupported version ${cfg.version} (this build understands 1)`);
  }
  for (const prof of cfg.profiles ?? []) {
    if (!prof.name || typeof prof.name !== "string") {
      throw new LexiconError(`${where}: every profile needs a "name"`);
    }
    for (const key of ["error", "blocked", "working", "idle"] as const) {
      const pats = prof[key];
      if (pats === undefined) continue;
      if (!Array.isArray(pats)) throw new LexiconError(`${where}: profile "${prof.name}".${key} must be an array of regex strings`);
      // "im" must match profileFromLexicon's flags exactly: validating under different flags than
      // the ones that run would let a pattern pass validation and then behave differently.
      pats.forEach((pat, i) => compilePattern(pat, "im", `${where}: profile "${prof.name}".${key}[${i}]`));
    }
    if (prof.contextPct !== undefined) {
      const re = compilePattern(prof.contextPct, "", `${where}: profile "${prof.name}".contextPct`);
      // A contextPct without a capture group silently yields null forever — catch it now.
      if (!/\((?!\?[:=!])/.test(re.source)) {
        throw new LexiconError(`${where}: profile "${prof.name}".contextPct needs one capture group for the number`);
      }
    }
  }
  if (cfg.parents?.nonSessionPattern !== undefined) {
    compilePattern(cfg.parents.nonSessionPattern, "i", `${where}: parents.nonSessionPattern`);
  }
  if (cfg.parents?.nonSession !== undefined && !Array.isArray(cfg.parents.nonSession)) {
    throw new LexiconError(`${where}: parents.nonSession must be an array of names`);
  }
  for (const [i, rule] of (cfg.redact ?? []).entries()) {
    if (!rule?.name) throw new LexiconError(`${where}: redact[${i}] needs a "name" (it appears in errors and tests)`);
    if (typeof rule.replacement !== "string") {
      throw new LexiconError(`${where}: redact rule "${rule.name}" needs a string "replacement"`);
    }
    compilePattern(rule.pattern, redactFlags(rule.flags), `${where}: redact rule "${rule.name}"`);
  }
}

/** "g" is forced: a redaction rule that scrubs only the first occurrence leaks the rest. */
function redactFlags(flags?: string): string {
  const f = new Set((flags ?? "").split("").filter((c) => "gimsuy".includes(c)));
  f.add("g");
  return [...f].join("");
}

/**
 * Compile user redaction rules. ADDITIVE BY CONSTRUCTION: there is deliberately no way to
 * disable a built-in pattern from config. A user can make redaction stronger; they cannot make
 * it weaker. The worst config bug we could ship would be one where a typo causes plaintext
 * credentials to reach disk, so that path does not exist.
 */
export function compileRedactRules(cfg: LexiconConfig): Array<[RegExp, string]> {
  return (cfg.redact ?? []).map((r) => [
    compilePattern(r.pattern, redactFlags(r.flags), `redact rule "${r.name}"`),
    r.replacement,
  ]);
}

/** Resolve the non-session-parent test, merged with the built-in names unless replace:true. */
export function compileParentRules(
  cfg: LexiconConfig,
  builtinNames: Set<string>,
  builtinPattern: RegExp,
): (parent: string) => boolean {
  const names = new Set<string>(cfg.parents?.replace ? [] : builtinNames);
  for (const n of cfg.parents?.nonSession ?? []) names.add(n.toLowerCase());
  const userRe = cfg.parents?.nonSessionPattern
    ? compilePattern(cfg.parents.nonSessionPattern, "i", "parents.nonSessionPattern")
    : null;
  const useBuiltinRe = !cfg.parents?.replace;
  return (parent: string) => {
    const p = parent.toLowerCase();
    if (names.has(p)) return true;
    if (userRe?.test(parent)) return true;
    return useBuiltinRe && builtinPattern.test(parent);
  };
}
