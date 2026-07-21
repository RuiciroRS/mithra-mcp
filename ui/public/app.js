// Mithra UI — front panel-first.
// Project rail -> per-project tabs (Summary with docs+git+deploy) + terminal in a drawer.

// -------------------------------------------------------------- Config/i18n --
// Everything user-specific comes from /api/config (language, theme, skills, name).
let CONFIG = { appName: "Mithra", lang: "en", theme: "solar", skills: [], hasVault: true, boardFile: "Board.md", tasksFile: "TASKS.md", projectsMode: "explicit", claudeReady: true };
let SKILLS = [];                              // filled in from CONFIG.skills
let TERM_THEME = (window.TERMINAL_THEMES || {}).solar; // xterm colors for the active theme

// t('key', {n: 3}) -> localized string with {placeholders} interpolated.
function t(key, vars) {
  const dict = (window.I18N && window.I18N[CONFIG.lang]) || (window.I18N && window.I18N.en) || {};
  let s = dict[key] != null ? dict[key] : ((window.I18N && window.I18N.en && window.I18N.en[key]) || key);
  if (vars) for (const k in vars) s = s.replaceAll("{" + k + "}", vars[k]);
  return s;
}

// Applies the data-i18n / data-i18n-title / data-i18n-ph texts from index.html.
function applyI18nDOM() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}

// Fetches the config from the server and applies language + theme + name + skills.
async function initConfig() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) CONFIG = { ...CONFIG, ...(await r.json()) };
  } catch { /* fall back to defaults */ }
  document.documentElement.lang = CONFIG.lang;
  document.documentElement.dataset.theme = CONFIG.theme || "solar";
  TERM_THEME = (window.TERMINAL_THEMES || {})[CONFIG.theme] || (window.TERMINAL_THEMES || {}).solar;
  SKILLS = Array.isArray(CONFIG.skills) ? CONFIG.skills : [];
  const brand = document.getElementById("brand-name");
  if (brand) brand.textContent = (CONFIG.appName || "Mithra").toUpperCase();
  document.title = CONFIG.appName || "Mithra";
  applyI18nDOM();
  renderChips();
}

// Multi-terminal: several claude.exe sessions at once (e.g. one per project).
// Each one = its own xterm + WebSocket + pty on the server (anchored via ?dir=).
const statusEl = document.getElementById("status");
function setStatus(ok) { statusEl.style.color = ok ? "#f5c542" : "#7a5a2a"; }

let terminals = [];   // {id, dir, term, fit, ws, reconnectTimer, el, closing}
let activeTermId = null;
let termSeq = 0;

