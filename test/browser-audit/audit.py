#!/usr/bin/env python3
"""
Browser audit of the dashboard — the 30-check suite, self-provisioned for CI (TMUX-40;
T13 theme checks added by TMUX-25, T14 host-vitals strip by TMUX-52, T15 the Top waste panel's
truncated-window note by TMUX-129, T16 the per-session views' by TMUX-130, T17 the paint of that
one note by TMUX-131, T18 the context-pressure badge for a Claude Code status line that draws the
figure as a bar by TMUX-215).

Why this exists next to test/ui-acceptance.py: the acceptance harness proves the UI loads and
its core interactions work (8 criteria). This audit is the KR4 evidence bar — it drives every
control, keyboard-only navigation, state-chip and meta filtering, the attention banner, the
read-only send policy (UI AND server side), and independently recomputes WCAG AA contrast from
computed styles. It found three defects invisible to every node suite (out-of-order detail
renders, poll wiping half-typed input, alpha-composited badge contrast) when first run against
the live fleet on 2026-08-25; promoting it out of scratch/ makes that coverage a CI gate
instead of a thing a human remembers to run.

Differences from the original scratch/ version: the live 30-session fleet is replaced by a
deterministic fixture fleet on an isolated tmux socket + TMUX_AGENT_HOME, so every threshold
is arithmetic against /api/fleet instead of a constant tuned to one operator's machine. The
check IDs (T0-T12) and their meaning are unchanged — plus T13 (theme), T14 (host vitals),
T15 (the Top waste panel's truncated-window note, measured absent-then-present on one page),
T16 (the same note on the two per-session views, plus the empty timeline's sentence pinned true
for a session with no history and gone for one whose history is archived), T17 (that note is
READ, not SHOUTED: every case-sensitive identifier in it survives the paint on all three
surfaces) and T18 (the tree's `ctx 71%` badge for a WORKING Claude Code pane whose status line
draws the figure as a bar — contextPct read null on every live pane before TMUX-215), 0 findings
required.

Secrets: the web token is read from the isolated HOME's web-token file into memory and never
printed; everything this script prints passes through redact(). The server's own stdout (whose
startup banner embeds the token) is drained and discarded, never echoed to the CI log.

Run:  python3 test/browser-audit/audit.py     (hard-fails if playwright is missing — this is
a gating job, not an opt-in; install with `pip install playwright && playwright install chromium`)
"""
from __future__ import annotations

import gzip
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import urllib.request
import zlib
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
OUT = pathlib.Path(os.environ.get("BROWSER_AUDIT_OUT", "/tmp/tmux-agent-browser-audit"))
PORT = int(os.environ.get("BROWSER_AUDIT_PORT", "7517"))  # off 7337 (live) and 7457 (acceptance)
SOCKET = f"ta-audit-{os.getpid()}"
HOME = pathlib.Path(f"/tmp/ta-audit-home-{os.getpid()}")
BASE = f"http://127.0.0.1:{PORT}"
MARKER = f"BROWSER_AUDIT_PING_{os.getpid()}"

# fixture fleet: name -> (parent, task, verdict) — one of every badge family, one BLOCKED,
# one send-target the read-only check must prove untouched, one WORKING Claude Code pane whose
# status line draws the context bar (T18), one killed for history
SEND_TARGET = "audit-send-target"
BLOCKED = "audit-blocked"
CTX_PRESSURE = "audit-ctx-pressure"
FIXTURE = {
    "audit-root": ("audit-lab", "fixture root", "KEEP-CRITICAL"),
    "audit-child-a": ("audit-root", "child A", "KEEP"),
    "audit-child-b": ("audit-root", "child B", "FLAG-REVIEW"),
    BLOCKED: ("audit-root", "awaits approval", "KEEP-PROTECTED"),
    SEND_TARGET: ("audit-root", "read-only probe", "CLOSE"),
    CTX_PRESSURE: ("audit-root", "context pressure", "KEEP"),
}
ENDED = "audit-ended"  # spawned then killed: the history table needs a decommissioned row

# T11 + T13 share this sampler: recompute WCAG AA from *computed* styles, compositing the
# translucent background stack bottom-up, so each theme is measured exactly as painted
CONTRAST_SAMPLER = """() => {
  const lum = (c) => { const m=c.match(/[\\d.]+/g); if(!m) return null;
    const [r,g,b]=m.slice(0,3).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});
    return .2126*r+.7152*g+.0722*b; };
  const parse=(c)=>{const m=c&&c.match(/[\\d.]+/g); if(!m) return null;
    const a=m.length>3?parseFloat(m[3]):1; return {r:+m[0],g:+m[1],b:+m[2],a};};
  const bgOf=(el)=>{ // composite the translucent stack bottom-up until opaque
    const stack=[]; let e=el;
    while(e){ const p=parse(getComputedStyle(e).backgroundColor); if(p&&p.a>0) stack.push(p); if(p&&p.a>=1) break; e=e.parentElement; }
    let base={r:13,g:17,b:23,a:1};
    for(const p of stack.reverse()) base={r:p.r*p.a+base.r*(1-p.a), g:p.g*p.a+base.g*(1-p.a), b:p.b*p.a+base.b*(1-p.a), a:1};
    return 'rgb('+base.r+', '+base.g+', '+base.b+')'; };
  const ratio = (a,b)=>{const l1=Math.max(a,b)+.05,l2=Math.min(a,b)+.05;return l1/l2;};
  const out=[]; const seen=new Set();
  for (const sel of ['.vd','.eng','.tag','.note','.ctx','.name','.pill','.st','.vt']) {
    for (const el of document.querySelectorAll(sel)) {
      const cs=getComputedStyle(el);
      const key=sel+'|'+cs.color+'|'+bgOf(el); if(seen.has(key)) continue; seen.add(key);
      const lf=lum(cs.color), lb=lum(bgOf(el)); if(lf==null||lb==null) continue;
      const px=parseFloat(cs.fontSize); const bold=parseInt(cs.fontWeight)>=700;
      const large=(px>=18.66&&bold)||px>=24; const need=large?3.0:4.5;
      out.push({sel, sample:(el.textContent||'').trim().slice(0,18), ratio:+ratio(lf,lb).toFixed(2), need});
    } }
  return out; }"""

# T17: what the operator actually READS. `text-transform` is applied when the browser paints and
# leaves textContent untouched, so "the identifier is in the DOM" proves nothing about the sentence
# on screen — the painted string is textContent put through the computed transform.
SURFACE_PAINT = """(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el), t = el.textContent || '', tr = cs.textTransform;
  const painted = tr === 'uppercase' ? t.toUpperCase()
                : tr === 'lowercase' ? t.toLowerCase()
                : tr === 'capitalize' ? t.replace(/(^|\\s)(\\S)/g, (m,a,b)=>a+b.toUpperCase())
                : t;
  const r = el.getBoundingClientRect();
  return {text:t, painted, transform:tr, spacing:cs.letterSpacing,
          lines:el.getClientRects().length, w:Math.round(r.width), h:Math.round(r.height)}; }"""

