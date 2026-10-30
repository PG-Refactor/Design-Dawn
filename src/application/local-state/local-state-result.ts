// Error kinds of the local state validators. They are not
// Project domain errors, so they get their own kind list; the identifiers are shared with
// Rust (`ErrorKind::as_str`) and the Rust/TypeScript kind-equality test covers them.
export const LOCAL_STATE_ERROR_KINDS = [
  "invalidThemePreference",
  "invalidLanguagePreference",
  "invalidViewport",
  "invalidProjectTreeWidth",
] as const;

export type LocalStateErrorKind = (typeof LOCAL_STATE_ERROR_KINDS)[number];

// Same shape as `DomainResult`, with the local state kinds.
export type LocalStateResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly kind: LocalStateErrorKind;
        // Developer-facing only; callers must compare on `kind`.
        readonly detail: string;
      };
    };

export function localStateOk<T>(value: T): LocalStateResult<T> {
  return { ok: true, value };
}

export function localStateErr<T = never>(
  kind: LocalStateErrorKind,
  detail: string,
): LocalStateResult<T> {
  return { ok: false, error: { kind, detail } };
}
