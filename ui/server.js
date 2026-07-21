// Mithra UI — server: serves the front end and bridges a real terminal (node-pty -> claude.exe) over WebSocket.
// Listens on 127.0.0.1 only (the terminal launches claude; NEVER expose this to the network).
import express from 'express';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { loadConfig, publicConfig } from '../config.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // repo root: shared config.js, node_modules

// All user-specific configuration lives in mithra.config.json (see config.js).
const cfg = loadConfig();
const PORT   = cfg.port;
const HOST   = cfg.host;
const CLAUDE = cfg.claudeBin;   // may be null if claude was not found on the PATH
const CWD    = cfg.root;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// xterm assets from node_modules
app.use('/vendor/xterm', express.static(path.join(ROOT, 'node_modules', '@xterm', 'xterm')));
app.use('/vendor/fit',   express.static(path.join(ROOT, 'node_modules', '@xterm', 'addon-fit')));

// Public config for the front end (language, theme, skills, name). Does not expose disk paths.
app.get('/api/config', (req, res) => res.json(publicConfig(cfg)));

// --- Project state --------------------------------------------------------
// All of this comes from mithra.config.json (or the auto scan). type:'git' uses git log;
// type:'fs' (no repo) falls back to mtime. Each project can carry a vault/sessions/tasks mapping.
const DOCS = CWD;                    // root folder where the projects live
const VAULT = cfg.vaultRoot;         // Obsidian vault (or null if unused)
const SESSIONS_DIR = cfg.sessionsDir; // sessions folder inside the vault (or null)
const PROJECTS = cfg.projects;
const BOARD_FILE = cfg.boardFile;    // per-project Kanban file name (defaults to 'Board.md')
const TASKS_FILE = cfg.tasksFile;    // TASKS.md (cross-project) at the root
// A task carrying one of these markers is yours to do by hand, not delegable.
const MANUAL_MARKERS = (cfg.manualTaskMarkers || ['(you)']).map((m) => String(m).toLowerCase());
const WM_FILE = cfg.workingMemoryFile;
const WM_CAP = cfg.workingMemoryCap;
// Docs the per-project view knows how to render (whitelist; prevents path traversal).
const DOC_FILES = cfg.docFiles;

// Which docs exist for a project, in order of relevance (CURRENT_FIRE first).
function docsFor(p) {
  const root = path.join(DOCS, p.dir);
  return DOC_FILES.filter((f) => {
    try { return fs.statSync(path.join(root, f)).isFile(); } catch { return false; }
  });
}
// Folders NOT walked by the file fallback scan (heavy / generated).
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vs', '.idea',
  'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', '.vscode',
]);

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
    execFileP('git', ['-C', cwd, 'log', '-n', '10', `--format=%h${sep}%s${sep}%cI${sep}%cr`]),
    execFileP('git', ['-C', cwd, 'status', '--porcelain']),
  ]);
  const changes = log.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [hash, msg, iso, rel] = line.split(sep);
    return { hash, msg, date: iso, ago: rel };
  });
  const dirtyLines = status.stdout.trim();
  const dirty = dirtyLines ? dirtyLines.split('\n').length : 0;
  // Days since the last commit (drives the staleness warning in the front end).
  const lastIso = changes[0]?.date || null;
  const staleDays = lastIso ? Math.floor((Date.now() - new Date(lastIso).getTime()) / 86400000) : null;
  // Commits not pushed / not pulled vs the upstream (null if there is no tracking branch).
  let ahead = null, behind = null;
  try {
    const rl = await execFileP('git', ['-C', cwd, 'rev-list', '--count', '--left-right', '@{upstream}...HEAD']);
    const [b, a] = rl.stdout.trim().split(/\s+/).map(Number);
    behind = b; ahead = a;
  } catch { /* no upstream configured */ }
  return { name: p.name, dir: p.dir, type: 'git', deploy: p.deploy || null, docs: docsFor(p), branch: branch.stdout.trim(), dirty, changes, staleDays, ahead, behind, metrics: null };
}

function recentFiles(root, max = 10) {
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
  const changes = recentFiles(root, 10).map((f) => ({
    hash: null, msg: f.rel.replace(/\\/g, '/'), date: new Date(f.mtime).toISOString(), ago: relTime(f.mtime),
  }));
  return { name: p.name, dir: p.dir, type: 'fs', deploy: p.deploy || null, docs: docsFor(p), branch: null, dirty: 0, changes, metrics: null };
}

