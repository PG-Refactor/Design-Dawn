import {
  type DiagramOperation,
  type DiagramOperationPlan,
  planDiagramOperation,
} from "../../domain/diagram/diagram-operation";
import { applyTextEdits, type TextEdit } from "../../domain/diagram/text-edit";
import { type DomainResult, ok } from "../../domain/shared/domain-result";
import { normalizeLineEndings } from "../commands/text-content";

export interface DiagramCandidate {
  readonly edits: readonly TextEdit[];
  // The text the block would have, in the form it is stored (LF line endings).
  readonly text: string;
  readonly changed: boolean;
}

export type DiagramPlanner = (
  source: string,
  operation: DiagramOperation,
) => DomainResult<DiagramOperationPlan>;

// Plans a GUI operation, applies its edits and proves the result: the text is checked in
// the form it will be stored, since saving rewrites CRLF to LF. An operation that changes
// nothing has nothing to prove.
export function diagramCandidate(
  source: string,
  operation: DiagramOperation,
  plan: DiagramPlanner = planDiagramOperation,
): DomainResult<DiagramCandidate> {
  const planned = plan(source, operation);
  if (!planned.ok) return planned;
  const { edits, verify } = planned.value;
  const applied = applyTextEdits(source, edits);
  if (!applied.ok) return applied;
  const text = normalizeLineEndings(applied.value.text);
  if (!applied.value.changed) return ok({ edits, text, changed: false });
  const verified = verify(text);
  if (!verified.ok) return verified;
  return ok({ edits, text, changed: true });
}
