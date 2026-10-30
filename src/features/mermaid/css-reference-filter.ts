// Removes CSS that can load something from outside the image. It is
// a small tokenizer following the CSS Syntax Level 3 rules that matter here (comments,
// strings, escapes, function and url tokens, bracket nesting), not a regex, because a
// pattern cannot tell a ")" inside a quoted string from the end of url(...), and CSS
// escapes can spell any name ("u\72l(").
//
// Policy: a declaration (or rule prelude) that contains a rejected token is removed whole;
// everything else is kept byte-identical. Any syntax problem makes the whole input
// rejected (`null`), so malformed CSS never passes in a form a browser might read
// differently from this code. Pure string code: no DOM.

// Functions that fetch an image or element from somewhere. Compared after decoding
// escapes and lower-casing.
const DENIED_FUNCTIONS: ReadonlySet<string> = new Set([
  "image",
  "image-set",
  "-webkit-image-set",
  "cross-fade",
  "-webkit-cross-fade",
  "element",
  "-moz-element",
  "src",
]);

const URL_FUNCTION_NAME = "url";

// At-rules that load or declare external resources; dropped with their whole body.
const DROPPED_AT_RULES: ReadonlySet<string> = new Set([
  "import",
  "font-face",
  "namespace",
]);

// At-rules whose block holds declarations; every other block at-rule (@media, @keyframes,
// @supports, ...) holds rules and is filtered recursively.
const DECLARATION_BLOCK_AT_RULES: ReadonlySet<string> = new Set([
  "page",
  "property",
  "counter-style",
  "font-palette-values",
  "viewport",
  "position-try",
]);

// A url() is allowed only when it points at an element of the same document: "#" and a
// plain id. Anything else (a scheme, a path, "(", quotes, whitespace) is rejected.
const INTERNAL_FRAGMENT_PATTERN = /^#[A-Za-z0-9_:.-]+$/;

const REPLACEMENT_CHARACTER = "�";
const MAX_HEX_ESCAPE_DIGITS = 6;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;
const NON_ASCII_START = 0x80;
const HEX_RADIX = 16;

type TokenType =
  | "whitespace"
  | "comment"
  | "ident"
  | "function"
  | "at"
  | "hash"
  | "string"
  | "url"
  | "number"
  | "delim"
  | "("
  | ")"
  | "["
  | "]"
  | "{"
  | "}"
  | ";"
  | ":"
  | ",";

interface Token {
  readonly type: TokenType;
  readonly start: number;
  readonly end: number;
  // Escapes decoded: the function / at-keyword name, string content or url target.
  readonly value: string;
}

class CssSyntaxError extends Error {}

function isWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f"
  );
}

function isNewline(character: string | undefined): boolean {
  return character === "\n" || character === "\r" || character === "\f";
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isHexDigit(character: string | undefined): boolean {
  return (
    character !== undefined &&
    (isDigit(character) ||
      (character >= "a" && character <= "f") ||
      (character >= "A" && character <= "F"))
  );
}

function isNameStart(character: string | undefined): boolean {
  if (character === undefined) return false;
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "_" ||
    character.charCodeAt(0) >= NON_ASCII_START
  );
}

function isNameCharacter(character: string | undefined): boolean {
  return isNameStart(character) || isDigit(character) || character === "-";
}

