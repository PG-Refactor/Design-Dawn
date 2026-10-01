import { THEME_PREFERENCES } from "../../application/local-state/theme";
import type {
  ThemeController,
  ThemeState,
} from "../../application/theme/theme-controller";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { THEME_PREFERENCE_LABELS, THEME_SETTINGS_LEGEND } from "./theme-labels";
import { ThemePreferenceSelector } from "./theme-preference-selector";

// Only what the container needs, so a settings screen can pass the same controller.
export type ThemeSettingsController = Pick<
  ThemeController,
  "store" | "setPreference"
>;

const OPTIONS = THEME_PREFERENCES.map((preference) => ({
  value: preference,
  label: THEME_PREFERENCE_LABELS[preference],
}));

const selectPreference = (state: ThemeState) => state.preference;
const selectIsLoading = (state: ThemeState) => state.status === "loading";

export function ThemeSettings({
  controller,
}: {
  readonly controller: ThemeSettingsController;
}) {
  const preference = useStoreSelector(controller.store, selectPreference);
  const isLoading = useStoreSelector(controller.store, selectIsLoading);
  return (
    <ThemePreferenceSelector
      legend={THEME_SETTINGS_LEGEND}
      value={preference}
      options={OPTIONS}
      disabled={isLoading}
      // The failure is recorded in the controller state; showing it needs the
      // notification UI, which does not exist yet.
      onChange={(next) => void controller.setPreference(next)}
    />
  );
}
