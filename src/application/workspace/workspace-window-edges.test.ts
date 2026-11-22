import { describe, expect, it } from "vitest";
import { createFakeDocumentWindows } from "../test-support/fake-document-windows";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_B,
  openedDocumentA,
  SELECTION_ID,
} from "../test-support/workspace-harness";

const MAIN = "main";
const NEW_WINDOW = { kind: "newWindow", screenX: 0, screenY: 0 } as const;

async function projectWindow() {
  const first = createWorkspaceHarness();
  const windows = createFakeDocumentWindows(first.gateway);
  const main = createWorkspaceHarness({
    sharedGateway: first.gateway,
    windows: windows.gatewayFor(MAIN),
  });
  expect((await main.workspace.openProject(SELECTION_ID)).ok).toBe(true);
  return { windows, main };
}

describe("windows that cannot take part", () => {
  it("refuses moves and hand-overs without a window gateway, and has no tree to refresh", async () => {
    const harness = await openedDocumentA();
    const { workspace } = harness;
    expect(
      (await workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW)).ok,
    ).toBe(false);
    expect((await workspace.receiveDocument("transfer-1")).ok).toBe(false);
    expect((await workspace.refreshProjectTree()).ok).toBe(true);
  });

  it("refuses moves, hand-overs and refreshes without an open Project", async () => {
    const first = createWorkspaceHarness();
    const windows = createFakeDocumentWindows(first.gateway);
    const { workspace } = createWorkspaceHarness({
      sharedGateway: first.gateway,
      windows: windows.gatewayFor(MAIN),
    });
    expect(
      (await workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW)).ok,
    ).toBe(false);
    expect((await workspace.receiveDocument("transfer-1")).ok).toBe(false);
    expect((await workspace.refreshProjectTree()).ok).toBe(false);
  });

  it("refuses to move a Document that is not open here", async () => {
    const { main } = await projectWindow();
    expect(
      (await main.workspace.moveDocumentToWindow(DOCUMENT_B, NEW_WINDOW)).ok,
    ).toBe(false);
  });
});

describe("receiving a Document", () => {
  it("refuses a hand-over that is not waiting for this window", async () => {
    const { main } = await projectWindow();
    expect((await main.workspace.receiveDocument("transfer-9")).ok).toBe(false);
  });

  it("refuses a hand-over that cannot be read, and a Document already open here", async () => {
    const { windows, main } = await projectWindow();
    const sender = windows.gatewayFor("other");
    const project = main.store.getState().project;
    if (project === null) throw new Error("no project");
    await sender.transferDocument(project.projectId, DOCUMENT_A, "not json", {
      kind: "window",
      label: MAIN,
    });
    expect((await main.workspace.receiveDocument("transfer-1")).ok).toBe(false);

    // A Document sent to this very window, then opened here again before it is taken.
    expect((await main.workspace.openDocument(DOCUMENT_A)).ok).toBe(true);
    expect(
      (
        await main.workspace.moveDocumentToWindow(DOCUMENT_A, {
          kind: "window",
          label: MAIN,
        })
      ).ok,
    ).toBe(true);
    expect((await main.workspace.openDocument(DOCUMENT_A)).ok).toBe(true);
    const sent = windows.sent.at(-1);
    if (sent === undefined) throw new Error("nothing sent");
    const received = await main.workspace.receiveDocument(sent.transferId);
    expect(!received.ok && received.error.detail).toContain("already open");
  });
});
