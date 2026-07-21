<div align="center">

# ☉ Mithra MCP

**Your workspace as state an agent can reason over.**

An [MCP](https://modelcontextprotocol.io) server that turns a one-person, multi-project
workspace into queryable tools — live git state, Kanban boards, tasks, standups, production
health — so any MCP client can ask about it in natural language instead of guessing from
stale context.

[![license](https://img.shields.io/badge/license-MIT-f5c542)](LICENSE)
&nbsp;·&nbsp; read-only &nbsp;·&nbsp; stdio, no network port &nbsp;·&nbsp; no build step &nbsp;·&nbsp; Node 18+

</div>

---

```
"which repos are stale?"       → list_projects
"what should I attack first?"  → next_actions
"is prod up?"                  → deploy_health
```

I run several projects at once — a SaaS, a B2C app, a landing site, a game project, and the
tooling that holds it together — as a single engineer. Context evaporates between sessions.
**Mithra** is the local-first command-center I built on Claude Code primitives to keep all of
it in view. This repo is one piece of it: the part that exposes a workspace over the Model
Context Protocol, so *any* client — Claude Desktop, Claude Code — can query it live.

Point it at your own folders with one JSON file and it's yours. Nothing about my workspace is
baked into the code.

## The idea: bounded memory + retrieval, not a bigger prompt

Mithra is built on two convictions, each borrowed from work I admire.

**Bounded working memory — after [Hermes](https://nousresearch.com/) (Nous Research).** An agent
shouldn't drag an ever-growing transcript behind it. Mithra keeps a small, *frozen*
working-memory snapshot — a few hundred words of current focus, live decisions, and open loops —
injected at session start, with an alarm when it fills past ~80%. The bet: a tight, curated
memory beats an unbounded one that quietly rots.

But a bounded memory can't hold everything — and shouldn't try. That's what this repo is for.
**Instead of stuffing workspace state into the prompt, Mithra leaves it where it lives and
exposes it as queryable tools.** The model carries a small memory and *pulls live truth on
demand*. Bounded context, on-demand retrieval — the two halves of the same idea.

**Local-first — after [Odysseus](https://en.wikipedia.org/wiki/Odysseus).** Your workspace is
yours. Mithra reads your real filesystem from your machine: stdio transport, no network port,
no cloud, no data leaving the building (the one exception — a production health-check — is an
outbound ping to your own URLs). The command-center has no backend because it doesn't need one.

## Tools

| Tool | What it returns |
|------|-----------------|
| `list_projects` | Per-repo: branch, recent commits, uncommitted files, staleness, ahead/behind upstream |
| `get_board` | A project's Kanban board (parsed from Obsidian markdown) |
| `get_tasks` | Open tasks for a project from `TASKS.md`, flagging manual-only items |
| `daily_standup` | Today's commits since midnight + open-task counts, per project |
| `deploy_health` | HTTP ping (status + latency) to each production URL |
| `next_actions` | **What to attack first**, ranked — crosses focus priority + open tasks + repo signals (unpushed commits, uncommitted changes, staleness) and returns a prioritized list with the reason and a suggested task per project |

`next_actions` is the brain: it doesn't just report state, it weighs it. Focus priority
dominates; pending work (open tasks, unpushed commits, dirty trees, staleness) breaks ties and
surfaces a low-priority project that's quietly piling up. The model gets *a decision*, not a
dashboard to interpret.

## See it work in 30 seconds

No config, no repos of your own involved: `npm run demo` builds a throwaway workspace in your
temp folder — three fake projects with real git history, a `TASKS.md`, Kanban boards — and walks
every tool against it. This is verbatim output:

```console
$ npm run demo
☉ Mithra MCP — demo

building a throwaway workspace (3 fake repos, real git history)…
  → /tmp/mithra-demo-workspace

── list_projects ─────────────────────────────────────────────
"which repos are stale?"
  web-app    main · 1 dirty · 1d since last commit
             chore: bump SDK to 2.4.0
  landing    main · 0 dirty · 2 ahead · 14d since last commit
             copy: tighten the value prop above the fold
  api        main · 0 dirty · 2d since last commit
             test: cover the token-reuse path

── next_actions ──────────────────────────────────────────────
"what should I attack first?"
  1. web-app — priority #1 · 4 open task(s)
     → Wire the checkout webhook to the retry queue
     ⚑ 1 uncommitted file(s) · 1 manual task(s) of yours
  2. landing — priority #3 · 2 open task(s) · unpushed work
     → Add the analytics pixel to the lead form
     ⚑ 2 unpushed commit(s) · untouched for 14d · 1 manual task(s) of yours
  3. api — priority #2 · 1 open task(s)
     → Rate-limit the token endpoint per client, not per IP

── get_tasks ─────────────────────────────────────────────────
"what is open on the landing page?"
  [Active] landing
    - Add the analytics pixel to the lead form
    - (you) Pick the headline variant for the A/B test  (yours, manual)

── get_board ─────────────────────────────────────────────────
"where is the web app right now?"
  Ideas        Usage-based pricing tier, Self-serve refunds
  Next         Retry queue for webhooks, Idempotency backfill
  In progress  Checkout hardening
  Done         Payment-intent migration, PSP sandbox parity

── deploy_health ─────────────────────────────────────────────
"is prod up?"
  ● web-app    200 · 481ms · https://example.com
  ● landing    200 · 456ms · https://example.org

6 tools, read-only, over stdio. No network port, no cloud.
```

Note `landing`: priority #3, but it surfaces above `api` because two commits are sitting
unpushed and nobody has touched it in two weeks. That's `next_actions` weighing state instead
of reporting it. The demo folder is a temp directory — delete it whenever.

## Design notes

These were deliberate, and they're the interesting part:

- **Read-only by design.** This server never writes, commits, or touches secrets or prod.
  Destructive actions belong behind a confirmation step in a GUI, not on an always-available
  tool surface. An agent with broad write access to your real repos is a footgun; this draws
  the line on purpose.
- **stdio transport, no network port.** JSON-RPC over stdio to a local client. Nothing is
  exposed to the network.
- **Errors are visible, never swallowed.** If one repo fails to read, the rest still return and
  the failed one carries an explicit `error` field. Failures surface; they don't hide behind an
  empty result.
- **Pure data layer.** All workspace logic lives in `lib.js` with zero MCP coupling, so it's
  testable without standing up a server (`npm run smoke`).
- **Zero workspace assumptions.** Everything user-specific lives in one gitignored config file;
  the code knows nothing about any particular set of projects.

## Quick start

```bash
git clone https://github.com/RuiciroRS/mithra-mcp.git
cd mithra-mcp
npm install

cp mithra.config.example.json mithra.config.json   # then edit it

npm run smoke          # verifies the data layer against your workspace
npm start              # starts the MCP server on stdio
```

**Zero-config:** drop this folder *next to your repos* and skip the config file entirely —
Mithra defaults to `root: ".."` and **auto-scans the parent folder** for git repos.

## Configuration

Everything lives in **`mithra.config.json`** (gitignored — yours alone). Full reference in
[`mithra.config.example.json`](mithra.config.example.json).

| Key | Default | What it does |
|-----|---------|--------------|
| `root` | `".."` | Where your projects live (relative to this folder, or absolute). `MITHRA_DOCS` overrides it. |
| `tasksFile` | `"TASKS.md"` | Cross-project checklist at the root. Parsed as `## Status` → `### Project` → `- [ ] item`. |
| `manualTaskMarkers` | `["(you)"]` | A task containing one of these is flagged as your own manual action, not delegable. |
| `vault` | `null` | Optional Obsidian vault: `{ dir, sessionsDir, boardFile }`. Powers `get_board`. |
| `projects` | `"auto"` | `"auto"` scans `root`, or list them explicitly. |

### Explicit projects

```jsonc
"projects": [
  {
    "name": "My App",
    "dir": "my-app",                 // folder under root
    "type": "git",                   // "git" (uses git log) | "fs" (falls back to file mtime)
    "deploy": "https://my-app.com",  // optional — enables the health ping
    "vault": "01_MyApp",             // optional — folder in your vault
    "priority": 1,                   // your focus order; null = outside the core order
    "tasks": { "include": ["My App"], "exclude": [] }
  }
]
```

### Wire it into an MCP client

`claude_desktop_config.json` (or any MCP client config):

```json
{
  "mcpServers": {
    "mithra": {
      "command": "node",
      "args": ["C:\\path\\to\\mithra-mcp\\index.js"],
      "env": { "MITHRA_DOCS": "C:\\path\\to\\workspace" }
    }
  }
}
```

## Tests

```bash
npm run demo            # throwaway workspace + a walk through all six tools
npm run smoke           # data layer against your real workspace, per-tool pass/fail
npm run test:protocol   # boots the server and drives it through a real MCP client
```

All three are workspace-agnostic: they pick their targets from config, so a fork runs them
without editing a line. `MITHRA_CONFIG=/path/to/other.json` points any of them at an alternate
workspace — that's how the demo runs without touching yours.

## Where this is going

The destination, no hedging: **a local-first agent that holds an entire one-person operation in
a memory small enough to reason over, retrieving live truth on demand instead of hoarding stale
context.** Concretely, next:

- **Writes behind confirmation.** `commit_and_push`, `create_task`, `move_card` — mutations the
  model can *propose* and you approve in one step, never an always-on write surface.
- **More state, same shape.** CI status, error budgets, calendar, inbox — anything that answers
  "what needs me right now" becomes another read-only tool.
- **The memory loop closes itself.** The working-memory snapshot stops being hand-curated: the
  agent proposes what to promote, demote, and forget, with you as the editor.
- **The GUI and the tools converge.** [Mithra UI](https://github.com/RuiciroRS/mithra-ui) already
  embeds the real Claude CLI (node-pty + xterm.js + WebSockets); these tools become how it
  thinks, not just what it shows.

## The other half

**[Mithra UI](https://github.com/RuiciroRS/mithra-ui)** — the GUI of the same command-center:
one local window over every repo, with a live project rail, embedded real Claude terminals,
boards, tasks and one-click commit. Same workspace, different surface. Also MIT, also fork-first.

## Stack

Node (ESM) · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) · `zod`. No build step.

---

Built by **Ruiciro Rivera** as one piece of Mithra, a local-first agentic command-center on
Claude Code — [GitHub](https://github.com/RuiciroRS) ·
[LinkedIn](https://linkedin.com/in/ruiciro-rivera-serrano-b357b2153). Credits in
[CREDITS.md](CREDITS.md). Licensed [MIT](LICENSE).
