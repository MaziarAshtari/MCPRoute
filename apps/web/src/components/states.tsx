import type { ComponentType, ReactNode } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: ComponentType;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <Empty className={cn('border bg-card py-12', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function QueryError({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{errorMessage(error)}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton />
    </div>
  );
}
