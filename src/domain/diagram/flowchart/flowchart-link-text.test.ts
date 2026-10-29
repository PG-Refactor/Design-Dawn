import { describe, expect, it } from "vitest";
import {
  FLOWCHART_MAX_LINK_LENGTH,
  FLOWCHART_UNDRAWABLE_SHAPES,
} from "./flowchart-config";
import { type FlowchartLinkSpec, linkTokenOf } from "./flowchart-link-text";
import {
  bracketPairOf,
  FLOWCHART_EDITABLE_SHAPES,
  FLOWCHART_LINK_STROKES,
  FLOWCHART_LINK_TYPES,
  FLOWCHART_MIN_LINK_LENGTH,
} from "./flowchart-operation-config";
import { readFlowchart } from "./flowchart-reader";

function tokenOf(spec: FlowchartLinkSpec): string {
  const result = linkTokenOf(spec);
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}

describe("linkTokenOf", () => {
  const KNOWN: readonly (readonly [FlowchartLinkSpec, string])[] = [
    [{ type: "arrow_point", stroke: "normal", length: 1 }, "-->"],
    [{ type: "arrow_point", stroke: "normal", length: 2 }, "--->"],
    [{ type: "arrow_open", stroke: "normal", length: 1 }, "---"],
    [{ type: "arrow_open", stroke: "normal", length: 2 }, "----"],
    [{ type: "arrow_circle", stroke: "normal", length: 1 }, "--o"],
    [{ type: "arrow_cross", stroke: "normal", length: 1 }, "--x"],
    [{ type: "double_arrow_point", stroke: "normal", length: 1 }, "<-->"],
    [{ type: "double_arrow_circle", stroke: "normal", length: 1 }, "o--o"],
    [{ type: "double_arrow_cross", stroke: "normal", length: 1 }, "x--x"],
    [{ type: "arrow_point", stroke: "thick", length: 1 }, "==>"],
    [{ type: "arrow_open", stroke: "thick", length: 1 }, "==="],
    [{ type: "arrow_point", stroke: "dotted", length: 1 }, "-.->"],
    [{ type: "arrow_point", stroke: "dotted", length: 2 }, "-..->"],
    [{ type: "arrow_open", stroke: "dotted", length: 1 }, "-.-"],
    [{ type: "double_arrow_point", stroke: "dotted", length: 1 }, "<-.->"],
    [{ type: "arrow_open", stroke: "invisible", length: 1 }, "~~~"],
    [{ type: "arrow_open", stroke: "invisible", length: 2 }, "~~~~"],
  ];
  it.each(KNOWN)("writes %j as %s", (spec, token) => {
    expect(tokenOf(spec)).toBe(token);
  });

  it("is read back by the reader as the same type, stroke and length for every combination", () => {
    let combinations = 0;
    for (const type of FLOWCHART_LINK_TYPES) {
      for (const stroke of FLOWCHART_LINK_STROKES) {
        const invisible = stroke === "invisible";
        if (invisible && type !== "arrow_open") continue;
        for (
          let length = FLOWCHART_MIN_LINK_LENGTH;
          length <= FLOWCHART_MAX_LINK_LENGTH;
          length += 1
        ) {
          const token = tokenOf({ type, stroke, length });
          const edge = readFlowchart(`flowchart TD\n    A ${token} B\n`).meaning
            ?.edges[0];
          expect({
            token,
            type: edge?.type,
            stroke: edge?.stroke,
            length: edge?.length,
          }).toEqual({ token, type, stroke, length });
          combinations += 1;
        }
      }
    }
    // 7 types x 3 strokes x 10 lengths + the invisible link x 10 lengths.
    expect(combinations).toBe(220);
  });

  it("refuses a link that does not exist", () => {
    const base = { type: "arrow_point", stroke: "normal", length: 1 } as const;
    for (const spec of [
      { ...base, length: 0 },
      { ...base, length: FLOWCHART_MAX_LINK_LENGTH + 1 },
      { ...base, length: 1.5 },
      { ...base, type: "arrow_point", stroke: "invisible" },
      { ...base, type: "nope" as never },
      { ...base, stroke: "nope" as never },
    ] as const) {
      const result = linkTokenOf(spec);
      expect(result.ok).toBe(false);
    }
  });
});

describe("the shapes the editor writes", () => {
  it("are the bracket shapes without the ones Mermaid cannot draw", () => {
    expect(FLOWCHART_EDITABLE_SHAPES).toHaveLength(14);
    for (const undrawable of FLOWCHART_UNDRAWABLE_SHAPES) {
      expect(FLOWCHART_EDITABLE_SHAPES).not.toContain(undrawable);
      // The type spells the excluded name; this is the check that it matches the list.
      expect(undrawable).toBe("ellipse");
    }
  });

  it("have brackets that the reader reads back as the same shape", () => {
    for (const shape of FLOWCHART_EDITABLE_SHAPES) {
      const brackets = bracketPairOf(shape);
      expect(brackets).not.toBeNull();
      const source = `flowchart TD\n    A${brackets?.opener}"x"${brackets?.closer}\n`;
      expect(readFlowchart(source).meaning?.nodes[0]?.shape).toBe(shape);
    }
  });
});
