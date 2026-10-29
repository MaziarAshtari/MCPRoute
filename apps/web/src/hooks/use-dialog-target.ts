import { useState } from 'react';

/**
 * Open state plus the item a dialog acts on. The item is kept after closing so the dialog does not go
 * blank during its exit animation.
 */
export function useDialogTarget<T>() {
  const [state, setState] = useState<{ target: T | null; open: boolean }>({ target: null, open: false });
  return {
    target: state.target,
    open: state.open,
    show: (target: T) => setState({ target, open: true }),
    onOpenChange: (open: boolean) => setState((current) => ({ ...current, open })),
  };
}