function isNonPrintable(character: string): boolean {
  const code = character.charCodeAt(0);
  // Includes "\u000B" and DEL, per the CSS Syntax spec's "non-printable code point".
  return (
    (code >= 0 && code <= 0x08) ||
    code === 0x0b ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
}

// `\` followed by a newline is not an escape.
function startsEscape(source: string, index: number): boolean {
  return (
    source[index] === "\\" &&
    index + 1 < source.length &&
    !isNewline(source[index + 1])
  );
}

function startsIdent(source: string, index: number): boolean {
  const character = source[index];
  if (character === "-") {
    const next = source[index + 1];
    return isNameStart(next) || next === "-" || startsEscape(source, index + 1);
  }
  return isNameStart(character) || startsEscape(source, index);
}

// `index` points at the backslash and `startsEscape` held.
function consumeEscape(
  source: string,
  index: number,
): { readonly text: string; readonly next: number } {
  let position = index + 1;
  if (!isHexDigit(source[position])) {
    const codePoint = source.codePointAt(position);
    if (codePoint === undefined) throw new CssSyntaxError("escape at end");
    const text = String.fromCodePoint(codePoint);
    return { text, next: position + text.length };
  }
  let digits = "";
  while (
    digits.length < MAX_HEX_ESCAPE_DIGITS &&
    isHexDigit(source[position])
  ) {
    digits += source[position];
    position += 1;
  }
  // One whitespace character ends the escape and belongs to it ("\r\n" counts as one).
  if (isWhitespace(source[position])) {
    position +=
      source[position] === "\r" && source[position + 1] === "\n" ? 2 : 1;
  }
  const codePoint = Number.parseInt(digits, HEX_RADIX);
  const invalid =
    codePoint === 0 ||
    codePoint > MAX_CODE_POINT ||
    (codePoint >= SURROGATE_START && codePoint <= SURROGATE_END);
  return {
    text: invalid ? REPLACEMENT_CHARACTER : String.fromCodePoint(codePoint),
    next: position,
  };
}

function consumeName(
  source: string,
  index: number,
): { readonly value: string; readonly next: number } {
  let value = "";
  let position = index;
  while (position < source.length) {
    const character = source[position];
    if (isNameCharacter(character)) {
      value += character;
      position += 1;
    } else if (startsEscape(source, position)) {
      const decoded = consumeEscape(source, position);
      value += decoded.text;
      position = decoded.next;
    } else {
      break;
    }
  }
  return { value, next: position };
}

function consumeString(
  source: string,
  index: number,
): { readonly value: string; readonly next: number } {
  const quote = source[index];
  let value = "";
  let position = index + 1;
  for (;;) {
    const character = source[position];
    if (character === undefined)
      throw new CssSyntaxError("unterminated string");
    if (character === quote) return { value, next: position + 1 };
    // A raw newline ends a string in error ("bad string").
    if (isNewline(character)) throw new CssSyntaxError("newline in string");
    if (character === "\\") {
      const next = source[position + 1];
      if (next === undefined) throw new CssSyntaxError("unterminated string");
      if (isNewline(next)) {
        // An escaped newline is a line continuation and adds nothing.
        position += next === "\r" && source[position + 2] === "\n" ? 3 : 2;
        continue;
      }
      const decoded = consumeEscape(source, position);
      value += decoded.text;
      position = decoded.next;
      continue;
    }
    value += character;
    position += 1;
  }
}

// The target of an unquoted url(...). Whitespace is allowed only around it; a quote, "(",
// a control character or a stray backslash makes it a "bad url", which is rejected.
function consumeUrlToken(
  source: string,
  index: number,
): { readonly value: string; readonly next: number } {
  let position = index;
  while (isWhitespace(source[position])) position += 1;
  let value = "";
  for (;;) {
    const character = source[position];
    if (character === undefined) throw new CssSyntaxError("unterminated url");
    if (character === ")") return { value, next: position + 1 };
    if (isWhitespace(character)) {
      while (isWhitespace(source[position])) position += 1;
      if (source[position] === ")") return { value, next: position + 1 };
      throw new CssSyntaxError("bad url");
    }
    if (
      character === '"' ||
      character === "'" ||
      character === "(" ||
      isNonPrintable(character)
    ) {
      throw new CssSyntaxError("bad url");
    }
    if (character === "\\") {
      if (!startsEscape(source, position)) throw new CssSyntaxError("bad url");
      const decoded = consumeEscape(source, position);
      value += decoded.text;
      position = decoded.next;
      continue;
    }
    value += character;
    position += 1;
  }
}

function startsNumber(source: string, index: number): boolean {
  const character = source[index];
  if (isDigit(character)) return true;
  if (character === ".") return isDigit(source[index + 1]);
  if (character === "+" || character === "-") {
    return (
      isDigit(source[index + 1]) ||
      (source[index + 1] === "." && isDigit(source[index + 2]))
    );
  }
  return false;
}

// Numbers and their units are one token, so "1url(" is a dimension followed by "(", not
// a url function.
function consumeNumber(source: string, index: number): number {
  let position = index;
  if (source[position] === "+" || source[position] === "-") position += 1;
  while (isDigit(source[position])) position += 1;
  if (source[position] === "." && isDigit(source[position + 1])) {
    position += 1;
    while (isDigit(source[position])) position += 1;
  }
  const exponentSign = source[position + 1];
  if (
    (source[position] === "e" || source[position] === "E") &&
    (isDigit(exponentSign) ||
      ((exponentSign === "+" || exponentSign === "-") &&
        isDigit(source[position + 2])))
  ) {
    position += 2;
    while (isDigit(source[position])) position += 1;
  }
  if (startsIdent(source, position)) return consumeName(source, position).next;
  if (source[position] === "%") return position + 1;
  return position;
}

const SINGLE_CHARACTER_TOKENS: ReadonlySet<string> = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ";",
  ":",
  ",",
]);

