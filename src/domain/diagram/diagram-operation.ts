import type { DomainResult } from "../shared/domain-result";
import {
  type FlowchartOperation,
  planFlowchartOperation,
  verifyFlowchartCandidate,
} from "./flowchart/flowchart-operations";
import {
  type PieOperation,
  planPieOperation,
  verifyPieCandidate,
} from "./pie/pie-operations";
import {
  planSequenceOperation,
  type SequenceOperation,
  verifySequenceCandidate,
} from "./sequence/sequence-operations";
import type { TextEdit } from "./text-edit";

// One GUI operation on a diagram, named by the type it belongs to. Each later editor adds
// a member; the application layer only sees this union and `planDiagramOperation`.
export type DiagramOperation =
  | {
      readonly diagram: "pie";
      readonly operation: PieOperation;
    }
  | {
      readonly diagram: "flowchart";
      readonly operation: FlowchartOperation;
    }
  | {
      readonly diagram: "sequence";
      readonly operation: SequenceOperation;
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
  switch (request.diagram) {
    case "pie": {
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
    case "flowchart": {
      const plan = planFlowchartOperation(source, request.operation);
      if (!plan.ok) return plan;
      const { edits, expected } = plan.value;
      return {
        ok: true,
        value: {
          edits,
          verify: (candidateSource) =>
            verifyFlowchartCandidate(candidateSource, expected),
        },
      };
    }
    case "sequence": {
      const plan = planSequenceOperation(source, request.operation);
      if (!plan.ok) return plan;
      const { edits, expected } = plan.value;
      return {
        ok: true,
        value: {
          edits,
          verify: (candidateSource) =>
            verifySequenceCandidate(candidateSource, expected),
        },
      };
    }
  }
}
