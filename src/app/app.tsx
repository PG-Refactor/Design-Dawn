import { APP_CONFIG } from "../config/app-config";
import {
  ThemeSettings,
  type ThemeSettingsController,
} from "../features/theme/theme-settings";
import "./app.css";

export interface AppProps {
  readonly themeController: ThemeSettingsController;
}

// Minimal shell: the theme selector is a temporary placement until the toolbar / settings
// screen exists.
export function App({ themeController }: AppProps) {
  return (
    <main className="app-shell">
      <h1 className="app-shell__title">{APP_CONFIG.displayName}</h1>
      <ThemeSettings controller={themeController} />
    </main>
  );
}
