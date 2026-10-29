import type { ComponentType, ReactNode } from 'react';
import type { StatsOverviewDto } from '@mcproute/shared';
import { Activity, CircleCheck, Globe, KeyRound, Server, TriangleAlert, Waypoints, Zap } from 'lucide-react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/states';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatNumber, formatPercent, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStatsOverview, useStatsTimeseries } from '@/queries/observability';

const chartConfig = {
  ok: { label: 'Successful', theme: { light: 'oklch(0.6 0.118 184.704)', dark: 'oklch(0.696 0.17 162.48)' } },
  error: { label: 'Errors', theme: { light: 'oklch(0.577 0.245 27.325)', dark: 'oklch(0.704 0.191 22.216)' } },
} satisfies ChartConfig;

interface StatCardProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  value: ReactNode;
  to?: string;
  valueClassName?: string;
  children?: ReactNode;
}

function StatCard({ title, icon: Icon, value, to, valueClassName, children }: StatCardProps) {
  const content = (
    <Card className={cn('h-full', to && 'transition-colors hover:bg-muted/40')}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          {title}
          <Icon className="size-4" />
        </CardDescription>
        <CardTitle className={cn('text-2xl font-semibold tabular-nums sm:text-3xl', valueClassName)}>{value}</CardTitle>
      </CardHeader>
      {children && <CardContent className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">{children}</CardContent>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {content}
    </Link>
  ) : (
    content
  );
}

function errorRateClass(rate: number, total: number): string | undefined {
  if (total === 0) return undefined;
  if (rate >= 0.2) return 'text-red-600 dark:text-red-400';
  if (rate >= 0.05) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function StatCards({ stats }: { stats: StatsOverviewDto }) {
  const { providers, keys, proxies, sessions, requests24h } = stats;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
      <StatCard title="Providers" icon={Server} value={formatNumber(providers.total)} to="/providers">
        <span>{formatNumber(providers.enabled)} enabled</span>
      </StatCard>
      <StatCard title="API keys" icon={KeyRound} value={formatNumber(keys.total)}>
        <StatusBadge tone="success">{formatNumber(keys.active)} active</StatusBadge>
        <StatusBadge tone="warning">{formatNumber(keys.cooldown)} cooldown</StatusBadge>
        <StatusBadge tone="neutral">{formatNumber(keys.disabled)} disabled</StatusBadge>
      </StatCard>
      <StatCard title="Proxies" icon={Globe} value={formatNumber(proxies.total)} to="/proxies">
        <StatusBadge tone="success">{formatNumber(proxies.ok)} healthy</StatusBadge>
        <StatusBadge tone="danger">{formatNumber(proxies.failed)} failed</StatusBadge>
        <StatusBadge tone="neutral">{formatNumber(proxies.unknown)} unchecked</StatusBadge>
      </StatCard>
      <StatCard title="Active sessions" icon={Activity} value={formatNumber(sessions.active)} to="/sessions">
        <span>MCP clients connected right now</span>
      </StatCard>
      <StatCard title="Requests (24 h)" icon={Zap} value={formatNumber(requests24h.total)} to="/logs">
        <span>
          {formatNumber(requests24h.ok)} successful · {formatNumber(requests24h.error)} errors
        </span>
      </StatCard>
      <StatCard
        title="Error rate (24 h)"
        icon={TriangleAlert}
        value={formatPercent(requests24h.errorRate)}
        valueClassName={errorRateClass(requests24h.errorRate, requests24h.total)}
        to="/logs?status=error"
      >
        <span>{requests24h.total === 0 ? 'No requests yet' : 'Share of failed upstream calls'}</span>
      </StatCard>
    </div>
  );
}

function RequestsChart() {
  const series = useStatsTimeseries(24);
  const data = (series.data?.buckets ?? []).map((bucket) => ({
    start: bucket.start,
    hour: formatTime(bucket.start),
    ok: bucket.ok,
    error: bucket.error,
  }));
  const total = data.reduce((sum, bucket) => sum + bucket.ok + bucket.error, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests and errors</CardTitle>
        <CardDescription>Upstream calls per hour over the last 24 hours</CardDescription>
      </CardHeader>
      <CardContent>
        {series.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : series.isError ? (
          <QueryError title="Could not load the chart" error={series.error} onRetry={() => void series.refetch()} />
        ) : (
          <div className="relative">
            <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_label, payload) => {
                        const start = payload?.[0]?.payload?.start;
                        return typeof start === 'string' ? formatDateTime(start) : '';
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="ok" stackId="requests" fill="var(--color-ok)" />
                <Bar dataKey="error" stackId="requests" fill="var(--color-error)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
            {total === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-md bg-background/80 px-3 py-1.5 text-sm text-muted-foreground">No requests in the last 24 hours</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GettingStarted({ stats }: { stats: StatsOverviewDto }) {
  const steps = [
    { done: stats.providers.total > 0, title: 'Add a provider', text: 'Connect an upstream MCP server, e.g. from a preset.', to: '/providers/new', icon: Server },
    { done: stats.keys.total > 0, title: 'Add API keys', text: 'Paste one or many keys on the provider page.', to: '/providers', icon: KeyRound },
    { done: false, title: 'Create an endpoint', text: 'Link providers and copy the client configuration.', to: '/endpoints/new', icon: Waypoints },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>Three steps to your first MCP endpoint.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.title} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-2 font-medium">
              {step.done ? <CircleCheck className="size-4 text-emerald-600" /> : <step.icon className="size-4 text-muted-foreground" />}
              {step.title}
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{step.text}</p>
            <Button asChild size="sm" variant={step.done ? 'outline' : 'default'} className="self-start">
              <Link to={step.to}>{step.done ? 'Open' : 'Start'}</Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const overview = useStatsOverview();

  return (
    <>
      <PageHeader title="Dashboard" description="Gateway health at a glance. Numbers refresh every 30 seconds." />
      <div className="space-y-6">
        {overview.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : overview.isError ? (
          <QueryError title="Could not load statistics" error={overview.error} onRetry={() => void overview.refetch()} />
        ) : (
          <>
            {overview.data.providers.total === 0 && <GettingStarted stats={overview.data} />}
            <StatCards stats={overview.data} />
          </>
        )}
        <RequestsChart />
      </div>
    </>
  );
}
