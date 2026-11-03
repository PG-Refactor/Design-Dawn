// What the UI knows about the Mermaid renderer: an interface and plain values, so a test
// can hand the UI a fake and nothing outside render-mermaid.ts depends on the library.

// Theme token values resolved from the CSS variables at render time. Mermaid cannot read
// CSS variables, so the resolved colours and font are passed in.
// A key is missing when its token could not be resolved; Mermaid then keeps its default.
export interface MermaidThemeValues {
  readonly background?: string;
  readonly primaryColor?: string;
  readonly primaryTextColor?: string;
  readonly primaryBorderColor?: string;
  readonly lineColor?: string;
  readonly secondaryColor?: string;
  readonly tertiaryColor?: string;
  readonly textColor?: string;
  // Shapes of flowcharts and sequence diagrams. Mermaid would derive these from the base
  // colours (a pale tint, hard to see on a white page), so they are given explicitly.
  readonly mainBkg?: string;
  readonly nodeBorder?: string;
  readonly clusterBkg?: string;
  readonly clusterBorder?: string;
  readonly actorBkg?: string;
  readonly actorBorder?: string;
  readonly labelBoxBorderColor?: string;
  readonly fontFamily?: string;
  // Categorical pie slices, then the colours of pie and gantt text, lines and bars.
  readonly pie1?: string;
  readonly pie2?: string;
  readonly pie3?: string;
  readonly pie4?: string;
  readonly pie5?: string;
  readonly pie6?: string;
  readonly pie7?: string;
  readonly pie8?: string;
  readonly pieStrokeColor?: string;
  readonly pieOuterStrokeColor?: string;
  readonly pieSectionTextColor?: string;
  readonly pieTitleTextColor?: string;
  readonly pieLegendTextColor?: string;
  readonly taskBkgColor?: string;
  readonly taskBorderColor?: string;
  readonly taskTextColor?: string;
  readonly taskTextLightColor?: string;
  readonly taskTextDarkColor?: string;
  readonly taskTextOutsideColor?: string;
  readonly activeTaskBkgColor?: string;
  readonly activeTaskBorderColor?: string;
  readonly doneTaskBkgColor?: string;
  readonly doneTaskBorderColor?: string;
  readonly critBkgColor?: string;
  readonly critBorderColor?: string;
  readonly sectionBkgColor?: string;
  readonly sectionBkgColor2?: string;
  readonly altSectionBkgColor?: string;
  readonly gridColor?: string;
  readonly todayLineColor?: string;
  readonly excludeBkgColor?: string;
  readonly vertLineColor?: string;
  // Mermaid derives some colours differently for a dark surface; a boolean, because the
  // string "false" would be truthy.
  readonly darkMode?: boolean;
  // Fixed (not a token): the pie slices are drawn solid so their contrast is the palette's.
  readonly pieOpacity?: string;
}

export type RenderOutcome =
  // `svg` is untrusted until it went through sanitizeSvg.
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly message: string };

export interface MermaidRenderer {
  // Never rejects: every failure is an `ok: false` outcome.
  render(source: string, theme: MermaidThemeValues): Promise<RenderOutcome>;
}
