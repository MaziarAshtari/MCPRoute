/**
 * Manual smoke test for an MCPRoute endpoint: connects with the official MCP SDK client, lists the tools
 * and optionally calls one.
 *
 *   pnpm smoke-test <endpoint-url> <token> [tool] [json-arguments] [--sse] [--query-token]
 *   pnpm smoke-test http://localhost:3000/mcp/research mcpr_xxx web_search_exa '{"query":"MCP"}'
 *
 * MCPROUTE_URL and MCPROUTE_TOKEN may replace the first two arguments.
 *   --sse          use the legacy SSE transport (<endpoint-url>/sse; the endpoint needs enableSse)
 *   --query-token  send the token as ?token= instead of an Authorization header
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const USAGE = 'Usage: pnpm smoke-test <endpoint-url> <token> [tool] [json-arguments] [--sse] [--query-token]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')));
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const fromEnv = [process.env.MCPROUTE_URL, process.env.MCPROUTE_TOKEN].filter((value): value is string => !!value);
const useEnv = fromEnv.length === 2 && !/^https?:\/\//.test(positional[0] ?? '');
const [endpointUrl, token, toolName, rawArgs] = useEnv ? [...fromEnv, ...positional] : positional;
if (!endpointUrl || !token) fail(USAGE);

let toolArgs: Record<string, unknown> | undefined;
if (rawArgs !== undefined) {
  try {
    toolArgs = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    fail(`Tool arguments must be a JSON object, got: ${rawArgs}`);
  }
}

const url = new URL(flags.has('--sse') ? `${endpointUrl.replace(/\/+$/, '')}/sse` : endpointUrl);
const requestInit: RequestInit = {};
if (flags.has('--query-token')) url.searchParams.set('token', token);
else requestInit.headers = { Authorization: `Bearer ${token}` };

const transport: Transport = flags.has('--sse')
  ? new SSEClientTransport(url, { requestInit })
  : new StreamableHTTPClientTransport(url, { requestInit });
const client = new Client({ name: 'mcproute-smoke-test', version: '1.0.0' });
const shownUrl = url.href.replace(/([?&]token=)[^&]+/, '$1***');

try {
  const started = performance.now();
  await client.connect(transport);
  const server = client.getServerVersion();
  const elapsed = Math.round(performance.now() - started);
  console.log(`Connected to ${shownUrl} (${server?.name ?? 'unknown'} ${server?.version ?? ''}) in ${elapsed} ms`);
  if (transport instanceof StreamableHTTPClientTransport) console.log(`Session: ${transport.sessionId ?? '(none)'}`);

  const { tools } = await client.listTools();
  console.log(`\n${tools.length} tool(s):`);
  for (const tool of tools) console.log(`  - ${tool.name}${tool.description ? `: ${tool.description.split('\n')[0]}` : ''}`);

  if (toolName) {
    console.log(`\nCalling ${toolName} ${toolArgs ? JSON.stringify(toolArgs) : '{}'} ...`);
    const callStarted = performance.now();
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    console.log(`Result (${Math.round(performance.now() - callStarted)} ms${result.isError ? ', isError' : ''}):`);
    console.log(JSON.stringify(result, null, 2));
    if (result.isError) process.exitCode = 2;
  }
} catch (error) {
  console.error(`Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (transport instanceof StreamableHTTPClientTransport) await transport.terminateSession().catch(() => undefined);
  await client.close().catch(() => undefined);
}
