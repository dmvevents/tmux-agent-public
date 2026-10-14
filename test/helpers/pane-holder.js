// pane-holder.js <cli-bin> <socket> <session> — ONE line naming what holds a pane right now, for
// test/helpers/wait-shell.sh's give-up after a CUT attempt.
//
// Why. Until this file, a cut said only that "the pane took the injected line, nothing completed
// it", and the count TMUX-146 added said how many times. Three coverage reads of six on the clean
// 62d7536 tree lost test/positional-count.test.js:102 to exactly that line — "(4 attempts, 4 cut,
// 0 refused)" — and it could name no cause: a shell still in its login rc, a key-replaying line
// editor, the host's pty wrapper and a wedged `tmux wait-for` all read the same. The guard that
// ALLOWED each injection saw something (a shell, or it would have refused), and the pane drew
// something; neither was kept. This helper reads both the instant after a cut, so the die can
// quote them beside the counts.
//
// Three facts, each read the way the product reads it so the die cannot drift from the guard:
//   1. what exec's guard sees — `foregroundProgram` from the SHIPPED dist, the same call execSync
//      makes before it injects (src/core/orchestrator.ts): null is "a shell", a name is what would
//      consume the keystroke;
//   2. the processes under the pane — every descendant of tmux's pane pid by `comm`, in tree
//      order, so "bash > kiro-cli-term > bash" and "bash" tell a wrapped shell from a bare one
//      where the guard's one word ("a shell") cannot;
//   3. the pane's last non-empty line as tmux captured it, cut to 120 chars, through the shipped
//      `redact` — a pane line is operator output and THREAT-MODEL's read-boundary rule applies to a
//      diagnostic exactly as it does to a dashboard cell (the built-in rules; a lexicon's extra
//      rules are the CLI's to install, and this helper is not the CLI).
//
// Never throws to its caller and never blocks it: every read is bounded, a failed read is worded
// as such, and the output is one line on stdout. The caller bounds the whole process besides.
//
// Since TMUX-167 the three reads live in the product — `describePaneHolder()` in dist/core/orchestrator.js,
// which execSync's own timeout now quotes — and this file only loads the shipped dist, builds a Tmux on
// the socket and prints that one line, so the suite's give-up and the product's error cannot drift.
// The line gained each process's ps STAT letter there (`kiro-cli-term(S) > bash(T)`): a STOPPED shell or
// wrapper is what the 2026-09-27 14:23Z in-suite red could not name.
//
// Since TMUX-170 the line goes on, TEST-SIDE ONLY (the product's error keeps its own line), with what a
// cut on a SLEEPING wrapper and shell could not say. Two coverage reads of five on the clean d68f3b7 tree
// lost versioning-contract's TMUX-136 case to "(4 attempts, 4 cut, 0 refused)" with the die reading
// `kiro-cli-term(S) > bash(S)` and the pane's last line the bare prompt — both processes asleep, the
// injected line drawn nowhere, and the STAT letter unable to say which of the two had stopped reading.
// Three more facts, and a verdict only when they carry one:
//   4. each process's kernel wait channel — /proc/<pid>/wchan on Linux, `ps -o wchan` elsewhere:
//      `do_signal_stop` is a stopped process whatever ps prints for it, `poll_schedule_timeout` one
//      that is waiting for input, `do_wait` one waiting on a child;
//   5. the bytes UNREAD on the pane's own pty and on every nested pty under it — FIONREAD/TIOCINQ,
//      the one ioctl node cannot make, so it is asked of python3 (present wherever the suite's other
//      pty fixtures run; its absence is worded, never thrown). This is the fact that attributes: a
//      line tmux wrote sits on the pane's pty until the pane's own process reads it, and on the
//      nested pty until the shell there does. Measured 2026-09-28 00:35Z on a python3 pty.spawn
//      wrapper around `bash --norc --noprofile` (scratch/ga-fire-2026-09-28-00Z/probe/physics-1.log):
//      wrapper SIGSTOPped → 19 B on the pane's pty, 0 on the nested; shell SIGSTOPped → 0 and 17;
//      neither → 0 and 0, both in poll_schedule_timeout;
//   6. the pane's last THREE non-empty lines, each through the shipped `redact` and cut to 120 chars —
//      one line showed a prompt; three show whether anything was drawn above it.
// The verdict — `attributed to the WRAPPER python3(pid N): 19 B unread on the pane's pty /dev/pts/35`
// or `attributed to the nested SHELL bash(pid M): 17 B unread on the nested pty /dev/pts/36` — is
// printed ONLY when some pty holds unread bytes; a pane whose queues are empty carries facts 4–6 and
// no verdict, because none is earned. The attribution read is bounded on its own (ATTRIBUTION_MS) and
// its failure is worded in its place, so the product's line above it is never lost to it.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [bin, sock, sess] = process.argv.slice(2);
if (!bin || !sock || !sess) {
  process.stdout.write("pane-holder: usage: pane-holder.js <cli-bin> <socket> <session>\n");
  process.exit(2);
}
const CORE = resolve(dirname(resolve(bin)), "..", "core");
/** Bound on the WHOLE attribution read (facts 4–6); wait-shell.sh bounds this process at 4 s besides. */
const ATTRIBUTION_MS = 2500;
/** Each of the last three lines is quoted at most this long, after redaction — the product's own cut. */
const LINE_CUT = 120;
/** FIONREAD on each pty named on the command line, one `<path> <bytes>` or `<path> ERR <why>` per line. */
const FIONREAD_PY = [
  "import sys,os,fcntl,termios,struct",
  "for d in sys.argv[1:]:",
  "    try:",
  "        fd=os.open(d,os.O_RDONLY|os.O_NOCTTY|os.O_NONBLOCK)",
  "        try: n=struct.unpack('i',fcntl.ioctl(fd,termios.FIONREAD,b'\\0\\0\\0\\0'))[0]",
  "        finally: os.close(fd)",
  "        print(d,n)",
  "    except OSError as e: print(d,'ERR',e.strerror)",
].join("\n");

