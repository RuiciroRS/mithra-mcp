// Mithra MCP — pure data layer. No MCP, no network except the deploy health check:
// it only reads the real state of your workspace (git, an Obsidian vault, TASKS.md).
// index.js wraps this as MCP tools. Keeping it pure makes it testable without
// standing up a server (see test-smoke.mjs).
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';

const execFileP = promisify(execFile);

// Everything user-specific comes from mithra.config.json (or the auto-scan fallback).
// Nothing about one particular workspace is hardcoded here.
const CFG = loadConfig();

export const DOCS = CFG.root;              // workspace root
const VAULT = CFG.vaultRoot;               // Obsidian vault (boards + sessions), or null
const TASKS_FILE = CFG.tasksPath;          // cross-project source of truth

// Project map, resolved from config. Shape of each entry:
//   type:'git' uses git log; type:'fs' (no repo) falls back to file mtime.
//   tasks.{include,exclude} = substrings of the ### heading in TASKS.md that belong
//   to this project. board:false = its Kanban lives inside another project's board.
//   priority = your focus order (1 = highest). null = outside the core order
//   (tooling/side work); next_actions sends those to the bottom unless work piles up.
export const PROJECTS = CFG.projects;

const lc = (s) => String(s).toLowerCase();

// A task carrying one of these markers is a manual action of yours (not delegable).
const MANUAL_MARKERS = (CFG.manualTaskMarkers || []).map(lc);
const isManual = (text) => MANUAL_MARKERS.some((m) => lc(text).includes(m));

// Folders never walked in the file fallback (heavy / generated).
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vs', '.idea',
  'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', '.vscode',
]);

// Resolve a project by name (case-insensitive) or by exact dir.
export function findProject(nameOrDir) {
  if (!nameOrDir) return null;
  const q = lc(nameOrDir);
  return PROJECTS.find((p) => lc(p.name) === q || lc(p.dir) === q)
      || PROJECTS.find((p) => lc(p.name).includes(q) || lc(p.dir).includes(q))
      || null;
}

