// The name of the folder a new Project is created in. One path segment that is safe on
// every OS; it may differ from the Project's display name. Mirrors
// `domain/project_folder_name.rs`, which has the final say (this check only lets the
// dialog answer while typing).

import type { Brand } from "../shared/brand";
import { type DomainResult, err, ok } from "../shared/domain-result";

export type ProjectFolderName = Brand<string, "ProjectFolderName">;

// Separators and the characters Windows forbids in names (with ':' that also opens NTFS
// streams); control characters are refused by their code points.
const FORBIDDEN_CHARACTERS: readonly string[] = [...'/\\<>:"|?*'];
const CONTROL_CODE_POINT_MAX = 0x1f;
const DELETE_CODE_POINT = 0x7f;

function isForbidden(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    FORBIDDEN_CHARACTERS.includes(character) ||
    codePoint <= CONTROL_CODE_POINT_MAX ||
    codePoint === DELETE_CODE_POINT
  );
}
const RELATIVE_SEGMENTS: readonly string[] = [".", ".."];
const FORBIDDEN_TRAILING = /[. ]$/u;
// Compared case-insensitively with the part before the first '.'.
const RESERVED_DEVICE_NAMES: readonly string[] = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
];
const DEVICE_NAME_SEPARATOR = ".";

export function parseProjectFolderName(
  value: string,
): DomainResult<ProjectFolderName> {
  if (value.length === 0) return err("invalidFolderName", "empty");
  if (RELATIVE_SEGMENTS.includes(value)) {
    return err("invalidFolderName", "relative segment");
  }
  if ([...value].some(isForbidden)) {
    return err("invalidFolderName", "forbidden character");
  }
  if (FORBIDDEN_TRAILING.test(value)) {
    return err("invalidFolderName", "ends with '.' or a space");
  }
  const stem = value.split(DEVICE_NAME_SEPARATOR)[0] ?? value;
  if (RESERVED_DEVICE_NAMES.includes(stem.toUpperCase())) {
    return err("invalidFolderName", "reserved device name");
  }
  return ok(value as ProjectFolderName);
}
