import { useMemo } from "react";
import type {
  ConflictTarget,
  DocumentConflict,
  ExternalChangeState,
  ProjectConflict,
} from "../../application/external-change/external-change-controller";
import {
  hasUnsavedDocumentChanges,
  hasUnsavedProjectChanges,
} from "../../application/state/unsaved-changes";
import { isTextBlockType } from "../../domain/block/block-type";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useWorkspaceServices } from "../workspace/workspace-services-context";

const identity = <Value>(value: Value): Value => value;

export function useExternalChangeState(): ExternalChangeState {
  const { externalChangeController } = useWorkspaceServices();
  return useStoreSelector(externalChangeController.store, identity);
}

// What the question or banner is about.
export type ConflictSubject =
  | {
      readonly kind: "document";
      readonly conflict: DocumentConflict;
      readonly name: string | null;
    }
  | { readonly kind: "project"; readonly conflict: ProjectConflict };

export function targetOf(subject: ConflictSubject): ConflictTarget {
  return subject.kind === "project"
    ? { kind: "project" }
    : { kind: "document", documentId: subject.conflict.documentId };
}

// Whether reading `subject` again would throw away unsaved work (it needs a confirmation).
export function useWouldLoseWork(subject: ConflictSubject): boolean {
  const { applicationStore, draftRegistry } = useWorkspaceServices();
  const application = useStoreSelector(applicationStore, identity);
  return useMemo(() => {
    if (subject.kind === "document") {
      const { documentId } = subject.conflict;
      return (
        hasUnsavedDocumentChanges(application, [documentId]) ||
        draftRegistry.hasPendingFor([documentId])
      );
    }
    return (
      hasUnsavedProjectChanges(application) ||
      draftRegistry.hasPendingFor([...application.documents.keys()])
    );
  }, [application, draftRegistry, subject]);
}

export function documentNameOf(
  application: ReturnType<typeof useAppState>,
  documentId: string,
): string | null {
  return (
    application.project?.documents.find(
      (entry) => entry.documentId === documentId,
    )?.name ?? null
  );
}

export function useAppState() {
  const { applicationStore } = useWorkspaceServices();
  return useStoreSelector(applicationStore, identity);
}

// The changed files of a Document that can be compared: those that are the text file of a
// Block of the open Document.
export function useTextContentPaths(
  documentId: string | null,
): ReadonlySet<string> {
  const application = useAppState();
  return useMemo(() => {
    const paths = new Set<string>();
    if (documentId === null) return paths;
    for (const state of application.documents.values()) {
      if (state.document.documentId !== documentId) continue;
      for (const sheet of state.sheets.values()) {
        for (const block of sheet.blocks) {
          if (isTextBlockType(block.blockType)) paths.add(block.contentPath);
        }
      }
    }
    return paths;
  }, [application, documentId]);
}
