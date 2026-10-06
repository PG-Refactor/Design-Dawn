import { useFileDrop } from "../canvas/use-file-drop";
import { DocumentPanel } from "./document-panel";
import { DocumentTabs } from "./document-tabs";
import { LoadStatus } from "./notifications";
import { ProjectTree } from "./project-tree";
import { TopBar } from "./top-bar";
import { useSaveShortcut } from "./use-save-shortcut";
import { useWindowCloseSave } from "./use-window-close-save";
import { WorkspaceDialogs } from "./workspace-dialogs";
import { MESSAGES } from "./workspace-messages";
import "./buttons.css";
import "./workspace-shell.css";

// Layout of docs/ui-design.md §1: top bar, Project Tree on the left, Document Tabs /
// Sheet Tabs / sheet area on the right. Dialogs render into a portal of their own.
export function WorkspaceShell() {
  useFileDrop();
  useSaveShortcut();
  useWindowCloseSave();
  return (
    <div className="workspace-shell">
      <TopBar />
      <LoadStatus />
      <div className="workspace-shell__body">
        <aside
          className="workspace-shell__sidebar"
          aria-label={MESSAGES.appRegionTreeLabel}
        >
          <ProjectTree />
        </aside>
        <main className="workspace-shell__main">
          <DocumentTabs />
          <DocumentPanel />
        </main>
      </div>
      <WorkspaceDialogs />
    </div>
  );
}
