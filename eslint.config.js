// @ts-check
import tseslint from "typescript-eslint";

/**
 * Lint exists here mainly to make CONTRIBUTING's design rules MECHANICAL rather than
 * aspirational. The two custom restrictions below are the ones that map to real, paid-for
 * incidents:
 *
 *  1. No shell-string child_process. The most popular tmux MCP server shipped a
 *     command-injection RCE exactly this way (args interpolated into `exec("tmux ...")`).
 *     `execFile` with an argv array makes that class impossible — so `exec`/`execSync`/
 *     `spawn({shell:true})` are banned outright, not code-reviewed for.
 *  2. No hand-built tmux `-t` targets. tmux has two non-interchangeable target grains and
 *     the wrong one fails SILENTLY (or prefix-matches and kills the wrong session). All
 *     targets must come from sessionTarget()/paneTarget().
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "test/**", "scratch/**"] },  // scratch = untracked research artifacts
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { project: false } },
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "node:child_process",
          importNames: ["exec", "execSync"],
          message: "Use execFile with an argv array — shell-string exec is how the incumbent tmux MCP server shipped an RCE (see src/core/tmux.ts header).",
        }],
      }],
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.name='spawn'] ObjectExpression Property[key.name='shell'][value.value=true]",
          message: "shell:true reintroduces shell parsing of arguments. Use argv-only spawning.",
        },
        {
          // exempt src/core/tmux.ts — that file DEFINES the helpers (see files override below)
          selector: "TemplateLiteral[quasis.0.value.raw=/^=/]",
          message: "Do not hand-build tmux targets. Use sessionTarget()/paneTarget() — the two target grains fail silently when mixed.",
        },
        {
          /**
           * SUBSTRATE BOUNDARY (docs/NORTH-STAR.md; finding F1 of docs/NORTH-STAR-REVIEW.md).
           *
           * Three independent frontier models, asked to refute the north star, each observed that
           * "substrate, not orchestrator" had a test guarding loopback binding but NOTHING guarding
           * the scope claim itself — so drift toward becoming a supervisor was unpoliced. One asked
           * exactly the right question: "where is the written line that says deciding WHEN to
           * spawn/kill is out of scope, while providing the verb is in scope?"
           *
           * This is that line, mechanised. Providing a verb is mechanism (in scope). Scheduling,
           * retrying, or deciding autonomously what the fleet should do next is policy — it belongs
           * to the operator's supervisor, not to us. A timer inside core is the canonical smell:
           * it means core decided *when* something should happen.
           *
           * SELECTOR CHOICE — narrowed after running it. The first version banned every timer and
           * flagged four call sites, all of which turned out to be mechanism: a `sleep()` helper, a
           * settle-wait before the first CPU sample, a retry pause, and a health tick on a server a
           * human explicitly started. Banning `setTimeout` outright would have made the rule noise
           * that the next contributor disables — the classic way a design rule dies.
           *
           * `setInterval` is the honest signal: a one-shot delay waits for a mechanism to settle,
           * whereas a *repeating* timer inside core means core decided that something should keep
           * happening on its own schedule, with nobody asking. That is supervisor policy. The
           * surfaces a human starts (`src/web`, `src/bin`) are exempted by name below, so adding a
           * new exemption is a visible decision in this file rather than invisible drift in a
           * feature.
           */
          selector: "CallExpression[callee.name='setInterval']",
          message:
            "SUBSTRATE BOUNDARY: a repeating timer in src/core means core decided WHEN work keeps happening, with nobody asking — that is supervisor policy, which belongs to the operator (docs/NORTH-STAR.md, finding F1). Provide the verb; let the caller schedule it. If this is genuinely mechanism on a surface a human started, add the file to the named exemption list in eslint.config.js so the decision is visible.",
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "off", // this is a CLI
    },
  },
  {
    // the target-grain helpers necessarily construct the strings they encapsulate
    files: ["src/core/tmux.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    /**
     * SUBSTRATE-BOUNDARY exemptions, named individually and on purpose (finding F1).
     *
     * These are the two SURFACES a human explicitly starts: the long-running dashboard daemon and
     * the CLI. A periodic tick there is the operator having asked for one — `tmux-agent web` is a
     * standing request to keep watching. That is categorically different from `src/core` deciding
     * on its own that work should recur.
     *
     * Keep this list short. Every addition is a claim that a new file legitimately schedules its
     * own work; if `src/core/*` ever appears here, the boundary this rule exists to protect has
     * been given away, and the north star's first anti-goal is no longer true.
     */
    files: ["src/web/server.ts", "src/bin/tmux-agent.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.name='spawn'] ObjectExpression Property[key.name='shell'][value.value=true]",
          message: "shell:true reintroduces shell parsing of arguments. Use argv-only spawning.",
        },
        {
          selector: "TemplateLiteral[quasis.0.value.raw=/^=/]",
          message: "Do not hand-build tmux targets. Use sessionTarget()/paneTarget() — the two target grains fail silently when mixed.",
        },
      ],
    },
  },
);
