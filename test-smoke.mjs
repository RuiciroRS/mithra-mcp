// Smoke test for the data layer (lib.js) — runs without MCP. Verifies each tool reads
// the real workspace without blowing up. Exits 1 if something fails outright.
// Project-agnostic on purpose: it picks targets from your own config, so it works on
// any fork without editing a line.
import { listProjects, getBoard, getTasks, dailyStandup, deployHealth, nextActions, PROJECTS } from './lib.js';

let failed = 0;
const ok = (label, detail) => console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
const ko = (label, e) => { failed++; console.log(`  KO  ${label} — ${String(e?.message || e)}`); };

console.log('mithra-mcp smoke\n');

if (!PROJECTS.length) {
  console.log('  KO  no projects configured — copy mithra.config.example.json to mithra.config.json');
  process.exit(1);
}

// Targets chosen from config, not hardcoded: first project with a vault folder, and
// first with a task mapping. Falls back to the first project of all.
const boardTarget = (PROJECTS.find((p) => p.vault && p.board !== false) || PROJECTS[0]).name;
const taskTarget = (PROJECTS.find((p) => p.tasks?.include?.length) || PROJECTS[0]).name;

try {
  const r = await listProjects();
  const errs = r.projects.filter((p) => p.error);
  ok('list_projects', `${r.projects.length} projects, ${errs.length} with errors`);
  for (const p of r.projects) {
    const tag = p.error ? `ERROR: ${p.error}` : (p.type === 'git' ? `${p.branch} · dirty ${p.dirty}` : `fs · ${p.lastCommit?.ago || '—'}`);
    console.log(`        - ${p.name}: ${tag}`);
  }
} catch (e) { ko('list_projects', e); }

try {
  const r = getBoard(boardTarget);
  const cards = r.columns.reduce((n, c) => n + c.cards.length, 0);
  ok(`get_board(${boardTarget})`, r.note || `${r.columns.length} columns, ${cards} cards`);
} catch (e) { ko('get_board', e); }

try {
  const r = getTasks(taskTarget);
  const items = r.groups.reduce((n, g) => n + g.items.length, 0);
  ok(`get_tasks(${taskTarget})`, r.note || `${items} open tasks`);
} catch (e) { ko('get_tasks', e); }

try {
  const r = await dailyStandup();
  const commits = r.projects.reduce((n, p) => n + p.commits.length, 0);
  ok('daily_standup', `${commits} commits today`);
} catch (e) { ko('daily_standup', e); }

try {
  const r = await deployHealth();
  const up = Object.values(r.health).filter((h) => h.ok).length;
  ok('deploy_health', `${up}/${Object.keys(r.health).length} up`);
} catch (e) { ko('deploy_health', e); }

try {
  const r = await nextActions({ limit: 5 });
  ok('next_actions', `top ${r.actions.length}`);
  r.actions.forEach((a, i) => {
    console.log(`        ${i + 1}. ${a.project} (${a.reason})`);
    if (a.suggestedTask) console.log(`           → ${a.suggestedTask}`);
    if (a.flags.length) console.log(`           ⚑ ${a.flags.join(' · ')}`);
  });
} catch (e) { ko('next_actions', e); }

console.log(`\n${failed ? `FAILED (${failed})` : 'all green'} · ${PROJECTS.length} projects mapped`);
process.exit(failed ? 1 : 0);
