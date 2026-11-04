// Port for the AI integration: which Projects the MCP server (design-dawn-mcp) may use and
// whether an AI may change each one. The list lives in the app's own settings folder, never
// in a Project; only the app changes it.

import type { ProjectId } from "../../domain/shared/entity-id";
import type { OperationError, OperationResult } from "./operation-error";

export interface AiProjectAccess {
  readonly projectId: ProjectId;
  // Null when the folder no longer holds this Project (moved, deleted or replaced).
  readonly name: string | null;
  // Display only: never sent back to Rust.
  readonly folderDisplay: string;
  readonly allowWrite: boolean;
  // The Project of the app window used last: what an AI works on unless it chooses another.
  readonly current: boolean;
}

export interface AiAccessOverview {
  // Where the MCP server is (beside the app); `found` is false when the file is missing.
  readonly mcpServer: { readonly displayPath: string; readonly found: boolean };
  // The one added last first.
  readonly projects: readonly AiProjectAccess[];
  // The Project this window has open (null: none), and whether it is offered to AI.
  readonly openProject: {
    readonly projectId: ProjectId;
    readonly listed: boolean;
  } | null;
  // Why the stored list could not be read; the list is then shown empty.
  readonly loadIssue: OperationError | null;
}

// What choosing a folder to add came to.
export type AiProjectFolderAddition = "added" | "cancelled";

export interface AiAccessGateway {
  overview(): Promise<OperationResult<AiAccessOverview>>;
  // Offers the Project open in this window.
  addOpenProject(): Promise<OperationResult<void>>;
  // Lets the user choose a Project folder (the OS dialog) and offers that Project.
  addProjectFolder(): Promise<OperationResult<AiProjectFolderAddition>>;
  setWriteAccess(
    projectId: ProjectId,
    allowWrite: boolean,
  ): Promise<OperationResult<void>>;
  remove(projectId: ProjectId): Promise<OperationResult<void>>;
}
