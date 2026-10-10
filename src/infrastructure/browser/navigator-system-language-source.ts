import type { SystemLanguageSource } from "../../application/ports/system-language-source";

export interface NavigatorLanguages {
  readonly languages?: readonly string[];
}

// `navigator` is a parameter so tests can pass a fake; undefined means the host has none
// (for example node). Reading it through the webview needs no Tauri permission.
export function createNavigatorSystemLanguageSource(
  navigatorLike: NavigatorLanguages | undefined,
): SystemLanguageSource {
  return {
    current: () => navigatorLike?.languages ?? [],
  };
}
