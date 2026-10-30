import { type DomainResult, err, ok } from "../shared/domain-result";

// One replacement of source text. Coordinates are UTF-16 code unit offsets into the
// original JavaScript string, which is what the app holds and what `String.prototype.slice`
// uses. They never cross the TypeScript / Rust boundary: Rust only receives the finished
// text through writeBlockContent, so no byte or code point offsets exist anywhere else.
// `start === end` is an insertion. `end` is exclusive.
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface AppliedTextEdits {
  readonly text: string;
  // False when there was nothing to do or every edit wrote the text that was already there.
  readonly changed: boolean;
}

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function isInsideSurrogatePair(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return false;
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return (
    before >= HIGH_SURROGATE_MIN &&
    before <= HIGH_SURROGATE_MAX &&
    after >= LOW_SURROGATE_MIN &&
    after <= LOW_SURROGATE_MAX
  );
}

function validateEdit(
  source: string,
  edit: TextEdit,
  position: number,
): DomainResult<void> {
  const label = `edit ${position}`;
  if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
    return err("invalidTextEdit", `${label}: offsets must be integers`);
  }
  if (edit.start < 0 || edit.start > edit.end || edit.end > source.length) {
    return err(
      "invalidTextEdit",
      `${label}: range ${edit.start}-${edit.end} is outside 0-${source.length}`,
    );
  }
  for (const offset of [edit.start, edit.end]) {
    if (isInsideSurrogatePair(source, offset)) {
      return err(
        "invalidTextEdit",
        `${label}: offset ${offset} is inside a surrogate pair`,
      );
    }
  }
  return ok(undefined);
}

// Applies every edit in one pass in the coordinates of `source`, so edits never shift each
// other. Pure and total: bad input returns an error and the caller keeps its source.
// Edits that merely touch are fine (an insertion at the start or end of a replacement);
// overlapping ranges and two insertions at one offset are rejected, because the order of
// the latter would be a rule nobody can see.
export function applyTextEdits(
  source: string,
  edits: readonly TextEdit[],
): DomainResult<AppliedTextEdits> {
  for (const [position, edit] of edits.entries()) {
    const validation = validateEdit(source, edit, position);
    if (!validation.ok) return validation;
  }
  // Ties sort by end so that an insertion comes before a replacement starting at the
  // same offset; the stable sort keeps equal edits in input order.
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] as TextEdit;
    const current = sorted[index] as TextEdit;
    if (
      previous.start === previous.end &&
      current.start === current.end &&
      previous.start === current.start
    ) {
      return err(
        "ambiguousTextEdits",
        `two insertions at offset ${current.start}`,
      );
    }
    if (previous.end > current.start) {
      return err(
        "overlappingTextEdits",
        `range ${previous.start}-${previous.end} overlaps ${current.start}-${current.end}`,
      );
    }
  }
  let text = "";
  let cursor = 0;
  for (const edit of sorted) {
    text += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  text += source.slice(cursor);
  return ok({ text, changed: text !== source });
}
