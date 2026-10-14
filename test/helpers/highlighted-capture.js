/**
 * The bytes a syntax-highlighting shell leaves in the raw `pipe-pane` capture log when a `KEY=value` pair is typed
 *. Captured, not composed: this is the line the sixty-fourth GA fire found in a ble.sh pane's log
 * (scratch/ga-fire-2026-09-15-18Z/s5probe/home-<pid>/logs/smoke-child.log, 2026-09-15) — the prompt's tail, cursor
 * hide/show, the name in one colour, `=` in another, the value after a reset, a blank, the next word coloured,
 * reset + shift-in (\x0f), erase-to-end, CR. The value is the smoke's own synthetic literal (test/smoke.sh step 5),
 * never a credential. Shared by test/redact-highlighted.test.js (redact() alone) and test/mcp.test.js (the served
 * read-log path) so the two agree on what "as captured" means.
 */
export const APIKEY_VALUE = "SMK2YmF6cXV1eDk4NzY1NDMyMWNk";
export const BLE_CAPTURED_LINE =
  `\x1b[m\x0f:\x1b[0;1;34m/tmp\x1b[m\x0f$ \x1b[?25h\x1b[?25l\x1b[0;38;5;34m\x1b[0;38;5;34mPLANE_API_KEY\x1b[0;38;5;33m=\x1b[0m${APIKEY_VALUE} \x1b[0;91mtrue\x1b[m\x0f\x1b[K\x1b[?25h\x1b[?25l\x1b[m\x0f\r`;