const firstLine = (e) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

function run(cmd, args, timeout = 1500) {
  return new Promise((done) => {
    execFile(cmd, args, { timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      done(err ? { ok: false, out: String(stdout ?? ""), why: firstLine(err) } : { ok: true, out: String(stdout) });
    });
  });
}

/** `/dev/…` for what `ps -o tty=` printed (`pts/36` on Linux, `ttys003` on macOS), or null for `?`/`??`/`-`. */
function ttyPath(raw) {
  const t = raw.trim();
  if (!t || /^[?-]+$/.test(t)) return null;
  return t.startsWith("/dev/") ? t : `/dev/${t}`;
}

/** Every process under `panePid` (itself first) in tree order, from one ps pass: {pid, ppid, stat, tty, comm}. */
async function paneTree(panePid) {
  const ps = await run("ps", ["-eo", "pid=,ppid=,stat=,tty=,comm="]);
  if (!ps.ok && !ps.out) return { rows: [], why: `ps unreadable: ${ps.why}` };
  const rows = new Map();
  for (const line of ps.out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const comm = (m[5].split("/").pop() ?? "").replace(/^-/, "");
    rows.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], tty: ttyPath(m[4]), comm });
  }
  if (!rows.has(panePid)) return { rows: [], why: `pane pid ${panePid} is not in the process table` };
  const kids = new Map();
  for (const r of rows.values()) (kids.get(r.ppid) ?? kids.set(r.ppid, []).get(r.ppid)).push(r);
  const out = [];
  const seen = new Set();
  const walk = (r) => {
    if (seen.has(r.pid)) return;
    seen.add(r.pid);
    out.push(r);
    for (const k of kids.get(r.pid) ?? []) walk(k);
  };
  walk(rows.get(panePid));
  return { rows: out, why: null };
}

/** Fact 4: `comm(pid)=wchan` for every row — /proc on Linux, one `ps -o wchan` pass elsewhere. */
async function waitChannels(rows) {
  if (process.platform === "linux") {
    return rows.map((r) => {
      let w;
      try {
        w = readFileSync(`/proc/${r.pid}/wchan`, "utf8").trim();
      } catch (e) {
        w = `unreadable(${firstLine(e).split(",")[0]})`;
      }
      return `${r.comm}(${r.pid})=${w === "" || w === "0" ? "running" : w}`;
    });
  }
  const ps = await run("ps", ["-o", "pid=,wchan=", "-p", rows.map((r) => r.pid).join(",")]);
  const by = new Map();
  for (const line of ps.out.split("\n")) {
    const m = /^\s*(\d+)\s+(\S*)\s*$/.exec(line);
    if (m) by.set(Number(m[1]), m[2] || "-");
  }
  return rows.map((r) => `${r.comm}(${r.pid})=${by.get(r.pid) ?? (ps.ok ? "-" : `unreadable(${ps.why})`)}`);
}

/** Fact 5: unread bytes per pty path, via python3; `null` entries when the read failed, with `why`. */
async function unreadBytes(paths) {
  if (paths.length === 0) return { bytes: new Map(), why: null };
  const py = await run("python3", ["-c", FIONREAD_PY, ...paths]);
  const bytes = new Map();
  for (const line of py.out.split("\n")) {
    const m = /^(\S+) (\d+|ERR .*)$/.exec(line.trim());
    if (m) bytes.set(m[1], /^\d+$/.test(m[2]) ? Number(m[2]) : m[2]);
  }
  if (bytes.size === 0) return { bytes, why: py.ok ? "python3 printed nothing" : `python3: ${py.why}` };
  return { bytes, why: null };
}

