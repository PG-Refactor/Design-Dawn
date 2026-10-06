// Port for the theme the operating system currently prefers.

import type { ResolvedTheme } from "../local-state/theme";

export interface OsThemeSource {
  // Null when the OS theme cannot be determined.
  current(): ResolvedTheme | null;
  // Returns the unsubscribe function.
  subscribe(listener: (theme: ResolvedTheme) => void): () => void;
}
