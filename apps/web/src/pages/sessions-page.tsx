import type { SessionDto } from '@mcproute/shared';
import { Activity, CircleStop, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton, RelativeTime } from '@/components/copy';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, QueryError, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { shortId } from '@/lib/format';
import { useEndpoints } from '@/queries/endpoints';
import { useDeleteSession, useSessions } from '@/queries/observability';

const PAGE_SIZE = 25;
const ALL = 'all';

export function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const endpointId = params.get('endpointId') ?? undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const endpoints = useEndpoints();
  const sessions = useSessions({ page, pageSize: PAGE_SIZE, endpointId });
  const deleteSession = useDeleteSession();
  const terminateDialog = useDialogTarget<SessionDto>();

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Active MCP sessions and the API key bound to each provider. Sessions end after a period of inactivity."
        actions={
          <>
            <Select value={endpointId ?? ALL} onValueChange={(value) => update({ endpointId: value === ALL ? undefined : value, page: undefined })}>
              <SelectTrigger className="w-48" aria-label="Filter by endpoint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={ALL}>All endpoints</SelectItem>
                {(endpoints.data ?? []).map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void sessions.refetch()} disabled={sessions.isFetching}>
              {sessions.isFetching ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              Refresh
            </Button>
          </>
        }
      />

      {sessions.isPending ? (
        <TableSkeleton columns={6} />
      ) : sessions.isError ? (
        <QueryError title="Could not load sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data.total === 0 ? (
        <EmptyState
          icon={Activity}
          title={endpointId ? 'No active sessions for this endpoint' : 'No active sessions'}
          description="A session starts when an MCP client connects to an endpoint, and binds one API key per provider."
          action={
            <Button asChild variant="outline">
              <Link to="/endpoints">View endpoints</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Session</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Bound keys</TableHead>
                  <TableHead className="w-28 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.data.items.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-xs" title={session.id}>
                          {shortId(session.id)}
                        </code>
                        <CopyButton value={session.id} label="Session ID" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link to={`/endpoints/${session.endpointId}`} className="font-medium hover:underline">
                        {session.endpointName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={session.createdAt} />
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={session.lastSeenAt} />
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={session.expiresAt} />
                    </TableCell>
                    <TableCell>
                      {session.bindings.length === 0 ? (
                        <span className="text-muted-foreground">None yet</span>
                      ) : (
                        <ul className="space-y-1">
                          {session.bindings.map((binding) => (
                            <li key={binding.providerId} className="flex flex-wrap items-center gap-x-1.5 text-xs">
                              <Link to={`/providers/${binding.providerId}`} className="font-medium hover:underline">
                                {binding.providerName}
                              </Link>
                              <span className="text-muted-foreground">→</span>
                              <span>{binding.apiKeyLabel}</span>
                              {binding.apiKeyLabel !== binding.maskedKey && (
                                <code className="font-mono text-muted-foreground">{binding.maskedKey}</code>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="outline" size="sm" onClick={() => terminateDialog.show(session)}>
                        <CircleStop data-icon="inline-start" />
                        Terminate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={sessions.data.total}
            onPageChange={(next) => update({ page: next > 1 ? String(next) : undefined })}
          />
        </div>
      )}

      <ConfirmDialog
        open={terminateDialog.open}
        onOpenChange={terminateDialog.onOpenChange}
        title="Terminate this session?"
        description="Its key bindings are released and its connections closed. The MCP client has to start a new session."
        confirmLabel="Terminate session"
        onConfirm={async () => {
          const target = terminateDialog.target;
          if (!target) return;
          await deleteSession.mutateAsync(target.id);
          toast.success('Session terminated');
        }}
      />
    </>
  );
}
