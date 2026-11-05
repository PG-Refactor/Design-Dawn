// @vitest-environment jsdom
// Evidence for the flowchart reader: how mermaid 12.3.0 reads flowcharts, and which of
// those inputs the domain (src/domain/diagram/flowchart/) calls editable. Each case names a
// fact; the test name states the evidence. jsdom cannot lay text out, so
// "draws" means the real renderer and the SVG sanitiser accept it, not how it looks.
import { beforeAll, describe, expect, it } from "vitest";
import { flowchartEditability } from "../../domain/diagram/flowchart/flowchart-editability";
import { readFlowchart } from "../../domain/diagram/flowchart/flowchart-reader";
import type { FlowchartOpaqueReason } from "../../domain/diagram/flowchart/flowchart-types";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import {
  comparableOf,
  firstDifference,
} from "./test-support/flowchart-meaning-comparison";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { readFlowchartWithMermaid } from "./test-support/mermaid-flowchart-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

interface GrammarCase {
  readonly name: string;
  readonly source: string;
  // Does mermaid 12.3.0 accept the text?
  readonly mermaid: boolean;
  // Does the domain call it editable? (false for an accepted input = "recognised, not
  // editable" or "refused", stated on purpose.)
  readonly editable: boolean;
  // The editability reason, when not editable.
  readonly reason?: string;
  // The reason of the first opaque statement, when the reason is unsupportedStatements.
  readonly opaque?: FlowchartOpaqueReason;
  // An accepted input that the renderer cannot draw (only the ellipse, which is refused
  // with undrawableShape for that reason).
  readonly draws?: false;
}

const FLOWCHART = "flowchart TD\n";
const f = (body: string): string => `${FLOWCHART}${body}\n`;

// An editable, accepted case.
const good = (name: string, source: string): GrammarCase => ({
  name,
  source,
  mermaid: true,
  editable: true,
});
// Accepted by mermaid, refused by the reader as an opaque statement.
const opaque = (
  name: string,
  source: string,
  reason: FlowchartOpaqueReason,
): GrammarCase => ({
  name,
  source,
  mermaid: true,
  editable: false,
  reason: "unsupportedStatements",
  opaque: reason,
});
// Rejected by mermaid; the reader must not call it editable. With a reason, the reader also
// has to name the construct (as an opaque statement) instead of just saying no.
const bad = (
  name: string,
  source: string,
  opaqueReason?: FlowchartOpaqueReason,
): GrammarCase =>
  opaqueReason === undefined
    ? { name, source, mermaid: false, editable: false }
    : {
        name,
        source,
        mermaid: false,
        editable: false,
        reason: "unsupportedStatements",
        opaque: opaqueReason,
      };
// Accepted by mermaid, refused with a whole-text reason.
const refused = (
  name: string,
  source: string,
  reason: string,
): GrammarCase => ({ name, source, mermaid: true, editable: false, reason });

function edgesProgram(count: number): string {
  const lines = Array.from(
    { length: count },
    (_value, index) => `N${index}-->N${index + 1}`,
  );
  return `flowchart LR\n${lines.join("\n")}\n`;
}

// A valid flowchart of exactly `length` UTF-16 code units. The padding is the value of one
// classDef style: Mermaid counts it for its size limit (comments would not count, it removes
// them first), and an unused class costs nothing to draw.
function sourceOfLength(length: number): string {
  const frame = "flowchart TD\nA-->B\nclassDef k font-family:";
  const lineFeed = "\n";
  return `${frame}${"x".repeat(length - frame.length - lineFeed.length)}${lineFeed}`;
}

