// Port for the AI integration: which Projects the MCP server (design-dawn-mcp) may use and
// whether an AI may change each one. The list lives in the app's own settings folder, never
// in a Project; only the app changes it.

import type { ProjectId } from "../../domain/shared/entity-id";
import type { ImportedImage } from "./asset-types";
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

// The user's answer to an AI's request for edit permission.
export const AI_ACCESS_ANSWERS = [
  "allow",
  "allowUntilAppExits",
  "deny",
] as const;
export type AiAccessAnswer = (typeof AI_ACCESS_ANSWERS)[number];

// What choosing a folder to add came to.
export type AiProjectFolderAddition = "added" | "cancelled";

// One write an AI tool made through the MCP server (kept by the app's settings, not in the
// Project). `before` / `after` are a Block's text around an `updateBlock`, when kept.
export interface AiHistoryEntry {
  // Seconds since the Unix epoch.
  readonly at: number;
  readonly tool: string;
  readonly documentId: string | null;
  readonly sheetId: string | null;
  readonly blockId: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly afterHash: string | null;
}

export interface AiAccessGateway {
  // The picture an AI asks to add (a `data:` URL), validated like a dropped image.
  imageRequestPreview(requestId: string): Promise<OperationResult<string>>;
  // The user's answer to an image request. "Allow" imports the file into the Document's
  // assets (the Document must be open) and returns it to place; "deny" returns null.
  answerImageRequest(
    requestId: string,
    allow: boolean,
  ): Promise<OperationResult<ImportedImage | null>>;
  // What AI tools changed in the Project, newest first.
  history(
    projectId: ProjectId,
  ): Promise<OperationResult<readonly AiHistoryEntry[]>>;
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
  answerRequest(
    projectId: ProjectId,
    answer: AiAccessAnswer,
  ): Promise<OperationResult<void>>;
}
