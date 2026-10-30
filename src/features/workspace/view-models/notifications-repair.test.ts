import { describe, expect, it } from "vitest";
import type { LoadIssue } from "../../../application/ports/persistence-types";
import {
  createWorkspaceHarness,
  SELECTION_ID,
} from "../../../application/test-support/workspace-harness";
import { seedProjectIssues } from "../test-support/actions-harness";
import { WORKSPACE_MESSAGES } from "../workspace-messages";
import { selectNotifications } from "./notifications-model";

const base = { path: "p", entityId: null, detail: "d", reason: null } as const;

async function modelFor(issues: readonly LoadIssue[]) {
  const harness = createWorkspaceHarness();
  await seedProjectIssues(harness, issues);
  await harness.workspace.openProject(SELECTION_ID);
  return selectNotifications({
    messages: WORKSPACE_MESSAGES.en,
    application: harness.store.getState(),
    operationErrors: [],
    theme: { loadIssue: null, saveError: null },
  });
}

describe("repair options in notifications", () => {
  it("offers the actions of each issue kind", async () => {
    const model = await modelFor([
      { ...base, kind: "missingContent" },
      { ...base, kind: "orphanContent" },
      { ...base, kind: "leftoverTempFile" },
    ]);
    const actions = model.items
      .filter((item) => item.kind === "loadIssue")
      .map((item) => item.repair?.actions);
    expect(actions).toEqual([
      ["createEmptyContent", "removeBlock"],
      ["addAsBlock", "deleteFile"],
      ["deleteTempFile"],
    ]);
  });

  it("gives a load failure only Reload, and a newer-format file neither", async () => {
    const model = await modelFor([
      { ...base, kind: "unrecognizedDirectory" },
      { ...base, kind: "entityLoadFailed", reason: "unsupportedSchemaVersion" },
    ]);
    const [odd, newer] = model.items.filter(
      (item) => item.kind === "loadIssue",
    );
    expect(odd?.repair).toBeNull();
    expect(odd?.reload).toEqual({ scope: "project" });
    expect(newer?.reload).toBeNull();
    expect(newer?.message).toContain("read-only");
    expect(newer?.details.map((d) => d.value)).toContain(
      "unsupportedSchemaVersion",
    );
  });

  it("lists older-format files in one notice and not as separate issues", async () => {
    const model = await modelFor([
      { ...base, kind: "outdatedFormat", path: "project.json" },
      { ...base, kind: "outdatedFormat", path: "documents/a/document.json" },
    ]);
    const notice = model.items.filter((item) => item.kind === "formatUpdate");
    expect(notice).toHaveLength(1);
    expect(notice[0]?.formatUpdate).toBe(true);
    expect(notice[0]?.details.map((d) => d.value)).toEqual([
      "project.json",
      "documents/a/document.json",
    ]);
    expect(model.items.some((item) => item.kind === "loadIssue")).toBe(false);
  });
});
