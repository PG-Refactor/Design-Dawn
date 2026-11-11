import { describe, expect, it } from "vitest";
import { DOCUMENT_A } from "../../application/test-support/workspace-harness";
import { openedActionsHarness } from "../workspace/test-support/actions-harness";
import { exportStems, folderFilesOf } from "./export-actions";

describe("exportStems", () => {
  it("numbers a name used before, ignoring case", () => {
    expect(exportStems(["API", "Order", "api", "API"])).toEqual([
      "API",
      "Order",
      "api (2)",
      "API (3)",
    ]);
  });
});

describe("exportDocumentMarkdown", () => {
  it("saves first, then exports the Document from disk", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.clearCalls();
    const result =
      await harness.services.exportActions.exportDocumentMarkdown(DOCUMENT_A);
    expect(result).toEqual({
      ok: true,
      value: { status: "saved", fileName: `${DOCUMENT_A}.md` },
    });
    expect(harness.gateway.methods("exportDocumentMarkdown")).toHaveLength(1);
  });
});

describe("folderFilesOf", () => {
  const documents = [
    { documentId: "a" as never, name: "API", folders: ["Design", "Back"] },
    { documentId: "b" as never, name: "API", folders: [] },
    { documentId: "c" as never, name: "api", folders: ["Design", "Back"] },
  ];

  it("keeps each Document in its folders and numbers names only within one folder", () => {
    expect(folderFilesOf(documents, "md", true)).toEqual([
      { stem: "API", format: "md", folders: ["Design", "Back"] },
      { stem: "API", format: "md", folders: [] },
      { stem: "api (2)", format: "md", folders: ["Design", "Back"] },
    ]);
  });

  it("puts everything in the chosen folder when the structure is not kept", () => {
    expect(
      folderFilesOf(documents, "pdf", false).map((file) => [
        file.stem,
        file.folders,
      ]),
    ).toEqual([
      ["API", []],
      ["API (2)", []],
      ["api (3)", []],
    ]);
  });
});
