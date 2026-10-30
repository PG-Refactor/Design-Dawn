// Asking for, confirming and running the repair of a Load Issue (docs/architecture.md §14.15),
// and the two neighbours that follow the same steps: reading the files of a Document or the
// Project again, and "update all now" for files in an older format.
//
// Every one of them changes files behind the open Documents, so they all go the same way:
// a plan is asked of Rust without writing anything, the user confirms it, anything unsaved
// is saved first, the change is made, and the affected Document (or the whole Project) is
// read again from disk. None of it is part of Undo / Redo. UI-free: the dialog is
// `features/load-issue-repair`, and reading again (which restores the view) and the busy
// state are injected like for the external change controller.

import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import { createStore, type Store } from "../../shared/store/store";
import type { OperationError, OperationResult } from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type {
  LoadIssueRef,
  RepairAction,
  RepairUnavailableReason,
} from "../ports/persistence-types";
import type { ApplicationStore } from "../state/application-state";

// Which files the change reaches: the Project's own, or one open Document's.
export type RepairTarget =
  | { readonly scope: "project" }
  | { readonly scope: "document"; readonly documentId: DocumentId };

export type RepairRequest =
  | {
      readonly kind: "issue";
      readonly target: RepairTarget;
      readonly issue: LoadIssueRef;
      readonly action: RepairAction;
    }
  | { readonly kind: "reload"; readonly target: RepairTarget }
  | { readonly kind: "formatUpdate" };

export type RepairOperation = "repairLoadIssue" | "updateFileFormat";

export type RepairDone = "repaired" | "reloaded" | "formatUpdated";

export type RepairPromptState =
  | { readonly status: "idle" }
  | {
      readonly status: "confirm";
      readonly request: RepairRequest;
      // Project-root-relative paths the change touches (from the dry run).
      readonly files: readonly string[];
      // Something in the affected files is unsaved: confirming saves it first.
      readonly needsSave: boolean;
    }
  | {
      readonly status: "running";
      readonly request: RepairRequest;
      readonly files: readonly string[];
      readonly needsSave: boolean;
    }
  | {
      readonly status: "unavailable";
      readonly request: RepairRequest;
      readonly reason: RepairUnavailableReason;
    };

export interface LoadIssueRepairDependencies {
  readonly gateway: Pick<
    PersistenceGateway,
    "repairLoadIssue" | "updateOutdatedFiles"
  >;
  readonly applicationStore: ApplicationStore;
  // Unsaved changes (including text still being typed) in the files the target reaches.
  readonly hasUnsaved: (target: RepairTarget) => boolean;
  readonly saveAll: () => Promise<OperationResult<unknown>>;
  readonly reload: {
    readonly document: (
      documentId: DocumentId,
    ) => Promise<OperationResult<void>>;
    readonly project: () => Promise<OperationResult<void>>;
  };
  // Runs `task` with the workspace busy, so nothing is edited and external-change reports
  // wait until it is done (the writes are the app's own).
  readonly underBusy: <T>(task: () => Promise<T>) => Promise<T>;
  readonly isBlocked: () => boolean;
  readonly reportFailure: (
    operation: RepairOperation,
    error: OperationError,
  ) => void;
  readonly notifyDone: (done: RepairDone) => void;
}

export interface LoadIssueRepairController {
  readonly store: Store<RepairPromptState>;
  // Asks Rust what the repair would change. Opens the confirmation, or says why it cannot be done.
  request(
    target: RepairTarget,
    issue: LoadIssueRef,
    action: RepairAction,
  ): Promise<void>;
  requestReload(target: RepairTarget): void;
  // `files`: the files listed in the older-format notice, shown in the confirmation.
  requestFormatUpdate(files: readonly string[]): void;
  confirm(): Promise<void>;
  cancel(): void;
}

const IDLE: RepairPromptState = { status: "idle" };

