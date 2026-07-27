// Builds a throwaway demo workspace in your OS temp folder: three fake projects with
// real git history, a TASKS.md and Kanban boards. Point the server at it to see every
// tool return meaningful data without exposing — or needing — your own repos.
//
//   node demo/make-demo-workspace.mjs      # build it, print the path
//   npm run demo                           # build it and run the smoke test against it
//
// Everything lives under <tmp>/mithra-demo-workspace and can be deleted at any time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEMO_ROOT = path.join(os.tmpdir(), 'mithra-demo-workspace');

// Deterministic-ish history: offsets in days from today, so staleness flags are real.
const PROJECTS = [
  {
    name: 'web-app', type: 'git', vault: '01_WebApp', priority: 1,
    deploy: 'https://example.com',
    commits: [
      { days: 9, msg: 'feat(checkout): idempotency keys on payment intents' },
      { days: 4, msg: 'fix(checkout): retry webhook on 5xx from the PSP' },
      { days: 1, msg: 'chore: bump SDK to 2.4.0' },
    ],
    dirtyFile: 'src/checkout/queue.ts',   // leaves an uncommitted change
  },
  {
    name: 'landing', type: 'git', vault: '02_Landing', priority: 3,
    deploy: 'https://example.org',
    commits: [
      { days: 30, msg: 'feat: hero section + lead form' },
      { days: 22, msg: 'perf: inline critical css' },
      { days: 14, msg: 'copy: tighten the value prop above the fold' },
    ],
    unpushed: 2,                          // commits ahead of a local "remote"
  },
  {
    name: 'api', type: 'git', vault: '03_Api', priority: 2,
    deploy: null,
    commits: [
      { days: 6, msg: 'feat(auth): rotate refresh tokens on reuse' },
      { days: 2, msg: 'test: cover the token-reuse path' },
    ],
  },
];

const TASKS_MD = `# TASKS

## Active

### web-app
- [ ] Wire the checkout webhook to the retry queue
- [ ] Backfill idempotency keys for the 3 orders stuck in \`pending\`
- [ ] (you) Decide whether refunds go through the same queue
- [x] Ship the payment-intent migration

### landing
- [ ] Add the analytics pixel to the lead form
- [ ] (you) Pick the headline variant for the A/B test

### api
- [ ] Rate-limit the token endpoint per client, not per IP

## Backlog

### web-app
- [ ] Replace the polling status page with SSE
`;

const board = (title, cards) => `---
kanban-plugin: basic
---

## Ideas

${cards.ideas.map((c) => `- [ ] ${c}`).join('\n')}

## Next

${cards.next.map((c) => `- [ ] ${c}`).join('\n')}

## In progress

${cards.doing.map((c) => `- [ ] ${c}`).join('\n')}

## Done

${cards.done.map((c) => `- [x] ${c}`).join('\n')}

%% kanban:settings
\`\`\`
{"kanban-plugin":"basic"}
\`\`\`
%%
`;

const BOARDS = {
  '01_WebApp': board('web-app', {
    ideas: ['Usage-based pricing tier', 'Self-serve refunds'],
    next: ['Retry queue for webhooks', 'Idempotency backfill'],
    doing: ['Checkout hardening'],
    done: ['Payment-intent migration', 'PSP sandbox parity'],
  }),
  '02_Landing': board('landing', {
    ideas: ['Customer logos strip'],
    next: ['Analytics pixel', 'A/B the headline'],
    doing: [],
    done: ['Hero section', 'Lead form'],
  }),
  '03_Api': board('api', {
    ideas: ['gRPC gateway'],
    next: ['Per-client rate limits'],
    doing: ['Refresh-token rotation'],
    done: ['Auth service extraction'],
  }),
};

// Design docs: any .md in the project's vault folder that isn't the board.
// A nested folder becomes the group header, so the tab shows real structure.
const DESIGNS = {
  '01_WebApp': {
    'specs/Idempotency keys.md':
      '# Idempotency keys\n\nEvery payment intent carries a client-generated key. Replays return the\noriginal result instead of charging twice.\n\n- Key is scoped to the customer, not the session.\n- Stored for 24h, then the request is treated as new.\n- The PSP webhook is the source of truth; our record is a cache.\n',
    'specs/Webhook retry policy.md':
      '# Webhook retry policy\n\nExponential backoff with jitter, capped at six attempts over ~4 hours.\nAfter that the event lands in a dead-letter queue and pages nobody — it\nshows up on the board instead.\n\n| Attempt | Delay |\n|---|---|\n| 1 | 30s |\n| 2 | 2m |\n| 3 | 10m |\n| 6 | 2h |\n',
    'Pricing notes.md':
      '# Pricing notes\n\nUsage-based tier is still an idea, not a plan. Open question: do we meter\nrequests or successful checkouts? Metering failures punishes the customer\nfor our downtime.\n',
  },
  '02_Landing': {
    'Above the fold.md':
      '# Above the fold\n\nOne claim, one proof, one action. Everything else scrolls.\n\nThe headline test is queued behind the analytics pixel — without\nattribution we cannot read the result.\n',
    'notes/Copy review.md':
      '# Copy review\n\nCut the adjectives. The value prop should survive being read out loud by\nsomeone who has never seen the product.\n',
  },
  '03_Api': {
    'specs/Refresh token rotation.md':
      '# Refresh-token rotation\n\nEach refresh issues a new token and invalidates the old one. Reuse of a\nretired token means the token was stolen: kill the whole family and force\na re-login.\n\nDetection matters more than prevention here.\n',
    'specs/Rate limits.md':
      '# Per-client rate limits\n\nToken bucket per API key, not per IP — clients sit behind shared egress.\nBurst of 100, refill 10/s. 429 carries `Retry-After`.\n',
  },
};

