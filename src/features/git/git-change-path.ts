// Splits a repository path (`/` separated) for the row display: the file name, and the
// directory that precedes it (empty for a file in the repository root).
export interface GitPathParts {
  readonly name: string;
  readonly directory: string;
}

const PATH_SEPARATOR = "/";

export function splitGitPath(path: string): GitPathParts {
  const separatorIndex = path.lastIndexOf(PATH_SEPARATOR);
  if (separatorIndex < 0) return { name: path, directory: "" };
  return {
    name: path.slice(separatorIndex + 1),
    directory: path.slice(0, separatorIndex),
  };
}
