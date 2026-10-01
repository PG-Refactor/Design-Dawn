import type { ThemePreference } from "../../application/local-state/theme";

// Static UI text. Typed as a full record so a new theme id cannot be added without a label.
export const THEME_SETTINGS_LEGEND = "Theme";

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
