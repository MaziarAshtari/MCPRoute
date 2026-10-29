import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function PaginationBar({ page, pageSize, total, onPageChange }: PaginationBarProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {formatNumber(page)} of {formatNumber(pages)}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
