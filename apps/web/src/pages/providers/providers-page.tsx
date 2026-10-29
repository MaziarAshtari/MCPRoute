import type { ProviderDto } from '@mcproute/shared';
import { Ellipsis, Eye, Pencil, Plus, Server, Trash } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { EmptyState, QueryError, TableSkeleton } from '@/components/states';
import { EnabledBadge, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, pluralize } from '@/lib/format';
import { ROTATION_LABELS, TRANSPORT_SHORT_LABELS } from '@/lib/labels';
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { useDeleteProvider, useProviders } from '@/queries/providers';

function KeySummary({ provider }: { provider: ProviderDto }) {
  const { total, active, cooldown, disabled } = provider.keyStats;
  if (total === 0) return <span className="text-muted-foreground">No keys</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium tabular-nums">{formatNumber(total)}</span>
      {active > 0 && <StatusBadge tone="success">{active} active</StatusBadge>}
      {cooldown > 0 && <StatusBadge tone="warning">{cooldown} cooldown</StatusBadge>}
      {disabled > 0 && <StatusBadge tone="neutral">{disabled} disabled</StatusBadge>}
    </div>
  );
}

export function ProvidersPage() {
  const navigate = useNavigate();
  const providers = useProviders();
  const deleteProvider = useDeleteProvider();
  const deleteDialog = useDialogTarget<ProviderDto>();
  const deleting = deleteDialog.target;

  const newButton = (
    <Button asChild>
      <Link to="/providers/new">
        <Plus data-icon="inline-start" />
        New provider
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Providers"
        description="Upstream MCP servers. Each provider holds a pool of API keys that rotate per session."
        actions={providers.data && providers.data.length > 0 ? newButton : undefined}
      />
      {providers.isPending ? (
        <TableSkeleton columns={6} />
      ) : providers.isError ? (
        <QueryError title="Could not load providers" error={providers.error} onRetry={() => void providers.refetch()} />
      ) : providers.data.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No providers yet"
          description="Add an upstream MCP server such as Exa, Tavily or Brave Search, then add its API keys."
          action={newButton}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Transport</TableHead>
                <TableHead>API keys</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Rotation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="pl-4">
                    <Link to={`/providers/${provider.id}`} className="font-medium hover:underline">
                      {provider.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{provider.slug}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{TRANSPORT_SHORT_LABELS[provider.transport]}</Badge>
                  </TableCell>
                  <TableCell>
                    <KeySummary provider={provider} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {provider.cachedTools ? formatNumber(provider.cachedTools.length) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {ROTATION_LABELS[provider.rotationStrategy]}
                    {provider.failoverEnabled && <span className="text-muted-foreground"> · failover</span>}
                  </TableCell>
                  <TableCell>
                    <EnabledBadge enabled={provider.enabled} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${provider.name}`}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => navigate(`/providers/${provider.id}`)}>
                          <Eye />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => navigate(`/providers/${provider.id}/edit`)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => deleteDialog.show(provider)}>
                          <Trash />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title={`Delete ${deleting?.name ?? 'provider'}?`}
        description={`This permanently deletes the provider, its ${pluralize(deleting?.keyStats.total ?? 0, 'API key')} and its links to endpoints.`}
        confirmLabel="Delete provider"
        onConfirm={async () => {
          if (!deleting) return;
          await deleteProvider.mutateAsync(deleting.id);
          toast.success(`Provider "${deleting.name}" deleted`);
        }}
      />
    </>
  );
}
