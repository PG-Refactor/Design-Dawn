import { isTextBlockType } from "../../domain/block/block-type";
import { err } from "../../domain/shared/domain-result";
import type { BlockId, SheetId } from "../../domain/shared/entity-id";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { MetadataCommand } from "./command";
import { COMMAND_KINDS } from "./command-kind";
import {
  commandNotApplied,
  type DocumentData,
  findSheet,
  withContents,
} from "./document-data";
import { normalizeLineEndings } from "./text-content";

export interface EditBlockContentRequest {
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  readonly text: string;
}

// Replaces the loaded text of one text block. Typing never reaches this command: the UI
// commits an edit (for example on blur), which is one undo step. Persistence is the
// auto-save's job; the command only changes the in-memory text.
// `restored`: the text an earlier run captured, for a command rebuilt from its snapshot.
export function editBlockContentCommand(
  request: EditBlockContentRequest,
  restored: string | null = null,
): MetadataCommand {
  const { sheetId, blockId } = request;
  const nextText = normalizeLineEndings(request.text);
  let previousText: string | null = restored;

  // Text can only be replaced when it was read first: writing over content that was
  // never loaded (or failed to load) could destroy the file.
  function loadedText(state: DocumentData): OperationResult<string> {
    const sheet = findSheet(state, sheetId);
    if (!sheet.ok) return sheet;
    const block = sheet.value.blocks.find(
      (candidate) => candidate.blockId === blockId,
    );
    if (block === undefined) {
      return err("entityNotFound", `block not found: ${blockId}`);
    }
    if (!isTextBlockType(block.blockType)) {
      return err(
        "unsupportedBlockType",
        `blocks of type ${block.blockType} have no text content`,
      );
    }
    const text = state.contents.get(blockId);
    if (text === undefined) {
      return operationErr(
        "notWritable",
        `content of block ${blockId} is not loaded`,
      );
    }
    return operationOk(text);
  }

  function replaceText(
    state: DocumentData,
    text: string,
  ): OperationResult<DocumentData> {
    const current = loadedText(state);
    if (!current.ok) return current;
    return operationOk(withContents(state, [[blockId, text]]));
  }

  return {
    category: "metadata",
    kind: COMMAND_KINDS.editBlockContent,
    snapshot: () => ({
      kind: COMMAND_KINDS.editBlockContent,
      sheetId,
      blockId,
      text: nextText,
      previousText,
    }),
    apply(state) {
      const current = loadedText(state);
      if (!current.ok) return current;
      if (current.value === nextText) return operationOk(state);
      previousText ??= current.value;
      return replaceText(state, nextText);
    },
    revert: (state) =>
      previousText === null
        ? commandNotApplied()
        : replaceText(state, previousText),
  };
}
