import { describe, expect, it } from "vitest";
import {
  DOCUMENT_A,
  DOCUMENT_B,
} from "../../application/test-support/workspace-harness";
import { createActionsHarness } from "./test-support/actions-harness";

describe("opening the launch request", () => {
  it("installs the project and opens and activates the requested document", async () => {
    const harness = createActionsHarness();
    harness.gateway.queueOpenRequest(DOCUMENT_B);

    const result = await harness.actions.openLaunchRequest();

    expect(result.ok).toBe(true);
    expect(harness.store.getState().project).not.toBeNull();
    expect(harness.store.getState().documents.has(DOCUMENT_B)).toBe(true);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_B);
    // Rust opened the project already: the dialog path is never involved.
    expect(
      harness.gateway.methods("selectProjectFolder", "openProject"),
    ).toEqual([]);
  });

  it("does nothing when no request is pending", async () => {
    const harness = createActionsHarness();

    const result = await harness.actions.openLaunchRequest();

    expect(result.ok).toBe(true);
    expect(harness.store.getState().project).toBeNull();
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("takes the request once however often it is called", async () => {
    const harness = createActionsHarness();
    harness.gateway.queueOpenRequest(DOCUMENT_A);

    await Promise.all([
      harness.actions.openLaunchRequest(),
      harness.actions.openLaunchRequest(),
    ]);
    await harness.actions.openLaunchRequest();

    expect(harness.gateway.methods("takeOpenRequest")).toEqual([
      "takeOpenRequest",
    ]);
    expect(harness.gateway.methods("loadDocument")).toEqual(["loadDocument"]);
  });

  it("reports a failure as an operation error and installs nothing", async () => {
    const harness = createActionsHarness();
    harness.gateway.queueOpenRequest(DOCUMENT_A);
    harness.gateway.failOn("takeOpenRequest", "fileNotFound");

    const result = await harness.actions.openLaunchRequest();

    expect(result.ok).toBe(false);
    expect(harness.store.getState().project).toBeNull();
    const [error] = harness.uiStateStore.getState().operationErrors;
    expect(error).toMatchObject({ operation: "openLaunchRequest" });
  });
});
