import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createStore } from "../../shared/store/store";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type {
  ChosenTable,
  SpreadsheetWorkbook,
} from "../canvas/canvas-actions";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import {
  DEFAULT_SPREADSHEET_IMPORT_OPTIONS,
  parseCellRange,
  type SpreadsheetImportOptions,
  sheetTable,
} from "./spreadsheet-table";
import "./spreadsheet-import-dialog.css";

// How many rows of the table the preview shows.
const PREVIEW_ROWS = 8;

// One question at a time; a new one answers an open one as cancelled.
const pending = createStore<{
  readonly workbook: SpreadsheetWorkbook | null;
  readonly answer: ((tables: readonly ChosenTable[] | null) => void) | null;
}>({ workbook: null, answer: null });

// The import dialog for a workbook that was read: which sheets (and which of their cells)
// become tables, and how. Resolves to the tables, or null when cancelled.
export function askSpreadsheetImport(
  workbook: SpreadsheetWorkbook,
): Promise<readonly ChosenTable[] | null> {
  pending.getState().answer?.(null);
  return new Promise((resolve) => {
    pending.setState({
      workbook,
      answer: (tables) => {
        pending.setState({ workbook: null, answer: null });
        resolve(tables);
      },
    });
  });
}

export function SpreadsheetImportDialog() {
  const workbook = useStoreSelector(pending, (state) => state.workbook);
  const answer = useStoreSelector(pending, (state) => state.answer);
  // An open question goes with the shell (answered as cancelled, so nothing waits).
  useEffect(() => () => pending.getState().answer?.(null), []);
  if (workbook === null || answer === null) return null;
  return (
    <ImportDialog
      key={workbook.fileName}
      workbook={workbook}
      onAnswer={answer}
    />
  );
}