function tokenizeNext(source: string, index: number): Token {
  const character = source[index] as string;
  if (isWhitespace(character)) {
    let position = index;
    while (isWhitespace(source[position])) position += 1;
    return { type: "whitespace", start: index, end: position, value: "" };
  }
  if (character === "/" && source[index + 1] === "*") {
    const close = source.indexOf("*/", index + 2);
    if (close === -1) throw new CssSyntaxError("unterminated comment");
    return { type: "comment", start: index, end: close + 2, value: "" };
  }
  if (character === '"' || character === "'") {
    const string = consumeString(source, index);
    return {
      type: "string",
      start: index,
      end: string.next,
      value: string.value,
    };
  }
  if (character === "#") {
    const next = source[index + 1];
    if (isNameCharacter(next) || startsEscape(source, index + 1)) {
      const name = consumeName(source, index + 1);
      return { type: "hash", start: index, end: name.next, value: name.value };
    }
    return { type: "delim", start: index, end: index + 1, value: character };
  }
  if (startsNumber(source, index)) {
    return {
      type: "number",
      start: index,
      end: consumeNumber(source, index),
      value: "",
    };
  }
  if (character === "@" && startsIdent(source, index + 1)) {
    const name = consumeName(source, index + 1);
    return { type: "at", start: index, end: name.next, value: name.value };
  }
  if (startsIdent(source, index)) {
    const name = consumeName(source, index);
    if (source[name.next] !== "(") {
      return { type: "ident", start: index, end: name.next, value: name.value };
    }
    const afterParenthesis = name.next + 1;
    if (name.value.toLowerCase() === URL_FUNCTION_NAME) {
      let probe = afterParenthesis;
      while (isWhitespace(source[probe])) probe += 1;
      // url( followed by a quote is an ordinary function whose argument is a string;
      // anything else is one url token that runs to the closing ")".
      if (source[probe] !== '"' && source[probe] !== "'") {
        const target = consumeUrlToken(source, afterParenthesis);
        return {
          type: "url",
          start: index,
          end: target.next,
          value: target.value,
        };
      }
    }
    return {
      type: "function",
      start: index,
      end: afterParenthesis,
      value: name.value,
    };
  }
  if (SINGLE_CHARACTER_TOKENS.has(character)) {
    return {
      type: character as TokenType,
      start: index,
      end: index + 1,
      value: character,
    };
  }
  return { type: "delim", start: index, end: index + 1, value: character };
}

const CLOSER_FOR: Readonly<Partial<Record<TokenType, TokenType>>> = {
  function: ")",
  "(": ")",
  "[": "]",
  "{": "}",
};

// Throws for anything a browser might read differently from this code: unterminated
// comments, strings and urls, and unbalanced brackets.
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const expectedClosers: TokenType[] = [];
  let position = 0;
  while (position < source.length) {
    const token = tokenizeNext(source, position);
    tokens.push(token);
    position = token.end;
    const closer = CLOSER_FOR[token.type];
    if (closer !== undefined) {
      expectedClosers.push(closer);
    } else if (token.type === ")" || token.type === "]" || token.type === "}") {
      if (expectedClosers.pop() !== token.type) {
        throw new CssSyntaxError("unbalanced bracket");
      }
    }
  }
  if (expectedClosers.length > 0) throw new CssSyntaxError("unclosed bracket");
  return tokens;
}

function isAllowedUrlTarget(target: string): boolean {
  return INTERNAL_FRAGMENT_PATTERN.test(target.trim());
}

function isIgnorable(token: Token | undefined): boolean {
  return token?.type === "whitespace" || token?.type === "comment";
}