function relTime(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}min ago`;
  return 'just now';
}

async function gitProject(p) {
  const cwd = path.join(DOCS, p.dir);
  const sep = '\x1f';
  const [branch, log, status] = await Promise.all([
    execFileP('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']),
    execFileP('git', ['-C', cwd, 'log', '-n', '5', `--format=%h${sep}%s${sep}%cI${sep}%cr`]),
    execFileP('git', ['-C', cwd, 'status', '--porcelain']),
  ]);
  const changes = log.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [hash, msg, iso, rel] = line.split(sep);
    return { hash, msg, date: iso, ago: rel };
  });
  const dirtyLines = status.stdout.trim();
  const dirty = dirtyLines ? dirtyLines.split('\n').length : 0;
  const lastIso = changes[0]?.date || null;
  const staleDays = lastIso ? Math.floor((Date.now() - new Date(lastIso).getTime()) / 86400000) : null;
  let ahead = null, behind = null;
  try {
    const rl = await execFileP('git', ['-C', cwd, 'rev-list', '--count', '--left-right', '@{upstream}...HEAD']);
    const [b, a] = rl.stdout.trim().split(/\s+/).map(Number);
    behind = b; ahead = a;
  } catch { /* no upstream configured */ }
  return { name: p.name, dir: p.dir, type: 'git', deploy: p.deploy || null, branch: branch.stdout.trim(), dirty, lastCommit: changes[0] || null, recent: changes, staleDays, ahead, behind };
}

function recentFiles(root, max = 5) {
  const results = [];
  const stack = [root];
  let scanned = 0;
  while (stack.length && scanned < 30000) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        scanned++;
        try { const st = fs.statSync(full); results.push({ rel: path.relative(root, full), mtime: st.mtimeMs }); } catch {}
      }
    }
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return results.slice(0, max);
}

function fsProject(p) {
  const root = path.join(DOCS, p.dir);
  const recent = recentFiles(root, 5).map((f) => ({
    hash: null, msg: f.rel.replace(/\\/g, '/'), date: new Date(f.mtime).toISOString(), ago: relTime(f.mtime),
  }));
  return { name: p.name, dir: p.dir, type: 'fs', deploy: p.deploy || null, branch: null, dirty: 0, lastCommit: recent[0] || null, recent };
}

// --- Data tools (what index.js exposes over MCP) --------------------------

// State of every project. Errors are reported PER project (never a silent catch):
// if one repo blows up the rest still return, and the failed one carries `error`.
export async function listProjects() {
  const projects = [];
  for (const p of PROJECTS) {
    try {
      projects.push(p.type === 'git' ? await gitProject(p) : fsProject(p));
    } catch (e) {
      projects.push({ name: p.name, dir: p.dir, type: p.type, deploy: p.deploy || null, error: String(e?.message || e) });
    }
  }
  return { generatedAt: new Date().toISOString(), projects };
}

// Parse a board file (Obsidian Kanban) -> columns with cards.
function parseBoard(md) {
  const text = md.replace(/\r\n/g, '\n').split('%% kanban:settings')[0]; // drop settings block
  const lines = text.split('\n');
  const cols = [];
  let cur = null, inFront = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i === 0 && raw.trim() === '---') { inFront = true; continue; }
    if (inFront) { if (raw.trim() === '---') inFront = false; continue; }
    const h = raw.match(/^##\s+(.*)$/);
    if (h) { cur = { title: h[1].trim(), cards: [] }; cols.push(cur); continue; }
    const item = raw.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    if (item && cur) {
      const done = item[1].toLowerCase() === 'x';
      const cardText = item[2].replace(/\[\[([^\]]+)\]\]/g, '$1').trim(); // strip wikilinks
      cur.cards.push({ text: cardText, done });
    }
  }
  return cols.filter((c) => c.title.toLowerCase() !== 'complete'); // 'Complete' is an internal marker
}

export function getBoard(nameOrDir) {
  const proj = findProject(nameOrDir);
  if (!proj) throw new Error(`unknown project: "${nameOrDir}"`);
  if (!VAULT) return { project: proj.name, columns: [], note: 'no vault configured' };
  if (proj.board === false) return { project: proj.name, columns: [], note: 'no board of its own (shares another project\'s)' };
  if (!proj.vault) return { project: proj.name, columns: [], note: 'no vault folder mapped' };
  const full = path.join(VAULT, proj.vault, CFG.boardFile);
  const md = fs.readFileSync(full, 'utf8');
  return { project: proj.name, columns: parseBoard(md) };
}

// Parse TASKS.md: ## Status -> ### Project -> - [ ]/[x] item.
function parseTasks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const groups = [];
  let status = null, cur = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const h2 = raw.match(/^##\s+(.*)$/);
    if (h2) { status = h2[1].trim(); cur = null; continue; }
    const h3 = raw.match(/^###\s+(.*)$/);
    if (h3) { cur = { heading: h3[1].trim(), status, items: [] }; groups.push(cur); continue; }
    const item = raw.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    if (item && cur) {
      const done = item[1].toLowerCase() === 'x';
      const text = item[2].replace(/\[\[([^\]]+)\]\]/g, '$1').trim();
      cur.items.push({ text, done, you: isManual(text) });
    }
  }
  return groups;
}

export function getTasks(nameOrDir, { openOnly = true } = {}) {
  const proj = findProject(nameOrDir);
  if (!proj) throw new Error(`unknown project: "${nameOrDir}"`);
  const m = proj.tasks;
  if (!m || !m.include?.length) return { project: proj.name, groups: [], note: 'no task mapping' };
  const md = fs.readFileSync(TASKS_FILE, 'utf8');
  const groups = parseTasks(md)
    .filter((g) => {
      const h = lc(g.heading);
      if (!m.include.some((k) => h.includes(lc(k)))) return false;
      if (m.exclude && m.exclude.some((k) => h.includes(lc(k)))) return false;
      return g.items.length > 0;
    })
    .map((g) => ({ ...g, items: openOnly ? g.items.filter((i) => !i.done) : g.items }))
    .filter((g) => g.items.length > 0);
  return { project: proj.name, groups };
}

// Today's standup: commits since midnight + open-task counts, per project.
export async function dailyStandup() {
  const sep = '\x1f';
  let taskGroups = [];
  try { taskGroups = parseTasks(fs.readFileSync(TASKS_FILE, 'utf8')); } catch {}
  const out = [];
  for (const p of PROJECTS) {
    const entry = { name: p.name, dir: p.dir, commits: [] };
    if (p.type === 'git') {
      try {
        const cwd = path.join(DOCS, p.dir);
        const log = await execFileP('git', ['-C', cwd, 'log', '--since=midnight', `--format=%h${sep}%s${sep}%cr`]);
        entry.commits = log.stdout.trim().split('\n').filter(Boolean).map((l) => {
          const [hash, msg, ago] = l.split(sep);
          return { hash, msg, ago };
        });
      } catch {}
    }
    const m = p.tasks;
    if (m?.include?.length) {
      entry.openTasks = taskGroups
        .filter((g) => m.include.some((k) => lc(g.heading).includes(lc(k))) && !(m.exclude || []).some((k) => lc(g.heading).includes(lc(k))))
        .flatMap((g) => g.items).filter((i) => !i.done).length;
    }
    out.push(entry);
  }
  return { today: new Date().toISOString().slice(0, 10), projects: out };
}

// Deploy health: short-timeout HEAD ping against your production URLs.
async function pingURL(url) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    if (res.status === 405 || res.status === 501) { // host refuses HEAD -> retry with GET
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
      try { await res.body?.cancel(); } catch {}
    }
    return { ok: res.status > 0 && res.status < 500, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function deployHealth() {
  const targets = PROJECTS.filter((p) => p.deploy);
  const entries = await Promise.all(
    targets.map(async (p) => [p.name, { url: p.deploy, ...(await pingURL(p.deploy)) }])
  );
  return { checkedAt: new Date().toISOString(), health: Object.fromEntries(entries) };
}

// Open tasks of a project, from the already-parsed TASKS.md groups.
function openTasksOf(p, taskGroups) {
  const m = p.tasks;
  if (!m?.include?.length) return [];
  return taskGroups
    .filter((g) => m.include.some((k) => lc(g.heading).includes(lc(k))) && !(m.exclude || []).some((k) => lc(g.heading).includes(lc(k))))
    .flatMap((g) => g.items.map((i) => ({ ...i, status: g.status })))
    .filter((i) => !i.done);
}

// next_actions — the tool that crosses EVERYTHING: focus priority + open tasks +
// repo signals (unpushed commits, uncommitted changes, staleness) and returns what
// to attack first, ranked, with the reason spelled out. The brain of the command-center.
export async function nextActions({ limit = 5 } = {}) {
  const { projects: sigs } = await listProjects();
  const byDir = Object.fromEntries(sigs.map((s) => [s.dir, s]));
  let taskGroups = [];
  try { taskGroups = parseTasks(fs.readFileSync(TASKS_FILE, 'utf8')); } catch {}

  const scored = PROJECTS.map((p) => {
    const sig = byDir[p.dir] || {};
    const open = openTasksOf(p, taskGroups);
    const youOpen = open.filter((i) => i.you);            // in your court (manual)
    const doable = open.filter((i) => !i.you);            // actionable / delegable now
    const ahead = sig.ahead || 0;
    const dirty = sig.dirty || 0;
    const stale = sig.staleDays;

    // "Pending work" — if it's 0, the project doesn't enter the actionable ranking.
    const work = Math.min(open.length, 8) + (ahead ? 6 : 0) + (dirty ? 4 : 0) + (youOpen.length ? 3 : 0);
    if (work === 0) return null;

    // Focus priority dominates; pending work breaks ties and lifts a low-priority
    // project that's quietly piling up. null (tooling/side work) weighs as a 6th.
    const pr = p.priority ?? 6;
    const score = (7 - pr) * 8 + work;

    // A concrete suggestion: first actionable Active task; else the first open one;
    // if everything is manual, say so explicitly (it's in your court, not delegable).
    const prefActive = (arr) => arr.find((i) => lc(i.status || '') === 'active') || arr[0];
    const pick = prefActive(doable) || prefActive(open) || null;
    const trim = (t) => (t.length > 140 ? t.slice(0, 137) + '…' : t);
    const suggested = pick ? trim(pick.text) : (open.length ? 'every open task here is a manual action of yours' : null);

    const flags = [];
    if (ahead) flags.push(`${ahead} unpushed commit(s)`);
    if (dirty) flags.push(`${dirty} uncommitted file(s)`);
    if (typeof stale === 'number' && stale >= 7) flags.push(`untouched for ${stale}d`);
    if (youOpen.length) flags.push(`${youOpen.length} manual task(s) of yours`);

    const reasonBits = [p.priority ? `priority #${p.priority}` : 'outside the core focus order'];
    if (open.length) reasonBits.push(`${open.length} open task(s)`);
    if (ahead) reasonBits.push('unpushed work');

    return {
      project: p.name, dir: p.dir, priority: p.priority ?? null, score,
      reason: reasonBits.join(' · '),
      suggestedTask: suggested,
      flags,
      signal: { openTasks: open.length, youTasks: youOpen.length, dirty, ahead, behind: sig.behind ?? null, staleDays: stale ?? null },
    };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return { generatedAt: new Date().toISOString(), actions: scored.slice(0, limit) };
}
