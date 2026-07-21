// Builds the throwaway demo workspace and walks every tool against it, printing what
// an MCP client would receive. This is the 30-second "show me it works" path — no
// config to write, no repos of your own involved.
//
//   npm run demo
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoWorkspace } from './make-demo-workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('☉ Mithra MCP — demo\n');
console.log('building a throwaway workspace (3 fake repos, real git history)…');
const { root, configPath } = buildDemoWorkspace();
console.log(`  → ${root}\n`);

// Re-exec the tool walk in a child process: lib.js reads its config at import time,
// so the env has to be set before the module graph loads.
const res = spawnSync(process.execPath, [path.join(__dirname, 'walk-tools.mjs')], {
  env: { ...process.env, MITHRA_CONFIG: configPath },
  stdio: 'inherit',
});

console.log(`\ndelete it whenever — it's just a temp folder:\n  ${root}`);
process.exit(res.status ?? 1);
