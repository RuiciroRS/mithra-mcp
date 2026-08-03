#!/usr/bin/env node
// Mithra MCP — stdio server. Exposes a one-person, multi-project workspace (repo
// state, Kanban boards, tasks, standup, deploy health) as MCP tools for any client
// (Claude Desktop, Claude Code, etc.). The data logic lives in lib.js; this file
// only maps it to tools.
//
// Every answer is auditable: each payload carries `sources` — the repo and file it
// was read from, plus the declared config filter that assigned that content to the
// project. Ownership is declared, not inferred, and the answer shows which.
//
// Deliberate design: READ-ONLY. This server never writes, never commits, never
// touches secrets or prod. stdio transport = local, no network port exposed.
// Destructive actions (commit & push) live in the GUI behind a confirmation step,
// not on an always-available tool surface.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listProjects, getBoard, getTasks, dailyStandup, deployHealth, nextActions, PROJECTS } from './lib.js';

const server = new McpServer({ name: 'mithra-mcp', version: '0.3.0' });

// Helper: wrap any data as JSON text content (MCP format).
const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
// Helper: visible error (isError) instead of a silent catch — the client sees what broke.
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${String(e?.message || e)}` }] });

const projectArg = z
  .string()
  .describe(`Project name or folder. Options: ${PROJECTS.map((p) => p.name).join(', ')}`);

server.tool(
  'list_projects',
  'State of every project in the workspace: branch, recent commits, uncommitted files, staleness in days, and commits ahead/behind upstream. Each project carries `sources` (the repo behind the answer).',
  {},
  async () => {
    try { return json(await listProjects()); } catch (e) { return fail(e); }
  }
);

server.tool(
  'get_board',
  "A project's Kanban board, parsed from the Obsidian vault (columns such as Ideas / Next / In progress / Blocked / Done). Carries `sources` (the board file read, and the vault folder the config maps to this project).",
  { project: projectArg },
  async ({ project }) => {
    try { return json(getBoard(project)); } catch (e) { return fail(e); }
  }
);

server.tool(
  'get_tasks',
  'Tasks for a project from TASKS.md. Open ones by default; flags which items are a manual action of the user (not delegable). Carries `sources`: the shared file read and the declared filters that assign those sections to this project.',
  { project: projectArg, openOnly: z.boolean().default(true).describe('true = only unfinished tasks') },
  async ({ project, openOnly }) => {
    try { return json(getTasks(project, { openOnly })); } catch (e) { return fail(e); }
  }
);

server.tool(
  'daily_standup',
  "Today's standup: commits since midnight and open-task counts, per project. Each project carries `sources` (its repo, and TASKS.md when tasks are mapped).",
  {},
  async () => {
    try { return json(await dailyStandup()); } catch (e) { return fail(e); }
  }
);

server.tool(
  'deploy_health',
  'Production health: HTTP ping (status + latency) to each configured production URL. Each entry carries `sources` (the repo that declares the URL).',
  {},
  async () => {
    try { return json(await deployHealth()); } catch (e) { return fail(e); }
  }
);

server.tool(
  'next_actions',
  'What to attack first, ranked. Crosses focus priority + open tasks + repo signals (unpushed commits, uncommitted changes, staleness) and returns a prioritized list with the reason and a suggested task per project. Each action carries `sources`: the repo state and the shared TASKS.md it was ranked from.',
  { limit: z.number().int().min(1).max(8).default(5).describe('how many actions to return') },
  async ({ limit }) => {
    try { return json(await nextActions({ limit })); } catch (e) { return fail(e); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr: doesn't pollute the JSON-RPC channel on stdout; startup signal only.
console.error(`mithra-mcp on stdio — 6 tools ready, ${PROJECTS.length} projects mapped`);
