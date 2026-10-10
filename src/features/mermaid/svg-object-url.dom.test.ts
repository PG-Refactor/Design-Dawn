// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";
import { createSvgObjectUrl, revokeSvgObjectUrl } from "./svg-object-url";

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe("SVG object URLs", () => {
  it("wraps the sanitised SVG in an image/svg+xml blob", async () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    );
    const url = createSvgObjectUrl(svg);
    expect(url).toBe("blob:fake");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toBe(svg);
  });

  it("revokes the URL it is given", () => {
    const url = createSvgObjectUrl(
      sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );
    revokeSvgObjectUrl(url);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});
