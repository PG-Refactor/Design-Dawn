// Semantic token names (docs/architecture.md §13.3). The values live only in
// `src/styles/theme-tokens.css`; each theme must define exactly these names.

export const COLOR_TOKEN_NAMES = [
  "--color-background",
  "--color-surface",
  "--color-surface-raised",
  "--color-text",
  "--color-text-muted",
  "--color-border",
  "--color-accent",
  "--color-accent-contrast",
  "--color-selection",
  "--color-danger",
  "--color-danger-contrast",
  "--color-warning",
  "--color-focus-ring",
  "--color-canvas-background",
  "--color-canvas-grid",
] as const;

export const SHADOW_TOKEN_NAMES = ["--shadow-raised"] as const;

export const THEME_TOKEN_NAMES: readonly string[] = [
  ...COLOR_TOKEN_NAMES,
  ...SHADOW_TOKEN_NAMES,
];
