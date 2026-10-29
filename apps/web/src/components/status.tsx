import type { ComponentProps, ReactNode } from 'react';
import type { ApiKeyDto, KeyStatus, LogStatus, ProxyStatus } from '@mcproute/shared';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const DOT: Record<Tone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  neutral: 'bg-muted-foreground/50',
  info: 'bg-sky-500',
};

export function StatusBadge({ tone, className, children, ...props }: ComponentProps<typeof Badge> & { tone: Tone }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-normal whitespace-nowrap', className)} {...props}>
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
      {children}
    </Badge>
  );
}

function WithTooltip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  if (!tip) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Effective key state: disabled (flag or status) wins, and an expired cooldown counts as active. */
export function keyState(key: ApiKeyDto, now: number = Date.now()): KeyStatus {
  if (!key.enabled || key.status === 'disabled') return 'disabled';
  if (key.status === 'cooldown' && key.cooldownUntil && Date.parse(key.cooldownUntil) > now) return 'cooldown';
  return 'active';
}

export function KeyStatusBadge({ apiKey }: { apiKey: ApiKeyDto }) {
  const state = keyState(apiKey);
  if (state === 'cooldown' && apiKey.cooldownUntil) {
    return (
      <WithTooltip tip={`Cooling down until ${formatDateTime(apiKey.cooldownUntil)}`}>
        <StatusBadge tone="warning">Cooldown · {formatRelative(apiKey.cooldownUntil).replace(/^in /, '')}</StatusBadge>
      </WithTooltip>
    );
  }
  if (state === 'disabled') return <StatusBadge tone="neutral">Disabled</StatusBadge>;
  if (apiKey.proxy && !apiKey.proxy.enabled) {
    return (
      <WithTooltip tip="Its proxy is disabled, so the gateway skips this key.">
        <StatusBadge tone="warning">Proxy disabled</StatusBadge>
      </WithTooltip>
    );
  }
  return <StatusBadge tone="success">Active</StatusBadge>;
}

const PROXY_STATUS: Record<ProxyStatus, { tone: Tone; label: string }> = {
  ok: { tone: 'success', label: 'Healthy' },
  failed: { tone: 'danger', label: 'Failed' },
  unknown: { tone: 'neutral', label: 'Unchecked' },
};

export function ProxyStatusBadge({ status, error }: { status: ProxyStatus; error?: string | null }) {
  const { tone, label } = PROXY_STATUS[status];
  return (
    <WithTooltip tip={status === 'failed' ? error : null}>
      <StatusBadge tone={tone}>{label}</StatusBadge>
    </WithTooltip>
  );
}

export function LogStatusBadge({ status }: { status: LogStatus }) {
  return status === 'ok' ? <StatusBadge tone="success">OK</StatusBadge> : <StatusBadge tone="danger">Error</StatusBadge>;
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? <StatusBadge tone="success">Enabled</StatusBadge> : <StatusBadge tone="neutral">Disabled</StatusBadge>;
}
