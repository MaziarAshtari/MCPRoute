import { useMemo, useState } from 'react';
import type { ProxyCheckResultDto, ProxyDto } from '@mcproute/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ellipsis, Globe, Pencil, Power, PowerOff, Radar, Search, Trash, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/copy';
import { PageHeader } from '@/components/page-header';
import { EmptyState, QueryError, TableSkeleton } from '@/components/states';
import { ProxyStatusBadge, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { useSelection } from '@/hooks/use-selection';
import { api, errorMessage } from '@/lib/api';
import { runConcurrently } from '@/lib/concurrency';
import { formatLatency, formatNumber, pluralize } from '@/lib/format';
import { proxyDisplayName } from '@/lib/labels';
import { checkProxy, invalidateProxyData, useProxies, useUpdateProxy } from '@/queries/proxies';
import { queryKeys } from '@/queries/query-keys';
import { EditProxyDialog } from './edit-proxy-dialog';
import { ImportProxiesDialog } from './import-proxies-dialog';

/** Same limit as the server's check-all route. */
const CHECK_CONCURRENCY = 10;

function matches(proxy: ProxyDto, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [proxy.label ?? '', proxy.url, proxy.lastExitIp ?? ''].some((value) => value.toLowerCase().includes(needle));
}

export function ProxiesPage() {
  const queryClient = useQueryClient();
  const proxies = useProxies();
  const updateProxy = useUpdateProxy();
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const editDialog = useDialogTarget<ProxyDto>();
  const deleteDialog = useDialogTarget<ProxyDto>();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [checking, setChecking] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const all = proxies.data ?? [];
  const visible = useMemo(() => (proxies.data ?? []).filter((proxy) => matches(proxy, search)), [proxies.data, search]);
  const visibleIds = useMemo(() => visible.map((proxy) => proxy.id), [visible]);
  const selection = useSelection(visibleIds);

  function markChecking(ids: string[], value: boolean) {
    setChecking((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /** Shows a check result in the table right away, before the list is refetched. */
  function applyResult(result: ProxyCheckResultDto) {
    queryClient.setQueryData<ProxyDto[]>(queryKeys.proxies, (list) =>
      list?.map((proxy) =>
        proxy.id === result.proxyId
          ? {
              ...proxy,
              status: result.status,
              lastCheckedAt: result.checkedAt,
              lastLatencyMs: result.latencyMs,
              lastExitIp: result.exitIp,
              lastError: result.error,
            }
          : proxy,
      ),
    );
  }

  async function checkOne(proxy: ProxyDto) {
    const name = proxyDisplayName(proxy);
    markChecking([proxy.id], true);
    try {
      const result = await checkProxy(proxy.id);
      applyResult(result);
      if (result.ok) {
        toast.success(`${name} is healthy`, {
          description: `${formatLatency(result.latencyMs)} · exit IP ${result.exitIp ?? 'unknown'}`,
        });
      } else toast.error(`${name} failed the check`, { description: result.error ?? undefined });
    } catch (error) {
      toast.error(`Could not check ${name}`, { description: errorMessage(error) });
    } finally {
      markChecking([proxy.id], false);
      void invalidateProxyData(queryClient);
    }
  }

  // Checks run one request per proxy (instead of POST /proxies/check-all) to show progress and avoid
  // a single request that lasts as long as the slowest proxies.
  async function checkAll() {
    const targets = all;
    setProgress({ done: 0, total: targets.length });
    markChecking(
      targets.map((proxy) => proxy.id),
      true,
    );
    try {
      const results = await runConcurrently(
        targets,
        CHECK_CONCURRENCY,
        async (proxy) => {
          try {
            const result = await checkProxy(proxy.id);
            applyResult(result);
            return result;
          } finally {
            markChecking([proxy.id], false);
          }
        },
        (done, total) => setProgress({ done, total }),
      );
      const healthy = results.filter((result) => result.status === 'fulfilled' && result.value.ok).length;
      const failed = results.length - healthy;
      const title = `Checked ${pluralize(results.length, 'proxy', 'proxies')}`;
      const description = `${formatNumber(healthy)} healthy · ${formatNumber(failed)} failed`;
      if (failed === 0) toast.success(title, { description });
      else toast.warning(title, { description });
    } finally {
      setProgress(null);
      await invalidateProxyData(queryClient);
    }
  }

  function setEnabled(proxy: ProxyDto, enabled: boolean) {
    updateProxy.mutate(
      { id: proxy.id, input: { enabled } },
      { onSuccess: () => toast.success(`${proxyDisplayName(proxy)} ${enabled ? 'enabled' : 'disabled'}`) },
    );
  }

  async function deleteProxies(targets: ProxyDto[]) {
    const results = await runConcurrently(targets, 6, (proxy) => api(`/proxies/${proxy.id}`, { method: 'DELETE' }));
    await invalidateProxyData(queryClient);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    const deleted = results.length - failures.length;
    if (failures.length === 0) {
      toast.success(targets.length === 1 && targets[0] ? `${proxyDisplayName(targets[0])} deleted` : `Deleted ${pluralize(deleted, 'proxy', 'proxies')}`);
      selection.clear();
    } else {
      toast.error(`Deleted ${pluralize(deleted, 'proxy', 'proxies')}, ${failures.length} failed`, {
        description: errorMessage(failures[0]?.reason),
      });
      throw failures[0]?.reason;
    }
  }

  const counts = {
    ok: all.filter((proxy) => proxy.status === 'ok').length,
    failed: all.filter((proxy) => proxy.status === 'failed').length,
  };
  const keysOnSelected = visible.filter((proxy) => selection.isSelected(proxy.id)).reduce((sum, proxy) => sum + proxy.keyCount, 0);

  return (
    <>
      <PageHeader
        title="Proxies"
        description="Outbound HTTP and SOCKS5 proxies that API keys connect through. Health checks fetch the public IP through each proxy."
        actions={
          all.length > 0 ? (
            <>
              <Button variant="outline" onClick={() => void checkAll()} disabled={progress !== null}>
                {progress ? <Spinner data-icon="inline-start" /> : <Radar data-icon="inline-start" />}
                {progress ? `Checking ${progress.done}/${progress.total}` : 'Check all'}
              </Button>
              <Button onClick={() => setImportOpen(true)}>
                <Upload data-icon="inline-start" />
                Import proxies
              </Button>
            </>
          ) : undefined
        }
      />

      {proxies.isPending ? (
        <TableSkeleton columns={7} />
      ) : proxies.isError ? (
        <QueryError title="Could not load proxies" error={proxies.error} onRetry={() => void proxies.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No proxies yet"
          description="Import a list of proxies, then assign them to API keys so each key leaves from its own IP address."
          action={
            <Button onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" />
              Import proxies
            </Button>
          }
        />
      ) : (
        <>
          {progress && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">
              <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} className="max-w-xs" />
              <span className="text-muted-foreground tabular-nums">
                Checked {progress.done} of {progress.total}
              </span>
            </div>
          )}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <InputGroup className="sm:max-w-xs">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Filter by label, host or exit IP"
                aria-label="Filter proxies"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{pluralize(all.length, 'proxy', 'proxies')}</span>
              <StatusBadge tone="success">{counts.ok} healthy</StatusBadge>
              <StatusBadge tone="danger">{counts.failed} failed</StatusBadge>
            </div>
          </div>

          {selection.count > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
              <span className="font-medium">{formatNumber(selection.count)} selected</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash data-icon="inline-start" />
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={selection.clear}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      aria-label="Select all proxies"
                      checked={selection.headerState}
                      onCheckedChange={(value) => selection.setAll(value === true)}
                      disabled={visible.length === 0}
                    />
                  </TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead>Exit IP</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead className="text-right">Keys</TableHead>
                  <TableHead className="w-20 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      No proxies match “{search}”.
                    </TableCell>
                  </TableRow>
                )}
                {visible.map((proxy) => {
                  const isChecking = checking.has(proxy.id);
                  return (
                    <TableRow key={proxy.id} data-state={selection.isSelected(proxy.id) ? 'selected' : undefined}>
                      <TableCell className="pl-4">
                        <Checkbox
                          aria-label={`Select ${proxyDisplayName(proxy)}`}
                          checked={selection.isSelected(proxy.id)}
                          onCheckedChange={(value) => selection.toggle(proxy.id, value === true)}
                        />
                      </TableCell>
                      <TableCell className="max-w-40 truncate font-medium">
                        {proxy.label ?? <span className="font-normal text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs break-all">{proxy.url}</code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {isChecking ? (
                            <StatusBadge tone="info">
                              <Spinner className="size-3" />
                              Checking
                            </StatusBadge>
                          ) : (
                            <ProxyStatusBadge status={proxy.status} error={proxy.lastError} />
                          )}
                          {!proxy.enabled && <StatusBadge tone="neutral">Disabled</StatusBadge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {proxy.status === 'ok' ? formatLatency(proxy.lastLatencyMs) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {proxy.lastExitIp ? (
                          <code className="font-mono text-xs">{proxy.lastExitIp}</code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RelativeTime value={proxy.lastCheckedAt} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(proxy.keyCount)}</TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Check ${proxyDisplayName(proxy)}`}
                                disabled={isChecking}
                                onClick={() => void checkOne(proxy)}
                              >
                                <Radar />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Check now</TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${proxyDisplayName(proxy)}`}>
                                <Ellipsis />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {proxy.enabled ? (
                                <DropdownMenuItem onSelect={() => setEnabled(proxy, false)}>
                                  <PowerOff />
                                  Disable
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => setEnabled(proxy, true)}>
                                  <Power />
                                  Enable
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => editDialog.show(proxy)}>
                                <Pencil />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => deleteDialog.show(proxy)}>
                                <Trash />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ImportProxiesDialog open={importOpen} onOpenChange={setImportOpen} />
      <EditProxyDialog proxy={editDialog.target} open={editDialog.open} onOpenChange={editDialog.onOpenChange} />
      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title="Delete this proxy?"
        description={
          deleteDialog.target && deleteDialog.target.keyCount > 0
            ? `${pluralize(deleteDialog.target.keyCount, 'API key')} use it and will connect directly afterwards.`
            : 'No API keys use this proxy.'
        }
        confirmLabel="Delete proxy"
        onConfirm={() => (deleteDialog.target ? deleteProxies([deleteDialog.target]) : undefined)}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${pluralize(selection.count, 'proxy', 'proxies')}?`}
        description={
          keysOnSelected > 0
            ? `${pluralize(keysOnSelected, 'API key')} use them and will connect directly afterwards.`
            : 'No API keys use these proxies.'
        }
        confirmLabel="Delete proxies"
        onConfirm={() => deleteProxies(visible.filter((proxy) => selection.isSelected(proxy.id)))}
      />
    </>
  );
}
