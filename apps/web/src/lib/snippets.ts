export const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>';

/** MCP protocol revision announced in the curl example (the SDK's latest). */
const PROTOCOL_VERSION = '2025-11-25';

export interface ConnectSnippet {
  id: 'claude' | 'cursor' | 'vscode' | 'http';
  label: string;
  /** Where the snippet goes. */
  location: string;
  description: string;
  code: string;
}

interface SnippetOptions {
  /** Server name used as the config key (the endpoint slug). */
  name: string;
  url: string;
  /** The plaintext token when known, otherwise TOKEN_PLACEHOLDER is used. */
  token?: string;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export function buildConnectSnippets({ name, url, token = TOKEN_PLACEHOLDER }: SnippetOptions): ConnectSnippet[] {
  const inputId = `mcproute-${name}-token`;
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'curl', version: '1.0.0' } },
  });

  return [
    {
      id: 'claude',
      label: 'Claude Desktop',
      location: 'claude_desktop_config.json',
      description:
        'Claude Desktop connectors cannot send a bearer token, so this uses the mcp-remote bridge (requires Node.js). Restart Claude Desktop afterwards.',
      code: json({
        mcpServers: {
          [name]: {
            command: 'npx',
            args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${MCPROUTE_AUTH}'],
            env: { MCPROUTE_AUTH: `Bearer ${token}` },
          },
        },
      }),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      location: '~/.cursor/mcp.json or .cursor/mcp.json',
      description: 'Cursor connects over Streamable HTTP and sends the token as a bearer token.',
      code: json({ mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${token}` } } } }),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      location: '.vscode/mcp.json',
      description:
        'VS Code asks for the token the first time the server starts and stores it securely, so the token never ends up in the file.',
      code: json({
        inputs: [{ type: 'promptString', id: inputId, description: `MCPRoute access token (${name})`, password: true }],
        servers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer \${input:${inputId}}` } } },
      }),
    },
    {
      id: 'http',
      label: 'Streamable HTTP',
      location: 'Any MCP client or curl',
      description:
        'Any Streamable HTTP client works: POST JSON-RPC to the URL with the token as a bearer token (or ?token=). This request opens a session; reuse the returned Mcp-Session-Id header.',
      code: [
        `curl -i -X POST '${url}' \\`,
        `  -H 'Authorization: Bearer ${token}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -H 'Accept: application/json, text/event-stream' \\`,
        `  -d '${initialize}'`,
      ].join('\n'),
    },
  ];
}
