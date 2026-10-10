import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";

// Node environment: no window. DOMPurify would return the input unchanged, so the
// sanitiser must refuse to run instead.
describe("sanitizeSvg without a DOM", () => {
  it("throws and never passes the input through", () => {
    expect(() => sanitizeSvg("<svg><script>alert(1)</script></svg>")).toThrow(
      /DOM/,
    );
  });
});
