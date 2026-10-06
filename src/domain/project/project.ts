import { type DisplayName, parseDisplayName } from "../shared/display-name";
import { type DomainResult, ok } from "../shared/domain-result";
import {
  type DocumentId,
  type EntryId,
  type ProjectId,
  parseProjectId,
} from "../shared/entity-id";
import {
  addToOrder,
  moveInOrder,
  parseChildOrder,
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
  // Folders and Documents directly under the Project, in display order.
  readonly childOrder: readonly EntryId[];
}

export interface RawProject {
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly name: string;
  readonly childOrder: readonly string[];
}

export function parseProject(raw: RawProject): DomainResult<Project> {
  const schemaVersion = parseSchemaVersion("project", raw.schemaVersion);
  if (!schemaVersion.ok) return schemaVersion;
  const projectId = parseProjectId(raw.projectId);
  if (!projectId.ok) return projectId;
  const name = parseDisplayName(raw.name);
  if (!name.ok) return name;
  const childOrder = parseChildOrder(raw.childOrder, "childOrder");
  if (!childOrder.ok) return childOrder;
  return ok({
    schemaVersion: schemaVersion.value,
    projectId: projectId.value,
    name: name.value,
    childOrder: childOrder.value,
  });
}

export function renameProject(
  project: Project,
  name: DisplayName,
): DomainResult<Project> {
  return ok({ ...project, name });
}

function withChildOrder(
  project: Project,
  order: DomainResult<readonly EntryId[]>,
): DomainResult<Project> {
  if (!order.ok) return order;
  return ok({ ...project, childOrder: order.value });
}

export function addDocument(
  project: Project,
  documentId: DocumentId,
): DomainResult<Project> {
  return withChildOrder(project, addToOrder(project.childOrder, documentId));
}

export function removeDocument(
  project: Project,
  documentId: DocumentId,
): DomainResult<Project> {
  return withChildOrder(
    project,
    removeFromOrder(project.childOrder, documentId),
  );
}

export function moveDocument(
  project: Project,
  documentId: DocumentId,
  beforeEntryId: EntryId | null,
): DomainResult<Project> {
  return withChildOrder(
    project,
    moveInOrder(project.childOrder, documentId, beforeEntryId),
  );
}
