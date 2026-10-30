import { type DomainResult, err, ok } from "../../shared/domain-result";
import {
  hasControlCharacter,
  hasMarkupRewrite,
  hasStyleLikeText,
} from "../pie/pie-text";
import {
  FLOWCHART_DIRECTIVE_MARK,
  FLOWCHART_MARKDOWN_QUOTE,
  FLOWCHART_RESERVED_IDS,
  FLOWCHART_STRING_QUOTE,
} from "./flowchart-config";
import {
  FLOWCHART_AMBIGUOUS_NEW_IDS,
  FLOWCHART_GENERATED_ID_FIRST_NUMBER,
  FLOWCHART_GENERATED_ID_PREFIX,
  FLOWCHART_LABEL_DECODE_PATTERN,
  FLOWCHART_LABEL_ENTITY_PATTERNS,
  FLOWCHART_LABEL_GREATER_THAN_ENTITY,
  FLOWCHART_LABEL_GUI_LINE_BREAK,
  FLOWCHART_LABEL_LESS_THAN_ENTITY,
  FLOWCHART_LABEL_LINE_BREAK_TAG,
  FLOWCHART_NEW_ID_PATTERN,
} from "./flowchart-operation-config";

// Text rules of the flowchart editor. A label is only safe to write if Mermaid reads back
// exactly what was written, so everything that would be rewritten, interpreted or would
// break out of the line is refused instead of altered.

const LESS_THAN = "<";
const GREATER_THAN = ">";
const BACKSLASH = "\\";

function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

// Turns the text a person wants to see into the text to write between double quotes, or
// refuses with a reason. `<` and `>` become `#lt;` and `#gt;` (entities Mermaid decodes when
// it draws), a line break typed in the GUI becomes `<br/>`.
export function encodeFlowchartLabel(text: string): DomainResult<string> {
  if (text.trim() === "") {
    return refuse("emptyLabel", "a label needs some text");
  }
  if (text !== text.trim()) {
    return refuse(
      "labelNotTrimmed",
      "Mermaid trims a label, so leading or trailing blanks would be lost",
    );
  }
  if (text.includes(FLOWCHART_STRING_QUOTE)) {
    return refuse(
      "doubleQuote",
      "a double quote cannot be written inside a quoted label",
    );
  }
  const withoutGuiLineBreaks = text
    .split(FLOWCHART_LABEL_GUI_LINE_BREAK)
    .join("");
  if (hasControlCharacter(withoutGuiLineBreaks)) {
    return refuse(
      "controlCharacter",
      "a label cannot hold a tab, carriage return or other control character",
    );
  }
  if (text.includes(FLOWCHART_MARKDOWN_QUOTE)) {
    return refuse(
      "backtick",
      "a backtick starts a markdown label, which the editor does not write",
    );
  }
  if (text.includes(BACKSLASH)) {
    return refuse(
      "backslash",
      "a backslash in a label was not verified against Mermaid",
    );
  }
  if (text.includes(FLOWCHART_DIRECTIVE_MARK)) {
    return refuse(
      "directive",
      "Mermaid removes %%{ ... }%% even inside a label",
    );
  }
  if (FLOWCHART_LABEL_ENTITY_PATTERNS.some((pattern) => pattern.test(text))) {
    return refuse(
      "entityLikeText",
      "text such as #35; or &amp; is read as an entity, not as written",
    );
  }
  const encoded = text
    .split(LESS_THAN)
    .join(FLOWCHART_LABEL_LESS_THAN_ENTITY)
    .split(GREATER_THAN)
    .join(FLOWCHART_LABEL_GREATER_THAN_ENTITY)
    .split(FLOWCHART_LABEL_GUI_LINE_BREAK)
    .join(FLOWCHART_LABEL_LINE_BREAK_TAG);
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

// What a person sees for a label as written in the source: the inverse of the encoding
// above, applied in one pass so `#lt;br/#gt;` stays literal text and does not become a
// line break. `<br>` forms a person wrote by hand become line breaks too.
export function decodeFlowchartLabel(written: string): string {
  return written.replace(FLOWCHART_LABEL_DECODE_PATTERN, (entity) => {
    if (entity === FLOWCHART_LABEL_LESS_THAN_ENTITY) return LESS_THAN;
    if (entity === FLOWCHART_LABEL_GREATER_THAN_ENTITY) return GREATER_THAN;
    return FLOWCHART_LABEL_GUI_LINE_BREAK;
  });
}

// Checks an id a caller chose for a new node. `taken` holds every name already in use by a
// node, a subgraph or an edge (automatic ids included): a duplicate would silently redefine
// the node, and a subgraph or edge id would create a node that is not meant.
export function validateNewNodeId(
  id: string,
  taken: ReadonlySet<string>,
): DomainResult<void> {
  if (!FLOWCHART_NEW_ID_PATTERN.test(id)) {
    return refuse(
      "invalidId",
      "use a letter followed by letters, digits or underscores",
    );
  }
  if (FLOWCHART_RESERVED_IDS.has(id)) {
    return refuse("reservedId", `${id} is a Mermaid keyword`);
  }
  if (FLOWCHART_AMBIGUOUS_NEW_IDS.has(id)) {
    return refuse(
      "ambiguousId",
      `a single ${id} next to a link is read as part of the link`,
    );
  }
  if (taken.has(id)) {
    return refuse("duplicateId", `${id} is already used in the diagram`);
  }
  return ok(undefined);
}

// `N1`, `N2` ... the first one that nothing uses.
export function generateNodeId(
  taken: ReadonlySet<string>,
  prefix: string = FLOWCHART_GENERATED_ID_PREFIX,
): string {
  for (let number = FLOWCHART_GENERATED_ID_FIRST_NUMBER; ; number += 1) {
    const candidate = `${prefix}${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}
