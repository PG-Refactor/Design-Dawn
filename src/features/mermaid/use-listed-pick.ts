import { useEffect } from "react";
import { useDiagramInteraction } from "./diagram-interaction";
import type { DiagramHit } from "./diagram-shapes";

// The list editors (ER, state, class): a click on a shape of the picture selects it in the
// editor's lists. They offer nothing on right-click. Registered while the editor is shown,
// with the latest closure on every render.
export function useListedPick(pick: (hit: DiagramHit) => void): void {
  const interaction = useDiagramInteraction();
  useEffect(() => {
    interaction?.register({ entriesFor: () => [], pick });
    return () => interaction?.register(null);
  });
}
