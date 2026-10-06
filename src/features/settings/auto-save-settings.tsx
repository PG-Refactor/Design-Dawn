import type {
  AutoSaveController,
  AutoSaveState,
} from "../../application/settings/auto-save-controller";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { MESSAGES } from "../workspace/workspace-messages";
import "./auto-save-settings.css";

// Only what the control needs, so a settings screen can pass the same controller.
export type AutoSaveSettingsController = Pick<
  AutoSaveController,
  "store" | "setEnabled"
>;

const selectEnabled = (state: AutoSaveState) => state.enabled;
const selectIsLoading = (state: AutoSaveState) => state.status === "loading";

export function AutoSaveSetting({
  controller,
}: {
  readonly controller: AutoSaveSettingsController;
}) {
  const enabled = useStoreSelector(controller.store, selectEnabled);
  const isLoading = useStoreSelector(controller.store, selectIsLoading);
  return (
    <label className="auto-save-setting">
      <input
        type="checkbox"
        checked={enabled}
        disabled={isLoading}
        // A failed save is recorded in the controller state and shown as a notification.
        onChange={(event) => void controller.setEnabled(event.target.checked)}
      />
      {MESSAGES.topBar.autoSave}
    </label>
  );
}
