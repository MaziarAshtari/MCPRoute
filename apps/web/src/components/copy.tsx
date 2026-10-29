import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyText } from '@/lib/clipboard';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

interface CopyButtonProps extends Omit<ComponentProps<typeof Button>, 'value' | 'onClick'> {
  value: string;
  /** What is being copied, used in the toast and as the accessible label. */
  label?: string;
  children?: ReactNode;
}

export function CopyButton({ value, label = 'Text', children, variant = 'ghost', size, className, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const Icon = copied ? Check : Copy;
  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (children ? 'sm' : 'icon-sm')}
      aria-label={children ? undefined : `Copy ${label.toLowerCase()}`}
      className={className}
      onClick={async () => {
        if (await copyText(value, label)) setCopied(true);
      }}
      {...props}
    >
      <Icon data-icon={children ? 'inline-start' : undefined} />
      {children}
    </Button>
  );
}

/** Monospace value with a copy button, e.g. URLs and tokens. */
export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3', className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
        {value}
      </code>
      <CopyButton value={value} label={label} />
    </div>
  );
}

export function RelativeTime({ value, fallback = 'Never' }: { value: string | null; fallback?: string }) {
  if (!value) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={value} className="whitespace-nowrap">
          {formatRelative(value)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(value)}</TooltipContent>
    </Tooltip>
  );
}
