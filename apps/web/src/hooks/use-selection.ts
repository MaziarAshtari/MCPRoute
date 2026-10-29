import { useMemo, useState } from 'react';

/** Row selection for tables; ids that disappear from the list are dropped automatically. */
export function useSelection(ids: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const selected = useMemo(() => new Set(ids.filter((id) => picked.has(id))), [ids, picked]);
  const allSelected = ids.length > 0 && selected.size === ids.length;

  return {
    selected,
    count: selected.size,
    allSelected,
    /** Checkbox state for a "select all" header cell. */
    headerState: allSelected ? true : selected.size > 0 ? ('indeterminate' as const) : false,
    isSelected: (id: string) => selected.has(id),
    toggle: (id: string, value: boolean) =>
      setPicked((previous) => {
        const next = new Set(previous);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      }),
    setAll: (value: boolean) => setPicked(value ? new Set(ids) : new Set()),
    clear: () => setPicked(new Set()),
  };
}
