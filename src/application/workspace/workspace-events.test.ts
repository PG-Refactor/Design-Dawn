import { describe, expect, it } from "vitest";
import { PROJECT_ID } from "../../domain/shared/test-fixtures";
import { createWorkspaceEvents } from "./workspace-events";

describe("workspace events", () => {
  it("delivers to subscribers until they unsubscribe", () => {
    const events = createWorkspaceEvents();
    const received: string[] = [];
    const unsubscribe = events.subscribe((event) => received.push(event.type));
    events.emit({ type: "projectClosed", projectId: PROJECT_ID });
    unsubscribe();
    events.emit({ type: "projectClosed", projectId: PROJECT_ID });
    expect(received).toEqual(["projectClosed"]);
  });

  it("keeps notifying others when a listener throws, and reports the failure", () => {
    const failures: unknown[] = [];
    const events = createWorkspaceEvents((failure) => failures.push(failure));
    const received: string[] = [];
    const fault = new Error("faulty subscriber");
    events.subscribe(() => {
      throw fault;
    });
    events.subscribe((event) => received.push(event.type));
    events.emit({ type: "projectClosed", projectId: PROJECT_ID });
    expect(received).toEqual(["projectClosed"]);
    expect(failures).toEqual([fault]);
  });
});
