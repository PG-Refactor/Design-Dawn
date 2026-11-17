import {
  ORIENTATIONS,
  PAPER_SCALES,
  PAPER_SIZE_IDS,
  PAPER_SIZES,
  type PaperSettings,
} from "../../domain/print/paper";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import type { PrintMode } from "./print-settings";

// How the pages are made: one page per sheet as large as its content, or cut into paper
// pages (size, orientation, scale). Printing and the PDF export share the choice, which
// the window keeps for the next time.
export function PaperFields({
  disabled,
  fitLabel,
  paperLabel,
  note,
}: {
  readonly disabled: boolean;
  readonly fitLabel: string;
  readonly paperLabel: string;
  readonly note: string;
}) {
  const messages = useMessages().export;
  const { exportActions } = useWorkspaceServices();
  const settings = useStoreSelector(
    exportActions.printSettings,
    (state) => state,
  );
  const { mode } = settings;
  const { size: paperSize, orientation, scale } = settings.paper;
  const setMode = (next: PrintMode) =>
    exportActions.printSettings.setState((state) => ({ ...state, mode: next }));
  const setPaper = (change: Partial<PaperSettings>) =>
    exportActions.printSettings.setState((state) => ({
      ...state,
      paper: { ...state.paper, ...change },
    }));
  return (
    <fieldset className="print-dialog__group" disabled={disabled}>
      <legend>{messages.mode}</legend>
      <label>
        <input
          type="radio"
          name="print-mode"
          checked={mode === "fit"}
          onChange={() => setMode("fit")}
        />
        {fitLabel}
      </label>
      <label>
        <input
          type="radio"
          name="print-mode"
          checked={mode === "paper"}
          onChange={() => setMode("paper")}
        />
        {paperLabel}
      </label>
      {mode === "paper" && <p className="print-dialog__note">{note}</p>}
      {mode === "paper" && (
        <div className="print-dialog__paper">
          <label>
            {messages.paperSize}
            <select
              value={paperSize}
              onChange={(event) => {
                const size = PAPER_SIZE_IDS.find(
                  (candidate) => candidate === event.target.value,
                );
                if (size !== undefined) setPaper({ size });
              }}
            >
              {PAPER_SIZE_IDS.map((size) => (
                <option key={size} value={size}>
                  {PAPER_SIZES[size].name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {messages.orientation}
            <select
              value={orientation}
              onChange={(event) => {
                const next = ORIENTATIONS.find(
                  (value) => value === event.target.value,
                );
                if (next !== undefined) setPaper({ orientation: next });
              }}
            >
              <option value="portrait">{messages.portrait}</option>
              <option value="landscape">{messages.landscape}</option>
            </select>
          </label>
          <label>
            {messages.scale}
            <select
              value={scale}
              onChange={(event) => {
                const next = PAPER_SCALES.find(
                  (value) => value === event.target.value,
                );
                if (next !== undefined) setPaper({ scale: next });
              }}
            >
              <option value="actual">{messages.scaleActual}</option>
              <option value="fitWidth">{messages.scaleFitWidth}</option>
              <option value="fitPage">{messages.scaleFitPage}</option>
            </select>
          </label>
        </div>
      )}
    </fieldset>
  );
}