// Read endpoint. Errors are reported per project (visible banner in the panel, not a silent catch).
app.get('/api/projects', async (req, res) => {
  const projects = [];
  for (const p of PROJECTS) {
    try {
      projects.push(p.type === 'git' ? await gitProject(p) : fsProject(p));
    } catch (e) {
      projects.push({ name: p.name, dir: p.dir, type: p.type, deploy: p.deploy || null, docs: [], branch: null, dirty: 0, changes: [], metrics: null, error: String(e?.message || e) });
    }
  }
  res.json({ generatedAt: new Date().toISOString(), root: DOCS, projects });
});

// Reads a markdown doc from a project. Double whitelist: the dir has to be in
// PROJECTS and the file in DOC_FILES -> impossible to escape the sandbox.
app.get('/api/doc', (req, res) => {
  const { dir, file } = req.query;
  const proj = PROJECTS.find((p) => p.dir === dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  if (!DOC_FILES.includes(file)) return res.status(400).json({ error: 'file not allowed' });
  const full = path.join(DOCS, proj.dir, file);
  try {
    const md = fs.readFileSync(full, 'utf8');
    res.json({ dir, file, md, path: full });
  } catch (e) {
    res.status(404).json({ error: `could not read ${file}: ${String(e?.message || e)}` });
  }
});

// --- Vault ----------------------------------------------------------------
// Every read is confined to the vault: we resolve the path and check that it
// lands inside the vault -> impossible to escape the sandbox via path traversal.
function insideVault(full) {
  if (!VAULT) return false;
  const rel = path.relative(VAULT, full);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function vaultRoot(p) {
  return (VAULT && p.vault) ? path.join(VAULT, p.vault) : null;
}

// Parses the board file (Obsidian Kanban) -> columns with cards.
function parseBoard(md) {
  const text = md.replace(/\r\n/g, '\n').split('%% kanban:settings')[0]; // cut off settings
  const lines = text.split('\n');
  const cols = [];
  let cur = null;
  let inFront = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i === 0 && raw.trim() === '---') { inFront = true; continue; }
    if (inFront) { if (raw.trim() === '---') inFront = false; continue; }
    const h = raw.match(/^##\s+(.*)$/);
    if (h) { cur = { title: h[1].trim(), cards: [] }; cols.push(cur); continue; }
    const item = raw.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    if (item && cur) {
      const done = item[1].toLowerCase() === 'x';
      const text = item[2].replace(/\[\[([^\]]+)\]\]/g, '$1').trim(); // strip wikilinks
      cur.cards.push({ text, done });
    }
  }
  return cols.filter((c) => c.title.toLowerCase() !== 'complete'); // 'Complete' is an internal marker
}

// Project board.
app.get('/api/board', (req, res) => {
  const proj = PROJECTS.find((p) => p.dir === req.query.dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  if (proj.board === false) return res.json({ columns: [], note: 'no board of its own (shares another project\'s)' });
  const root = vaultRoot(proj);
  if (!root) return res.json({ columns: [], note: 'no vault folder' });
  const full = path.join(root, BOARD_FILE);
  try {
    const md = fs.readFileSync(full, 'utf8');
    res.json({ columns: parseBoard(md) });
  } catch (e) {
    res.status(404).json({ error: `no ${BOARD_FILE} in ${proj.vault}: ${String(e?.message || e)}` });
  }
});

// Design docs list (Overview + Features + Decisions + loose notes from the project's vault).
app.get('/api/designs', (req, res) => {
  const proj = PROJECTS.find((p) => p.dir === req.query.dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  const root = vaultRoot(proj);
  if (!root) return res.json({ designs: [] });
  const items = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.md') && e.name !== BOARD_FILE) {
        try {
          const st = fs.statSync(full);
          const rel = path.relative(root, full).replace(/\\/g, '/');
          // Shared vault: when two projects live in one vault folder, narrow this down to the designs that touch THIS project.
          const relLc = rel.toLowerCase();
          if (proj.vaultFilter && !relLc.includes(proj.vaultFilter.toLowerCase())) continue;
          if (proj.vaultExclude && relLc.includes(proj.vaultExclude.toLowerCase())) continue;
          const group = rel.includes('/') ? rel.split('/')[0] : '·';
          items.push({ rel, title: e.name.replace(/\.md$/, ''), group, mtime: st.mtimeMs, ago: relTime(st.mtimeMs) });
        } catch {}
      }
    }
  };
  walk(root);
  items.sort((a, b) => b.mtime - a.mtime);
  res.json({ designs: items.map(({ mtime, ...rest }) => rest) });
});

