import {
  type DiagramOperation,
  planDiagramOperation,
} from "../../domain/diagram/diagram-operation";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import type { DomainResult } from "../../domain/shared/domain-result";
import { normalizeLineEndings } from "../commands/text-content";

// The text a GUI operation would give the block, without applying it: the same plan,
// edits and meaning check as `applyValidatedDiagramOperation` (Mermaid's own drawing is
// left to whoever shows the result). Used to preview an add before it is made.
export function previewDiagramOperation(
  source: string,
  operation: DiagramOperation,
): DomainResult<string> {
  const plan = planDiagramOperation(source, operation);
  if (!plan.ok) return plan;
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) return applied;
  const candidate = normalizeLineEndings(applied.value.text);
  const verified = plan.value.verify(candidate);
  if (!verified.ok) return verified;
  return { ok: true, value: candidate };
}
