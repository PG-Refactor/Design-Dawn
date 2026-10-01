import { describe, expect, it } from "vitest";
import {
  blockIdOf,
  makeBlockAt,
  OTHER_SHEET_ID,
  SHEET_ID,
  sheetIdOf,
  textOf,
} from "../test-support/fakes";
import { defaultBlocks, openSession } from "../test-support/session-harness";

const FIRST = blockIdOf(1);
const SECOND = blockIdOf(2);

describe("loadSheetContents", () => {
  it("loads the text of every text block and marks it loaded", async () => {
    const { session, gateway } = openSession();
    expect(session.getState().contentStatus.size).toBe(0);
    expect((await session.loadSheetContents(SHEET_ID)).ok).toBe(true);
    const state = session.getState();
    for (const block of defaultBlocks()) {
      expect(state.contents.get(block.blockId)).toBe(textOf(block.blockId));
      expect(state.contentStatus.get(block.blockId)).toEqual({
        status: "loaded",
      });
    }
    expect(gateway.methods()).toEqual([
      "readBlockContent",
      "readBlockContent",
      "readBlockContent",
    ]);
  });

  it("publishes the loading status before the reads finish", async () => {
    const { session, gateway, states } = openSession();
    const release = gateway.hold("readBlockContent");
    const loading = session.loadSheetContents(SHEET_ID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(states.at(-1)?.contentStatus.get(FIRST)).toEqual({
      status: "loading",
    });
    release();
    await loading;
    expect(states.at(-1)?.contentStatus.get(FIRST)).toEqual({
      status: "loaded",
    });
  });

  it("treats empty text as valid loaded content", async () => {
    const { session, gateway } = openSession();
    for (const path of gateway.files.keys()) gateway.files.set(path, "");
    await session.loadSheetContents(SHEET_ID);
    expect(session.getState().contents.get(FIRST)).toBe("");
    expect(session.getState().contentStatus.get(FIRST)).toEqual({
      status: "loaded",
    });
  });

  it("keeps Japanese / multi-byte text unchanged", async () => {
    const { session, gateway } = openSession();
    const text = "# 設計ドキュメント\n日本語 😀 𠮷野家\n";
    const path = [...gateway.files.keys()][0] ?? "";
    gateway.files.set(path, text);
    await session.loadSheetContents(SHEET_ID);
    expect(session.getState().contents.get(FIRST)).toBe(text);
  });

  it("reports a missing file as failed without substituting an empty text", async () => {
    const { session, gateway } = openSession();
    const path = defaultBlocks()[0]?.contentPath ?? "";
    gateway.files.delete(path);
    const result = await session.loadSheetContents(SHEET_ID);
    expect(result.ok).toBe(true);
    const state = session.getState();
    expect(state.contents.has(FIRST)).toBe(false);
    const status = state.contentStatus.get(FIRST);
    expect(status?.status).toBe("failed");
    expect(status?.status === "failed" && status.error.kind).toBe(
      "fileNotFound",
    );
    expect(state.contentStatus.get(SECOND)).toEqual({ status: "loaded" });
  });

  it("reports a generic read failure with that error and retries it later", async () => {
    const { session, gateway } = openSession();
    gateway.failOn("readBlockContent", "ioError");
    await session.loadSheetContents(SHEET_ID);
    const failed = session.getState().contentStatus.get(FIRST);
    expect(failed?.status === "failed" && failed.error.kind).toBe("ioError");
    expect(session.getState().contents.has(FIRST)).toBe(false);

    gateway.clearCalls();
    await session.loadSheetContents(SHEET_ID);
    // Only the failed block is read again.
    expect(gateway.methods()).toEqual(["readBlockContent"]);
    expect(session.getState().contents.get(FIRST)).toBe(textOf(FIRST));
    expect(session.getState().contentStatus.get(FIRST)).toEqual({
      status: "loaded",
    });
  });

  it("is idempotent: loaded blocks cause no gateway call", async () => {
    const { session, gateway } = openSession();
    await session.loadSheetContents(SHEET_ID);
    const before = session.getState();
    gateway.clearCalls();
    expect((await session.loadSheetContents(SHEET_ID)).ok).toBe(true);
    expect(gateway.calls).toEqual([]);
    expect(session.getState().contents).toBe(before.contents);
  });

  it("is neither a history step nor a dirty change", async () => {
    const { session, scheduler } = openSession();
    await session.loadSheetContents(SHEET_ID);
    const { history, save } = session.getState();
    expect(history.canUndo).toBe(false);
    expect(save.dirtyContentBlockIds.size).toBe(0);
    expect(save.dirtySheetIds.size).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("skips non-text blocks", async () => {
    const image = makeBlockAt(9, 0, 0, "image");
    const { session, gateway } = openSession([makeBlockAt(1), image]);
    await session.loadSheetContents(SHEET_ID);
    expect(gateway.methods()).toEqual(["readBlockContent"]);
    expect(session.getState().contentStatus.has(image.blockId)).toBe(false);
  });

  it("fails with entityNotFound for an unknown sheet", async () => {
    const { session, gateway } = openSession();
    const result = await session.loadSheetContents(sheetIdOf(999));
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
    expect(gateway.calls).toEqual([]);
  });

  it("loads only the requested sheet", async () => {
    const { session, gateway } = openSession();
    await session.loadSheetContents(OTHER_SHEET_ID);
    expect(gateway.calls).toEqual([]);
    expect(session.getState().contents.size).toBe(0);
  });

  it("is rejected once the session is closed", async () => {
    const { session } = openSession();
    await session.close();
    const result = await session.loadSheetContents(SHEET_ID);
    expect(!result.ok && result.error.kind).toBe("notWritable");
  });
});
