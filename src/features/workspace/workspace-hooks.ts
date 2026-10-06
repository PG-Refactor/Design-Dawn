import { useMemo } from "react";
import type { ApplicationState } from "../../application/state/application-state";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { UiState } from "./ui-state/ui-state";
import { useWorkspaceServices } from "./workspace-services-context";

const identity = <Value>(value: Value): Value => value;

// Derives a view model from the application and UI state. Both states are immutable
// values, so the model is recomputed only when one of them (or `select`, which should be
// a module-level function) changes.
export function useWorkspaceModel<Model>(
  select: (application: ApplicationState, ui: UiState) => Model,
): Model {
  const { applicationStore, uiStateStore } = useWorkspaceServices();
  const application = useStoreSelector(applicationStore, identity);
  const ui = useStoreSelector(uiStateStore, identity);
  return useMemo(() => select(application, ui), [application, ui, select]);
}

export function useUiState<Selected>(
  select: (ui: UiState) => Selected,
): Selected {
  const { uiStateStore } = useWorkspaceServices();
  return useStoreSelector(uiStateStore, select);
}
