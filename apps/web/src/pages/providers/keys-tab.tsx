import { useMemo, useState } from 'react';
import type { ApiKeyDto, KeyTestResultDto, ProviderDto } from '@mcproute/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Ellipsis,
  FlaskConical,
  KeyRound,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Search,
  Shuffle,
  Trash,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RelativeTime } from '@/components/copy';
import { EmptyState, QueryError, TableSkeleton } from '@/components/states';
import { KeyStatusBadge, keyState } from '@/components/status';
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
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { useSelection } from '@/hooks/use-selection';
import { api, errorMessage } from '@/lib/api';
import { runConcurrently } from '@/lib/concurrency';
import { formatLatency, formatNumber, pluralize } from '@/lib/format';
import { PROXY_STATUS_DOT, proxyDisplayName } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { invalidateKeyData, testKey, useDeleteKey, useProviderKeys, useUpdateKey } from '@/queries/keys';
import { AddKeysDialog } from './add-keys-dialog';
import { AssignProxiesDialog } from './assign-proxies-dialog';
import { EditKeyDialog } from './edit-key-dialog';

type TestState = { status: 'running' } | { status: 'done'; result: KeyTestResultDto };

function testSummary(result: KeyTestResultDto): string {
  return `${formatLatency(result.latencyMs)} · ${pluralize(result.toolCount ?? 0, 'tool')}`;
}

/** Enabling a key also clears a "disabled" status set through the API. */
function enablePatch(key: ApiKeyDto, enabled: boolean) {
  return enabled && key.status === 'disabled' ? { enabled, status: 'active' as const } : { enabled };
}

function TestIndicator({ state }: { state: TestState | undefined }) {
  if (!state) return null;
  if (state.status === 'running') return <Spinner className="size-3.5 text-muted-foreground" aria-label="Testing" />;
  const { result } = state;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" aria-label={result.ok ? 'Test passed' : 'Test failed'}>
          {result.ok ? <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" /> : <CircleX className="size-4 text-destructive" />}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">
        {result.ok ? `Test passed · ${testSummary(result)}` : `Test failed: ${result.error ?? 'unknown error'}`}
      </TooltipContent>
    </Tooltip>
  );
}

