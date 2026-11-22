import { describe, expect, it } from "vitest";
import {
  decodeSequenceText,
  encodeSequenceText,
  generateParticipantId,
} from "./sequence-text";

describe("sequence text", () => {
  it("refuses markup Mermaid would rewrite, and text that looks like a style", () => {
    const markup = encodeSequenceText('<a href="x">y</a>', "message");
    expect(!markup.ok && markup.error.detail).toContain("markup");
    const style = encodeSequenceText("style a:b;", "message");
    expect(!style.ok && style.error.detail).toContain("styleLikeText");
  });

  it("keeps a <br/> as written in a field without line breaks", () => {
    expect(decodeSequenceText("a<br/>b", "title")).toBe("a<br/>b");
  });

  it("generates the first id nothing uses", () => {
    const first = generateParticipantId(new Set());
    expect(generateParticipantId(new Set([first]))).not.toBe(first);
  });
});