async function attribution(tmux, paneTarget, redact) {
  let panePid;
  let paneTty;
  try {
    const { stdout } = await tmux.exec(["display-message", "-p", "-t", paneTarget(sess), "#{pane_pid}\t#{pane_tty}"]);
    const [pid, tty] = stdout.trim().split("\t");
    panePid = Number(pid);
    paneTty = ttyPath(tty ?? "");
  } catch (e) {
    return `the pane's pid and pty could not be read: ${firstLine(e)}`;
  }
  const { rows, why } = await paneTree(panePid);
  const parts = [];
  let verdict = "";
  if (why) {
    parts.push(`wchan unreadable (${why})`);
  } else {
    parts.push(`wchan ${(await waitChannels(rows)).join(", ")}`);
    // Every distinct pty under the pane that is not the pane's own, in tree order: the nested ones.
    const nested = [];
    for (const r of rows) if (r.tty && r.tty !== paneTty && !nested.includes(r.tty)) nested.push(r.tty);
    const paths = paneTty ? [paneTty, ...nested] : nested;
    const { bytes, why: qwhy } = await unreadBytes(paths);
    const show = (p) => {
      const b = bytes.get(p);
      return b === undefined ? "unread" : typeof b === "number" ? `${b} B` : b;
    };
    if (paths.length === 0) parts.push("no pty under the pane could be named");
    else if (qwhy) parts.push(`pty queues unreadable (${qwhy})`);
    else {
      const q = [];
      if (paneTty) q.push(`on the pane's pty ${paneTty}: ${show(paneTty)}`);
      for (const n of nested) q.push(`on the nested pty ${n}: ${show(n)}`);
      if (nested.length === 0) q.push("no nested pty");
      parts.push(`unread ${q.join(", ")}`);
      // The verdict: the deepest process on the pty that holds unread bytes is the one that stopped
      // reading them — the WRAPPER when that pty is the pane's own and a nested pty exists below it
      // (the pane's own shell when none does), the nested SHELL when it is a nested pty.
      const deepestOn = (tty) => rows.filter((r) => r.tty === tty).pop();
      const paneBytes = paneTty ? bytes.get(paneTty) : 0;
      if (typeof paneBytes === "number" && paneBytes > 0) {
        const p = deepestOn(paneTty);
        const role = nested.length > 0 ? "the WRAPPER" : "the pane's own SHELL";
        if (p) verdict = `attributed to ${role} ${p.comm}(pid ${p.pid}): ${paneBytes} B unread on the pane's pty ${paneTty}`;
      } else {
        for (const n of nested) {
          const b = bytes.get(n);
          const p = deepestOn(n);
          if (typeof b === "number" && b > 0 && p) {
            verdict = `attributed to the nested SHELL ${p.comm}(pid ${p.pid}): ${b} B unread on the nested pty ${n}`;
            break;
          }
        }
      }
    }
  }
  if (verdict) parts.push(verdict);
  // Fact 6: the last three non-empty lines, redacted at this read boundary as the product redacts its one.
  try {
    const text = await tmux.capturePane(sess);
    const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0).slice(-3);
    parts.push(
      lines.length === 0
        ? "the pane's last three lines: (the pane is blank)"
        : `the pane's last three lines read ${lines.map((l) => JSON.stringify(redact(l).slice(0, LINE_CUT))).join(" / ")}`,
    );
  } catch (e) {
    parts.push(`the pane's last three lines: (pane unreadable: ${firstLine(e)})`);
  }
  return parts.join("; ");
}

async function main() {
  let describePaneHolder;
  let Tmux;
  let paneTarget;
  let redact;
  try {
    ({ describePaneHolder } = await import(pathToFileURL(resolve(CORE, "orchestrator.js")).href));
    ({ Tmux, paneTarget } = await import(pathToFileURL(resolve(CORE, "tmux.js")).href));
    ({ redact } = await import(pathToFileURL(resolve(CORE, "redact.js")).href));
  } catch (e) {
    return `the shipped dist under ${CORE} could not be loaded: ${firstLine(e)}`;
  }
  const tmux = new Tmux({ socket: sock });
  // The product's default bound (750 ms) applies; wait-shell.sh bounds this whole process at 4 s besides.
  const product = await describePaneHolder(tmux, sess);
  let timer;
  const cut = new Promise((done) => {
    timer = setTimeout(() => done(`the attribution read did not finish inside ${ATTRIBUTION_MS} ms`), ATTRIBUTION_MS);
  });
  try {
    const extra = await Promise.race([attribution(tmux, paneTarget, redact), cut]);
    return `${product}; ${extra}`;
  } catch (e) {
    return `${product}; the attribution read failed: ${firstLine(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

main().then(
  (line) => process.stdout.write(`${line}\n`),
  (e) => process.stdout.write(`pane-holder failed: ${firstLine(e)}\n`),
);