function matches(key: ApiKeyDto, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [key.label, key.maskedKey, key.proxy ? proxyDisplayName(key.proxy) : 'direct'].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function KeysTab({ provider }: { provider: ProviderDto }) {
  const queryClient = useQueryClient();
  const keys = useProviderKeys(provider.id);
  const updateKey = useUpdateKey();
  const deleteKey = useDeleteKey();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const editDialog = useDialogTarget<ApiKeyDto>();
  const deleteDialog = useDialogTarget<ApiKeyDto>();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const visible = useMemo(() => (keys.data ?? []).filter((key) => matches(key, search)), [keys.data, search]);
  const visibleIds = useMemo(() => visible.map((key) => key.id), [visible]);
  const selection = useSelection(visibleIds);
  const selectedKeys = visible.filter((key) => selection.isSelected(key.id));

  async function runTest(key: ApiKeyDto, notify: boolean): Promise<KeyTestResultDto> {
    setTests((current) => ({ ...current, [key.id]: { status: 'running' } }));
    let result: KeyTestResultDto;
    try {
      result = await testKey(key.id);
    } catch (error) {
      result = { ok: false, latencyMs: 0, toolCount: null, error: errorMessage(error) };
    }
    setTests((current) => ({ ...current, [key.id]: { status: 'done', result } }));
    if (notify) {
      if (result.ok) toast.success(`Key "${key.label}" works`, { description: testSummary(result) });
      else toast.error(`Key "${key.label}" failed the test`, { description: result.error ?? undefined });
    }
    return result;
  }

  function setEnabled(key: ApiKeyDto, enabled: boolean) {
    updateKey.mutate(
      { id: key.id, input: enablePatch(key, enabled) },
      { onSuccess: () => toast.success(`Key "${key.label}" ${enabled ? 'enabled' : 'disabled'}`) },
    );
  }

  function resetCooldown(key: ApiKeyDto) {
    updateKey.mutate(
      { id: key.id, input: { status: 'active' } },
      { onSuccess: () => toast.success(`Cooldown cleared for "${key.label}"`) },
    );
  }

  async function runBulk(verb: string, task: (key: ApiKeyDto) => Promise<unknown>) {
    const targets = selectedKeys;
    setBulkRunning(true);
    try {
      const results = await runConcurrently(targets, 6, task);
      await invalidateKeyData(queryClient);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      const succeeded = results.length - failures.length;
      if (failures.length === 0) toast.success(`${verb} ${pluralize(succeeded, 'key')}`);
      else {
        toast.error(`${verb} ${pluralize(succeeded, 'key')}, ${failures.length} failed`, {
          description: errorMessage(failures[0]?.reason),
        });
      }
      if (failures.length === 0) selection.clear();
    } finally {
      setBulkRunning(false);
    }
  }

  async function bulkTest() {
    const targets = selectedKeys;
    setBulkRunning(true);
    const toastId = toast.loading(`Testing ${pluralize(targets.length, 'key')}…`);
    try {
      const results = await runConcurrently(
        targets,
        4,
        (key) => runTest(key, false),
        (done, total) => toast.loading(`Testing keys… ${done}/${total}`, { id: toastId }),
      );
      const passed = results.filter((result) => result.status === 'fulfilled' && result.value.ok).length;
      const failed = targets.length - passed;
      if (failed === 0) toast.success(`All ${pluralize(passed, 'key')} passed the test`, { id: toastId });
      else toast.error(`${passed} passed, ${failed} failed`, { id: toastId, description: 'Hover the result icons for details.' });
    } finally {
      setBulkRunning(false);
    }
  }

  if (keys.isPending) return <TableSkeleton columns={8} />;
  if (keys.isError) return <QueryError title="Could not load API keys" error={keys.error} onRetry={() => void keys.refetch()} />;

  const total = keys.data.length;

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <InputGroup className="sm:max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Filter by label, key or proxy"
            aria-label="Filter keys"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={total === 0}
          />
        </InputGroup>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)} disabled={total === 0}>
            <Shuffle data-icon="inline-start" />
            Assign proxies
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus data-icon="inline-start" />
            Add keys
          </Button>
        </div>
      </div>

      {selection.count > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">{formatNumber(selection.count)} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={bulkRunning} onClick={() => void runBulk('Enabled', (key) => api(`/keys/${key.id}`, { method: 'PATCH', body: enablePatch(key, true) }))}>
              <Power data-icon="inline-start" />
              Enable
            </Button>
            <Button size="sm" variant="outline" disabled={bulkRunning} onClick={() => void runBulk('Disabled', (key) => api(`/keys/${key.id}`, { method: 'PATCH', body: { enabled: false } }))}>
              <PowerOff data-icon="inline-start" />
              Disable
            </Button>
            <Button size="sm" variant="outline" disabled={bulkRunning} onClick={() => void bulkTest()}>
              <FlaskConical data-icon="inline-start" />
              Test
            </Button>
            <Button size="sm" variant="destructive" disabled={bulkRunning} onClick={() => setBulkDeleteOpen(true)}>
              <Trash data-icon="inline-start" />
              Delete
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkRunning} onClick={selection.clear}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description="Add keys one at a time or paste many at once. Each key can use its own outbound proxy."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus data-icon="inline-start" />
              Add keys
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select all keys"
                    checked={selection.headerState}
                    onCheckedChange={(value) => selection.setAll(value === true)}
                    disabled={visible.length === 0}
                  />
                </TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Proxy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Usage</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    No keys match “{search}”.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((key) => {
                const state = keyState(key);
                return (
                  <TableRow key={key.id} data-state={selection.isSelected(key.id) ? 'selected' : undefined}>
                    <TableCell className="pl-4">
                      <Checkbox
                        aria-label={`Select ${key.label}`}
                        checked={selection.isSelected(key.id)}
                        onCheckedChange={(value) => selection.toggle(key.id, value === true)}
                      />
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-medium" title={key.label}>
                      {key.label}
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{key.maskedKey}</code>
                    </TableCell>
                    <TableCell>
                      {key.proxy ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex max-w-48 items-center gap-1.5">
                              <span className={cn('size-1.5 shrink-0 rounded-full', PROXY_STATUS_DOT[key.proxy.status])} aria-hidden="true" />
                              <span className={cn('truncate', !key.proxy.enabled && 'text-muted-foreground line-through')}>
                                {proxyDisplayName(key.proxy)}
                              </span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {key.proxy.url}
                            {!key.proxy.enabled && ' (disabled)'}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">Direct</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <KeyStatusBadge apiKey={key} />
                        <TestIndicator state={tests[key.id]} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{key.weight}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(key.usageCount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {key.lastError && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex" aria-label="Last error">
                                <CircleAlert className="size-3.5 text-destructive" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm break-words">Last error: {key.lastError}</TooltipContent>
                          </Tooltip>
                        )}
                        {formatNumber(key.errorCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(key.activeSessions)}</TableCell>
                    <TableCell>
                      <RelativeTime value={key.lastUsedAt} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${key.label}`}>
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {state === 'disabled' ? (
                            <DropdownMenuItem onSelect={() => setEnabled(key, true)}>
                              <Power />
                              Enable
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => setEnabled(key, false)}>
                              <PowerOff />
                              Disable
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => editDialog.show(key)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void runTest(key, true)} disabled={tests[key.id]?.status === 'running'}>
                            <FlaskConical />
                            Test
                          </DropdownMenuItem>
                          {state === 'cooldown' && (
                            <DropdownMenuItem onSelect={() => resetCooldown(key)}>
                              <RotateCcw />
                              Reset cooldown
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => deleteDialog.show(key)}>
                            <Trash />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddKeysDialog provider={provider} open={addOpen} onOpenChange={setAddOpen} />
      <AssignProxiesDialog provider={provider} open={assignOpen} onOpenChange={setAssignOpen} />
      <EditKeyDialog apiKey={editDialog.target} open={editDialog.open} onOpenChange={editDialog.onOpenChange} />
      <ConfirmDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title={`Delete key "${deleteDialog.target?.label ?? ''}"?`}
        description="Sessions bound to this key are rebound to another key on their next call."
        confirmLabel="Delete key"
        onConfirm={async () => {
          const target = deleteDialog.target;
          if (!target) return;
          await deleteKey.mutateAsync(target.id);
          toast.success(`Key "${target.label}" deleted`);
        }}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${pluralize(selection.count, 'key')}?`}
        description="This cannot be undone. Sessions bound to these keys are rebound on their next call."
        confirmLabel="Delete keys"
        onConfirm={() => runBulk('Deleted', (key) => api(`/keys/${key.id}`, { method: 'DELETE' }))}
      />
    </>
  );
}
