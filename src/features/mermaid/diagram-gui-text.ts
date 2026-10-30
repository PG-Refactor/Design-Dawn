import type { OperationError } from "../../application/ports/operation-error";
import type { DiagramEditability } from "../../domain/diagram/diagram-source";
import type { MermaidMessages } from "./mermaid-messages";

type GuiMessages = MermaidMessages["gui"];

// Domain errors carry "<reasonCode>: <detail>"; the code is what the UI translates.
const REASON_SEPARATOR = ":";
const RENDER_REJECTED_CODE = "renderRejected";

function splitReason(text: string): { code: string; rest: string } {
  const at = text.indexOf(REASON_SEPARATOR);
  if (at < 0) return { code: text.trim(), rest: "" };
  return {
    code: text.slice(0, at).trim(),
    rest: text.slice(at + REASON_SEPARATOR.length).trim(),
  };
}

function lookup(
  table: Readonly<Record<string, string>>,
  code: string,
): string | undefined {
  return Object.hasOwn(table, code) ? table[code] : undefined;
}

export interface NotEditableText {
  readonly reason: string;
  // The editor's own detail line (for example which lines are unsupported); developer-level
  // text, shown as it is under the translated reason.
  readonly detail: string | null;
}

export function describeNotEditable(
  gui: GuiMessages,
  editability: Extract<DiagramEditability, { editable: false }>,
): NotEditableText {
  if (editability.reason === "editorRefused") {
    const { code, rest } = splitReason(editability.detail ?? "");
    return {
      reason: lookup(gui.notEditableReasons, code) ?? gui.notEditableFallback,
      detail: rest === "" ? null : rest,
    };
  }
  return {
    reason:
      lookup(gui.notEditableReasons, editability.reason) ??
      gui.notEditableFallback,
    detail: null,
  };
}

export interface RefusalText {
  readonly message: string;
  // Mermaid's own message when it rejected the drawing; shown as plain text.
  readonly mermaidMessage: string | null;
}

// The reason code is more specific than the error kind, so it wins when the catalog knows
// it; otherwise the kind's sentence, otherwise a generic one.
export function describeRefusal(
  gui: GuiMessages,
  error: OperationError,
  // Reason codes whose wording depends on the diagram type (for example what an ID may
  // hold); they win over the shared catalog.
  specificReasons: Readonly<Record<string, string>> = {},
): RefusalText {
  const { code, rest } = splitReason(error.detail);
  const mermaidMessage =
    error.kind === "diagramRenderRejected" &&
    code === RENDER_REJECTED_CODE &&
    rest !== ""
      ? rest
      : null;
  const message =
    lookup(specificReasons, code) ??
    lookup(gui.refusalReasons, code) ??
    lookup(gui.refusalKinds, error.kind) ??
    gui.refusalFallback;
  return { message, mermaidMessage };
}

// Why an element's control is unavailable: the same sentence the refused operation would
// give for the restriction code (the first word of its reason).
export function describeRestriction(
  gui: GuiMessages,
  code: string | null,
  specificReasons: Readonly<Record<string, string>> = {},
): string | null {
  if (code === null) return null;
  return (
    lookup(specificReasons, code) ??
    lookup(gui.refusalReasons, code) ??
    gui.refusalFallback
  );
}
