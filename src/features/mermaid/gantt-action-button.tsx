import { useId } from "react";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { GuiButton } from "./gui-controls";

export interface GanttActionButtonProps {
  readonly label: string;
  // The code of the refusal the operation would give (shown as its reason), or null.
  readonly restriction: string | null;
  // How many implicit starts the operation would write as explicit dates.
  readonly freezes?: number;
  readonly busy: boolean;
  // Off without a reason to show (nothing chosen, or the element is gone).
  readonly unavailable?: boolean;
  readonly variant?: "default" | "danger";
  readonly onPress: () => void;
}

// A button whose availability comes from planning its operation: when it is off, the reason
// is shown and linked to the button; when it would fix starts to dates, it says so first.
export function GanttActionButton({
  label,
  restriction,
  freezes = 0,
  busy,
  unavailable = false,
  variant = "default",
  onPress,
}: GanttActionButtonProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.gantt;
  const reasonId = useId();
  const reason = describeRestriction(gui, restriction, text.refusalReasons);
  return (
    <>
      <GuiButton
        label={label}
        variant={variant}
        disabled={busy || unavailable || reason !== null}
        reasonId={reasonId}
        onPress={onPress}
      />
      {reason !== null && (
        <p id={reasonId} className="diagram-gui__hint">
          {`${label}: ${reason}`}
        </p>
      )}
      {reason === null && !unavailable && freezes > 0 && (
        <p className="diagram-gui__hint">{`${label}: ${text.freezeNote(freezes)}`}</p>
      )}
    </>
  );
}
