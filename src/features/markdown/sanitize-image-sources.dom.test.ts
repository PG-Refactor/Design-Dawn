// @vitest-environment jsdom
// Pictures of a Git version shown in sanitised Markdown: only named sources change, and
// only to image `data:` URLs.
import { describe, expect, it } from "vitest";
import { sanitizeHtml, withImageSources } from "./sanitize-html";

const PREFIX = "http://asset.localhost/p/d/";
const DATA = "data:image/png;base64,iVBORw0KGgo=";

describe("withImageSources", () => {
  it("shows another picture in place of a named source only", () => {
    const html = sanitizeHtml(
      `<p><img src="${PREFIX}assets/x.png" alt="x"><img src="${PREFIX}assets/y.png" alt="y"></p>`,
      { imageSourcePrefix: PREFIX },
    );
    const swapped = withImageSources(
      html,
      new Map([[`${PREFIX}assets/x.png`, DATA]]),
    );
    expect(swapped).toContain(`src="${DATA}"`);
    expect(swapped).toContain(`src="${PREFIX}assets/y.png"`);
  });

  it("ignores anything that is not an image data URL", () => {
    const html = sanitizeHtml(`<img src="${PREFIX}assets/x.png" alt="x">`, {
      imageSourcePrefix: PREFIX,
    });
    for (const bad of [
      'data:image/png;base64,AA" onerror="alert(1)',
      "data:text/html;base64,PHA+",
      "javascript:alert(1)",
    ]) {
      expect(
        withImageSources(html, new Map([[`${PREFIX}assets/x.png`, bad]])),
      ).toBe(html);
    }
  });
});
