import { type DisplayName, parseDisplayName } from "../shared/display-name";
import { type DomainResult, err, ok } from "../shared/domain-result";
import {
  type DocumentId,
  type ProjectId,
  parseDocumentId,
  parseProjectId,
} from "../shared/entity-id";
import {
  addToOrder,
  findDuplicate,
  moveInOrder,
  removeFromOrder,
} from "../shared/ordered-ids";
import {
  parseSchemaVersion,
  type SchemaVersion,
} from "../shared/schema-version";

export interface Project {
  readonly schemaVersion: SchemaVersion;
  readonly projectId: ProjectId;
  readonly name: DisplayName;
  readonly documentOrder: readonly DocumentId[];
}

export interface RawProject {
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly name: string;
  readonly documentOrder: readonly string[];
}

function parseDocumentOrder(
  rawIds: readonly string[],
): DomainResult<readonly DocumentId[]> {
  const ids: DocumentId[] = [];
  for (const rawId of rawIds) {
    const id = parseDocumentId(rawId);
    if (!id.ok) return id;
    ids.push(id.value);
  }
  const duplicate = findDuplicate(ids);
  if (duplicate !== null) {
    return err(
      "duplicateId",
      `duplicate documentId in documentOrder: ${duplicate}`,
    );
  }
  return ok(ids);
}

export function parseProject(raw: RawProject): DomainResult<Project> {
  const schemaVersion = parseSchemaVersion("project", raw.schemaVersion);
  if (!schemaVersion.ok) return schemaVersion;
  const projectId = parseProjectId(raw.projectId);
  if (!projectId.ok) return projectId;
  const name = parseDisplayName(raw.name);
  if (!name.ok) return name;
  const documentOrder = parseDocumentOrder(raw.documentOrder);
  if (!documentOrder.ok) return documentOrder;
  return ok({
    schemaVersion: schemaVersion.value,
    projectId: projectId.value,
    name: name.value,
    documentOrder: documentOrder.value,
  });
}

export function renameProject(
  project: Project,
  name: DisplayName,
): DomainResult<Project> {
  return ok({ ...project, name });
}

function withDocumentOrder(
  project: Project,
  order: DomainResult<readonly DocumentId[]>,
): DomainResult<Project> {
  if (!order.ok) return order;
  return ok({ ...project, documentOrder: order.value });
}

export function addDocument(
  project: Project,
  documentId: DocumentId,
): DomainResult<Project> {
  return withDocumentOrder(
    project,
    addToOrder(project.documentOrder, documentId),
  );
}

export function removeDocument(
  project: Project,
  documentId: DocumentId,
): DomainResult<Project> {
  return withDocumentOrder(
    project,
    removeFromOrder(project.documentOrder, documentId),
  );
}

export function moveDocument(
  project: Project,
  documentId: DocumentId,
  beforeDocumentId: DocumentId | null,
): DomainResult<Project> {
  return withDocumentOrder(
    project,
    moveInOrder(project.documentOrder, documentId, beforeDocumentId),
  );
}
