// Opens the GUI against the throwaway demo workspace instead of your real one.
//
// This exists so the README can show the interface. Screenshotting the real
// window would leak private repo names, board contents and task lists into a
// public repo; here every project on screen is fabricated.
//
//   npm run demo:ui
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoWorkspace } from './make-demo-workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// A port of its own, so a demo run never collides with the real UI already
// running in the background (autostart registers it at boot).
const DEMO_PORT = 7788;

console.log('☉ Mithra UI — demo mode\n');
console.log('building a throwaway workspace (3 fake repos, real git history)…');
const { root, configPath } = buildDemoWorkspace();

// buildDemoWorkspace writes the config for the MCP tools; the GUI needs a couple
// more keys. Patch them in rather than teaching the shared builder about the UI.
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
cfg.port = DEMO_PORT;
cfg.appName = 'Mithra';
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

console.log(`  → ${root}`);
console.log(`\neverything on screen is fake — safe to screenshot.`);
console.log(`open http://127.0.0.1:${DEMO_PORT}  (ctrl+c to stop)\n`);

const child = spawn(process.execPath, [path.join(ROOT, 'ui', 'server.js')], {
  env: { ...process.env, MITHRA_CONFIG: configPath },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill());
