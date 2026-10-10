import { useMessages } from "../workspace/use-messages";
import {
  buildInlineRows,
  buildSplitRows,
  type DiffContentKind,
  type InlineRow,
  type SplitCell,
  type SplitRow,
} from "./git-diff-rows";
import type { GitMessages } from "./git-messages";

// The sign column keeps the meaning of an added / removed line when colour is not seen.
const SIGN_BY_KIND: Readonly<Record<DiffContentKind, string>> = {
  context: "",
  added: "+",
  removed: "-",
};

const SPLIT_COLUMN_COUNT = 4;
const INLINE_COLUMN_COUNT = 3;

function NumberCell({ value }: { readonly value: number | null }) {
  return <td className="git-diff__number">{value}</td>;
}

function kindLabel(
  kind: DiffContentKind,
  messages: GitMessages,
): string | null {
  if (kind === "added") return messages.diffAddedLabel;
  if (kind === "removed") return messages.diffRemovedLabel;
  return null;
}

// Repository text goes in as React text only. The sign and the spoken kind are not part of
// the selectable (copied) text.
function CodeCell({
  kind,
  text,
  note,
  messages,
}: {
  readonly kind: DiffContentKind;
  readonly text: string;
  readonly note: string | null;
  readonly messages: GitMessages;
}) {
  const label = kindLabel(kind, messages);
  return (
    <td className={`git-diff__code git-diff__code--${kind}`}>
      <span className="git-diff__sign" aria-hidden="true">
        {SIGN_BY_KIND[kind]}
      </span>
      {label === null ? null : (
        <span className="git-visually-hidden git-diff__unselectable">
          {label}
        </span>
      )}
      <span>{text}</span>
      {note === null ? null : <span className="git-diff__note">{note}</span>}
    </td>
  );
}

function FillerCells() {
  return (
    <>
      <td className="git-diff__number git-diff__number--filler" />
      <td className="git-diff__code git-diff__code--filler" />
    </>
  );
}

function SideCells({
  cell,
  messages,
}: {
  readonly cell: SplitCell | null;
  readonly messages: GitMessages;
}) {
  if (cell === null) return <FillerCells />;
  return (
    <>
      <NumberCell value={cell.number} />
      <CodeCell
        kind={cell.kind}
        text={cell.text}
        note={cell.note}
        messages={messages}
      />
    </>
  );
}

function FullWidthRow({
  kind,
  text,
  columnCount,
  messages,
}: {
  readonly kind: "hunk" | "note";
  readonly text: string;
  readonly columnCount: number;
  readonly messages: GitMessages;
}) {
  return (
    <tr className={`git-diff__row git-diff__row--${kind}`}>
      <td colSpan={columnCount} className="git-diff__wide">
        {kind === "hunk" ? (
          <span className="git-visually-hidden git-diff__unselectable">
            {messages.diffHunkLabel}
          </span>
        ) : null}
        <span>{text}</span>
      </td>
    </tr>
  );
}

function SplitRowView({
  row,
  messages,
}: {
  readonly row: SplitRow;
  readonly messages: GitMessages;
}) {
  if (row.kind !== "line") {
    return (
      <FullWidthRow
        kind={row.kind}
        text={row.text}
        columnCount={SPLIT_COLUMN_COUNT}
        messages={messages}
      />
    );
  }
  return (
    <tr className="git-diff__row">
      <SideCells cell={row.left} messages={messages} />
      <SideCells cell={row.right} messages={messages} />
    </tr>
  );
}

function InlineRowView({
  row,
  messages,
}: {
  readonly row: InlineRow;
  readonly messages: GitMessages;
}) {
  if (row.kind === "hunk") {
    return (
      <FullWidthRow
        kind="hunk"
        text={row.text}
        columnCount={INLINE_COLUMN_COUNT}
        messages={messages}
      />
    );
  }
  return (
    <tr className="git-diff__row">
      <NumberCell value={row.oldNumber} />
      <NumberCell value={row.newNumber} />
      {row.kind === "note" ? (
        <td className="git-diff__code git-diff__code--note">{row.text}</td>
      ) : (
        <CodeCell
          kind={row.kind}
          text={row.text}
          note={null}
          messages={messages}
        />
      )}
    </tr>
  );
}

// The rows of one text diff in the chosen layout. Split rows read old then new; in both
// layouts a changed line carries a spoken "removed" / "added".
export function GitDiffTable({
  diff,
  mode,
}: {
  readonly diff: string;
  readonly mode: "split" | "inline";
}) {
  const messages = useMessages().git;
  return (
    <table className={`git-diff__table git-diff__table--${mode}`}>
      <tbody>
        {mode === "split"
          ? buildSplitRows(diff).map((row) => (
              <SplitRowView key={row.key} row={row} messages={messages} />
            ))
          : buildInlineRows(diff).map((row) => (
              <InlineRowView key={row.key} row={row} messages={messages} />
            ))}
      </tbody>
    </table>
  );
}
