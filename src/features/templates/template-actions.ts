// "New Sheet from Template": a new sheet (created like any sheet: confirmed by its use, not
// an undo step) and the template's blocks on it in ONE command, which can be undone.

import type { OperationResult } from "../../application/ports/operation-error";
import { operationErr } from "../../application/ports/operation-error";
import type { DisplayLanguage } from "../../config/language-config";
import { BLOCK_TYPE_DEFINITIONS } from "../../domain/block/block-type";
import type { DocumentId } from "../../domain/shared/entity-id";
import type { CanvasActions } from "../canvas/canvas-actions";
import type { UiStateStore } from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";
import { DESIGN_TEMPLATES, type DesignTemplateId } from "./design-templates";

export interface TemplateDependencies {
  readonly actions: Pick<WorkspaceActions, "createSheet">;
  readonly canvasActions: Pick<CanvasActions, "addTextBlocks">;
  readonly uiStateStore: UiStateStore;
}

export async function createSheetFromTemplate(
  dependencies: TemplateDependencies,
  documentId: DocumentId,
  templateId: DesignTemplateId,
  language: DisplayLanguage,
): Promise<OperationResult<void>> {
  const template = DESIGN_TEMPLATES[templateId];
  const created = await dependencies.actions.createSheet(
    documentId,
    template.name[language],
  );
  if (!created.ok) return created;
  // createSheet shows the new sheet: it is the active one now.
  const sheetId = dependencies.uiStateStore
    .getState()
    .activeSheetIdByDocument.get(documentId);
  if (sheetId === undefined) {
    return operationErr("entityNotFound", "the new sheet is not shown");
  }
  return dependencies.canvasActions.addTextBlocks({
    documentId,
    sheetId,
    blocks: template.blocks.map((block) => ({
      blockType:
        block.blockType === "markdown"
          ? BLOCK_TYPE_DEFINITIONS.markdown.identifier
          : BLOCK_TYPE_DEFINITIONS.mermaid.identifier,
      text: block.text[language],
      position: { x: block.x, y: block.y },
      size: { width: block.width, height: block.height },
      ...(block.caption === undefined
        ? {}
        : { caption: block.caption[language] }),
    })),
  });
}
