// TEST ONLY. Reads what Mermaid 12.3.0 itself holds after reading a pie chart, through its
// internal diagram API (`mermaid.mermaidAPI.getDiagramFromText(...).db`). That API is not
// public and may change with the library version; nothing in the app uses it. It is the
// independent reference the domain's PieMeaning is compared against.
import mermaid from "mermaid";
import type { PieMeaning } from "../../../domain/diagram/pie/pie-meaning";

interface MermaidPieDb {
  getSections(): Map<string, number>;
  getDiagramTitle(): string;
  getShowData(): boolean;
}

// Mermaid replaces `#name;` / `#123;` with private markers before parsing and decodes them
// when it draws; the db still holds the markers. Mapping them back gives the written form.
const NUMERIC_MARKER = /ﬂ°°(\d+)¶ß/g;
const NAMED_MARKER = /ﬂ°(\w+)¶ß/g;

export function decodeMermaidMarkers(text: string): string {
  return text.replace(NUMERIC_MARKER, "#$1;").replace(NAMED_MARKER, "#$1;");
}

export type MermaidPieReading =
  | { readonly accepted: true; readonly meaning: PieMeaning }
  | { readonly accepted: false; readonly message: string };

export async function readPieWithMermaid(
  source: string,
): Promise<MermaidPieReading> {
  try {
    // Registers the diagram types on first use, as the app's own parse path does.
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    const db = diagram.db as unknown as MermaidPieDb;
    return {
      accepted: true,
      meaning: {
        title: decodeMermaidMarkers(db.getDiagramTitle()),
        showData: db.getShowData(),
        slices: [...db.getSections().entries()].map(([label, value]) => ({
          label: decodeMermaidMarkers(label),
          value: value + 0,
        })),
      },
    };
  } catch (error) {
    return {
      accepted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
