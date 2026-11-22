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

// The value of a success changed by `map`; a failure as it is.
export function mapOk<T, U>(
  result: DomainResult<T>,
  map: (value: T) => U,
): DomainResult<U> {
  return result.ok ? ok(map(result.value)) : result;
}
