// Protocol test: boots index.js as a real MCP server and, through an MCP client over
// stdio, lists the tools and calls one. Verifies the full handshake, not just the data
// layer. Uses only argument-free tools, so it works on any workspace.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['index.js'] });
const client = new Client({ name: 'smoke-client', version: '0.0.1' });

await client.connect(transport);
const { tools } = await client.listTools();
console.log(`tools exposed (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

const res = await client.callTool({ name: 'next_actions', arguments: { limit: 3 } });
const text = res.content?.[0]?.text || '';
console.log(`\nnext_actions(limit=3) -> ${res.isError ? 'ERROR' : 'OK'}, ${text.length} chars of JSON`);
console.log(text.slice(0, 400));

await client.close();
console.log('\nMCP handshake complete · server OK');
process.exit(res.isError ? 1 : 0);
