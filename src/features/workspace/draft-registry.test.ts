import { describe, expect, it } from "vitest";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { createDraftRegistry, type DraftCommitter } from "./draft-registry";

function recordingCommitter(
  calls: string[],
  name: string,
  failure: "ioError" | null = null,
): DraftCommitter {
  return {
    async commitDraft() {
      calls.push(name);
      return failure === null
        ? operationOk(undefined)
        : operationErr(failure, `${name} failed`);
    },
  };
}

describe("draft registry", () => {
  it("is ok when nothing is registered", async () => {
    expect((await createDraftRegistry().commitAll()).ok).toBe(true);
  });

  it("calls a registered committer", async () => {
    const registry = createDraftRegistry();
    const calls: string[] = [];
    registry.register(recordingCommitter(calls, "a"));
    expect((await registry.commitAll()).ok).toBe(true);
    expect(calls).toEqual(["a"]);
  });

  it("stops calling a committer after unregister, also when unregistered twice", async () => {
    const registry = createDraftRegistry();
    const calls: string[] = [];
    const unregister = registry.register(recordingCommitter(calls, "a"));
    registry.register(recordingCommitter(calls, "b"));
    unregister();
    unregister();
    await registry.commitAll();
    expect(calls).toEqual(["b"]);
  });

  it("runs every committer in order and returns the first error", async () => {
    const registry = createDraftRegistry();
    const calls: string[] = [];
    registry.register(recordingCommitter(calls, "a"));
    registry.register(recordingCommitter(calls, "b", "ioError"));
    registry.register(recordingCommitter(calls, "c", "ioError"));
    const result = await registry.commitAll();
    expect(calls).toEqual(["a", "b", "c"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.detail).toBe("b failed");
  });
});
