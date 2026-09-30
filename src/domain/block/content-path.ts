import type { Brand } from "../shared/brand";
import { type DomainResult, err, ok } from "../shared/domain-result";

// Opaque on purpose: the file layout is owned by Rust, so TypeScript must not
// assume anything about it beyond "non-empty".
export type ContentPath = Brand<string, "ContentPath">;

export function parseContentPath(value: string): DomainResult<ContentPath> {
  if (value.length === 0) {
    return err("invalidContentPath", "empty");
  }
  return ok(value as ContentPath);
}
