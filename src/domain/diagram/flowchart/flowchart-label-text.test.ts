import { describe, expect, it } from "vitest";
import {
  decodeFlowchartLabel,
  encodeFlowchartLabel,
  generateNodeId,
  validateNewNodeId,
} from "./flowchart-label-text";

describe("encodeFlowchartLabel / decodeFlowchartLabel", () => {
  const ROUND_TRIPS = [
    "plain",
    "a<b>c",
    "<br/>",
    "<b>x</b>",
    "line one\nline two",
    "a\n\nb",
    "日本語 🐶",
    "(v2) [x] {y} | ; : -->",
  ];
  it.each(ROUND_TRIPS)("decodes what it wrote for %j", (text) => {
    const encoded = encodeFlowchartLabel(text);
    expect(encoded.ok).toBe(true);
    expect(decodeFlowchartLabel(encoded.ok ? encoded.value : "")).toBe(text);
  });

  it("writes a literal <br/> as entities so it does not become a line break", () => {
    const encoded = encodeFlowchartLabel("<br/>");
    expect(encoded.ok && encoded.value).toBe("#lt;br/#gt;");
  });

  it("decodes the break forms a person may have written by hand", () => {
    expect(decodeFlowchartLabel("a<br>b<br />c<br/>d")).toBe("a\nb\nc\nd");
  });
});

describe("validateNewNodeId / generateNodeId", () => {
  const taken = new Set(["A", "N1", "N2"]);

  it("accepts a plain id and refuses what is not usable", () => {
    expect(validateNewNodeId("Node_1", taken).ok).toBe(true);
    for (const id of ["A", "end", "x", "o", "9a", "a-b", "", "a b", "é"]) {
      expect(validateNewNodeId(id, taken).ok).toBe(false);
    }
  });

  it("makes up the first free N-number", () => {
    expect(generateNodeId(taken)).toBe("N3");
    expect(generateNodeId(new Set())).toBe("N1");
  });
});
