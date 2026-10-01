import type { DomainError, DomainErrorKind } from "./domain-error";

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DomainError };

export function ok<T>(value: T): DomainResult<T> {
  return { ok: true, value };
}

export function err<T = never>(
  kind: DomainErrorKind,
  detail: string,
): DomainResult<T> {
  return { ok: false, error: { kind, detail } };
}
