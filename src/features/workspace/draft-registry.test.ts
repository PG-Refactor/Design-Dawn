import { describe, expect, it } from "vitest";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { DocumentId } from "../../domain/shared/entity-id";
import { createDraftRegistry, type DraftCommitter } from "./draft-registry";

const DOCUMENT_ONE = "01928f3a-0001-7000-8000-000000000001" as DocumentId;
const DOCUMENT_TWO = "01928f3a-0001-7000-8000-000000000002" as DocumentId;

function recordingCommitter(
  calls: string[],
  name: string,
  failure: "ioError" | null = null,
  documentId: DocumentId = DOCUMENT_ONE,
  pending = false,
): DraftCommitter {
  return {
    documentId,
    hasPendingDraft: () => pending,
    discardDraft: () => {
      calls.push(`discard:${name}`);
    },
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

  it("commitFor commits only the drafts of the given documents, in order, with the first error", async () => {
    const registry = createDraftRegistry();
    const calls: string[] = [];
    registry.register(recordingCommitter(calls, "a", null, DOCUMENT_ONE));
    registry.register(recordingCommitter(calls, "b", null, DOCUMENT_TWO));
    registry.register(recordingCommitter(calls, "c", "ioError", DOCUMENT_ONE));
    const result = await registry.commitFor([DOCUMENT_ONE]);
    expect(calls).toEqual(["a", "c"]);
    expect(!result.ok && result.error.detail).toBe("c failed");
    expect((await registry.commitFor([])).ok).toBe(true);
  });

  it("hasPendingFor looks only at the given documents", () => {
    const registry = createDraftRegistry();
    registry.register(recordingCommitter([], "a", null, DOCUMENT_ONE, false));
    const unregister = registry.register(
      recordingCommitter([], "b", null, DOCUMENT_TWO, true),
    );
    expect(registry.hasPendingFor([DOCUMENT_ONE])).toBe(false);
    expect(registry.hasPendingFor([DOCUMENT_ONE, DOCUMENT_TWO])).toBe(true);
    expect(registry.hasPendingFor([])).toBe(false);
    unregister();
    expect(registry.hasPendingFor([DOCUMENT_TWO])).toBe(false);
  });

  it("discardFor and discardAll drop drafts without committing them", async () => {
    const registry = createDraftRegistry();
    const calls: string[] = [];
    registry.register(recordingCommitter(calls, "a", null, DOCUMENT_ONE));
    registry.register(recordingCommitter(calls, "b", null, DOCUMENT_TWO));
    registry.discardFor([DOCUMENT_TWO]);
    expect(calls).toEqual(["discard:b"]);
    registry.discardAll();
    expect(calls).toEqual(["discard:b", "discard:a", "discard:b"]);
  });
});
