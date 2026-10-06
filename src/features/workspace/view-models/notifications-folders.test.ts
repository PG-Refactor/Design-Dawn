import { describe, expect, it } from "vitest";
import {
  FOLDER_1,
  openedFolderDiskWorkspace,
} from "../../../application/test-support/workspace-harness";
import { selectNotifications } from "./notifications-model";

const NO_THEME_PROBLEMS = { loadIssue: null, saveError: null } as const;

describe("folder save error notifications", () => {
  it("lists a failed folder save with its name and a retry for that folder", async () => {
    const harness = await openedFolderDiskWorkspace();
    harness.gateway.failOn("saveFolder", "ioError");
    await harness.workspace.renameFolder(FOLDER_1, "Renamed");
    const model = selectNotifications({
      application: harness.store.getState(),
      operationErrors: [],
      theme: NO_THEME_PROBLEMS,
    });
    const item = model.items.find((entry) => entry.kind === "saveError");
    expect(item).toMatchObject({
      id: `saveError:folder:${FOLDER_1}`,
      severity: "error",
      retry: { kind: "folder", folderId: FOLDER_1, folderName: "Renamed" },
    });
    expect(item?.message).toContain("Renamed");
    expect((await harness.workspace.saveFolder(FOLDER_1)).ok).toBe(true);
    expect(
      selectNotifications({
        application: harness.store.getState(),
        operationErrors: [],
        theme: NO_THEME_PROBLEMS,
      }).items,
    ).toEqual([]);
  });
});
