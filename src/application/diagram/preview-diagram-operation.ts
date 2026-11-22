import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import { type DomainResult, mapOk } from "../../domain/shared/domain-result";
import { diagramCandidate } from "./diagram-candidate";

// The text a GUI operation would give the block, without applying it: the same plan,
// edits and meaning check as `applyValidatedDiagramOperation` (Mermaid's own drawing is
// left to whoever shows the result). Used to preview an add before it is made.
export function previewDiagramOperation(
  source: string,
  operation: DiagramOperation,
): DomainResult<string> {
  return mapOk(
    diagramCandidate(source, operation),
    (candidate) => candidate.text,
  );
}
