// Calls every tool against whatever workspace MITHRA_CONFIG points at and prints the
// result the way a client would see it. Used by `npm run demo`; safe to run on your
// own workspace too (it only reads).
import { listProjects, getBoard, getTasks, dailyStandup, deployHealth, nextActions } from '../lib.js';

const rule = (title) => console.log(`\n\x1b[33m── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}\x1b[0m`);
const ask = (q) => console.log(`\x1b[2m"${q}"\x1b[0m`);

rule('list_projects');
ask('which repos are stale?');
const { projects } = await listProjects();
for (const p of projects) {
  const bits = [p.branch, `${p.dirty} dirty`];
  if (p.ahead) bits.push(`${p.ahead} ahead`);
  if (typeof p.staleDays === 'number') bits.push(`${p.staleDays}d since last commit`);
  console.log(`  ${p.name.padEnd(10)} ${bits.join(' · ')}`);
  console.log(`  ${''.padEnd(10)} \x1b[2m${p.lastCommit?.msg || '—'}\x1b[0m`);
}

rule('next_actions');
ask('what should I attack first?');
const { actions } = await nextActions({ limit: 3 });
actions.forEach((a, i) => {
  console.log(`  ${i + 1}. \x1b[1m${a.project}\x1b[0m — ${a.reason}`);
  if (a.suggestedTask) console.log(`     → ${a.suggestedTask}`);
  if (a.flags.length) console.log(`     \x1b[33m⚑ ${a.flags.join(' · ')}\x1b[0m`);
});

rule('get_tasks');
ask('what is open on the landing page?');
const tasks = getTasks('landing');
for (const g of tasks.groups) {
  console.log(`  [${g.status}] ${g.heading}`);
  for (const i of g.items) console.log(`    - ${i.text}${i.you ? '  \x1b[33m(yours, manual)\x1b[0m' : ''}`);
}

rule('get_board');
ask('where is the web app right now?');
const board = getBoard('web-app');
for (const c of board.columns) {
  console.log(`  ${c.title.padEnd(12)} ${c.cards.map((x) => x.text).join(', ') || '—'}`);
}

rule('daily_standup');
ask('what did I ship today?');
const standup = await dailyStandup();
for (const p of standup.projects) {
  console.log(`  ${p.name.padEnd(10)} ${p.commits.length} commit(s) today · ${p.openTasks ?? 0} open task(s)`);
}

rule('deploy_health');
ask('is prod up?');
const { health } = await deployHealth();
for (const [name, h] of Object.entries(health)) {
  console.log(`  ${h.ok ? '\x1b[32m●\x1b[0m' : '\x1b[31m●\x1b[0m'} ${name.padEnd(10)} ${h.status} · ${h.ms}ms · ${h.url}`);
}

console.log('\n\x1b[2m6 tools, read-only, over stdio. No network port, no cloud.\x1b[0m');
