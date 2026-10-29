import type { ChangedFile } from "../../application/ports/persistence-types";
import { useMessages } from "../workspace/use-messages";

const JSON_EXTENSION = ".json";

export interface FileComparison {
  readonly isComparable: (file: ChangedFile) => boolean;
  readonly onCompare: (file: ChangedFile) => void;
}

// The files a conflict is about: path (relative; never absolute) and what happened to it. A
// Block text file offers a comparison; metadata (JSON) says that lines cannot be compared.
export function ChangedFileList({
  files,
  comparison,
}: {
  readonly files: readonly ChangedFile[];
  readonly comparison?: FileComparison;
}) {
  const texts = useMessages().workspace.externalChange;
  return (
    <ul className="external-change__files" aria-label={texts.filesLabel}>
      {files.map((file) => (
        <li key={file.path}>
          <span className="external-change__file-path">{file.path}</span>{" "}
          <span className="external-change__file-change">
            {texts.changeLabels[file.change]}
            {file.readable || file.change === "removed"
              ? ""
              : ` / ${texts.unreadableMark}`}
            {comparison !== undefined &&
            !comparison.isComparable(file) &&
            file.path.endsWith(JSON_EXTENSION)
              ? ` / ${texts.compareJsonUnsupported}`
              : ""}
          </span>
          {comparison?.isComparable(file) ? (
            <button
              type="button"
              className="button external-change__file-compare"
              aria-label={`${texts.compareFile}: ${file.path}`}
              onClick={() => comparison.onCompare(file)}
            >
              {texts.compareFile}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
