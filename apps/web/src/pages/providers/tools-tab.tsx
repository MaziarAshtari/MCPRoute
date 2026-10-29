import { useState } from 'react';
import type { McpToolDefinition, ProviderDto } from '@mcproute/shared';
import { ChevronRight, RefreshCw, Search, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { CopyButton, RelativeTime } from '@/components/copy';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRefreshTools } from '@/queries/providers';

interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function describeType(property: Record<string, unknown>): string {
  const { type, items } = property;
  if (Array.isArray(property.enum)) return `enum: ${property.enum.map(String).join(' | ')}`;
  if (type === 'array' && isRecord(items) && typeof items.type === 'string') return `${items.type}[]`;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.map(String).join(' | ');
  if (property.anyOf || property.oneOf) return 'union';
  return 'any';
}

/** Top-level parameters of a JSON Schema object (the usual shape of MCP tool inputs). */
function schemaParameters(schema: unknown): Parameter[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(schema.properties).map(([name, value]) => {
    const property = isRecord(value) ? value : {};
    return {
      name,
      type: describeType(property),
      required: required.has(name),
      description: typeof property.description === 'string' ? property.description : '',
    };
  });
}

function ToolRow({ tool }: { tool: McpToolDefinition }) {
  const [open, setOpen] = useState(false);
  const parameters = schemaParameters(tool.inputSchema);
  const schemaJson = JSON.stringify(tool.inputSchema ?? {}, null, 2);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
        <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm font-medium">{tool.name}</code>
            {tool.title && <span className="text-sm text-muted-foreground">{tool.title}</span>}
            <Badge variant="outline" className="font-normal">
              {pluralize(parameters.length, 'parameter')}
            </Badge>
          </div>
          {tool.description && (
            <p className={cn('mt-1 text-sm whitespace-pre-line text-muted-foreground', !open && 'line-clamp-2')}>{tool.description}</p>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4 sm:pl-11">
        {parameters.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Parameter</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((parameter) => (
                  <tr key={parameter.name} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <code className="font-mono text-xs">{parameter.name}</code>
                      {parameter.required && <span className="ml-1 text-destructive" title="Required">*</span>}
                    </td>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-muted-foreground">{parameter.type}</code>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{parameter.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="relative">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
            Input schema
            <CopyButton value={schemaJson} label="Input schema" />
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{schemaJson}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolsTab({ provider }: { provider: ProviderDto }) {
  const refreshTools = useRefreshTools();
  const [search, setSearch] = useState('');
  const tools = provider.cachedTools;
  const needle = search.trim().toLowerCase();
  const visible = (tools ?? []).filter((tool) =>
    [tool.name, tool.title ?? '', tool.description ?? ''].some((value) => value.toLowerCase().includes(needle)),
  );

  const refreshButton = (
    <Button
      variant="outline"
      disabled={refreshTools.isPending}
      onClick={() =>
        refreshTools.mutate(provider.id, {
          onSuccess: (result) => toast.success(`Fetched ${pluralize(result.tools.length, 'tool')} from ${provider.name}`),
        })
      }
    >
      {refreshTools.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      Refresh tools
    </Button>
  );

  if (tools === null || tools.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={tools === null ? 'Tools have not been fetched yet' : 'The server reported no tools'}
        description="Refreshing runs tools/list upstream with one of this provider's available keys and caches the result."
        action={refreshButton}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {pluralize(tools.length, 'tool')} cached
          {provider.toolsFetchedAt && (
            <>
              {' '}
              · fetched <RelativeTime value={provider.toolsFetchedAt} />
            </>
          )}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="sm:w-64">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput placeholder="Filter tools" aria-label="Filter tools" value={search} onChange={(event) => setSearch(event.target.value)} />
          </InputGroup>
          {refreshButton}
        </div>
      </div>
      <div className="divide-y rounded-xl border bg-card">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tools match “{search}”.</p>
        ) : (
          visible.map((tool) => <ToolRow key={tool.name} tool={tool} />)
        )}
      </div>
    </div>
  );
}
