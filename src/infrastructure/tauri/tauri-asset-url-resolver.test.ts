import { convertFileSrc } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentPath } from "../../domain/block/content-path";
import { DOCUMENT_ID, PROJECT_ID } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import { createTauriAssetUrlResolver } from "./tauri-asset-url-resolver";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: vi.fn() }));
const convertFileSrcMock = vi.mocked(convertFileSrc);

// Behaves like Tauri's own: the platform origin, then the WHOLE locator percent-encoded.
function realConvertFileSrc(origin: (scheme: string) => string) {
  return (locator: string, scheme = "asset") =>
    `${origin(scheme)}${encodeURIComponent(locator)}`;
}

const urlFor = (contentPath: string) =>
  createTauriAssetUrlResolver().urlFor(
    PROJECT_ID,
    DOCUMENT_ID,
    unwrap(parseContentPath(contentPath)),
  );

beforeEach(() => {
  convertFileSrcMock.mockReset();
  convertFileSrcMock.mockImplementation(
    realConvertFileSrc((scheme) => `${scheme}://localhost/`),
  );
});

describe("createTauriAssetUrlResolver", () => {
  it("builds <origin>/<projectId>/<documentId>/<contentPath> on the dawn-asset scheme", () => {
    expect(urlFor("assets/photo.png")).toBe(
      `dawn-asset://localhost/${PROJECT_ID}/${DOCUMENT_ID}/assets/photo.png`,
    );
    expect(convertFileSrcMock).toHaveBeenCalledWith("", "dawn-asset");
  });

  it("keeps the separators and encodes every segment", () => {
    expect(urlFor("assets/my photo (1)#a?.png")).toBe(
      `dawn-asset://localhost/${PROJECT_ID}/${DOCUMENT_ID}/assets/my%20photo%20(1)%23a%3F.png`,
    );
    expect(urlFor("assets/日本語.png")).toContain("/assets/%E6%97%A5");
  });

  it("uses the Windows origin form that Tauri reports", () => {
    convertFileSrcMock.mockImplementation(
      realConvertFileSrc((scheme) => `http://${scheme}.localhost/`),
    );
    expect(urlFor("assets/a.svg")).toBe(
      `http://dawn-asset.localhost/${PROJECT_ID}/${DOCUMENT_ID}/assets/a.svg`,
    );
  });

  it("never contains more than the identifiers and the relative path", () => {
    const url = new URL(urlFor("assets/a.png"));
    expect(url.pathname.split("/").filter(Boolean)).toEqual([
      PROJECT_ID,
      DOCUMENT_ID,
      "assets",
      "a.png",
    ]);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("does not let a segment smuggle in extra path levels", () => {
    const url = urlFor("assets/..%2f..%2fsecret.png");
    expect(url).toContain("..%252f..%252fsecret.png");
  });
});
