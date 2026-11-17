// The steps a menu item starts: asking for a name and place, then saving; or picking a
// Document template, asking for the new Document's name, then creating it.

import type { TemplateSummary } from "../../application/ports/template-gateway";
import type { DocumentId, FolderId } from "../../domain/shared/entity-id";
import type { PopupMenuEntry } from "../../shared/menu/menu-list";
import type { WorkspaceActions } from "../workspace/workspace-actions";
import type { CustomTemplates } from "./custom-templates";
import { askSaveTemplate, askTemplateDocumentName } from "./template-dialogs";
import { customTemplateEntries } from "./template-menu";
import type { TemplateMessages } from "./template-messages";

export async function saveDocumentAsTemplate(
  templates: CustomTemplates,
  actions: Pick<WorkspaceActions, "openDocument">,
  documentId: DocumentId,
  name: string,
): Promise<void> {
  const answer = await askSaveTemplate({ kind: "document", name });
  if (answer === null) return;
  // A Document is saved from what the app holds: it is opened first when it is not.
  const opened = await actions.openDocument(documentId);
  if (!opened.ok) return;
  await templates.saveDocument(documentId, answer.scope, answer.name);
}

export async function createDocumentFromTemplate(
  templates: CustomTemplates,
  template: TemplateSummary,
  parentFolderId: FolderId | null,
): Promise<void> {
  const name = await askTemplateDocumentName({
    templateName: template.name,
    name: await templates.documentNameOf(template),
  });
  if (name === null) return;
  await templates.createDocument(template, name, parentFolderId);
}

// "New Document from Template ▸" when there are Document templates; nothing otherwise.
export function documentFromTemplateEntries(
  templates: CustomTemplates,
  messages: TemplateMessages,
  parentFolderId: FolderId | null,
): PopupMenuEntry[] {
  const entries = customTemplateEntries(
    templates.store.getState().templates,
    ["document"],
    messages,
    (template) =>
      void createDocumentFromTemplate(templates, template, parentFolderId),
  );
  return entries.length === 0
    ? []
    : [
        {
          id: "createDocumentFromTemplate",
          label: messages.documentFromTemplate,
          entries,
        },
      ];
}
