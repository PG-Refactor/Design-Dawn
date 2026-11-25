// The text a regular expression captured in group `index`: empty when the group took no
// part in the match (an optional group), so the readers need no fallback of their own.
export function capturedText(match: RegExpMatchArray, index: number): string {
  return match[index] ?? "";
}
