// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_A_ISSUE,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import {
  makeDocumentADirty,
  PROJECT_ISSUE,
  produceOrphanContentWarning,
} from "./test-support/actions-harness";
import {
  applyOutsideUi,
  chooseRowMenuItem,
  renderShell,
  waitForGone,
} from "./test-support/shell-harness";

afterEach(() => {
  cleanup();
});

const treeItem = (name: string | RegExp) =>
  screen.getByRole("treeitem", { name });
const documentTabList = () =>
  screen.getByRole("tablist", { name: "Document Tabs" });
const documentTab = (name: string | RegExp) =>
  within(documentTabList()).getByRole("tab", { name });

async function openDocumentByClick(
  user: Awaited<ReturnType<typeof renderShell>>["user"],
  name: string,
) {
  await user.click(within(treeItem(name)).getByText(name));
  await waitFor(() => expect(documentTab(new RegExp(name))).toBeTruthy());
}

describe("save status in the document tab", () => {
  it("shows unsaved after an edit and clears it when auto-save finishes", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness.user, "Document A");
    expect(within(documentTab(/Document A/)).queryByText("未保存")).toBeNull();

    await applyOutsideUi(() => makeDocumentADirty(harness));
    expect(within(documentTab(/Document A/)).getByText("未保存")).toBeTruthy();

    await harness.runAutoSave();
    await waitForGone("未保存");
    expect(harness.gateway.savedSheets.size).toBe(1);
  });

  it("shows a persistent save error, keeps the tab on close, and retries", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness.user, "Document A");
    await applyOutsideUi(() => makeDocumentADirty(harness));
    harness.gateway.failAlways("saveSheet", "ioError");
    await harness.runAutoSave();

    await waitFor(() =>
      expect(
        within(documentTab(/Document A/)).getByText("保存エラー"),
      ).toBeTruthy(),
    );
    const retryButton = within(documentTabList()).getByRole("button", {
      name: /再試行/,
    });

    // Closing must not drop unsaved work: the tab stays and the failure is reported.
    await harness.user.click(
      screen.getByRole("button", { name: "Document Aを閉じる" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "通知" })).toBeTruthy(),
    );
    expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(true);
    expect(documentTab(/Document A/)).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "通知" })).getAllByText(
        /Documentを閉じられませんでした/,
      ),
    ).toHaveLength(1);

    harness.gateway.clearFailures();
    await harness.user.click(retryButton);
    await waitForGone("保存エラー");
    expect(documentTab(/Document A/)).toBeTruthy();
    expect(harness.gateway.savedSheets.size).toBe(1);

    await harness.user.click(
      screen.getByRole("button", { name: "Document Aを閉じる" }),
    );
    await waitFor(() =>
      expect(harness.store.getState().documents.has(DOCUMENT_A)).toBe(false),
    );
  });

  it("offers no way to close without saving", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness.user, "Document A");
    await applyOutsideUi(() => makeDocumentADirty(harness));
    harness.gateway.failAlways("saveSheet", "ioError");
    await harness.runAutoSave();
    await harness.user.click(
      screen.getByRole("button", { name: /^通知|エラー/ }),
    );
    harness.actions.requestDeleteDocument(DOCUMENT_A);
    await screen.findByRole("dialog");

    expect(screen.queryByText(/保存せず/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /保存せず|破棄|Discard/ }),
    ).toBeNull();
    expect(document.body.textContent).not.toMatch(/保存せずに閉じる/);
  });
});

