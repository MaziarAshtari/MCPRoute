import { Suspense } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/queries/auth';
import { AppSidebar, NAV_GROUPS, isNavActive } from './app-sidebar';
import { ThemeToggle } from './theme-toggle';

function currentSection(pathname: string): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => isNavActive(candidate.to, pathname));
    if (item) return item.label;
  }
  return 'MCPRoute';
}

/** Authenticated shell: redirects to /login when there is no admin session. */
export function AppLayout() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Empty className="max-w-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleAlert />
            </EmptyMedia>
            <EmptyTitle>The MCPRoute server is not responding</EmptyTitle>
            <EmptyDescription>{errorMessage(me.error)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void me.refetch()} disabled={me.isFetching}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (!me.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <SidebarProvider>
      <AppSidebar username={me.data.username} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm font-medium">{currentSection(location.pathname)}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
