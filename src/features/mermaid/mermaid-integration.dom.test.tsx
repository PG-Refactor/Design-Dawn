// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editBlockContentCommand } from "../../application/commands/content-commands";
import { makeBlockAt, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { BLOCK_ONE } from "../canvas/test-support/canvas-harness";
import { confirmGitDiscard, requestGitDiscard } from "../git/git-discard-flow";
import {
  blockOption,
  canvasElement,
  renderOpenedCanvas,
} from "../markdown/test-support/markdown-harness";
import {
  type ActionsHarness,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { MERMAID_MESSAGES } from "./mermaid-messages";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import {
  createDeferredRenderer,
  createFakeRenderer,
  type DeferredMermaidRenderer,
  fakeSvg,
  installObjectUrlFake,
  type ObjectUrlFake,
} from "./test-support/fake-mermaid-renderer";

// A Mermaid block against the history and the Git discard flow, at the shell level with a
// fake renderer. Save, undo and reload on the application level are in
// document-session/mermaid-save-integration.test.ts.

let objectUrls: ObjectUrlFake;

beforeEach(() => {
  objectUrls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  objectUrls.restore();
});

const MESSAGES = MERMAID_MESSAGES.ja;
const ORIGINAL = "flowchart LR\n  X --> Y";
const EDITED = "sequenceDiagram\n  A->>B: hi";
const SECOND = "sequenceDiagram\n  A->>C: hello";
const MERMAID_OPTION = 0;
const MERMAID_PATH = makeBlockAt(1, 10, 20, "mermaid").contentPath;

function seedMermaid(source: string) {
  return (harness: ActionsHarness): void => {
    const blocks = [
      makeBlockAt(1, 10, 20, "mermaid"),
      makeBlockAt(2, 300, 40),
      makeBlockAt(3, 0, 200),
    ];
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, blocks);
    harness.gateway.files.set(MERMAID_PATH, source);
  };
}

const opened = (renderer: MermaidRenderer) =>
  renderOpenedCanvas(seedMermaid(ORIGINAL), { mermaidRenderer: renderer });
type Rendered = Awaited<ReturnType<typeof opened>>;

const previewOf = () =>
  screen.getByRole("region", { name: MESSAGES.previewLabel("00000001") });
const imageSrc = () =>
  (
    within(previewOf()).getByRole("img", {
      name: MESSAGES.diagramAlt("00000001"),
    }) as HTMLImageElement
  ).getAttribute("src");

const editCommand = (text: string) =>
  editBlockContentCommand({ sheetId: SHEET_A1, blockId: BLOCK_ONE, text });

async function commit(rendered: Rendered, text: string) {
  await act(async () => {
    await rendered.canvas.session.execute(editCommand(text));
    await settle();
  });
}

async function press(init: KeyboardEventInit) {
  await act(async () => {
    fireEvent.keyDown(canvasElement(), init);
    await settle();
  });
}

const undo = () => press({ key: "z", ctrlKey: true });
const redo = () => press({ key: "y", ctrlKey: true });

const contentOf = (rendered: Rendered) =>
  rendered.canvas.session.getState().contents.get(BLOCK_ONE);

// The index-th render request for `source` (the deferred renderer keeps every request).
async function requestFor(
  renderer: DeferredMermaidRenderer,
  source: string,
  index = 0,
) {
  await waitFor(() =>
    expect(
      renderer.pending.filter((request) => request.source === source).length,
    ).toBeGreaterThan(index),
  );
  const request = renderer.pending.filter(
    (candidate) => candidate.source === source,
  )[index];
  if (request === undefined) throw new Error("render request missing");
  return request;
}

async function answer(
  request: { resolve(outcome: { ok: true; svg: string }): void },
  label: string,
) {
  await act(async () => {
    request.resolve({ ok: true, svg: fakeSvg(label) });
    await settle();
  });
}

describe("undo and redo against the normal-view preview", () => {
  it("draws the original source after undo and the edited source after redo", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await opened(renderer);
    await answer(await requestFor(renderer, ORIGINAL), "original");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-1"));

    await commit(rendered, EDITED);
    await answer(await requestFor(renderer, EDITED), "edited");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-2"));

    await undo();
    expect(contentOf(rendered)).toBe(ORIGINAL);
    await answer(await requestFor(renderer, ORIGINAL, 1), "original");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-3"));

    await redo();
    expect(contentOf(rendered)).toBe(EDITED);
    await answer(await requestFor(renderer, EDITED, 1), "edited");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-4"));

    expect(renderer.pending.map((request) => request.source)).toEqual([
      ORIGINAL,
      EDITED,
      ORIGINAL,
      EDITED,
    ]);
    // Replaced images are released: only the shown one is alive.
    expect(objectUrls.live()).toEqual(["blob:fake-4"]);
  });

  it("ignores a slow render of the edited source that finishes after undo", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await opened(renderer);
    await answer(await requestFor(renderer, ORIGINAL), "original");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-1"));

    await commit(rendered, EDITED);
    const slow = await requestFor(renderer, EDITED);
    await undo();
    const restored = await requestFor(renderer, ORIGINAL, 1);

    await answer(restored, "original");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-2"));
    await answer(slow, "edited");

    // The late result neither made an image nor replaced the restored one.
    expect(objectUrls.created).toEqual(["blob:fake-1", "blob:fake-2"]);
    expect(imageSrc()).toBe("blob:fake-2");
    expect(contentOf(rendered)).toBe(ORIGINAL);
  });

  it("ignores a slow render of the edited source that finishes before the restored one", async () => {
    const renderer = createDeferredRenderer();
    const rendered = await opened(renderer);
    await answer(await requestFor(renderer, ORIGINAL), "original");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-1"));

    await commit(rendered, EDITED);
    const slow = await requestFor(renderer, EDITED);
    await undo();
    const restored = await requestFor(renderer, ORIGINAL, 1);

    await answer(slow, "edited");
    expect(objectUrls.created).toEqual(["blob:fake-1"]);
    expect(imageSrc()).toBe("blob:fake-1");

    await answer(restored, "original");
    await waitFor(() => expect(imageSrc()).toBe("blob:fake-2"));
    expect(objectUrls.live()).toEqual(["blob:fake-2"]);
  });
});

