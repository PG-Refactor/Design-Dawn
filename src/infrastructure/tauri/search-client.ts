// The Project search command. Rust reads every text Block and caption from disk.

import type {
  SearchMatch,
  SearchResult,
} from "../../application/ports/search-types";
import { MATCH_PLACES } from "../../application/ports/search-types";
import { parseBlockType } from "../../domain/block/block-type";
import {
  type ProjectId,
  parseBlockId,
  parseDocumentId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import { call } from "./invoke-command";
import {
  arrayOf,
  decodeBoolean,
  decodeNumber,
  decodeString,
  objectOf,
  oneOf,
} from "./payload-decoder";

interface RawMatch {
  readonly documentId: string;
  readonly documentName: string;
  readonly sheetId: string;
  readonly sheetName: string;
  readonly blockId: string;
  readonly blockType: string;
  readonly place: SearchMatch["place"];
  readonly line: number;
  readonly excerpt: string;
  readonly matchStart: number;
  readonly matchLength: number;
}

const rawMatch = objectOf<RawMatch>({
  documentId: decodeString,
  documentName: decodeString,
  sheetId: decodeString,
  sheetName: decodeString,
  blockId: decodeString,
  blockType: decodeString,
  place: oneOf(MATCH_PLACES),
  line: decodeNumber,
  excerpt: decodeString,
  matchStart: decodeNumber,
  matchLength: decodeNumber,
});

const rawResult = objectOf<{
  readonly matches: readonly RawMatch[];
  readonly truncated: boolean;
  readonly unreadableBlocks: number;
}>({
  matches: arrayOf(rawMatch),
  truncated: decodeBoolean,
  unreadableBlocks: decodeNumber,
});

const PAYLOAD_ROOT = "$";

function toMatch(raw: RawMatch): CommandResult<SearchMatch> {
  const documentId = parseDocumentId(raw.documentId);
  const sheetId = parseSheetId(raw.sheetId);
  const blockId = parseBlockId(raw.blockId);
  const blockType = parseBlockType(raw.blockType);
  if (!documentId.ok) return commandErr("invalidCommandResponse", "documentId");
  if (!sheetId.ok) return commandErr("invalidCommandResponse", "sheetId");
  if (!blockId.ok) return commandErr("invalidCommandResponse", "blockId");
  if (!blockType.ok) return commandErr("invalidCommandResponse", "blockType");
  return commandOk({
    ...raw,
    documentId: documentId.value,
    sheetId: sheetId.value,
    blockId: blockId.value,
    blockType: blockType.value,
  });
}

export function toSearchResult(payload: unknown): CommandResult<SearchResult> {
  const decoded = rawResult(payload, PAYLOAD_ROOT);
  if (!decoded.ok) return commandErr("invalidCommandResponse", decoded.detail);
  const matches: SearchMatch[] = [];
  for (const raw of decoded.value.matches) {
    const converted = toMatch(raw);
    if (!converted.ok) return converted;
    matches.push(converted.value);
  }
  return commandOk({
    matches,
    truncated: decoded.value.truncated,
    unreadableBlocks: decoded.value.unreadableBlocks,
  });
}

export function searchProject(
  projectId: ProjectId,
  text: string,
  matchCase: boolean,
  regex: boolean,
): Promise<CommandResult<SearchResult>> {
  return call(
    COMMANDS.searchProject,
    { projectId, text, matchCase, regex },
    toSearchResult,
  );
}
