// The find boxes' actions: searching the Project, showing a match on its sheet, and
// replacing text in Blocks and captions. Rust searches the files on disk; for the Blocks whose text the
// app holds (a Document open here, possibly with unsaved edits) the app's text is searched
// instead, so what is shown is what a replace would change.

import type { OperationResult } from "../../application/ports/operation-error";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { PersistenceGateway } from "../../application/ports/persistence-gateway";
import type {
  MatchPlace,
  SearchMatch,
  SearchResult,
} from "../../application/ports/search-types";
import type { ApplicationStore } from "../../application/state/application-state";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import { isTextBlockType } from "../../domain/block/block-type";
import {
  DEFAULT_CAPTION_POSITION,
  parseCaption,
} from "../../domain/block/caption";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import {
  findMatches,
  type OccurrenceAt,
  type Replaced,
  replaceAll,
  replaceOccurrence,
} from "../../domain/text-search/text-search";
import type { CanvasActions } from "../canvas/canvas-actions";
import {
  clampViewport,
  DEFAULT_VIEWPORT,
  type Extent,
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
import { createFindStore, type FindStore } from "./find-store";

export interface SearchQueryInput {
  readonly text: string;
  readonly matchCase: boolean;
}

export interface BlockLocation {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
}

export interface ReplaceTarget extends BlockLocation {
  // Where in the Block to replace: its text, its caption or both.
  readonly places: readonly MatchPlace[];
}

export interface ReplaceInput extends SearchQueryInput {
  readonly replacement: string;
  readonly targets: readonly ReplaceTarget[];
}

export interface ReplaceMatchInput extends SearchQueryInput {
  readonly replacement: string;
  readonly location: BlockLocation;
  readonly place: MatchPlace;
  readonly at: OccurrenceAt;
}

export interface ReplaceOutcome {
  readonly replaced: number;
  // Captions left as they were because the result cannot be a caption (too long).
  readonly captionsSkipped: number;
}

export interface RevealOptions {
  // When given, the view moves only if the Block is not wholly inside this area of the
  // canvas (in screen pixels); otherwise the Block goes near the top-left corner.
  readonly keepIfVisibleIn?: Extent;
}

export interface SearchActions {
  // The text of both find boxes (window-local UI state).
  readonly findStore: FindStore;
  search(query: SearchQueryInput): Promise<OperationResult<SearchResult>>;
  // Opens the Document if needed, shows the sheet with the Block in view and selects it.
  revealBlock(
    location: BlockLocation,
    options?: RevealOptions,
  ): Promise<OperationResult<void>>;
  // Replaces every occurrence in the text and / or caption of each Block: one undo step
  // for the text and one for the caption of each Block that changes.
  replaceInBlocks(
    input: ReplaceInput,
  ): Promise<OperationResult<ReplaceOutcome>>;
  // Replaces the one occurrence at `at`, if it is still there.
  replaceMatch(
    input: ReplaceMatchInput,
  ): Promise<OperationResult<ReplaceOutcome>>;
}

export interface SearchActionsDependencies {
  readonly gateway: PersistenceGateway;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: Pick<WorkspaceActions, "openDocument">;
  readonly canvasActions: Pick<
    CanvasActions,
    "loadSheetContents" | "commitContentEdit" | "setBlockCaption"
  >;
  readonly draftRegistry: Pick<DraftRegistry, "commitFor">;
}

const { originMargin } = CANVAS_CONFIG.viewport;

const NOTHING_REPLACED: ReplaceOutcome = { replaced: 0, captionsSkipped: 0 };

function addOutcomes(
  left: ReplaceOutcome,
  right: ReplaceOutcome,
): ReplaceOutcome {
  return {
    replaced: left.replaced + right.replaced,
    captionsSkipped: left.captionsSkipped + right.captionsSkipped,
  };
}

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

  // A draft of the Block would later be committed over the replacement: it is committed
  // first and the edit ends. Then the Block's current text (or caption) is changed.
  async function replaceIn(
    location: BlockLocation,
    place: MatchPlace,
    change: (current: string) => Replaced,
  ): Promise<OperationResult<ReplaceOutcome>> {
    const committed = await draftRegistry.commitFor([location.documentId]);
    if (!committed.ok) return committed;
    uiStateStore.setState((state) =>
      stopEditing(state, location.sheetId, location.blockId),
    );
    const loaded = await ensureLoaded(location);
    if (!loaded.ok) return loaded;
    const document = applicationStore
      .getState()
      .documents.get(location.documentId);
    if (place === "text") {
      const current = document?.contents.get(location.blockId);
      if (current === undefined) return operationOk(NOTHING_REPLACED);
      const replaced = change(current);
      if (replaced.count === 0) return operationOk(NOTHING_REPLACED);
      const edited = await canvasActions.commitContentEdit({
        ...location,
        text: replaced.text,
      });
      if (!edited.ok) return edited;
      return operationOk({ replaced: replaced.count, captionsSkipped: 0 });
    }
    const block = document?.sheets
      .get(location.sheetId)
      ?.blocks.find((candidate) => candidate.blockId === location.blockId);
    if (block?.caption === undefined) return operationOk(NOTHING_REPLACED);
    const replaced = change(block.caption);
    if (replaced.count === 0) return operationOk(NOTHING_REPLACED);
    // An empty result removes the caption (undoable); one that cannot be a caption (too
    // long) is left alone and counted.
    const trimmed = replaced.text.trim();
    if (trimmed !== "" && !parseCaption(trimmed).ok) {
      return operationOk({ replaced: 0, captionsSkipped: 1 });
    }
    const edited = await canvasActions.setBlockCaption({
      ...location,
      text: replaced.text,
      position: block.captionPosition ?? DEFAULT_CAPTION_POSITION,
    });
    if (!edited.ok) return edited;
    return operationOk({ replaced: replaced.count, captionsSkipped: 0 });
  }

  const findStore = createFindStore();

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

    findStore,

    async revealBlock(location, options = {}) {
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
        const area = options.keepIfVisibleIn;
        const left = block.position.x * current.zoom + current.panX;
        const top = block.position.y * current.zoom + current.panY;
        const inView =
          area !== undefined &&
          left >= 0 &&
          top >= 0 &&
          left + block.size.width * current.zoom <= area.width &&
          top + block.size.height * current.zoom <= area.height;
        const viewport = inView
          ? current
          : clampViewport({
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

    async replaceInBlocks({ text, matchCase, replacement, targets }) {
      let outcome = NOTHING_REPLACED;
      for (const target of targets) {
        for (const place of target.places) {
          const replaced = await replaceIn(target, place, (current) =>
            replaceAll(current, text, replacement, matchCase),
          );
          if (!replaced.ok) return replaced;
          outcome = addOutcomes(outcome, replaced.value);
        }
      }
      return operationOk(outcome);
    },

    replaceMatch({ text, matchCase, replacement, location, place, at }) {
      return replaceIn(location, place, (current) =>
        replaceOccurrence(current, text, replacement, matchCase, at),
      );
    },
  };
}