# T17's pixel control: paint the SAME element three ways and compare the rasters — as the stylesheet
# leaves it, forced `none`, forced `uppercase`. A separate clone was tried first and is wrong here: a
# clone sits at a different fractional y, so glyph antialiasing alone reported a 26% delta for the
# timeline note whose transform was already `none`. One element at one position has no such artifact,
# and `style.textTransform=''` hands the note back to the stylesheet afterwards.
FORCE_TRANSFORM = """([sel, tt]) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  el.style.textTransform = tt;
  const r = el.getBoundingClientRect();
  return {w: Math.round(r.width), h: Math.round(r.height), transform: getComputedStyle(el).textTransform}; }"""

TOKEN = ""
FINDINGS: list[dict] = []
PASSES: list[dict] = []
# The archive-free state of the per-session views, measured by T15 before it plants (see T16).
PRE_ARCHIVE: dict = {}
# The session that exists ONLY in the archived day T15 plants — T16's subject.
GHOST = "audit-ghost"
# What the timeline panel says for a session with no history ANYWHERE. True then; it was rendered
# for an archive-only session too until TMUX-130, which is the wrong half T16 pins.
NEVER_OBSERVED = "spawned before tmux-agent existed"
# T17: the case-sensitive things archivedWindowNote() tells the operator to go look at.
# The note is the only wording on this dashboard that names a directory, a verb, an HTTP route and
# two JSON keys, so a paint that changes case does not merely shout — it sends the reader to
# /API/HEALTH and ARCHIVEFILES, which are not the route and not the keys.
NOTE_IDENTIFIERS = ["ledger/archive", "doctor", "/api/health", "archiveFiles", "archiveBytes"]
# The three SHORT labels that are designed to inherit the heading treatment — matched by prefix.
# They are the control for "the transform was reset on the note, not on every h2 on the page".
DESIGNED_LABELS = ["(from ledger", "(state durations", "(pane process tree"]

# T15/T16 asked "is the note rendered beside its heading". TMUX-131 moved the two long notes OUT of
# the <h2> (a heading cannot both shout its panel name and carry a 217-char sentence — see T17), so
# that question now has two legal shapes: inside the heading's own box, or the block immediately
# under it and left-aligned with it. This helper accepts either and still fails if the note is
# rendered anywhere else, which is the property those two checks were written to hold. Shared by
# both so the two checks cannot drift apart.
NOTE_GEOMETRY = """
  const headingOf=(n)=>n.closest('h2')||(n.previousElementSibling&&n.previousElementSibling.tagName==='H2'
    ? n.previousElementSibling : null);
  const besideHeading=(n,h)=>{ if(!h) return false;
    const nb=n.getBoundingClientRect(), hb=h.getBoundingClientRect();
    return (nb.top>=hb.top-1 && nb.bottom<=hb.bottom+1)
        || (nb.top>=hb.bottom-1 && nb.top-hb.bottom<=12 && Math.abs(nb.left-hb.left)<=1); };
"""


def redact(s: object) -> str:
    return str(s).replace(TOKEN, "<token>") if TOKEN else str(s)


def finding(sev: str, what: str, detail: str) -> None:
    FINDINGS.append({"sev": sev, "what": what, "detail": redact(detail)})
    print(f"[FINDING/{sev}] {what}: {redact(detail)}")


def ok(what: str, detail: str = "") -> None:
    PASSES.append({"what": what, "detail": redact(detail)})
    print(f"[pass] {what}" + (f" — {redact(detail)}" if detail else ""))


def shot(pg, name: str) -> None:
    pg.screenshot(path=str(OUT / name), full_page=False)


def cli(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "TMUX_AGENT_HOME": str(HOME)}
    return subprocess.run(
        ["node", "dist/bin/tmux-agent.js", "--socket", SOCKET, "--actor", "browser-audit", *args],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=120,
    )


def kill_server(sock: str) -> None:
    """Tear the isolated tmux server down through test/helpers/kill-server.sh — kill-server, then WAIT until tmux
    itself says there is no server on the name, then unlink the socket file tmux leaves behind — and print the
    script's one-line report (`removed <path>` | `no-op <path>`). One implementation for every spawner: the unit
    files reach it through killServerSync(), both shell smokes source it as ta_kill_server; the bare
    `tmux -L <sock> kill-server` this replaces left one dead ta-audit-<pid> socket file in /tmp/tmux-<uid> per run
    (TMUX-182). A bound overrun is loud on stderr with the file left in place — a server that still answers is not
    one whose socket may be removed — and does not change this run's verdict, as the smokes' `|| true` does not."""
    try:
        r = subprocess.run(["bash", str(REPO / "test/helpers/kill-server.sh"), sock], capture_output=True, text=True, timeout=15)
    except subprocess.TimeoutExpired:
        print(f"  teardown: kill-server.sh did not return within 15 s for {sock} — its socket file may remain", file=sys.stderr)
        return
    print(f"  teardown: {r.stdout.strip() or f'kill-server.sh exit {r.returncode} with no report'}")
    if r.returncode:
        print(f"  teardown: {r.stderr.strip()}", file=sys.stderr)


