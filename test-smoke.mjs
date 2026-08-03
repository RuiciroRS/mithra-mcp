// Smoke test for the data layer (lib.js) — runs without MCP. Verifies each tool reads
// the real workspace without blowing up. Exits 1 if something fails outright.
// Project-agnostic on purpose: it picks targets from your own config, so it works on
// any fork without editing a line.
import { listProjects, getBoard, getTasks, dailyStandup, deployHealth, nextActions, PROJECTS } from './lib.js';

let failed = 0;
const ok = (label, detail) => console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
const ko = (label, e) => { failed++; console.log(`  KO  ${label} — ${String(e?.message || e)}`); };

// Provenance contract: every payload that carries data must cite where it came from.
// An empty `sources` is only legal when nothing was read (a note-only response).
// Absent `sources` is always a bug — that's an answer with no way to check it.
function citesSources(label, payload, hasData) {
  const s = payload?.sources;
  if (!Array.isArray(s)) { failed++; console.log(`  KO  ${label} — no sources[] on the payload`); return; }
  if (hasData && !s.length) { failed++; console.log(`  KO  ${label} — returned data with an empty sources[]`); return; }
  for (const one of s) {
    if (!one.via || (!one.repo && !one.file)) {
      failed++; console.log(`  KO  ${label} — malformed source: ${JSON.stringify(one)}`); return;
    }
    // Not a failure: a vault living outside the workspace root can only be cited
    // absolutely. Worth flagging before you paste that output somewhere public.
    if (/^[a-zA-Z]:[\\/]|^\/(home|Users)\//.test(one.file || '')) {
      console.log(`      ⚠ ${label} cites an absolute path (source is outside your workspace root): ${one.file}`);
    }
  }
}

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
  for (const p of r.projects) citesSources(`list_projects/${p.name}`, p, true);
  for (const p of r.projects) {
    const tag = p.error ? `ERROR: ${p.error}` : (p.type === 'git' ? `${p.branch} · dirty ${p.dirty}` : `fs · ${p.lastCommit?.ago || '—'}`);
    console.log(`        - ${p.name}: ${tag}`);
  }
} catch (e) { ko('list_projects', e); }

try {
  const r = getBoard(boardTarget);
  const cards = r.columns.reduce((n, c) => n + c.cards.length, 0);
  ok(`get_board(${boardTarget})`, r.note || `${r.columns.length} columns, ${cards} cards`);
  citesSources('get_board', r, r.columns.length > 0);
} catch (e) { ko('get_board', e); }

try {
  const r = getTasks(taskTarget);
  const items = r.groups.reduce((n, g) => n + g.items.length, 0);
  ok(`get_tasks(${taskTarget})`, r.note || `${items} open tasks`);
  citesSources('get_tasks', r, items > 0);
} catch (e) { ko('get_tasks', e); }

try {
  const r = await dailyStandup();
  const commits = r.projects.reduce((n, p) => n + p.commits.length, 0);
  ok('daily_standup', `${commits} commits today`);
  for (const p of r.projects) citesSources(`daily_standup/${p.name}`, p, true);
} catch (e) { ko('daily_standup', e); }

try {
  const r = await deployHealth();
  const up = Object.values(r.health).filter((h) => h.ok).length;
  ok('deploy_health', `${up}/${Object.keys(r.health).length} up`);
  for (const [name, h] of Object.entries(r.health)) citesSources(`deploy_health/${name}`, h, true);
} catch (e) { ko('deploy_health', e); }

try {
  const r = await nextActions({ limit: 5 });
  ok('next_actions', `top ${r.actions.length}`);
  for (const a of r.actions) citesSources(`next_actions/${a.project}`, a, true);
  r.actions.forEach((a, i) => {
    console.log(`        ${i + 1}. ${a.project} (${a.reason})`);
    if (a.suggestedTask) console.log(`           → ${a.suggestedTask}`);
    if (a.flags.length) console.log(`           ⚑ ${a.flags.join(' · ')}`);
  });
} catch (e) { ko('next_actions', e); }

console.log(`\n${failed ? `FAILED (${failed})` : 'all green'} · ${PROJECTS.length} projects mapped`);
process.exit(failed ? 1 : 0);
