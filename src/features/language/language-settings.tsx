import type {
  LanguageController,
  LanguageState,
} from "../../application/language/language-controller";
import {
  DISPLAY_LANGUAGE_NATIVE_NAMES,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
  SYSTEM_LANGUAGE_PREFERENCE,
} from "../../config/language-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { ThemePreferenceSelector } from "../theme/theme-preference-selector";

// Only what the container needs, so a settings screen can pass the same controller.
export type LanguageSettingsController = Pick<
  LanguageController,
  "store" | "setPreference"
>;

const selectPreference = (state: LanguageState) => state.preference;
const selectIsLoading = (state: LanguageState) => state.status === "loading";

function optionLabel(
  preference: LanguagePreference,
  systemLabel: string,
): string {
  return preference === SYSTEM_LANGUAGE_PREFERENCE
    ? systemLabel
    : DISPLAY_LANGUAGE_NATIVE_NAMES[preference];
}

// Reuses the presentational radio group of the theme setting, so both settings look and
// behave the same. Only "System" is translated; a language is named in itself.
export function LanguageSettings({
  controller,
  legend,
  systemLabel,
}: {
  readonly controller: LanguageSettingsController;
  readonly legend: string;
  readonly systemLabel: string;
}) {
  const preference = useStoreSelector(controller.store, selectPreference);
  const isLoading = useStoreSelector(controller.store, selectIsLoading);
  const options = LANGUAGE_PREFERENCES.map((value) => ({
    value,
    label: optionLabel(value, systemLabel),
  }));
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