// Project sessions (the sessions folder, filtered by name).
app.get('/api/sessions', (req, res) => {
  const proj = PROJECTS.find((p) => p.dir === req.query.dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  if (!SESSIONS_DIR) return res.json({ sessions: [], note: 'no sessions folder' });
  const m = proj.sessions || { include: [], exclude: [] };
  let entries;
  try { entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }); } catch (e) {
    return res.status(404).json({ error: `no sessions folder: ${String(e?.message || e)}` });
  }
  const lc = (s) => s.toLowerCase();
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const nm = lc(e.name);
    if (m.include.length && !m.include.some((k) => nm.includes(lc(k)))) continue;
    if (m.exclude.some((k) => nm.includes(lc(k)))) continue;
    const dateMatch = e.name.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)\.md$/);
    out.push({
      rel: e.name,
      date: dateMatch ? dateMatch[1] : null,
      title: dateMatch ? dateMatch[2] : e.name.replace(/\.md$/, ''),
    });
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ sessions: out });
});

// Reads a .md from the vault. scope='project' (rel relative to the project folder)
// or scope='sessions' (rel = file name in the sessions folder). Double sandbox.
app.get('/api/vaultdoc', (req, res) => {
  const { dir, rel, scope } = req.query;
  const proj = PROJECTS.find((p) => p.dir === dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  let base;
  if (scope === 'sessions') base = SESSIONS_DIR;
  else { base = vaultRoot(proj); if (!base) return res.status(404).json({ error: 'no vault' }); }
  const full = path.resolve(base, rel || '');
  if (!insideVault(full) || !full.endsWith('.md')) return res.status(400).json({ error: 'path not allowed' });
  try {
    const md = fs.readFileSync(full, 'utf8');
    res.json({ rel, md, path: full });
  } catch (e) {
    res.status(404).json({ error: `could not read: ${String(e?.message || e)}` });
  }
});

// --- Tasks (global TASKS.md) ----------------------------------------------
// TASKS.md lives at the configured root (the cross-project source of truth from CLAUDE.md).
// Structure: ## Status (Active/Waiting/Someday/Done) -> ### Project -> - [ ]/[x] item.
// We parse into groups by ### heading; each group remembers its ## status.
function parseTasks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const groups = [];
  let status = null;      // current ##
  let cur = null;         // current ### group
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const h2 = raw.match(/^##\s+(.*)$/);
    if (h2) { status = h2[1].trim(); cur = null; continue; }
    const h3 = raw.match(/^###\s+(.*)$/);
    if (h3) { cur = { heading: h3[1].trim(), status, line: n, items: [] }; groups.push(cur); continue; }
    const item = raw.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
    if (item && cur) {
      const done = item[1].toLowerCase() === 'x';
      const text = item[2].replace(/\[\[([^\]]+)\]\]/g, '$1').trim(); // strip wikilinks
      const you = MANUAL_MARKERS.some((mk) => text.toLowerCase().includes(mk)); // manual action, done by the user
      cur.items.push({ text, done, you, line: n }); // line = index in the file (used by the toggle)
    }
  }
  return groups;
}

