import { useEffect } from "react";
import { createStore } from "../../shared/store/store";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { useMessages } from "../workspace/use-messages";

// "A print window is open. Stop printing and close?" — asked when the window is closed
// while one of its print windows is open, before the question about unsaved changes.
// One question at a time; a new one answers an open one as "no".
const pending = createStore<{
  readonly answer: ((stop: boolean) => void) | null;
}>({
  answer: null,
});

export function askCloseWhilePrinting(): Promise<boolean> {
  pending.getState().answer?.(false);
  return new Promise<boolean>((resolve) => {
    pending.setState({
      answer: (stop) => {
        pending.setState({ answer: null });
        resolve(stop);
      },
    });
  });
}

export function PrintingCloseDialog() {
  const messages = useMessages().export;
  const answer = useStoreSelector(pending, (state) => state.answer);
  // An open question goes with the shell (answered "no", so nothing waits for it).
  useEffect(() => () => pending.getState().answer?.(false), []);
  if (answer === null) return null;
  return (
    <ConfirmDialog
      title={messages.closeWhilePrintingTitle}
      paragraphs={[messages.closeWhilePrinting]}
      cancelLabel={messages.cancel}
      confirmLabel={messages.closeAnyway}
      onCancel={() => answer(false)}
      onConfirm={() => answer(true)}
      busy={false}
    />
  );
}
