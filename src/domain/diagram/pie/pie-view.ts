import { parsePie } from "./pie-parser";
import { decodePieLabel } from "./pie-text";

// What a GUI shows of an editable pie chart. Read-only and derived from the source on every
// call, so the GUI never holds a model of its own that could drift from the text.
export interface PieSliceView {
  // Position in source order.
  readonly index: number;
  // The key an operation must send back as its target (the label as written).
  readonly targetLabel: string;
  // The label a person reads and edits (`#quot;` shown as a quote).
  readonly displayLabel: string;
  // The value exactly as written; it is never reformatted.
  readonly valueText: string;
}

export interface PieChartView {
  // Empty when the chart has no title statement.
  readonly title: string;
  readonly slices: readonly PieSliceView[];
}

// Only meaningful for a source `analyzeDiagramSource` reports as editable; for any other
// text it returns what could be read and nothing more.
export function readPieChartView(source: string): PieChartView {
  const parsed = parsePie(source);
  return {
    title: parsed.titles[parsed.titles.length - 1]?.text ?? "",
    slices: parsed.slices.map((slice, index) => ({
      index,
      targetLabel: slice.label,
      displayLabel: decodePieLabel(slice.label),
      valueText: slice.valueText,
    })),
  };
}
