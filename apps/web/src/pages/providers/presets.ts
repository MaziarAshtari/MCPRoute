import { API_KEY_PLACEHOLDER } from '@mcproute/shared';
import type { ProviderFormValues } from './provider-form-schema';

export interface ProviderPreset {
  id: string;
  label: string;
  description: string;
  docsUrl?: string;
  /** Applied over the default form values. */
  values: Partial<ProviderFormValues>;
}

const KEY = API_KEY_PLACEHOLDER;

// Checked against the official documentation in October 2026.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'exa',
    label: 'Exa',
    description: 'Exa web search over Streamable HTTP. The key is passed in the exaApiKey query parameter.',
    docsUrl: 'https://exa.ai/docs/reference/exa-mcp',
    values: {
      name: 'Exa',
      transport: 'streamable_http',
      url: `https://mcp.exa.ai/mcp?exaApiKey=${KEY}`,
      authMode: 'url_placeholder',
    },
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description: 'Tavily search and extract over Streamable HTTP. The key is passed in the tavilyApiKey query parameter.',
    docsUrl: 'https://docs.tavily.com/documentation/mcp',
    values: {
      name: 'Tavily',
      transport: 'streamable_http',
      url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${KEY}`,
      authMode: 'url_placeholder',
    },
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    description:
      'Firecrawl scraping and search over Streamable HTTP. The current docs send the key as a bearer token rather than in the URL path.',
    docsUrl: 'https://docs.firecrawl.dev/mcp-server',
    values: {
      name: 'Firecrawl',
      transport: 'streamable_http',
      url: 'https://mcp.firecrawl.dev/v2/mcp',
      authMode: 'header',
      authHeaderName: 'Authorization',
      authValueTemplate: `Bearer ${KEY}`,
    },
  },
  {
    id: 'brave',
    label: 'Brave Search',
    description:
      'The official Brave Search MCP server, started with npx over stdio inside the MCPRoute server. The key is passed in BRAVE_API_KEY.',
    docsUrl: 'https://github.com/brave/brave-search-mcp-server',
    values: {
      name: 'Brave Search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      env: [{ key: 'BRAVE_API_KEY', value: KEY }],
      authMode: 'env',
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Start from an empty configuration.',
    values: {},
  },
];