function makeTerminal(dir) {
  const id = ++termSeq;
  const el = document.createElement("div");
  el.className = "term-pane";
  document.getElementById("term-stack").appendChild(el);
  const term = new Terminal({
    fontFamily: '"Cascadia Code","Cascadia Mono",Consolas,monospace',
    fontSize: 14, cursorBlink: true, allowProposedApi: true, allowTransparency: true, theme: TERM_THEME,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  el.addEventListener("mousedown", () => term.focus());
  const t = { id, dir: dir || null, term, fit, ws: null, reconnectTimer: null, el, closing: false };
  term.onData((d) => { if (t.ws && t.ws.readyState === 1) t.ws.send(JSON.stringify({ t: "i", d })); });
  terminals.push(t);
  connectTerm(t);
  setActiveTerm(id);
  return t;
}
// WebSocket with auto-reconnect: if claude.exe exits or dies, it retries on its own.
function connectTerm(t) {
  const url = `ws://${location.host}/${t.dir ? `?dir=${encodeURIComponent(t.dir)}` : ""}`;
  t.ws = new WebSocket(url);
  t.ws.onopen = () => { if (t.id === activeTermId) { setStatus(true); fitTerm(t); } };
  t.ws.onclose = () => { if (t.id === activeTermId) setStatus(false); scheduleReconnectTerm(t); };
  t.ws.onerror = () => { if (t.id === activeTermId) setStatus(false); };
  t.ws.onmessage = (e) => {
    if (typeof e.data === "string") t.term.write(e.data);
    else if (e.data instanceof Blob) e.data.text().then((x) => t.term.write(x));
  };
}
function scheduleReconnectTerm(t) {
  if (t.reconnectTimer || t.closing) return;
  t.reconnectTimer = setTimeout(() => { t.reconnectTimer = null; if (!t.closing) connectTerm(t); }, 1200);
}
// Only fit while the drawer is visible (if height=0, xterm sizes itself to 0 rows).
function fitTerm(t) {
  if (!t || drawer.classList.contains("collapsed")) return;
  try { t.fit.fit(); } catch {}
  if (t.ws && t.ws.readyState === 1) t.ws.send(JSON.stringify({ t: "r", cols: t.term.cols, rows: t.term.rows }));
}
function activeTerm() { return terminals.find((t) => t.id === activeTermId); }
function setActiveTerm(id) {
  activeTermId = id;
  terminals.forEach((t) => t.el.classList.toggle("active", t.id === id));
  renderTermTabs();
  const t = activeTerm();
  if (t) { setStatus(t.ws && t.ws.readyState === 1); fitTerm(t); t.term.focus(); }
  else setStatus(false);
}
function termLabel(tm) {
  if (!tm.dir) return "⌂ root";
  return (DATA && DATA.projects.find((p) => p.dir === tm.dir)?.name) || tm.dir;
}
function renderTermTabs() {
  const el = document.getElementById("term-tabs");
  if (!el) return;
  el.innerHTML = terminals.map((tm) =>
    `<span class="tt ${tm.id === activeTermId ? "active" : ""}" data-id="${tm.id}">
       <span class="tt-name">📁 ${esc(termLabel(tm))}</span>
       <span class="tt-x" data-close="${tm.id}" title="${esc(t("close"))}">✕</span>
     </span>`).join("") + `<button class="tt-add" id="tt-add" title="${esc(t("new_terminal"))}">＋</button>`;
  el.querySelectorAll(".tt[data-id]").forEach((b) => {
    b.onclick = (e) => {
      const close = e.target.getAttribute("data-close");
      if (close) { closeTerminal(Number(close)); return; }
      setActiveTerm(Number(b.dataset.id));
    };
  });
  const add = document.getElementById("tt-add");
  if (add) add.onclick = () => openTerminalForCurrent(true);
}
function closeTerminal(id) {
  const i = terminals.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = terminals[i];
  t.closing = true;
  if (t.reconnectTimer) clearTimeout(t.reconnectTimer);
  try { if (t.ws) t.ws.close(); } catch {}
  try { t.term.dispose(); } catch {}
  t.el.remove();
  terminals.splice(i, 1);
  if (activeTermId === id) {
    if (terminals.length) setActiveTerm(terminals[terminals.length - 1].id);
    else { activeTermId = null; setStatus(false); }
  } else renderTermTabs();
}
// Opens (or focuses) a terminal for the active project. force=true always creates a new one.
function openTerminalForCurrent(force) {
  openDrawer();
  const dir = current || null;
  if (!force) {
    const existing = terminals.find((t) => t.dir === dir);
    if (existing) { setActiveTerm(existing.id); return; }
  }
  makeTerminal(dir);
}

// Skill chips (they live in the drawer) — rendered once CONFIG.skills has loaded.
function renderChips() {
  const chipsEl = document.getElementById("chips");
  if (!chipsEl) return;
  chipsEl.innerHTML = "";
  for (const s of SKILLS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = s.label;
    b.title = s.cmd.trim();
    b.onclick = () => {
      openDrawer();
      const tm = activeTerm();
      if (tm && tm.ws && tm.ws.readyState === 1) tm.ws.send(JSON.stringify({ t: "i", d: s.cmd }));
      if (tm) tm.term.focus();
    };
    chipsEl.appendChild(b);
  }
}

// -------------------------------------------------------------- Term drawer --
const drawer = document.getElementById("drawer");
function openDrawer() {
  if (!drawer.classList.contains("collapsed")) return;
  drawer.classList.remove("collapsed");
  // The drawer animates its height (0 -> 46vh) over 180ms. If we measure sooner, fit sees ~0px.
  // We wait for the transition to end; fallback in case transitionend never fires.
  let done = false;
  const finish = () => { if (done) return; done = true; const t = activeTerm(); fitTerm(t); if (t) t.term.focus(); };
  drawer.addEventListener("transitionend", function te(e) {
    if (e.propertyName === "height") { drawer.removeEventListener("transitionend", te); finish(); }
  });
  setTimeout(finish, 240);
}
function closeDrawer() { drawer.classList.add("collapsed"); const t = activeTerm(); if (t) t.term.blur(); }
function toggleDrawer() { drawer.classList.contains("collapsed") ? openDrawer() : closeDrawer(); }
document.getElementById("term-toggle").onclick = toggleDrawer;
document.getElementById("drawer-close").onclick = closeDrawer;

// "↻ here" = opens/focuses the terminal for the active project (everything else is handled with tabs).
const termHereBtn = document.getElementById("term-here");
if (termHereBtn) termHereBtn.onclick = () => openTerminalForCurrent(false);
addEventListener("resize", () => fitTerm(activeTerm()));
addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "ñ" || e.key === "Ñ" || e.code === "Semicolon")) { e.preventDefault(); toggleDrawer(); }
});

// --------------------------------------------------- WORKING_MEMORY panel ---
// Overlay with Mithra's volatile memory layer + capacity bar (green/amber/red).
const wmOverlay = document.getElementById("wm-overlay");
const wmBtn = document.getElementById("wm-btn");
async function openWorkingMemory() {
  wmOverlay.classList.remove("hidden");
  const body = document.getElementById("wm-body");
  body.innerHTML = `<div class="rail-loading">${esc(t("loading"))}</div>`;
  try {
    renderWM(await getJSON("/api/workingmemory"), false);
  } catch (e) {
    body.innerHTML = `<div class="v-error">${esc(t("wm_read_err", { e: String(e.message || e) }))}</div>`;
  }
}
function wmTier(pct) { return pct >= 80 ? "wm-red" : pct >= 60 ? "wm-amber" : "wm-green"; }
function wmMeter(len, cap) {
  const pct = Math.round((len / cap) * 100);
  return `<div class="wm-meter">
    <div class="wm-bar"><span class="wm-fill ${wmTier(pct)}" style="width:${Math.min(100, pct)}%"></span></div>
    <div class="wm-meta">${esc(t("wm_meter", { len, cap, pct }))}</div>
  </div>`;
}
function renderWM(d, editing) {
  const body = document.getElementById("wm-body");
  if (editing) {
    body.innerHTML = `
      <div id="wm-meter-wrap">${wmMeter(d.body.length, d.cap)}</div>
      <textarea id="wm-edit" class="wm-edit" spellcheck="false">${esc(d.body)}</textarea>
      <div class="wm-actions">
        <button class="bar-btn" id="wm-save">${esc(t("wm_save"))}</button>
        <button class="bar-btn" id="wm-cancel">${esc(t("wm_cancel"))}</button>
      </div>`;
    const ta = document.getElementById("wm-edit");
    const wrap = document.getElementById("wm-meter-wrap");
    ta.oninput = () => { wrap.innerHTML = wmMeter(ta.value.trim().length, d.cap); };
    ta.focus();
    document.getElementById("wm-cancel").onclick = () => renderWM(d, false);
    document.getElementById("wm-save").onclick = async () => {
      const btn = document.getElementById("wm-save");
      btn.disabled = true; btn.textContent = t("wm_saving");
      try {
        await postJSON("/api/workingmemory", { body: ta.value }, "PUT");
        renderWM(await getJSON("/api/workingmemory"), false);
      } catch (e) { btn.disabled = false; btn.textContent = t("wm_save"); alert(t("wm_save_err", { e: String(e.message || e) })); }
    };
  } else {
    const warn = d.pct >= 80 ? `<div class="wm-warn">${esc(t("wm_warn", { pct: d.pct }))}</div>` : "";
    const bodyHtml = d.body && d.body.trim() ? renderMarkdown(d.body) : `<div class="c-empty">${esc(t("wm_empty"))}</div>`;
    body.innerHTML = `
      ${wmMeter(d.len, d.cap)}
      ${warn}
      <div class="wm-toolbar"><button class="bar-btn" id="wm-edit-btn">${esc(t("wm_edit"))}</button></div>
      <div class="md wm-md">${bodyHtml}</div>`;
    document.getElementById("wm-edit-btn").onclick = () => renderWM(d, true);
  }
}
function closeWorkingMemory() { wmOverlay.classList.add("hidden"); }
if (wmBtn) wmBtn.onclick = openWorkingMemory;
wmOverlay?.addEventListener("click", (e) => { if (e.target === wmOverlay) closeWorkingMemory(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !wmOverlay.classList.contains("hidden")) closeWorkingMemory(); });

