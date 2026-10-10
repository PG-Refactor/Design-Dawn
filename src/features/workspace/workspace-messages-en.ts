// English catalog of the workspace shell. It is typed with the type derived from the
// Japanese catalog, so a missing or extra key is a compile error.

import type { OperationErrorKind } from "../../application/ports/operation-error";
import type { LoadIssueKind } from "../../application/ports/persistence-types";
import type { OperationLabel } from "./ui-state/ui-state";
import type { WorkspaceMessages } from "./workspace-messages";

const quoted = (name: string): string => `"${name}"`;

const OPERATION_HEADLINES: Record<OperationLabel, string> = {
  selectFolder: "Could not select the folder",
  openProject: "Could not open the Project",
  openLaunchRequest: "Could not open the .dawn file",
  createProject: "Could not create the Project",
  closeProject: "Could not close the Project",
  openDocument: "Could not open the Document",
  closeDocument: "Could not close the Document",
  createDocument: "Could not create the Document",
  createFolder: "Could not create the folder",
  createSheet: "Could not create the Sheet",
  deleteDocument: "Could not delete the Document",
  deleteFolder: "Could not delete the folder",
  deleteSheet: "Could not delete the Sheet",
  renameDocument: "Could not rename",
  renameFolder: "Could not rename",
  renameSheet: "Could not rename",
  moveDocument: "Could not change the order",
  moveFolder: "Could not change the order",
  moveEntry: "Could not move",
  moveSheet: "Could not change the order",
  moveBlocks: "Could not move the blocks",
  resizeBlocks: "Could not resize the blocks",
  deleteBlocks: "Could not delete the blocks",
  reorderBlocks: "Could not change the stacking order of the blocks",
  copyBlocks:
    "Some blocks could not be copied (their text or image is not loaded)",
  cutBlocks:
    "Some blocks could not be cut (their text or image is not loaded, so they were left in place)",
  pasteBlocks: "Could not paste the blocks",
  duplicateBlocks:
    "Some blocks could not be duplicated (their text or image is not loaded)",
  createBlock: "Could not add the block",
  importImages: "Could not import the images",
  importImagesWithoutSheet: "Open a Sheet to add images",
  editBlockContent:
    "Could not commit the edit of the block text (your edit is still on the screen)",
  loadBlockContents: "Could not load the block text",
  undo: "Could not undo",
  redo: "Could not redo",
  loadViewport: "Could not load the view position (the default is used)",
  saveViewport: "Could not save the view position",
  refreshGitStatus: "Could not get the Git status",
  stageGitFiles: "Could not stage the files",
  unstageGitFiles: "Could not unstage the files",
  loadGitDiff: "Could not get the diff",
  commitGitChanges: "Could not commit",
  loadGitHistory: "Could not get the history",
};

const ERROR_KINDS: Record<OperationErrorKind, string> = {
  invalidEntityId: "The ID format is invalid.",
  invalidDisplayName: "The name is invalid.",
  invalidPosition: "The position value is invalid.",
  invalidSize: "The size value is invalid.",
  unsupportedBlockType: "The block type is not supported.",
  invalidContentPath: "The path of the text file is invalid.",
  invalidSchemaVersion: "The data format version is invalid.",
  unsupportedSchemaVersion: "The data format is newer than this app supports.",
  duplicateId: "An ID is duplicated.",
  entityNotFound: "The target was not found.",
  invalidBlockIndex: "The block order is invalid.",
  invalidContentExtension: "The extension of the text file is invalid.",
  invalidJson: "The file content (JSON) is invalid.",
  invalidFileStructure: "The file or folder structure is invalid.",
  invalidEncoding: "The character encoding of the file is invalid.",
  pathOutsideRoot: "A path outside the Project cannot be used.",
  fileNotFound: "The file was not found.",
  alreadyExists: "Something with the same name already exists.",
  ioError: "Reading or writing the file failed.",
  notWritable:
    "This Document has already been closed, so it cannot be changed.",
  projectNotOpen: "No Project is open.",
  projectOpenInOtherWindow: "This Project is open in another window",
  dialogFailed: "Could not open the folder dialog.",
  invalidFolderSelection:
    "The selected folder is not valid. Please select it again.",
  invalidImageContent: "The file cannot be read as an image.",
  assetTooLarge: "The image file is too large (limit 20 MiB).",
  invalidDropSelection:
    "The dropped files are not valid. Please drop them again.",
  folderNotEmpty:
    "The folder is not empty. Move or delete the Documents and folders in it first.",
  invalidMove: "Cannot move here (the destination is inside the item itself).",
  gitCommandFailed: "The Git operation failed.",
  gitTimeout: "The Git operation did not finish in time.",
  invalidGitPath: "The path cannot be passed to Git.",
  gitNotReady: "Git operations cannot be run right now",
  invalidCommitMessage: "The commit message is invalid",
  nothingToCommit: "There are no staged changes",
  gitUnmergedChanges: "Some files have unresolved conflicts",
  gitOperationInProgress: "A merge or similar operation is in progress",
  gitIdentityMissing: "The Git user name and email are not configured",
  gitCommitRejected: "The commit was rejected (for example by a hook)",
  invalidHistoryRequest: "The history request is invalid",
  invalidThemePreference: "The theme setting value is invalid.",
  invalidLanguagePreference: "The display language setting value is invalid.",
  invalidViewport: "The view position value is invalid.",
  invalidProjectTreeWidth: "The Project Tree width value is invalid.",
  invalidCommandResponse: "The response of an internal command is invalid.",
  unexpectedCommandError: "An unexpected error occurred.",
};

