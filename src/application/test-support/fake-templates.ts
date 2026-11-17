// In-memory template places for tests. Not imported by production code.

import type { ContentPath } from "../../domain/block/content-path";
import {
  type OperationError,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type {
  TemplateContent,
  TemplateGateway,
  TemplateRef,
  TemplateSummary,
} from "../ports/template-gateway";

export interface StoredTemplate {
  readonly summary: TemplateSummary;
  // As read back: image assets by their file name.
  readonly content: TemplateContent;
  // The Document the images came from, when saved.
  readonly documentId: string | null;
}

export interface FakeTemplateGateway extends TemplateGateway {
  readonly stored: StoredTemplate[];
  // Assets imported into Documents, in order.
  readonly imported: { documentId: string; assetName: string }[];
  failNext: OperationError | null;
}

const fileName = (path: string) => path.split("/").at(-1) ?? path;

export function createFakeTemplateGateway(): FakeTemplateGateway {
  let counter = 0;
  const find = (template: TemplateRef) =>
    gateway.stored.findIndex(
      (entry) =>
        entry.summary.scope === template.scope &&
        entry.summary.kind === template.kind &&
        entry.summary.templateId === template.templateId,
    );
  function failure() {
    const failing = gateway.failNext;
    gateway.failNext = null;
    return failing;
  }
  const gateway: FakeTemplateGateway = {
    stored: [],
    imported: [],
    failNext: null,
    async listTemplates() {
      const failing = failure();
      if (failing !== null) return operationErr(failing.kind, failing.detail);
      return operationOk({
        templates: gateway.stored.map((entry) => entry.summary),
        issues: [],
      });
    },
    async readTemplate(_projectId, template) {
      const index = find(template);
      const entry = gateway.stored[index];
      return entry === undefined
        ? operationErr("entityNotFound", template.templateId)
        : operationOk(entry.content);
    },
    async saveTemplate(_projectId, documentId, scope, kind, content) {
      const failing = failure();
      if (failing !== null) return operationErr(failing.kind, failing.detail);
      counter += 1;
      const summary: TemplateSummary = {
        scope,
        kind,
        templateId: `template-${counter}`,
        name: content.name,
      };
      const asStored = (
        block: TemplateContent["sheets"][number]["blocks"][number],
      ) =>
        block.asset === undefined
          ? block
          : { ...block, asset: fileName(block.asset) };
      gateway.stored.push({
        summary,
        documentId,
        content: {
          ...content,
          ...(content.block === undefined
            ? {}
            : { block: asStored(content.block) }),
          sheets: content.sheets.map((sheet) => ({
            ...sheet,
            blocks: sheet.blocks.map(asStored),
          })),
          assets: content.assets.map(fileName),
        },
      });
      return operationOk(summary);
    },
    async renameTemplate(_projectId, template, name) {
      const index = find(template);
      const entry = gateway.stored[index];
      if (entry === undefined) return operationErr("entityNotFound", "");
      gateway.stored[index] = {
        ...entry,
        summary: { ...entry.summary, name },
        content: { ...entry.content, name },
      };
      return operationOk(undefined);
    },
    async deleteTemplate(_projectId, template) {
      const index = find(template);
      if (index < 0) return operationErr("entityNotFound", "");
      gateway.stored.splice(index, 1);
      return operationOk(undefined);
    },
    async moveTemplate(_projectId, template, toScope) {
      const index = find(template);
      const entry = gateway.stored[index];
      if (entry === undefined) return operationErr("entityNotFound", "");
      gateway.stored[index] = {
        ...entry,
        summary: { ...entry.summary, scope: toScope },
      };
      return operationOk(undefined);
    },
    async importTemplateAsset(_projectId, documentId, _template, assetName) {
      gateway.imported.push({ documentId, assetName });
      return operationOk({
        contentPath: `assets/${assetName}` as ContentPath,
        naturalWidth: 640,
        naturalHeight: 480,
        initialWidth: 160,
        initialHeight: 120,
        blockType: "image",
      });
    },
  };
  return gateway;
}