// ------------------------------------------------------------- Standup ------
// Cross-project daily summary: today's commits + open tasks + deploys that are down.
const standupOverlay = document.getElementById("standup-overlay");
const standupBtn = document.getElementById("standup-btn");
async function openStandup() {
  standupOverlay.classList.remove("hidden");
  const body = document.getElementById("standup-body");
  body.innerHTML = `<div class="rail-loading">${esc(t("loading"))}</div>`;
  try {
    const d = await getJSON("/api/standup");
    const totalCommits = d.projects.reduce((n, p) => n + p.commits.length, 0);
    const down = Object.entries(HEALTH).filter(([, v]) => !v.ok)
      .map(([k]) => (DATA && DATA.projects.find((p) => p.dir === k)?.name) || k);
    const rows = d.projects.map((p) => {
      if (!p.commits.length && !p.openTasks) return "";
      const commits = p.commits.length
        ? `<ul class="su-commits">${p.commits.map((c) => `<li><span class="c-hash">${esc(c.hash)}</span> <span class="su-msg">${esc(c.msg)}</span> <span class="su-ago">${esc(c.ago)}</span></li>`).join("")}</ul>`
        : `<div class="c-empty">${esc(t("su_no_commits"))}</div>`;
      return `<section class="card su-proj">
        <div class="su-h"><span>${esc(p.name)}</span><span class="su-meta">${esc(t("su_meta", { c: p.commits.length, t: p.openTasks || 0 }))}</span></div>
        ${commits}
      </section>`;
    }).join("");
    body.innerHTML = `
      <div class="su-top">
        <span class="pill pill-dirty">${esc(t("su_commits_today", { n: totalCommits }))}</span>
        ${down.length ? `<span class="pill pill-behind">${esc(t("su_down", { n: down.length, names: down.join(", ") }))}</span>` : `<span class="pill pill-clean">${esc(t("su_deploys_ok"))}</span>`}
        <span class="tk-src">${esc(d.today)}</span>
      </div>
      ${rows || `<div class="v-empty">${esc(t("su_nothing"))}</div>`}`;
  } catch (e) {
    body.innerHTML = `<div class="v-error">${esc(t("su_err", { e: String(e.message || e) }))}</div>`;
  }
}
if (standupBtn) standupBtn.onclick = openStandup;
standupOverlay?.addEventListener("click", (e) => { if (e.target === standupOverlay) standupOverlay.classList.add("hidden"); });

// -------------------------------------------------------- Commit & push -----
const commitOverlay = document.getElementById("commit-overlay");
async function openCommit(p) {
  commitOverlay.classList.remove("hidden");
  const body = document.getElementById("commit-body");
  body.innerHTML = `<div class="rail-loading">${esc(t("ci_loading"))}</div>`;
  try {
    const d = await getJSON(`/api/git/diff?dir=${encodeURIComponent(p.dir)}`);
    const filesHtml = d.files ? `<pre class="commit-files">${esc(d.files)}</pre>` : `<div class="c-empty">${esc(t("ci_nothing"))}</div>`;
    const diffLines = (d.diff || "").split("\n").length;
    body.innerHTML = `
      <div class="commit-h"><strong>${esc(p.name)}</strong> <span class="tk-src">⎇ ${esc(p.branch || "")}</span></div>
      ${filesHtml}
      <textarea id="commit-msg" class="commit-msg" placeholder="${esc(t("ci_msg_ph"))}" spellcheck="false"></textarea>
      <label class="commit-push"><input type="checkbox" id="commit-push" checked /> ${esc(t("ci_push"))}</label>
      <div class="wm-actions">
        <button class="bar-btn" id="commit-go">${esc(t("ci_go"))}</button>
        <button class="bar-btn" id="commit-cancel">${esc(t("ci_cancel"))}</button>
      </div>
      <details class="commit-diff-wrap"><summary>${esc(t("ci_see_diff", { n: diffLines }))}</summary><pre class="commit-diff">${esc(d.diff || t("ci_no_diff"))}</pre></details>`;
    document.getElementById("commit-cancel").onclick = () => commitOverlay.classList.add("hidden");
    document.getElementById("commit-go").onclick = async () => {
      const msg = document.getElementById("commit-msg").value.trim();
      const push = document.getElementById("commit-push").checked;
      if (!msg) { alert(t("ci_need_msg")); return; }
      const action = push ? t("ci_action_commit_push") : t("ci_action_commit");
      if (!confirm(t("ci_confirm", { action, name: p.name, msg }))) return; // explicit confirmation (this one reaches the outside world)
      const go = document.getElementById("commit-go");
      go.disabled = true; go.textContent = t("ci_running");
      try {
        const res = await postJSON("/api/git/commit", { dir: p.dir, message: msg, push });
        body.innerHTML = `<div class="commit-ok">✓ ${esc(res.steps.join(" → "))}${res.pushed ? esc(t("ci_pushed")) : ""}</div>`;
        setTimeout(() => { commitOverlay.classList.add("hidden"); loadProjects(); }, 1300);
      } catch (e) {
        go.disabled = false; go.textContent = t("ci_go");
        const err = document.createElement("div"); err.className = "v-error"; err.textContent = String(e.message || e);
        body.prepend(err);
      }
    };
  } catch (e) {
    body.innerHTML = `<div class="v-error">${esc(t("ci_diff_err", { e: String(e.message || e) }))}</div>`;
  }
}
commitOverlay?.addEventListener("click", (e) => { if (e.target === commitOverlay) commitOverlay.classList.add("hidden"); });

