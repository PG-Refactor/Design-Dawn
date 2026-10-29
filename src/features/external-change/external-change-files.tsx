import type { ChangedFile } from "../../application/ports/persistence-types";
import { useMessages } from "../workspace/use-messages";

// The files a conflict is about: path (relative; never absolute) and what happened to it.
export function ChangedFileList({
  files,
}: {
  readonly files: readonly ChangedFile[];
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
          </span>
        </li>
      ))}
    </ul>
  );
}