describe("load issues and warnings", () => {
  it("announces warnings, counts them and lists every issue; editing stays possible", async () => {
    const harness = await renderShell({ projectIssues: [PROJECT_ISSUE] });
    expect(
      screen.getByRole("status", { name: "読み込み状況" }).textContent,
    ).toBe("");
    await harness.openProjectInUi();

    const status = screen.getByRole("status", { name: "読み込み状況" });
    expect(status.textContent).toContain("Projectを警告付きで読み込みました");
    // failed document (error) + project issue (warning)
    expect(
      screen.getByRole("button", { name: "エラー 1件・警告 1件" }),
    ).toBeTruthy();

    await openDocumentByClick(harness.user, "Document A");
    expect(status.textContent).toContain("Documentを警告付きで読み込みました");
    const summary = screen.getByRole("button", {
      name: "エラー 2件・警告 2件",
    });
    expect(summary.getAttribute("aria-expanded")).toBe("false");

    await harness.user.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region", { name: "通知" });
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(panel.textContent).toContain(PROJECT_ISSUE.path ?? "");
    expect(panel.textContent).toContain(DOCUMENT_A_ISSUE.path ?? "");
    expect(panel.textContent).toContain("Document: Document A");
    expect(
      within(panel).getAllByText("詳細", { selector: "summary" }),
    ).toHaveLength(4);

    // A warning does not block editing.
    await applyOutsideUi(() => makeDocumentADirty(harness));
    expect(within(documentTab(/Document A/)).getByText("未保存")).toBeTruthy();
  });

  it("keeps a document that failed to load closed, but deletable", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    const failed = treeItem(/読み込み失敗/);

    await harness.user.click(failed);
    expect(harness.gateway.methods("loadDocument")).toEqual([]);

    await chooseRowMenuItem(harness.user, failed, "Documentを削除");
    await harness.user.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() =>
      expect(
        harness.store
          .getState()
          .project?.documents.some(
            (entry) => entry.documentId === FAILED_DOCUMENT_ID,
          ),
      ).toBe(false),
    );
  });

  it("lists orphan content warnings after save errors", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness.user, "Document A");
    await openDocumentByClick(harness.user, "Document B");
    await applyOutsideUi(() =>
      produceOrphanContentWarning(harness, DOCUMENT_B, SHEET_B1),
    );
    await applyOutsideUi(() => makeDocumentADirty(harness));
    harness.gateway.failAlways("saveSheet", "ioError");
    await harness.runAutoSave();
    await waitFor(() =>
      expect(
        within(documentTab(/Document A/)).getByText("保存エラー"),
      ).toBeTruthy(),
    );

    await harness.user.click(screen.getByRole("button", { name: /エラー/ }));

    const items = within(
      screen.getByRole("region", { name: "通知" }),
    ).getAllByRole("listitem");
    const texts = items.map((item) => item.textContent ?? "");
    const saveErrorIndex = texts.findIndex((text) =>
      text.includes("保存できませんでした"),
    );
    const loadFailedIndex = texts.findIndex((text) =>
      text.includes("読み込みに失敗"),
    );
    const orphanIndex = texts.findIndex((text) =>
      text.includes("本文ファイルを削除できません"),
    );
    expect(saveErrorIndex).toBe(0);
    expect(saveErrorIndex).toBeLessThan(loadFailedIndex);
    expect(loadFailedIndex).toBeLessThan(orphanIndex);
    expect(orphanIndex).toBe(texts.length - 1);
    expect(items[orphanIndex]?.textContent).toContain("警告");
    expect(items[saveErrorIndex]?.textContent).toContain("エラー");
    // Retry for the save error is offered inside the notification, too.
    expect(
      within(items[saveErrorIndex] as HTMLElement).getByRole("button", {
        name: /再試行/,
      }),
    ).toBeTruthy();
  });

  it("reports a failed operation, lets it be dismissed, and never blocks the UI", async () => {
    const harness = await renderShell();
    harness.gateway.failOn("openProject", "ioError");
    await harness.user.click(
      screen.getByRole("button", { name: "Projectを開く" }),
    );

    const panel = await screen.findByRole("region", { name: "通知" });
    expect(within(panel).getByText(/Projectを開けませんでした/)).toBeTruthy();
    expect(
      within(panel).getByText(/ファイルの読み書きに失敗しました/),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The developer detail is in the expandable details, not the headline.
    expect(within(panel).getByText("injected: openProject")).toBeTruthy();

    await harness.user.click(
      within(panel).getByRole("button", { name: "この通知を消す" }),
    );
    expect(screen.getByRole("button", { name: "通知なし" })).toBeTruthy();
    // The app is still usable: the project opens on the next try.
    await harness.openProjectInUi();
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});

describe("accessibility roles and names", () => {
  it("exposes tree, tabs, tab panels, status and named buttons", async () => {
    const harness = await renderShell();
    await harness.openProjectInUi();
    await openDocumentByClick(harness.user, "Document A");

    expect(screen.getByRole("tree", { name: "Project Tree" })).toBeTruthy();
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    expect(screen.getByRole("tablist", { name: "Document Tabs" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Sheet Tabs" })).toBeTruthy();
    // Document panel, sheet panel and the left panel (Project | Git).
    expect(screen.getAllByRole("tabpanel")).toHaveLength(3);
    expect(screen.getByRole("status", { name: "読み込み状況" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(screen.getAllByRole("button", { name: /.+/ })).toHaveLength(
      buttons.length,
    );
    // Selected tabs are the tab stops; the others are reached with the arrow keys.
    const activeTab = documentTab(/Document A/);
    expect(activeTab.getAttribute("tabindex")).toBe("0");
  });
});
