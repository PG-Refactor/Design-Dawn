import {
  THEME_PREFERENCES,
  type ThemePreference,
} from "../../application/local-state/theme";
import type {
  ThemeController,
  ThemeState,
} from "../../application/theme/theme-controller";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { ThemePreferenceSelector } from "./theme-preference-selector";

// Only what the container needs, so a settings screen can pass the same controller.
export type ThemeSettingsController = Pick<
  ThemeController,
  "store" | "setPreference"
>;

// Typed as a full record so a new theme id cannot be added without a label.
export type ThemePreferenceLabels = Readonly<Record<ThemePreference, string>>;

const selectPreference = (state: ThemeState) => state.preference;
const selectIsLoading = (state: ThemeState) => state.status === "loading";

export function ThemeSettings({
  controller,
  legend,
  labels,
}: {
  readonly controller: ThemeSettingsController;
  // Passed in rather than read from the catalog, so the control stays independent of the
  // workspace and can be rendered on its own.
  readonly legend: string;
  readonly labels: ThemePreferenceLabels;
}) {
  const options = THEME_PREFERENCES.map((preference) => ({
    value: preference,
    label: labels[preference],
  }));
  const preference = useStoreSelector(controller.store, selectPreference);
  const isLoading = useStoreSelector(controller.store, selectIsLoading);
  return (
    <ThemePreferenceSelector
      legend={legend}
      value={preference}
      options={options}
      disabled={isLoading}
      // A failed save is recorded in the controller state and shown as a notification.
      onChange={(next) => void controller.setPreference(next)}
    />
  );
}
