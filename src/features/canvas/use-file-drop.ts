import { useEffect } from "react";
import { setFileDragActive } from "../workspace/ui-state/ui-state";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { measureActiveCanvas } from "./block-dom";

// Connects the files dropped on the window (announced by Rust as ids and counts) to the
// canvas actions, and mirrors "files are being dragged over the window" into UI state for
// the canvas's drop hint. Mounted once by the workspace shell, NOT by a canvas: a drop
// that happens while no sheet is shown still has to be answered (with a notification).
export function useFileDrop(): void {
  const { dropEventSource, canvasActions, uiStateStore } =
    useWorkspaceServices();
  useEffect(() => {
    const stopDrops = dropEventSource.subscribeFilesDropped(({ dropId }) => {
      // Failures are recorded by the action (shown in the notifications).
      void canvasActions.importDroppedImages({
        dropId,
        viewportSize: measureActiveCanvas(),
      });
    });
    const stopDrag = dropEventSource.subscribeDragState(({ active }) =>
      uiStateStore.setState((state) => setFileDragActive(state, active)),
    );
    return () => {
      stopDrops();
      stopDrag();
      uiStateStore.setState((state) => setFileDragActive(state, false));
    };
  }, [dropEventSource, canvasActions, uiStateStore]);
}
