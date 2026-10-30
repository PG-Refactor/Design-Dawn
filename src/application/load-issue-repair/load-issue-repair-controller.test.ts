import { describe, expect, it } from "vitest";
import {
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type {
  LoadIssueRef,
  RepairAction,
  RepairOutcome,
} from "../ports/persistence-types";
import {
  DOCUMENT_A,
  openedDocumentA,
  type WorkspaceHarness,
} from "../test-support/workspace-harness";
import {
  createLoadIssueRepairController,
  type LoadIssueRepairController,
  type RepairDone,
  type RepairOperation,
  type RepairTarget,
} from "./load-issue-repair-controller";

const ISSUE: LoadIssueRef = {
  kind: "orphanContent",
  path: "documents/a/sheets/s/blocks/x.md",
  entityId: null,
};
const DOCUMENT_TARGET: RepairTarget = {
  scope: "document",
  documentId: DOCUMENT_A,
};
const PROJECT_TARGET: RepairTarget = { scope: "project" };

interface Setup {
  readonly harness: WorkspaceHarness;
  readonly controller: LoadIssueRepairController;
  // Everything the controller did, in order.
  readonly log: string[];
  readonly state: { unsaved: boolean; blocked: boolean; saveFails: boolean };
  readonly failures: { operation: RepairOperation; error: OperationError }[];
  readonly done: RepairDone[];
}

async function setup(): Promise<Setup> {
  const harness = await openedDocumentA();
  const log: string[] = [];
  const state = { unsaved: false, blocked: false, saveFails: false };
  const failures: Setup["failures"] = [];
  const done: RepairDone[] = [];
  const controller = createLoadIssueRepairController({
    gateway: harness.gateway,
    applicationStore: harness.store,
    hasUnsaved: () => state.unsaved,
    saveAll: async (): Promise<OperationResult<void>> => {
      log.push("saveAll");
      if (state.saveFails) return operationErr("ioError", "disk full");
      state.unsaved = false;
      return operationOk(undefined);
    },
    reload: {
      document: async (documentId) => {
        log.push(`reload:document:${documentId}`);
        return operationOk(undefined);
      },
      project: async () => {
        log.push("reload:project");
        return operationOk(undefined);
      },
    },
    underBusy: async (task) => {
      log.push("busy:start");
      try {
        return await task();
      } finally {
        log.push("busy:end");
      }
    },
    isBlocked: () => state.blocked,
    reportFailure: (operation, error) => failures.push({ operation, error }),
    notifyDone: (kind) => done.push(kind),
  });
  harness.gateway.clearCalls();
  return { harness, controller, log, state, failures, done };
}

function outcome(overrides: Partial<RepairOutcome> = {}): RepairOutcome {
  return {
    applied: false,
    files: ["documents/a/sheets/s/blocks/x.md"],
    unavailable: null,
    issues: [],
    ...overrides,
  };
}

describe("LoadIssueRepairController", () => {
  it("asks Rust for a dry run first and writes nothing before the user confirms", async () => {
    const { harness, controller } = await setup();
    harness.gateway.setRepairOutcome(outcome());

    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");

    expect(harness.gateway.repairRequests).toEqual([
      {
        documentId: DOCUMENT_A,
        issue: ISSUE,
        action: "deleteFile",
        dryRun: true,
      },
    ]);
    expect(controller.store.getState()).toEqual({
      status: "confirm",
      request: {
        kind: "issue",
        target: DOCUMENT_TARGET,
        issue: ISSUE,
        action: "deleteFile",
      },
      files: ["documents/a/sheets/s/blocks/x.md"],
      needsSave: false,
    });
  });

  it("sends a null document for an issue of the Project's own load", async () => {
    const { harness, controller } = await setup();
    await controller.request(PROJECT_TARGET, ISSUE, "deleteFile");
    expect(harness.gateway.repairRequests[0]?.documentId).toBeNull();
  });

  it("shows why a repair is unavailable instead of a confirmation", async () => {
    const { harness, controller } = await setup();
    harness.gateway.setRepairOutcome(
      outcome({ unavailable: "referencedElsewhere", files: [] }),
    );

    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");

    const state = controller.store.getState();
    expect(state.status).toBe("unavailable");
    expect(state.status === "unavailable" && state.reason).toBe(
      "referencedElsewhere",
    );
    expect(harness.gateway.repairRequests).toHaveLength(1);
  });

  it("reports a failed dry run and opens nothing", async () => {
    const { harness, controller, failures } = await setup();
    harness.gateway.failOn("repairLoadIssue", "entityNotFound");
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    expect(controller.store.getState().status).toBe("idle");
    expect(failures.map((entry) => entry.operation)).toEqual([
      "repairLoadIssue",
    ]);
  });

  it("does not ask while the workspace is busy", async () => {
    const { harness, controller, state } = await setup();
    state.blocked = true;
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    controller.requestReload(PROJECT_TARGET);
    controller.requestFormatUpdate(["project.json"]);
    expect(harness.gateway.repairRequests).toEqual([]);
    expect(controller.store.getState().status).toBe("idle");
  });

  it("applies under busy, then reads the Document again, then reports it repaired", async () => {
    const { harness, controller, log, done } = await setup();
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");

    await controller.confirm();

    expect(harness.gateway.repairRequests.map((r) => r.dryRun)).toEqual([
      true,
      false,
    ]);
    expect(log).toEqual([
      "busy:start",
      `reload:document:${DOCUMENT_A}`,
      "busy:end",
    ]);
    expect(done).toEqual(["repaired"]);
    expect(controller.store.getState().status).toBe("idle");
  });

  it("reads the whole Project again after a Project-level repair", async () => {
    const { controller, log } = await setup();
    await controller.request(PROJECT_TARGET, ISSUE, "deleteFile");
    await controller.confirm();
    expect(log).toContain("reload:project");
    expect(log.some((entry) => entry.startsWith("reload:document"))).toBe(
      false,
    );
  });

  it("saves unsaved work first and only then repairs", async () => {
    const { harness, controller, log, state } = await setup();
    state.unsaved = true;
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    const asked = controller.store.getState();
    expect(asked.status === "confirm" && asked.needsSave).toBe(true);

    await controller.confirm();

    expect(log.indexOf("saveAll")).toBeGreaterThan(-1);
    expect(log.indexOf("saveAll")).toBeLessThan(
      log.indexOf(`reload:document:${DOCUMENT_A}`),
    );
    expect(harness.gateway.repairRequests.at(-1)?.dryRun).toBe(false);
  });

  it("changes nothing when the save before it fails", async () => {
    const { harness, controller, log, state, done } = await setup();
    state.unsaved = true;
    state.saveFails = true;
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");

    await controller.confirm();

    expect(harness.gateway.repairRequests.map((r) => r.dryRun)).toEqual([true]);
    expect(log.some((entry) => entry.startsWith("reload"))).toBe(false);
    expect(done).toEqual([]);
    expect(controller.store.getState().status).toBe("idle");
  });

  it("reports a failed repair, still reads the files again, and does not call it repaired", async () => {
    const { harness, controller, log, failures, done } = await setup();
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    harness.gateway.failOn("repairLoadIssue", "externallyModified");

    await controller.confirm();

    expect(failures.map((entry) => entry.error.kind)).toEqual([
      "externallyModified",
    ]);
    // Files may differ from memory after a partial change, so they are read again.
    expect(log).toContain(`reload:document:${DOCUMENT_A}`);
    expect(done).toEqual([]);
  });

  it("shows the reason and reads nothing again when Rust finds the repair unavailable now", async () => {
    const { harness, controller, log, done } = await setup();
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    harness.gateway.setRepairOutcome(
      outcome({ unavailable: "issueGone", files: [] }),
    );

    await controller.confirm();

    const state = controller.store.getState();
    expect(state.status === "unavailable" && state.reason).toBe("issueGone");
    expect(log.some((entry) => entry.startsWith("reload"))).toBe(false);
    expect(done).toEqual([]);
  });

  it("ignores a second confirm while the first runs", async () => {
    const { harness, controller } = await setup();
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    const first = controller.confirm();
    const second = controller.confirm();
    await Promise.all([first, second]);
    expect(
      harness.gateway.repairRequests.filter((request) => !request.dryRun),
    ).toHaveLength(1);
  });

  it("cancel closes the question and writes nothing", async () => {
    const { harness, controller } = await setup();
    await controller.request(DOCUMENT_TARGET, ISSUE, "deleteFile");
    controller.cancel();
    expect(controller.store.getState().status).toBe("idle");
    expect(harness.gateway.repairRequests).toHaveLength(1);
  });

  it("reads the files again on request without calling Rust to repair", async () => {
    const { harness, controller, log, done } = await setup();
    controller.requestReload(DOCUMENT_TARGET);
    await controller.confirm();
    expect(harness.gateway.repairRequests).toEqual([]);
    expect(log).toContain(`reload:document:${DOCUMENT_A}`);
    expect(done).toEqual(["reloaded"]);
  });

  it("updates every older-format file, then reads the Project again", async () => {
    const { harness, controller, log, done } = await setup();
    harness.gateway.setFormatUpdate({ updated: ["project.json"] });
    controller.requestFormatUpdate(["project.json"]);
    const asked = controller.store.getState();
    expect(asked.status === "confirm" && asked.files).toEqual(["project.json"]);

    await controller.confirm();

    expect(harness.gateway.formatUpdateCalls).toBe(1);
    expect(log).toContain("reload:project");
    expect(done).toEqual(["formatUpdated"]);
  });

  it("reports a failed format update (an external change stops it) and reads again", async () => {
    const { harness, controller, failures, done } = await setup();
    harness.gateway.failOn("updateOutdatedFiles", "externallyModified");
    controller.requestFormatUpdate(["project.json"]);
    await controller.confirm();
    expect(failures).toEqual([
      expect.objectContaining({ operation: "updateFileFormat" }),
    ]);
    expect(done).toEqual([]);
  });
});

// Keeps the action list in the test honest: every action is a valid button.
const ALL_ACTIONS: readonly RepairAction[] = [
  "addToList",
  "removeFromList",
  "giveNewId",
  "removeBlock",
  "createEmptyContent",
  "deleteFile",
  "addAsBlock",
  "deleteTempFile",
];
describe("repair catalog", () => {
  it("lists only known actions for every issue kind", async () => {
    const { REPAIR_ACTIONS_BY_ISSUE_KIND } = await import("./repair-catalog");
    for (const actions of Object.values(REPAIR_ACTIONS_BY_ISSUE_KIND)) {
      for (const action of actions) expect(ALL_ACTIONS).toContain(action);
    }
  });
});
