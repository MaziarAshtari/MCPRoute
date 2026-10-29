import type { EndpointDto } from '@mcproute/shared';
import { Ellipsis, Eye, KeyRound, Pencil, Plus, Trash, Waypoints } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy';
import { PageHeader } from '@/components/page-header';
import { EmptyState, QueryError, TableSkeleton } from '@/components/states';
import { EnabledBadge } from '@/components/status';
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
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { useDeleteEndpoint, useEndpoints, useRegenerateToken } from '@/queries/endpoints';
import { endpointUrl } from './connect-panel';
import { TokenDialog, type IssuedToken } from './token-dialog';

const MAX_PROVIDER_BADGES = 3;

export function EndpointsPage() {
  const navigate = useNavigate();
  const endpoints = useEndpoints();
  const deleteEndpoint = useDeleteEndpoint();
  const regenerateToken = useRegenerateToken();
  const deleteDialog = useDialogTarget<EndpointDto>();
  const regenerateDialog = useDialogTarget<EndpointDto>();
  const tokenDialog = useDialogTarget<IssuedToken>();

  const newButton = (
    <Button asChild>
      <Link to="/endpoints/new">
        <Plus data-icon="inline-start" />
        New endpoint
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Endpoints"
        description="MCP servers exposed by MCPRoute. Each endpoint aggregates one or more providers behind its own access token."
        actions={endpoints.data && endpoints.data.length > 0 ? newButton : undefined}
      />
      {endpoints.isPending ? (
        <TableSkeleton columns={6} />
      ) : endpoints.isError ? (
        <QueryError title="Could not load endpoints" error={endpoints.error} onRetry={() => void endpoints.refetch()} />
      ) : endpoints.data.length === 0 ? (
        <EmptyState
          icon={Waypoints}
          title="No endpoints yet"
          description="Create an endpoint, link providers to it and connect your MCP client with its URL and token."
          action={newButton}
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Providers</TableHead>
                <TableHead>Options</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.data.map((endpoint) => (
                <TableRow key={endpoint.id}>
                  <TableCell className="max-w-56 pl-4">
                    <Link to={`/endpoints/${endpoint.id}`} className="font-medium hover:underline">
                      {endpoint.name}
                    </Link>
                    {endpoint.description && <div className="truncate text-xs text-muted-foreground">{endpoint.description}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <code className="font-mono text-xs">{endpoint.mcpPath}</code>
                      <CopyButton value={endpointUrl(endpoint)} label="Endpoint URL" />
                    </div>
                  </TableCell>
                  <TableCell>
                    {endpoint.providers.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {endpoint.providers.slice(0, MAX_PROVIDER_BADGES).map((link) => (
                          <Badge key={link.providerId} variant="secondary">
                            {link.providerName}
                          </Badge>
                        ))}
                        {endpoint.providers.length > MAX_PROVIDER_BADGES && (
                          <Badge variant="outline">+{endpoint.providers.length - MAX_PROVIDER_BADGES}</Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {endpoint.toolPrefixMode === 'provider_slug' && <Badge variant="outline">Prefixed tools</Badge>}
                      {endpoint.enableSse && <Badge variant="outline">SSE</Badge>}
                      {endpoint.toolPrefixMode === 'none' && !endpoint.enableSse && <span className="text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{endpoint.accessTokenHint}</code>
                  </TableCell>
                  <TableCell>
                    <EnabledBadge enabled={endpoint.enabled} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${endpoint.name}`}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => navigate(`/endpoints/${endpoint.id}`)}>
                          <Eye />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => navigate(`/endpoints/${endpoint.id}/edit`)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => regenerateDialog.show(endpoint)}>
                          <KeyRound />
                          Regenerate token
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => deleteDialog.show(endpoint)}>
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
        open={regenerateDialog.open}
        onOpenChange={regenerateDialog.onOpenChange}
        title={`Regenerate the token of ${regenerateDialog.target?.name ?? 'this endpoint'}?`}
        description="The current token stops working immediately. Every MCP client using it must be updated."
        confirmLabel="Regenerate token"
        onConfirm={async () => {
          const target = regenerateDialog.target;
          if (!target) return;
          const result = await regenerateToken.mutateAsync(target.id);
          toast.success(`New token issued for "${result.name}"`);
          tokenDialog.show({ endpoint: result, token: result.accessToken });
        }}
      />
      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title={`Delete ${deleteDialog.target?.name ?? 'endpoint'}?`}
        description="MCP clients lose access immediately and its sessions are ended. Providers and keys are not affected."
        confirmLabel="Delete endpoint"
        onConfirm={async () => {
          const target = deleteDialog.target;
          if (!target) return;
          await deleteEndpoint.mutateAsync(target.id);
          toast.success(`Endpoint "${target.name}" deleted`);
        }}
      />
      <TokenDialog issued={tokenDialog.target} open={tokenDialog.open} onOpenChange={tokenDialog.onOpenChange} />
    </>
  );
}
