#!/usr/bin/env python3
"""
Browser acceptance for the dashboard — real Chromium, real clicks, real screenshots.

Why this exists as a HARNESS and not a one-off script: the "I click on tmux and nothing shows"
report was diagnosed by driving a real browser, and the a11y suite that was supposed to cover the
UI passes by string-matching the HTML source. String matching cannot catch a JS exception on load,
a handler that never binds, an element rendered off-screen, or a 401 page served where a dashboard
was expected. Those are exactly the failures a user sees.

Three layers per browser-vlm-acceptance:
  1. BEHAVIOR — console + pageerror capture. A silent JS throw is invisible to curl and to the DOM.
  2. CONTENT  — DOM asserts against SERVED data (row count vs /api/fleet, not a constant).
  3. LOOKS    — screenshots archived for a human/VLM pass (this script cannot judge pixels).

Gated so the default `npm test` stays fast and dependency-free:
    SMOKE_UI=1 python3 test/ui-acceptance.py
Exits non-zero on any failed criterion; prints PASS/FAIL per criterion with its evidence.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
SHOTS = pathlib.Path(os.environ.get("UI_SHOT_DIR", "/tmp/tmux-agent-ui-acceptance"))
PORT = int(os.environ.get("UI_PORT", "7457"))  # off the live dashboard's 7337
SOCKET = f"ta-ui-{os.getpid()}"
HOME = pathlib.Path(f"/tmp/ta-ui-home-{os.getpid()}")

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, evidence: str) -> None:
    results.append((ok, name, evidence))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}\n        {evidence}")


def cli(*args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "TMUX_AGENT_HOME": str(HOME)}
    return subprocess.run(
        ["node", "dist/bin/tmux-agent.js", "--socket", SOCKET, *args],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=120,
    )


def kill_server(sock: str) -> None:
    """Tear the isolated tmux server down through test/helpers/kill-server.sh — kill-server, then WAIT until tmux
    itself says there is no server on the name, then unlink the socket file tmux leaves behind — and print the
    script's one-line report (`removed <path>` | `no-op <path>`). One implementation for every spawner: the unit
    files reach it through killServerSync(), both shell smokes source it as ta_kill_server; the bare
    `tmux -L <sock> kill-server` this replaces left one dead ta-ui-<pid> socket file in /tmp/tmux-<uid> per run
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


