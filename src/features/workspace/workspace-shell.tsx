import { useFileDrop } from "../canvas/use-file-drop";
import { ProjectBanner } from "../external-change/external-change-banner";
import { ExternalChangeDialog } from "../external-change/external-change-dialog";
import { useExternalChangeWatching } from "../external-change/use-external-change-watching";
import { useGitAutoRefresh } from "../git/use-git-auto-refresh";
import { LoadIssueRepairDialog } from "../load-issue-repair/load-issue-repair-dialog";
import { LoadStatus, TransientNotice } from "./notifications";
import { TopBar } from "./top-bar";
import { useAppRequests } from "./use-app-requests";
import { useLaunchRequest } from "./use-launch-request";
import { useSaveShortcut } from "./use-save-shortcut";
import { useWindowCloseSave } from "./use-window-close-save";
import { WorkspaceBody } from "./workspace-body";
import { WorkspaceDialogs } from "./workspace-dialogs";
import "./buttons.css";
import "./workspace-shell.css";

// Layout: top bar, Project Tree on the left, Document Tabs /
// Sheet Tabs / sheet area on the right. Dialogs render into a portal of their own.
export function WorkspaceShell() {
  useFileDrop();
  useLaunchRequest();
  useSaveShortcut();
  const closeStatus = useWindowCloseSave();
  useAppRequests(closeStatus);
  useGitAutoRefresh();
  useExternalChangeWatching();
  return (
    <div className="workspace-shell">
      <TopBar />
      <LoadStatus />
      <TransientNotice />
      <ProjectBanner />
      <WorkspaceBody />
      <WorkspaceDialogs />
      <ExternalChangeDialog />
      <LoadIssueRepairDialog />
    </div>
  );
}
