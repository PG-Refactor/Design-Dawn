// Syntax and policy values of the pie editor. Every one of them was checked against
// Mermaid 12.3.0; nothing here is a guess about newer versions.

export const PIE_HEADER_KEYWORD = "pie";
export const PIE_SHOW_DATA_KEYWORD = "showData";
export const PIE_TITLE_KEYWORD = "title";

// The only quote a generated label uses. Mermaid also accepts single quotes, which are read
// but never written.
export const PIE_LABEL_QUOTE = '"';
// Mermaid decodes this entity when it draws the label, so it is the way to write a double
// quote inside a double-quoted label (a backslash escape is refused instead, see
// pie-text.ts).
export const PIE_QUOTE_ENTITY = "#quot;";
export const PIE_VALUE_SEPARATOR = " : ";

export const PIE_COMMENT_MARK = "%%";
// Mermaid removes `%%{ ... }%%` from anywhere in the text before it reads the diagram, even
// inside a quoted label, and applies it as configuration.
export const PIE_DIRECTIVE_MARK = "%%{";

export const PIE_DEFAULT_INDENT = "  ";
export const PIE_DEFAULT_LINE_ENDING = "\n";