// Whether tokens[from, to) hold anything the policy rejects.
function hasRejectedToken(tokens: Token[], from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    const token = tokens[index] as Token;
    if (token.type === "url") {
      if (!isAllowedUrlTarget(token.value)) return true;
    } else if (token.type === "function") {
      const name = token.value.toLowerCase();
      if (DENIED_FUNCTIONS.has(name)) return true;
      if (name === URL_FUNCTION_NAME) {
        // url( + string + ")" : the only quoted shape accepted.
        let cursor = index + 1;
        while (cursor < to && isIgnorable(tokens[cursor])) cursor += 1;
        const argument = tokens[cursor];
        if (
          argument?.type !== "string" ||
          !isAllowedUrlTarget(argument.value)
        ) {
          return true;
        }
        cursor += 1;
        while (cursor < to && isIgnorable(tokens[cursor])) cursor += 1;
        if (tokens[cursor]?.type !== ")") return true;
        index = cursor;
      }
    } else if (
      token.type === "at" &&
      DROPPED_AT_RULES.has(token.value.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

function opensBracket(token: Token): boolean {
  return CLOSER_FOR[token.type] !== undefined;
}

function closesBracket(token: Token): boolean {
  return token.type === ")" || token.type === "]" || token.type === "}";
}

function filterDeclarationTokens(source: string, tokens: Token[]): string {
  let output = "";
  let segmentStartIndex = 0;
  let segmentStartOffset = 0;
  let depth = 0;
  const flush = (endIndex: number, endOffset: number): void => {
    if (!hasRejectedToken(tokens, segmentStartIndex, endIndex)) {
      output += source.slice(segmentStartOffset, endOffset);
    }
    segmentStartIndex = endIndex;
    segmentStartOffset = endOffset;
  };
  tokens.forEach((token, index) => {
    if (opensBracket(token)) depth += 1;
    else if (closesBracket(token)) depth -= 1;
    else if (token.type === ";" && depth === 0) flush(index + 1, token.end);
  });
  flush(tokens.length, source.length);
  return output;
}

// Index of the first top-level token of `type` at or after `from`, or -1.
function findTopLevel(
  tokens: Token[],
  from: number,
  types: readonly TokenType[],
): number {
  let depth = 0;
  for (let index = from; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    if (depth === 0 && types.includes(token.type)) return index;
    if (opensBracket(token)) depth += 1;
    else if (closesBracket(token)) depth -= 1;
  }
  return -1;
}

// `open` is a "{" token; the matching "}" exists because `tokenize` checked the nesting.
function findMatchingBrace(tokens: Token[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    if (opensBracket(token)) depth += 1;
    else if (closesBracket(token)) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new CssSyntaxError("unclosed block");
}

function filterStylesheetTokens(source: string, tokens: Token[]): string {
  let output = "";
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as Token;
    if (isIgnorable(token) || token.type === ";") {
      output += source.slice(token.start, token.end);
      index += 1;
      continue;
    }
    const atRuleName = token.type === "at" ? token.value.toLowerCase() : null;
    const blockIndex = findTopLevel(
      tokens,
      index,
      atRuleName === null ? ["{"] : ["{", ";"],
    );
    if (blockIndex === -1) {
      // A statement at-rule may end at the end of the input; a qualified rule without a
      // block is invalid and dropped.
      if (
        atRuleName !== null &&
        !hasRejectedToken(tokens, index, tokens.length) &&
        !DROPPED_AT_RULES.has(atRuleName)
      ) {
        output += source.slice(token.start);
      }
      break;
    }
    const terminator = tokens[blockIndex] as Token;
    if (terminator.type === ";") {
      const rejected =
        (atRuleName !== null && DROPPED_AT_RULES.has(atRuleName)) ||
        hasRejectedToken(tokens, index, blockIndex);
      if (!rejected) output += source.slice(token.start, terminator.end);
      index = blockIndex + 1;
      continue;
    }
    const closeIndex = findMatchingBrace(tokens, blockIndex);
    const rejected =
      (atRuleName !== null && DROPPED_AT_RULES.has(atRuleName)) ||
      hasRejectedToken(tokens, index, blockIndex);
    if (!rejected) {
      const inner = source.slice(
        terminator.end,
        (tokens[closeIndex] as Token).start,
      );
      const filteredInner =
        atRuleName !== null && !DECLARATION_BLOCK_AT_RULES.has(atRuleName)
          ? filterStylesheetTokens(inner, tokenize(inner))
          : filterDeclarationTokens(inner, tokenize(inner));
      output += `${source.slice(token.start, terminator.end)}${filteredInner}${source.slice((tokens[closeIndex] as Token).start, (tokens[closeIndex] as Token).end)}`;
    }
    index = closeIndex + 1;
  }
  return output;
}

// `null` stands for "rejected as a whole": the caller removes the attribute or empties
// the <style>. Catching everything (not only CssSyntaxError) keeps an unexpected failure
// from escaping the sanitiser as an exception that something else might swallow.
function attempt(work: () => string): string | null {
  try {
    return work();
  } catch {
    return null;
  }
}

// The content of a <style> element.
export function filterStylesheet(css: string): string | null {
  return attempt(() => filterStylesheetTokens(css, tokenize(css)));
}

// The value of a style attribute (declarations separated by ";").
export function filterDeclarationList(css: string): string | null {
  return attempt(() => filterDeclarationTokens(css, tokenize(css)));
}

// The value of a presentation attribute such as fill or marker-end: all or nothing.
export function isReferenceSafeValue(value: string): boolean {
  return (
    attempt(() => {
      const tokens = tokenize(value);
      return hasRejectedToken(tokens, 0, tokens.length) ? "" : "ok";
    }) === "ok"
  );
}
