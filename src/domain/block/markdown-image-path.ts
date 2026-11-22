// Where a Markdown image may point: an asset of the same Document, written as a path
// relative to the Markdown file itself (`../../../assets/diagram.png` from
// `sheets/<sheet>/blocks/`). That is the form GitHub and other editors resolve too, so the
// file shows the picture outside the app as well. Anything else (a URL, an absolute path,
// a path that leaves the Document, a file outside `assets/`) is not an image the app shows.

import {
  CONTENT_PATH_SEPARATOR,
  type ContentPath,
  joinedContentPath,
} from "./content-path";

// Must match `ASSETS_DIRECTORY_NAME` on the Rust side, which owns the file format and
// validates every asset path again before reading it.
export const DOCUMENT_ASSETS_DIRECTORY = "assets";

const PATH_SEPARATOR = CONTENT_PATH_SEPARATOR;
const CURRENT_SEGMENT = ".";
const PARENT_SEGMENT = "..";
// A scheme (`https:`, `file:`, `C:`) means the destination is not a relative path.
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// A query or fragment has no meaning for a file on disk; such a destination is refused
// rather than half-understood.
const UNSUPPORTED_CHARACTERS = /[\\?#]/;

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function directoryOf(documentRelativePath: string): string[] {
  const segments = documentRelativePath.split(PATH_SEPARATOR);
  return segments.slice(0, -1);
}

// The Document-relative path (`assets/<file>`) of an image destination written in the
// Markdown file at `markdownContentPath`, or null when the destination is not one.
// Percent-encoding is decoded per segment, so `my%20diagram.png` and `my diagram.png`
// name the same file.
export function resolveMarkdownImagePath(
  markdownContentPath: string,
  destination: string,
): ContentPath | null {
  const trimmed = destination.trim();
  if (
    trimmed.length === 0 ||
    SCHEME_PATTERN.test(trimmed) ||
    trimmed.startsWith(PATH_SEPARATOR) ||
    UNSUPPORTED_CHARACTERS.test(trimmed)
  ) {
    return null;
  }
  const resolved = directoryOf(markdownContentPath);
  for (const rawSegment of trimmed.split(PATH_SEPARATOR)) {
    const segment = decodeSegment(rawSegment);
    if (segment === null || segment.length === 0) return null;
    // A decoded separator would smuggle a second segment past the checks below.
    if (segment.includes(PATH_SEPARATOR) || segment.includes("\\")) return null;
    // `%2E%2E` is not a way to write `..` here: a dot segment must be written plainly.
    const isDotSegment =
      segment === CURRENT_SEGMENT || segment === PARENT_SEGMENT;
    if (isDotSegment && rawSegment !== segment) return null;
    if (segment === CURRENT_SEGMENT) continue;
    if (segment === PARENT_SEGMENT) {
      // Leaving the Document root is never allowed, even to come back into it.
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const [directory, fileName, ...rest] = resolved;
  if (
    directory !== DOCUMENT_ASSETS_DIRECTORY ||
    fileName === undefined ||
    rest.length > 0
  ) {
    return null;
  }
  return joinedContentPath(DOCUMENT_ASSETS_DIRECTORY, fileName);
}

const EXTENSION_SEPARATOR = ".";
// Characters that would end or nest the alt text of `![alt](...)`.
const ALT_TEXT_ESCAPES = /[\\[\]]/g;

// The Markdown that shows the asset at `assetContentPath` from the file at
// `markdownContentPath`: `![<file name without extension>](<relative path>)`.
export function markdownImageReference(
  markdownContentPath: string,
  assetContentPath: string,
): string {
  const fileName = assetContentPath.slice(
    assetContentPath.lastIndexOf(PATH_SEPARATOR) + 1,
  );
  const dot = fileName.lastIndexOf(EXTENSION_SEPARATOR);
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const altText = stem.replace(
    ALT_TEXT_ESCAPES,
    (character) => `\\${character}`,
  );
  return `![${altText}](${markdownImageDestination(markdownContentPath, assetContentPath)})`;
}

// The destination to write into a Markdown file at `markdownContentPath` for the asset at
// `assetContentPath` (`assets/<file>`): the relative form `resolveMarkdownImagePath` reads
// back. Spaces and the characters Markdown would misread are percent-encoded, the rest is
// kept readable.
export function markdownImageDestination(
  markdownContentPath: string,
  assetContentPath: string,
): string {
  const depth = directoryOf(markdownContentPath).length;
  const upward = Array.from({ length: depth }, () => PARENT_SEGMENT);
  const encoded = assetContentPath
    .split(PATH_SEPARATOR)
    .map(encodeDestinationSegment);
  return [...upward, ...encoded].join(PATH_SEPARATOR);
}

// Only what would end or break a Markdown link destination: whitespace, parentheses, angle
// brackets and `%` itself (so decoding gives the name back). Letters of any script stay as
// they are, which keeps the source readable.
const DESTINATION_ESCAPES = /[\s()<>%[\]]/gu;

const ASCII_LIMIT = 0x80;
const HEX_RADIX = 16;
const HEX_BYTE_DIGITS = 2;

// `encodeURIComponent` leaves `(` and `)` alone, so ASCII characters are escaped by hand;
// other whitespace (an ideographic space) is UTF-8 encoded by it.
function percentEncode(character: string): string {
  // A character outside ASCII starts with a code unit above it (a surrogate included).
  const codePoint = character.charCodeAt(0);
  return codePoint < ASCII_LIMIT
    ? `%${codePoint.toString(HEX_RADIX).toUpperCase().padStart(HEX_BYTE_DIGITS, "0")}`
    : encodeURIComponent(character);
}

function encodeDestinationSegment(segment: string): string {
  return segment.replace(DESTINATION_ESCAPES, percentEncode);
}
