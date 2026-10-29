import type { ProxyDto } from '@mcproute/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PROXY_STATUS_DOT, proxyDisplayName } from '@/lib/labels';
import { cn } from '@/lib/utils';

/** Select values cannot be empty strings, so "no proxy" uses this sentinel. */
export const NO_PROXY = 'none';

interface ProxySelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  proxies: ProxyDto[];
  disabled?: boolean;
}

export function ProxySelect({ id, value, onChange, proxies, disabled }: ProxySelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="No proxy" />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        <SelectItem value={NO_PROXY}>No proxy (direct connection)</SelectItem>
        {proxies.map((proxy) => (
          <SelectItem key={proxy.id} value={proxy.id}>
            <span className={cn('size-1.5 shrink-0 rounded-full', PROXY_STATUS_DOT[proxy.status])} aria-hidden="true" />
            <span className="truncate">{proxyDisplayName(proxy)}</span>
            {!proxy.enabled && <span className="text-muted-foreground">(disabled)</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
