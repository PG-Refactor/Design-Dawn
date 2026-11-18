import type { MermaidThemeValues } from "./mermaid-renderer-types";

// Which design token feeds which Mermaid theme variable. Colours are never written here:
// the values are read from the active theme.
export type ThemeVariable = Exclude<
  keyof MermaidThemeValues,
  "darkMode" | "pieOpacity"
>;

export const THEME_TOKENS: readonly (readonly [ThemeVariable, string])[] = [
  ["background", "--color-surface"],
  ["primaryColor", "--color-surface-raised"],
  ["primaryTextColor", "--color-text"],
  ["primaryBorderColor", "--color-border-strong"],
  ["lineColor", "--color-text-muted"],
  ["secondaryColor", "--color-selection"],
  ["tertiaryColor", "--color-canvas-background"],
  ["textColor", "--color-text"],
  // Node and actor shapes: a fill apart from the page and an outline >= 3:1 against both,
  // so a diagram reads on a white page as well as a dark one.
  ["mainBkg", "--color-diagram-node-fill"],
  ["nodeBorder", "--color-border-strong"],
  ["clusterBkg", "--color-canvas-background"],
  ["clusterBorder", "--color-border-strong"],
  ["actorBkg", "--color-diagram-node-fill"],
  ["actorBorder", "--color-border-strong"],
  ["labelBoxBorderColor", "--color-border-strong"],
  ["edgeLabelBackground", "--color-surface"],
  ["fontFamily", "--font-family-base"],
  // Mermaid's base theme derives pie1..pie12 and the gantt bars from the primary colours
  // (darkened on a dark surface, which made them near-black), so the diagram palette is
  // given explicitly. In-bar and in-slice text uses --color-on-diagram, which every fill
  // below has >= 4.5:1 with (theme-tokens.test.ts); text outside a bar sits on the surface.
  ["pie1", "--color-diagram-1"],
  ["pie2", "--color-diagram-2"],
  ["pie3", "--color-diagram-3"],
  ["pie4", "--color-diagram-4"],
  ["pie5", "--color-diagram-5"],
  ["pie6", "--color-diagram-6"],
  ["pie7", "--color-diagram-7"],
  ["pie8", "--color-diagram-8"],
  ["pieStrokeColor", "--color-surface"],
  ["pieOuterStrokeColor", "--color-border-strong"],
  ["pieSectionTextColor", "--color-on-diagram"],
  ["pieTitleTextColor", "--color-text"],
  ["pieLegendTextColor", "--color-text"],
  ["taskBkgColor", "--color-diagram-1"],
  ["taskBorderColor", "--color-text-muted"],
  ["taskTextColor", "--color-on-diagram"],
  ["taskTextLightColor", "--color-on-diagram"],
  ["taskTextDarkColor", "--color-on-diagram"],
  ["taskTextOutsideColor", "--color-text"],
  ["activeTaskBkgColor", "--color-diagram-2"],
  ["activeTaskBorderColor", "--color-text"],
  ["doneTaskBkgColor", "--color-diagram-8"],
  ["doneTaskBorderColor", "--color-text-muted"],
  ["critBkgColor", "--color-danger"],
  ["critBorderColor", "--color-text"],
  ["sectionBkgColor", "--color-diagram-1"],
  ["sectionBkgColor2", "--color-diagram-1"],
  ["altSectionBkgColor", "--color-diagram-2"],
  ["gridColor", "--color-border"],
  ["todayLineColor", "--color-warning"],
  ["excludeBkgColor", "--color-canvas-background"],
  ["vertLineColor", "--color-accent"],
  // A mindmap's branches (and a timeline's or kanban's sections) take cScale0..11, which
  // Mermaid would derive from the primary colours and darken: dark fills with dark text in
  // either theme. The diagram palette in turn instead, with its text colour.
  ["cScale0", "--color-diagram-1"],
  ["cScale1", "--color-diagram-2"],
  ["cScale2", "--color-diagram-3"],
  ["cScale3", "--color-diagram-4"],
  ["cScale4", "--color-diagram-5"],
  ["cScale5", "--color-diagram-6"],
  ["cScale6", "--color-diagram-7"],
  ["cScale7", "--color-diagram-8"],
  ["cScale8", "--color-diagram-1"],
  ["cScale9", "--color-diagram-2"],
  ["cScale10", "--color-diagram-3"],
  ["cScale11", "--color-diagram-4"],
  ["cScaleLabel0", "--color-on-diagram"],
  ["cScaleLabel1", "--color-on-diagram"],
  ["cScaleLabel2", "--color-on-diagram"],
  ["cScaleLabel3", "--color-on-diagram"],
  ["cScaleLabel4", "--color-on-diagram"],
  ["cScaleLabel5", "--color-on-diagram"],
  ["cScaleLabel6", "--color-on-diagram"],
  ["cScaleLabel7", "--color-on-diagram"],
  ["cScaleLabel8", "--color-on-diagram"],
  ["cScaleLabel9", "--color-on-diagram"],
  ["cScaleLabel10", "--color-on-diagram"],
  ["cScaleLabel11", "--color-on-diagram"],
];

// Which value of the root's `color-scheme` property means a dark surface.
const DARK_COLOR_SCHEME = "dark";

// Fixed value of `pieOpacity` (see MermaidThemeValues).
const PIE_OPACITY = "1";

// Resolved at render time, after the theme attribute is on the root element, so a theme
// switch is picked up by the next render.
export function resolveMermaidTheme(root: Element): MermaidThemeValues {
  const style = getComputedStyle(root);
  const values: { -readonly [K in ThemeVariable]?: string } = {};
  for (const [variable, token] of THEME_TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value !== "") values[variable] = value;
  }
  return withNonTokenValues(
    values,
    style.getPropertyValue("color-scheme").trim() === DARK_COLOR_SCHEME,
  );
}

// The values that are not a token's colour. Also used by the tests that read the token CSS
// instead of a computed style.
export function withNonTokenValues(
  values: MermaidThemeValues,
  isDark: boolean,
): MermaidThemeValues {
  return { ...values, darkMode: isDark, pieOpacity: PIE_OPACITY };
}
