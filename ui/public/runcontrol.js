// Run Control — read-only surface over a project's run folder.
//
// A "run" is a folder a project's own tooling writes while an agent works:
// run.json, mission.md, env.json, events.ndjson, snapshots/, shots/, verify.json.
// Mithra never writes there. Everything on screen is read from those files, so
// nothing is mocked: when a file is missing the panel says so instead of
// inventing a value.
//
// Live without a new server: /api/runs/run is polled every 1.2s and the server
// returns a `stamp`; if it did not change, nothing is re-rendered. Mithra's
// existing WebSocket spawns a terminal per connection, so reusing it here would
// have meant redesigning it. A short poll against the Express server that is
// already running is simpler and adds no infrastructure.
(function () {
  const POLL_MS = 1200;
  let timer = null, tickTimer = null;
  let lastStamp = null, pickedShot = null, pickedRun = null, followLatest = true;
  let lastSeq = 0, hostDir = null, hostTitle = 'RUN CONTROL';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hhmm = (t) => { try { return new Date(t).toLocaleTimeString([], { hour12: false }); } catch { return '--:--:--'; } };
  // t() comes from app.js (loaded after this file, but only called at render time).
  const tr = (k, v) => (typeof t === 'function' ? t(k, v) : k);

  // Agent state colours. The state ALWAYS comes from an event, never from a timer.
  const STATES = {
    IDLE:              { c: '#7c8894' },
    OBSERVING:         { c: '#4fd1e0' },
    BUILDING:          { c: '#f0a63c' },
    COMPILING:         { c: '#f0a63c' },
    PLAYING:           { c: '#ff5c7a' },
    VERIFYING:         { c: '#4fd1e0' },
    DEBUGGING:         { c: '#ff5c7a' },
    WAITING_FOR_HUMAN: { c: '#ffd166' },
    DONE:              { c: '#6ee79b' },
    FAILED:            { c: '#ff5c7a' },
  };

  const MUTATES = /set_actor_transform|write_graph_dsl|add_component|import_file|add_to_scene|set_properties|remove_from_scene/i;
  const SAVES = /save_assets|git commit|git add/i;
  const OBSERVES = /get_properties|find_actors|get_actor_transform|get_label|is_dirty|GetLogEntries|snapshot/i;

  function stateOfEvent(e) {
    if (e.status === 'error' || e.status === 'incomplete') return 'DEBUGGING';
    if (e.kind === 'verify_start' || e.kind === 'check') return 'VERIFYING';
    if (e.kind === 'input') return 'PLAYING';
    if (e.kind === 'compile') return 'COMPILING';
    if (e.kind === 'edit') return 'BUILDING';
    if (e.kind === 'observe' || e.kind === 'shot') return 'OBSERVING';
    if (e.kind === 'runtime_state') {
      if (/INPUT_/.test(e.state || '')) return e.status === 'blocked' ? 'WAITING_FOR_HUMAN' : 'PLAYING';
      if (e.state === 'PIE_STARTING' || e.state === 'PIE_RUNNING') return 'PLAYING';
      return null;
    }
    if (e.kind === 'tool') {
      const s = (e.summary || '') + ' ' + (e.target || '');
      if (/compile/i.test(s)) return 'COMPILING';
      if (SAVES.test(s) || MUTATES.test(s)) return 'BUILDING';
      if (e.tool === 'Edit' || e.tool === 'Write') return 'BUILDING';
      if (OBSERVES.test(s) || ['Read', 'Grep', 'Glob'].includes(e.tool)) return 'OBSERVING';
      return null;
    }
    if (e.kind === 'run_start') return 'OBSERVING';
    return null;
  }

  function derive(d) {
    const evs = d.events || [];
    const run = d.run || {};
    const v = d.verify || null;
    const out = { state: 'IDLE', since: null, now: null, holding: null, life: {}, verify: v };
    if (!evs.length) return out;

    // The agent keeps the input until PIE stops or the run ends.
    let holding = null;
    for (const e of evs) {
      if (e.kind === 'runtime_state' && /INPUT_/.test(e.state || '')) holding = e;
      else if (e.kind === 'runtime_state' && (e.state === 'PIE_STOPPING' || e.state === 'EDITOR')) holding = null;
      else if (e.kind === 'run_end') holding = null;
    }
    out.holding = holding;

    const firstInput = evs.findIndex((e) => e.kind === 'input');
    out.life = {
      observe: evs.some((e) => e.kind === 'observe' || e.kind === 'shot'),
      edit: evs.some((e) => ['BUILDING', 'COMPILING'].includes(stateOfEvent(e) || '')),
      play: evs.some((e) => e.kind === 'input' || (e.kind === 'runtime_state' && /PIE_|INPUT_/.test(e.state || ''))),
      verify: !!v || (firstInput >= 0 && evs.slice(firstInput + 1).some((e) => e.kind === 'observe')),
      persist: evs.some((e) => e.kind === 'run_end' || SAVES.test((e.summary || '') + (e.target || ''))),
    };

    const last = evs[evs.length - 1];
    out.since = last.t;
    out.now = humanize(last).text;

    if (!d.live && run.status === 'ended') {
      // A finished run is not a verified run. Those are different claims.
      if (v && v.status === 'FAIL') { out.state = 'FAILED'; out.now = tr('rc_verify_failed'); }
      else if (v && v.status === 'ERROR') { out.state = 'FAILED'; out.now = tr('rc_verify_errored'); }
      else if ((run.failures || 0) > 0) { out.state = 'FAILED'; out.now = tr('rc_run_failures', { n: run.failures }); }
      else { out.state = 'DONE'; out.now = v ? tr('rc_verify_passed') : tr('rc_unverified_sub'); }
      return out;
    }
    if (holding) { out.state = holding.status === 'blocked' ? 'WAITING_FOR_HUMAN' : 'PLAYING'; return out; }
    // Walk back to the first event that maps to a state: steadier than looking at
    // the last one only (a screenshot does not mean the agent stopped building).
    for (let i = evs.length - 1; i >= 0; i--) {
      const s = stateOfEvent(evs[i]);
      if (s) { out.state = s; break; }
    }
    return out;
  }

  // One event -> one line that reads on its own. Raw JSON expands on click.
  function humanize(e) {
    const k = e.kind;
    if (k === 'run_start') return { text: `RUN START — ${e.summary || ''}`, cls: 'k-run' };
    if (k === 'run_end') return { text: 'RUN END', cls: 'k-run' };
    if (k === 'input') return { text: `⌨  ${e.key || e.summary || 'key'}`, cls: 'k-input' };
    if (k === 'observe') return { text: e.summary || 'observation', cls: 'k-observe' };
    if (k === 'shot') return { text: e.status === 'error' ? `${tr('rc_shot_failed')} — ${e.error || ''}` : `${tr('rc_shot')} · ${e.label || ''}`, cls: 'k-shot' };
    if (k === 'session') return { text: tr('rc_session_ended'), cls: '' };
    if (k === 'verify_start') return { text: `VERIFY START — ${e.summary || ''}`, cls: 'k-verify' };
    if (k === 'verify_end') return { text: `VERIFY ${e.status || ''} — ${e.summary || ''}`, cls: e.status === 'PASS' ? 'k-pass' : 'k-fail' };
    if (k === 'check') return { text: `${e.status || ''}  ${e.target || ''} — ${e.summary || ''}`, cls: e.status === 'PASS' ? 'k-pass' : 'k-fail' };
    if (k === 'runtime_state') {
      const st = e.state;
      if (st === 'INPUT_PREPARED') {
        return e.status === 'blocked'
          ? { text: `INPUT BLOCKED — ${e.summary || ''}`, cls: 'k-play' }
          : { text: `INPUT PREPARED — ${e.summary || ''}`, cls: 'k-play' };
      }
      if (st === 'INPUT_VERIFIED') return { text: `INPUT VERIFIED — ${e.summary || ''}`, cls: 'k-play' };
      // Any other runtime state is the project's own vocabulary: print it as it
      // arrives instead of teaching Mithra one engine's words.
      const pretty = String(st || '').replace(/_/g, ' ');
      return { text: `${pretty}${e.summary ? ` — ${e.summary}` : ''}`, cls: /RUN|START|STOP|PLAY/i.test(st || '') ? 'k-play' : '' };
    }
    if (k === 'tool') {
      const tl = e.tool || '?', s = e.summary || '';
      if (tl === 'Bash') return { text: `$ ${s}`, cls: '' };
      if (tl === 'Read') return { text: `read ${e.target || s}`, cls: '' };
      if (tl === 'Edit' || tl === 'Write') return { text: `edit ${e.target || s}`, cls: '' };
      return { text: `${tl} ${e.target || s}`, cls: '' };
    }
    return { text: e.summary || k, cls: '' };
  }

  // -------------------------------------------------------------- rendering
  function chips(d) {
    const env = d.env || {}, host = env.unreal || env.host || {}, git = (d.before && d.before.git) || env.git || {};
    // Live runtime flag comes from the events, not from env.json (that is a snapshot of the start).
    let pie = host.pie;
    for (const e of d.events || []) {
      if (e.kind !== 'runtime_state') continue;
      if (['PIE_RUNNING', 'PIE_STARTING'].includes(e.state) || /INPUT_/.test(e.state || '')) pie = true;
      if (['PIE_STOPPING', 'EDITOR'].includes(e.state)) pie = false;
    }
    const dirty = (d.after && d.after.dirty_assets) || (d.before && d.before.dirty_assets) || [];
    const c = [];
    if (host.reachable !== undefined) {
      c.push(host.reachable
        ? `<span class="rc-chip on" title="${esc(tr('rc_at_run_start'))}"><i class="dot"></i>${esc(tr('rc_host'))} <b>${esc(host.toolsets ?? '?')}</b> ${esc(tr('rc_toolsets'))}</span>`
        : `<span class="rc-chip off"><i class="dot"></i>${esc(tr('rc_host_offline'))}</span>`);
      c.push(`<span class="rc-chip ${pie ? 'warn' : 'off'}"><i class="dot"></i>${esc(tr('rc_runtime'))}</span>`);
    }
    if (git.branch) c.push(`<span class="rc-chip ${git.dirty ? 'warn' : 'on'}"><i class="dot"></i><b>${esc(git.branch)}</b> ${esc(git.head || '')}${git.dirty ? ` · ${esc(tr('rc_dirty'))}` : ''}</span>`);
    if (dirty.length) c.push(`<span class="rc-chip warn"><i class="dot"></i><b>${dirty.length}</b> ${esc(tr('rc_unsaved'))}</span>`);
    c.push(d.live ? `<span class="rc-chip live"><i class="dot"></i>${esc(tr('rc_live'))}</span>` : `<span class="rc-chip off"><i class="dot"></i>${esc(tr('rc_archive'))}</span>`);
    return c.join('');
  }

  function lifecycle(life, state) {
    const steps = [
      ['observe', tr('rc_step_inspect'), ['OBSERVING']],
      ['edit', tr('rc_step_build'), ['BUILDING', 'COMPILING']],
      ['play', tr('rc_step_play'), ['PLAYING', 'WAITING_FOR_HUMAN']],
      ['verify', tr('rc_step_verify'), ['VERIFYING']],
      ['persist', tr('rc_step_persist'), ['DONE']],
    ];
    const finished = state === 'DONE' || state === 'FAILED';
    return steps.map(([k, label, states]) => {
      const act = !finished && states.includes(state);
      const done = (life[k] || (finished && k === 'persist')) && !act;
      return `<div class="rc-step ${act ? 'act' : done ? 'done' : ''}">
        <span class="m">${act ? '◐' : done ? '●' : '○'}</span><span>${esc(label)}</span></div>`;
    }).join('');
  }

  // Verification. No score, no percentage: a check either held or it did not.
  function verifyPanel(d) {
    const v = d.verify;
    if (!v) {
      const finished = !d.live && (d.run || {}).status === 'ended';
      return `<div class="rc-sec">
        <div class="rc-h">${esc(tr('rc_verify'))}</div>
        <div class="rc-verdict unver">${esc(finished ? tr('rc_unverified') : tr('rc_not_yet'))}</div>
        <div class="rc-vsub">${esc(finished ? tr('rc_unverified_sub') : tr('rc_not_yet_sub'))}</div>
      </div>`;
    }
    const cls = { PASS: 'pass', FAIL: 'fail', ERROR: 'err' }[v.status] || 'unver';
    const rows = (v.checks || []).map((c) => {
      const m = { PASS: '✓', FAIL: '✕', ERROR: '!', SKIPPED: '–' }[c.status] || '?';
      const k = { PASS: 'pass', FAIL: 'fail', ERROR: 'err', SKIPPED: 'skip' }[c.status] || '';
      // Evidence first: a verifier writes the failing sentence in words, and that
      // sentence is what a person needs. The raw expected/observed follows it.
      const detail = [
        ...(c.evidence || []).map((x) => `· ${x}`),
        c.note ? `· ${c.note}` : '',
        c.expected !== undefined ? `${tr('rc_expected')}: ${JSON.stringify(c.expected)}` : '',
        c.observed !== undefined ? `${tr('rc_observed')}: ${JSON.stringify(c.observed)}` : '',
      ].filter(Boolean).join('\n');
      return `<div class="rc-check ${k}" data-check="${esc(c.id)}">
          <span class="mk">${m}</span><span class="nm">${esc(c.id)}</span>
          ${c.status !== 'PASS' ? `<div class="dt">${esc(detail)}</div>` : `<div class="dt">${esc(detail)}</div>`}
        </div>`;
    }).join('');
    const n = v.counts || {};
    return `<div class="rc-sec">
      <div class="rc-h">${esc(tr('rc_verify'))}</div>
      <div class="rc-verdict ${cls}">${esc(v.status)}</div>
      <div class="rc-vsub">${n.pass || 0} pass · ${n.fail || 0} fail${n.error ? ` · ${n.error} error` : ''}</div>
      <div class="rc-checks">${rows}</div>
    </div>`;
  }

  function stage(d) {
    const shots = d.shots || [];
    if (!shots.length) {
      return `<div class="rc-empty"><div class="ico">▣</div>
        <div class="big">${esc(tr('rc_no_evidence'))}</div>
        <div class="sub">${esc(tr('rc_no_evidence_sub'))}</div></div>`;
    }
    const sel = shots.find((s) => s.file === pickedShot) || shots[shots.length - 1];
    const url = `/api/runs/shot?dir=${encodeURIComponent(hostDir)}&run=${encodeURIComponent(d.id)}&file=${encodeURIComponent(sel.file)}`;
    return `<img src="${url}" alt="${esc(sel.label)}">
      <div class="rc-cap">
        <span class="rc-badge ${sel.mode === 'PIE' ? 'pie' : 'editor'}">${esc(sel.mode)}</span>
        <span>${esc(sel.label)}</span><span class="mono">${sel.t ? hhmm(sel.t) : ''}</span>
      </div>`;
  }

  function film(d) {
    const shots = d.shots || [];
    if (!shots.length) return `<div class="none">${esc(tr('rc_no_shots'))}</div>`;
    const selFile = (shots.find((s) => s.file === pickedShot) || shots[shots.length - 1]).file;
    return shots.map((s) => `
      <div class="rc-frame ${s.file === selFile ? 'sel' : ''}" data-shot="${esc(s.file)}">
        <img src="/api/runs/shot?dir=${encodeURIComponent(hostDir)}&run=${encodeURIComponent(d.id)}&file=${encodeURIComponent(s.file)}" loading="lazy" alt="">
        <div class="lb">${esc(s.label)}</div>
      </div>`).join('');
  }

  function timeline(d) {
    const evs = d.events || [];
    if (!evs.length) return `<div class="rc-ev"><span class="tx" style="color:#39424b">${esc(tr('rc_waiting_event'))}</span></div>`;
    return evs.map((e) => {
      const h = humanize(e);
      const bad = ['error', 'incomplete', 'blocked', 'FAIL', 'ERROR'].includes(e.status);
      return `<div class="rc-ev can ${h.cls} ${bad ? 'err' : ''}" data-seq="${e.seq}">
        <span class="ts">${hhmm(e.t)}</span>
        <span class="tx">${esc(h.text)}${e.error ? ` — ${esc(String(e.error).slice(0, 160))}` : ''}
          <div class="raw">${esc(JSON.stringify(e))}</div></span>
      </div>`;
    }).join('');
  }

  function agent(d, st) {
    const run = d.run || {};
    const col = (STATES[st.state] || STATES.IDLE).c;
    const dirty = (d.after && d.after.dirty_assets) || (d.before && d.before.dirty_assets) || [];
    const fails = (d.events || []).filter((e) => ['error', 'incomplete', 'blocked'].includes(e.status)).length;
    return `
      <div class="rc-sec rc-agent" style="--st:${col}">
        <div class="rc-core" id="rc-core"><div class="ring"></div><div class="ring ring2"></div><div class="orb">◉</div></div>
        <div class="rc-state">${esc(st.state.replace(/_/g, ' '))}</div>
        <div class="rc-now">${esc(st.now || '—')}</div>
        <div class="rc-since" id="rc-since"></div>
      </div>
      ${verifyPanel(d)}
      <div class="rc-sec">
        <div class="rc-h">${esc(tr('rc_run'))}</div>
        <div class="rc-kv">
          <div class="row"><span class="k">${esc(tr('rc_events'))}</span><span class="v">${(d.events || []).length}</span></div>
          <div class="row"><span class="k">${esc(tr('rc_tool_failures'))}</span><span class="v ${fails ? 'bad' : ''}">${fails}</span></div>
          <div class="row"><span class="k">${esc(tr('rc_shots'))}</span><span class="v">${(d.shots || []).length}</span></div>
          <div class="row"><span class="k">${esc(tr('rc_duration'))}</span><span class="v">${run.duration_s ? run.duration_s + ' s' : (d.live ? esc(tr('rc_running')) : '—')}</span></div>
        </div>
      </div>
      <div class="rc-sec">
        <div class="rc-h">${esc(tr('rc_assets'))}</div>
        <div class="rc-assets">${dirty.length
          ? dirty.map((a) => {
              const leaf = String(a).split('/').pop();
              const short = leaf.includes('.') && leaf.split('.')[0] === leaf.split('.')[1] ? leaf.split('.')[0] : leaf;
              return `<div class="a" title="${esc(a)}">${esc(short)}</div>`;
            }).join('')
          : `<div class="none">${esc(tr('rc_no_dirty'))}</div>`}</div>
      </div>`;
  }

  function noRun(host) {
    host.innerHTML = `
      <div class="rc-top">
        <span class="rc-brand">◉ ${esc(hostTitle)}</span>
        <span class="rc-proj">${esc(hostDir.split(/[\\/]/).pop())}</span>
        <span class="rc-top-sp"></span>
        <span class="rc-chip off"><i class="dot"></i>${esc(tr('rc_no_runs'))}</span>
      </div>
      <div class="rc-body" style="grid-template-columns:1fr">
        <div class="rc-col"><div class="rc-stage">
          <div class="rc-empty"><div class="ico">◉</div>
            <div class="big">${esc(tr('rc_no_mission'))}</div>
            <div class="sub">${esc(tr('rc_no_mission_sub'))}</div></div>
        </div></div>
      </div>`;
  }

  function render(host, d) {
    const st = derive(d);
    const band = st.holding
      ? `<div class="rc-playing ${st.holding.status === 'blocked' ? 'blocked' : ''}">
           <span class="t">● ${esc(tr('rc_agent_playing'))}</span>
           <span class="s">${esc(st.holding.state === 'INPUT_VERIFIED' ? tr('rc_input_verified')
              : st.holding.status === 'blocked' ? tr('rc_input_blocked') : tr('rc_input_prepared'))}</span>
         </div>` : '';

    host.innerHTML = `
      <div class="rc-top">
        <span class="rc-brand">◉ ${esc(hostTitle)}</span>
        <span class="rc-proj">${esc(hostDir.split(/[\\/]/).pop())}</span>
        <span class="rc-top-sp"></span>
        <div class="rc-chips">${chips(d)}</div>
        <select class="rc-runsel" id="rc-runsel"></select>
      </div>
      ${band}
      <div class="rc-body">
        <div class="rc-col left">
          <div class="rc-sec">
            <div class="rc-h">${esc(tr('rc_mission'))}</div>
            <div class="rc-goal ${(d.run || {}).goal ? '' : 'empty'}">${esc((d.run || {}).goal || tr('rc_no_goal'))}</div>
            <div class="rc-runid mono">${esc(d.id)}</div>
          </div>
          <div class="rc-sec">
            <div class="rc-h">${esc(tr('rc_cycle'))}</div>
            <div class="rc-life">${lifecycle(st.life, st.state)}</div>
          </div>
        </div>
        <div class="rc-col"><div class="rc-stage" id="rc-stage">${stage(d)}</div></div>
        <div class="rc-col right">${agent(d, st)}</div>
      </div>
      <div class="rc-film" id="rc-film">${film(d)}</div>
      <div class="rc-time" id="rc-time">${timeline(d)}</div>`;

    const sel = host.querySelector('#rc-runsel');
    fetch(`/api/runs/runs?dir=${encodeURIComponent(hostDir)}`).then((r) => r.json()).then((j) => {
      if (!sel.isConnected) return;
      sel.innerHTML = (j.runs || []).map((r) =>
        `<option value="${esc(r.id)}" ${r.id === d.id ? 'selected' : ''}>${r.live ? '● ' : ''}${esc(r.id)}</option>`).join('');
    }).catch(() => {});
    sel.onchange = () => { pickedRun = sel.value; lastStamp = null; pickedShot = null; followLatest = true; poll(host); };

    host.querySelector('#rc-film').onclick = (ev) => {
      const f = ev.target.closest('.rc-frame');
      if (!f) return;
      pickedShot = f.dataset.shot; followLatest = false; lastStamp = null; poll(host);
    };
    host.querySelector('#rc-time').onclick = (ev) => {
      const row = ev.target.closest('.rc-ev');
      if (row) row.classList.toggle('open');
    };
    host.querySelectorAll('.rc-check').forEach((el) => { el.onclick = () => el.classList.toggle('open'); });

    const tl = host.querySelector('#rc-time');
    tl.scrollTop = tl.scrollHeight;   // newest at the bottom, like a console

    const maxSeq = (d.events || []).reduce((m, e) => Math.max(m, e.seq || 0), 0);
    if (maxSeq > lastSeq) {
      const core = host.querySelector('#rc-core');
      if (core && lastSeq) { core.classList.add('beat'); setTimeout(() => core.classList.remove('beat'), 600); }
      lastSeq = maxSeq;
    }
    host._since = st.since;
    tickSince(host);
  }

  function tickSince(host) {
    const el = host.querySelector('#rc-since');
    if (!el || !host._since) return;
    const s = Math.max(0, Math.round((Date.now() - new Date(host._since).getTime()) / 1000));
    el.textContent = s < 2 ? tr('rc_now') : tr(s < 90 ? 'rc_ago_s' : 'rc_ago_min', { n: s < 90 ? s : Math.round(s / 60) });
  }

  async function poll(host) {
    if (!host.isConnected) return stop();
    try {
      const q = `/api/runs/run?dir=${encodeURIComponent(hostDir)}${pickedRun ? `&run=${encodeURIComponent(pickedRun)}` : ''}`;
      const d = await (await fetch(q)).json();
      if (!host.isConnected) return stop();
      if (d.empty || d.error) { if (lastStamp !== 'empty') { lastStamp = 'empty'; noRun(host); } return; }
      // A new run adopts itself: when the active marker appears, the view jumps to it.
      if (!pickedRun && d.live && d.id !== host._runId) { pickedShot = null; followLatest = true; lastSeq = 0; }
      if (followLatest) pickedShot = null;
      if (d.stamp === lastStamp) return tickSince(host);
      lastStamp = d.stamp; host._runId = d.id;
      render(host, d);
    } catch { /* the server may be restarting; the next tick retries */ }
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (tickTimer) clearInterval(tickTimer);
    timer = tickTimer = null;
  }

  window.renderRunControl = function (viewEl, project) {
    stop();
    hostDir = project.dir;
    hostTitle = project.runControl?.title || tr('rc_title');
    lastStamp = null; lastSeq = 0; pickedShot = null; followLatest = true;
    // ?run=<id> pins a specific historical run, so a single URL addresses one.
    pickedRun = new URLSearchParams(location.search).get('run') || null;
    viewEl.innerHTML = '<div class="rc" id="rc-root"></div>';
    const host = viewEl.querySelector('#rc-root');
    poll(host);
    timer = setInterval(() => poll(host), POLL_MS);
    tickTimer = setInterval(() => tickSince(host), 1000);
  };
  window.stopRunControl = stop;
})();
