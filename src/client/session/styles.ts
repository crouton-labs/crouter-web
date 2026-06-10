/**
 * Co-located CSS for the session render layer (message list, blocks, tool
 * cards). Injected ONCE into the document head on first import. Kept lean and
 * scoped under `.cw-*` class names; the orchestrator owns global app-shell
 * styling, so nothing here sets page-level layout.
 */

let injected = false;

const CSS = `
.cw-msglist { display:flex; flex-direction:column; height:100%; overflow:auto; padding:8px 0; }
.cw-msglist-inner { position:relative; width:100%; }
.cw-row { padding:6px 14px; box-sizing:border-box; }
.cw-msg { font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; word-break:break-word; }
.cw-msg-user { background:var(--cw-user-bg,#1e2733); border-radius:8px; padding:8px 12px; }
.cw-role { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin-bottom:4px; }

.cw-md { white-space:normal; }
.cw-md pre { overflow:auto; padding:10px 12px; border-radius:6px; background:var(--cw-code-bg,#11161c); }
.cw-md code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
.cw-md :not(pre) > code { background:var(--cw-inline-code,#222b35); padding:1px 5px; border-radius:4px; }
.cw-md p { margin:.4em 0; }
.cw-md a { color:var(--cw-link,#6cb6ff); }
.cw-stream-text { white-space:pre-wrap; font-family:inherit; }

.cw-think { border-left:3px solid var(--cw-think,#7d5bbe); background:var(--cw-think-bg,#1a1622); border-radius:0 6px 6px 0; margin:6px 0; }
.cw-think-head { cursor:pointer; user-select:none; padding:5px 10px; font-size:12px; opacity:.8; display:flex; gap:6px; align-items:center; }
.cw-think-body { padding:2px 12px 10px 12px; white-space:pre-wrap; font-size:13px; opacity:.85; }
.cw-caret { transition:transform .12s; display:inline-block; }
.cw-caret-open { transform:rotate(90deg); }

.cw-img { display:block; max-width:min(100%,520px); max-height:420px; border-radius:6px; margin:6px 0; object-fit:contain; }

.cw-card { border:1px solid var(--cw-card-bd,#2a3340); border-radius:8px; margin:6px 0; overflow:hidden; background:var(--cw-card-bg,#161b22); }
.cw-card-err { border-color:var(--cw-err,#c0392b); }
.cw-card-head { display:flex; align-items:center; gap:8px; padding:6px 10px; background:var(--cw-card-head,#1c2330); font-size:12.5px; }
.cw-card-tool { font-weight:600; font-family:ui-monospace,Menlo,monospace; }
.cw-card-sub { opacity:.6; font-family:ui-monospace,Menlo,monospace; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cw-pill { margin-left:auto; font-size:10.5px; padding:1px 7px; border-radius:10px; white-space:nowrap; }
.cw-pill-run { background:#243a52; color:#7fb3ff; }
.cw-pill-err { background:#3a1f1f; color:#ff8a80; }
.cw-pill-ok { background:#1f3a28; color:#7fd6a0; }
.cw-card-body { padding:0; }
.cw-term { margin:0; padding:9px 11px; background:#0c0f13; color:#d6dde6; font-family:ui-monospace,Menlo,monospace; font-size:12px; white-space:pre-wrap; overflow:auto; max-height:420px; }
.cw-term-err { color:#ff9b8a; }
.cw-args { margin:0; padding:8px 11px; background:#11161c; font-family:ui-monospace,Menlo,monospace; font-size:11.5px; white-space:pre-wrap; overflow:auto; max-height:240px; border-bottom:1px solid #222b35; }
.cw-diff { margin:0; font-family:ui-monospace,Menlo,monospace; font-size:12px; overflow:auto; max-height:460px; }
.cw-diff-line { padding:0 11px; white-space:pre-wrap; }
.cw-diff-add { background:rgba(46,160,67,.18); color:#aef0bf; }
.cw-diff-del { background:rgba(192,57,43,.18); color:#ffb4ab; }
.cw-diff-ctx { opacity:.7; }
.cw-grep-file { padding:4px 11px; font-family:ui-monospace,Menlo,monospace; font-size:12px; opacity:.85; }
.cw-spinner { width:9px; height:9px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; display:inline-block; animation:cw-spin .7s linear infinite; }
@keyframes cw-spin { to { transform:rotate(360deg); } }
.cw-empty { padding:8px 11px; opacity:.5; font-size:12px; font-style:italic; }
.cw-stream-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#7fb3ff; margin-left:6px; animation:cw-pulse 1s ease-in-out infinite; }
@keyframes cw-pulse { 0%,100%{opacity:.3;} 50%{opacity:1;} }
`;

export function ensureStyles(): void {
  if (injected) return;
  injected = true;
  if (typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-cw', 'session');
  el.textContent = CSS;
  document.head.appendChild(el);
}
