import { useState, type ReactNode } from 'react';
import type { EndpointProviderDto, ProviderDto } from '@mcproute/shared';
import { KeyRound, Pencil, Trash } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/copy';
import { PageHeader } from '@/components/page-header';
import { PageSkeleton, QueryError } from '@/components/states';
import { EnabledBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { formatNumber, pluralize } from '@/lib/format';
import { TOOL_FILTER_LABELS, TOOL_PREFIX_LABELS } from '@/lib/labels';
import { useDeleteEndpoint, useEndpoint, useRegenerateToken } from '@/queries/endpoints';
import { useSessions } from '@/queries/observability';
import { useProviders } from '@/queries/providers';
import { ConnectPanel } from './connect-panel';
import { TokenDialog, type IssuedToken } from './token-dialog';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

/** Number of tools a link exposes, when the provider's tool cache allows computing it. */
function exposedTools(link: EndpointProviderDto, provider: ProviderDto | undefined): string {
  const cached = provider?.cachedTools;
  if (link.toolFilterMode === 'allowlist') return pluralize(link.toolNames.length, 'tool');
  if (!cached) return link.toolFilterMode === 'all' ? 'All tools' : `All but ${link.toolNames.length}`;
  if (link.toolFilterMode === 'all') return pluralize(cached.length, 'tool');
  const hidden = new Set(link.toolNames);
  return pluralize(cached.filter((tool) => !hidden.has(tool.name)).length, 'tool');
}

export function EndpointDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const endpoint = useEndpoint(id);
  const providers = useProviders();
  const sessions = useSessions({ page: 1, pageSize: 1, endpointId: id });
  const regenerateToken = useRegenerateToken();
  const deleteEndpoint = useDeleteEndpoint();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tokenDialog = useDialogTarget<IssuedToken>();

  if (endpoint.isPending) return <PageSkeleton />;
  if (endpoint.isError) {
    return (
      <>
        <PageHeader back={{ to: '/endpoints', label: 'Endpoints' }} title="Endpoint" />
        <QueryError title="Could not load the endpoint" error={endpoint.error} onRetry={() => void endpoint.refetch()} />
      </>
    );
  }

  const data = endpoint.data;
  const providerById = new Map((providers.data ?? []).map((provider) => [provider.id, provider]));

  return (
    <>
      <PageHeader
        back={{ to: '/endpoints', label: 'Endpoints' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {data.name}
            <EnabledBadge enabled={data.enabled} />
          </span>
        }
        description={data.description ?? <code className="font-mono">{data.mcpPath}</code>}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/endpoints/${data.id}/edit`}>
                <Pencil data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setConfirmRegenerate(true)}>
              <KeyRound data-icon="inline-start" />
              Regenerate token
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Connect</CardTitle>
            <CardDescription>
              Copy the URL or a ready-made client configuration. Replace <code className="font-mono">&lt;YOUR_TOKEN&gt;</code> with
              this endpoint&apos;s access token (it ends in <code className="font-mono">{data.accessTokenHint.slice(-4)}</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectPanel endpoint={data} />
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Detail label="Path">
                  <code className="font-mono text-xs">{data.mcpPath}</code>
                </Detail>
                <Detail label="Token">
                  <code className="font-mono text-xs">{data.accessTokenHint}</code>
                </Detail>
                <Detail label="Tool names">{TOOL_PREFIX_LABELS[data.toolPrefixMode].label}</Detail>
                <Detail label="Legacy SSE">{data.enableSse ? 'Enabled' : 'Disabled'}</Detail>
                <Detail label="Active sessions">
                  {sessions.data ? (
                    <Link to={`/sessions?endpointId=${data.id}`} className="underline-offset-4 hover:underline">
                      {formatNumber(sessions.data.total)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Detail>
                <Detail label="Created">
                  <RelativeTime value={data.createdAt} />
                </Detail>
                <Detail label="Updated">
                  <RelativeTime value={data.updatedAt} />
                </Detail>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Linked providers</CardTitle>
              <CardDescription>{pluralize(data.providers.length, 'provider')}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.providers.length === 0 ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>No providers are linked, so this endpoint exposes no tools.</p>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/endpoints/${data.id}/edit`}>Link providers</Link>
                  </Button>
                </div>
              ) : (
                <ul className="divide-y">
                  {data.providers.map((link) => (
                    <li key={link.providerId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <Link to={`/providers/${link.providerId}`} className="font-medium hover:underline">
                          {link.providerName}
                        </Link>
                        <div className="text-xs text-muted-foreground">{TOOL_FILTER_LABELS[link.toolFilterMode]}</div>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {exposedTools(link, providerById.get(link.providerId))}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Regenerate the access token?"
        description="The current token stops working immediately. Every MCP client using it must be updated."
        confirmLabel="Regenerate token"
        onConfirm={async () => {
          const result = await regenerateToken.mutateAsync(data.id);
          toast.success('New access token issued');
          tokenDialog.show({ endpoint: result, token: result.accessToken });
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${data.name}?`}
        description="MCP clients lose access immediately and its sessions are ended. Providers and keys are not affected."
        confirmLabel="Delete endpoint"
        onConfirm={async () => {
          await deleteEndpoint.mutateAsync(data.id);
          toast.success(`Endpoint "${data.name}" deleted`);
          navigate('/endpoints', { replace: true });
        }}
      />
      <TokenDialog issued={tokenDialog.target} open={tokenDialog.open} onOpenChange={tokenDialog.onOpenChange} />
    </>
  );
}
