// Loads fixtures/mermaid-gui/sources.json (see its README). Test support only.
import type { DiagramType } from "./diagram-type";

export interface MermaidGuiFixtureCase {
  readonly id: string;
  readonly group: "edgeCase" | "knownFailure";
  readonly diagram: DiagramType;
  readonly source: string;
  readonly mermaidParses: boolean;
  readonly note: string;
  readonly futureBehaviour?: string;
}

interface MermaidGuiFixtureFile {
  readonly fixtureVersion: number;
  readonly subject: string;
  readonly cases: readonly MermaidGuiFixtureCase[];
}

const fixtureFiles = import.meta.glob("/fixtures/mermaid-gui/sources.json", {
  import: "default",
  eager: true,
}) as Record<string, MermaidGuiFixtureFile>;

export const MERMAID_GUI_FIXTURE_VERSION = 1;

export function loadMermaidGuiFixtures(): readonly MermaidGuiFixtureCase[] {
  const file = Object.values(fixtureFiles)[0];
  if (file === undefined) throw new Error("mermaid-gui fixtures not found");
  if (file.fixtureVersion !== MERMAID_GUI_FIXTURE_VERSION) {
    throw new Error(`unsupported fixture version ${file.fixtureVersion}`);
  }
  return file.cases;
}