const LOAD_ISSUES: Record<LoadIssueKind, string> = {
  unlistedEntity: "A Document / Sheet that is not in the list was found.",
  missingEntity: "A Document / Sheet in the list was not found.",
  invalidOrderEntry: "The order record has an invalid entry.",
  duplicateEntityId: "An ID is duplicated.",
  entityLoadFailed: "Loading failed.",
  missingContent: "The text file of a block was not found.",
  orphanContent: "There is a text file that no block refers to.",
  leftoverTempFile: "A temporary file from an interrupted save remains.",
  unrecognizedDirectory: "There is an unrecognized folder.",
};

export const WORKSPACE_MESSAGES_EN: WorkspaceMessages = {
  appRegionTreeLabel: "Project Tree",
  leftPanel: {
    tabsLabel: "Switch the left panel",
    project: "Project",
    git: "Git",
  },
  splitter: {
    label: "Project Tree width",
  },
  topBar: {
    noProject: "No Project is open",
    openProject: "Open Project",
    createProject: "New Project",
    closeProject: "Close Project",
    openProjectInNewWindow: "Open Project in New Window",
    autoSave: "Auto Save",
    languageLegend: "Language",
    themeLegend: "Theme",
    systemOption: "System",
    themeLight: "Light",
    themeDark: "Dark",
  },
  notices: {
    regionLabel: "Notices",
    documentAlreadyOpen: "Already open",
    projectOpenInOtherWindow: "This Project is open in another window",
    projectOpenInThisWindow: "Open in this window",
  },
  tree: {
    openProjectInNewWindow: "Open Project in New Window",
    createFolder: "New Folder",
    createDocument: "New Document",
    createSheet: "New Sheet",
    deleteFolder: "Delete Folder",
    deleteDocument: "Delete Document",
    moveTo: "Move to…",
    deleteFolderNotEmptyHint: "Only empty folders can be deleted",
    folderExpandedMarker: "▾",
    folderCollapsedMarker: "▸",
    emptyFolder: "This folder is empty",
    rename: "Rename",
    moveUp: "Move Up",
    moveDown: "Move Down",
    menuButtonText: "⋮",
    unnamedEntity: "(name cannot be loaded)",
    loadFailedMarker: "Load failed",
    loadFailedHint:
      "Cannot be opened because loading failed (it can be deleted)",
    emptyProject: "No Documents",
    noProject: "Open a Project or create a new one.",
  },
  tabs: {
    documentTabsLabel: "Document Tabs",
    sheetTabsLabel: "Sheet Tabs",
    documentPanelLabel: "Document",
    sheetPanelLabel: "Sheet",
    close: "Close",
    closeButtonText: "×",
    retrySave: "Retry",
    createSheet: "New Sheet",
    deleteSheet: "Delete Sheet",
    deleteSheetButtonText: "×",
  },
  saveStatus: {
    saved: "Saved",
    unsaved: "Unsaved",
    saving: "Saving",
    error: "Save error",
  },
  placeholder: {
    noDocument: "Open a Document from the tree.",
    noProject: "Open a Project or create a new one.",
  },
  notifications: {
    panelLabel: "Notifications",
    emptyPanel: "No notifications.",
    retry: "Retry",
    dismiss: "Dismiss this notification",
    deleteSheet: "Delete this Sheet",
    details: "Details",
    projectSource: "Project",
    appSource: "App",
    errorSeverity: "Error",
    warningSeverity: "Warning",
    projectLoadedWithWarnings: "The Project was loaded with warnings",
    documentLoadedWithWarnings: "The Document was loaded with warnings",
    statusLabel: "Load status",
    themeSaveError: "Could not save the theme setting",
    languageSaveError: "Could not save the display language setting",
    autoSaveSaveError: "Could not save the Auto Save setting",
    projectTreeWidthSaveError: "Could not save the Project Tree width",
    themeLoadIssue:
      "Could not load the theme setting (started with the default setting)",
    loadFailedDocument: "Failed to load the Document (it cannot be opened)",
    loadFailedSheet: "Failed to load the Sheet (it cannot be opened)",
    orphanContentFile: "Could not delete a block text file (the file remains)",
    contentLoadFailed:
      "Could not load the text file of a block (it cannot be edited)",
    imageLoadFailed:
      "Could not load an image (the image file is missing or broken)",
    detailLabels: {
      kind: "Kind",
      path: "Path",
      entityId: "ID",
      detail: "Details",
    },
  },
  dialogs: {
    cancel: "Cancel",
    delete: "Delete",
    undoNotice: "This operation cannot be undone.",
    deleteFolderConsequence: "This folder (empty) will be deleted.",
    deleteDocumentConsequence:
      "All Sheets, block text files and Assets of this Document will also be deleted.",
    createProject: {
      title: "New Project",
      nameLabel: "Project name",
      submit: "Create",
    },
    createDocument: {
      title: "New Document",
      nameLabel: "Document name",
      submit: "Create",
    },
    createFolder: {
      title: "New Folder",
      nameLabel: "Folder name",
      submit: "Create",
    },
    confirmMoveSave: {
      body: "There are unsaved changes. Save and move?",
      confirm: "Save and Move",
    },
    confirmUnsavedClose: {
      body: "There are unsaved changes. Save them?",
      save: "Save",
      discard: "Close Without Saving",
      windowTitle: "Quit the app",
      projectTitle: "Close the Project",
      switchProjectTitle: "Open another Project",
    },
    moveEntry: {
      description: "Choose where to move it.",
      choose: "Move Here",
      newFolder: "New Folder",
      newFolderInputLabel: "Name of the new folder",
      projectRoot: "Project root",
      listLabel: "Destination",
      currentParentHint: "This is the current location",
      selfOrDescendantHint: "Cannot move into itself or its contents",
    },
    createSheet: {
      title: "New Sheet",
      nameLabel: "Sheet name",
      submit: "Create",
    },
    nameRequired: "Enter a name.",
    nameInvalid:
      "This name cannot be used (it is too long or contains characters that are not allowed).",
  },
  operationHeadlines: OPERATION_HEADLINES,
  errorKinds: ERROR_KINDS,
  loadIssues: LOAD_ISSUES,
  skippedBlocks: (count) => (count === 1 ? "1 block" : `${count} blocks`),
  documentSourceLabel: (name) => `Document: ${name}`,
  moveEntryTitle: (name) => `Move ${quoted(name)}…`,
  closeDocumentConfirmationTitle: (name) => `Close ${quoted(name)}`,
  deleteConfirmationTitle: (name) => `Delete ${quoted(name)}?`,
  operationFailure: (subject, headline, errorText) =>
    `${subject === null ? "" : `${quoted(subject)}: `}${headline}. ${errorText}`,
  saveFailure: (documentName, errorText) =>
    `Could not save ${documentName === null ? "the Project" : quoted(documentName)}. ${errorText}`,
  documentLoadStatus: (headline, documentName) =>
    `${headline} (${documentName})`,
  notificationCounts: (errors, warnings) => {
    const pluralize = (count: number, noun: string): string =>
      `${count} ${noun}${count === 1 ? "" : "s"}`;
    if (errors > 0 && warnings > 0) {
      return `${pluralize(errors, "error")}, ${pluralize(warnings, "warning")}`;
    }
    if (errors > 0) return pluralize(errors, "error");
    if (warnings > 0) return pluralize(warnings, "warning");
    return "No notifications";
  },
  closeTabLabel: (name) => `Close ${name}`,
  retrySaveLabel: (name) => `Retry saving ${name}`,
  deleteSheetTabLabel: (name) => `Delete Sheet (${name})`,
  treeMenuLabel: (name) => `Menu for ${name}`,
  renameInputLabel: (name) => `Rename ${name}`,
};