// Project tasks (filters TASKS.md by ### heading).
app.get('/api/tasks', (req, res) => {
  const proj = PROJECTS.find((p) => p.dir === req.query.dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  const m = proj.tasks;
  if (!m || !m.include?.length) return res.json({ groups: [], note: 'no task mapping' });
  const file = path.join(DOCS, TASKS_FILE);
  let md;
  try { md = fs.readFileSync(file, 'utf8'); }
  catch (e) { return res.status(404).json({ error: `could not read ${TASKS_FILE}: ${String(e?.message || e)}` }); }
  const lc = (s) => s.toLowerCase();
  const groups = parseTasks(md).filter((g) => {
    const h = lc(g.heading);
    if (!m.include.some((k) => h.includes(lc(k)))) return false;
    if (m.exclude && m.exclude.some((k) => h.includes(lc(k)))) return false;
    return g.items.length > 0;
  });
  res.json({ groups });
});

// --- Deploy health ---------------------------------------------------------
// Pings the deploy URLs (HEAD, short timeout). Kept as a SEPARATE endpoint so
// network latency is not coupled to /api/projects (which the rail polls every 60s).
async function pingURL(url) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    if (res.status === 405 || res.status === 501) { // host that does not accept HEAD -> GET
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

app.get('/api/health', async (req, res) => {
  const targets = PROJECTS.filter((p) => p.deploy);
  const entries = await Promise.all(
    targets.map(async (p) => [p.dir, { url: p.deploy, ...(await pingURL(p.deploy)) }])
  );
  res.json({ checkedAt: new Date().toISOString(), health: Object.fromEntries(entries) });
});

// Opens the project folder in Cursor or in File Explorer. Whitelisted by dir
// (PROJECTS entries only) -> an arbitrary path cannot be opened.
app.post('/api/open', (req, res) => {
  const { dir, target } = req.body || {};
  const proj = PROJECTS.find((p) => p.dir === dir);
  if (!proj) return res.status(404).json({ error: 'unknown project' });
  const full = path.join(DOCS, proj.dir);
  try {
    if (target === 'cursor') {
      spawn('cursor', [full], { detached: true, stdio: 'ignore', shell: true }).unref();
    } else if (target === 'explorer') {
      spawn('explorer.exe', [full], { detached: true, stdio: 'ignore' }).unref();
    } else {
      return res.status(400).json({ error: 'invalid target (cursor|explorer)' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Mithra's WORKING_MEMORY (volatile layer, cap ~2000). Same trimming as the preload:
// drops the HTML comment and the title, keeps only the § body.
app.get('/api/workingmemory', (req, res) => {
  const file = path.join(DOCS, WM_FILE);
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { /* does not exist yet: empty body, editable so it can be created */ }
  const body = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/^#\s+.*$/m, '').trim();
  const cap = WM_CAP;
  res.json({ body, len: body.length, cap, pct: Math.round((body.length / cap) * 100), path: file, exists: !!raw });
});

// Saves the WORKING_MEMORY edited from the overlay. Preserves the title + HTML
// comment (what the preload trims off) and replaces only the § body.
app.put('/api/workingmemory', (req, res) => {
  const { body } = req.body || {};
  if (typeof body !== 'string') return res.status(400).json({ error: 'body required' });
  const file = path.join(DOCS, WM_FILE);
  try {
    let titleLine = `# ${path.basename(WM_FILE, '.md')}`;
    let comment = '';
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const tm = raw.match(/^#\s+.*$/m);       if (tm) titleLine = tm[0];
      const cm = raw.match(/<!--[\s\S]*?-->/); if (cm) comment = cm[0];
    } catch {}
    const parts = [titleLine];
    if (comment) parts.push(comment);
    parts.push(body.trim());
    fs.writeFileSync(file, parts.join('\n\n') + '\n', 'utf8');
    const cap = WM_CAP, len = body.trim().length;
    res.json({ ok: true, len, cap, pct: Math.round((len / cap) * 100) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Toggles a task by line number (robust against duplicate texts / wikilinks).
app.post('/api/tasks/toggle', (req, res) => {
  const { line, done } = req.body || {};
  if (!Number.isInteger(line)) return res.status(400).json({ error: 'line required' });
  const file = path.join(DOCS, TASKS_FILE);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const m = lines[line]?.match(/^(\s*-\s+\[)( |x|X)(\]\s+.*)$/);
    if (!m) return res.status(409).json({ error: 'that line is no longer a task (did the file change? reload)' });
    lines[line] = `${m[1]}${done ? 'x' : ' '}${m[3]}`;
    fs.writeFileSync(file, lines.join(eol), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Adds a new task under the project's first ### (preferring one under ## Active).
app.post('/api/tasks/add', (req, res) => {
  const { dir, text } = req.body || {};
  const proj = PROJECTS.find((p) => p.dir === dir);
  if (!proj || !proj.tasks?.include?.length) return res.status(404).json({ error: 'project has no task mapping' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  const file = path.join(DOCS, TASKS_FILE);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const lc = (s) => s.toLowerCase();
    const groups = parseTasks(raw).filter((g) =>
      proj.tasks.include.some((k) => lc(g.heading).includes(lc(k))) &&
      !(proj.tasks.exclude || []).some((k) => lc(g.heading).includes(lc(k))));
    if (!groups.length) return res.status(404).json({ error: 'could not find the project section in TASKS.md' });
    const g = groups.find((x) => lc(x.status || '') === 'active') || groups[0];
    lines.splice(g.line + 1, 0, `- [ ] ${text.trim().replace(/\r?\n/g, ' ')}`);
    fs.writeFileSync(file, lines.join(eol), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Daily standup: today's commits (since=midnight) + open tasks, per project.
app.get('/api/standup', async (req, res) => {
  const sep = '\x1f';
  const out = [];
  for (const p of PROJECTS) {
    const entry = { name: p.name, dir: p.dir, type: p.type, commits: [] };
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
    out.push(entry);
  }
  try {
    const groups = parseTasks(fs.readFileSync(path.join(DOCS, TASKS_FILE), 'utf8'));
    const lc = (s) => s.toLowerCase();
    for (const e of out) {
      const m = PROJECTS.find((p) => p.dir === e.dir)?.tasks;
      if (!m) continue;
      e.openTasks = groups
        .filter((g) => m.include.some((k) => lc(g.heading).includes(lc(k))) && !(m.exclude || []).some((k) => lc(g.heading).includes(lc(k))))
        .flatMap((g) => g.items).filter((i) => !i.done).length;
    }
  } catch {}
  res.json({ today: new Date().toISOString().slice(0, 10), projects: out });
});

// Diff of what is not committed yet (for the commit & push confirmation).
app.get('/api/git/diff', async (req, res) => {
  const proj = PROJECTS.find((p) => p.dir === req.query.dir);
  if (!proj || proj.type !== 'git') return res.status(404).json({ error: 'unknown git project' });
  const cwd = path.join(DOCS, proj.dir);
  try {
    const [stat, diff] = await Promise.all([
      execFileP('git', ['-C', cwd, 'status', '--porcelain']),
      execFileP('git', ['-C', cwd, 'diff', 'HEAD'], { maxBuffer: 8 * 1024 * 1024 }),
    ]);
    res.json({ files: stat.stdout.trim(), diff: diff.stdout });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Commit (& optional push). Destructive + outward-facing -> the front end confirms first.
app.post('/api/git/commit', async (req, res) => {
  const { dir, message, push } = req.body || {};
  const proj = PROJECTS.find((p) => p.dir === dir);
  if (!proj || proj.type !== 'git') return res.status(404).json({ error: 'unknown git project' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
  const cwd = path.join(DOCS, proj.dir);
  const steps = [];
  try {
    await execFileP('git', ['-C', cwd, 'add', '-A']);                 steps.push('add -A');
    await execFileP('git', ['-C', cwd, 'commit', '-m', message.trim()]); steps.push('commit');
    let pushed = false;
    if (push) { await execFileP('git', ['-C', cwd, 'push']); steps.push('push'); pushed = true; }
    res.json({ ok: true, steps, pushed });
  } catch (e) {
    res.status(500).json({ error: String(e?.stderr || e?.message || e).trim(), steps });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // The terminal is anchored to the project folder if the front end sends ?dir=...
  // (whitelisted by PROJECTS); otherwise it falls back to the root. That way you land
  // in the CLAUDE.md of the right repo instead of always at the root.
  let cwd = CWD;
  try {
    const dir = new URL(req.url, 'http://localhost').searchParams.get('dir');
    const proj = PROJECTS.find((p) => p.dir === dir);
    if (proj) cwd = path.join(DOCS, proj.dir);
  } catch {}
  // Without claude on the PATH there is no terminal. Say so in the console itself instead of dying silently.
  if (!CLAUDE) {
    try {
      ws.send('\r\n\x1b[33m☉ Mithra: could not find the claude executable.\x1b[0m\r\n');
      ws.send('Install Claude Code, or set "claudeBin" to an absolute path in mithra.config.json.\r\n');
    } catch {}
    return;
  }
  const term = pty.spawn(CLAUDE, [], {
    name: 'xterm-256color',
    cols: 100, rows: 30,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  term.onData((d) => { try { ws.send(d); } catch {} });
  term.onExit(() => { try { ws.close(); } catch {} });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'i') { term.write(msg.d); }
    else if (msg.t === 'r' && msg.cols && msg.rows) { try { term.resize(msg.cols, msg.rows); } catch {} }
  });

  ws.on('close', () => { try { term.kill(); } catch {} });
});

server.listen(PORT, HOST, () => {
  console.log(`☉ ${cfg.appName} UI on http://${HOST}:${PORT}`);
  console.log(`  config: ${cfg.source} · root: ${cfg.root}`);
  console.log(`  projects: ${PROJECTS.length} (${cfg.projectsMode}) · vault: ${VAULT ? 'yes' : 'no'} · claude: ${CLAUDE ? 'ok' : 'NOT FOUND'}`);
  if (!CLAUDE) console.log('  ⚠️  claude is not on the PATH — the terminal will not start until "claudeBin" is configured.');
});
