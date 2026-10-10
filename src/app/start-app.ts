// Start-up order (docs/ui-design.md §11.1): the OS theme is applied before anything is
// painted, the saved preference is loaded, and only then is the UI rendered, so content is
// never shown in the wrong theme. Dependencies are parameters to keep this testable.

import type { LanguageController } from "../application/language/language-controller";
import type { ResolvedTheme } from "../application/local-state/theme";
import type { AutoSaveController } from "../application/settings/auto-save-controller";
import type { LayoutSettingsController } from "../application/settings/layout-settings-controller";
import type { ThemeController } from "../application/theme/theme-controller";
import { applyTheme, type ThemeTarget } from "../features/theme/apply-theme";

export interface StartAppDependencies {
  readonly themeController: Pick<ThemeController, "store" | "initialize">;
  // Loaded alongside the theme; the UI texts follow it (see `useMessages`).
  readonly languageController?: Pick<LanguageController, "initialize">;
  // Loaded alongside the theme; behaves as "on" until then.
  readonly autoSaveController?: Pick<AutoSaveController, "initialize">;
  // Loaded alongside the theme so the panel has its stored width on the first paint.
  readonly layoutSettingsController?: Pick<
    LayoutSettingsController,
    "initialize"
  >;
  readonly themeTarget: ThemeTarget;
  readonly render: () => void;
  readonly reportError: (error: unknown) => void;
}

export async function startApp(
  dependencies: StartAppDependencies,
): Promise<void> {
  const {
    themeController,
    languageController,
    autoSaveController,
    layoutSettingsController,
    themeTarget,
    render,
    reportError,
  } = dependencies;
  const { store } = themeController;

  let appliedTheme: ResolvedTheme = store.getState().resolvedTheme;
  applyTheme(themeTarget, appliedTheme);
  store.subscribe(() => {
    const { resolvedTheme } = store.getState();
    if (resolvedTheme === appliedTheme) return;
    appliedTheme = resolvedTheme;
    applyTheme(themeTarget, resolvedTheme);
  });

  try {
    await Promise.all([
      themeController.initialize(),
      languageController?.initialize(),
      autoSaveController?.initialize(),
      layoutSettingsController?.initialize(),
    ]);
  } catch (error) {
    // The app must still start with the default theme.
    reportError(error);
  }
  render();
}
