// Port for the custom templates: blocks, sheets and Documents saved to start new ones from,
// kept in three places (shared through the Project's Git, this Project for this person,
// every Project for this person). Templates are named by place, kind and id only.

import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import type { ImportedImage } from "./asset-types";
import type { OperationResult } from "./operation-error";

export const TEMPLATE_SCOPES = ["shared", "project", "global"] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const TEMPLATE_KINDS = [
  "markdown",
  "mermaid",
  "sheet",
  "document",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface TemplateSummary {
  readonly scope: TemplateScope;
  readonly kind: TemplateKind;
  readonly templateId: string;
  readonly name: string;
}

export interface TemplateLoadIssue {
  readonly scope: TemplateScope;
  readonly kind: TemplateKind;
  readonly folder: string;
  readonly detail: string;
}

export interface TemplateList {
  readonly templates: readonly TemplateSummary[];
  readonly issues: readonly TemplateLoadIssue[];
}

// A block: its text, or for an image the asset (on save, the Document's contentPath of the
// image; when read, the file name in the template's assets).
export interface TemplateBlockContent {
  readonly blockType: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly caption?: string;
  readonly captionPosition?: string;
  readonly text?: string;
  readonly asset?: string;
}

export interface TemplateSheetContent {
  readonly sheetName: string;
  readonly blocks: readonly TemplateBlockContent[];
}

export interface TemplateContent {
  readonly name: string;
  // A Markdown or Mermaid template.
  readonly block?: TemplateBlockContent;
  // One for a sheet template, every sheet for a Document template.
  readonly sheets: readonly TemplateSheetContent[];
  readonly documentName?: string;
  // Images the texts show: on save the Document's contentPaths, when read the file names.
  readonly assets: readonly string[];
}

export interface TemplateRef {
  readonly scope: TemplateScope;
  readonly kind: TemplateKind;
  readonly templateId: string;
}

export interface TemplateGateway {
  listTemplates(projectId: ProjectId): Promise<OperationResult<TemplateList>>;
  readTemplate(
    projectId: ProjectId,
    template: TemplateRef,
  ): Promise<OperationResult<TemplateContent>>;
  // `documentId`: where the images of `content` are.
  saveTemplate(
    projectId: ProjectId,
    documentId: DocumentId | null,
    scope: TemplateScope,
    kind: TemplateKind,
    content: TemplateContent,
  ): Promise<OperationResult<TemplateSummary>>;
  renameTemplate(
    projectId: ProjectId,
    template: TemplateRef,
    name: string,
  ): Promise<OperationResult<void>>;
  deleteTemplate(
    projectId: ProjectId,
    template: TemplateRef,
  ): Promise<OperationResult<void>>;
  moveTemplate(
    projectId: ProjectId,
    template: TemplateRef,
    toScope: TemplateScope,
  ): Promise<OperationResult<void>>;
  // One image of the template, copied into the Document's assets.
  importTemplateAsset(
    projectId: ProjectId,
    documentId: DocumentId,
    template: TemplateRef,
    assetName: string,
  ): Promise<OperationResult<ImportedImage>>;
}
