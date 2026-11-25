import type { Brand } from "../shared/brand";
import { type DomainResult, err, ok } from "../shared/domain-result";

// Opaque on purpose: the file layout is owned by Rust, so TypeScript must not
// assume anything about it beyond "non-empty".
export type ContentPath = Brand<string, "ContentPath">;

// Content paths are `/`-separated on every platform.
export const CONTENT_PATH_SEPARATOR = "/";

export function parseContentPath(value: string): DomainResult<ContentPath> {
  if (value.length === 0) {
    return err("invalidContentPath", "empty");
  }
  return ok(value as ContentPath);
}

// A file in a directory: never empty, so a ContentPath as it is.
export function joinedContentPath(
  directory: string,
  fileName: string,
): ContentPath {
  return `${directory}${CONTENT_PATH_SEPARATOR}${fileName}` as ContentPath;
}
