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
  "--color-diff-added-bg",
  "--color-diff-added-text",
  "--color-diff-removed-bg",
  "--color-diff-removed-text",
  "--color-diff-hunk-text",
  "--color-diff-meta-text",
  "--color-button-primary-bg",
  "--color-button-primary-text",
  "--color-button-primary-hover",
  "--color-git-modified",
  "--color-git-added",
  "--color-git-deleted",
  "--color-git-renamed",
  "--color-git-untracked",
  "--color-git-conflict",
] as const;

export const SHADOW_TOKEN_NAMES = ["--shadow-raised"] as const;

export const THEME_TOKEN_NAMES: readonly string[] = [
  ...COLOR_TOKEN_NAMES,
  ...SHADOW_TOKEN_NAMES,
];
