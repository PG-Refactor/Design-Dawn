import { useFileDrop } from "../canvas/use-file-drop";
import { LoadStatus } from "./notifications";
import { TopBar } from "./top-bar";
import { useLaunchRequest } from "./use-launch-request";
import { useSaveShortcut } from "./use-save-shortcut";
import { useWindowCloseSave } from "./use-window-close-save";
import { WorkspaceBody } from "./workspace-body";
import { WorkspaceDialogs } from "./workspace-dialogs";
import "./buttons.css";
import "./workspace-shell.css";

// Layout of docs/ui-design.md §1: top bar, Project Tree on the left, Document Tabs /
// Sheet Tabs / sheet area on the right. Dialogs render into a portal of their own.
export function WorkspaceShell() {
  useFileDrop();
  useLaunchRequest();
  useSaveShortcut();
  useWindowCloseSave();
  return (
    <div className="workspace-shell">
      <TopBar />
      <LoadStatus />
      <WorkspaceBody />
      <WorkspaceDialogs />
    </div>
  );
}
