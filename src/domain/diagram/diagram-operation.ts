import type { DomainResult } from "../shared/domain-result";
import {
  type PieOperation,
  planPieOperation,
  verifyPieCandidate,
} from "./pie/pie-operations";
import type { TextEdit } from "./text-edit";

// One GUI operation on a diagram, named by the type it belongs to. Each later editor adds
// a member; the application layer only sees this union and `planDiagramOperation`.
export type DiagramOperation = {
  readonly diagram: "pie";
  readonly operation: PieOperation;
};

export interface DiagramOperationPlan {
  readonly edits: readonly TextEdit[];
  // Proves the text the edits produce: it must be readable by the type's editor and have
  // exactly the meaning the operation promised.
  readonly verify: (candidateSource: string) => DomainResult<void>;
}

export function planDiagramOperation(
  source: string,
  request: DiagramOperation,
): DomainResult<DiagramOperationPlan> {
  const plan = planPieOperation(source, request.operation);
  if (!plan.ok) return plan;
  const { edits, expected } = plan.value;
  return {
    ok: true,
    value: {
      edits,
      verify: (candidateSource) =>
        verifyPieCandidate(candidateSource, expected),
    },
  };
}
