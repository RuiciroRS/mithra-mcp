// Activity feed — a side panel listing what agents are doing, one row per tool call.
//
// hooks/feed.mjs writes a "start" line when a tool is about to run and an "end"
// line when it returns (or fails). The server follows that file and pushes lines
// over the WebSocket at /feed. Here each start becomes a row, and its end updates
// the same row in place, matched by tool_use_id. A start with no end is shown as
// running; after STALE_MS it is shown as "no end" instead, because an end that
// never arrived (a crashed session, a hook that timed out) must not read as work
// in progress forever.
(function () {
  const STALE_MS = 10 * 60 * 1000;
  const MAX_ROWS = 200;
  const STORE_KEY = 'mithra.feed.open';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // t() and CONFIG come from app.js; init() runs after its config has loaded.
  const tr = (k, v) => (typeof t === 'function' ? t(k, v) : k);
  const hms = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour12: false }); } catch { return '--:--:--'; } };

  function dur(ms) {
    if (!Number.isFinite(ms)) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  // mcp__server__tool -> "server · tool"; everything else as-is.
  function toolLabel(tool) {
    const m = /^mcp__(.+?)__(.+)$/.exec(tool || '');
    return m ? `${m[1]} · ${m[2]}` : (tool || '?');
  }

  let root, listEl, stateEl, pauseBtn, newEl;
  const calls = new Map();   // key -> { start, end, el }
  const order = [];          // keys, newest first
  let paused = false, hoverPause = false, queued = [];
  let ws = null, retry = 0, status = 'connecting', inited = false;

  const keyOf = (e) => e.id || `${e.ts}|${e.tool}|${e.session}`;

  function rowState(c) {
    const e = c.end, s = c.start;
    if (e) {
      if (e.ok === false) return e.interrupted ? 'interrupted' : 'failed';
      if ((e.tool || s?.tool) === 'Agent') return 'launched'; // Agent returns as soon as a background agent starts
      return 'ok';
    }
    return Date.now() - Date.parse(s.ts) > STALE_MS ? 'stale' : 'running';
  }

  function statusText(c, st) {
    switch (st) {
      case 'running': return `${tr('feed_running')} ${dur(Date.now() - Date.parse(c.start.ts))}`;
      case 'stale': return tr('feed_stale');
      case 'failed': return `✕ ${tr('feed_failed')} ${dur(c.end.ms)}`;
      case 'interrupted': return `■ ${tr('feed_interrupted')}`;
      case 'launched': return `↗ ${tr('feed_launched')}`;
      default: return `✓ ${dur(c.end.ms)}`;
    }
  }

  function paint(c) {
    const e = c.start || c.end;
    const st = rowState(c);
    const handback = e.tool === 'SubagentHandback';
    const who = e.agent || tr('feed_main');
    const detail = handback ? tr('feed_handback') : e.summary;
    const err = c.end?.error ? `<div class="fd-err">${esc(c.end.error)}</div>` : '';
    c.el.className = `fd-row st-${st}`;
    c.el.title = [e.summary, c.end?.error].filter(Boolean).join('\n\n');
    c.el.innerHTML =
      `<div class="fd-head"><span class="fd-time">${hms(e.ts)}</span>` +
      `<span class="fd-who">${esc(who)}</span>` +
      `<span class="fd-st"${st === 'stale' ? ` title="${esc(tr('feed_stale_t'))}"` : ''}>${esc(statusText(c, st))}</span></div>` +
      `<div class="fd-tool">${esc(handback ? '↩' : toolLabel(e.tool))}</div>` +
      `<div class="fd-sum">${esc(detail)}</div>` + err;
  }

  function addRow(key, c) {
    c.el = document.createElement('div');
    paint(c);
    listEl.prepend(c.el);
    order.unshift(key);
    while (order.length > MAX_ROWS) {
      const old = order.pop();
      calls.get(old)?.el?.remove();
      calls.delete(old);
    }
  }

  function ingest(e) {
    const key = keyOf(e);
    const c = calls.get(key);
    if (c) {
      // An end for a row already on screen updates it in place, even while paused:
      // it doesn't move anything, and a paused panel should still say what finished.
      if (e.phase === 'end') c.end = e; else c.start = e;
      if (c.el) paint(c);
      return;
    }
    const fresh = e.phase === 'end' ? { start: null, end: e } : { start: e, end: null };
    calls.set(key, fresh);
    if (paused || hoverPause) { queued.push(key); renderNew(); return; }
    addRow(key, fresh);
    renderEmpty();
  }

  function flush() {
    const keys = queued; queued = [];
    for (const k of keys) { const c = calls.get(k); if (c && !c.el) addRow(k, c); }
    renderNew(); renderEmpty();
  }

  function renderNew() {
    newEl.textContent = queued.length ? tr('feed_new', { n: queued.length }) : '';
  }

  function renderEmpty() {
    const empty = listEl.querySelector('.fd-empty');
    if (order.length && empty) empty.remove();
    if (!order.length && !empty) listEl.innerHTML = `<div class="fd-empty">${esc(tr('feed_empty'))}</div>`;
  }

  function renderStatus() {
    const txt = { live: 'feed_live', nofile: 'feed_nofile', off: 'feed_off', down: 'feed_disconnected', connecting: 'loading' }[status];
    stateEl.className = `fd-state s-${status}`;
    stateEl.textContent = `${status === 'live' ? '●' : status === 'down' ? '✕' : '○'} ${tr(txt)}`;
  }

  function setPaused(p) {
    paused = p;
    pauseBtn.textContent = paused ? '▶' : '⏸';
    pauseBtn.title = tr(paused ? 'feed_resume' : 'feed_pause');
    if (!paused && !hoverPause) flush();
  }

  function connect() {
    if (typeof CONFIG !== 'undefined' && CONFIG.hasFeed === false) { status = 'off'; renderStatus(); return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/feed`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.t === 'feed-status') {
        status = msg.enabled === false ? 'off' : msg.exists ? 'live' : 'nofile';
        renderStatus();
      } else if (msg.t === 'feed-backlog' || msg.t === 'feed') {
        for (const e of msg.items || []) ingest(e);
      }
    };
    ws.onclose = () => {
      status = 'down'; renderStatus();
      setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
    };
  }

  function setOpen(open) {
    root.classList.toggle('collapsed', !open);
    try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch {}
  }

  function init() {
    if (inited) return; inited = true;
    root = document.getElementById('feed');
    if (!root) return;
    root.innerHTML =
      `<div class="fd-bar"><span class="fd-title">${esc(tr('feed_title'))}</span>` +
      `<span class="fd-state"></span><span class="fd-new"></span>` +
      `<button class="fd-pause" type="button">⏸</button></div>` +
      `<div class="fd-list"></div>`;
    listEl = root.querySelector('.fd-list');
    stateEl = root.querySelector('.fd-state');
    pauseBtn = root.querySelector('.fd-pause');
    newEl = root.querySelector('.fd-new');
    pauseBtn.onclick = () => setPaused(!paused);
    newEl.onclick = () => setPaused(false);
    // Hovering the list holds new rows back, so the one being read doesn't slide away.
    listEl.addEventListener('mouseenter', () => { hoverPause = true; });
    listEl.addEventListener('mouseleave', () => { hoverPause = false; if (!paused) flush(); });
    setPaused(false);
    renderStatus(); renderEmpty();

    let open = false;
    try { open = localStorage.getItem(STORE_KEY) === '1'; } catch {}
    setOpen(open);
    const btn = document.getElementById('feed-toggle');
    if (btn) btn.onclick = () => setOpen(root.classList.contains('collapsed'));

    // Running rows show elapsed time and turn stale after STALE_MS; nothing else repaints.
    setInterval(() => {
      for (const c of calls.values()) if (c.el && !c.end) paint(c);
    }, 1000);

    connect();
  }

  window.MithraFeed = { init };
})();
