// Semantic token names. The values live only in
// `src/styles/theme-tokens.css`; each theme must define exactly these names.

// The categorical palette of diagram previews (Mermaid pie slices, gantt bars).
export const DIAGRAM_COLOR_TOKEN_NAMES = [
  "--color-diagram-1",
  "--color-diagram-2",
  "--color-diagram-3",
  "--color-diagram-4",
  "--color-diagram-5",
  "--color-diagram-6",
  "--color-diagram-7",
  "--color-diagram-8",
] as const;

export const COLOR_TOKEN_NAMES = [
  "--color-background",
  "--color-surface",
  "--color-surface-raised",
  "--color-text",
  "--color-text-muted",
  "--color-border",
  "--color-border-strong",
  "--color-accent",
  "--color-accent-contrast",
  "--color-hover",
  "--color-caption-background",
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
  "--color-diff-filler-bg",
  "--color-button-primary-bg",
  "--color-button-primary-text",
  "--color-button-primary-hover",
  "--color-git-modified",
  "--color-git-added",
  "--color-git-deleted",
  "--color-git-renamed",
  "--color-git-untracked",
  "--color-git-conflict",
  ...DIAGRAM_COLOR_TOKEN_NAMES,
  "--color-on-diagram",
  "--color-diagram-node-fill",
] as const;

export const SHADOW_TOKEN_NAMES = [
  "--shadow-raised",
  "--shadow-subtle",
] as const;

export const THEME_TOKEN_NAMES: readonly string[] = [
  ...COLOR_TOKEN_NAMES,
  ...SHADOW_TOKEN_NAMES,
];
