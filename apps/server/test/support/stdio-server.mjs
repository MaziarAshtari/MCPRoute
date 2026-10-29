// Minimal stdio MCP server used by the gateway tests. Reports what it received from MCPRoute
// (upper-cased, because MCPRoute masks the exact key in upstream results).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'stdio-mock', version: '1.0.0' });
server.registerTool('report', { description: 'Reports the key and proxy settings it was started with' }, async () => ({
  content: [
    {
      type: 'text',
      text: [
        `env=${(process.env.MOCK_API_KEY ?? '').toUpperCase()}`,
        `arg=${(process.argv[2] ?? '').toUpperCase()}`,
        `proxy=${process.env.HTTPS_PROXY && process.env.ALL_PROXY ? 'set' : 'unset'}`,
      ].join(' '),
    },
  ],
}));
await server.connect(new StdioServerTransport());
