import { useState, type ComponentType, type ReactNode } from 'react';
import type { ProviderDto } from '@mcproute/shared';
import { KeyRound, Pencil, Power, PowerOff, RefreshCw, Shuffle, Trash, Wrench } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { PageSkeleton, QueryError } from '@/components/states';
import { EnabledBadge } from '@/components/status';
import { RelativeTime } from '@/components/copy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDuration, formatNumber, pluralize } from '@/lib/format';
import { AUTH_MODE_LABELS, ROTATION_LABELS, TRANSPORT_LABELS } from '@/lib/labels';
import { useDeleteProvider, useProvider, useUpdateProvider } from '@/queries/providers';
import { KeysTab } from './keys-tab';
import { ToolsTab } from './tools-tab';

interface SummaryCardProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  value: ReactNode;
  children: ReactNode;
}

function SummaryCard({ icon: Icon, title, value, children }: SummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {title}
        </CardDescription>
        <CardTitle className="truncate text-lg font-semibold">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0.5 text-xs text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

function connectionText(provider: ProviderDto): string {
  if (provider.transport !== 'stdio') return provider.url ?? '';
  return [provider.command, ...(provider.args ?? [])].filter(Boolean).join(' ');
}

export function ProviderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const provider = useProvider(id);
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tab = searchParams.get('tab') === 'tools' ? 'tools' : 'keys';

  if (provider.isPending) return <PageSkeleton />;
  if (provider.isError) {
    return (
      <>
        <PageHeader back={{ to: '/providers', label: 'Providers' }} title="Provider" />
        <QueryError title="Could not load the provider" error={provider.error} onRetry={() => void provider.refetch()} />
      </>
    );
  }

  const data = provider.data;
  const stats = data.keyStats;

  function toggleEnabled() {
    updateProvider.mutate(
      { id: data.id, input: { enabled: !data.enabled } },
      { onSuccess: (saved) => toast.success(`Provider "${saved.name}" ${saved.enabled ? 'enabled' : 'disabled'}`) },
    );
  }

  return (
    <>
      <PageHeader
        back={{ to: '/providers', label: 'Providers' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {data.name}
            <EnabledBadge enabled={data.enabled} />
          </span>
        }
        description={data.description ?? <span className="font-mono">{data.slug}</span>}
        actions={
          <>
            <Button variant="outline" onClick={toggleEnabled} disabled={updateProvider.isPending}>
              {data.enabled ? <PowerOff data-icon="inline-start" /> : <Power data-icon="inline-start" />}
              {data.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/providers/${data.id}/edit`}>
                <Pencil data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={KeyRound} title="API keys" value={formatNumber(stats.total)}>
          <p>
            {stats.active} active · {stats.cooldown} in cooldown · {stats.disabled} disabled
          </p>
        </SummaryCard>
        <SummaryCard icon={RefreshCw} title="Connection" value={TRANSPORT_LABELS[data.transport]}>
          <p className="truncate font-mono" title={connectionText(data)}>
            {connectionText(data)}
          </p>
          <p>Auth: {AUTH_MODE_LABELS[data.authMode]}</p>
        </SummaryCard>
        <SummaryCard icon={Shuffle} title="Rotation" value={ROTATION_LABELS[data.rotationStrategy]}>
          <p>Failover {data.failoverEnabled ? 'on' : 'off'}</p>
          <p>Cooldown {data.cooldownSeconds > 0 ? formatDuration(data.cooldownSeconds) : 'off'}</p>
        </SummaryCard>
        <SummaryCard icon={Wrench} title="Tools" value={data.cachedTools ? formatNumber(data.cachedTools.length) : '—'}>
          <p>
            {data.toolsFetchedAt ? (
              <>
                Fetched <RelativeTime value={data.toolsFetchedAt} />
              </>
            ) : (
              'Not fetched yet'
            )}
          </p>
        </SummaryCard>
      </div>

      <Tabs value={tab} onValueChange={(value) => setSearchParams(value === 'keys' ? {} : { tab: value }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="keys">
            API keys
            <Badge variant="secondary" className="tabular-nums">
              {stats.total}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="tools">
            Tools
            <Badge variant="secondary" className="tabular-nums">
              {data.cachedTools?.length ?? 0}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="keys" className="mt-4">
          <KeysTab provider={data} />
        </TabsContent>
        <TabsContent value="tools" className="mt-4">
          <ToolsTab provider={data} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${data.name}?`}
        description={`This permanently deletes the provider, its ${pluralize(stats.total, 'API key')} and its links to endpoints.`}
        confirmLabel="Delete provider"
        onConfirm={async () => {
          await deleteProvider.mutateAsync(data.id);
          toast.success(`Provider "${data.name}" deleted`);
          navigate('/providers', { replace: true });
        }}
      />
    </>
  );
}
