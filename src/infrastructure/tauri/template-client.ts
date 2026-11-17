// Typed wrappers of the custom template commands (`commands/templates.rs`), with the shape
// of every payload checked before it reaches the application.

import type {
  TemplateBlockContent,
  TemplateContent,
  TemplateGateway,
  TemplateList,
  TemplateLoadIssue,
  TemplateSheetContent,
  TemplateSummary,
} from "../../application/ports/template-gateway";
import {
  TEMPLATE_KINDS,
  TEMPLATE_SCOPES,
} from "../../application/ports/template-gateway";
import { toImportedImageResult } from "./asset-payloads";
import { COMMANDS } from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import { call } from "./invoke-command";
import {
  arrayOf,
  type Decoder,
  decodeNumber,
  decodeString,
  objectOf,
  oneOf,
  optional,
} from "./payload-decoder";
import { toVoidResult } from "./persistence-payloads";

const PAYLOAD_ROOT = "payload";

const scope = oneOf(TEMPLATE_SCOPES);
const kind = oneOf(TEMPLATE_KINDS);

const summary = objectOf<TemplateSummary>({
  scope,
  kind,
  templateId: decodeString,
  name: decodeString,
});
const issue = objectOf<TemplateLoadIssue>({
  scope,
  kind,
  folder: decodeString,
  detail: decodeString,
});
const list = objectOf<TemplateList>({
  templates: arrayOf(summary),
  issues: arrayOf(issue),
});
const block = objectOf<TemplateBlockContent>({
  blockType: decodeString,
  x: decodeNumber,
  y: decodeNumber,
  width: decodeNumber,
  height: decodeNumber,
  caption: optional(decodeString),
  captionPosition: optional(decodeString),
  text: optional(decodeString),
  asset: optional(decodeString),
});
const sheet = objectOf<TemplateSheetContent>({
  sheetName: decodeString,
  blocks: arrayOf(block),
});
const content = objectOf<TemplateContent>({
  name: decodeString,
  block: optional(block),
  sheets: arrayOf(sheet),
  documentName: optional(decodeString),
  assets: arrayOf(decodeString),
});

function decoderResult<T>(decoder: Decoder<T>) {
  return (payload: unknown): CommandResult<T> => {
    const decoded = decoder(payload, PAYLOAD_ROOT);
    return decoded.ok
      ? commandOk(decoded.value)
      : commandErr("invalidCommandResponse", decoded.detail);
  };
}

// `CommandResult` and `OperationResult` share one shape; only the void results (null on
// the wire) need adapting.
async function asVoid(
  result: Promise<CommandResult<null>>,
): Promise<CommandResult<undefined>> {
  const settled = await result;
  return settled.ok ? commandOk(undefined) : settled;
}

export function createTauriTemplateGateway(): TemplateGateway {
  return {
    listTemplates: (projectId) =>
      call(COMMANDS.listTemplates, { projectId }, decoderResult(list)),
    readTemplate: (projectId, template) =>
      call(
        COMMANDS.readTemplate,
        { projectId, ...template },
        decoderResult(content),
      ),
    saveTemplate: (projectId, documentId, templateScope, templateKind, value) =>
      call(
        COMMANDS.saveTemplate,
        {
          projectId,
          documentId,
          scope: templateScope,
          kind: templateKind,
          content: value,
        },
        decoderResult(summary),
      ),
    renameTemplate: (projectId, template, name) =>
      asVoid(
        call(
          COMMANDS.renameTemplate,
          { projectId, ...template, name },
          toVoidResult,
        ),
      ),
    deleteTemplate: (projectId, template) =>
      asVoid(
        call(COMMANDS.deleteTemplate, { projectId, ...template }, toVoidResult),
      ),
    moveTemplate: (projectId, template, toScope) =>
      asVoid(
        call(
          COMMANDS.moveTemplate,
          { projectId, ...template, toScope },
          toVoidResult,
        ),
      ),
    importTemplateAsset: (projectId, documentId, template, assetName) =>
      call(
        COMMANDS.importTemplateAsset,
        { projectId, documentId, ...template, assetName },
        toImportedImageResult,
      ),
  };
}
