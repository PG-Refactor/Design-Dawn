import { type DomainResult, mapOk } from "../shared/domain-result";
import {
  type FlowchartOperation,
  planFlowchartOperation,
  verifyFlowchartCandidate,
} from "./flowchart/flowchart-operations";
import {
  type GanttOperation,
  planGanttOperation,
  verifyGanttCandidate,
} from "./gantt/gantt-operations";
import {
  type ClassOperation,
  planClassOperation,
  verifyClassCandidate,
} from "./listed/class-diagram";
import {
  type ErOperation,
  planErOperation,
  verifyErCandidate,
} from "./listed/er-diagram";
import {
  planStateOperation,
  type StateOperation,
  verifyStateCandidate,
} from "./listed/state-diagram";
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
    }
  | {
      readonly diagram: "gantt";
      readonly operation: GanttOperation;
    }
  | { readonly diagram: "er"; readonly operation: ErOperation }
  | { readonly diagram: "state"; readonly operation: StateOperation }
  | { readonly diagram: "class"; readonly operation: ClassOperation };

export interface DiagramOperationPlan {
  readonly edits: readonly TextEdit[];
  // Proves the text the edits produce: it must be readable by the type's editor and have
  // exactly the meaning the operation promised.
  readonly verify: (candidateSource: string) => DomainResult<void>;
}

// A type's plan with the check of its promise for the candidate text.
function withVerify<Meaning>(
  plan: DomainResult<{
    readonly edits: readonly TextEdit[];
    readonly expected: Meaning;
  }>,
  verify: (candidateSource: string, expected: Meaning) => DomainResult<void>,
): DomainResult<DiagramOperationPlan> {
  return mapOk(plan, ({ edits, expected }) => ({
    edits,
    verify: (candidateSource) => verify(candidateSource, expected),
  }));
}

export function planDiagramOperation(
  source: string,
  request: DiagramOperation,
): DomainResult<DiagramOperationPlan> {
  switch (request.diagram) {
    case "pie":
      return withVerify(
        planPieOperation(source, request.operation),
        verifyPieCandidate,
      );
    case "flowchart":
      return withVerify(
        planFlowchartOperation(source, request.operation),
        verifyFlowchartCandidate,
      );
    case "gantt":
      return withVerify(
        planGanttOperation(source, request.operation),
        verifyGanttCandidate,
      );
    case "er":
      return withVerify(
        planErOperation(source, request.operation),
        verifyErCandidate,
      );
    case "state":
      return withVerify(
        planStateOperation(source, request.operation),
        verifyStateCandidate,
      );
    case "class":
      return withVerify(
        planClassOperation(source, request.operation),
        verifyClassCandidate,
      );
    case "sequence":
      return withVerify(
        planSequenceOperation(source, request.operation),
        verifySequenceCandidate,
      );
  }
}
