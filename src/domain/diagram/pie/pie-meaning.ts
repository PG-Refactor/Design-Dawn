import { type DomainResult, err, ok } from "../../shared/domain-result";
import { pieEditability } from "./pie-editability";
import type { ParsedPie } from "./pie-parser";

// What Mermaid 12.1.0 holds after reading a pie chart (its pie db), derived from the parse.
export interface PieSliceMeaning {
  // The key Mermaid stores the slice under: the label as written between the quotes.
  // Entities such as #quot; are still encoded here; Mermaid decodes them only when it draws,
  // so equality of this text is exactly Mermaid's "same slice" test.
  readonly label: string;
  readonly value: number;
}

export interface PieMeaning {
  // The `title` statement (the last one wins); a front matter title is not part of it.
  readonly title: string;
  readonly showData: boolean;
  // In source order. Mermaid keeps the FIRST slice of a repeated label and silently drops
  // the later ones; the meaning reflects that, and a chart that repeats a label is not
  // editable (pie-editability.ts) so no operation can depend on the dropped slice.
  readonly slices: readonly PieSliceMeaning[];
}

export function pieMeaningOf(parsed: ParsedPie): PieMeaning {
  const seen = new Set<string>();
  const slices: PieSliceMeaning[] = [];
  for (const slice of parsed.slices) {
    if (seen.has(slice.label)) continue;
    seen.add(slice.label);
    slices.push({ label: slice.label, value: slice.value });
  }
  return {
    title: parsed.titles[parsed.titles.length - 1]?.text ?? "",
    showData: parsed.header?.showData ?? false,
    slices,
  };
}

function describeDifferences(
  actual: PieMeaning,
  expected: PieMeaning,
): readonly string[] {
  const differences: string[] = [];
  if (actual.title !== expected.title) {
    differences.push(
      `title: expected ${JSON.stringify(expected.title)}, got ${JSON.stringify(actual.title)}`,
    );
  }
  if (actual.showData !== expected.showData) {
    differences.push(
      `showData: expected ${expected.showData}, got ${actual.showData}`,
    );
  }
  if (actual.slices.length !== expected.slices.length) {
    differences.push(
      `slice count: expected ${expected.slices.length}, got ${actual.slices.length}`,
    );
  }
  const shared = Math.min(actual.slices.length, expected.slices.length);
  for (let index = 0; index < shared; index += 1) {
    const got = actual.slices[index] as PieSliceMeaning;
    const want = expected.slices[index] as PieSliceMeaning;
    if (got.label !== want.label) {
      differences.push(
        `slice ${index} label: expected ${JSON.stringify(want.label)}, got ${JSON.stringify(got.label)}`,
      );
    }
    if (!Object.is(got.value, want.value)) {
      differences.push(
        `slice ${index} value: expected ${want.value}, got ${got.value}`,
      );
    }
  }
  return differences;
}

// Compares the meaning of a candidate with what the operation promised. Anything the parse
// could not classify rejects the candidate: an unreadable line might mean anything.
export function checkPieMeaning(
  candidate: ParsedPie,
  expected: PieMeaning,
): DomainResult<void> {
  const editability = pieEditability(candidate);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `candidate ${editability.reason}: ${editability.detail}`,
    );
  }
  const differences = describeDifferences(pieMeaningOf(candidate), expected);
  return differences.length === 0
    ? ok(undefined)
    : err(
        "diagramMeaningMismatch",
        `meaningMismatch: ${differences.join("; ")}`,
      );
}