export function createLoadIssueRepairController(
  dependencies: LoadIssueRepairDependencies,
): LoadIssueRepairController {
  const {
    gateway,
    applicationStore,
    hasUnsaved,
    saveAll,
    reload,
    underBusy,
    isBlocked,
    reportFailure,
    notifyDone,
  } = dependencies;
  const store = createStore<RepairPromptState>(IDLE);

  function currentProjectId(): ProjectId | null {
    return applicationStore.getState().project?.projectId ?? null;
  }

  function targetOf(request: RepairRequest): RepairTarget {
    return request.kind === "formatUpdate"
      ? { scope: "project" }
      : request.target;
  }

  function operationOf(request: RepairRequest): RepairOperation {
    return request.kind === "formatUpdate"
      ? "updateFileFormat"
      : "repairLoadIssue";
  }

  function readAgain(target: RepairTarget): Promise<OperationResult<void>> {
    return target.scope === "document"
      ? reload.document(target.documentId)
      : reload.project();
  }

  async function request(
    target: RepairTarget,
    issue: LoadIssueRef,
    action: RepairAction,
  ): Promise<void> {
    const projectId = currentProjectId();
    if (projectId === null || isBlocked()) return;
    const documentId = target.scope === "document" ? target.documentId : null;
    const planned = await gateway.repairLoadIssue(
      projectId,
      documentId,
      issue,
      action,
      true,
    );
    const asked: RepairRequest = { kind: "issue", target, issue, action };
    if (!planned.ok) {
      reportFailure("repairLoadIssue", planned.error);
      return;
    }
    if (planned.value.unavailable !== null) {
      store.setState({
        status: "unavailable",
        request: asked,
        reason: planned.value.unavailable,
      });
      return;
    }
    store.setState({
      status: "confirm",
      request: asked,
      files: planned.value.files,
      needsSave: hasUnsaved(target),
    });
  }

  function requestReload(target: RepairTarget): void {
    if (isBlocked()) return;
    store.setState({
      status: "confirm",
      request: { kind: "reload", target },
      files: [],
      needsSave: hasUnsaved(target),
    });
  }

  function requestFormatUpdate(files: readonly string[]): void {
    if (isBlocked()) return;
    store.setState({
      status: "confirm",
      request: { kind: "formatUpdate" },
      files,
      needsSave: hasUnsaved({ scope: "project" }),
    });
  }

  // Makes the change. `unavailable`: Rust found it cannot be done now (the dialog says why);
  // `failed`: the change was refused or stopped (reported), files may still have changed.
  async function apply(
    projectId: ProjectId,
    asked: RepairRequest,
  ): Promise<"ok" | "failed" | "unavailable"> {
    if (asked.kind === "reload") return "ok";
    if (asked.kind === "formatUpdate") {
      const updated = await gateway.updateOutdatedFiles(projectId);
      if (updated.ok) return "ok";
      reportFailure("updateFileFormat", updated.error);
      return "failed";
    }
    const target = asked.target;
    const result = await gateway.repairLoadIssue(
      projectId,
      target.scope === "document" ? target.documentId : null,
      asked.issue,
      asked.action,
      false,
    );
    if (!result.ok) {
      reportFailure("repairLoadIssue", result.error);
      return "failed";
    }
    if (result.value.unavailable === null) return "ok";
    store.setState({
      status: "unavailable",
      request: asked,
      reason: result.value.unavailable,
    });
    return "unavailable";
  }

  async function confirm(): Promise<void> {
    const state = store.getState();
    const projectId = currentProjectId();
    if (state.status !== "confirm" || projectId === null) return;
    const asked = state.request;
    const target = targetOf(asked);
    store.setState({ ...state, status: "running" });
    const outcome = await underBusy(async () => {
      if (hasUnsaved(target)) {
        const saved = await saveAll();
        // A failed save is reported where it happened; nothing was changed.
        if (!saved.ok) return "failed" as const;
      }
      const applied = await apply(projectId, asked);
      if (applied === "unavailable") return "unavailable" as const;
      // Read again even when the change stopped half way: the files may differ from memory.
      const reloaded = await readAgain(target);
      if (!reloaded.ok) {
        reportFailure(operationOf(asked), reloaded.error);
        return "failed" as const;
      }
      return applied === "ok" ? ("done" as const) : ("failed" as const);
    });
    if (outcome === "unavailable") return;
    store.setState(IDLE);
    if (outcome === "done") {
      notifyDone(
        asked.kind === "reload"
          ? "reloaded"
          : asked.kind === "formatUpdate"
            ? "formatUpdated"
            : "repaired",
      );
    }
  }

  return {
    store,
    request,
    requestReload,
    requestFormatUpdate,
    confirm,
    cancel() {
      // A running change cannot be taken back.
      if (store.getState().status !== "running") store.setState(IDLE);
    },
  };
}
