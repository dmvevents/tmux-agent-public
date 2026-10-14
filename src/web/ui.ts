/**
 * Single-file dashboard UI (no build step, no CDN — works over an SSH tunnel with no
 * internet). Served as "/" by web/server.ts. Vanilla JS + fetch polling.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" type="image/svg+xml" href="/favicon.ico"/>
<title>tmux-agent</title>
<style>
  :root{--bg:#0f1420;--panel:#171e2e;--line:#2a3550;--fg:#dbe4f4;--dim:#8494b4;
    --work:#37b26c;--idle:#8494b4;--blocked:#e0a13a;--error:#e86a6a;--dead:#8792ad;--acc:#5b8def;
    --inset:#0a0e18}
  /* light theme: every value clears the same WCAG AA bar as the dark palette
     (test/a11y.test.js) — the toggle must never trade readability for preference */
  html[data-theme=light]{--bg:#f4f6fa;--panel:#ffffff;--line:#c8d1e0;--fg:#1a2233;--dim:#4c5a74;
    --work:#1b7544;--idle:#4c5a74;--blocked:#8a5800;--error:#b32d2d;--dead:#556077;--acc:#2b5fc0;
    --inset:#eef1f6}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
  header{display:flex;gap:16px;align-items:baseline;padding:10px 16px;border-bottom:1px solid var(--line)}
  header h1{font-size:15px;margin:0}
  header .meta{color:var(--dim);font-size:12px}
  main{display:grid;grid-template-columns:minmax(430px,1fr) 1.3fr;gap:0;height:calc(100vh - 42px)}
  section{overflow:auto;padding:12px 16px}
  #left{border-right:1px solid var(--line)}
  h2{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px}
  .tree{list-style:none;margin:0;padding:0}
  .tree li{margin:1px 0}
  .node{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:6px;cursor:pointer}
  .node:hover{background:var(--panel)}
  .node.sel{background:var(--panel);outline:1px solid var(--acc)}
  /* State is NEVER colour-alone (WCAG 1.4.1): each dot carries a distinct glyph, so the fleet
     is readable in monochrome and by a colour-blind operator. */
  .dot{width:9px;height:9px;border-radius:50%;flex:none;position:relative}
  .glyph{font-size:11px;width:12px;text-align:center;flex:none;color:var(--dim)}
  .glyph.WORKING{color:var(--work)} .glyph.BLOCKED{color:var(--blocked)}
  .glyph.ERROR{color:var(--error)} .glyph.DEAD,.glyph.GONE{color:var(--dead)}
  .WORKING{background:var(--work)} .IDLE{background:var(--idle)} .BLOCKED{background:var(--blocked)}
  .ERROR{background:var(--error)} .DEAD,.GONE{background:var(--dead)} .UNKNOWN{background:var(--dim)}
  .name{font-weight:600}
  .tag{color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .obs{font-size:11px;color:var(--dim);margin-left:6px;white-space:nowrap}
  .obs.cpu{font-style:italic}
  .ctx{margin-left:auto;font-size:11px;color:var(--dim)}
  .ctx.hot{color:var(--blocked);font-weight:700}
  /* per-session memory (H2): sits in the right cluster; when both mem and ctx render, mem
     takes the auto margin and ctx trails it */
  .mem{margin-left:auto;font-size:11px;color:var(--dim)}
  .mem+.ctx{margin-left:8px}
  .mem.hot{color:var(--blocked);font-weight:700}
  .kids{margin-left:22px;border-left:1px dashed var(--line);padding-left:10px;list-style:none}
  table{width:100%;border-collapse:collapse;font-size:12px}
  td,th{padding:3px 8px;text-align:left;border-bottom:1px solid var(--line);color:var(--dim)}
  th{color:var(--fg)}
  tr.dead td{opacity:.55;text-decoration:none}
  .pill{padding:1px 7px;border-radius:9px;font-size:11px}
  .pill.live{background:rgba(55,178,108,.15);color:var(--work)}
  .pill.gone{background:rgba(107,118,146,.2);color:var(--dead)}
  #detail .kv{display:grid;grid-template-columns:110px 1fr;gap:2px 10px;font-size:12.5px;margin:8px 0}
  #detail .kv div:nth-child(odd){color:var(--dim)}
  pre{background:var(--inset);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px;
      white-space:pre-wrap;word-break:break-all;max-height:340px;overflow:auto}
  .sendrow{display:flex;gap:8px;margin:10px 0}
  .sendrow input[type=text]{flex:1;background:var(--inset);border:1px solid var(--line);border-radius:6px;
      color:var(--fg);padding:8px;font:inherit}
  button{background:var(--acc);border:0;border-radius:6px;color:#fff;padding:8px 14px;font:inherit;cursor:pointer}
  button:disabled{opacity:.4;cursor:not-allowed}
  .note{color:var(--dim);font-size:11.5px}
  /* Nothing to qualify must render NOTHING — an empty note still carries a line box
     (the browser audit's T15 measured it), so these follow #attn/#vocab below and are display:none
     until there is a note; the two panels are stacked, so an empty box here would shift everything
     below it.
     Both notes were moved OUT of their <h2> and made blocks under it. A heading cannot
     both shout its panel name and carry a sentence: h2 is uppercase + letter-spaced and the browser
     applies that at PAINT time, so the note's case-sensitive identifiers reached the operator as
     LEDGER/ARCHIVE … /API/HEALTH … ARCHIVEFILES/ARCHIVEBYTES — a route and two JSON keys that do not
     exist, in the one sentence whose whole job is to say where the unread history is. The timeline's
     own copy of this note was always a <p class="note"> under its heading, so these two take that
     shape rather than reset the transform in place, and the SHORT designed labels stay inside their
     headings, where uppercase costs the reader nothing. Browser audit T17 holds all three. */
  #wastenote,#histnote{display:none}
  #wastenote.on,#histnote.on{display:block;margin:2px 0 6px}
  .evt{font-size:11.5px;color:var(--dim)} .evt b{color:var(--fg)}
  #err{color:var(--error);font-size:12px;margin-left:auto}
  /* host vitals strip (H1): substrate pressure at a glance. Inks reuse the
     AA-measured tokens (--blocked warn, --error crit; test/a11y.test.js re-checks them on
     --inset); pressure is never colour-alone — warn/crit carry a glyph and sr text. */
  .vitals{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}
  .vt{border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:11.5px;
      color:var(--dim);background:var(--inset)}
  .vt b{color:var(--fg);font-weight:600}
  .vt.warn{color:var(--blocked);border-color:var(--blocked)} .vt.warn b{color:var(--blocked)}
  .vt.crit{color:var(--error);border-color:var(--error)} .vt.crit b{color:var(--error)}
  /* attention banner: the "what needs me NOW" surface */
  #attn{display:none;margin:0 0 10px;padding:8px 12px;border-radius:8px;border:1px solid var(--error);
        background:rgba(224,82,82,.12);font-size:12.5px;cursor:pointer}
  #attn.on{display:block}
  #attn b{color:var(--error)}
  #attn .who{color:var(--fg)}
  /* vocabulary-gap notice: a SETUP step, not an alert. Uses --line/--panel rather than the
     error palette on purpose — styling it like #attn would read as "your fleet is broken" when
     the real message is "I don't know your CLI yet". --fg on --panel is the highest-contrast
     pair in both themes, so no new colour is introduced and AA is inherited. */
  #vocab{display:none;margin:0 0 10px;padding:8px 12px;border-radius:8px;border:1px solid var(--line);
        background:var(--panel);color:var(--fg);font-size:12.5px}
  #vocab.on{display:block}
  #vocab code{background:var(--inset);border:1px solid var(--line);border-radius:4px;padding:0 4px}
  /* filter bar */
  .controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 10px}
  .controls input[type=search]{flex:1;min-width:150px;background:var(--inset);border:1px solid var(--line);
        border-radius:6px;color:var(--fg);padding:6px 8px;font:inherit}
  .chip{border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:11.5px;cursor:pointer;
        user-select:none;color:var(--dim);background:transparent}
  .chip.on{color:var(--fg);border-color:var(--acc);background:rgba(91,141,239,.14)}
  .controls .spacer{margin-left:auto;color:var(--dim);font-size:11.5px}
  th.sortable{cursor:pointer;user-select:none}
  th.sortable:after{content:' ⇅';color:var(--dim);font-size:10px}
  th.sortable.asc:after{content:' ↑';color:var(--acc)}
  th.sortable.desc:after{content:' ↓';color:var(--acc)}
  /* visible keyboard focus — the UI was entirely mouse-only before */
  :focus-visible{outline:2px solid var(--acc);outline-offset:1px}
  .node[tabindex]{outline-offset:-2px}
  .tl{margin:6px 0 2px}
  .tl .row{display:flex;gap:8px;align-items:center;font-size:12px;padding:2px 0}
  .tl .bar{height:9px;border-radius:3px;flex:none;min-width:3px}
  .tl .dur{color:var(--dim);width:58px;text-align:right;flex:none}
  .tl .st{width:74px;flex:none}
  .tl .when{color:var(--dim);font-size:11px}
  .tl .mark{color:var(--dim);font-size:11.5px;padding:1px 0 1px 8px;border-left:2px solid var(--line);margin-left:4px}
  .tl .mark b{color:var(--fg)}
  /* screen-reader-only text: state announced without duplicating it visually */
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
      clip:rect(0 0 0 0);white-space:nowrap;border:0}
  kbd{border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:11px;color:var(--dim)}
  /* keep/close verdict badge (census session.meta enrichment from the ledger) */
  .vd{border-radius:4px;padding:0 5px;font-size:10px;font-weight:700;flex:none;letter-spacing:.03em}
  .vd.keep{background:rgba(55,178,108,.15);color:var(--work)}
  .vd.crit{background:rgba(91,141,239,.18);color:#a9c4ff}
  .vd.prot{background:rgba(91,141,239,.18);color:#a9c4ff;outline:1px solid var(--acc)}
  .vd.flag{background:rgba(224,161,58,.16);color:var(--blocked)}
  .vd.close{background:rgba(224,82,82,.16);color:#f08c8c}
  /* the hardcoded badge inks are tuned for dark tints; on light they fall below AA
     (one rule per family — test/a11y.test.js parses these to recompute the composite) */
  html[data-theme=light] .vd.crit{color:#2b4d9c}
  html[data-theme=light] .vd.prot{color:#2b4d9c}
  html[data-theme=light] .vd.close{color:#9e2a2a}
</style></head><body>
<header><h1>tmux-agent</h1><span class="meta" id="meta">loading…</span><button class="chip" id="theme" aria-pressed="false" title="Switch between dark and light theme">light theme</button><span id="err"></span></header>
<main>
  <section id="left">
    <div id="vitals" class="vitals" role="group" aria-label="Host vitals"></div>
    <div id="attn" role="alert" aria-live="polite" aria-atomic="true" tabindex="0"></div>
    <div id="vocab" role="status" aria-live="polite"></div>
    <h2>Fleet — parent / child</h2>
    <div class="controls" role="group" aria-label="Fleet filters">
      <input type="search" id="q" placeholder="filter by name, owner, task…" aria-label="Filter sessions" autocomplete="off"/>
      <button class="chip on" data-state="WORKING">working</button>
      <button class="chip on" data-state="IDLE">idle</button>
      <button class="chip on" data-state="BLOCKED">blocked</button>
      <button class="chip on" data-state="ERROR">error</button>
      <button class="chip on" data-state="DEAD">dead</button>
      <span class="spacer" id="count"></span>
    </div>
    <div class="controls" role="group" aria-label="Engagement filters">
      <span class="note">engagement:</span>
      <button class="chip on" data-eng="ACTIVE">active</button>
      <button class="chip on" data-eng="ATTACHED">attached</button>
      <button class="chip on" data-eng="AUTONOMOUS">autonomous</button>
      <button class="chip on" data-eng="PARKED">parked</button>
      <button class="chip on" data-eng="ORPHANED">orphaned</button>
    </div>
    <div class="controls">
      <button class="chip on" id="autorefresh" aria-pressed="true">auto-refresh 5s</button>
      <button class="chip" id="refreshnow">refresh now</button>
      <button class="chip" id="collapse" aria-pressed="false">collapse children</button>
      <span class="spacer"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>/</kbd> filter · <kbd>Enter</kbd> open</span>
    </div>
    <ul class="tree" id="tree" role="tree" aria-label="Fleet sessions"></ul>
    <h2>Workstream history <span class="note">(from ledger — live + decommissioned)</span></h2>
    <p class="note" id="histnote"></p>
    <table id="hist"><caption class="sr">Workstream history: live and decommissioned sessions</caption><thead><tr><th scope="col" class="sortable" data-k="session">session</th><th scope="col" class="sortable" data-k="live">state</th><th class="sortable" data-k="verdict">verdict</th><th scope="col" class="sortable" data-k="parent">parent</th><th scope="col" class="sortable desc" data-k="spawnedAt">spawned</th><th scope="col" class="sortable" data-k="killedAt">ended</th></tr></thead><tbody></tbody></table>
    <h2>Top waste</h2>
    <p class="note" id="wastenote"></p>
    <table id="waste"><caption class="sr">Top waste by error count and state churn</caption><thead><tr><th scope="col" class="sortable" data-k="session">session</th><th scope="col" class="sortable desc" data-k="errorEvents">errors</th><th scope="col" class="sortable" data-k="stateChurn">churn</th><th scope="col" class="sortable" data-k="inputsSent">inputs</th></tr></thead><tbody></tbody></table>
    <h2>Top memory <span class="note">(pane process tree RSS — idle sessions leak too)</span></h2>
    <table id="mem"><caption class="sr">Sessions by process-tree memory use</caption><thead><tr><th scope="col" class="sortable" data-k="session">session</th><th scope="col" class="sortable desc" data-k="rssBytes">memory</th><th scope="col" class="sortable" data-k="cpuPerSec">cpu/s</th><th scope="col" class="sortable" data-k="state">state</th></tr></thead><tbody></tbody></table>
  </section>
  <section id="right">
    <div id="detail"><p class="note">Select a session. Data refreshes every 5s. <!--access-note--> Sends go through the same verified,
    policy-checked, audited path as the CLI/MCP.</p></div>
  </section>
</main>
<script>
let SEL=null, RO=false, FLEET=[], HIST=[], WASTE=[], TIMER=null, HP=null, ALERTS=[], NOTES=[], HISTNOTES=[];
// View state persists across reloads: a supervisor who filtered to ERROR and reloaded should
// not silently get the unfiltered fleet back.
const LS='tmux-agent.view';
const V=Object.assign({q:'',states:{WORKING:1,IDLE:1,BLOCKED:1,ERROR:1,DEAD:1,GONE:1,UNKNOWN:1},
  eng:{ACTIVE:1,ATTACHED:1,AUTONOMOUS:1,PARKED:1,ORPHANED:1},
  auto:true,collapse:false,histSort:{k:'spawnedAt',dir:-1},wasteSort:{k:'errorEvents',dir:-1},
  memSort:{k:'rssBytes',dir:-1}},
  JSON.parse(localStorage.getItem(LS)||'{}'));
const saveV=()=>localStorage.setItem(LS,JSON.stringify(V));
const $=(s)=>document.querySelector(s);
// Theme rides its own key, not V: clearing view filters must never also reset an operator's
// contrast preference. Dark stays the default; only an explicit choice switches to light.
const TK='tmux-agent.theme';
function applyTheme(t){
  document.documentElement.dataset.theme=t;
  const b=$('#theme'); b.classList.toggle('on',t==='light'); b.setAttribute('aria-pressed',String(t==='light'));
}
applyTheme(localStorage.getItem(TK)==='light'?'light':'dark');
const esc=(s)=>String(s??'').replace(/[&<>"'\/]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#47;'}[c]));
async function j(u,opt){const r=await fetch(u,opt);if(!r.ok)throw new Error(u+' -> '+r.status);return r.json()}

/** Distinct glyph per state so colour is never the only signal. */
function stateGlyph(st){
  return {WORKING:'▶',IDLE:'◦',BLOCKED:'⏸',ERROR:'✕',DEAD:'☠',GONE:'—',UNKNOWN:'?'}[st]||'?';
}

function fmtAgo(sec){
  if(sec==null) return '';
  if(sec<60) return sec+'s ago';
  if(sec<3600) return Math.round(sec/60)+'m ago';
  return (sec/3600).toFixed(1)+'h ago';
}

function matches(s){
  if(!V.states[s.state]) return false;
  if(s.engagement && V.eng && V.eng[s.engagement]===0) return false;
  const q=V.q.trim().toLowerCase();
  if(!q) return true;
  const m=s.meta||{};
  return [s.session,s.parent,s.owner,s.task,m.role,m.verdict,m.repo,m.branch].filter(Boolean).some(x=>String(x).toLowerCase().includes(q));
}

// verdict string -> badge family (KEEP-CRITICAL before KEEP: prefix-match order matters)
function vdClass(v){
  if(!v) return null;
  if(v.startsWith('KEEP-CRITICAL')) return 'crit';
  if(v.startsWith('KEEP-PROTECTED')) return 'prot';
  if(v.startsWith('KEEP')) return 'keep';
  if(v.startsWith('FLAG')) return 'flag';
  return 'close'; // CLOSE, RECOMMEND-CLOSE
}
function vdBadge(m){
  const c=vdClass(m&&m.verdict);
  return c?'<span class="vd '+c+'" title="'+esc((m.why||'')+(m.source?' ['+m.source+']':''))+'">'+esc(m.verdict)+'</span>':'';
}

// per-session memory badge (H2). "hot" = this one tree holds >10% of host RAM — the
// single-session threshold that precedes the H3 alert, surfaced early where the eye already is.
function memBadge(s){
  if(s.rssBytes==null) return '';
  const hot=HP&&HP.mem&&HP.mem.totalBytes>0&&s.rssBytes>0.10*HP.mem.totalBytes;
  return '<span class="mem'+(hot?' hot':'')+'" title="pane process-tree RSS'+(hot?' — over 10% of host RAM':'')+'">'+fmtBytes(s.rssBytes)+(hot?' ⚠':'')+'</span>'+(hot?'<span class="sr"> memory hot</span>':'');
}

function renderAttention(sessions){
  // ERROR and BLOCKED are the states a human must act on; at 30-session scale they were
  // invisible inside the tree. This is the "what needs me now" surface. Host-health criticals
  // (H3) outrank session states: a box 4 minutes from OOM is more urgent than any one session.
  const bad=sessions.filter(s=>s.state==='ERROR'||s.state==='BLOCKED');
  // tmux-server death is its own line: an unreachable server is not a "host" alert and
  // not a session state — it is why the fleet looks empty. Kept out of the HOST group so the
  // operator reads "tmux is gone" plainly, and click-to-filter (session states) still makes sense.
  const tmuxDown=(ALERTS||[]).find(a=>a.kind==='tmux.unreachable');
  const crits=(ALERTS||[]).filter(a=>a.sev==='crit'&&a.kind!=='tmux.unreachable');
  const el=$('#attn');
  if(!bad.length&&!crits.length&&!tmuxDown){ el.className=''; el.innerHTML=''; return; }
  el.className='on';
  const parts=[];
  if(tmuxDown)parts.push('<b>⚠</b> <span class="who">'+esc(tmuxDown.detail)+'</span>');
  if(crits.length)parts.push('<b>HOST</b> — '+crits.map(a=>'<span class="who">'+esc(a.detail)+'</span>').join(' · '));
  if(bad.length)parts.push('<b>'+bad.length+' session'+(bad.length>1?'s need':' needs')+' attention</b> — '+
    bad.map(s=>'<span class="who">'+esc(s.session)+' ('+esc(s.state)+')</span>').join(', ')+
    ' &nbsp;<span class="note">click to filter</span>');
  el.innerHTML=parts.join('<br/>');
}

/**
 * Vocabulary-gap notice.
 *
 * The failure this exists to prevent is NOT a screen full of UNKNOWN — plain shells classify fine
 * from core CPU signals. It is subtler and worse: when no profile recognises a CLI, the state
 * falls back to IDLE, which is indistinguishable from a profile that *said* idle. That is exactly
 * the codex bug generalised — a live codex parked on a blocking prompt reported IDLE and looked
 * healthy. We fixed it for codex by writing a profile; an unprofiled CLI still reads as calm.
 * (No backticks in this file: the whole UI is one template literal, so a backtick here ends it.)
 *
 * So the signal is classifiedBy === null on DEEP-inspected sessions: the tool guessed. Fleet
 * rows are excluded because the O(1) fast path runs no profile by design and would otherwise fire
 * this on every load.
 *
 * Advisory, not an alert: it deliberately shares no styling with #attn, because a vocabulary gap
 * is a setup step, not a session needing rescue.
 */
function renderVocabGap(sessions){
  const el=$('#vocab');
  if(!el) return;
  // only sessions we actually read pane text for can tell us whether a profile spoke
  const deep=sessions.filter(s=>s.classifiedBy!==undefined&&s.lastLine&&s.state!=='GONE'&&s.state!=='DEAD');
  const guessed=deep.filter(s=>s.classifiedBy===null);
  if(!deep.length||guessed.length<2||guessed.length<deep.length/2){ el.className=''; el.innerHTML=''; return; }
  el.className='on';
  el.innerHTML='<b>'+guessed.length+' of '+deep.length+' inspected sessions were classified by no profile</b> — '+
    'their state comes from core signals only, so a session waiting on a human can read as IDLE. '+
    'Teach tmux-agent this fleet’s CLI: <code>tmux-agent calibrate --out lexicon.draft.json</code>, '+
    'review it, then place it at <code>$TMUX_AGENT_HOME/lexicon.json</code> and confirm with '+
    '<code>tmux-agent doctor</code>.';
}

/**
 * Where a row's state came from: "profile <name> · <age>" when the daemon's health tick (or the detail
 * view) read the pane and a profile spoke — the state shown IS that verdict — or "cpu-only" when the state is the
 * CPU-delta verdict alone and no pane text was read. The second is a limited observation, not a healthy idle: on
 * 2026-10-13 the fast rows called 26 of 31 sessions WORKING where the classifier said 8, and a codex menu waiting on a
 * human read IDLE until clicked. Rendered as text so it survives every theme and the audit's contrast pass (var(--dim)).
 */
function obsTag(s){
  const o=s.observed;
  if(!o) return '';
  if(o.source==='profile') return '<span class="obs profile" title="'+esc('state read from the pane by the '+o.profile+' profile '+fmtAgo(o.ageSecs)+' (the health tick, or the detail view)')+'">'+esc('profile '+o.profile+' · '+fmtAgo(o.ageSecs))+'</span>';
  return '<span class="obs cpu" title="state from the CPU delta alone — no pane text was read for this row; a profile had no opinion, or the tick has not read it yet">cpu-only</span>';
}

function buildTree(sessions){
  const byParent={};
  for(const s of sessions){ (byParent[s.parent&&sessions.some(x=>x.session===s.parent)?s.parent:'__root__'] ??= []).push(s); }
  const render=(list)=>list.map(s=>{
    const showKids=byParent[s.session] && (!V.collapse || SEL===s.session);
    const kids=showKids?'<ul class="kids">'+render(byParent[s.session])+'</ul>':
      (byParent[s.session]?'<ul class="kids"><li class="note">'+byParent[s.session].length+' child session(s) hidden</li></ul>':'');
    const hot=s.contextPct!=null&&s.contextPct>=80?' hot':'';
    return '<li role="none"><div class="node'+(SEL===s.session?' sel':'')+'" data-session="'+esc(s.session)+'" role="treeitem" aria-selected="'+(SEL===s.session)+'" aria-label="'+esc(s.session+' — '+s.state+(s.engagement?' — '+s.engagement:''))+'">'+
      '<span class="dot '+esc(s.state)+'" aria-hidden="true"></span>'+
      '<span class="glyph '+esc(s.state)+'" aria-hidden="true">'+stateGlyph(s.state)+'</span>'+
      '<span class="name">'+esc(s.session)+'</span><span class="sr">'+esc(s.state)+'</span>'+
      vdBadge(s.meta)+
      '<span class="eng '+esc(s.engagement||'')+'" title="'+esc(s.lastDrivenBy? 'driven by '+s.lastDrivenBy+' '+fmtAgo(s.drivenAgoSecs) : 'never driven through tmux-agent')+'">'+esc((s.engagement||'').toLowerCase())+'</span>'+
      '<span class="tag">'+esc(s.lastDrivenBy? '← '+s.lastDrivenBy+' '+fmtAgo(s.drivenAgoSecs) : (s.task ?? (s.meta&&s.meta.role) ?? ''))+'</span>'+
      memBadge(s)+
      (s.contextPct!=null?'<span class="ctx'+hot+'">ctx '+s.contextPct+'%</span>':'')+
      obsTag(s)+'</div>'+kids+'</li>';
  }).join('');
  const html=render(byParent['__root__']??[]);
  $('#tree').innerHTML=html || '<li class="note">'+(FLEET.length? 'no sessions match this filter' : 'no sessions on the agent socket')+'</li>';
  // every row is focusable so j/k and Tab both work
  document.querySelectorAll('#tree .node').forEach((n,i)=>n.setAttribute('tabindex', i===0?'0':'-1'));
}

async function refresh(){
  // vitals ride the same poll but fail independently: a broken health probe must never
  // blank the fleet view (and vice versa)
  j('/api/health').then(renderVitals).catch(()=>renderVitals(null));
  try{
    const f=await j('/api/fleet');
    RO=f.readOnly; FLEET=f.sessions; WASTE=f.waste; ALERTS=f.alerts||[]; NOTES=f.notes||[];
    // /api/history is an envelope now — the rows plus the note saying whether the days
    // behind them were all read. Old shape (a bare array) would leave HIST undefined, which is why
    // the server and this file ship together; /api/* is private by declaration (VERSIONING.md:120).
    const h=await j('/api/history'); HIST=h.sessions||[]; HISTNOTES=h.notes||[];
    $('#meta').textContent=FLEET.length+' sessions · '+new Date(f.generatedAt).toLocaleTimeString()+(RO?' · READ-ONLY':'');
    renderAll();
    if(SEL)detail(SEL,false);
    $('#err').textContent='';
  }catch(e){$('#err').textContent=String(e.message??e)}
}

function fmtBytes(b){
  if(b==null) return '—';
  const u=['B','K','M','G','T']; let v=b,i=0;
  while(v>=1024&&i<u.length-1){v/=1024;i++}
  return (v>=10?Math.round(v):v.toFixed(1))+u[i];
}

/** Host pressure at a glance (H1). Tint thresholds mirror the H3 defaults in
 * docs/HEALTH-CRASH-OBSERVABILITY.md (mem <10% available warn / <5% crit, disk <10G warn /
 * <5G crit, swap ≥50% used warn / ≥90% crit); H3 turns them into config-driven ledger events. */
function renderVitals(h){
  if(h) HP=h; // memBadge's hot threshold keeps the last-known host total if one probe fails
  const el=$('#vitals'); if(!el) return;
  if(!h){ el.innerHTML=''; return; }
  const it=(label,val,sev,why)=>'<span class="vt'+(sev?' '+sev:'')+'">'+
    (sev?'<span aria-hidden="true">'+(sev==='crit'?'✕':'⚠')+'</span> ':'')+label+' <b>'+esc(val)+'</b>'+
    (sev?'<span class="sr">'+(sev==='crit'?' critical':' warning')+(why?': '+esc(why):'')+'</span>':'')+'</span>';
  const out=[];
  const mFree=h.mem.totalBytes>0?h.mem.availableBytes/h.mem.totalBytes:1;
  out.push(it('mem',fmtBytes(h.mem.availableBytes)+' free / '+fmtBytes(h.mem.totalBytes),
    mFree<0.05?'crit':mFree<0.10?'warn':null,'low available memory'));
  if(h.swap===null) out.push(it('swap','n/a',null));
  else if(h.swap.totalBytes===0) out.push(it('swap','none',null));
  else{
    const used=1-h.swap.freeBytes/h.swap.totalBytes;
    out.push(it('swap',Math.round(used*100)+'% used',used>=0.9?'crit':used>=0.5?'warn':null,'swap pressure'));
  }
  const seen=new Set();
  for(const d of h.disk){
    const key=d.totalBytes+'/'+d.freeBytes; // agent home + ~ usually share one filesystem
    if(seen.has(key)) continue; seen.add(key);
    out.push(it('disk',fmtBytes(d.freeBytes)+' free',
      d.freeBytes<5e9?'crit':d.freeBytes<10e9?'warn':null,'low disk on '+d.path));
  }
  out.push(it('load',h.load.map(x=>x.toFixed(2)).join(' '),null));
  // H5: a credible negative trend shows as an ETA chip — the single most actionable number here
  if(h.prediction){
    const p=h.prediction;
    out.push(it('OOM','~'+Math.round(p.etaMinutes)+'min',p.etaMinutes<10?'crit':'warn',
      'projected memory exhaustion'+((p.culprits||[]).length?' driven by '+p.culprits.map(c=>c.session).join(', '):'')));
  }
  // H4: the box died under us last time — say so until a human has seen it
  if(h.lastCrash&&h.lastCrash.suspected){
    const top=(h.lastCrash.lastSnapshot&&h.lastCrash.lastSnapshot.top[0])?h.lastCrash.lastSnapshot.top[0].session:'unknown';
    const hp=(h.lastCrash.lastSnapshot&&h.lastCrash.lastSnapshot.hostTop&&h.lastCrash.lastSnapshot.hostTop[0])||null;
    out.push(it('crash','suspected '+String(h.lastCrash.lastHeartbeatAt||'').slice(5,16).replace('T',' '),'warn',
      'host crash suspected; top memory consumer at last heartbeat: '+top+(hp?'; top host process '+hp.comm+' '+fmtBytes(hp.rssBytes):'')));
  }
  // What this dashboard is RUNNING, and whether dist/ has moved on under it. The operator's
  // own daemon served a 47-commit-stale build for 16 days with nothing on this strip to say so; a
  // warn here is the restart prompt. Same warn ink, glyph and sr text as every other tile. The two
  // sides are the daemon's own words (build.words — describeBuildPair): a rebuild at the
  // same commit names both build times, and this strip never phrases the pair a second time.
  if(h.build){
    const b=h.build, w=b.words||{};
    out.push(it('build',(b.version||'?')+(b.commit?' '+b.commit:''),b.stale?'warn':null,
      'dashboard runs '+(w.running||'unknown')+', disk has '+(w.onDisk||'unknown')+' — restart tmux-agent web to pick it up'));
  }
  el.innerHTML=out.join('')+
    '<span class="note" title="vitals sampling: proc = /proc/meminfo; os-only = degraded (no /proc, swap unknown)">'+esc(h.mode)+'</span>';
}

function sortRows(rows,st){
  const k=st.k, dir=st.dir;
  return rows.slice().sort((a,b)=>{
    let x=a[k], y=b[k];
    if(typeof x==='boolean') { x=x?1:0; y=y?1:0; }
    x=x??''; y=y??'';
    if(typeof x==='number'&&typeof y==='number') return (x-y)*dir;
    return String(x).localeCompare(String(y))*dir;
  });
}

function renderAll(){
  const shown=FLEET.filter(matches);
  renderAttention(FLEET);            // banner reflects the WHOLE fleet, not the filtered view
  renderVocabGap(FLEET);             // ...as does the vocabulary gap: filtering cannot fix a missing profile
  buildTree(shown);
  $('#count').textContent=shown.length+' / '+FLEET.length+' shown';
  $('#waste tbody').innerHTML=sortRows(WASTE,V.wasteSort).map(w=>'<tr><td>'+esc(w.session)+'</td><td>'+w.errorEvents+'</td><td>'+w.stateChurn+'</td><td>'+w.inputsSent+'</td></tr>').join('');
  // This ranking covers live ledger days only, so when history has been archived under it
  // the panel says which days it did not read — the server's wording verbatim, textContent so no
  // phrasing is re-derived here. Nothing to say renders nothing at all (#attn's display idiom), so
  // an empty note is 0x0: no box, no layout shift.
  const wn=$('#wastenote');
  wn.textContent=NOTES.join(' · ');
  wn.className=NOTES.length?'note on':'note';
  // Top memory (H2): only measured rows (null = /proc unavailable, honestly absent)
  $('#mem tbody').innerHTML=sortRows(FLEET.filter(s=>s.rssBytes!=null),V.memSort).slice(0,8)
    .map(s=>'<tr><td>'+esc(s.session)+'</td><td>'+fmtBytes(s.rssBytes)+'</td><td>'+(s.cpuPerSec!=null?s.cpuPerSec:'—')+'</td><td>'+esc(s.state)+'</td></tr>').join('')
    ||'<tr><td colspan="4" class="note">no per-process memory data on this host (no /proc)</td></tr>';
  // This table lists the sessions in the LIVE ledger days, so an archived history means
  // rows are missing from a panel whose own subtitle claims the ledger. Same wording, same
  // textContent-not-innerHTML discipline and same display idiom as the waste note above it.
  const hn=$('#histnote');
  hn.textContent=HISTNOTES.join(' · ');
  hn.className=HISTNOTES.length?'note on':'note';
  $('#hist tbody').innerHTML=sortRows(HIST,V.histSort).slice(0,40).map(r=>'<tr class="'+(r.live?'':'dead')+'"><td>'+esc(r.session)+'</td>'+
    '<td><span class="pill '+(r.live?'live':'gone')+'">'+(r.live?'live':'ended')+'</span></td>'+
    '<td>'+(r.verdict?'<span class="vd '+vdClass(r.verdict)+'">'+esc(r.verdict)+'</span>':'—')+'</td>'+
    '<td>'+esc(r.parent??'—')+'</td><td>'+(r.spawnedAt?esc(r.spawnedAt.slice(5,16)):'—')+'</td>'+
    '<td>'+(r.killedAt?esc(r.killedAt.slice(5,16)):'—')+'</td></tr>').join('');
}

// select moves the cursor only; pick = select + open. j/k used to pick() per keystroke, which
// fired one /api/session per traversed row (polluting the server's deep-classify focus set) and
// let out-of-order responses render the wrong session (browser audit 2026-08-25).
window.select=(name)=>{SEL=name;renderAll();};
window.pick=(name)=>{SEL=name;detail(name,true);renderAll();};
// Delegated click: the session name travels as a data attribute, never as generated JS.
// A session created OUTSIDE tmux-agent (e.g. on the shared default server) can carry any
// name at all; building an inline onclick from it was an XSS vector that would run in the
// operator's same-origin context and could then drive /api/send legitimately.
document.getElementById('tree').addEventListener('click',(e)=>{
  const n=e.target.closest('.node'); if(!n) return;
  const name=n.getAttribute('data-session'); if(name) window.pick(name);
});

async function detail(name,scroll){
  const d=await j('/api/session/'+encodeURIComponent(name));
  if(name!==SEL)return; // responses race (slow capture, fast clicks): only the current selection may render
  const s=d.snapshot;
  const frow=FLEET.find(x=>x.session===name)||{};
  const fm=frow.meta||null; // census enrichment rides /api/fleet
  // the 5s poll re-renders this panel — a half-typed command must survive it
  const prev=$('#cmd');
  const draft=prev?{v:prev.value,focus:document.activeElement===prev,s:prev.selectionStart,e:prev.selectionEnd}:null;
  $('#detail').innerHTML=
    '<h2 style="margin-top:0">'+esc(name)+' <span class="dot '+esc(s.state)+'" style="display:inline-block"></span> '+esc(s.state)+(fm?' '+vdBadge(fm):'')+'</h2>'+
    '<div class="kv">'+
      (fm&&fm.role?'<div>role</div><div>'+esc(fm.role)+'</div>':'')+
      (fm&&fm.repo?'<div>repo</div><div>'+esc(fm.repo)+(fm.branch?' @ '+esc(fm.branch):'')+'</div>':'')+
      (fm&&fm.why?'<div>verdict why</div><div>'+esc(fm.why)+'</div>':'')+
      '<div>engagement</div><div>'+esc(s.engagement??frow.engagement??'—')+((d.snapshot.lastDrivenBy??frow.lastDrivenBy)?' · driven by '+esc(d.snapshot.lastDrivenBy??frow.lastDrivenBy)+' '+esc(fmtAgo(d.snapshot.drivenAgoSecs??frow.drivenAgoSecs)):'')+'</div>'+
      '<div>cwd</div><div>'+esc(d.info?.cwd??'—')+'</div>'+
      '<div>process</div><div>'+esc(d.info?.currentCmd??'—')+(d.info?.pid?' (pid '+d.info.pid+')':'')+'</div>'+
      '<div>context</div><div>'+(s.contextPct!=null?s.contextPct+'%':'—')+'</div>'+
      '<div>memory</div><div>'+(s.rssBytes!=null?fmtBytes(s.rssBytes)+' <span class="note">(process-tree RSS)</span>':'—')+'</div>'+
      '<div>log bytes</div><div>'+(s.logBytes??'—')+'</div>'+
      '<div>last line</div><div>'+esc(s.lastLine)+'</div></div>'+
    '<div class="sendrow"><input type="text" id="cmd" placeholder="'+(RO?'read-only mode — sending disabled':'send input to this session (verified + audited)')+'" '+(RO?'disabled':'')+'/>'+
      '<button onclick="sendCmd()" '+(RO?'disabled':'')+'>send</button></div>'+
    '<h2>Timeline <span class="note">(state durations + actions, from the ledger)</span></h2><div id="tl" class="tl"></div>'+
    ((d.procs&&d.procs.length)?'<h2>Processes <span class="note">(this pane process tree, top by memory)</span></h2>'+
      '<table><caption class="sr">Processes of this session by memory</caption><thead><tr><th scope="col">pid</th><th scope="col">command</th><th scope="col">memory</th><th scope="col">cpu time</th></tr></thead><tbody>'+
      d.procs.map(p=>'<tr><td>'+p.pid+'</td><td>'+esc(p.comm)+'</td><td>'+fmtBytes(p.rssBytes)+'</td><td>'+fmtDur(p.cpuSecs)+'</td></tr>').join('')+
      '</tbody></table>':'')+
    '<h2>Pane (live, redacted)</h2><pre>'+esc(d.pane||'(gone)')+'</pre>'+
    '<h2>Recent events</h2><div>'+d.events.slice(-14).reverse().map(e=>'<div class="evt">'+esc(e.ts.slice(5,19))+' <b>'+esc(e.type)+'</b> '+esc(JSON.stringify(e.data??{}).slice(0,110))+'</div>').join('')+'</div>'+
    '<h2>Capture log tail</h2><pre>'+esc(d.logTail||'(no capture log)')+'</pre>';
  if(draft&&draft.v){const c=$('#cmd');if(c&&!c.disabled){c.value=draft.v;if(draft.focus){c.focus();try{c.setSelectionRange(draft.s,draft.e);}catch{}}}}
  if(scroll)$('#right').scrollTop=0;
  loadTimeline(name);
}

function fmtDur(s){
  if(s==null) return '—';
  if(s<60) return s+'s';
  if(s<3600) return Math.round(s/60)+'m';
  return (s/3600).toFixed(1)+'h';
}

async function loadTimeline(name){
  const el=$('#tl'); if(!el) return;
  try{
    const t=await j('/api/timeline/'+encodeURIComponent(name));
    // The server says whether the days behind this timeline were all read. Nothing to say
    // renders NOTHING — no empty paragraph, no gap above the bars.
    const notes=(t.notes||[]).map(n=>'<p class="note">'+esc(n)+'</p>').join('');
    if(!t.spans.length && !t.marks.length){
      // An archive-only session HAS history: tmux-agent observed it and its own retention sweep
      // gzipped it. Telling that operator "spawned before tmux-agent existed" was a
      // confident wrong answer about our own data, so the note takes its place. With no archive
      // anywhere the sentence is still the true one — both branches stay, and both are pinned
      // (test/web-archived-session-views.test.js on the payload, browser audit T16 on the DOM).
      el.innerHTML=notes||'<p class="note">No ledger history yet for this session — timeline fills in as tmux-agent observes it (sessions spawned before tmux-agent existed have none).</p>';
      return;
    }
    const max=Math.max(1,...t.spans.map(s=>s.seconds||0));
    const bars=t.spans.slice().reverse().map(s=>{
      const w=Math.max(3,Math.round(220*(s.seconds||0)/max));
      return '<div class="row"><span class="st">'+esc(s.state)+'</span>'+
        '<span class="bar '+esc(s.state)+'" style="width:'+w+'px"></span>'+
        '<span class="dur">'+fmtDur(s.seconds)+'</span>'+
        '<span class="when">'+esc(s.from.slice(11,19))+(s.note?' · now':'')+'</span></div>';
    }).join('');
    const marks=t.marks.slice(-10).reverse().map(m=>
      '<div class="mark">'+esc(m.ts.slice(11,19))+' <b>'+esc(m.type)+'</b> '+esc(m.detail||'')+'</div>').join('');
    el.innerHTML=notes+bars+(marks?'<div style="margin-top:6px">'+marks+'</div>':'');
  }catch(e){ el.innerHTML='<p class="note">timeline unavailable: '+esc(e.message??e)+'</p>'; }
}

window.sendCmd=async()=>{
  const t=$('#cmd').value; if(!t||!SEL)return;
  try{
    const r=await j('/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:SEL,text:t})});
    $('#cmd').value=''; if(!r.verified)$('#err').textContent='send not verified — input may not have landed';
    setTimeout(()=>detail(SEL,false),800);
  }catch(e){$('#err').textContent=String(e.message??e)}
};

// ── controls ────────────────────────────────────────────────────────────────
function setTimer(){
  if(TIMER) clearInterval(TIMER);
  TIMER = V.auto ? setInterval(refresh,5000) : null;
  const b=$('#autorefresh');
  b.classList.toggle('on',V.auto);
  b.setAttribute('aria-pressed',String(V.auto));
  b.textContent = V.auto ? 'auto-refresh 5s' : 'auto-refresh OFF';
}

$('#q').value=V.q;
$('#q').addEventListener('input',e=>{ V.q=e.target.value; saveV(); renderAll(); });

document.querySelectorAll('.chip[data-state]').forEach(b=>{
  const st=b.getAttribute('data-state');
  b.classList.toggle('on',!!V.states[st]);
  b.setAttribute('aria-pressed',String(!!V.states[st]));
  b.addEventListener('click',()=>{
    V.states[st]=!V.states[st]; saveV();
    b.classList.toggle('on',!!V.states[st]);
    b.setAttribute('aria-pressed',String(!!V.states[st]));
    renderAll();
  });
});

document.querySelectorAll('.chip[data-eng]').forEach(b=>{
  const k=b.getAttribute('data-eng');
  V.eng=V.eng||{}; if(V.eng[k]===undefined) V.eng[k]=1;
  b.classList.toggle('on',!!V.eng[k]); b.setAttribute('aria-pressed',String(!!V.eng[k]));
  b.addEventListener('click',()=>{
    V.eng[k]=V.eng[k]?0:1; saveV();
    b.classList.toggle('on',!!V.eng[k]); b.setAttribute('aria-pressed',String(!!V.eng[k]));
    renderAll();
  });
});

$('#theme').addEventListener('click',()=>{
  const t=document.documentElement.dataset.theme==='light'?'dark':'light';
  localStorage.setItem(TK,t); applyTheme(t);
});
$('#autorefresh').addEventListener('click',()=>{ V.auto=!V.auto; saveV(); setTimer(); });
$('#refreshnow').addEventListener('click',()=>refresh());
$('#collapse').addEventListener('click',()=>{
  V.collapse=!V.collapse; saveV();
  const b=$('#collapse');
  b.classList.toggle('on',V.collapse); b.setAttribute('aria-pressed',String(V.collapse));
  renderAll();
});
{ const b=$('#collapse'); b.classList.toggle('on',V.collapse); b.setAttribute('aria-pressed',String(V.collapse)); }

// attention banner doubles as a one-click filter to exactly the sessions that need action
$('#attn').addEventListener('click',()=>{
  V.q=''; $('#q').value='';
  for(const k of Object.keys(V.states)) V.states[k]=(k==='ERROR'||k==='BLOCKED');
  saveV();
  document.querySelectorAll('.chip[data-state]').forEach(b=>{
    const on=!!V.states[b.getAttribute('data-state')];
    b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on));
  });
  renderAll();
});

// sortable table headers (click toggles direction)
document.querySelectorAll('#hist th.sortable, #waste th.sortable, #mem th.sortable').forEach(th=>{
  th.addEventListener('click',()=>{
    const tbl={hist:'histSort',waste:'wasteSort',mem:'memSort'}[th.closest('table').id];
    const k=th.getAttribute('data-k');
    V[tbl] = (V[tbl].k===k) ? {k,dir:-V[tbl].dir} : {k,dir:1};
    saveV();
    th.closest('thead').querySelectorAll('th').forEach(o=>o.classList.remove('asc','desc'));
    th.classList.add(V[tbl].dir>0?'asc':'desc');
    renderAll();
  });
});

// ── keyboard navigation: this UI was mouse-only ──────────────────────────────
document.addEventListener('keydown',e=>{
  const typing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'');
  if(e.key==='/' && !typing){ e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
  if(e.key==='Escape'){ if(typing){ document.activeElement.blur(); } return; }
  if(typing) return;
  const nodes=[...document.querySelectorAll('#tree .node')];
  if(!nodes.length) return;
  const names=nodes.map(n=>n.getAttribute('data-session'));
  let i=SEL?Math.max(0,names.indexOf(SEL)):-1;
  if(e.key==='j'||e.key==='ArrowDown'){ e.preventDefault(); i=Math.min(nodes.length-1,i+1); }
  else if(e.key==='k'||e.key==='ArrowUp'){ e.preventDefault(); i=Math.max(0,i-1); }
  else if(e.key==='Enter'&&i>=0){ e.preventDefault(); window.pick(names[i]); return; }
  else if(e.key==='r'){ e.preventDefault(); refresh(); return; }
  else return;
  window.select(names[i]);
  nodes[i]?.scrollIntoView({block:'nearest'});
});

refresh(); setTimer();
</script></body></html>`;

/**
 * The 401 page. Reported live as "I click on tmux and nothing happens / the button is not
 * working": opening the dashboard without a token returned raw JSON, which a browser renders as
 * a line of text — no UI, nothing clickable. Indistinguishable from a crashed app, and the fix
 * (a token in the URL) was invisible. This page states the problem, shows the exact command to
 * get the token, and offers a paste box that reloads with it applied.
 */
/** HTML-escape a string the server interpolates into the page (the access note's environment-supplied text). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The slot in DASHBOARD_HTML's detail-pane note that `GET /` fills with accessNote(). How a person reaches
 * this UI is a deployment fact the template cannot know — the port the socket actually bound, or a proxy in
 * front of it — so the sentence is rendered per request rather than baked in. Until this change the template said
 * `ssh -L 7337:localhost:7337` whatever `--port` bound, and a harness that serves the page through its own
 * proxy (a harness home page that mounts it under /tmux-agent/, 7337 never published) showed its users a tunnel they could
 * not use.
 */
export const ACCESS_NOTE_SLOT = "<!--access-note-->";

export interface AccessNoteOpts {
  /** the port the listener bound — server.address().port, never the one asked for */
  port: number;
  /** TMUX_AGENT_PUBLIC_HINT: a sentence that replaces the loopback one when the UI is served another way; shown escaped, verbatim */
  publicHint?: string;
  /** TMUX_AGENT_PUBLIC_URL: where the UI is served; used when no hint is set */
  publicUrl?: string;
}

/**
 * The access sentence of the detail-pane note. A hint wins over a URL; either hides the `ssh -L` form, because
 * when something else serves the page the tunnel instruction is wrong for the person reading it. With both unset
 * the sentence is the loopback one with the REAL bound port. Pure: the CLI reads the two environment knobs and
 * passes them through WebOpts; nothing here reads process.env.
 */
export function accessNote(o: AccessNoteOpts): string {
  const hint = o.publicHint?.trim();
  if (hint) return esc(hint);
  const url = o.publicUrl?.trim();
  if (url) return `This UI is served at <b>${esc(url)}</b>.`;
  return `This UI is loopback-only — reach it via <b>ssh -L ${o.port}:localhost:${o.port} &lt;host&gt;</b>.`;
}

/**
 * DASHBOARD_HTML with its access-note slot filled — the document `GET /` serves. A FUNCTION replacer, on purpose: with a
 * string replacement String.prototype.replace reads `$&`, `$'`, `` $` ``, `$$` and `$n` inside the operator's text as
 * replacement patterns — measured on an earlier build, a hint `cost $' end` spliced the whole template remainder into the note
 * (GET / 40,875 → 68,059 bytes, two </html>) while the literal vanished. The replacer returns the note verbatim.
 */
export function renderDashboardHtml(o: AccessNoteOpts): string {
  const note = accessNote(o);
  return DASHBOARD_HTML.replace(ACCESS_NOTE_SLOT, () => note);
}

export const UNAUTHORIZED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>tmux-agent — token required</title>
<style>
  :root{--bg:#0f1420;--panel:#171e2e;--line:#2a3550;--fg:#dbe4f4;--dim:#8494b4;--acc:#5b8def;--warn:#e0a13a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:680px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:26px}
  h1{font-size:17px;margin:0 0 4px}
  .sub{color:var(--warn);font-size:13px;margin-bottom:16px}
  p{margin:12px 0;color:var(--fg)}
  .note{color:var(--dim);font-size:12.5px}
  pre{background:#0a0e18;border:1px solid var(--line);border-radius:8px;padding:11px;
      overflow:auto;font-size:12.5px;margin:8px 0}
  .row{display:flex;gap:8px;margin-top:18px}
  input{flex:1;background:#0a0e18;border:1px solid var(--line);border-radius:6px;
        color:var(--fg);padding:10px;font:inherit}
  button{background:var(--acc);border:0;border-radius:6px;color:#fff;padding:10px 18px;
         font:inherit;cursor:pointer}
  :focus-visible{outline:2px solid var(--acc);outline-offset:1px}
  ol{margin:10px 0 0 18px;padding:0} li{margin:6px 0}
</style></head><body>
<main class="card" role="main">
  <h1>tmux-agent dashboard</h1>
  <div class="sub">401 — this dashboard needs its access token</div>

  <p>The dashboard can type into your agent sessions, so it is not open even on loopback:
  any other local user or process could otherwise drive your fleet. Nothing is broken.</p>

  <ol>
    <li>On the host, print the token:
      <pre>cat ~/.tmux-agent/web-token</pre></li>
    <li>Paste it below, or open the URL the server printed at startup
      (<span class="note">it already contains <code>?token=…</code></span>).</li>
  </ol>

  <div class="row">
    <input id="tok" type="password" placeholder="paste token" aria-label="Access token" autocomplete="off" autofocus/>
    <button id="go">Open dashboard</button>
  </div>
  <p class="note">Tip: <code>--no-token</code> disables this on a single-user machine.
  Remote access should always be an SSH tunnel, never a public bind.</p>
</main>
<script>
  const go=()=>{
    const t=document.getElementById('tok').value.trim();
    if(t) location.href='/?token='+encodeURIComponent(t);
  };
  document.getElementById('go').addEventListener('click',go);
  document.getElementById('tok').addEventListener('keydown',e=>{ if(e.key==='Enter') go(); });
</script></body></html>`;
