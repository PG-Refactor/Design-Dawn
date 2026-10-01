import {
  CURRENT_SCHEMA_VERSIONS,
  MIN_SCHEMA_VERSION,
  type SchemaEntityKind,
} from "../domain-constants";
import type { Brand } from "./brand";
import { type DomainResult, err, ok } from "./domain-result";

export type SchemaVersion = Brand<number, "SchemaVersion">;

export function parseSchemaVersion(
  entity: SchemaEntityKind,
  value: number,
): DomainResult<SchemaVersion> {
  if (!Number.isInteger(value) || value < MIN_SCHEMA_VERSION) {
    return err(
      "invalidSchemaVersion",
      `${entity} schemaVersion is not an integer >= ${MIN_SCHEMA_VERSION}: ${value}`,
    );
  }
  const current = CURRENT_SCHEMA_VERSIONS[entity];
  if (value > current) {
    return err(
      "unsupportedSchemaVersion",
      `${entity} schemaVersion ${value} is newer than supported ${current}`,
    );
  }
  return ok(value as SchemaVersion);
}
