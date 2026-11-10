// The Search panel's actions: searching the Project, showing a match on its sheet, and
// replacing text in Blocks. Rust searches the files on disk; for the Blocks whose text the
// app holds (a Document open here, possibly with unsaved edits) the app's text is searched
// instead, so what is shown is what a replace would change.

import type { OperationResult } from "../../application/ports/operation-error";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type {
  SearchMatch,
  SearchResult,
} from "../../application/ports/search-types";
import type { ApplicationStore } from "../../application/state/application-state";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import { isTextBlockType } from "../../domain/block/block-type";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { findMatches, replaceAll } from "../../domain/text-search/text-search";
import type { CanvasActions } from "../canvas/canvas-actions";
import {
  clampViewport,
  DEFAULT_VIEWPORT,
} from "../canvas/geometry/viewport-math";
import type { DraftRegistry } from "../workspace/draft-registry";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import {
  selectBlocks,
  setActiveSheet,
  setViewport,
  stopEditing,
  type UiStateStore,
} from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";

export interface SearchQueryInput {
  readonly text: string;
  readonly matchCase: boolean;
}

export interface BlockLocation {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
}

export interface ReplaceInput extends SearchQueryInput {
  readonly replacement: string;
  readonly blocks: readonly BlockLocation[];
}

export interface SearchActions {
  search(query: SearchQueryInput): Promise<OperationResult<SearchResult>>;
  // Opens the Document if needed, shows the sheet with the Block near the top-left corner
  // and selects it.
  revealBlock(location: BlockLocation): Promise<OperationResult<void>>;
  // Replaces every occurrence in the text of each Block (not in captions): one content
  // edit, one undo step, per Block that changes. Returns the number of replacements.
  replaceInBlocks(input: ReplaceInput): Promise<OperationResult<number>>;
}

export interface SearchActionsDependencies {
  readonly gateway: PersistenceGateway;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: Pick<WorkspaceActions, "openDocument">;
  readonly canvasActions: Pick<
    CanvasActions,
    "loadSheetContents" | "commitContentEdit"
  >;
  readonly draftRegistry: Pick<DraftRegistry, "commitFor">;
}

const { originMargin } = CANVAS_CONFIG.viewport;

export function createSearchActions(
  dependencies: SearchActionsDependencies,
): SearchActions {
  const {
    gateway,
    applicationStore,
    uiStateStore,
    actions,
    canvasActions,
    draftRegistry,
  } = dependencies;

  // The app's own text and captions for the Blocks it holds: these replace what Rust read
  // from disk for the same Blocks.
  function overlayOpenDocuments(
    result: SearchResult,
    query: SearchQueryInput,
  ): SearchResult {
    const application = applicationStore.getState();
    const held = new Set<BlockId>();
    const fromApp: SearchMatch[] = [];
    for (const [documentId, document] of application.documents) {
      const documentName =
        application.project?.documents.find(
          (entry) => entry.documentId === documentId,
        )?.name ?? "";
      for (const [sheetId, sheet] of document.sheets) {
        for (const block of sheet.blocks) {
          const text = document.contents.get(block.blockId);
          if (isTextBlockType(block.blockType) && text === undefined) continue;
          held.add(block.blockId);
          const place = {
            documentId,
            documentName,
            sheetId,
            sheetName: sheet.name,
            blockId: block.blockId,
            blockType: block.blockType,
          };
          for (const match of findMatches(
            text ?? "",
            query.text,
            query.matchCase,
          )) {
            fromApp.push({
              ...place,
              place: "text",
              line: match.line,
              excerpt: match.lineText,
              matchStart: match.start,
              matchLength: match.length,
            });
          }
          for (const match of findMatches(
            block.caption ?? "",
            query.text,
            query.matchCase,
          )) {
            fromApp.push({
              ...place,
              place: "caption",
              line: match.line,
              excerpt: match.lineText,
              matchStart: match.start,
              matchLength: match.length,
            });
          }
        }
      }
    }
    if (held.size === 0) return result;
    return {
      ...result,
      matches: [
        ...result.matches.filter((match) => !held.has(match.blockId)),
        ...fromApp,
      ],
    };
  }

  async function ensureLoaded(
    location: BlockLocation,
  ): Promise<OperationResult<void>> {
    const opened = await actions.openDocument(location.documentId);
    if (!opened.ok) return opened;
    return canvasActions.loadSheetContents({
      documentId: location.documentId,
      sheetId: location.sheetId,
    });
  }

  return {
    async search(query) {
      const projectId = applicationStore.getState().project?.projectId ?? null;
      if (projectId === null) {
        return operationErr("projectNotOpen", "no project is open");
      }
      const result = await gateway.searchProject(
        projectId,
        query.text,
        query.matchCase,
      );
      if (!result.ok) {
        uiStateStore.setState((state) =>
          addOperationError(state, "searchProject", null, result.error),
        );
        return result;
      }
      return operationOk(overlayOpenDocuments(result.value, query));
    },

    async revealBlock(location) {
      const opened = await actions.openDocument(location.documentId);
      if (!opened.ok) return opened;
      const sheet = applicationStore
        .getState()
        .documents.get(location.documentId)
        ?.sheets.get(location.sheetId);
      const block = sheet?.blocks.find(
        (candidate) => candidate.blockId === location.blockId,
      );
      if (block === undefined) {
        return operationErr("entityNotFound", "the block is no longer there");
      }
      uiStateStore.setState((state) => {
        const current =
          state.viewportBySheet.get(location.sheetId) ?? DEFAULT_VIEWPORT;
        const viewport = clampViewport({
          panX: originMargin - block.position.x * current.zoom,
          panY: originMargin - block.position.y * current.zoom,
          zoom: current.zoom,
        });
        const shown = setActiveSheet(
          state,
          location.documentId,
          location.sheetId,
        );
        return selectBlocks(
          setViewport(shown, location.sheetId, viewport),
          location.sheetId,
          [location.blockId],
        );
      });
      return operationOk(undefined);
    },

    async replaceInBlocks({ text, matchCase, replacement, blocks }) {
      let count = 0;
      for (const location of blocks) {
        // A draft of this Block would later be committed over the replacement: it is
        // committed first and the edit ends.
        const committed = await draftRegistry.commitFor([location.documentId]);
        if (!committed.ok) return committed;
        uiStateStore.setState((state) =>
          stopEditing(state, location.sheetId, location.blockId),
        );
        const loaded = await ensureLoaded(location);
        if (!loaded.ok) return loaded;
        const current = applicationStore
          .getState()
          .documents.get(location.documentId)
          ?.contents.get(location.blockId);
        if (current === undefined) continue;
        const replaced = replaceAll(current, text, replacement, matchCase);
        if (replaced.count === 0) continue;
        const edited = await canvasActions.commitContentEdit({
          ...location,
          text: replaced.text,
        });
        if (!edited.ok) return edited;
        count += replaced.count;
      }
      return operationOk(count);
    },
  };
}
