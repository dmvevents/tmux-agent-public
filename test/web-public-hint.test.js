/**
 * The dashboard's access note is rendered per request and overridable for a proxied deployment (TMUX-203; gate G1 —
 * a first-run user who reads an instruction that cannot work on their deployment has been failed by the page).
 *
 * The detail pane's note was static template text: "This UI is loopback-only — reach it via ssh -L 7337:localhost:7337
 * <host>". Wrong twice over, measured 2026-10-13: `tmux-agent web --port 8123` served a page saying 7337 (the CLI banner
 * already named 8123), and aws-do-agent — which vendors the scrubbed release and serves the page through its home-page
 * proxy at /tmux-agent/ with 7337 never published — had its E2E verifier file the sentence as a defect (A1-P2-4).
 *
 * The contract, each a check that FAILS if the property is removed:
 *   (a) accessNote({ port }) names the port it is given in the `ssh -L P:localhost:P` form — 8123 in, 7337 nowhere;
 *   (b) a publicHint replaces the sentence, HTML-escaped (`<script>` arrives as `&lt;script&gt;`), and `ssh -L` is gone;
 *   (c) a publicUrl alone gives "This UI is served at <b>url</b>." escaped, `ssh -L` gone;
 *   (d) hint wins over url; whitespace-only knobs count as unset; the template holds the slot exactly once and the
 *       rendered page never carries it;
 *   (e) the BUILT daemon, started through helpers/built-web.js with TMUX_AGENT_PUBLIC_HINT in its environment, serves a `/`
 *       whose HTML carries the hint and no `ssh -L`; the same daemon with both knobs set to the empty string (the CLI's
 *       "unset") serves the ssh form naming ITS bound port;
 *   (f) `$` sequences in a hint or URL are text, not replacement patterns: `$'`, `$&`, `` $` ``, `$$` and `$1` render as
 *       given (HTML-escaped only), the page grows by exactly the note minus the slot and carries `</html>` once, and the
 *       built daemon serves the same literal — on d542ddf a string replacement spliced the template remainder in after
 *       `$'` (GET / 40,875 → 68,059 bytes, two `</html>`; found by the dashboard re-cut's independent review).
 *
 * FAIL-first on the parent 3ebb7a8 (scratch/public-hint-2026-10-13/parent/ — that tree's dist and test/ with this file
 * beside them; test-parent-red.log): (a)–(d) red with `ui.accessNote is not a function`; (e) red — with the hint in the
 * environment the served page still says `ssh -L 7337`.
 *
 * Run: node --test test/web-public-hint.test.js   (needs `npm run build` first)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
// A namespace import on purpose: a build without the exports reds the CASES that need them, not this file's load.
import * as ui from "../dist/web/ui.js";
import { ROOT, startWeb, stopWeb } from "./helpers/built-web.js";
import { tempHome, removeTempHomes } from "./helpers/temp-home.js";

after(() => removeTempHomes()); // every home this file made

const HINT = "served at /tmux-agent/ through the harness home page (port 8000)";
const SLOT = "<!--access-note-->";

test("(a) the default sentence names the bound port, not 7337", () => {
  const s = ui.accessNote({ port: 8123 });
  assert.match(s, /ssh -L 8123:localhost:8123/);
  assert.doesNotMatch(s, /7337/);
  assert.match(s, /loopback-only/);
});

test("(b) a public hint replaces the sentence, escaped, and the ssh -L form is gone", () => {
  const s = ui.accessNote({ port: 8123, publicHint: `${HINT} <script>alert(1)</script>` });
  assert.ok(s.includes(HINT), s);
  assert.ok(s.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), s);
  assert.ok(!s.includes("<script>"), s);
  assert.doesNotMatch(s, /ssh -L|loopback-only/);
});

test("(c) a public URL alone gives the served-at sentence, escaped, without ssh -L", () => {
  const s = ui.accessNote({ port: 8123, publicUrl: "http://localhost:8000/tmux-agent/?a=1&b=<2>" });
  assert.equal(s, "This UI is served at <b>http://localhost:8000/tmux-agent/?a=1&amp;b=&lt;2&gt;</b>.");
  assert.doesNotMatch(s, /ssh -L|loopback-only/);
});

test("(d) hint wins over URL; whitespace-only knobs are unset; the slot is in the template once and never in the page", () => {
  const both = ui.accessNote({ port: 8123, publicHint: HINT, publicUrl: "http://x/" });
  assert.equal(both, HINT, "the hint, verbatim — not the URL's served-at sentence"); // HINT carries no HTML specials, so escaping leaves it as typed
  assert.ok(!both.includes("<b>") && !both.includes("http://x/"), both);
  const blank = ui.accessNote({ port: 8123, publicHint: "   ", publicUrl: "\t" });
  assert.match(blank, /ssh -L 8123:localhost:8123/);
  assert.equal(ui.ACCESS_NOTE_SLOT, SLOT);
  assert.equal(ui.DASHBOARD_HTML.split(SLOT).length, 2, "the template holds the slot exactly once");
  const page = ui.renderDashboardHtml({ port: 8123 });
  assert.ok(!page.includes(SLOT) && page.includes("ssh -L 8123:localhost:8123"), "the rendered page fills the slot");
});

test("(e) the built daemon serves the hint from its environment, and the ssh form with its own port without it", async () => {
  const page = async (env) => {
    const home = tempHome("ta-public-hint-");
    const r = await startWeb(ROOT, home, env, ["--no-token"]);
    try {
      const res = await fetch(`http://127.0.0.1:${r.port}/`, { headers: { accept: "text/html" } });
      assert.equal(res.status, 200);
      return { port: r.port, html: await res.text() };
    } finally {
      await stopWeb(r.child);
    }
  };
  const withHint = await page({ TMUX_AGENT_PUBLIC_HINT: HINT, TMUX_AGENT_PUBLIC_URL: "" });
  assert.ok(withHint.html.includes(HINT), "the hint must reach the page");
  assert.ok(!withHint.html.includes("ssh -L"), "the tunnel form must not");
  assert.ok(!withHint.html.includes(SLOT), "the slot must be filled");
  const plain = await page({ TMUX_AGENT_PUBLIC_HINT: "", TMUX_AGENT_PUBLIC_URL: "" });
  assert.ok(plain.html.includes(`ssh -L ${plain.port}:localhost:${plain.port}`), `the page must name its bound port ${plain.port}`);
  assert.ok(!plain.html.includes(HINT) && !plain.html.includes(SLOT));
});

test("(f) `$` sequences in a hint or URL are text, not replacement patterns — rendered as given, the template once", async () => {
  const tricky = "cost $' end $& $` $$ $1";
  const shown = "cost $' end $&amp; $` $$ $1"; // accessNote HTML-escapes the ampersand and nothing else here
  const note = ui.accessNote({ port: 8123, publicHint: tricky });
  assert.equal(note, shown);
  const page = ui.renderDashboardHtml({ port: 8123, publicHint: tricky });
  assert.ok(page.includes(shown), page.slice(Math.max(0, page.indexOf("cost")), page.indexOf("cost") + 80));
  assert.equal(page.split("</html>").length - 1, 1, "the template remainder must appear once — a string replacement splices it in after $'");
  assert.equal(page.length - ui.DASHBOARD_HTML.length, note.length - SLOT.length, "the page grows by exactly the note minus the slot");
  const viaUrl = ui.renderDashboardHtml({ port: 8123, publicUrl: "http://h/p?q=$'&x=$&" });
  assert.ok(viaUrl.includes("http://h/p?q=$'&amp;x=$&amp;"), viaUrl.slice(viaUrl.indexOf("http://h/p"), viaUrl.indexOf("http://h/p") + 60));
  assert.equal(viaUrl.split("</html>").length - 1, 1);
  const home = tempHome("ta-public-hint-");
  const r = await startWeb(ROOT, home, { TMUX_AGENT_PUBLIC_HINT: tricky, TMUX_AGENT_PUBLIC_URL: "" }, ["--no-token"]);
  try {
    const res = await fetch(`http://127.0.0.1:${r.port}/`, { headers: { accept: "text/html" } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(shown), "the daemon must serve the literal");
    assert.equal(html.split("</html>").length - 1, 1, "exactly one </html> from the daemon");
  } finally {
    await stopWeb(r.child);
  }
});
