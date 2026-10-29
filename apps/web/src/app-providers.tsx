import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster closeButton richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
