// The snapshot types are defined by the application port; re-exported for the client.
export type {
  BlockContentComparison,
  ChangedFile,
  DocumentEntry,
  DocumentFileChanges,
  DocumentSnapshot,
  ExternalChanges,
  FolderEntry,
  FolderSelection,
  FolderSnapshot,
  LoadIssue,
  OpenInNewWindowResult,
  OpenRequestResult,
  ProjectFileChanges,
  ProjectSnapshot,
  SaveResult,
  SheetSnapshot,
} from "../../application/ports/persistence-types";
