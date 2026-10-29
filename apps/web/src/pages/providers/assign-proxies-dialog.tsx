import { useState } from 'react';
import { PROXY_ASSIGN_MODES, type ProviderDto, type ProxyAssignMode } from '@mcproute/shared';
import { Globe } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { pluralize } from '@/lib/format';
import { ASSIGN_MODE_LABELS, PROXY_STATUS_DOT, proxyDisplayName } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useAssignProxies } from '@/queries/keys';
import { useProxies } from '@/queries/proxies';

function AssignProxiesForm({ provider, onDone }: { provider: ProviderDto; onDone: () => void }) {
  const proxies = useProxies();
  const assign = useAssignProxies(provider.id);
  const [mode, setMode] = useState<ProxyAssignMode>('round_robin');
  const [scope, setScope] = useState<'all' | 'pick'>('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);

  const enabledProxies = (proxies.data ?? []).filter((proxy) => proxy.enabled);
  const poolSize = scope === 'all' ? enabledProxies.length : picked.size;

  function togglePicked(id: string, value: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit() {
    try {
      const result = await assign.mutateAsync({
        mode,
        onlyUnassigned,
        proxyIds: scope === 'pick' ? [...picked] : undefined,
      });
      const title = `Assigned proxies to ${pluralize(result.assigned, 'key')}`;
      if (result.unassigned > 0) {
        toast.warning(title, { description: `${pluralize(result.unassigned, 'key')} left without a proxy (not enough proxies).` });
      } else toast.success(title);
      onDone();
    } catch {
      // Reported by the mutation cache.
    }
  }

  if (proxies.isPending) return <Skeleton className="h-48" />;

  if (enabledProxies.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
        <Globe className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">There are no enabled proxies to assign. Import some proxies first.</p>
        <Button asChild variant="outline">
          <Link to="/proxies">Go to proxies</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FieldSet>
        <FieldLegend variant="label">Distribution</FieldLegend>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value as ProxyAssignMode)}>
          {PROXY_ASSIGN_MODES.map((value) => (
            <FieldLabel key={value} htmlFor={`assign-${value}`}>
              <Field orientation="horizontal">
                <RadioGroupItem value={value} id={`assign-${value}`} />
                <FieldContent>
                  <span className="font-medium">{ASSIGN_MODE_LABELS[value].label}</span>
                  <FieldDescription>{ASSIGN_MODE_LABELS[value].description}</FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Proxies</FieldLegend>
        <RadioGroup value={scope} onValueChange={(value) => setScope(value as 'all' | 'pick')} className="flex flex-wrap gap-4">
          <Field orientation="horizontal" className="w-auto">
            <RadioGroupItem value="all" id="scope-all" />
            <FieldLabel htmlFor="scope-all" className="font-normal">
              All enabled ({enabledProxies.length})
            </FieldLabel>
          </Field>
          <Field orientation="horizontal" className="w-auto">
            <RadioGroupItem value="pick" id="scope-pick" />
            <FieldLabel htmlFor="scope-pick" className="font-normal">
              Choose proxies
            </FieldLabel>
          </Field>
        </RadioGroup>
        {scope === 'pick' && (
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <span className="text-muted-foreground">{picked.size} selected</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => setPicked(new Set(enabledProxies.map((proxy) => proxy.id)))}>
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => setPicked(new Set())}>
                  None
                </Button>
              </div>
            </div>
            <div className="max-h-52 space-y-1 overflow-auto p-2">
              {enabledProxies.map((proxy) => (
                <label key={proxy.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={picked.has(proxy.id)} onCheckedChange={(value) => togglePicked(proxy.id, value === true)} />
                  <span className={cn('size-1.5 shrink-0 rounded-full', PROXY_STATUS_DOT[proxy.status])} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{proxyDisplayName(proxy)}</span>
                  <span className="text-xs text-muted-foreground">{pluralize(proxy.keyCount, 'key')}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </FieldSet>

      <Field orientation="horizontal">
        <Switch id="only-unassigned" checked={onlyUnassigned} onCheckedChange={setOnlyUnassigned} />
        <FieldContent>
          <FieldLabel htmlFor="only-unassigned">Only keys without a proxy</FieldLabel>
          <FieldDescription>Keys that already have a proxy keep it. Turn off to reassign every key.</FieldDescription>
        </FieldContent>
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={poolSize === 0 || assign.isPending}>
          {assign.isPending && <Spinner data-icon="inline-start" />}
          Assign proxies
        </Button>
      </DialogFooter>
    </div>
  );
}

interface AssignProxiesDialogProps {
  provider: ProviderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignProxiesDialog({ provider, open, onOpenChange }: AssignProxiesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign proxies</DialogTitle>
          <DialogDescription>Distribute outbound proxies across the API keys of {provider.name}.</DialogDescription>
        </DialogHeader>
        <AssignProxiesForm provider={provider} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
