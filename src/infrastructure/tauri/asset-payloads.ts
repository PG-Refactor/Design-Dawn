// Decoders for the asset command payloads, in the same two steps as persistence-payloads:
// check the shape, then run the domain parsers.

import { IMAGE_SELECTION_STATUS } from "../../application/ports/asset-types";
import { parseBlockType } from "../../domain/block/block-type";
import { parseContentPath } from "../../domain/block/content-path";
import type { DomainResult } from "../../domain/shared/domain-result";
import type {
  CopiedAsset,
  DropImportResult,
  ImageSelection,
  ImportedImage,
  RejectedFile,
} from "./asset-types";
import {
  type CommandError,
  type CommandResult,
  commandErr,
  commandOk,
  isRustErrorKind,
} from "./command-error";
import {
  arrayOf,
  type Decoded,
  type Decoder,
  decodeNumber,
  decodeString,
  objectOf,
  oneOf,
} from "./payload-decoder";

const PAYLOAD_ROOT = "payload";

interface RawImportedImage {
  readonly contentPath: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly initialWidth: number;
  readonly initialHeight: number;
  readonly blockType: string;
}
interface RawCopiedAsset {
  readonly contentPath: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}
interface RawDropImportResult {
  readonly imported: readonly RawImportedImage[];
  readonly rejected: readonly RejectedFile[];
}

const decodeRustErrorKind: Decoder<CommandError["kind"]> = (value, path) =>
  typeof value === "string" && isRustErrorKind(value)
    ? { ok: true, value }
    : { ok: false, detail: `${path}: expected a Rust error kind` };

const rawImportedImage = objectOf<RawImportedImage>({
  contentPath: decodeString,
  naturalWidth: decodeNumber,
  naturalHeight: decodeNumber,
  initialWidth: decodeNumber,
  initialHeight: decodeNumber,
  blockType: decodeString,
});
const rawRejectedFile = objectOf<RejectedFile>({
  fileName: decodeString,
  error: objectOf<CommandError>({
    kind: decodeRustErrorKind,
    detail: decodeString,
  }),
});
const rawDropImportResult = objectOf<RawDropImportResult>({
  imported: arrayOf(rawImportedImage),
  rejected: arrayOf(rawRejectedFile),
});
const rawCopiedAsset = objectOf<RawCopiedAsset>({
  contentPath: decodeString,
  naturalWidth: decodeNumber,
  naturalHeight: decodeNumber,
});

function decodePayload<T>(
  decoder: Decoder<T>,
  payload: unknown,
): CommandResult<T> {
  const result: Decoded<T> = decoder(payload, PAYLOAD_ROOT);
  return result.ok
    ? commandOk(result.value)
    : commandErr("invalidCommandResponse", result.detail);
}

function fromDomain<T>(result: DomainResult<T>): CommandResult<T> {
  return result.ok
    ? commandOk(result.value)
    : commandErr(result.error.kind, result.error.detail);
}

function toImportedImage(raw: RawImportedImage): CommandResult<ImportedImage> {
  const contentPath = fromDomain(parseContentPath(raw.contentPath));
  if (!contentPath.ok) return contentPath;
  const blockType = fromDomain(parseBlockType(raw.blockType));
  if (!blockType.ok) return blockType;
  return commandOk({
    contentPath: contentPath.value,
    naturalWidth: raw.naturalWidth,
    naturalHeight: raw.naturalHeight,
    initialWidth: raw.initialWidth,
    initialHeight: raw.initialHeight,
    blockType: blockType.value,
  });
}

export function toDropImportResult(
  payload: unknown,
): CommandResult<DropImportResult> {
  const raw = decodePayload(rawDropImportResult, payload);
  if (!raw.ok) return raw;
  const imported: ImportedImage[] = [];
  for (const item of raw.value.imported) {
    const converted = toImportedImage(item);
    if (!converted.ok) return converted;
    imported.push(converted.value);
  }
  return commandOk({ imported, rejected: raw.value.rejected });
}

export function toCopiedAsset(payload: unknown): CommandResult<CopiedAsset> {
  const raw = decodePayload(rawCopiedAsset, payload);
  if (!raw.ok) return raw;
  const contentPath = fromDomain(parseContentPath(raw.value.contentPath));
  return contentPath.ok
    ? commandOk({
        contentPath: contentPath.value,
        naturalWidth: raw.value.naturalWidth,
        naturalHeight: raw.value.naturalHeight,
      })
    : contentPath;
}

const rawImageSelectionStatus = objectOf<{
  readonly status: ImageSelection["status"];
}>({
  status: oneOf(Object.values(IMAGE_SELECTION_STATUS)),
});
const rawSelectedImages = objectOf<{
  readonly dropId: string;
  readonly fileCount: number;
}>({
  dropId: decodeString,
  fileCount: decodeNumber,
});

export function toImageSelection(
  payload: unknown,
): CommandResult<ImageSelection> {
  const status = decodePayload(rawImageSelectionStatus, payload);
  if (!status.ok) return status;
  if (status.value.status === IMAGE_SELECTION_STATUS.cancelled) {
    return commandOk({ status: IMAGE_SELECTION_STATUS.cancelled });
  }
  const selected = decodePayload(rawSelectedImages, payload);
  return selected.ok
    ? commandOk({ status: IMAGE_SELECTION_STATUS.selected, ...selected.value })
    : selected;
}
