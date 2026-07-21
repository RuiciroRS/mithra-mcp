# Credits

Mithra MCP stands on other people's work. Thanks to:

## Ideas

- **[Hermes](https://nousresearch.com/) (Nous Research)** — the bounded working-memory
  pattern this server is the other half of: a small, frozen memory snapshot instead of an
  ever-growing transcript. Mithra's bet is that a tight curated memory plus on-demand
  retrieval beats an unbounded context that quietly rots.

## Built on

- **[Model Context Protocol](https://modelcontextprotocol.io)** and the
  **[TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)** by Anthropic —
  the protocol and server plumbing.
- **[Claude Code](https://github.com/anthropics/claude-code)** by Anthropic — the client this
  was built against, and the tool it was built with.
- **[zod](https://github.com/colinhacks/zod)** — tool input schemas.
- **[Obsidian](https://obsidian.md)** and the
  **[Kanban plugin](https://github.com/mgmeyers/obsidian-kanban)** — the markdown board format
  `get_board` parses.

- **[xterm.js](https://xtermjs.org)**, **[node-pty](https://github.com/microsoft/node-pty)**,
  **[ws](https://github.com/websockets/ws)** and **[Express](https://expressjs.com)** — the
  GUI's embedded terminal and the server behind it.

Licensed [MIT](LICENSE).