const CASES: readonly GrammarCase[] = [
  // ---- headers and directions
  good("header: flowchart TD", f("A-->B")),
  good("header: flowchart LR", "flowchart LR\nA-->B\n"),
  good("header: flowchart RL", "flowchart RL\nA-->B\n"),
  good("header: flowchart BT", "flowchart BT\nA-->B\n"),
  good("header: flowchart TB", "flowchart TB\nA-->B\n"),
  good("header: graph TD", "graph TD\nA-->B\n"),
  good("header: graph without direction", "graph\nA-->B\n"),
  good("header: flowchart without direction", "flowchart\nA-->B\n"),
  good("header: direction then ;", "flowchart TD;\nA-->B\n"),
  good("header: statements after the ; on the header line", "graph TD;A-->B\n"),
  good(
    "header: statements after '; ' on the header line",
    "graph TD; A-->B;\n",
  ),
  good("header: several blanks and a tab", "graph \t TD\nA-->B\n"),
  good("header: trailing blanks", "graph TD  \nA-->B\n"),
  good("header: indented", "  flowchart TD\nA-->B\n"),
  bad("header: statement after the direction without ;", "graph TD A-->B\n"),
  bad("header: ; after a blank", "graph TD ;A-->B\n"),
  bad("header: ; without a direction", "graph;A-->B\n"),
  bad("header: comment after the direction", "graph TD %% c\nA-->B\n"),
  bad("header: keyword is case sensitive", "Flowchart TD\nA-->B\n"),
  bad("header: direction is case sensitive", "flowchart td\nA-->B\n"),
  opaque("header: symbol direction >", "graph >\nA-->B\n", "unsupportedHeader"),
  opaque("header: symbol direction v", "graph v\nA-->B\n", "unsupportedHeader"),
  opaque(
    "header: flowchart-elk is refused",
    "flowchart-elk TD\nA-->B\n",
    "unsupportedHeader",
  ),
  refused(
    "header: swimlane-beta is another type",
    "swimlane-beta TD\nA-->B\n",
    "notFlowchart",
  ),
  opaque(
    "direction: top-level direction is ignored by mermaid and refused",
    f("direction LR\nA-->B"),
    "topLevelDirection",
  ),
  // ---- ids and reserved words
  good("id: letters digits underscore", f("a_1-->B2")),
  good("id: digits only", f("1-->2")),
  good("id: dash and dot between characters", f("a-b-->c.d")),
  good("id: Japanese kanji", f("日本-->語")),
  good("id: hiragana", f("ひらがな-->B")),
  good("id: katakana with the long vowel mark", f("カタカナー-->B")),
  good("id: hangul", f("한국어-->B")),
  good("id: ends with x or o and touches a link", f("Ax-->Bo")),
  good("id: box touches a link", f("box---B")),
  good("id: begins with a keyword but continues", f("endA-->Aend")),
  good("id: keywords are case sensitive", f("End-->STYLE")),
  good("id: begins with style but continues", f("style1-->class2")),
  good("id: x and o as separate words", f("A --- oB\nx --> o")),
  good("id: v is an ordinary id", f("v-->t")),
  opaque("id: colon", f("A:B-->C"), "unsupportedId"),
  opaque("id: slash", f("a/b-->c"), "unsupportedId"),
  opaque("id: percent", f("A%B-->C"), "unsupportedId"),
  opaque("id: accented Latin", f("é-->B"), "unsupportedId"),
  opaque("id: Cyrillic", f("Привет-->B"), "unsupportedId"),
  opaque("id: default is legal but refused", f("default-->B"), "reservedId"),
  opaque(
    "id: direction is legal but refused",
    f("direction --> B"),
    "unsupportedDirection",
  ),
  opaque("id: accTitle is legal but refused", f("accTitle-->B"), "reservedId"),
  bad("id: end is reserved", f("A-->end")),
  bad("id: graph is reserved", f("A-->graph")),
  bad("id: subgraph is reserved", f("A-->subgraph")),
  bad("id: keyword then dash", f("end-x-->B")),
  bad("id: a lone x glued to a link", f("A --> x-->B")),
  bad("id: a lone o glued to a link", f("A --> o-->B")),
  bad(
    "id: a lone x at the start glued to a link",
    f("x-->B"),
    "ambiguousLinkBoundary",
  ),
  // ---- shapes
  good("shape: square", f("A[text]")),
  good("shape: round", f("A(text)")),
  good("shape: stadium", f("A([text])")),
  good("shape: subroutine", f("A[[text]]")),
  good("shape: cylinder", f("A[(text)]")),
  good("shape: circle", f("A((text))")),
  good("shape: doublecircle", f("A(((text)))")),
  good("shape: odd", f("A>text]")),
  good("shape: diamond", f("A{text}")),
  good("shape: hexagon", f("A{{text}}")),
  good("shape: lean_right", f("A[/text/]")),
  good("shape: lean_left", f("A[\\text\\]")),
  good("shape: trapezoid", f("A[/text\\]")),
  good("shape: inv_trapezoid", f("A[\\text/]")),
  {
    ...refused(
      "shape: ellipse parses but cannot be drawn",
      f("A(-text-)"),
      "undrawableShape",
    ),
    draws: false,
  },
  opaque("shape: props form", f("A[|borders:lt|text]"), "propsShape"),
  bad("shape: a space before the bracket", f("A [text]")),
  good("shape: a shape on both ends of an edge", f("A[a] --> B{b}")),
  good("shape: redefinition overrides type and text", f("A[a]\nA(b)")),
  // ---- labels
  good("label: unquoted with spaces", f("A[hello world]")),
  good("label: quoted with brackets and pipe", f('A["a (b) [c] {d} | e"]')),
  good("label: quoted with a semicolon", f('A["a; b"] --> B')),
  good("label: quoted with at sign", f('A["a@b"]')),
  good("label: quoted with %% (not a comment)", f('A["50 %% off"]')),
  good("label: Japanese", f("A[日本語のラベル]")),
  good("label: emoji", f('A["😀 ok"]')),
  good("label: padded quoted text is trimmed", f('A["  x  "]')),
  good("label: blank unquoted text", f("A[ ]")),
  good("label: blank quoted text", f('A[" "]')),
  good("label: markdown string", f('A["`**bold** text`"]')),
  good("label: padded markdown string", f('A["`  md  `"]')),
  good("label: <br/> is kept as written", f('A["a<br/>b"]')),
  good("label: lt and gt entities", f('A["x #lt; y #gt; z"]')),
  good("label: entity-like text inside a label", f('A["#quot;"]')),
  good(
    "label: syntax words inside a string",
    f('A["end"] --> B["subgraph x"]'),
  ),
  good("label: arrow inside a string", f('A["a --> b"]')),
  good("label: statement words inside a string", f('A["linkStyle 0 x"]')),
  good("label: quoted unicode and slashes", f('A["日本/語 \\ ok"]')),
  bad("label: unquoted with parentheses", f("A[a (b)]")),
  bad("label: unquoted with a quote", f('A[say "hi"]')),
  bad("label: empty brackets", f("A[]")),
  bad("label: empty quotes", f('A[""]')),
  opaque(
    "label: backtick outside the markdown form",
    f("A[`x`]"),
    "backtickInLabel",
  ),
  opaque(
    "label: quote cannot be escaped",
    f('A["say \\"hi\\""]'),
    "unterminatedBracket",
  ),
  opaque(
    "label: raw newline inside quotes",
    f('A["a\nb"]'),
    "unterminatedQuote",
  ),
  bad("label: unterminated bracket", f("A[abc"), "unterminatedBracket"),
  bad("label: unterminated quote", f('A["abc'), "unterminatedQuote"),
  refused(
    "label: %%{ inside a label is a directive",
    f('A["x %%{init: {}}%% y"]'),
    "inlineDirective",
  ),
  // ---- @{} blocks
  good("at: shape only", f("A@{ shape: cyl }")),
  good("at: shape and label", f('A@{ shape: doc, label: "Report" }')),
  good(
    "at: label as text",
    f('A@{ shape: rect, label: "plain", labelType: text }'),
  ),
  good("at: label only", f('A@{ label: "Only label" }')),
  good(
    "at: before an edge",
    f('A@{ shape: cyl } --> B@{ shape: doc, label: "R" }'),
  ),
  good(
    "at: merges with an earlier definition",
    f('A[old]\nA@{ label: "new" }'),
  ),
  bad("at: unknown shape", f("A@{ shape: nosuchshape }"), "unknownShape"),
  bad("at: legacy shape name", f("A@{ shape: square }"), "unknownShape"),
  opaque(
    "at: another key",
    f('A@{ icon: "fa:user", label: "u" }'),
    "atBlockUnsupportedKey",
  ),
  opaque(
    "at: escaped quote in a label (YAML escape)",
    f('A@{ label: "say \\"hi\\"" }'),
    "atBlockEscape",
  ),
  bad("at: escape in a string", f('A@{ label: "a\\"b" }'), "unterminatedQuote"),
  opaque(
    "at: single quoted value",
    f("A@{ label: 'x' }"),
    "atBlockUnsupportedValue",
  ),
  opaque(
    "at: unquoted label value",
    f("A@{ label: x y }"),
    "atBlockUnsupportedValue",
  ),
  opaque(
    "at: multi-line block",
    f("A@{\n  shape: cyl\n}"),
    "unterminatedAtBlock",
  ),
  bad("at: duplicate key", f("A@{ shape: cyl, shape: doc }")),
  opaque("at: empty block", f("A@{ }"), "atBlockMalformed"),
  bad(
    "at: class operator after the block",
    f("A@{ shape: cyl }:::c"),
    "invalidLink",
  ),
  // ---- edges
  good("edge: arrow", f("A-->B")),
  good("edge: open", f("A---B")),
  good("edge: dotted arrow", f("A-.->B")),
  good("edge: dotted open", f("A-.-B")),
  good("edge: thick arrow", f("A==>B")),
  good("edge: thick open", f("A===B")),
  good("edge: circle end", f("A--oB")),
  good("edge: cross end", f("A--xB")),
  good("edge: both ends arrow", f("A<-->B")),
  good("edge: both ends circle", f("A o--o B")),
  good("edge: both ends cross", f("A x--x B")),
  good("edge: invisible", f("A~~~B")),
  good("edge: longer arrow", f("A--->B")),
  good("edge: longer dotted", f("A-..->B")),
  good("edge: longer thick", f("A====>B")),
  good("edge: very long arrow is capped", f("A------------->B")),
  good("edge: glued circle end versus a node named oB", f("A---oB")),
  good("edge: separated from a node named oB", f("A --- oB")),
  good("edge: pipe label", f("A-->|yes|B")),
  good("edge: pipe label with blanks", f("A --> |yes| B")),
  good("edge: quoted pipe label with a pipe", f('A-->|"a | b"|B')),
  good("edge: pipe label with a semicolon", f("A-->|a;b|B")),
  good("edge: pipe label on an invisible link", f("A~~~|x|B")),
  good("edge: inline label", f("A -- text --> B")),
  good("edge: inline label dotted", f("A -. text .-> B")),
  good("edge: inline label thick", f("A == text ==> B")),
  good("edge: inline label with a quoted arrow", f('A -- "a --> b" --> B')),
  good("edge: inline label on a circle end", f("A -- text --o B")),
  good("edge: padded quoted pipe label", f('A-->|"  y  "|B')),
  good("edge: chain", f("A --> B --> C")),
  good(
    "edge: chain with mixed links and labels",
    f("A -->|x| B -.-> C == y ==> D"),
  ),
  good("edge: ampersand lists", f("A & B --> C & D")),
  good("edge: ampersand after an arrow", f("A --> B & C --> D")),
  good("edge: a node statement of an ampersand list", f("A & B")),
  bad("edge: ampersand needs blanks", f("A &B & C")),
  opaque(
    "edge: glued ampersand is part of the id",
    f("A&B-->C"),
    "unsupportedId",
  ),
  bad("edge: node after a node without a link", f("A B")),
  bad("edge: link without a target", f("A -->")),
  bad("edge: start and end of an inline label disagree", f("A -- t ==> B")),
  bad(
    "edge: an inline label with a double dash is refused",
    f("A -- a -- b --> B"),
    "specialCharsInLabel",
  ),
  good(
    "edge: multiple edges between the same nodes",
    f("A-->B\nA-->B\nA-.->B"),
  ),
  good("edge: self loop", f("A-->A")),
  // ---- implicit nodes and statements
  good("node: bare mention", f("A")),
  good("node: implicit nodes from an edge", f("A-->B-->C")),
  good("node: defined later than first used", f("A-->B\nB[Later]")),
  good("statements: several on one line", f("A-->B; C-->D")),
  good("statements: doubled and trailing separators", f("A-->B;;;C;")),
  good("statements: leading separator", f(";A-->B")),
  good("statements: tabs and blanks around", f("\tA --> B  ;\t C\t")),
  good("statements: blank lines and indentation", f("\n   A-->B\n\n\t\tC\n")),
  good("statements: no final newline", `${FLOWCHART}A-->B`),
  good("statements: CRLF", "flowchart TD\r\nA-->B\r\nB-->C\r\n"),
  // ---- comments, directives, front matter
  good("comment: whole line", f("%% comment\nA-->B")),
  good("comment: indented", f("   %% comment\nA-->B")),
  good("comment: before the header", "%% top\nflowchart TD\nA-->B\n"),
  bad("comment: trailing comment is a syntax error", f("A-->B %% c")),
  opaque(
    "comment: a bare %% is read as a node",
    f("%%\nA-->B"),
    "bareCommentMark",
  ),
  good("comment: %% followed by blanks is a comment", f("%%   \nA-->B")),
  good(
    "directive: a pure directive line",
    '%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart TD\nA-->B\n',
  ),
  refused(
    "directive: inline after a statement",
    f('A-->B %%{init: {"theme": "dark"}}%%'),
    "inlineDirective",
  ),
  refused(
    "directive: inline on the header line",
    'flowchart TD %%{init: {"theme": "dark"}}%%\nA-->B\n',
    "inlineDirective",
  ),
  refused(
    "directive: over several lines",
    '%%{init: {\n"theme": "dark"}}%%\nflowchart TD\nA-->B\n',
    "structureIssue",
  ),
  good(
    "front matter: title and config",
    "---\ntitle: T\nconfig:\n  layout: dagre\n---\nflowchart TD\nA-->B\n",
  ),
  bad("front matter: unterminated", "---\ntitle: T\nflowchart TD\nA-->B\n"),
  // ---- accessibility
  good("acc: accTitle line", f("accTitle: Title text\nA-->B")),
  good("acc: accDescr line", f("accDescr: Some description\nA-->B")),
  good("acc: after a statement on the same line", f("A-->B; accDescr: x")),
  opaque(
    "acc: text with a semicolon",
    f("accTitle: a;b\nA-->B"),
    "unsupportedAccessibility",
  ),
  opaque(
    "acc: block form",
    f("accDescr {\n  text\n}\nA-->B"),
    "unsupportedAccessibility",
  ),
  // ---- subgraphs
  good("subgraph: id only", f("subgraph S\n  A-->B\nend")),
  good("subgraph: id with a title", f("subgraph S [Title]\n  A\nend")),
  good(
    "subgraph: id with a quoted title",
    f('subgraph S ["Quoted (x)"]\n  A\nend'),
  ),
  good("subgraph: padded quoted title", f('subgraph S ["  t  "]\n  A\nend')),
  good("subgraph: markdown title", f('subgraph S ["`**md**`"]\n  A\nend')),
  good(
    "subgraph: nested",
    f("subgraph O\n  subgraph I\n    A\n  end\n  B\nend"),
  ),
  good("subgraph: direction", f("subgraph S\n  direction LR\n  A-->B\nend")),
  good(
    "subgraph: TD direction is kept as written",
    f("subgraph S\n  direction TD\n  A\nend"),
  ),
  good("subgraph: empty", f("subgraph S\nend\nA")),
  good(
    "subgraph: ids with dash and Japanese",
    f("subgraph a-b\n A\nend\nsubgraph 日本\n B\nend"),
  ),
  good(
    "subgraph: first definition wins",
    f("subgraph S1\n  A-->B\nend\nsubgraph S2\n  B-->C\nend"),
  ),
  good(
    "subgraph: nested first definition wins",
    f("subgraph O\n  subgraph I\n    A\n  end\n  A-->B\nend"),
  ),
  good(
    "subgraph: edge attribute line joins the members",
    f("A e1@--> B\nsubgraph S\n  e1@{ animate: true }\nend"),
  ),
  good(
    "subgraph: a node named like the keyword prefix",
    f("subgraph S\n  endpoint\nend"),
  ),
  refused(
    "subgraph: an edge to a subgraph id makes a phantom node",
    f("subgraph S\n  A\nend\nB --> S"),
    "nodeSubgraphIdConflict",
  ),
  refused(
    "subgraph: a node with the id of a later subgraph",
    f("S\nsubgraph S\n  A\nend"),
    "nodeSubgraphIdConflict",
  ),
  opaque(
    "subgraph: title only",
    f('subgraph "Just a title"\n  A\nend'),
    "unsupportedSubgraphHeader",
  ),
  opaque(
    "subgraph: title with spaces",
    f("subgraph Title with spaces\n  A\nend"),
    "unsupportedSubgraphHeader",
  ),
  bad("subgraph: brackets only", f("subgraph [Only]\n  A\nend")),
  bad(
    "subgraph: class operator on the header",
    f("subgraph S:::c\n  A\nend"),
    "unsupportedSubgraphHeader",
  ),
  opaque(
    "subgraph: all on one line",
    f("subgraph S; A; end"),
    "subgraphSharesLine",
  ),
  opaque(
    "subgraph: duplicate id",
    f("subgraph S\n  A\nend\nsubgraph S\n  B\nend"),
    "duplicateSubgraphId",
  ),
  bad("subgraph: unclosed", f("subgraph S\n  A"), "unclosedSubgraph"),
  bad("subgraph: end without subgraph", f("A\nend"), "endWithoutSubgraph"),
  opaque(
    "subgraph: two directions in one block",
    f("subgraph S\n  direction LR\n  direction TB\n  A\nend"),
    "duplicateSubgraphDirection",
  ),
  opaque(
    "subgraph: @{} on a closed subgraph id",
    f('subgraph S\n  A\nend\nS@{ label: "x" }'),
    "atBlockOnSubgraph",
  ),
  // ---- classDef, class, style, click
  good(
    "classDef: one class",
    f("A\nclassDef k fill:#f96,stroke:#333\nclass A k"),
  ),
  good(
    "classDef: several names",
    f("A-->B\nclassDef a,b fill:#f00\nclass A a\nclass B b"),
  ),
  good(
    "classDef: appended by a second definition",
    f("classDef k fill:#f00\nclassDef k stroke:#0f0"),
  ),
  good(
    "classDef: ending with a semicolon",
    f("classDef k fill:#f96,stroke:#333;"),
  ),
  good("class: several targets", f("A-->B\nclassDef k fill:#f00\nclass A,B k")),
  good("class: operator on a node", f("A:::k --> B:::k\nclassDef k fill:#f00")),
  good(
    "class: on a node that does not exist yet is ignored",
    f("class A k\nA"),
  ),
  good("class: on an edge by its auto id", f("A-->B\nclass L_A_B_0 k")),
  good("class: on a closed subgraph", f("subgraph S\n  A\nend\nclass S k")),
  opaque(
    "class: two class names are one literal name",
    f("A\nclass A a,b"),
    "unsupportedClass",
  ),
  good("style: on a node", f("A-->B\nstyle A fill:#f00,stroke:#333")),
  good(
    "style: ending with a semicolon is harmless",
    f("A\nstyle A fill:#f00;"),
  ),
  good("style: creates the node", f("style Z fill:#f00")),
  good("style: before the node exists", f("style A fill:#f00\nA[Later]")),
  opaque(
    "style: two ids make a node named with a comma",
    f("A-->B\nstyle A,B fill:#f9f"),
    "unsupportedStyle",
  ),
  refused(
    "style: a semicolon inside a label that looks like a style",
    f('A["style x:#a; y"]'),
    "styleLikeText",
  ),
  refused(
    "style: two statements after a style with a colour",
    f("style A fill:#f00; B"),
    "styleLikeText",
  ),
  good("click: url", f('A\nclick A "https://example.com"')),
  good(
    "click: url with a tooltip and target",
    f('A\nclick A "https://example.com" "tip" _blank'),
  ),
  good(
    "click: href form",
    f('A\nclick A href "https://example.com" "tip" _self'),
  ),
  good("click: call form", f('A\nclick A call callback() "tip"')),
  good("click: callback name", f('A\nclick A callback "tip"')),
  good("click: several nodes", f('A-->B\nclick A,B "https://example.com"')),
  good(
    "click: before the node exists is ignored",
    f('click A "https://example.com"\nA'),
  ),
  opaque(
    "click: a url with parentheses is not read (mermaid normalises javascript: urls)",
    f('A\nclick A "javascript:alert(1)"'),
    "unsupportedClick",
  ),
  bad("click: empty url", f('A\nclick A ""'), "unsupportedClick"),
  // ---- linkStyle
  good("linkStyle: one edge", f("A-->B\nlinkStyle 0 stroke:#f00")),
  good(
    "linkStyle: index order follows chain and ampersand expansion",
    f(
      "A-->B-->C\nD & E --> F\nlinkStyle 1 stroke:#f00\nlinkStyle 3 stroke:#0f0",
    ),
  ),
  good(
    "linkStyle: several indexes",
    f("A-->B\nB-->C\nlinkStyle 0,1 stroke:#f00"),
  ),
  good("linkStyle: default", f("A-->B\nlinkStyle default stroke:#999")),
  good("linkStyle: interpolate", f("A-->B\nlinkStyle 0 interpolate basis")),
  good(
    "linkStyle: default interpolate applies to later edges",
    f("linkStyle default interpolate linear\nA-->B"),
  ),
  good(
    "linkStyle: interpolate and style",
    f("A-->B\nlinkStyle 0 interpolate basis stroke:red"),
  ),
  good(
    "linkStyle: fill:none is added when no fill",
    f("A-->B\nlinkStyle 0 stroke:red, stroke-width:2px"),
  ),
  good(
    "linkStyle: an explicit fill is kept",
    f("A-->B\nlinkStyle 0 stroke:red, fill:blue"),
  ),
  good(
    "linkStyle: a second one replaces the first",
    f("A-->B\nlinkStyle 0 stroke:red\nlinkStyle 0 stroke:blue"),
  ),
  bad(
    "linkStyle: index past the last edge",
    f("A-->B\nlinkStyle 1 stroke:#f00"),
    "linkStyleOutOfRange",
  ),
  bad(
    "linkStyle: before any edge",
    f("A\nlinkStyle 0 stroke:#f00"),
    "linkStyleOutOfRange",
  ),
  bad(
    "linkStyle: a hex colour followed by a semicolon",
    f("A-->B\nlinkStyle 0 stroke:#f00;"),
  ),
  bad("linkStyle: no style", f("A-->B\nlinkStyle 0  ")),
  bad("linkStyle: blank after a comma", f("A-->B\nlinkStyle 0, 1 stroke:red")),
  // ---- edge ids
  good("edge id: on an arrow", f("A e1@--> B")),
  good("edge id: with a pipe label", f("A e1@-->|x| B")),
  good("edge id: with an inline label", f("A e1@-- x --> B")),
  good("edge id: on every link kind", f("A e1@--- B\nA e2@-.-> B\nA e3@==> B")),
  good("edge id: attributes by id", f("A e1@--> B\ne1@{ animate: true }")),
  good(
    "edge id: curve and animation",
    f("A e1@--> B\ne1@{ curve: linear, animation: fast }"),
  ),
  good("edge id: class by id", f("A e1@--> B\nclass e1 k")),
  good(
    "edge id: in an ampersand list goes to the last start and first end",
    f("A & B e1@--> C & D"),
  ),
  refused(
    "edge id: declared twice",
    f("A e1@--> B\nA e1@--> B"),
    "duplicateEdgeId",
  ),
  refused(
    "edge id: equal to an auto id",
    f("A-->B\nA L_A_B_0@--> B"),
    "duplicateEdgeId",
  ),
  refused(
    "edge id: a node with the id of the edge (node first)",
    f("e1\nA e1@--> B"),
    "nodeEdgeIdConflict",
  ),
  opaque(
    "edge id: a node statement with the id of an edge is swallowed",
    f('A e1@--> B\ne1["X"]'),
    "edgeIdSwallowsNode",
  ),
  opaque(
    "edge id: an edge endpoint with the id of an edge",
    f("A e1@--> B\nC --> e1"),
    "edgeIdSwallowsNode",
  ),
  opaque(
    "edge id: style on an edge id",
    f("A e1@--> B\nstyle e1 fill:#f00"),
    "edgeIdSwallowsNode",
  ),
  opaque(
    "edge id: attributes before the edge exist make a node",
    f("e1@{ animate: true }\nA e1@--> B"),
    "atBlockUnsupportedKey",
  ),
  opaque(
    "edge id: unknown attribute",
    f("A e1@--> B\ne1@{ color: red }"),
    "atBlockUnsupportedKey",
  ),
  // Rejected by mermaid 12.1.0, accepted since 12.3.0; the reader keeps refusing it.
  opaque(
    "edge id: node block before an edge id",
    f("A@{ shape: cyl } e1@--> B"),
    "atBlockBeforeEdgeId",
  ),
  // ---- text rewriting by mermaid
  refused(
    "rewrite: a lone carriage return",
    "flowchart TD\rA-->B\r",
    "loneCarriageReturn",
  ),
  refused(
    "rewrite: attribute quotes are changed",
    f('%% <a href="x">\nA-->B'),
    "markupRewrite",
  ),
  // ---- unrecognised
  bad("unknown: free text", f("this is not a statement"), "invalidLink"),
  bad(
    "unknown: entity-like text outside a label",
    f("A-->B#amp;"),
    "entityLikeText",
  ),
  opaque(
    "unknown: non-breaking space after a statement",
    "flowchart TD\nA-->B \n",
    "nonAsciiWhitespace",
  ),
  // ---- limits
  good("limit: exactly 500 edges", edgesProgram(500)),
  { ...bad("limit: 501 edges", edgesProgram(501)) },
  good("limit: exactly 50000 characters", sourceOfLength(50000)),
  {
    name: "limit: 50001 characters (mermaid parses; the render only shows an 'exceeded' diagram)",
    source: sourceOfLength(50001),
    mermaid: true,
    editable: false,
    reason: "sourceTooLong",
  },
];

