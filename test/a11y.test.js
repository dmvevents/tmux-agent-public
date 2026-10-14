/**
 * Accessibility guards — GA card TMUX-31.
 *
 * A universal open-source tool cannot be unusable for a colour-blind or screen-reader operator.
 * Contrast was never measured until it was: `error` came in at 4.36:1 and `dead` at 3.67:1
 * against the panel background, both below WCAG AA. These tests keep the palette honest and stop
 * anyone reintroducing colour-only state signalling.
 *
 * TMUX-152: the glyph case asserted a hand-typed list of the seven `SessionState` members under a comment
 * claiming it covered "every state the monitor can emit" — so an eighth member would have shipped without
 * a glyph and left this suite green. It reads the shipped union now, and the case after it plants an
 * eighth in a fixture declaration to prove the same loop demands a glyph for a name the dashboard has
 * never heard of. The five filter chips are a separate, deliberate SUBSET and carry their own control.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DASHBOARD_HTML } from "../dist/web/ui.js";
import { shippedSessionStates } from "./helpers/ledger-events.js";

/** WCAG 2.x relative luminance + contrast ratio. */
function lum(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Pull a CSS custom property out of the served stylesheet — tests the SHIPPED value. */
function cssVar(name) {
  const m = DASHBOARD_HTML.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} must be defined in the dashboard CSS`);
  return m[1];
}

const BG = () => cssVar("bg");
const PANEL = () => cssVar("panel");

/** Same, but scoped to the light-theme override block. */
function lightVar(name) {
  const block = DASHBOARD_HTML.match(/html\[data-theme=light\]\{([^}]+)\}/);
  assert.ok(block, "a light-theme override block must exist in the dashboard CSS");
  const m = block[1].match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} must be redefined in the light theme`);
  return m[1];
}

