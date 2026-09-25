#!/usr/bin/env node
// Mithra — activity feed hook for Claude Code.
//
// Register it for PreToolUse, PostToolUse and PostToolUseFailure. Each tool call
// becomes two lines in a JSONL file: phase "start" when the tool is about to run,
// phase "end" when it returns, with its duration and ok true/false. Register all
// three: a tool that fails never fires PostToolUse, only PostToolUseFailure, and
// without it the call would look like it is still running. The GUI tails that
// file; anything else can too.
//
// A hook runs inside someone else's session, so this script must never get in the
// way: no output, no non-zero exit, no dependency beyond node's standard library.
// Every failure is swallowed and the process exits 0.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = '~/.mithra/feed.jsonl';
const DEFAULT_MAX_BYTES = 5_000_000;
const SUMMARY_MAX = 160;
// A start with no end after this long is treated as abandoned: its marker is
// dropped, and the GUI shows the row as "no end" instead of running.
const STALE_MS = 10 * 60 * 1000;

const PHASE = { PreToolUse: 'start', PostToolUse: 'end', PostToolUseFailure: 'end' };

function expandHome(p) {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p;
}

// Reads only the `feed` block of mithra.config.json. Deliberately not config.js:
// that one scans the workspace for repos, and this runs on every tool call.
function feedConfig() {
  const cfgPath = process.env.MITHRA_CONFIG
    ? path.resolve(process.env.MITHRA_CONFIG)
    : path.join(HERE, '..', 'mithra.config.json');
  let feed = {};
  try { feed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).feed || {}; } catch {}
  const base = path.dirname(cfgPath);
  const file = path.resolve(base, expandHome(process.env.MITHRA_FEED || feed.file || DEFAULT_FILE));
  return {
    file,
    maxBytes: Number(feed.maxBytes) || DEFAULT_MAX_BYTES,
    raw: feed.raw === true || process.env.MITHRA_FEED_RAW === '1',
  };
}

// Blank out things that look like credentials before they reach a file.
function redact(s) {
  return s
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[abpr]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})/g, '***')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
    .replace(/(--?(?:password|passwd|token|secret|api[-_]?key)[=\s]+)[^\s"']+/gi, '$1***')
    .replace(/(\b(?:PASSWORD|TOKEN|SECRET|API_KEY)[A-Z_]*=)[^\s"']+/g, '$1***');
}

function clip(s, n = SUMMARY_MAX) {
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

// One short line saying what the tool was asked to do.
function summarize(tool, input) {
  if (!input || typeof input !== 'object') return '';
  switch (tool) {
    case 'Bash':
    case 'PowerShell': return input.command || '';
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': return input.file_path || input.notebook_path || '';
    case 'Grep': return [input.pattern, input.path].filter(Boolean).join('  in ');
    case 'Glob': return [input.pattern, input.path].filter(Boolean).join('  in ');
    case 'Agent':
    case 'Task': return [input.subagent_type, input.description].filter(Boolean).join(' · ');
    case 'WebFetch': return input.url || '';
    case 'WebSearch': return input.query || '';
    case 'Skill': return input.skill || '';
    default: return JSON.stringify(input);
  }
}

// start/end correlation. One tiny file per in-flight call, named by tool_use_id.
// Files instead of a single state file because hooks for parallel tool calls run
// as separate processes at the same time, and they must not overwrite each other.
function pendingDir(file) { return file + '.pending'; }

function safeId(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80); }

function markStart(file, id, now) {
  const dir = pendingDir(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safeId(id)), String(now), { flag: 'wx' }); // wx: never overwrite
  sweepPending(dir, now);
}

function takeStart(file, id) {
  const p = path.join(pendingDir(file), safeId(id));
  try {
    const t = Number(fs.readFileSync(p, 'utf8'));
    fs.unlinkSync(p);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

// `force` sweeps regardless of count; used on rotation, when the starts those
// markers belong to have just moved to the old file.
function sweepPending(dir, now, force = false) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  if (!force && names.length < 50) return;
  for (const n of names) {
    try {
      const p = path.join(dir, n);
      if (now - fs.statSync(p).mtimeMs > STALE_MS) fs.unlinkSync(p);
    } catch {}
  }
}

// Size cap: move the full file aside once and start a fresh one. Only ever
// appends or renames; nothing here opens an existing file for truncation.
function rotate(file, maxBytes) {
  try {
    if (fs.statSync(file).size > maxBytes) {
      fs.renameSync(file, file + '.1');
      sweepPending(pendingDir(file), Date.now(), true);
    }
  } catch {}
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    const done = () => resolve(buf);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    setTimeout(done, 2000).unref(); // never wait on a stdin that doesn't close
  });
}

async function main() {
  const payload = JSON.parse(await readStdin());
  const phase = PHASE[payload.hook_event_name];
  if (!phase) return;

  const cfg = feedConfig();
  fs.mkdirSync(path.dirname(cfg.file), { recursive: true });
  const now = Date.now();
  const id = payload.tool_use_id || null;

  const entry = {
    v: 1,
    ts: new Date(now).toISOString(),
    phase,
    id,
    session: payload.session_id ? String(payload.session_id).slice(0, 8) : null,
    agent: payload.agent_type || null,
    agentId: payload.agent_id || null,
    tool: payload.tool_name || null,
    summary: clip(redact(summarize(payload.tool_name, payload.tool_input))),
    cwd: payload.cwd ? path.basename(payload.cwd) : null,
  };

  if (phase === 'start' && id) {
    try { markStart(cfg.file, id, now); } catch {}
  }
  if (phase === 'end') {
    // Claude Code reports duration_ms itself on recent versions; the start marker
    // is the fallback, and is cleared either way so it doesn't linger.
    const started = id ? takeStart(cfg.file, id) : null;
    entry.ms = Number.isFinite(payload.duration_ms) ? payload.duration_ms : started ? now - started : null;
    entry.ok = payload.hook_event_name !== 'PostToolUseFailure';
    if (payload.is_interrupt === true) entry.interrupted = true; // stopped by the user (Esc), not a real failure
    if (!entry.ok && payload.error != null) {
      entry.error = clip(redact(typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error)));
    }
  }

  rotate(cfg.file, cfg.maxBytes);
  fs.appendFileSync(cfg.file, JSON.stringify(entry) + '\n');

  // Debug aid: the payload as Claude Code sent it, to see which fields a given
  // version provides. Off by default. tool_response is clipped, never stored whole.
  if (cfg.raw) {
    const raw = { ...payload };
    if (raw.tool_response !== undefined) raw.tool_response = clip(JSON.stringify(raw.tool_response), 400);
    fs.appendFileSync(cfg.file + '.raw', JSON.stringify(raw) + '\n');
  }
}

main().catch(() => {}).finally(() => process.exit(0));