function ImportDialog({
  workbook,
  onAnswer,
}: {
  readonly workbook: SpreadsheetWorkbook;
  readonly onAnswer: (tables: readonly ChosenTable[] | null) => void;
}) {
  const messages = useMessages().spreadsheet;
  const titleId = useId();
  const importRef = useRef<HTMLButtonElement>(null);
  const [options, setOptions] = useState<SpreadsheetImportOptions>(
    DEFAULT_SPREADSHEET_IMPORT_OPTIONS,
  );
  const [chosen, setChosen] = useState<readonly boolean[]>(() =>
    workbook.sheets.map((sheet) => !sheet.hidden),
  );
  const [ranges, setRanges] = useState<readonly string[]>(() =>
    workbook.sheets.map(() => ""),
  );
  const [previewIndex, setPreviewIndex] = useState(() =>
    Math.max(
      0,
      workbook.sheets.findIndex((sheet) => !sheet.hidden),
    ),
  );
  const usable = (index: number) =>
    !(options.skipHidden && workbook.sheets[index]?.hidden === true);
  const parsedRanges = ranges.map(parseCellRange);
  const tables = useMemo(
    () =>
      workbook.sheets.map((sheet, index) => {
        const range = parseCellRange(ranges[index] ?? "");
        return range === undefined ? null : sheetTable(sheet, options, range);
      }),
    [workbook, options, ranges],
  );
  const selected = workbook.sheets.flatMap((sheet, index) => {
    const table = tables[index];
    return chosen[index] === true && usable(index) && table != null
      ? [{ name: sheet.name, table }]
      : [];
  });
  const invalidRange = workbook.sheets.some(
    (_, index) =>
      chosen[index] === true &&
      usable(index) &&
      parsedRanges[index] === undefined,
  );
  const preview = workbook.sheets[previewIndex];
  const previewTable = tables[previewIndex] ?? null;

  function setOption(name: keyof SpreadsheetImportOptions, value: boolean) {
    setOptions((current) => ({ ...current, [name]: value }));
  }

  return (
    <Modal
      titleId={titleId}
      onCancel={() => onAnswer(null)}
      initialFocusRef={importRef}
      wide
    >
      <h2 id={titleId} className="modal__title">
        {messages.title(workbook.fileName)}
      </h2>
      <div className="modal__body spreadsheet-import">
        <fieldset className="spreadsheet-import__group">
          <legend>{messages.sheetsLegend}</legend>
          <div className="spreadsheet-import__bulk">
            <button
              type="button"
              className="button"
              onClick={() =>
                setChosen(workbook.sheets.map((_, index) => usable(index)))
              }
            >
              {messages.selectAll}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setChosen(workbook.sheets.map(() => false))}
            >
              {messages.deselectAll}
            </button>
          </div>
          <ul className="spreadsheet-import__sheets">
            {workbook.sheets.map((sheet, index) => (
              <li
                // Worksheet names are unique within a workbook.
                key={sheet.name}
                className={
                  index === previewIndex
                    ? "spreadsheet-import__sheet spreadsheet-import__sheet--preview"
                    : "spreadsheet-import__sheet"
                }
              >
                {/* Only the box itself chooses: a click on the name is for the preview
                    and must not take a sheet out by mistake. */}
                <input
                  type="checkbox"
                  aria-label={messages.importSheet(sheet.name)}
                  checked={chosen[index] === true && usable(index)}
                  disabled={!usable(index)}
                  onFocus={() => setPreviewIndex(index)}
                  onChange={(event) => {
                    const next = [...chosen];
                    next[index] = event.target.checked;
                    setChosen(next);
                    setPreviewIndex(index);
                  }}
                />
                <button
                  type="button"
                  className="spreadsheet-import__sheet-name"
                  aria-pressed={index === previewIndex}
                  title={messages.previewOf(sheet.name)}
                  onClick={() => setPreviewIndex(index)}
                >
                  {sheet.name}
                  {sheet.hidden && (
                    <span className="spreadsheet-import__badge">
                      {messages.hiddenSheet}
                    </span>
                  )}
                </button>
                <input
                  type="text"
                  className="spreadsheet-import__range"
                  aria-label={messages.rangeLabel(sheet.name)}
                  aria-invalid={parsedRanges[index] === undefined}
                  placeholder={messages.rangePlaceholder}
                  value={ranges[index] ?? ""}
                  disabled={!usable(index)}
                  onFocus={() => setPreviewIndex(index)}
                  onChange={(event) => {
                    const next = [...ranges];
                    next[index] = event.target.value;
                    setRanges(next);
                  }}
                />
              </li>
            ))}
          </ul>
          {invalidRange && (
            <p role="alert" className="spreadsheet-import__error">
              {messages.invalidRange}
            </p>
          )}
        </fieldset>
        <fieldset className="spreadsheet-import__group">
          <legend>{messages.optionsLegend}</legend>
          {(
            [
              ["headerRow", messages.headerRow],
              ["fillMerged", messages.fillMerged],
              ["alignNumbers", messages.alignNumbers],
              ["skipHidden", messages.skipHidden],
            ] as const
          ).map(([name, label]) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={options[name]}
                onChange={(event) => setOption(name, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {preview !== undefined && (
          <section
            className="spreadsheet-import__preview"
            aria-label={messages.previewHeading(preview.name)}
          >
            <h3 className="spreadsheet-import__preview-title">
              {messages.previewHeading(preview.name)}
            </h3>
            {previewTable === null ? (
              <p>{messages.previewEmpty}</p>
            ) : (
              <>
                <p className="spreadsheet-import__size">
                  {messages.previewSize(
                    previewTable.rows.length,
                    previewTable.header.length,
                  )}
                </p>
                <div className="spreadsheet-import__table-scroll">
                  <table className="spreadsheet-import__table">
                    <thead>
                      <tr>
                        {previewTable.header.map((cell, column) => (
                          <th
                            // Columns have no id; their order never changes here.
                            // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the column's identity.
                            key={column}
                            className={`spreadsheet-import__cell--${previewTable.alignments[column] ?? "none"}`}
                          >
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewTable.rows
                        .slice(0, PREVIEW_ROWS)
                        .map((row, rowIndex) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: the row index is the row's identity in the preview.
                          <tr key={rowIndex}>
                            {row.map((cell, column) => (
                              <td
                                // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the column's identity.
                                key={column}
                                className={`spreadsheet-import__cell--${previewTable.alignments[column] ?? "none"}`}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {previewTable.rows.length > PREVIEW_ROWS && (
                  <p className="spreadsheet-import__size">
                    {messages.previewMore(
                      previewTable.rows.length - PREVIEW_ROWS,
                    )}
                  </p>
                )}
              </>
            )}
            {preview.truncated && (
              <p className="spreadsheet-import__error">{messages.truncated}</p>
            )}
          </section>
        )}
      </div>
      <div className="modal__actions">
        <button type="button" className="button" onClick={() => onAnswer(null)}>
          {messages.cancel}
        </button>
        <button
          ref={importRef}
          type="button"
          className="button button--primary"
          disabled={selected.length === 0 || invalidRange}
          onClick={() => onAnswer(selected)}
        >
          {messages.importButton}
        </button>
      </div>
    </Modal>
  );
}
