// Port for the languages the system (the WebView) asks for.

export interface SystemLanguageSource {
  // Language tags in the user's order of preference; empty when unknown.
  current(): readonly string[];
}
