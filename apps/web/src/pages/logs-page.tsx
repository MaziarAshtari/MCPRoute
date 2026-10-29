import { Fragment, useState } from 'react';
import type { LogStatus, RequestLogDto } from '@mcproute/shared';
import { ChevronRight, FilterX, RefreshCw, ScrollText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { CopyButton, RelativeTime } from '@/components/copy';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, QueryError, TableSkeleton } from '@/components/states';
import { LogStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatLatency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useProviderKeys } from '@/queries/keys';
import { useEndpoints } from '@/queries/endpoints';
import { useLogs } from '@/queries/observability';
import { useProviders } from '@/queries/providers';
import type { LogFilters } from '@/queries/query-keys';

const PAGE_SIZE = 50;
const ANY = 'any';
const FILTER_PARAMS = ['endpointId', 'providerId', 'apiKeyId', 'status', 'from', 'to'] as const;
type FilterParam = (typeof FILTER_PARAMS)[number];

/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  anyLabel,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  anyLabel: string;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </FieldLabel>
      <Select value={value ?? ANY} onValueChange={(next) => onChange(next === ANY ? undefined : next)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function LogDetails({ log }: { log: RequestLogDto }) {
  return (
    <div className="space-y-3 py-1">
      {log.errorMessage && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            Error message
            <CopyButton value={log.errorMessage} label="Error message" />
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
            {log.errorMessage}
          </pre>
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Time</dt>
          <dd>{formatDateTime(log.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Method</dt>
          <dd className="font-mono">{log.method}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Session</dt>
          <dd className="font-mono break-all">{log.sessionId ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Log ID</dt>
          <dd className="font-mono">{log.id}</dd>
        </div>
      </dl>
    </div>
  );
}

export function LogsPage() {
  const [params, setParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const status = params.get('status');
  const filters: LogFilters = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    endpointId: params.get('endpointId') || undefined,
    providerId: params.get('providerId') || undefined,
    apiKeyId: params.get('apiKeyId') || undefined,
    status: status === 'ok' || status === 'error' ? (status satisfies LogStatus) : undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
  };
  const hasFilters = FILTER_PARAMS.some((name) => params.get(name));

  const logs = useLogs(filters, autoRefresh);
  const endpoints = useEndpoints();
  const providers = useProviders();
  const keys = useProviderKeys(filters.providerId ?? '', { enabled: !!filters.providerId });

  function setFilter(name: FilterParam, value: string | undefined) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === 'providerId') next.delete('apiKeyId');
    next.delete('page');
    setParams(next, { replace: true });
  }

  function setPage(page: number) {
    const next = new URLSearchParams(params);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="Logs"
        description="Every tool call, prompt and resource read forwarded upstream, including failover attempts."
        actions={
          <>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <Switch id="auto-refresh" size="sm" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Label htmlFor="auto-refresh" className="text-sm font-normal">
                Auto-refresh (5s)
              </Label>
              {autoRefresh && <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />}
            </div>
            <Button variant="outline" onClick={() => void logs.refetch()} disabled={logs.isFetching}>
              {logs.isFetching ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              Refresh
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FilterSelect
          label="Endpoint"
          anyLabel="All endpoints"
          value={filters.endpointId}
          onChange={(value) => setFilter('endpointId', value)}
          options={(endpoints.data ?? []).map((endpoint) => ({ value: endpoint.id, label: endpoint.name }))}
        />
        <FilterSelect
          label="Provider"
          anyLabel="All providers"
          value={filters.providerId}
          onChange={(value) => setFilter('providerId', value)}
          options={(providers.data ?? []).map((provider) => ({ value: provider.id, label: provider.name }))}
        />
        <FilterSelect
          label="API key"
          anyLabel={filters.providerId ? 'All keys' : 'Select a provider'}
          value={filters.apiKeyId}
          onChange={(value) => setFilter('apiKeyId', value)}
          disabled={!filters.providerId}
          options={(keys.data ?? []).map((key) => ({ value: key.id, label: `${key.label} (${key.maskedKey})` }))}
        />
        <FilterSelect
          label="Status"
          anyLabel="Any status"
          value={filters.status}
          onChange={(value) => setFilter('status', value)}
          options={[
            { value: 'ok', label: 'OK' },
            { value: 'error', label: 'Error' },
          ]}
        />
        <Field className="gap-1.5">
          <FieldLabel htmlFor="filter-from" className="text-xs text-muted-foreground">
            From
          </FieldLabel>
          <Input
            id="filter-from"
            type="datetime-local"
            value={toLocalInput(filters.from)}
            onChange={(event) => setFilter('from', fromLocalInput(event.target.value))}
          />
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="filter-to" className="text-xs text-muted-foreground">
            To
          </FieldLabel>
          <Input
            id="filter-to"
            type="datetime-local"
            value={toLocalInput(filters.to)}
            onChange={(event) => setFilter('to', fromLocalInput(event.target.value))}
          />
        </Field>
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6">
            <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              <FilterX data-icon="inline-start" />
              Reset filters
            </Button>
          </div>
        )}
      </div>

      {logs.isPending ? (
        <TableSkeleton rows={8} columns={6} />
      ) : logs.isError ? (
        <QueryError title="Could not load logs" error={logs.error} onRetry={() => void logs.refetch()} />
      ) : logs.data.total === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={FilterX}
            title="No requests match these filters"
            description="Try a wider date range or fewer filters."
            action={
              <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ScrollText}
            title="No requests logged yet"
            description="Requests appear here once MCP clients call tools through an endpoint."
            action={
              <Button asChild variant="outline">
                <Link to="/endpoints">View endpoints</Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-3">
          <div className={cn('rounded-xl border bg-card transition-opacity', logs.isPlaceholderData && 'opacity-60')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <span className="sr-only">Expand</span>
                  </TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Provider · key</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.items.map((log) => {
                  const open = expanded.has(log.id);
                  return (
                    <Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer"
                        aria-expanded={open}
                        onClick={() => toggle(log.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggle(log.id);
                          }
                        }}
                        tabIndex={0}
                      >
                        <TableCell className="pl-4">
                          <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
                        </TableCell>
                        <TableCell>
                          <RelativeTime value={log.createdAt} />
                        </TableCell>
                        <TableCell className="max-w-40 truncate">{log.endpointName ?? <span className="text-muted-foreground">Deleted</span>}</TableCell>
                        <TableCell className="max-w-56">
                          <div className="truncate">{log.providerName ?? <span className="text-muted-foreground">—</span>}</div>
                          {log.apiKeyLabel && <div className="truncate text-xs text-muted-foreground">{log.apiKeyLabel}</div>}
                        </TableCell>
                        <TableCell className="max-w-72">
                          <code className="font-mono text-xs">{log.toolName ?? log.method}</code>
                          {log.errorMessage && !open && (
                            <div className="truncate text-xs text-destructive" title={log.errorMessage}>
                              {log.errorMessage}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <LogStatusBadge status={log.status} />
                        </TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{formatLatency(log.latencyMs)}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={6} className="pr-4 whitespace-normal">
                            <LogDetails log={log} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar page={filters.page} pageSize={PAGE_SIZE} total={logs.data.total} onPageChange={setPage} />
        </div>
      )}
    </>
  );
}
