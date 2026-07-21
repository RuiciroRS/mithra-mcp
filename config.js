// Mithra MCP — configuration loading.
// A single `mithra.config.json` (next to this file, gitignored) defines everything
// user-specific: where your projects live, which Obsidian vault to read, which
// TASKS.md to parse, and the project map itself. If it's missing, Mithra falls back
// to "auto" mode: it scans the parent folder for git repos and works with sane
// defaults. Nothing about one particular workspace is baked into the code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Folders that never count as a "project" during the auto scan.
const SCAN_IGNORE = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vs', '.idea',
  'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', '.vscode', '.cache',
  'mithra-mcp', // don't list yourself unless the user asks for it explicitly
]);

const DEFAULTS = {
  root: '..',                        // where your projects live (relative to this folder, or absolute)
  tasksFile: 'TASKS.md',             // cross-project source of truth, at the root
  manualTaskMarkers: ['(tú)', '(you)'], // a task carrying one of these is yours to do by hand
  vault: null,                       // { dir, sessionsDir, boardFile } or null if you don't use Obsidian
  projects: 'auto',                  // 'auto' = scan root; or an explicit array
};

// Resolve a path that may be absolute or relative to `base`.
function resolveFrom(base, p) {
  if (!p) return base;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

// Scan `root` for subfolders that look like projects (a git repo, or carrying a
// CLAUDE.md / README.md / package.json). Each becomes a project with sane defaults
// (no deploy URL, no vault folder, no focus priority).
function scanProjects(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SCAN_IGNORE.has(e.name)) continue;
    const full = path.join(root, e.name);
    const isGit = fs.existsSync(path.join(full, '.git'));
    const hasDoc = ['CLAUDE.md', 'README.md', 'package.json', 'AGENTS.md']
      .some((f) => fs.existsSync(path.join(full, f)));
    if (!isGit && !hasDoc) continue; // doesn't look like a project
    out.push({
      name: e.name,
      dir: e.name,
      type: isGit ? 'git' : 'fs',
      deploy: null,
      priority: null,
      tasks: { include: [e.name], exclude: [] },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadConfig() {
  // MITHRA_CONFIG points at an alternate config file — that's how the demo workspace
  // runs without touching yours. Otherwise: mithra.config.json next to this file.
  const cfgPath = process.env.MITHRA_CONFIG
    ? path.resolve(process.env.MITHRA_CONFIG)
    : path.join(__dirname, 'mithra.config.json');
  const label = path.basename(cfgPath);
  let user = {};
  let source = 'defaults+auto';
  if (fs.existsSync(cfgPath)) {
    try { user = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); source = label; }
    catch (e) { console.error(`[mithra] ${label} is invalid: ${e.message} — falling back to defaults.`); }
  } else if (process.env.MITHRA_CONFIG) {
    console.error(`[mithra] MITHRA_CONFIG points at a file that doesn't exist: ${cfgPath}`);
  }

  const cfg = { ...DEFAULTS, ...user };

  // MITHRA_DOCS wins over the config file: it's how MCP clients point the server at
  // a workspace without editing files (see the claude_desktop_config.json example).
  // Relative roots resolve against the config file's own folder, so an alternate
  // config (MITHRA_CONFIG) can live anywhere and still describe its own workspace.
  cfg.root = process.env.MITHRA_DOCS
    ? path.resolve(process.env.MITHRA_DOCS)
    : resolveFrom(path.dirname(cfgPath), cfg.root);

  cfg.tasksPath = path.join(cfg.root, cfg.tasksFile);

  // Vault (optional). Boards and session notes are read from here.
  if (cfg.vault && cfg.vault.dir) {
    cfg.vaultRoot = resolveFrom(cfg.root, cfg.vault.dir);
    cfg.sessionsDir = cfg.vault.sessionsDir ? path.join(cfg.vaultRoot, cfg.vault.sessionsDir) : null;
    cfg.boardFile = cfg.vault.boardFile || 'Board.md';
  } else {
    cfg.vaultRoot = null; cfg.sessionsDir = null; cfg.boardFile = 'Board.md';
  }

  // Projects: 'auto' -> scan root; array -> take as-is.
  if (cfg.projects === 'auto' || !Array.isArray(cfg.projects)) {
    cfg.projects = scanProjects(cfg.root);
    cfg.projectsMode = 'auto';
  } else {
    cfg.projectsMode = 'explicit';
  }

  cfg.source = source;
  return cfg;
}
