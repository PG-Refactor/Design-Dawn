// Start-up order: the OS theme is applied before anything is
// painted, the saved preference is loaded, and only then is the UI rendered, so content is
// never shown in the wrong theme. Dependencies are parameters to keep this testable.

import type { LanguageController } from "../application/language/language-controller";
import type { ResolvedTheme } from "../application/local-state/theme";
import type { AutoSaveController } from "../application/settings/auto-save-controller";
import type { LayoutSettingsController } from "../application/settings/layout-settings-controller";
import type { ThemeController } from "../application/theme/theme-controller";
import {
  applyLanguage,
  type LanguageTarget,
} from "../features/language/apply-language";
import { applyTheme, type ThemeTarget } from "../features/theme/apply-theme";

export interface StartAppDependencies {
  readonly themeController: Pick<ThemeController, "store" | "initialize">;
  // Loaded alongside the theme; the UI texts follow it (see `useMessages`).
  readonly languageController?: Pick<
    LanguageController,
    "initialize" | "store"
  >;
  // Loaded alongside the theme; behaves as "on" until then.
  readonly autoSaveController?: Pick<AutoSaveController, "initialize">;
  // Loaded alongside the theme so the panel has its stored width on the first paint.
  readonly layoutSettingsController?: Pick<
    LayoutSettingsController,
    "initialize"
  >;
  readonly themeTarget: ThemeTarget;
  // Receives `lang`; the static value in index.html is only the fallback until then.
  readonly languageTarget?: LanguageTarget;
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
    languageTarget,
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

  // Unlike the theme, `lang` is not needed before the first paint: it changes no visuals,
  // so it follows the store (the initial value now, the saved preference after loading).
  if (languageController !== undefined && languageTarget !== undefined) {
    const languageStore = languageController.store;
    applyLanguage(languageTarget, languageStore.getState().language);
    languageStore.subscribe(() =>
      applyLanguage(languageTarget, languageStore.getState().language),
    );
  }

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