// Session logs: dated notes in a shared folder, filtered per project by name.
const SESSIONS = [
  { days: 1, name: 'web-app — checkout hardening',
    body: 'Walked the retry path end to end. The webhook handler was swallowing\n5xx from the PSP and acking anyway, so failures looked like successes.\nFixed, and the dead-letter queue now surfaces on the board.\n' },
  { days: 5, name: 'web-app — idempotency backfill',
    body: 'Backfilled keys for intents created before the migration. 1.2M rows,\nchunked at 5k. No downtime, but the index rebuild took longer than the\nwrite itself.\n' },
  { days: 12, name: 'landing — headline test',
    body: 'Wrote three variants. Parked until the pixel is live: shipping a test\nwe cannot measure is just shipping a guess.\n' },
  { days: 20, name: 'api — token rotation',
    body: 'Rotation works. The interesting part was reuse detection — a retired\ntoken coming back is the only signal that separates theft from a race\nbetween two tabs.\n' },
];

const git = (cwd, args, env = {}) =>
  execFileSync('git', ['-c', 'user.name=Mithra Demo', '-c', 'user.email=demo@example.com', ...args],
    { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });

const isoDaysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

function buildProject(p) {
  const dir = path.join(DEMO_ROOT, p.name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${p.name}\n\nDemo project for Mithra MCP.\n`);
  git(dir, ['init', '-q', '-b', 'main']);

  for (const [i, c] of p.commits.entries()) {
    fs.writeFileSync(path.join(dir, 'src', `step-${i}.txt`), `${c.msg}\n`);
    git(dir, ['add', '-A']);
    const when = isoDaysAgo(c.days);
    git(dir, ['commit', '-q', '-m', c.msg], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  }

  // A bare "remote" next to it, so ahead/behind is real rather than simulated.
  const remote = path.join(DEMO_ROOT, '.remotes', `${p.name}.git`);
  fs.mkdirSync(remote, { recursive: true });
  git(dir, ['init', '-q', '--bare', remote]);
  git(dir, ['remote', 'add', 'origin', remote]);
  if (p.unpushed && p.commits.length > p.unpushed) {
    // push everything except the last N commits, leaving them ahead of upstream
    git(dir, ['push', '-q', 'origin', `HEAD~${p.unpushed}:refs/heads/main`]);
    git(dir, ['branch', '-q', '--set-upstream-to=origin/main', 'main']);
  } else {
    git(dir, ['push', '-q', '-u', 'origin', 'main']);
  }

  if (p.dirtyFile) {
    const f = path.join(dir, p.dirtyFile);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '// work in progress\n');
    git(dir, ['add', '-A']);   // staged but uncommitted -> shows up as dirty
  }
  return dir;
}

export function buildDemoWorkspace() {
  fs.rmSync(DEMO_ROOT, { recursive: true, force: true });
  fs.mkdirSync(DEMO_ROOT, { recursive: true });

  for (const p of PROJECTS) buildProject(p);

  fs.writeFileSync(path.join(DEMO_ROOT, 'TASKS.md'), TASKS_MD);

  const vault = path.join(DEMO_ROOT, 'DemoVault');
  for (const [folder, md] of Object.entries(BOARDS)) {
    fs.mkdirSync(path.join(vault, folder), { recursive: true });
    fs.writeFileSync(path.join(vault, folder, 'Board.md'), md);
  }

  // Design docs, so the Designs tab has something to render.
  for (const [folder, files] of Object.entries(DESIGNS)) {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(vault, folder, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
  }

  // Session logs — "YYYY-MM-DD title.md", which is how the server parses them.
  const sessionsDir = path.join(vault, 'Sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  for (const s of SESSIONS) {
    const date = isoDaysAgo(s.days).slice(0, 10);
    fs.writeFileSync(
      path.join(sessionsDir, `${date} ${s.name}.md`),
      `# ${s.name}\n\n_${date}_\n\n${s.body}`
    );
  }

  // The config the server reads when MITHRA_DEMO is set (see config.js).
  const cfg = {
    root: DEMO_ROOT,
    tasksFile: 'TASKS.md',
    manualTaskMarkers: ['(you)'],
    vault: { dir: 'DemoVault', sessionsDir: 'Sessions', boardFile: 'Board.md' },
    projects: PROJECTS.map((p) => ({
      name: p.name, dir: p.name, type: p.type, deploy: p.deploy,
      vault: p.vault, priority: p.priority,
      tasks: { include: [p.name], exclude: [] },
      sessions: { include: [p.name], exclude: [] },
    })),
  };
  const cfgPath = path.join(DEMO_ROOT, 'mithra.demo.config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return { root: DEMO_ROOT, configPath: cfgPath };
}

// Run directly: build and report. pathToFileURL, not string surgery: on Windows
// import.meta.url is file:///C:/... (three slashes) and a hand-built file://C:/...
// never matched, so running this file directly did nothing at all.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { root, configPath } = buildDemoWorkspace();
  console.log(`demo workspace ready: ${root}`);
  console.log(`config:              ${configPath}`);
  console.log(`\nrun the tools against it with:\n  MITHRA_CONFIG="${configPath}" npm run smoke`);
}
