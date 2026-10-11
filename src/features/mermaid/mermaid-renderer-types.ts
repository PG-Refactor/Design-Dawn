// What the UI knows about the Mermaid renderer: an interface and plain values, so a test
// can hand the UI a fake and nothing outside render-mermaid.ts depends on the library.

// Theme token values resolved from the CSS variables at render time. Mermaid cannot read
// CSS variables, so the resolved colours and font are passed in (docs/architecture.md §15.4).
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
  readonly fontFamily?: string;
}

export type RenderOutcome =
  // `svg` is untrusted until it went through sanitizeSvg.
  | { readonly ok: true; readonly svg: string }
  | { readonly ok: false; readonly message: string };

export interface MermaidRenderer {
  // Never rejects: every failure is an `ok: false` outcome.
  render(source: string, theme: MermaidThemeValues): Promise<RenderOutcome>;
}
