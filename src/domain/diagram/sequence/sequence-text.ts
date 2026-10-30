import { type DomainResult, err, ok } from "../../shared/domain-result";
import {
  hasControlCharacter,
  hasMarkupRewrite,
  hasStyleLikeText,
} from "../pie/pie-text";
import {
  SEQUENCE_DIRECTIVE_MARK,
  SEQUENCE_RESERVED_WORDS,
  SEQUENCE_WRAP_PREFIX_PATTERN,
} from "./sequence-config";
import {
  SEQUENCE_DECODE_PATTERN,
  SEQUENCE_DOUBLE_PERCENT,
  SEQUENCE_ENCODE_PATTERN,
  SEQUENCE_ENCODED_CHARACTERS,
  SEQUENCE_ENTITY_LIKE_PATTERN,
  SEQUENCE_GENERATED_ID_FIRST_NUMBER,
  SEQUENCE_GENERATED_ID_PREFIX,
  SEQUENCE_GUI_LINE_BREAK,
  SEQUENCE_HASH,
  SEQUENCE_HASH_ENTITY,
  SEQUENCE_LINE_BREAK_TAG,
  SEQUENCE_MULTILINE_FIELDS,
  SEQUENCE_NEW_ID_PATTERN,
  SEQUENCE_PERCENT_FIELDS,
  SEQUENCE_SEMICOLON,
  SEQUENCE_SEMICOLON_ENTITY,
  type SequenceTextField,
} from "./sequence-operation-config";

// Text rules of the sequence editor. A text is only safe to write if Mermaid reads back
// exactly what was written, so everything that would be rewritten, interpreted or would break
// out of the line is refused instead of altered (docs/architecture.md §16.16.6).

function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

// Turns the text a person wants to see into the text to write, or refuses with a reason.
// Blanks around the text are dropped (Mermaid trims it). `;` and `#` become entities, a line
// break typed in the GUI becomes `<br/>` where the field allows one.
export function encodeSequenceText(
  text: string,
  field: SequenceTextField,
): DomainResult<string> {
  const normalized = text.replace(/\r\n/g, SEQUENCE_GUI_LINE_BREAK).trim();
  const lines = normalized.split(SEQUENCE_GUI_LINE_BREAK);
  if (lines.length > 1 && !SEQUENCE_MULTILINE_FIELDS.has(field)) {
    return refuse("lineBreak", `a ${field} is a single line`);
  }
  if (hasControlCharacter(lines.join(""))) {
    return refuse(
      "controlCharacter",
      "a text cannot hold a tab, carriage return or other control character",
    );
  }
  if (normalized.includes(SEQUENCE_DIRECTIVE_MARK)) {
    return refuse(
      "directive",
      "Mermaid applies %%{ ... }%% wherever it stands, even inside a text",
    );
  }
  if (
    normalized.includes(SEQUENCE_DOUBLE_PERCENT) &&
    !SEQUENCE_PERCENT_FIELDS.has(field)
  ) {
    return refuse(
      "doublePercent",
      `%% in a ${field} was not verified against Mermaid`,
    );
  }
  if (SEQUENCE_WRAP_PREFIX_PATTERN.test(normalized)) {
    return refuse(
      "wrapPrefix",
      "Mermaid takes wrap: / nowrap: / :wrap: at the start of a text as a setting and drops it",
    );
  }
  const encoded = lines
    .map((line) =>
      line.replace(
        SEQUENCE_ENCODE_PATTERN,
        (character) => SEQUENCE_ENCODED_CHARACTERS[character] ?? character,
      ),
    )
    .join(SEQUENCE_LINE_BREAK_TAG);
  if (hasMarkupRewrite(encoded)) {
    return refuse("markup", "Mermaid rewrites the quotes of markup-like text");
  }
  if (hasStyleLikeText(encoded)) {
    return refuse(
      "styleLikeText",
      "Mermaid alters text that looks like a style definition",
    );
  }
  return ok(encoded);
}

// What a person sees for a text as written in the source: the inverse of the encoding, in
// one pass so `#35;59;` stays the literal text `#59;`. A `<br/>` is a line break only where
// the field has them.
export function decodeSequenceText(
  written: string,
  field: SequenceTextField,
): string {
  return written.replace(SEQUENCE_DECODE_PATTERN, (entity) => {
    if (entity === SEQUENCE_SEMICOLON_ENTITY) return SEQUENCE_SEMICOLON;
    if (entity === SEQUENCE_HASH_ENTITY) return SEQUENCE_HASH;
    return SEQUENCE_MULTILINE_FIELDS.has(field)
      ? SEQUENCE_GUI_LINE_BREAK
      : entity;
  });
}

// Why a text that is already written cannot be edited as a whole: it holds entity-like text
// other than the two the editor writes (`#quot;`, `#lt;` ...). Mermaid decodes those when it
// draws, so editing the characters shown would change what is drawn. Null when it can.
export function writtenTextRestriction(written: string): string | null {
  const entities = written.match(SEQUENCE_ENTITY_LIKE_PATTERN) ?? [];
  const foreign = entities.filter(
    (entity) =>
      entity !== SEQUENCE_SEMICOLON_ENTITY && entity !== SEQUENCE_HASH_ENTITY,
  );
  return foreign.length === 0 ? null : "entityLikeText";
}

// Checks an id a caller chose for a new participant. `taken` holds every id already in the
// diagram.
export function validateNewParticipantId(
  id: string,
  taken: ReadonlySet<string>,
): DomainResult<void> {
  if (!SEQUENCE_NEW_ID_PATTERN.test(id)) {
    return refuse(
      "invalidId",
      "use a letter followed by letters, digits or underscores",
    );
  }
  if (SEQUENCE_RESERVED_WORDS.has(id.toLowerCase())) {
    return refuse("reservedId", `${id} is a Mermaid keyword`);
  }
  if (taken.has(id)) {
    return refuse("duplicateId", `${id} is already used in the diagram`);
  }
  return ok(undefined);
}

// `P1`, `P2` ... the first one that nothing uses.
export function generateParticipantId(taken: ReadonlySet<string>): string {
  for (let number = SEQUENCE_GENERATED_ID_FIRST_NUMBER; ; number += 1) {
    const candidate = `${SEQUENCE_GENERATED_ID_PREFIX}${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}
