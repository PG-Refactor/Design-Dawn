import { type DomainResult, err, ok } from "../../shared/domain-result";
import {
  FLOWCHART_MAX_LINK_LENGTH,
  type FlowchartLinkStroke,
  type FlowchartLinkType,
} from "./flowchart-config";
import {
  FLOWCHART_INVISIBLE_LINK_TYPE,
  FLOWCHART_LINK_STROKES,
  FLOWCHART_LINK_TYPES,
  FLOWCHART_MIN_LINK_LENGTH,
} from "./flowchart-operation-config";

// What a link is, apart from where it is written: the three facts Mermaid derives from a
// link token (flowchart-link-parser.ts reads them back the same way).
export interface FlowchartLinkSpec {
  readonly type: FlowchartLinkType;
  readonly stroke: FlowchartLinkStroke;
  readonly length: number;
}

const LINE_CHARACTERS: Readonly<
  Record<Exclude<FlowchartLinkStroke, "dotted">, string>
> = { normal: "-", thick: "=", invisible: "~" };
const DOTTED_START = "-";
const DOTTED_DOT = ".";
const DOTTED_END = "-";

interface Ends {
  readonly head: string;
  readonly tail: string;
}

// `head` is written before the line (`<`, `x`, `o` of a two-way link), `tail` after it.
const LINK_ENDS: Readonly<Record<FlowchartLinkType, Ends>> = {
  arrow_open: { head: "", tail: "" },
  arrow_point: { head: "", tail: ">" },
  arrow_circle: { head: "", tail: "o" },
  arrow_cross: { head: "", tail: "x" },
  double_arrow_point: { head: "<", tail: ">" },
  double_arrow_circle: { head: "o", tail: "o" },
  double_arrow_cross: { head: "x", tail: "x" },
};

function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

// The token for a link: `-->` for the default, `-.->` dotted, `==>` thick, `~~~` invisible.
// A link with an arrow end has one line character fewer than an open one (`-->` and `---`
// both have length 1), and the length counts the extra characters (`--->` is 2).
export function linkTokenOf(spec: FlowchartLinkSpec): DomainResult<string> {
  if (!(FLOWCHART_LINK_TYPES as readonly string[]).includes(spec.type)) {
    return refuse("invalidLink", `unknown link type ${spec.type}`);
  }
  if (!(FLOWCHART_LINK_STROKES as readonly string[]).includes(spec.stroke)) {
    return refuse("invalidLink", `unknown link stroke ${spec.stroke}`);
  }
  if (
    !Number.isInteger(spec.length) ||
    spec.length < FLOWCHART_MIN_LINK_LENGTH ||
    spec.length > FLOWCHART_MAX_LINK_LENGTH
  ) {
    return refuse(
      "invalidLinkLength",
      `length ${spec.length} is outside ${FLOWCHART_MIN_LINK_LENGTH}-${FLOWCHART_MAX_LINK_LENGTH}`,
    );
  }
  if (
    spec.stroke === "invisible" &&
    spec.type !== FLOWCHART_INVISIBLE_LINK_TYPE
  ) {
    return refuse("invalidLink", "an invisible link has no arrow end");
  }
  const { head, tail } = LINK_ENDS[spec.type];
  const open = tail === "";
  let line: string;
  if (spec.stroke === "dotted") {
    line = `${DOTTED_START}${DOTTED_DOT.repeat(spec.length)}${DOTTED_END}`;
  } else {
    const character = LINE_CHARACTERS[spec.stroke];
    line = character.repeat(spec.length + (open ? 2 : 1));
  }
  return ok(`${head}${line}${tail}`);
}