// ----------------------------------------------------- Command palette ------
const paletteOverlay = document.getElementById("palette-overlay");
function openPalette() {
  paletteOverlay.classList.remove("hidden");
  const input = document.getElementById("palette-input");
  input.value = ""; renderPalette(""); input.focus();
}
function closePalette() { paletteOverlay.classList.add("hidden"); }
function paletteItems() {
  const items = [];
  (DATA?.projects || []).forEach((p) => items.push({ label: p.name, hint: t("pal_project"), act: () => selectProject(p.dir) }));
  if (current) TABS.forEach((tb) => items.push({ label: t(tb.key), hint: t("pal_tab"), act: () => { activeTab = tb.id; try { localStorage.setItem("mithra.tab", activeTab); } catch {} renderTabs(); renderView(); } }));
  SKILLS.forEach((s) => items.push({ label: s.label, hint: t("pal_skill"), act: () => { openDrawer(); const tt = activeTerm(); if (tt && tt.ws && tt.ws.readyState === 1) tt.ws.send(JSON.stringify({ t: "i", d: s.cmd })); if (tt) tt.term.focus(); } }));
  items.push({ label: t("pal_wm"), hint: t("pal_panel"), act: openWorkingMemory });
  items.push({ label: t("pal_standup"), hint: t("pal_panel"), act: openStandup });
  return items;
}
let paletteFiltered = [], paletteSel = 0;
function renderPalette(q) {
  const lq = q.toLowerCase();
  paletteFiltered = paletteItems().filter((it) => it.label.toLowerCase().includes(lq) || it.hint.includes(lq));
  paletteSel = 0;
  const list = document.getElementById("palette-list");
  list.innerHTML = paletteFiltered.map((it, i) =>
    `<div class="pal-row ${i === 0 ? "active" : ""}" data-i="${i}"><span>${esc(it.label)}</span><span class="pal-hint">${esc(it.hint)}</span></div>`).join("")
    || `<div class="c-empty">${esc(t("pal_none"))}</div>`;
  list.querySelectorAll(".pal-row").forEach((r) => { r.onclick = () => runPalette(Number(r.dataset.i)); });
}
function runPalette(i) { const it = paletteFiltered[i]; closePalette(); if (it) it.act(); }
function movePalette(d) {
  if (!paletteFiltered.length) return;
  paletteSel = (paletteSel + d + paletteFiltered.length) % paletteFiltered.length;
  document.querySelectorAll("#palette-list .pal-row").forEach((r, i) => r.classList.toggle("active", i === paletteSel));
}
const palInput = document.getElementById("palette-input");
if (palInput) {
  palInput.oninput = () => renderPalette(palInput.value);
  palInput.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); }
    else if (e.key === "Enter") { e.preventDefault(); runPalette(paletteSel); }
    else if (e.key === "Escape") { closePalette(); }
  };
}
paletteOverlay?.addEventListener("click", (e) => { if (e.target === paletteOverlay) closePalette(); });
const paletteBtn = document.getElementById("palette-btn");
if (paletteBtn) paletteBtn.onclick = openPalette;

// Global shortcuts: Ctrl+K palette; Escape closes any open overlay.
addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    paletteOverlay.classList.contains("hidden") ? openPalette() : closePalette();
  } else if (e.key === "Escape") {
    [standupOverlay, commitOverlay, paletteOverlay].forEach((o) => o && o.classList.add("hidden"));
  }
});

// Ask for notification permission once (so we can warn about deploys going down).
try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch {}