describe("flowchart grammar of mermaid 12.3.0", () => {
  it("has unique case names", () => {
    const names = CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CASES.map((entry) => [entry.name, entry] as const))(
    "%s",
    async (_name, entry) => {
      const reference = await readFlowchartWithMermaid(entry.source);
      expect(reference.accepted, "mermaid").toBe(entry.mermaid);

      const reading = readFlowchart(entry.source);
      const editability = flowchartEditability(reading);
      expect(editability.editable, JSON.stringify(editability)).toBe(
        entry.editable,
      );
      if (!editability.editable) {
        if (entry.reason !== undefined) {
          expect(editability.reason).toBe(entry.reason);
        }
        if (entry.opaque !== undefined) {
          expect(reading.opaque[0]?.reason).toBe(entry.opaque);
        }
      }

      if (editability.editable) {
        // The invariant the whole editor stands on: what we call editable is accepted by
        // mermaid, and our reading of it equals mermaid's own.
        expect(reference.accepted).toBe(true);
        expect(reading.meaning).not.toBeNull();
        if (reference.accepted && reading.meaning !== null) {
          const difference = firstDifference(
            comparableOf(reading.meaning),
            reference.meaning,
          );
          expect(difference).toBeNull();
        }
      }
      if (editability.editable || entry.draws === false) {
        const drawn = await renderCheck(entry.source);
        expect(drawn.ok, JSON.stringify(drawn)).toBe(entry.draws !== false);
      }
      if (!reference.accepted) {
        expect(editability.editable).toBe(false);
      }
    },
    60_000,
  );

  it("the render gate alone misses a text longer than mermaid's limit", async () => {
    // Mermaid replaces a text over maxTextSize by an "exceeded" diagram and reports
    // success, so the editor has to check the length itself.
    const source = sourceOfLength(50001);
    expect(await renderCheck(source)).toEqual({ ok: true });
    const outcome = await mermaidRenderer.render(source, {});
    expect(outcome.ok).toBe(true);
    const visibleText = outcome.ok
      ? outcome.svg.replace(/<style>.*?<\/style>/s, "").replace(/<[^>]+>/g, " ")
      : "";
    expect(visibleText.replace(/\s+/g, " ")).toContain(
      "Maximum text size in diagram exceeded",
    );
    expect(flowchartEditability(readFlowchart(source))).toMatchObject({
      editable: false,
      reason: "sourceTooLong",
    });
  }, 60_000);

  it("a source of exactly 500 edges reads, 501 is refused by the reader too", () => {
    expect(flowchartEditability(readFlowchart(edgesProgram(500)))).toEqual({
      editable: true,
    });
    expect(
      flowchartEditability(readFlowchart(edgesProgram(501))),
    ).toMatchObject({ editable: false, reason: "tooManyEdges" });
  });
});