test("a11y: every text/state colour clears WCAG AA (4.5:1) on both backgrounds", () => {
  const failures = [];
  for (const token of ["fg", "dim", "work", "idle", "blocked", "error", "dead", "acc"]) {
    const c = cssVar(token);
    const worst = Math.min(ratio(c, BG()), ratio(c, PANEL()));
    if (worst < 4.5) failures.push(`--${token} (${c}) = ${worst.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `below AA 4.5:1 -> ${failures.join(", ")}`);
});

/**
 * The states the shipped glyph map does NOT cover, given the vocabulary to hold it to. One
 * implementation, two callers: the case below passes it the real union, and the plant after
 * that passes it a fixture union — a check whose loop and whose proof are two different loops proves
 * nothing about the one that ships.
 */
function glyphGaps(states, html = DASHBOARD_HTML) {
  return states.filter((st) => !new RegExp(`${st}\\s*:\\s*'`).test(html));
}

test("a11y: state is never conveyed by colour alone (WCAG 1.4.1) — and the glyph map is held to the SHIPPED SessionState union, never to a copy of it", () => {
  assert.match(DASHBOARD_HTML, /function stateGlyph/, "a non-colour state indicator is required");
  // This case claimed to cover "every state the monitor can emit" while asserting a hand-typed list of
  // the seven — so an eighth member would have shipped glyph-less and left this suite green. The union
  // is now read out of dist/core/monitor.d.ts (asserted non-empty by the reader itself).
  const union = shippedSessionStates();
  const gaps = glyphGaps(union);
  assert.deepEqual(gaps, [], `stateGlyph must cover every member of the SessionState union dist/core/monitor.d.ts declares — no glyph for ${gaps.join(", ")}`);
});

test("a11y: the glyph check READS the union rather than repeating it — an eighth state planted in a fixture declaration is demanded a glyph", () => {
  // The only way to prove a list is read and not written: plant a member the shipped dashboard cannot
  // know about, and watch the SAME function ask for its glyph. A hard-coded list of the real seven
  // passes on this input, which is why the plant is the criterion and the loop's output is not.
  const root = mkdtempSync(join(tmpdir(), "ta-a11y-state-"));
  try {
    mkdirSync(join(root, "dist/core"), { recursive: true });
    writeFileSync(join(root, "dist/core/monitor.d.ts"),
      'export type SessionState = "WORKING" | "IDLE" | "PONDERING";\n');
    const planted = shippedSessionStates(root);
    assert.deepEqual(planted, ["WORKING", "IDLE", "PONDERING"], "the reader must return the planted union, or the plant below proves nothing");
    assert.deepEqual(glyphGaps(planted), ["PONDERING"],
      "the shipped dashboard has no glyph for a state nobody declared, so the check must name it — and a literal list of the real seven cannot fail this");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a11y: the dashboard's five `data-state` filter chips are a deliberate proper SUBSET of the union, not a stale copy of it", () => {
  // The control that keeps the surfaces check able to tell a documented subset from drift. The chips
  // cover the five STEADY states by design — test/browser-audit/audit.py's chip_states says so in the
  // comment above it — while the glyph map above covers all seven. So: every chip must be a declared
  // state (a chip naming something the union does not is a typo that would filter nothing), and the
  // chips must stay FEWER than the union (a chip set that reached seven would mean the by-design
  // subset stopped being one, and audit.py's five would be the stale copy).
  const union = shippedSessionStates();
  const chips = [...new Set([...DASHBOARD_HTML.matchAll(/data-state="([A-Z_]+)"/g)].map((m) => m[1]))].sort();
  assert.ok(chips.length > 0, "cut ZERO `data-state` chips out of the shipped dashboard — an empty candidate set is a hard failure, not a pass");
  assert.deepEqual(chips.filter((c) => !union.includes(c)), [],
    `the dashboard filters on a data-state the SessionState union does not declare: ${chips.filter((c) => !union.includes(c)).join(", ")} — that chip can never match a session`);
  assert.ok(chips.length < union.length,
    `the dashboard's chips (${chips.join(", ")}) now cover all ${union.length} declared states — the five-steady-state subset was deliberate, so if that changed, test/browser-audit/audit.py's chip_states and its comment are the stale copy and must move with it`);
});

test("a11y: the attention banner announces itself to a screen reader", () => {
  assert.match(DASHBOARD_HTML, /id="attn"[^>]*aria-live="polite"/, "new ERROR sessions must be announced");
  assert.match(DASHBOARD_HTML, /id="attn"[^>]*role="alert"/);
});

test("a11y: tables carry captions and column scopes", () => {
  const captions = DASHBOARD_HTML.match(/<caption/g) ?? [];
  assert.ok(captions.length >= 2, "history and waste tables both need captions");
  const scoped = DASHBOARD_HTML.match(/<th scope="col"/g) ?? [];
  assert.ok(scoped.length >= 8, `column headers need scope="col" (found ${scoped.length})`);
});

test("a11y: the fleet tree exposes tree/treeitem semantics with labels", () => {
  assert.match(DASHBOARD_HTML, /role="tree"/);
  assert.match(DASHBOARD_HTML, /role="treeitem"/);
  assert.match(DASHBOARD_HTML, /aria-label="Fleet sessions"/);
});

test("a11y: interactive controls expose pressed state and visible focus", () => {
  assert.match(DASHBOARD_HTML, /aria-pressed/, "toggle chips must expose state");
  assert.match(DASHBOARD_HTML, /:focus-visible/, "keyboard focus must be visible");
  assert.match(DASHBOARD_HTML, /aria-label="Filter sessions"/, "the search input needs a label");
});

test("a11y: screen-reader-only text is hidden visually but present in the DOM", () => {
  assert.match(DASHBOARD_HTML, /\.sr\{/, "an sr-only class must exist");
  assert.match(DASHBOARD_HTML, /clip:rect\(0 0 0 0\)/, "sr-only must not be display:none (that hides it from AT too)");
});

test("a11y: verdict badges clear AA on their own composited tint (browser audit 2026-08-25)", () => {
  // The .vd badges lay a translucent tint over the page, so their effective background is
  // LIGHTER than --panel. That is how KEEP-CRITICAL measured 4.43:1 in a real browser while
  // --acc itself passed against the flat backgrounds above — flat-var checks cannot see it.
  const comp = (rgba, base) => {
    const b = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
    const c = rgba.slice(0, 3).map((v, i) => Math.round(v * rgba[3] + b[i] * (1 - rgba[3])));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  const rules = [...DASHBOARD_HTML.matchAll(/\.vd\.(\w+)\{background:rgba\(([\d.]+),([\d.]+),([\d.]+),(\.\d+|[\d.]+)\);color:(#[0-9a-fA-F]{6}|var\(--(\w+)\))/g)];
  assert.ok(rules.length >= 5, `expected the 5 .vd families, found ${rules.length}`);
  const failures = [];
  for (const m of rules) {
    const rgba = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
    const fg = m[6].startsWith("#") ? m[6] : cssVar(m[7]);
    for (const base of [BG(), PANEL()]) {
      const r = ratio(fg, comp(rgba, base));
      if (r < 4.5) failures.push(`.vd.${m[1]} (${fg}) on ${base} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `badge text below AA on its composited tint -> ${failures.join(", ")}`);
});

test("a11y: the LIGHT theme clears WCAG AA (4.5:1) too — the toggle must not trade readability", () => {
  const failures = [];
  for (const token of ["fg", "dim", "work", "idle", "blocked", "error", "dead", "acc"]) {
    const c = lightVar(token);
    const worst = Math.min(ratio(c, lightVar("bg")), ratio(c, lightVar("panel")));
    if (worst < 4.5) failures.push(`--${token} (${c}) = ${worst.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `light theme below AA 4.5:1 -> ${failures.join(", ")}`);
});

test("a11y: verdict badges clear AA on their composited tint in the LIGHT theme too", () => {
  const comp = (rgba, base) => {
    const b = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
    const c = rgba.slice(0, 3).map((v, i) => Math.round(v * rgba[3] + b[i] * (1 - rgba[3])));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  // the translucent tints are shared between themes; only the ink changes in light mode
  const tints = Object.fromEntries(
    [...DASHBOARD_HTML.matchAll(/\.vd\.(\w+)\{background:rgba\(([\d.]+),([\d.]+),([\d.]+),(\.\d+|[\d.]+)\)/g)]
      .map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]]));
  assert.ok(Object.keys(tints).length >= 5, `expected the 5 .vd families, found ${Object.keys(tints).length}`);
  const overrides = Object.fromEntries(
    [...DASHBOARD_HTML.matchAll(/html\[data-theme=light\] \.vd\.(\w+)\{color:(#[0-9a-fA-F]{6})\}/g)]
      .map((m) => [m[1], m[2]]));
  for (const fam of ["crit", "prot", "close"]) {
    assert.ok(overrides[fam], `.vd.${fam} hardcodes a dark-tuned ink and needs a light override`);
  }
  const failures = [];
  for (const fam of Object.keys(tints)) {
    const ink = overrides[fam] ?? { keep: lightVar("work"), flag: lightVar("blocked") }[fam];
    assert.ok(ink, `.vd.${fam} light ink unresolvable`);
    for (const base of [lightVar("bg"), lightVar("panel")]) {
      const r = ratio(ink, comp(tints[fam], base));
      if (r < 4.5) failures.push(`.vd.${fam} (${ink}) on ${base} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `light badge ink below AA on its composited tint -> ${failures.join(", ")}`);
});

test("a11y: host-vitals strip inks clear AA on the --inset background in both themes", () => {
  // .vt tiles sit on --inset, which no other check measures against: darker than --bg in the
  // dark theme (fine) but between --panel and --bg in the light theme, where a borderline
  // token could dip below 4.5:1 unnoticed.
  const failures = [];
  for (const token of ["dim", "fg", "blocked", "error"]) {
    for (const [theme, ink, base] of [["dark", cssVar(token), cssVar("inset")], ["light", lightVar(token), lightVar("inset")]]) {
      const r = ratio(ink, base);
      if (r < 4.5) failures.push(`${theme} --${token} (${ink}) on --inset = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `vitals ink below AA on --inset -> ${failures.join(", ")}`);
});

test("a11y: vitals pressure is never colour-alone — warn/crit carry a glyph and sr text", () => {
  assert.match(DASHBOARD_HTML, /id="vitals"[^>]*aria-label="Host vitals"/, "the strip needs a group label");
  assert.match(DASHBOARD_HTML, /sev==='crit'\?'✕':'⚠'/, "warn/crit must carry a non-colour glyph");
  assert.match(DASHBOARD_HTML, /class="sr">'\+\(sev==='crit'\?' critical':' warning'\)/, "severity must be announced to a screen reader");
});

test("a11y/ux: theme toggle sits in the header, exposes pressed state, defaults dark, persists", () => {
  assert.match(DASHBOARD_HTML, /<header>[^]*?id="theme"[^]*?<\/header>/, "the toggle lives in the header");
  assert.match(DASHBOARD_HTML, /id="theme" aria-pressed="false"/, "the toggle must expose pressed state");
  assert.match(DASHBOARD_HTML, /const TK='tmux-agent\.theme'/, "preference persists under its own localStorage key, not the view state");
  assert.match(DASHBOARD_HTML, /localStorage\.getItem\(TK\)==='light'\?'light':'dark'/,
    "dark stays the default; only an explicit stored choice switches to light");
});

test("401 page: a browser gets a usable PAGE, not raw JSON (reported as 'the button does nothing')", async () => {
  const { UNAUTHORIZED_HTML } = await import("../dist/web/ui.js");
  // The live report: opening the dashboard without a token rendered {"error":"unauthorized…"}
  // as bare text — no UI, nothing clickable, indistinguishable from a crashed app.
  assert.match(UNAUTHORIZED_HTML, /<!doctype html>/i, "must be a document, not JSON");
  assert.match(UNAUTHORIZED_HTML, /token/i, "must say what is missing");
  assert.match(UNAUTHORIZED_HTML, /web-token/, "must show WHERE to get it");
  assert.match(UNAUTHORIZED_HTML, /<input/, "must offer a way to supply it");
  assert.match(UNAUTHORIZED_HTML, /aria-label="Access token"/, "the input needs a label");
  assert.match(UNAUTHORIZED_HTML, /:focus-visible/, "keyboard focus must be visible here too");
  assert.ok(!/DASHBOARD_HTML/.test(UNAUTHORIZED_HTML), "must not leak the dashboard itself");
});