// ----------------------------------------------------------------- Clock -----
const clockEl = document.getElementById("clock");
function tick() { clockEl.textContent = new Date().toLocaleTimeString(CONFIG.lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" }); }
tick(); setInterval(tick, 30000);

// --------------------------------------------------------- Minimal markdown --
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function inline(s) {
  // assumes the input is already escaped; applies emphasis/code/links
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
}
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0, inCode = false, listType = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  while (i < lines.length) {
    const raw = lines[i];
    // code fence
    if (/^```/.test(raw)) {
      if (!inCode) { closeList(); out.push("<pre><code>"); inCode = true; }
      else { out.push("</code></pre>"); inCode = false; }
      i++; continue;
    }
    if (inCode) { out.push(esc(raw)); i++; continue; }

    // GFM table
    if (/\|/.test(raw) && i + 1 < lines.length && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      closeList();
      const cells = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(raw);
      out.push("<table><thead><tr>" + head.map((c) => `<th>${inline(esc(c))}</th>`).join("") + "</tr></thead><tbody>");
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        out.push("<tr>" + cells(lines[i]).map((c) => `<td>${inline(esc(c))}</td>`).join("") + "</tr>");
        i++;
      }
      out.push("</tbody></table>");
      continue;
    }

    // heading
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); i++; continue; }
    // hr
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) { closeList(); out.push("<hr/>"); i++; continue; }
    // blockquote
    if (/^\s*>\s?/.test(raw)) { closeList(); out.push(`<blockquote>${inline(esc(raw.replace(/^\s*>\s?/, "")))}</blockquote>`); i++; continue; }
    // lists
    const ul = raw.match(/^\s*[-*]\s+(.*)$/);
    const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want; }
      out.push(`<li>${inline(esc((ul || ol)[1]))}</li>`);
      i++; continue;
    }
    // blank
    if (!raw.trim()) { closeList(); i++; continue; }
    // paragraph
    closeList(); out.push(`<p>${inline(esc(raw))}</p>`); i++;
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

// -------------------------------------------------------------- State/data --
let DATA = null;          // /api/projects response
let HEALTH = {};          // dir -> {ok, status, ms} from /api/health (deploys)
let current = localStorage.getItem("mithra.current") || null;   // remembered project
const TABS = [
  { id: "summary",  key: "tab_summary" },
  { id: "tasks",    key: "tab_tasks" },
  { id: "board",    key: "tab_board" },
  { id: "designs",  key: "tab_designs" },
  { id: "sessions", key: "tab_sessions" },
];
// Remembered tab, but only if it's still a real one: a stored id from an older
// build (or a hand-edited localStorage) would otherwise render an empty view.
const storedTab = localStorage.getItem("mithra.tab");
let activeTab = TABS.some((t) => t.id === storedTab) ? storedTab : "summary";

const railList = document.getElementById("rail-list");
const tabsEl = document.getElementById("tabs");
const viewEl = document.getElementById("view");
document.getElementById("refresh-all").onclick = loadProjects;

async function loadProjects() {
  railList.innerHTML = `<div class="rail-loading">${esc(t("loading"))}</div>`;
  try {
    const r = await fetch("/api/projects");
    if (!r.ok) throw new Error("HTTP " + r.status);
    DATA = await r.json();
    lastRefresh = Date.now();
    // No projects (empty auto-scan): show the first-run screen, not a silently empty rail.
    if (!DATA.projects.length) { railList.innerHTML = `<div class="rail-loading">—</div>`; renderFirstRun(); updateRefreshAgo(); return; }
    renderRail();
    // validate the remembered project; if it no longer exists, fall back to the first one
    if (!DATA.projects.some((p) => p.dir === current)) current = DATA.projects[0]?.dir || null;
    if (current) selectProject(current);
    updateRefreshAgo();
    loadHealth(); // in parallel: it doesn't block the rail render
  } catch (e) {
    railList.innerHTML = `<div class="v-error">${esc(t("err_state", { e: String(e.message || e) }))}</div>`;
  }
}

// Welcome screen when there are no projects (freshly cloned fork, root pointing at the wrong place).
function renderFirstRun() {
  viewEl.innerHTML = `
    <div class="firstrun">
      <div class="fr-sun">☉</div>
      <h2>${esc(t("firstrun_title"))}</h2>
      <p>${t("firstrun_body", { root: esc(DATA?.root || "root") })}</p>
      <p class="fr-hint">${t("firstrun_hint")}</p>
    </div>`;
}

// Deploy health (a separate endpoint so it doesn't slow the rail down). When it comes back,
// it re-renders the rail and, if you're on Summary, patches the pills (without touching the open doc).
let prevDown = null; // Set of dirs that were down on the previous check (null = not seeded yet)
async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    if (!r.ok) return;
    const d = await r.json();
    HEALTH = d.health || {};
    // Notify only on the ok -> down transition (not on the first check).
    const nowDown = new Set(Object.entries(HEALTH).filter(([, v]) => !v.ok).map(([k]) => k));
    if (prevDown !== null) nowDown.forEach((dir) => { if (!prevDown.has(dir)) notifyDown(dir); });
    prevDown = nowDown;
    if (DATA) renderRail();
    if (activeTab === "summary" && proj()) patchSummary(proj());
  } catch { /* silent: without health everything else still works */ }
}
function notifyDown(dir) {
  const name = (DATA && DATA.projects.find((p) => p.dir === dir)?.name) || dir;
  try {
    if (window.Notification && Notification.permission === "granted")
      new Notification(t("notify_down"), { body: name });
  } catch {}
  try { // soft solar beep
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 420; g.gain.value = 0.04;
    o.start(); setTimeout(() => { o.stop(); a.close(); }, 180);
  } catch {}
}

function renderRail() {
  railList.innerHTML = DATA.projects.map((p) => {
    const badge = p.error ? `<span class="dot dot-err"></span>`
      : p.type === "git"
        ? `<span class="dot ${p.dirty ? "dot-dirty" : "dot-clean"}"></span>`
        : `<span class="dot dot-fs"></span>`;
    const h = HEALTH[p.dir];
    // Deploy dot: green alive / red down. Only for projects that have a deploy.
    const healthDot = h ? `<span class="hdot ${h.ok ? "hdot-up" : "hdot-down"}" title="${h.ok ? "deploy " + esc(h.status) : esc(t("st_deploy_down"))}"></span>` : "";
    const sub = p.error ? t("st_error")
      : h && !h.ok ? t("st_deploy_down")
      : p.type === "git" ? (p.dirty ? t("st_uncommitted", { n: p.dirty }) : t("st_clean"))
      : t("st_files");
    return `<button class="rail-item ${p.dir === current ? "active" : ""}" data-dir="${esc(p.dir)}">
      ${badge}
      <span class="ri-name">${esc(p.name)}${healthDot}</span>
      <span class="ri-sub ${(p.error || (h && !h.ok)) ? "ri-sub-warn" : ""}">${esc(sub)}</span>
    </button>`;
  }).join("");
  railList.querySelectorAll(".rail-item").forEach((el) => {
    el.onclick = () => selectProject(el.dataset.dir);
  });
}

function selectProject(dir) {
  current = dir;
  try { localStorage.setItem("mithra.current", dir); } catch {}
  renderRail();
  renderTabs();
  renderView();
}

function renderTabs() {
  tabsEl.innerHTML = TABS.map((tb) =>
    `<button class="tab ${tb.id === activeTab ? "active" : ""}" data-tab="${tb.id}">${esc(t(tb.key))}</button>`
  ).join("");
  tabsEl.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => { activeTab = el.dataset.tab; try { localStorage.setItem("mithra.tab", activeTab); } catch {} renderTabs(); renderView(); };
  });
}

function proj() { return DATA?.projects.find((p) => p.dir === current); }

function renderView() {
  const p = proj();
  if (!p) { viewEl.innerHTML = `<div class="v-empty">${esc(t("pick_project_short"))}</div>`; return; }
  if (activeTab === "summary")  return renderSummary(p);
  if (activeTab === "tasks")   return renderTasks(p);
  if (activeTab === "board")  return renderBoard(p);
  if (activeTab === "designs")  return renderDesigns(p);
  if (activeTab === "sessions") return renderSessions(p);
}

// Small helper: fetches JSON or throws with the server's error body.
async function getJSON(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}
async function postJSON(url, body, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

// ----------------------------------------------------------------- Board -----
async function renderBoard(p) {
  viewEl.innerHTML = `<div class="rail-loading">${esc(t("bd_loading"))}</div>`;
  try {
    const { columns } = await getJSON(`/api/board?dir=${encodeURIComponent(p.dir)}`);
    if (proj()?.dir !== p.dir || activeTab !== "board") return;
    if (!columns.length) { viewEl.innerHTML = `<div class="v-empty">${t("bd_empty", { file: esc(CONFIG.boardFile) })}</div>`; return; }
    const board = columns.map((c) => {
      const cards = c.cards.length
        ? c.cards.map((card) => `<div class="kb-card ${card.done ? "kb-done" : ""}">${esc(card.text)}</div>`).join("")
        : `<div class="kb-empty">${esc(t("bd_card_empty"))}</div>`;
      return `<section class="kb-col">
        <div class="kb-col-h"><span>${esc(c.title)}</span><span class="kb-count">${c.cards.length}</span></div>
        <div class="kb-cards">${cards}</div>
      </section>`;
    }).join("");
    viewEl.innerHTML = `<div class="kanban">${board}</div>`;
  } catch (e) {
    viewEl.innerHTML = `<div class="v-error">${esc(t("doc_read_err", { e: String(e.message || e) }))}</div>`;
  }
}

// ----------------------------------------------------------------- Tasks -----
async function renderTasks(p) {
  viewEl.innerHTML = `<div class="rail-loading">${esc(t("tk_loading"))}</div>`;
  try {
    const { groups, note } = await getJSON(`/api/tasks?dir=${encodeURIComponent(p.dir)}`);
    if (proj()?.dir !== p.dir || activeTab !== "tasks") return;
    if (note) { viewEl.innerHTML = `<div class="v-empty">${esc(t("tk_no_map"))}</div>`; return; } // no mapping
    const all = groups.flatMap((g) => g.items);
    const openN = all.filter((i) => !i.done).length;
    const doneN = all.length - openN;
    const row = (i) => `<li class="tk ${i.done ? "tk-done" : ""}">
      <button class="tk-box" data-line="${i.line}" data-done="${i.done ? 1 : 0}" title="${i.done ? esc(t("tk_mark_open")) : esc(t("tk_mark_done"))}">${i.done ? "✓" : "○"}</button>
      <span class="tk-text">${inline(esc(i.text))}</span>
      ${i.you && !i.done ? `<span class="tk-you">${esc(t("tk_you"))}</span>` : ""}
    </li>`;
    const sections = groups.map((g) => {
      const open = g.items.filter((i) => !i.done);
      const done = g.items.filter((i) => i.done);
      const openHtml = open.length
        ? `<ul class="tk-list">${open.map(row).join("")}</ul>`
        : `<div class="c-empty">${esc(t("tk_none_open"))}</div>`;
      const doneHtml = done.length
        ? `<details class="tk-done-wrap"><summary>${esc(t("tk_done_n", { n: done.length }))}</summary><ul class="tk-list">${done.map(row).join("")}</ul></details>`
        : "";
      return `<section class="card tk-group">
        <div class="card-t">${esc(g.heading)} <span class="tk-status">${esc(g.status || "")}</span></div>
        ${openHtml}${doneHtml}
      </section>`;
    }).join("");
    viewEl.innerHTML = `
      <div class="tk-head">
        <span class="pill pill-dirty">${esc(t("tk_open", { n: openN }))}</span>
        <span class="pill pill-clean">${esc(t("tk_done", { n: doneN }))}</span>
        <span class="tk-src">${esc(t("tk_src", { file: CONFIG.tasksFile }))}</span>
      </div>
      <form class="tk-add" id="tk-add">
        <input id="tk-add-input" type="text" placeholder="${esc(t("tk_add_ph", { name: p.name }))}" autocomplete="off" />
        <button type="submit" class="bar-btn">${esc(t("tk_add"))}</button>
      </form>
      <div class="tk-groups">${sections || `<div class="v-empty">${esc(t("tk_empty"))}</div>`}</div>`;
    // Checkbox toggle -> write-back to TASKS.md (by line number).
    viewEl.querySelectorAll(".tk-box[data-line]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          await postJSON("/api/tasks/toggle", { line: Number(b.dataset.line), done: b.dataset.done !== "1" });
          if (proj()?.dir === p.dir && activeTab === "tasks") renderTasks(p);
        } catch (e) { b.disabled = false; b.textContent = "!"; b.title = String(e.message || e); }
      };
    });
    // Quick-add -> appends under the project's ### heading.
    const form = document.getElementById("tk-add");
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById("tk-add-input");
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try {
        await postJSON("/api/tasks/add", { dir: p.dir, text });
        if (proj()?.dir === p.dir && activeTab === "tasks") renderTasks(p);
      } catch (err) { input.disabled = false; input.value = text; alert(t("tk_add_err", { e: String(err.message || err) })); }
    };
  } catch (e) {
    viewEl.innerHTML = `<div class="v-error">${esc(t("tk_read_err", { e: String(e.message || e) }))}</div>`;
  }
}

// --------------------------------------------------------------- Designs -----
async function renderDesigns(p) {
  viewEl.innerHTML = `<div class="rail-loading">${esc(t("dz_loading"))}</div>`;
  try {
    const { designs } = await getJSON(`/api/designs?dir=${encodeURIComponent(p.dir)}`);
    if (proj()?.dir !== p.dir || activeTab !== "designs") return;
    renderDocList(p, designs, "designs", (d) => ({
      rel: d.rel, scope: "project", title: d.title, meta: `${d.group} · ${d.ago}`,
    }), t("dz_empty"));
  } catch (e) {
    viewEl.innerHTML = `<div class="v-error">${esc(t("doc_read_err", { e: String(e.message || e) }))}</div>`;
  }
}

// -------------------------------------------------------------- Sessions -----
async function renderSessions(p) {
  viewEl.innerHTML = `<div class="rail-loading">${esc(t("se_loading"))}</div>`;
  try {
    const { sessions } = await getJSON(`/api/sessions?dir=${encodeURIComponent(p.dir)}`);
    if (proj()?.dir !== p.dir || activeTab !== "sessions") return;
    renderDocList(p, sessions, "sessions", (s) => ({
      rel: s.rel, scope: "sessions", title: s.title, meta: s.date || "",
    }), t("se_empty"));
  } catch (e) {
    viewEl.innerHTML = `<div class="v-error">${esc(t("doc_read_err", { e: String(e.message || e) }))}</div>`;
  }
}

// List (left) + markdown viewer (right), shared by Designs and Sessions.
function renderDocList(p, rows, kind, mapFn, emptyMsg) {
  if (!rows.length) { viewEl.innerHTML = `<div class="v-empty">${esc(emptyMsg)}</div>`; return; }
  const items = rows.map(mapFn);
  const list = items.map((it, idx) => `<button class="doc-row" data-idx="${idx}">
      <span class="dr-title">${esc(it.title)}</span>
      <span class="dr-meta">${esc(it.meta)}</span>
    </button>`).join("");
  viewEl.innerHTML = `<div class="vault-grid">
    <aside class="vault-list">${list}</aside>
    <section class="card vault-doc"><div class="doc-body" id="vault-body"><div class="rail-loading">${esc(t("doc_pick"))}</div></div></section>
  </div>`;
  const rowsEl = viewEl.querySelectorAll(".doc-row");
  const open = (idx) => {
    const it = items[idx];
    rowsEl.forEach((el) => el.classList.toggle("active", el.dataset.idx === String(idx)));
    loadVaultDoc(p.dir, it.scope, it.rel);
  };
  rowsEl.forEach((el) => { el.onclick = () => open(Number(el.dataset.idx)); });
  open(0); // open the first one (the most recent)
}

let lastVaultKey = null;
async function loadVaultDoc(dir, scope, rel) {
  const key = (lastVaultKey = dir + "::" + scope + "::" + rel);
  const body = document.getElementById("vault-body");
  body.innerHTML = `<div class="rail-loading">${esc(t("loading"))}</div>`;
  try {
    const d = await getJSON(`/api/vaultdoc?dir=${encodeURIComponent(dir)}&scope=${scope}&rel=${encodeURIComponent(rel)}`);
    if (key !== lastVaultKey) return;
    body.innerHTML = `<div class="md">${renderMarkdown(d.md)}</div>`;
    body.scrollTop = 0;
  } catch (e) {
    if (key !== lastVaultKey) return;
    body.innerHTML = `<div class="v-error">${esc(t("doc_read_err", { e: String(e.message || e) }))}</div>`;
  }
}

let lastDocKey = null;
// Pills (branch/dirty/deploy) and the change list are pulled out so they can be re-rendered
// in place during auto-refresh without rebuilding the doc viewer (doesn't interrupt reading).
function pillsHtml(p) {
  const h = HEALTH[p.dir];
  const healthTag = h ? ` <span class="hb ${h.ok ? "hb-up" : "hb-down"}">${h.ok ? `● ${h.status} · ${h.ms}ms` : esc(t("pill_down"))}</span>` : "";
  const deploy = p.deploy
    ? `<a class="pill pill-link" href="${esc(p.deploy)}" target="_blank" rel="noopener">${esc(t("pill_deploy"))}${healthTag}</a>`
    : "";
  const branch = p.branch ? `<span class="pill">⎇ ${esc(p.branch)}</span>` : "";
  const dirty = p.type === "git"
    ? `<span class="pill ${p.dirty ? "pill-dirty" : "pill-clean"}">${p.dirty ? esc(t("pill_uncommitted", { n: p.dirty })) : esc(t("pill_clean"))}</span>`
    : `<span class="pill pill-fs">${esc(t("pill_nogit"))}</span>`;
  // Staleness: only when it hurts (≥7 days without a commit).
  const stale = (p.type === "git" && p.staleDays != null && p.staleDays >= 7)
    ? `<span class="pill pill-stale">${esc(t("pill_stale", { n: p.staleDays }))}</span>`
    : "";
  // Pending push / behind the remote.
  const ahead = (p.ahead > 0) ? `<span class="pill pill-ahead">${esc(t("pill_ahead", { n: p.ahead }))}</span>` : "";
  const behind = (p.behind > 0) ? `<span class="pill pill-behind">${esc(t("pill_behind", { n: p.behind }))}</span>` : "";
  return branch + dirty + stale + ahead + behind + deploy;
}
function changesHtml(p) {
  return (p.changes && p.changes.length)
    ? p.changes.map((c) => `<li>
        <span class="c-ago">${esc(c.ago)}</span>
        <span class="c-msg">${esc(c.msg)}</span>
        ${c.hash ? `<span class="c-hash">${esc(c.hash)}</span>` : ""}
      </li>`).join("")
    : `<li class="c-empty">${esc(t("no_changes"))}</li>`;
}
// Re-renders only the Summary pills + commits (leaves the open doc and its scroll intact).
function patchSummary(p) {
  const pills = viewEl.querySelector(".res-head .pills");
  if (pills) pills.innerHTML = pillsHtml(p);
  const list = viewEl.querySelector(".c-list");
  if (list) list.innerHTML = changesHtml(p);
}

function renderSummary(p) {
  const errBanner = p.error ? `<div class="v-error">${esc(p.error)}</div>` : "";
  const docTabs = (p.docs && p.docs.length)
    ? p.docs.map((f) => `<button class="doc-tab" data-file="${esc(f)}">${esc(f)}</button>`).join("")
    : `<span class="c-empty">${esc(t("no_docs"))}</span>`;

  viewEl.innerHTML = `
    <div class="res-head">
      <h2>${esc(p.name)}</h2>
      <div class="pills">${pillsHtml(p)}</div>
      <div class="res-actions">
        <button class="bar-btn" data-open="cursor" title="${esc(t("act_cursor_t"))}">${esc(t("act_cursor"))}</button>
        <button class="bar-btn" data-open="explorer" title="${esc(t("act_folder_t"))}">${esc(t("act_folder"))}</button>
        <button class="bar-btn" data-open="terminal" title="${esc(t("act_terminal_t"))}">${esc(t("act_terminal"))}</button>
        ${p.type === "git" ? `<button class="bar-btn" data-open="commit" title="${esc(t("act_commit_t"))}">${esc(t("act_commit"))}</button>` : ""}
      </div>
    </div>
    ${errBanner}
    <div class="res-grid">
      <section class="card">
        <div class="card-t">${p.type === "git" ? esc(t("last_commits")) : esc(t("recent_files"))}</div>
        <ul class="c-list">${changesHtml(p)}</ul>
      </section>
      <section class="card card-doc">
        <div class="doc-tabs">${docTabs}</div>
        <div class="doc-body" id="doc-body"><div class="rail-loading">${esc(t("pick_doc"))}</div></div>
      </section>
    </div>`;

  viewEl.querySelectorAll(".res-actions [data-open]").forEach((el) => {
    el.onclick = () => {
      const t = el.dataset.open;
      if (t === "terminal") { openTerminalForCurrent(false); return; }
      if (t === "commit") { openCommit(p); return; }
      openProject(p.dir, t, el);
    };
  });

  const tabsWrap = viewEl.querySelector(".doc-tabs");
  if (p.docs && p.docs.length) {
    tabsWrap.querySelectorAll(".doc-tab").forEach((el) => {
      el.onclick = () => loadDoc(p.dir, el.dataset.file, tabsWrap);
    });
    // default: the first one (the server sorts CURRENT_FIRE ahead of CLAUDE)
    loadDoc(p.dir, p.docs[0], tabsWrap);
  }
}

// Opens the project folder in Cursor / Explorer via the server. Brief feedback
// on the button itself (✓/✗) — no alerts.
async function openProject(dir, target, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  try {
    const r = await fetch("/api/open", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, target }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    btn.textContent = "✓";
  } catch (e) {
    btn.textContent = "✗ " + (e.message || e);
  }
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
}

async function loadDoc(dir, file, tabsWrap) {
  lastDocKey = dir + "::" + file;
  const key = lastDocKey;
  tabsWrap.querySelectorAll(".doc-tab").forEach((el) =>
    el.classList.toggle("active", el.dataset.file === file));
  const body = document.getElementById("doc-body");
  body.innerHTML = `<div class="rail-loading">${esc(file)} · ${esc(t("loading"))}</div>`;
  try {
    const r = await fetch(`/api/doc?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (key !== lastDocKey) return; // arrived late, the doc already changed
    body.innerHTML = `<div class="md">${renderMarkdown(d.md)}</div>`;
    body.scrollTop = 0;
  } catch (e) {
    if (key !== lastDocKey) return;
    body.innerHTML = `<div class="v-error">${esc(t("doc_load_err", { file, e: String(e.message || e) }))}</div>`;
  }
}

// ------------------------------------------------------- Auto-refresh ------
// Re-reads /api/projects every 60s WITHOUT interrupting whatever you're reading:
// it always refreshes the rail; if you're on Summary, it patches only pills+commits
// (never the open doc or its scroll); Board/Designs/Sessions/Tasks are left alone.
// It pauses while the window isn't visible so we don't hammer git.
const REFRESH_MS = 60000;
let lastRefresh = 0;
const refreshAgoEl = document.getElementById("refresh-ago");
function updateRefreshAgo() {
  if (!refreshAgoEl || !lastRefresh) return;
  const s = Math.floor((Date.now() - lastRefresh) / 1000);
  refreshAgoEl.textContent = s < 5 ? t("refresh_now")
    : s < 60 ? t("refresh_s", { n: s })
    : t("refresh_min", { n: Math.floor(s / 60) });
}
async function silentRefresh() {
  if (document.hidden) return;
  try {
    const r = await fetch("/api/projects");
    if (!r.ok) return;
    DATA = await r.json();
    lastRefresh = Date.now();
    renderRail();
    if (activeTab === "summary" && proj()) patchSummary(proj());
    updateRefreshAgo();
    loadHealth();
  } catch { /* silent: the rail keeps the last good state */ }
}
setInterval(silentRefresh, REFRESH_MS);
setInterval(updateRefreshAgo, 5000);
// When the window becomes visible again, refresh right away (don't wait for the tick).
document.addEventListener("visibilitychange", () => { if (!document.hidden) silentRefresh(); });

// Startup: config first (language/theme/skills/name), then terminal + projects.
initConfig().then(() => {
  makeTerminal(null); // initial terminal anchored to the root
  loadProjects();
});
