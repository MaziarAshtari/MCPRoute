import type { BulkLineError } from '@mcproute/shared';
import { StatusBadge } from '@/components/status';
import { formatNumber, pluralize } from '@/lib/format';

interface ImportResultProps {
  created: number;
  skipped: number;
  errors: BulkLineError[];
  /** Keys import only: inline proxies that were added to the pool. */
  proxiesCreated?: number;
}

export function ImportResult({ created, skipped, errors, proxiesCreated }: ImportResultProps) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" role="status" aria-label="Import result">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="success">{formatNumber(created)} created</StatusBadge>
        <StatusBadge tone="neutral">{formatNumber(skipped)} skipped</StatusBadge>
        <StatusBadge tone={errors.length > 0 ? 'danger' : 'neutral'}>{pluralize(errors.length, 'error')}</StatusBadge>
        {proxiesCreated !== undefined && proxiesCreated > 0 && (
          <StatusBadge tone="info">{pluralize(proxiesCreated, 'new proxy', 'new proxies')}</StatusBadge>
        )}
      </div>
      {skipped > 0 && <p className="text-xs text-muted-foreground">Skipped entries already exist or are repeated in the input.</p>}
      {errors.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border bg-background">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="w-16 px-2 py-1.5 font-medium">Line</th>
                <th className="px-2 py-1.5 font-medium">Problem</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((error) => (
                <tr key={`${error.line}-${error.message}`} className="border-t">
                  <td className="px-2 py-1.5 font-mono tabular-nums">{error.line}</td>
                  <td className="px-2 py-1.5">{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