def sh(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def pane_of(session: str) -> str:
    return sh(f"tmux -L {SOCKET} capture-pane -p -t ={session}:").stdout


def provision() -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    # the read-only policy is half of what T10 verifies (UI disable + server refusal)
    (HOME / "policy.json").write_text(json.dumps({"surfaces": {"web": {"readOnly": True}}}))

    for name, (parent, task, _) in FIXTURE.items():
        r = cli("spawn", name, "--cwd", "/tmp", "--parent", parent, "--task", task)
        if r.returncode != 0:
            raise RuntimeError(f"fixture spawn {name} failed: {redact(r.stderr.strip()[:200])}")
    cli("spawn", ENDED, "--cwd", "/tmp", "--parent", "audit-root", "--task", "already done")
    cli("kill", ENDED)

    # a pane tail matching a confirmation prompt classifies BLOCKED (profile regex, not CPU) —
    # sent through the audited path so the session also reads as driven, not orphaned
    r = cli("send", BLOCKED, "echo 'Approve? should I proceed (y/n)'")
    if r.returncode != 0:
        raise RuntimeError(f"fixture send failed: {redact(r.stderr.strip()[:200])}")

    # a WORKING Claude Code pane whose status line draws the context figure as a bar. The
    # `esc to interrupt` is what the claude-code profile claims the pane on, and contextPct is read only
    # from the profile that classified the pane (Monitor.inspect / peekProfiles) — an idle pane is claimed
    # by no profile and its bar is never read, which is TMUX-236's card, not T18's. T18 asserts the row's badge.
    r = cli("send", CTX_PRESSURE, "echo 'Thinking... (esc to interrupt) | ctx:[#######---]71% | tools 41'")
    if r.returncode != 0:
        raise RuntimeError(f"fixture send failed: {redact(r.stderr.strip()[:200])}")

    # verdict/role enrichment is written by a census/supervisor as session.meta ledger events;
    # there is no CLI for it by design, so the fixture appends what a supervisor would
    ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    ledger = HOME / "ledger" / f"events-{ts[:10]}.ndjson"
    with ledger.open("a") as f:
        for name, (parent, task, verdict) in {**FIXTURE, ENDED: ("audit-root", "done", "KEEP")}.items():
            f.write(json.dumps({
                "v": 1, "ts": ts, "type": "session.meta", "session": name, "actor": "browser-audit",
                "data": {"role": task, "verdict": verdict, "why": "audit fixture", "source": "fixture",
                         "parent": parent},
            }) + "\n")


def api_fleet(pg) -> dict:
    return pg.evaluate("fetch('/api/fleet').then(r=>r.json())")


def api_history(pg):
    return pg.evaluate("fetch('/api/history').then(r=>r.json())")


def history_note(pg):
    """The archived-window note /api/history carries, or None — including when the payload is the
    pre-TMUX-130 bare ARRAY, which has no key a note could ride and must read as "no note", not as a
    crash in the middle of a check."""
    h = api_history(pg)
    return (h.get("notes") or [None])[0] if isinstance(h, dict) else None


def timeline_of(pg, session: str) -> str:
    """The timeline panel's rendered text for `session`, opened through the UI's OWN delegated
    pick() path (the same entry a tree click uses) so the check reads what a human would see. Any
    name is legal here: an archive-only session has no tree row to click, and that is the case
    TMUX-130 exists for.

    Waits on the panel BELONGING to `session` and being non-empty, not on a selector: `#tl` and its
    rows survive from the previously selected session until detail() replaces #detail's innerHTML, so
    `wait_for_selector('#tl .row')` returned instantly and this read `''` — measured on the parent
    8f56d8c run, where it manufactured two bogus problems. The detail heading names the session, so
    it is the discriminator; both timeline branches (bars, or a note) always render text."""
    pg.evaluate(f"window.pick({json.dumps(session)})")
    js = (
        "() => { const h=document.querySelector('#detail h2'), t=document.querySelector('#tl');"
        f" if(!h||!t||!h.textContent.startsWith({json.dumps(session)})) return null;"
        " return t.textContent.trim() || null; }"
    )
    return wait_for(lambda: pg.evaluate(js), 15, f"{session}'s own timeline panel to render")


def png_pixels(data: bytes) -> tuple[int, int, int, bytes]:
    """Decode a non-interlaced 8-bit RGB/RGBA PNG — what a Chromium element screenshot is — into
    (width, height, bytes-per-pixel, unfiltered rows) using only the standard library.

    Why not Pillow/numpy: this audit's one dependency is playwright (CI installs exactly that), and
    a pixel control that CI cannot run is not a control. Anything other than 8-bit non-interlaced
    RGB/RGBA raises, so a surprise encoding is a reported error, never a silent pass.
    """
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, w, h, bpp = 8, bytearray(), 0, 0, 0
    while pos + 8 <= len(data):
        ln = int.from_bytes(data[pos:pos + 4], "big")
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        pos += 12 + ln  # length + type + data + crc
        if typ == b"IHDR":
            w = int.from_bytes(body[0:4], "big")
            h = int.from_bytes(body[4:8], "big")
            depth, color, interlace = body[8], body[9], body[12]
            if depth != 8 or color not in (2, 6) or interlace != 0:
                raise ValueError(f"unsupported PNG: depth={depth} color={color} interlace={interlace}")
            bpp = 3 if color == 2 else 4
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
    if not w or not h:
        raise ValueError("PNG had no IHDR")
    raw, stride, out = zlib.decompress(bytes(idat)), w * bpp, bytearray()
    prev, i = bytearray(stride), 0
    for _ in range(h):
        ft, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        if ft == 1:  # Sub
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif ft == 2:  # Up
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ft == 3:  # Average
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + prev[x]) >> 1)) & 0xFF
        elif ft == 4:  # Paeth
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b_ = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b_ - c
                pa, pb, pc = abs(p - a), abs(p - b_), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b_ if pb <= pc else c)) & 0xFF
        elif ft != 0:
            raise ValueError(f"unsupported PNG row filter {ft}")
        out += line
        prev = line
    return w, h, bpp, bytes(out)


def pixel_diff(a: bytes, b: bytes) -> dict:
    """Compare two screenshots pixel by pixel over their common box (RGB only; alpha is opaque in
    both). The threshold matches the probe that filed TMUX-131: a summed RGB distance over 12 is a
    different glyph, not antialiasing noise."""
    aw, ah, abpp, ap = png_pixels(a)
    bw, bh, bbpp, bp = png_pixels(b)
    w, h, differing = min(aw, bw), min(ah, bh), 0
    for y in range(h):
        arow, brow = y * aw * abpp, y * bw * bbpp
        for x in range(w):
            p, q = arow + x * abpp, brow + x * bbpp
            if abs(ap[p] - bp[q]) + abs(ap[p + 1] - bp[q + 1]) + abs(ap[p + 2] - bp[q + 2]) > 12:
                differing += 1
    compared = w * h
    return {"a_px": [aw, ah], "b_px": [bw, bh], "compared": compared, "differing": differing,
            "pct": round(differing / compared * 100, 2) if compared else 100.0}


def wait_for(pred, timeout: float, what: str):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = pred()
        if last:
            return last
        time.sleep(1.0)
    raise TimeoutError(f"timed out waiting for {what} (last={redact(last)})")


