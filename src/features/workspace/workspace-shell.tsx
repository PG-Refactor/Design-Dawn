import { useFileDrop } from "../canvas/use-file-drop";
import { PrintingCloseDialog } from "../export/printing-close";
import { ProjectBanner } from "../external-change/external-change-banner";
import { ExternalChangeDialog } from "../external-change/external-change-dialog";
import { useExternalChangeWatching } from "../external-change/use-external-change-watching";
import { useLongPathsNotice } from "../git/git-long-paths";
import { useGitAutoRefresh } from "../git/use-git-auto-refresh";
import { LoadIssueRepairDialog } from "../load-issue-repair/load-issue-repair-dialog";
import { useFindShortcuts } from "../search/use-find-shortcuts";
import { SpreadsheetImportDialog } from "../spreadsheet/spreadsheet-import-dialog";
import { TemplateDialogs } from "../templates/template-dialogs";
import { TemplateEditBanner } from "../templates/template-edit-banner";
import { UnusedAssetsDialog } from "../unused-assets/unused-assets-dialog";
import { LoadStatus, TransientNotice } from "./notifications";
import { TopBar } from "./top-bar";
import { useAppRequests } from "./use-app-requests";
import { useHistoryShortcut } from "./use-history-shortcut";
import { useLaunchRequest } from "./use-launch-request";
import { useSaveShortcut } from "./use-save-shortcut";
import { useWindowCloseSave } from "./use-window-close-save";
import { useWindowTitle } from "./use-window-title";
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
  useHistoryShortcut();
  useFindShortcuts();
  const closeStatus = useWindowCloseSave();
  useAppRequests(closeStatus);
  useWindowTitle();
  useGitAutoRefresh();
  useLongPathsNotice();
  useExternalChangeWatching();
  return (
    <div className="workspace-shell">
      <TopBar />
      <TemplateEditBanner />
      <LoadStatus />
      <TransientNotice />
      <ProjectBanner />
      <WorkspaceBody />
      <WorkspaceDialogs />
      <PrintingCloseDialog />
      <SpreadsheetImportDialog />
      <TemplateDialogs />
      <UnusedAssetsDialog />
      <ExternalChangeDialog />
      <LoadIssueRepairDialog />
    </div>
  );
}
