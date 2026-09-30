import type { DomainResult } from "./domain-result";

// Test-only helper: fails loudly (with the error kind) when a fixture-like value is unexpectedly invalid.
export function unwrap<T>(result: DomainResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `unexpected domain error ${result.error.kind}: ${result.error.detail}`,
    );
  }
  return result.value;
}