def main() -> int:
    if not os.environ.get("SMOKE_UI"):
        print("SMOKE_UI not set — skipping browser acceptance (set SMOKE_UI=1 to run)")
        return 0
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed — skipping (pip install playwright && playwright install chromium)")
        return 0

    SHOTS.mkdir(parents=True, exist_ok=True)
    HOME.mkdir(parents=True, exist_ok=True)
    (HOME / "policy.json").write_text(json.dumps({"surfaces": {"web": {"readOnly": True}}}))

    # a fleet worth looking at: parent + two children, one deliberately BLOCKED
    cli("spawn", "ui-parent", "--cwd", "/tmp", "--parent", "ui-test")
    cli("spawn", "ui-child-a", "--cwd", "/tmp", "--parent", "ui-parent", "--task", "child A")
    cli("spawn", "ui-child-b", "--cwd", "/tmp", "--parent", "ui-parent", "--task", "child B")

    srv = subprocess.Popen(
        ["node", "dist/bin/tmux-agent.js", "--socket", SOCKET, "--actor", "ui-acceptance",
         "web", "--port", str(PORT), "--strict-port"],
        cwd=REPO, env={**os.environ, "TMUX_AGENT_HOME": str(HOME)},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    token = ""
    try:
        # read the startup banner for the token instead of guessing the file
        deadline = time.time() + 30
        while time.time() < deadline:
            line = srv.stdout.readline()
            if not line:
                break
            if "token=" in line:
                token = line.split("token=")[1].split()[0].strip()
                break
        if not token:
            token = (HOME / "web-token").read_text().strip()

        base = f"http://127.0.0.1:{PORT}"
        fleet = json.loads(urllib.request.urlopen(f"{base}/api/fleet?token={token}", timeout=20).read())
        served_rows = len(fleet["sessions"])

        logs: list[str] = []
        errors: list[str] = []
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1500, "height": 950})
            pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
            failed_urls: list[str] = []
            pg.on("response", lambda r: failed_urls.append(f"{r.status} {r.url}") if r.status >= 400 else None)
            pg.on("pageerror", lambda e: errors.append(str(e)))

            # ── criterion 1: the unauthenticated path is a PAGE, not raw JSON ──
            pg.goto(base + "/", wait_until="domcontentloaded", timeout=30000)
            body401 = pg.inner_text("body")
            pg.screenshot(path=str(SHOTS / "00-unauthorized.png"))
            check(
                "token" in body401.lower() and "{" not in body401[:40],
                "401 shows a human page, not raw JSON",
                f"body starts: {body401[:70]!r}",
            )

            # ── criterion 2: the dashboard loads with no JS errors ──
            pg.goto(f"{base}/?token={token}", wait_until="networkidle", timeout=45000)
            pg.wait_for_timeout(3000)
            check(not errors, "dashboard loads with zero page errors", f"pageerrors={errors[:2] or 'none'}")
            # A 401 on an auto-requested resource (favicon) puts a permanent red error in the
            # operator's console and masks real failures. Zero console errors, not just zero throws.
            console_errs = [l for l in logs if l.startswith("error:")]
            # exclude the deliberate criterion-1 visit to "/" without a token
            real_fails = [u for u in failed_urls if "?token=" in u or "/favicon" in u or "/api/" in u]
            check(not real_fails, "no failing requests once authenticated",
                  f"failures={real_fails[:3] or 'none'} (all 4xx seen: {failed_urls[:4]})")

            # ── criterion 3: every served session is RENDERED (arithmetic, not presence) ──
            rows = pg.query_selector_all("#tree .node")
            check(
                len(rows) == served_rows,
                "rendered row count equals /api/fleet count",
                f"dom={len(rows)} served={served_rows}",
            )

            # ── criterion 4: clicking a row populates the detail pane (the reported bug) ──
            before = pg.inner_text("#detail")
            target = rows[0].get_attribute("data-session")
            rows[0].click()
            pg.wait_for_timeout(2500)
            after = pg.inner_text("#detail")
            pg.screenshot(path=str(SHOTS / "01-after-click.png"))
            # inner_text reflects CSS text-transform:uppercase on the detail heading, so compare
            # case-insensitively — the earlier case-sensitive assert failed on a WORKING UI.
            names_it = target.lower() in after.lower()
            check(
                after != before and names_it,
                "clicking a session shows its detail",
                f"clicked {target!r}; detail changed={after != before}; names target={names_it}",
            )

            # ── criterion 5: filtering actually filters ──
            pg.fill("#q", "ui-child-a")
            pg.wait_for_timeout(800)
            filtered = pg.query_selector_all("#tree .node")
            pg.screenshot(path=str(SHOTS / "02-filtered.png"))
            check(
                0 < len(filtered) < len(rows),
                "search box narrows the fleet",
                f"{len(rows)} -> {len(filtered)} rows for 'ui-child-a'",
            )
            pg.fill("#q", "")
            pg.wait_for_timeout(500)

            # ── criterion 6: keyboard navigation works without a mouse ──
            # the handler deliberately ignores keys while an INPUT has focus (so typing a filter
            # does not navigate). fill() above left #q focused, so blur it first — a human clicking
            # into the page does this implicitly.
            pg.evaluate("document.activeElement && document.activeElement.blur()")
            first = pg.query_selector("#tree .node")
            if first:
                first.click()
                pg.wait_for_timeout(800)
            pg.keyboard.press("j")
            pg.wait_for_timeout(1200)
            sel = pg.query_selector("#tree .node.sel")
            check(sel is not None, "j selects a row (keyboard-only operation)",
                  f"selected={sel.get_attribute('data-session') if sel else None}")

            # ── criterion 7: read-only policy visibly disables the send box ──
            send_disabled = pg.get_attribute("#cmd", "disabled") is not None if pg.query_selector("#cmd") else None
            check(send_disabled is True, "read-only mode disables the send input",
                  f"input disabled={send_disabled}")

            # ── criterion 8: parent/child lineage is actually nested in the DOM ──
            # re-select the parent first: the filter above re-rendered the tree, and nesting is
            # only meaningful for a rendered parent row.
            parent_row = pg.query_selector('#tree .node[data-session="ui-parent"]')
            if parent_row:
                parent_row.click()
                pg.wait_for_timeout(1500)
            nested = pg.query_selector_all("#tree .kids .node")
            check(len(nested) >= 2, "children render nested under their parent",
                  f"nested rows={len(nested)} (expected >=2 for ui-child-a/b)")

            # ── criterion 8b: the strip names the build this dashboard is RUNNING ──
            # Measured 2026-09-12: the operator's daemon served a 47-commit-stale build for 16 days with
            # nothing on screen to say so. A fresh server shows its version (+ commit) on a plain tile,
            # never a warn; the stale warn is proven end-to-end in test/build-stamp.test.js.
            pkg_version = json.loads((REPO / "package.json").read_text())["version"]
            build_tiles = pg.locator("#vitals .vt", has_text="build")
            n_build = build_tiles.count()
            build_txt = build_tiles.first.inner_text() if n_build else ""
            build_cls = (build_tiles.first.get_attribute("class") or "") if n_build else ""
            check(
                n_build == 1 and pkg_version in build_txt and "warn" not in build_cls and "crit" not in build_cls,
                "vitals strip names the running build (package version, no stale warn on a fresh server)",
                f"tiles={n_build} text={build_txt!r} class={build_cls!r}",
            )

            # ── criterion 9: tmux-server death is surfaced in the banner ──
            # While the server is up the attention banner carries no tmux-unreachable line; kill the
            # tmux server underneath the live dashboard and the banner must say so. This is the
            # rendered form of the G3 claim — a curl on /api/fleet proving tmux.reachable=false is
            # covered by smoke step 26; here we prove the operator actually SEES it.
            attn_before = pg.locator("#attn").inner_text().strip() if pg.query_selector("#attn") else ""
            has_before = "unreachable" in attn_before.lower()
            # this kill is the FIXTURE, raw on purpose (TMUX-163's rule for the *-tmux-down shapes: the death is the
            # subject); the finally's kill_server() removes the socket file it leaves behind
            subprocess.run(["tmux", "-L", SOCKET, "kill-server"], capture_output=True)
            # wait for the server side to observe the death (poll the API directly with the token)
            reachable = None
            deadline = time.time() + 15
            while time.time() < deadline:
                try:
                    f = json.loads(urllib.request.urlopen(f"{base}/api/fleet?token={token}", timeout=5).read())
                    reachable = (f.get("tmux") or {}).get("reachable")
                    if reachable is False:
                        break
                except Exception:
                    pass
                time.sleep(0.4)
            # reload so the banner renders from the now-unreachable poll deterministically
            pg.goto(f"{base}/?token={token}", wait_until="networkidle", timeout=45000)
            pg.wait_for_timeout(1500)
            attn_after = pg.locator("#attn").inner_text().strip() if pg.query_selector("#attn") else ""
            pg.screenshot(path=str(SHOTS / "03-tmux-unreachable.png"))
            check(
                (not has_before) and reachable is False and "unreachable" in attn_after.lower() and pg.locator("#attn").is_visible(),
                "tmux-server death shows the unreachable banner (absent while healthy)",
                f"before={attn_before[:40]!r} api.reachable={reachable} after={attn_after[:80]!r}",
            )

            b.close()

        print("\n  console (first 5):")
        for l in logs[:5]:
            print("   ", l[:120])
        print(f"\n  screenshots archived in {SHOTS} — read them for the visual pass")
    finally:
        srv.terminate()
        for s in ("ui-child-a", "ui-child-b", "ui-parent"):
            cli("kill", s)
        kill_server(SOCKET)
        subprocess.run(["rm", "-rf", str(HOME)], capture_output=True)

    failed = [r for r in results if not r[0]]
    print(f"\nUI-ACCEPTANCE: {len(results)-len(failed)}/{len(results)} criteria passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
