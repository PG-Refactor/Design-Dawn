// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  blockOption,
  renderOpenedCanvas,
  sourceBox,
} from "../markdown/test-support/markdown-harness";
import { makeDocumentADirty } from "./test-support/actions-harness";

afterEach(() => {
  cleanup();
});

const TOKEN = "subscription-token";
const WRITE_METHODS = ["saveProject", "saveDocument", "saveSheet"] as const;

async function requestClose(
  shell: Awaited<ReturnType<typeof renderOpenedCanvas>>["shell"],
): Promise<void> {
  await act(async () => {
    shell.closeRequestSource.emit({ subscriptionToken: TOKEN });
    await settle();
  });
}

describe("save before the window closes", () => {
  it("saves a dirty document, flushes the viewport, then confirms with the token", async () => {
    const { shell } = await renderOpenedCanvas();
    await makeDocumentADirty(shell);
    shell.gateway.clearCalls();
    const flush = vi.spyOn(shell.viewportPersistence, "flush");

    await requestClose(shell);

    expect(shell.gateway.methods(...WRITE_METHODS).length).toBeGreaterThan(0);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([TOKEN]);
  });

  it("does not confirm when saving fails, and a later request runs again", async () => {
    const { shell } = await renderOpenedCanvas();
    await makeDocumentADirty(shell);
    shell.gateway.failOn("saveDocument", "ioError");
    shell.gateway.failOn("saveSheet", "ioError");

    await requestClose(shell);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);

    shell.gateway.clearFailures();
    await requestClose(shell);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([TOKEN]);
  });

  it("registers one listener and removes it on unmount", async () => {
    const { shell } = await renderOpenedCanvas();
    expect(shell.closeRequestSource.listenerCount()).toBe(1);
    await act(async () => {
      shell.uiStateStore.setState((state) => ({ ...state }));
      await settle();
    });
    expect(shell.closeRequestSource.listenerCount()).toBe(1);

    cleanup();
    expect(shell.closeRequestSource.listenerCount()).toBe(0);
    await requestClose(shell);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);
  });
});

describe("closing while editing Markdown", () => {
  const EDITED = "# Edited\n\nbody";

  async function editing() {
    const rendered = await renderOpenedCanvas();
    fireEvent.doubleClick(blockOption(0));
    const box = sourceBox() as HTMLTextAreaElement;
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste(EDITED);
    return { ...rendered, box };
  }

  it("commits the draft as one history entry and writes it before confirming", async () => {
    const { shell, canvas, box } = await editing();

    await requestClose(shell);

    const path = canvas.blocksOfSheetA1()[0]?.contentPath ?? "";
    expect(shell.gateway.files.get(path)).toBe(EDITED);
    expect(await canvas.undoDepth()).toBe(1);
    expect(shell.closeRequestSource.confirmedTokens).toEqual([TOKEN]);
    expect(sourceBox()).toBe(box);
  });

  it("keeps the editor and the draft open when saving fails", async () => {
    const { shell, box } = await editing();
    shell.gateway.failOn("writeBlockContent", "ioError");

    await requestClose(shell);

    expect(shell.closeRequestSource.confirmedTokens).toEqual([]);
    expect(sourceBox()).toBe(box);
    expect(box.value).toBe(EDITED);
  });
});
