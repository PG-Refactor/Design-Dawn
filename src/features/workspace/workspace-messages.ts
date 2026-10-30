// The workspace shell's texts per display language, plus the language-independent helpers
// that pick a sentence out of a catalog. Components get the
// catalog through `useMessages()`; code that is not a component receives it as a parameter.

import type { OperationErrorKind } from "../../application/ports/operation-error";
import type { LoadIssueKind } from "../../application/ports/persistence-types";
import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";
import type { OperationLabel, OperationSubject } from "./ui-state/ui-state";
import { WORKSPACE_MESSAGES_EN } from "./workspace-messages-en";
import { WORKSPACE_MESSAGES_JA } from "./workspace-messages-ja";

export type WorkspaceMessages = Widen<typeof WORKSPACE_MESSAGES_JA>;

export const WORKSPACE_MESSAGES: Readonly<
  Record<DisplayLanguage, WorkspaceMessages>
> = { ja: WORKSPACE_MESSAGES_JA, en: WORKSPACE_MESSAGES_EN };

export function describeErrorKind(
  messages: WorkspaceMessages,
  kind: OperationErrorKind,
): string {
  return messages.errorKinds[kind];
}

export function describeLoadIssueKind(
  messages: WorkspaceMessages,
  kind: LoadIssueKind,
): string {
  return messages.loadIssues[kind];
}

function subjectText(
  messages: WorkspaceMessages,
  subject: OperationSubject | null,
): string | null {
  if (subject === null) return null;
  if (typeof subject === "string") return subject;
  return "unnamed" in subject
    ? messages.tree.unnamedEntity
    : messages.skippedBlocks(subject.blockCount);
}

export function describeOperationFailure(
  messages: WorkspaceMessages,
  operation: OperationLabel,
  subject: OperationSubject | null,
  kind: OperationErrorKind,
): string {
  return messages.operationFailure(
    subjectText(messages, subject),
    messages.operationHeadlines[operation],
    describeErrorKind(messages, kind),
  );
}

export function describeSaveFailure(
  messages: WorkspaceMessages,
  documentName: string | null,
  kind: OperationErrorKind,
): string {
  return messages.saveFailure(documentName, describeErrorKind(messages, kind));
}

export function describeDocumentLoadStatus(
  messages: WorkspaceMessages,
  documentName: string,
): string {
  return messages.documentLoadStatus(
    messages.notifications.documentLoadedWithWarnings,
    documentName,
  );
}

// Inline validation text for the name dialogs. Decided from the input itself, because
// the domain error `detail` is for developers.
export function describeInvalidName(
  messages: WorkspaceMessages,
  input: string,
): string {
  return input.trim().length === 0
    ? messages.dialogs.nameRequired
    : messages.dialogs.nameInvalid;
}
