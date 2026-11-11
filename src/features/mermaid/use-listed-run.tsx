import { type ReactNode, useCallback } from "react";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import { useDisplayLanguage, useMessages } from "../workspace/use-messages";
import { GuiStatus } from "./diagram-gui-layout";
import { describeRefusal } from "./diagram-gui-text";
import { LISTED_GUI_MESSAGES } from "./listed-gui-messages";
import {
  type DiagramOperationTarget,
  useDiagramOperation,
} from "./use-diagram-operation";

// One operation at a time for the ER / state / class editors, with the shared status line
// (busy, or why the last operation was refused).
export function useListedRun(target: DiagramOperationTarget): {
  readonly busy: boolean;
  readonly run: (operation: DiagramOperation) => Promise<boolean>;
  readonly status: ReactNode;
} {
  const gui = useMessages().mermaid.gui;
  const listed = LISTED_GUI_MESSAGES[useDisplayLanguage()];
  const operation = useDiagramOperation(target);
  const run = useCallback(
    async (request: DiagramOperation) =>
      (await operation.apply(request)) === "applied",
    [operation],
  );
  const refusal =
    operation.refusal === null
      ? null
      : describeRefusal(gui, operation.refusal, listed.reasons);
  return {
    busy: operation.busy,
    run,
    status: (
      <GuiStatus
        busy={operation.busy}
        busyText={gui.busy}
        refusalHeading={gui.refusalHeading}
        refusalDetailLabel={gui.refusalDetailLabel}
        message={refusal?.message ?? null}
        mermaidMessage={refusal?.mermaidMessage ?? null}
      />
    ),
  };
}