describe("consecutive edits and the history", () => {
  async function commitByEditor(
    rendered: Rendered,
    text: string,
  ): Promise<void> {
    fireEvent.doubleClick(blockOption(MERMAID_OPTION));
    const box = screen.getByRole("textbox", {
      name: MESSAGES.sourceLabel("00000001"),
    });
    await rendered.shell.user.clear(box);
    await rendered.shell.user.click(box);
    await rendered.shell.user.paste(text);
    await rendered.shell.user.click(canvasElement());
    await act(settle);
  }

  it("makes one entry per committed edit: two commits, two undos back to the original", async () => {
    const rendered = await opened(createFakeRenderer());
    await commitByEditor(rendered, EDITED);
    await commitByEditor(rendered, SECOND);
    const { session } = rendered.canvas;
    expect(contentOf(rendered)).toBe(SECOND);
    expect(await rendered.canvas.undoDepth()).toBe(2);
    expect(session.getState().history.undoLabel).toBe("editBlockContent");

    await undo();
    expect(contentOf(rendered)).toBe(EDITED);
    await undo();
    expect(contentOf(rendered)).toBe(ORIGINAL);
    expect(session.getState().history.canUndo).toBe(false);
    expect(session.getState().history.canRedo).toBe(true);
  });
});

describe("discarding the Git changes of a Mermaid source file", () => {
  it("closes the Document unsaved, reopens it and draws the source git restored", async () => {
    const renderer = createFakeRenderer();
    const rendered = await opened(renderer);
    const { shell } = rendered;
    await commit(rendered, EDITED);
    await act(() => shell.runAutoSave());
    expect(shell.gateway.files.get(MERMAID_PATH)).toBe(EDITED);
    // A later edit that is not on the disk yet: a discard throws it away like Markdown's.
    await commit(rendered, SECOND);
    expect(contentOf(rendered)).toBe(SECOND);

    shell.gitGateway.impactResult = {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: false,
    };
    await act(async () => {
      await requestGitDiscard(shell.services, [
        { path: MERMAID_PATH, untracked: false },
      ]);
    });
    shell.gateway.clearCalls();
    const release = shell.gitGateway.holdNextDiscard();
    let confirmed: Promise<void> = Promise.resolve();
    await act(async () => {
      confirmed = confirmGitDiscard(shell.services);
      await settle();
    });
    // What git does to the file while the Document is closed.
    shell.gateway.files.set(MERMAID_PATH, ORIGINAL);
    expect(
      shell.gateway.methods(
        "saveProject",
        "saveDocument",
        "saveSheet",
        "writeBlockContent",
      ),
    ).toEqual([]);
    await act(async () => {
      release();
      await confirmed;
      await settle();
    });

    await screen.findByRole("listbox", { name: "Sheet A1" });
    await waitFor(() => expect(imageSrc()).toMatch(/^blob:fake-/));
    expect(renderer.calls.at(-1)?.source).toBe(ORIGINAL);
    const reopened = shell.workspace.getDocumentSession(DOCUMENT_A);
    expect(reopened?.getState().history.canUndo).toBe(false);
    await act(async () => {
      await reopened?.loadSheetContents(SHEET_A1);
    });
    expect(reopened?.getState().contents.get(BLOCK_ONE)).toBe(ORIGINAL);
    expect(shell.gateway.files.get(MERMAID_PATH)).toBe(ORIGINAL);
    expect(
      shell.gateway.methods("saveSheet", "saveDocument", "writeBlockContent"),
    ).toEqual([]);
  });
});
