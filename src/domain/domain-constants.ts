// Single source of truth for domain limits and supported versions in TypeScript.
// Rust mirrors these in src-tauri/src/domain/constants.rs; shared fixtures
// (fixtures/domain/) keep the two in sync.

export const INT32_MIN = -2_147_483_648;
export const INT32_MAX = 2_147_483_647;

export const DISPLAY_NAME_MAX_CODE_POINTS = 200;

export const POSITION_MIN = INT32_MIN;
export const POSITION_MAX = INT32_MAX;
export const SIZE_MIN = 1;
export const SIZE_MAX = INT32_MAX;

export const MIN_SCHEMA_VERSION = 1;

export const SCHEMA_ENTITY_KINDS = ["project", "document", "sheet"] as const;
export type SchemaEntityKind = (typeof SCHEMA_ENTITY_KINDS)[number];

export const CURRENT_SCHEMA_VERSIONS: Readonly<
  Record<SchemaEntityKind, number>
> = {
  project: 1,
  document: 1,
  sheet: 1,
};

// UUIDv7 in canonical lowercase hyphenated form; variant bits are 10xx (8, 9, a, b).
export const ENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Inclusive code point ranges rejected in display names (C0, DEL, C1, line/paragraph separators).
export const DISPLAY_NAME_FORBIDDEN_CODE_POINT_RANGES: readonly (readonly [
  number,
  number,
])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x2028, 0x2029],
];

// Matches strings made only of Unicode White_Space characters.
export const WHITESPACE_ONLY_PATTERN = /^\p{White_Space}+$/u;

// Lone surrogates cannot be encoded as UTF-8 and would corrupt saved JSON.
export const SURROGATE_CODE_UNIT_MIN = 0xd800;
export const SURROGATE_CODE_UNIT_MAX = 0xdfff;