def run_checks(pg, b) -> None:
    console_msgs: list[str] = []
    failed_reqs: list[str] = []
    pg.on("console", lambda m: console_msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("requestfailed", lambda r: failed_reqs.append(f"{r.url} -> {r.failure}"))

    # ---- T0: auth negative — no token must be refused ----
    try:
        anon = b.new_context().new_page()
        resp = anon.goto(BASE + "/", wait_until="domcontentloaded")
        if resp.status == 401:
            ok("T0 auth", "tokenless request refused with 401")
        else:
            finding("HIGH", "T0 auth", f"tokenless GET / returned {resp.status}, expected 401")
        anon.context.close()
    except Exception as e:
        finding("MED", "T0 auth test errored", str(e))

    # ---- T1: load + first render — every served session is rendered (arithmetic) ----
    pg.goto(f"{BASE}/?token={TOKEN}")
    pg.wait_for_selector(".node", timeout=20000)
    time.sleep(3)  # let the second poll settle engagement + meta
    served = len(api_fleet(pg)["sessions"])
    rows = pg.locator("#tree .node").count()
    if rows == served and rows >= len(FIXTURE):
        ok("T1 fleet renders", f"{rows} nodes == {served} served sessions")
    else:
        finding("HIGH", "T1 fleet render", f"dom={rows} served={served} fixture={len(FIXTURE)}")
    shot(pg, "01-fleet.png")

    # ---- T2: enrichment visible — verdict badge per metaed session, engagement per node ----
    vd = pg.locator("#tree .vd").count()
    eng = pg.locator("#tree .eng").count()
    (ok if vd == len(FIXTURE) else lambda *a: finding("HIGH", *a))("T2 verdict badges", f"{vd} .vd badges (fixture sets {len(FIXTURE)})")
    (ok if eng == rows else lambda *a: finding("MED", *a))("T2 engagement badges", f"{eng} .eng badges for {rows} nodes")

    # ---- T3: attention banner — the fixture guarantees one BLOCKED session ----
    try:
        # BLOCKED needs pane text, and fleetFast deliberately has none (that is what keeps the
        # fleet poll O(1)); a session is deep-classified only after someone inspects it. Do what
        # an operator does — open the session once — then the fleet poll carries its real state.
        pg.evaluate(f"fetch('/api/session/{BLOCKED}').then(r=>r.json())")
        wait_for(lambda: any(s["session"] == BLOCKED and s.get("state") == "BLOCKED"
                             for s in api_fleet(pg)["sessions"]),
                 30, f"{BLOCKED} to classify BLOCKED")
        fleet = api_fleet(pg)
        bad = [s["session"] for s in fleet["sessions"] if s.get("state") in ("ERROR", "BLOCKED")]
        pg.click("#refreshnow")
        time.sleep(1.0)
        attn_text = pg.locator("#attn").inner_text().strip()
        attn_visible = pg.locator("#attn").is_visible() and len(attn_text) > 0
        if bad and attn_visible and BLOCKED in attn_text:
            ok("T3 attention banner", f"BLOCKED={bad} surfaced in banner")
        else:
            finding("HIGH", "T3 attention banner", f"API bad={bad} banner visible={attn_visible} text={attn_text[:80]!r}")
    except Exception as e:
        finding("MED", "T3 attention test errored", str(e))

    # ---- T18: the context-pressure badge reads the status line's bar ----
    # Measured 2026-10-13 14:00Z on the live fleet: 19 of 31 panes carried `ctx:[#######---]NN%` and contextPct was
    # null on every one — claudeCodeProfile matched `ctx:(\d+)%` only — so the tree's ctx badge (ui.ts buildTree: the
    # `.ctx` span, `hot` from 80) rendered for nobody. The fixture pane is a WORKING Claude Code pane whose status
    # line reads 71 (the profile must claim the pane for its contextPct to be read at all — see provision()): the
    # row must carry the badge saying `ctx 71%`, below the hot tier, and a row whose pane has no token carries none.
    # Deep-read once first, as an operator's click would, so the check does not wait on the 30 s health tick.
    try:
        pg.evaluate(f"fetch('/api/session/{CTX_PRESSURE}').then(r=>r.json())")

        def ctx_row():
            s = next((s for s in api_fleet(pg)["sessions"] if s["session"] == CTX_PRESSURE), None)
            return s if s and s.get("contextPct") is not None else None

        try:
            row = wait_for(ctx_row, 20, f"{CTX_PRESSURE}'s /api/fleet row to carry contextPct")
        except TimeoutError:
            row = next((s for s in api_fleet(pg)["sessions"] if s["session"] == CTX_PRESSURE), None)
        pg.click("#refreshnow")
        time.sleep(1.0)
        badge = pg.evaluate("""(name) => { const n=document.querySelector('#tree .node[data-session="'+name+'"]'); if(!n) return null;
          const c=n.querySelector('.ctx'); return {text: c ? c.textContent : null, hot: !!(c && c.classList.contains('hot')),
            painted: !!(c && c.offsetWidth > 0 && c.offsetHeight > 0), count: n.querySelectorAll('.ctx').length}; }""", CTX_PRESSURE)
        control = pg.evaluate("""(name) => { const n=document.querySelector('#tree .node[data-session="'+name+'"]');
          return n ? n.querySelectorAll('.ctx').length : null; }""", "audit-root")
        api = {k: (row or {}).get(k) for k in ("state", "classifiedBy", "contextPct")}
        if (row and api["contextPct"] == 71 and api["classifiedBy"] == "claude-code" and badge and badge["text"] == "ctx 71%"
                and badge["painted"] and not badge["hot"] and badge["count"] == 1 and control == 0):
            ok("T18 context-pressure badge", f"/api/fleet row {api}; the row paints {badge['text']!r} once, below the hot tier; audit-root (no token) paints none")
        else:
            finding("HIGH", "T18 context-pressure badge",
                    f"/api/fleet row {api} (want contextPct 71 read by claude-code); badge={badge} (want text 'ctx 71%', painted once, not hot); "
                    f"audit-root .ctx count={control} (want 0)")
        shot(pg, "10-ctx-badge.png")
    except Exception as e:
        finding("MED", "T18 context-pressure badge errored", str(e))

    # ---- T4: keyboard '/' focuses filter; name and meta-verdict filtering both narrow ----
    try:
        pg.keyboard.press("/")
        focused = pg.evaluate("document.activeElement && document.activeElement.id")
        if focused == "q":
            ok("T4 '/' focuses filter")
        else:
            finding("MED", "T4 '/' key", f"active element is {focused!r}, not #q")
        pg.fill("#q", "audit-child-a")
        time.sleep(0.6)
        filtered = pg.locator("#tree .node").count()
        if filtered == 1:
            ok("T4 filter narrows", f"'audit-child-a' -> {filtered} node")
        else:
            finding("HIGH", "T4 filter", f"'audit-child-a' -> {filtered} nodes, expected 1")
        shot(pg, "02-filter.png")
        pg.fill("#q", "KEEP-CRITICAL")
        time.sleep(0.6)
        byverdict = pg.locator("#tree .node").count()
        if byverdict == 1:
            ok("T4 filter matches meta", f"'KEEP-CRITICAL' -> {byverdict} node (audit-root)")
        else:
            finding("MED", "T4 meta filter", f"'KEEP-CRITICAL' -> {byverdict} nodes — meta fields not searchable")
        pg.fill("#q", "")
        time.sleep(0.6)
    except Exception as e:
        finding("HIGH", "T4 filter errored", str(e))

    # ---- T5: state-chip toggles actually filter ----
    try:
        # fresh spawns read UNKNOWN until the CPU tracker has two samples; the chips only cover
        # the five steady states, so wait until the whole fixture has settled into them
        chip_states = ("WORKING", "IDLE", "BLOCKED", "ERROR", "DEAD")
        wait_for(lambda: all(s.get("state") in chip_states for s in api_fleet(pg)["sessions"]),
                 30, "all fixture sessions in a chip state")
        pg.click("#refreshnow")
        time.sleep(1.0)
        before = pg.locator("#tree .node").count()
        for st in chip_states:
            pg.click(f'.chip[data-state="{st}"]')  # turn ALL off
        time.sleep(0.6)
        after_alloff = pg.locator("#tree .node").count()
        for st in chip_states:
            pg.click(f'.chip[data-state="{st}"]')  # back on
        time.sleep(0.6)
        restored = pg.locator("#tree .node").count()
        if after_alloff == 0 and restored == before:
            ok("T5 state chips", f"all-off -> 0 nodes, restore -> {restored}")
        else:
            finding("MED", "T5 state chips", f"before={before} alloff={after_alloff} restored={restored}")
    except Exception as e:
        finding("MED", "T5 chips errored", str(e))

    # ---- T6: keyboard-only j/k/Enter navigation ----
    try:
        # pause the 5s poll: it fetches /api/session for the current selection, which would
        # false-positive the traversal-economy count below (selection must be FREE; only Enter pays)
        pg.click("#autorefresh")
        pg.click("body")  # blur controls so keys reach the nav handler
        api_calls: list[str] = []
        pg.on("request", lambda r: api_calls.append(r.url) if "/api/session/" in r.url else None)
        pg.keyboard.press("j"); pg.keyboard.press("j"); pg.keyboard.press("k")
        nav_only = len(api_calls)  # calls fired by traversal itself, before Enter
        sel = pg.evaluate("(document.querySelector('#tree .node.sel')||{}).dataset?.session || null")
        aria = pg.locator('#tree .node[aria-selected="true"]').count()
        if sel and aria == 1:
            ok("T6 j/k selection", f"selected={sel}, aria-selected present")
        else:
            finding("HIGH", "T6 j/k", f"sel={sel!r} aria-selected count={aria}")
        pg.keyboard.press("Enter")
        time.sleep(2.5)
        dt = pg.locator("#detail h2").first.inner_text()
        if sel and sel.split()[0].upper() in dt.upper():
            ok("T6 Enter opens detail", f"panel shows {dt.split()[0]}")
        else:
            finding("HIGH", "T6 Enter", f"detail h2={dt!r} for sel={sel!r}")
        # nav_only==0 is only meaningful if the listener provably fires, so require Enter's fetch
        if nav_only == 0 and len(api_calls) > 0:
            ok("T6 nav API economy", f"j/k fired 0 /api/session calls; Enter fired {len(api_calls)}")
        else:
            finding("MED", "T6 nav spams API", f"3 traversal presses fired {nav_only} /api/session calls (total {len(api_calls)}); moving selection must be free")
        pg.click("#autorefresh")  # poll back on
    except Exception as e:
        finding("HIGH", "T6 keyboard nav errored", str(e))

    # ---- T7: detail panel — meta rows + timeline render ----
    try:
        pg.click('#tree .node[data-session="audit-root"]')
        time.sleep(2.0)
        kv = pg.locator("#detail .kv").inner_text()
        has_meta = any(k in kv.lower() for k in ("role", "verdict", "repo"))
        (ok if has_meta else lambda *a: finding("MED", *a))("T7 detail meta rows", f"kv contains meta: {has_meta}")
        pg.wait_for_selector("#tl .row, #tl .note", timeout=10000)
        spans = pg.locator("#tl .row").count()
        note = pg.locator("#tl .note").count()
        if spans > 0:
            ok("T7 timeline", f"{spans} state spans render")
        elif note > 0:
            ok("T7 timeline", "empty-state note shown (no state history yet)")
        else:
            finding("MED", "T7 timeline", "neither spans nor empty-state note rendered")
        shot(pg, "03-detail.png")
    except Exception as e:
        finding("MED", "T7 detail errored", str(e))

    # ---- T8: history table — verdict column + sortable headers flip order ----
    try:
        pg.locator("#hist").scroll_into_view_if_needed()
        hist_vd = pg.locator("#hist tbody .vd").count()
        ended = pg.locator("#hist tbody .pill.gone").count()
        want = len(FIXTURE) + 1  # + the killed session
        (ok if hist_vd == want and ended >= 1 else lambda *a: finding("MED", *a))(
            "T8 history verdicts", f"{hist_vd} verdict badges (want {want}), {ended} ended row(s)")
        first_before = pg.locator("#hist tbody tr td").first.inner_text()
        pg.click('#hist th[data-k="session"]')
        time.sleep(0.4)
        first_after = pg.locator("#hist tbody tr td").first.inner_text()
        pg.click('#hist th[data-k="session"]')  # flip again
        time.sleep(0.4)
        first_flip = pg.locator("#hist tbody tr td").first.inner_text()
        if first_after != first_flip:
            ok("T8 sortable history", f"sort flips: {first_after!r} <-> {first_flip!r}")
        else:
            finding("MED", "T8 sort", f"clicking session header twice did not change order ({first_before!r})")
        shot(pg, "04-history.png")
    except Exception as e:
        finding("MED", "T8 history errored", str(e))

    # ---- T9: refresh controls ----
    try:
        pressed0 = pg.get_attribute("#autorefresh", "aria-pressed")
        pg.click("#autorefresh")
        pressed1 = pg.get_attribute("#autorefresh", "aria-pressed")
        pg.click("#autorefresh")  # back on
        col0 = pg.get_attribute("#collapse", "aria-pressed")
        pg.click("#collapse")
        col1 = pg.get_attribute("#collapse", "aria-pressed")
        pg.click("#collapse")
        pg.click("#refreshnow")
        if pressed0 != pressed1 and col0 != col1:
            ok("T9 refresh/collapse toggles", f"aria-pressed flips ({pressed0}->{pressed1}, {col0}->{col1})")
        else:
            finding("MED", "T9 toggles", f"autorefresh {pressed0}->{pressed1}, collapse {col0}->{col1}")
    except Exception as e:
        finding("MED", "T9 controls errored", str(e))

    # ---- T10: read-only policy — UI must disable send AND the server must refuse ----
    try:
        pg.fill("#q", SEND_TARGET)
        time.sleep(1.0)
        pg.click(f'#tree .node[data-session="{SEND_TARGET}"]', timeout=10000)
        pg.wait_for_selector("#cmd", timeout=8000)
        disabled = pg.get_attribute("#cmd", "disabled")
        ph = pg.get_attribute("#cmd", "placeholder") or ""
        if disabled is not None and "read-only" in ph:
            ok("T10a UI honors read-only", f"input disabled, placeholder explains: {ph!r}")
        else:
            finding("HIGH", "T10a read-only UI", f"disabled={disabled!r} placeholder={ph!r}")
        # defense in depth: a forged same-origin POST must be refused SERVER-side
        resp = pg.evaluate("""(body) => fetch('/api/send', {method:'POST', headers:{'content-type':'application/json'}, body})
            .then(r=>r.text().then(t=>({status:r.status, body:t.slice(0,120)})))""",
            json.dumps({"name": SEND_TARGET, "text": f"echo {MARKER}"}))
        time.sleep(4)
        cap = pane_of(SEND_TARGET)
        if resp["status"] >= 400 and MARKER not in cap:
            ok("T10b server refuses send in read-only", f"POST /api/send -> {resp['status']}, pane untouched")
        elif MARKER in cap:
            finding("CRITICAL", "T10b read-only bypass", f"POST /api/send returned {resp['status']} and the text REACHED the pane despite web.readOnly=true")
        else:
            finding("HIGH", "T10b read-only server", f"POST /api/send -> {resp['status']} {resp['body']!r} (expected >=400)")
        shot(pg, "05-send.png")
        pg.fill("#q", "")
    except Exception as e:
        finding("HIGH", "T10 send errored", str(e))

    # ---- T15: Top waste says when the window it ranked was truncated ----
    # The panel ranks LIVE ledger days only (TMUX-90's rule, unchanged), so a home with archived
    # history was ranked over a truncated window. Measured absent-then-present on ONE page: the
    # fixture home starts with no archive, then one archived day is planted UNDER the running server,
    # so a note that is always there fails the first half and one that never comes fails the second.
    # Runs BEFORE T11/T13 on purpose — the rendered note must be in the DOM when contrast is
    # recomputed, in both themes.
    try:
        before = api_fleet(pg)
        box = pg.evaluate("() => {" + NOTE_GEOMETRY + """const n=document.querySelector('#wastenote'), w=document.querySelector('#waste');
          const h2=n&&headingOf(n), mem=[...document.querySelectorAll('h2')].find(e=>e.textContent.startsWith('Top memory'));
          return n ? {w:n.offsetWidth, h:n.offsetHeight, text:n.textContent,
                      h2h:h2.getBoundingClientRect().height, memh:mem.getBoundingClientRect().height,
                      rows:w.tBodies[0].rows.length} : null; }""")
        rows_before = box and box["rows"]
        # T16 needs the ARCHIVE-FREE state of the two per-session views, and the plant
        # below is a one-way door for this page: from then on every note surface on this home is
        # non-empty. So T16's "absent" half is measured in the same pre-plant instant as T15's, here.
        PRE_ARCHIVE["history"] = api_history(pg)
        PRE_ARCHIVE["hist_box"] = pg.evaluate("() => {" + NOTE_GEOMETRY + """const n=document.querySelector('#histnote'), t=document.querySelector('#hist');
          const h2=n&&headingOf(n), mem=[...document.querySelectorAll('h2')].find(e=>e.textContent.startsWith('Top memory'));
          return n ? {w:n.offsetWidth, h:n.offsetHeight, text:n.textContent,
                      h2h:h2.getBoundingClientRect().height, memh:mem.getBoundingClientRect().height,
                      rows:t.tBodies[0].rows.length} : null; }""")
        # the TRUE sentence, for a session with no history anywhere — pinned so a fix cannot delete it
        PRE_ARCHIVE["ghost_tl"] = timeline_of(pg, GHOST)
        timeline_of(pg, "audit-root")  # hand the detail pane back the way T7 left it
        # plant one archived day exactly as a retention sweep leaves it; never read back by the server
        day = "2026-08-04"
        arch = HOME / "ledger" / "archive"
        arch.mkdir(parents=True, exist_ok=True)
        ghost = json.dumps({"v": 1, "ts": f"{day}T04:00:01.000Z", "type": "control.denied",
                            "session": GHOST, "actor": "browser-audit",
                            "data": {"action": "kill", "reason": "audit fixture"}}) + "\n"
        (arch / f"events-{day}.ndjson.gz").write_bytes(gzip.compress(ghost.encode()))

        pg.click("#refreshnow")
        served = wait_for(lambda: (api_fleet(pg).get("notes") or [None])[0], 15, "/api/fleet to carry an archived-window note")
        after = wait_for(lambda: pg.evaluate("() => {" + NOTE_GEOMETRY + """const n=document.querySelector('#wastenote'), w=document.querySelector('#waste');
          const t=n.textContent.trim(); if(!t) return null;
          return {text:n.textContent, beside: besideHeading(n, headingOf(n)), rows:w.tBodies[0].rows.length}; }""") or None,
            15, "the Top waste panel to render the note")

        problems = []
        if before.get("notes") != []:
            problems.append(f"notes was {before.get('notes')!r} before any archive existed")
        if box is None:
            problems.append("#wastenote does not exist — the panel has no element a note could land in")
        else:
            if box["text"] or box["w"] or box["h"]:
                problems.append(f"the empty note rendered a box: text={box['text']!r} {box['w']}x{box['h']}px")
            if abs(box["h2h"] - box["memh"]) > 0.5:
                problems.append(f"the empty note changed the heading's height ({box['h2h']} vs Top memory's {box['memh']}) — a layout shift")
        if after["text"] != served:
            problems.append(f"the panel re-worded the server's note: {after['text']!r} vs {served!r}")
        if day not in after["text"]:
            problems.append(f"the note does not date the day it excluded: {after['text']!r}")
        if not after["beside"]:
            problems.append("the note is not rendered beside the Top waste heading")
        if after["rows"] != rows_before:
            problems.append(f"the ranking itself changed with the note ({rows_before} -> {after['rows']} rows)")
        if problems:
            finding("HIGH", "T15 truncated-window note", "; ".join(problems))
        else:
            ok("T15 truncated-window note",
               f"no archive: notes [] and #wastenote 0x0 with the heading the same height as Top memory's; after planting {day}: "
               f"the server's exact note rendered beside the heading, {rows_before} ranked rows unchanged")
        shot(pg, "07-waste-note.png")
    except Exception as e:
        finding("MED", "T15 truncated-window note errored", str(e))

    # ---- T16: the PER-SESSION views say so too — and stop claiming the session was never seen
    # ----
    # Workstream history lists the sessions in the LIVE ledger days, so an archived day means rows
    # are missing from a panel whose own subtitle claims "from ledger — live + decommissioned"; and
    # the timeline of a session whose whole life is archived rendered "…sessions spawned before
    # tmux-agent existed have none", which is false twice over for a session this tool observed and
    # whose history its own retention sweep gzipped. Both halves are measured on ONE page:
    # the archive-free state came from T15's pre-plant instant, this is the same page after.
    # Runs before T11/T13 for the same reason T15 does — the rendered note must be in the DOM when
    # contrast is recomputed, in both themes.
    try:
        problems: list[str] = []

        def attempt(fn, what):
            """Wait for a property, but turn a timeout into a REPORTED gap: a missing note is a HIGH
            finding naming what is absent, never an exception that hides the other halves."""
            try:
                return wait_for(fn, 15, what)
            except TimeoutError as e:
                problems.append(str(e))
                return None

        served = attempt(lambda: history_note(pg), "/api/history to carry an archived-window note")
        after = attempt(lambda: pg.evaluate("() => {" + NOTE_GEOMETRY + """const n=document.querySelector('#histnote'), t=document.querySelector('#hist');
          const s=n&&n.textContent.trim(); if(!s) return null;
          return {text:n.textContent, beside: besideHeading(n, headingOf(n)), rows:t.tBodies[0].rows.length}; }""") or None,
            "the Workstream history panel to render the note")
        ghost_after = timeline_of(pg, GHOST)

        pre, box2 = PRE_ARCHIVE.get("history"), PRE_ARCHIVE.get("hist_box")
        if not isinstance(pre, dict) or "notes" not in pre or "sessions" not in pre:
            problems.append(f"/api/history is not the {{sessions, notes}} envelope before any archive existed: {str(pre)[:120]}")
        elif pre["notes"] != []:
            problems.append(f"/api/history.notes was {pre['notes']!r} before any archive existed")
        if box2 is None:
            problems.append("#histnote does not exist — the history panel has no element a note could land in")
        else:
            if box2["text"] or box2["w"] or box2["h"]:
                problems.append(f"the empty note rendered a box: text={box2['text']!r} {box2['w']}x{box2['h']}px")
            if abs(box2["h2h"] - box2["memh"]) > 0.5:
                problems.append(f"the empty note changed the heading's height ({box2['h2h']} vs Top memory's {box2['memh']}) — a layout shift")
        if NEVER_OBSERVED not in (PRE_ARCHIVE.get("ghost_tl") or ""):
            problems.append(f"the honest empty timeline lost its sentence: {str(PRE_ARCHIVE.get('ghost_tl'))[:140]!r}")
        if after:
            if after["text"] != served:
                problems.append(f"the panel re-worded the server's note: {after['text']!r} vs {served!r}")
            if day not in after["text"]:
                problems.append(f"the note does not date the day it excluded: {after['text']!r}")
            if not after["beside"]:
                problems.append("the note is not rendered beside the Workstream history heading")
            if box2 and after["rows"] != box2["rows"]:
                problems.append(f"the history table itself changed with the note ({box2['rows']} -> {after['rows']} rows)")
        if served is None or served not in ghost_after:
            problems.append(f"the archive-only session's timeline does not carry the note: {ghost_after[:140]!r}")
        if NEVER_OBSERVED in ghost_after:
            problems.append(f"the archive-only session is still told it was never observed: {ghost_after[:140]!r}")
        if problems:
            finding("HIGH", "T16 per-session archived-history note", "; ".join(problems))
        else:
            ok("T16 per-session archived-history note",
               f"no archive: /api/history.notes [] and #histnote 0x0 with the heading the same height as Top memory's, and {GHOST}'s "
               f"timeline honestly {NEVER_OBSERVED!r}; after planting {day}: the server's exact note beside the Workstream history "
               f"heading with {after['rows']} rows unchanged, and {GHOST}'s timeline carrying it instead of the false sentence")
        shot(pg, "08-history-note.png")
        timeline_of(pg, "audit-root")  # hand the detail pane back the way T7 left it
    except Exception as e:
        finding("MED", "T16 per-session archived-history note errored", str(e))

    # ---- T11: WCAG contrast — independently recompute the TMUX-31 claim ----
    try:
        results = pg.evaluate(CONTRAST_SAMPLER)
        fails = [r for r in results if r["ratio"] < r["need"]]
        if results and not fails:
            ok("T11 WCAG AA contrast", f"{len(results)} distinct text styles all >= required ratio")
        elif not results:
            finding("MED", "T11 contrast", "no text styles sampled — selectors found nothing")
        else:
            worst = sorted(fails, key=lambda r: r["ratio"])[:6]
            finding("MED", "T11 contrast below AA", json.dumps(worst))
    except Exception as e:
        finding("MED", "T11 contrast errored", str(e))

    # ---- T13: theme toggle — flips, stays AA-readable, survives reload ----
    # runs before the T12 hygiene snapshot so a toggle that throws or refires requests is caught
    try:
        pg.click("#theme")
        theme = pg.evaluate("document.documentElement.dataset.theme")
        stored = pg.evaluate("localStorage.getItem('tmux-agent.theme')")
        pressed = pg.get_attribute("#theme", "aria-pressed")
        if theme == "light" and stored == "light" and pressed == "true":
            ok("T13a theme toggle", "click -> data-theme=light, stored, aria-pressed=true")
        else:
            finding("HIGH", "T13a theme toggle", f"theme={theme!r} stored={stored!r} aria-pressed={pressed!r}")
        shot(pg, "06-light-theme.png")
        results = pg.evaluate(CONTRAST_SAMPLER)
        fails = [r for r in results if r["ratio"] < r["need"]]
        if results and not fails:
            ok("T13b light-theme contrast", f"{len(results)} distinct text styles all >= required ratio")
        else:
            worst = sorted(fails, key=lambda r: r["ratio"])[:6]
            finding("MED", "T13b light-theme contrast below AA", json.dumps(worst) if fails else "no styles sampled")
        pg.reload(wait_until="domcontentloaded")
        pg.wait_for_selector(".node", timeout=20000)
        after = pg.evaluate("document.documentElement.dataset.theme")
        pg.click("#theme")  # restore the dark default so later checks see the shipped baseline
        back = pg.evaluate("document.documentElement.dataset.theme")
        if after == "light" and back == "dark":
            ok("T13c theme persists", "light survives reload; toggling back restores dark")
        else:
            finding("MED", "T13c theme persistence", f"after-reload={after!r} after-toggle-back={back!r}")
    except Exception as e:
        finding("MED", "T13 theme errored", str(e))

    # ---- T14: host vitals strip (TMUX-52 / H1) — renders and agrees with /api/health ----
    try:
        health = pg.evaluate("fetch('/api/health').then(r=>r.json())")
        wait_for(lambda: pg.locator("#vitals .vt").count() >= 4, 15, "vitals strip to render")
        strip = pg.locator("#vitals").inner_text()
        tiles = pg.locator("#vitals .vt").count()
        mode_ok = health.get("mode") in ("proc", "os-only") and health["mode"] in strip
        labels_ok = all(k in strip for k in ("mem", "swap", "disk", "load"))
        if tiles >= 4 and labels_ok and mode_ok and health["mem"]["totalBytes"] > 0:
            ok("T14 vitals strip", f"{tiles} tiles, mode={health['mode']}, mem/swap/disk/load all present")
        else:
            finding("HIGH", "T14 vitals strip", f"tiles={tiles} labels_ok={labels_ok} mode={health.get('mode')!r} strip={strip[:80]!r}")
    except Exception as e:
        finding("MED", "T14 vitals errored", str(e))

    # ---- T17: that note is READ, not SHOUTED ----
    # archivedWindowNote() is the only wording on this dashboard that names a directory, a verb, an
    # HTTP route and two JSON keys, and two of its three surfaces sat INSIDE an <h2> whose uppercase
    # + letter-spacing the browser applies at PAINT time: the operator was sent to /API/HEALTH and
    # ARCHIVEFILES, which are not the route and not the keys. `text-transform` never touches
    # textContent, so the string a reader sees is textContent put through the computed transform —
    # that is what is asserted, with a pixel control beside it because a WIDTH test cannot see a case
    # change in this page's monospace font (two spans holding the same mixed-case string measured
    # 615px and 615px: the false negative the probe filing this card discarded).
    try:
        problems, measured = [], {}
        timeline_of(pg, GHOST)  # the third surface: the timeline of the archive-only session
        surfaces = [("Top waste heading", "#wastenote"),
                    ("Workstream history heading", "#histnote"),
                    ("Timeline panel", "#tl p.note")]
        for what, sel in surfaces:
            m = pg.evaluate(SURFACE_PAINT, sel)
            if not m or not m["text"].strip():
                problems.append(f"{what}: no rendered note at {sel}")
                continue
            if m["transform"] != "none":
                problems.append(f"{what}: text-transform is {m['transform']!r}, not 'none'")
            if m["spacing"] != "normal":
                problems.append(f"{what}: letter-spacing is {m['spacing']!r}, not 'normal'")
            lost = [i for i in NOTE_IDENTIFIERS if i not in m["painted"]]
            if lost:
                problems.append(f"{what}: {len(lost)} of {len(NOTE_IDENTIFIERS)} identifiers destroyed in the "
                                f"paint ({', '.join(lost)} -> not in {m['painted'][-90:]!r})")
            # pixel control, on the raster rather than the computed value: the note as the stylesheet
            # paints it must match itself forced to `none` (what it says it is), and must NOT match
            # itself forced to `uppercase` — that second half is the positive control, because a
            # measurement that cannot see a case change proves nothing by agreeing (the width test
            # this replaces answered 1711px = 1711px in this monospace font and was blind).
            asis = pg.locator(sel).screenshot()
            pg.evaluate(FORCE_TRANSFORM, [sel, "none"])
            honest = pg.locator(sel).screenshot()
            pg.evaluate(FORCE_TRANSFORM, [sel, "uppercase"])
            shouted = pg.locator(sel).screenshot()
            pg.evaluate(FORCE_TRANSFORM, [sel, ""])  # back to the stylesheet's own value
            d, d_up = pixel_diff(asis, honest), pixel_diff(asis, shouted)
            measured[what] = {"transform": m["transform"], "spacing": m["spacing"], "lines": m["lines"],
                              "box": [m["w"], m["h"]], "vs_none": d, "vs_uppercase": d_up}
            if d["pct"] >= 1.0:
                problems.append(f"{what}: the paint differs from the same note forced to text-transform:none in "
                                f"{d['differing']} of {d['compared']} px ({d['pct']}%) at {d['a_px']}")
            if d_up["pct"] <= 1.0:
                problems.append(f"{what}: forcing uppercase changed only {d_up['pct']}% of the pixels — the note is "
                                f"already painted in a case it does not hold, or the measurement is blind")
        # the note must not inflate the heading it explains (it was 70px against Top memory's 17px)
        heads = pg.evaluate("""() => { const hs=[...document.querySelectorAll('h2')];
          const f=(p)=>{const e=hs.find(x=>(x.textContent||'').trim().startsWith(p));
            return e ? +e.getBoundingClientRect().height.toFixed(1) : null; };
          return {waste:f('Top waste'), hist:f('Workstream history'), mem:f('Top memory')}; }""")
        for k in ("waste", "hist"):
            if heads[k] is None or heads["mem"] is None:
                problems.append(f"heading heights unreadable: {heads}")
            elif abs(heads[k] - heads["mem"]) > 2:
                problems.append(f"the note inflated the {k} heading to {heads[k]}px against Top memory's "
                                f"{heads['mem']}px — the panel title and the note read as one sentence")
        # control: the SHORT designed labels keep the heading treatment. A blanket h2{text-transform:none}
        # would pass every assertion above and fail here.
        labels = pg.evaluate("""(needles) => needles.map(n => {
          const e=[...document.querySelectorAll('.note')].find(x=>(x.textContent||'').trim().startsWith(n));
          return {needle:n, transform: e ? getComputedStyle(e).textTransform : null}; })""", DESIGNED_LABELS)
        shouty = [l for l in labels if l["transform"] == "uppercase"]
        if len(shouty) != len(DESIGNED_LABELS):
            problems.append(f"the designed short labels lost their treatment (a blanket reset?): {labels}")
        if problems:
            finding("HIGH", "T17 archived-window note paint", "; ".join(problems))
        else:
            deltas = ", ".join("{} {}%/{}%".format(k, v["vs_none"]["pct"], v["vs_uppercase"]["pct"])
                               for k, v in measured.items())
            ok("T17 archived-window note paint",
               f"all {len(surfaces)} surfaces render it untransformed with {len(NOTE_IDENTIFIERS)}/"
               f"{len(NOTE_IDENTIFIERS)} identifiers verbatim in the painted text; pixels vs forced-none / "
               f"vs forced-uppercase ({deltas}) — matches itself, and the measurement still sees a case change; "
               f"headings {heads['waste']}/{heads['hist']}px against Top memory's {heads['mem']}px; the "
               f"{len(shouty)} designed short labels still uppercase")
        shot(pg, "09-note-paint.png")
        timeline_of(pg, "audit-root")  # hand the detail pane back the way T7 left it
    except Exception as e:
        finding("MED", "T17 note paint errored", str(e))

    # ---- T12: console + network hygiene over the whole run ----
    # T10b forges a POST that MUST 403; the browser logs that refusal as a console error by design
    errs = [m for m in console_msgs if m.startswith("error") and "403" not in m]
    if errs:
        finding("MED", "T12 console errors", "; ".join(sorted(set(errs))[:5]))
    else:
        ok("T12 zero console errors", f"({len(console_msgs)} warnings)")
    real_fails = [f for f in failed_reqs if "ERR_ABORTED" not in f]
    if real_fails:
        finding("MED", "T12 failed requests", "; ".join(sorted(set(real_fails))[:5]))
    else:
        ok("T12 zero failed requests")


def main() -> int:
    global TOKEN
    OUT.mkdir(parents=True, exist_ok=True)
    if not (REPO / "dist" / "bin" / "tmux-agent.js").exists():
        print("FATAL: dist/bin/tmux-agent.js missing — run `npm run build` first")
        return 1

    provision()
    srv = subprocess.Popen(
        ["node", "dist/bin/tmux-agent.js", "--socket", SOCKET, "--actor", "browser-audit",
         "web", "--port", str(PORT), "--strict-port"],
        cwd=REPO, env={**os.environ, "TMUX_AGENT_HOME": str(HOME)},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    # drain (and discard) the server's output: the startup banner embeds the token, and an
    # unread pipe would eventually block the server mid-audit
    threading.Thread(target=lambda: [None for _ in srv.stdout], daemon=True).start()

    try:
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                TOKEN = (HOME / "web-token").read_text().strip()
                urllib.request.urlopen(f"{BASE}/api/fleet?token={TOKEN}", timeout=5).read()
                break
            except Exception:
                time.sleep(1)
        else:
            print("FATAL: dashboard did not come up on the audit port")
            return 1

        with sync_playwright() as pw:
            b = pw.chromium.launch()
            ctx = b.new_context(viewport={"width": 1440, "height": 900})
            pg = ctx.new_page()
            run_checks(pg, b)
            b.close()
    finally:
        srv.terminate()
        for s in list(FIXTURE) + [ENDED]:
            cli("kill", s, "--force")
        kill_server(SOCKET)
        subprocess.run(["rm", "-rf", str(HOME)], capture_output=True)

    json.dump({"passes": PASSES, "findings": FINDINGS}, (OUT / "findings.json").open("w"), indent=2)
    total = len(PASSES) + len(FINDINGS)
    print(f"\nBROWSER-AUDIT: {len(PASSES)}/{total} checks passed, {len(FINDINGS)} findings -> {OUT}/findings.json")
    if total < 30:
        print(f"BROWSER-AUDIT: FATAL — only {total} checks ran (expected 30); a crashed run must not read as green")
        return 1
    return 1 if FINDINGS else 0


if __name__ == "__main__":
    sys.exit(main())
