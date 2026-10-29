import type { EndpointDto } from '@mcproute/shared';
import { CopyButton, CopyField } from '@/components/copy';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TOKEN_PLACEHOLDER, buildConnectSnippets } from '@/lib/snippets';

export function endpointUrl(endpoint: Pick<EndpointDto, 'mcpPath'>): string {
  return `${window.location.origin}${endpoint.mcpPath}`;
}

interface ConnectPanelProps {
  endpoint: EndpointDto;
  /** Only known right after creating the endpoint or regenerating its token. */
  token?: string;
}

export function ConnectPanel({ endpoint, token }: ConnectPanelProps) {
  const url = endpointUrl(endpoint);
  const tokenValue = token ?? TOKEN_PLACEHOLDER;
  const snippets = buildConnectSnippets({ name: endpoint.slug, url, token });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Endpoint URL</div>
          <CopyField value={url} label="Endpoint URL" />
          <p className="text-xs text-muted-foreground">
            Send the token as <code className="font-mono">Authorization: Bearer {tokenValue}</code>.
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">URL with token</div>
          <CopyField value={`${url}?token=${tokenValue}`} label="URL with token" />
          <p className="text-xs text-muted-foreground">For clients that cannot set headers. Treat this URL like a password.</p>
        </div>
        {endpoint.enableSse && (
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Legacy SSE URL</div>
            <CopyField value={`${url}/sse`} label="SSE URL" />
          </div>
        )}
      </div>

      <Tabs defaultValue="claude">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          {snippets.map((snippet) => (
            <TabsTrigger key={snippet.id} value={snippet.id} className="flex-none">
              {snippet.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {snippets.map((snippet) => (
          <TabsContent key={snippet.id} value={snippet.id} className="mt-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{snippet.location}</span> — {snippet.description}
            </p>
            <div className="relative">
              <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
                {snippet.code}
              </pre>
              <CopyButton value={snippet.code} label={`${snippet.label} configuration`} className="absolute top-2 right-2" />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
