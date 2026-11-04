// What an add form of the diagram GUI tells the dialog it is shown in: the operation its
// fields describe so far (for the preview), and when it added something (the dialog then
// closes). The dialog in turn asks it to clear its fields when it is cancelled.

import { createContext, useContext, useEffect, useRef } from "react";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";

export interface AddDialogFormLink {
  readonly reportPending: (operation: DiagramOperation | null) => void;
  // Counts the cancellations; each new value clears the form.
  readonly resetSignal: number;
  readonly added: () => void;
}

export const AddDialogFormContext = createContext<AddDialogFormLink | null>(
  null,
);

// `pending`: the operation the fields describe, or null while something it needs is
// missing. `clear`: empties the fields, like after an add.
export function useAddDialogForm(
  pending: DiagramOperation | null,
  clear: () => void,
): { readonly added: () => void } {
  const link = useContext(AddDialogFormContext);
  const pendingKey = JSON.stringify(pending);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const clearRef = useRef(clear);
  clearRef.current = clear;

  // Keyed by its content: a form re-renders with an equal, new operation object.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingKey stands for pending.
  useEffect(() => {
    link?.reportPending(pendingRef.current);
  }, [link, pendingKey]);

  const resetSignal = link?.resetSignal ?? 0;
  const firstSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal !== firstSignal.current) clearRef.current();
  }, [resetSignal]);

  return { added: () => link?.added() };
}
