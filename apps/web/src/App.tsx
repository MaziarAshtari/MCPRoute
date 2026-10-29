import { useCallback, useEffect, useState } from 'react';
import { APP_NAME, type HealthDto } from '@mcproute/shared';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ApiStatus = 'checking' | 'online' | 'offline';

const STATUS: Record<ApiStatus, { label: string; dot: string }> = {
  checking: { label: 'Checking…', dot: 'animate-pulse bg-muted-foreground' },
  online: { label: 'Online', dot: 'bg-emerald-500' },
  offline: { label: 'Unreachable', dot: 'bg-destructive' },
};

/** Placeholder page until the admin UI is built. */
export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    setStatus('checking');
    try {
      const response = await fetch('/healthz', { signal });
      const body = (await response.json()) as HealthDto;
      setStatus(response.ok && body.status === 'ok' ? 'online' : 'offline');
    } catch {
      if (!signal?.aborted) setStatus('offline');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal);
    return () => controller.abort();
  }, [checkHealth]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{APP_NAME}</CardTitle>
          <CardDescription>
            Self-hosted gateway that aggregates MCP servers and rotates API keys per session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            The admin interface is under construction. Until then, manage providers, keys, proxies and endpoints
            through the REST API under <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api</code>.
          </p>
          <div className="flex items-center gap-2" aria-live="polite">
            <span className={cn('size-2.5 rounded-full', STATUS[status].dot)} />
            <span>
              API server: <span className="font-medium">{STATUS[status].label}</span>
            </span>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button variant="outline" size="sm" onClick={() => void checkHealth()} disabled={status === 'checking'}>
            <RefreshCw data-icon="inline-start" />
            Check again
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
