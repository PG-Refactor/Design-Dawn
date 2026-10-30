// Japanese catalog of the workspace shell (entity terms such as Project / Document / Sheet
// stay in English, as in the docs). Error kinds are mapped to short user-facing sentences in
// one place; the developer `detail` is only shown in the expandable details of a
// notification, never as the headline.

import type { OperationErrorKind } from "../../application/ports/operation-error";
import type { LoadIssueKind } from "../../application/ports/persistence-types";
import type { OperationLabel } from "./ui-state/ui-state";

const quoted = (name: string): string => `「${name}」`;

// Full records, so a new operation or error kind cannot be added without a sentence.
const OPERATION_HEADLINES: Record<OperationLabel, string> = {
  selectFolder: "フォルダを選択できませんでした",
  openProject: "Projectを開けませんでした",
  openLaunchRequest: ".dawn を開けませんでした",
  createProject: "Projectを作成できませんでした",
  closeProject: "Projectを閉じられませんでした",
  openDocument: "Documentを開けませんでした",
  closeDocument: "Documentを閉じられませんでした",
  createDocument: "Documentを作成できませんでした",
  createFolder: "フォルダを作成できませんでした",
  createSheet: "Sheetを作成できませんでした",
  deleteDocument: "Documentを削除できませんでした",
  deleteFolder: "フォルダを削除できませんでした",
  deleteSheet: "Sheetを削除できませんでした",
  renameDocument: "名前の変更に失敗しました",
  renameFolder: "名前の変更に失敗しました",
  renameSheet: "名前の変更に失敗しました",
  moveDocument: "並び順の変更に失敗しました",
  moveFolder: "並び順の変更に失敗しました",
  moveEntry: "移動できませんでした",
  moveSheet: "並び順の変更に失敗しました",
  moveBlocks: "Blockを移動できませんでした",
  resizeBlocks: "Blockのサイズを変更できませんでした",
  deleteBlocks: "Blockを削除できませんでした",
  reorderBlocks: "Blockの重なり順を変更できませんでした",
  copyBlocks:
    "コピーできないBlockがありました（本文または画像を読み込めていません）",
  cutBlocks:
    "切り取れないBlockがありました（本文または画像を読み込めていないため、そのBlockは残しています）",
  pasteBlocks: "Blockを貼り付けできませんでした",
  duplicateBlocks:
    "複製できないBlockがありました（本文または画像を読み込めていません）",
  createBlock: "Blockを追加できませんでした",
  importImages: "画像を取り込めませんでした",
  importImagesWithoutSheet: "画像を追加するにはSheetを開いてください",
  editBlockContent:
    "Blockの本文の編集を確定できませんでした（編集内容は画面に残っています）",
  editDiagram: "図の編集を適用できませんでした（ソースは変更されていません）",
  loadBlockContents: "Blockの本文を読み込めませんでした",
  undo: "元に戻せませんでした",
  redo: "やり直せませんでした",
  loadViewport: "表示位置を読み込めませんでした（既定の表示位置を使います）",
  saveViewport: "表示位置を保存できませんでした",
  refreshGitStatus: "Gitの状態を取得できませんでした",
  stageGitFiles: "ステージできませんでした",
  unstageGitFiles: "ステージを解除できませんでした",
  discardGitChanges: "変更を破棄できませんでした",
  reloadExternalChange: "外部の変更を読み直せませんでした",
  checkExternalChange: "外部の変更を確認できませんでした",
  loadGitDiff: "差分を取得できませんでした",
  commitGitChanges: "コミットできませんでした",
  undoGitCommit: "コミットを元に戻せませんでした",
  fetchGit: "フェッチできませんでした",
  pullGit: "プルできませんでした",
  pushGit: "プッシュできませんでした",
  publishGit: "ブランチを発行できませんでした",
  loadGitHistory: "履歴を取得できませんでした",
};

const ERROR_KINDS: Record<OperationErrorKind, string> = {
  invalidEntityId: "IDの形式が正しくありません。",
  invalidDisplayName: "名前が正しくありません。",
  invalidPosition: "位置の値が正しくありません。",
  invalidSize: "サイズの値が正しくありません。",
  unsupportedBlockType: "未対応のBlock種別です。",
  invalidContentPath: "本文ファイルのパスが正しくありません。",
  invalidSchemaVersion: "データ形式のバージョンが正しくありません。",
  unsupportedSchemaVersion: "未対応の新しいデータ形式です。",
  duplicateId: "IDが重複しています。",
  entityNotFound: "対象が見つかりません。",
  invalidBlockIndex: "Blockの順序が正しくありません。",
  invalidTextEdit: "図の編集を適用できません。",
  overlappingTextEdits: "図の編集が重なっています。",
  ambiguousTextEdits: "図の編集の順序が一意に決まりません。",
  staleContent: "Blockが編集の途中で変更されました。もう一度お試しください。",
  diagramNotEditable: "この図はGUIで編集できません。",
  invalidDiagramOperation: "この図の操作は実行できません。",
  diagramMeaningMismatch:
    "意図した以外の内容も変わるため、編集を適用しませんでした。",
  diagramRenderRejected:
    "結果をMermaidが描画できないため、編集を適用しませんでした。",
  invalidContentExtension: "本文ファイルの拡張子が正しくありません。",
  invalidJson: "ファイルの内容（JSON）が正しくありません。",
  invalidFileStructure: "ファイルまたはフォルダの構成が正しくありません。",
  invalidEncoding: "ファイルの文字コードが正しくありません。",
  pathOutsideRoot: "Projectの外にあるパスは扱えません。",
  fileNotFound: "ファイルが見つかりません。",
  alreadyExists: "同じ名前のものが既に存在します。",
  ioError: "ファイルの読み書きに失敗しました。",
  externalConflict:
    "ファイルがアプリの外で変更されました。どうするか決めるまで保存を停止しています。",
  externallyModified:
    "ファイルがアプリの外で変更されたため、保存しませんでした。",
  notWritable: "このDocumentは既に閉じられているため操作できません。",
  projectNotOpen: "Projectが開かれていません。",
  projectOpenInOtherWindow: "このProjectは別のウィンドウで開いています",
  dialogFailed: "フォルダ選択ダイアログを開けませんでした。",
  invalidFolderSelection:
    "選択したフォルダが無効です。もう一度選択してください。",
  invalidImageContent: "画像として読み込めないファイルです。",
  assetTooLarge: "画像ファイルが大きすぎます（上限 20 MiB）。",
  invalidDropSelection:
    "ドロップしたファイルが無効です。もう一度ドロップしてください。",
  folderNotEmpty:
    "フォルダが空ではありません。中のDocumentやフォルダを移動または削除してください。",
  invalidMove: "ここへは移動できません（移動先が自分自身の中です）。",
  gitCommandFailed: "Gitの操作に失敗しました。",
  gitTimeout: "Gitの操作が時間内に終わりませんでした。",
  invalidGitPath: "Gitに渡せないパスです。",
  gitNotReady: "Git操作を実行できない状態です",
  invalidCommitMessage: "コミットメッセージが正しくありません",
  nothingToCommit: "ステージされた変更がありません",
  gitUnmergedChanges: "競合を解決していないファイルがあります",
  gitOperationInProgress: "マージなどの操作が途中です",
  gitIdentityMissing: "Gitのユーザー名・メールアドレスが設定されていません",
  gitCommitRejected: "コミットが拒否されました（フックなど）",
  invalidHistoryRequest: "履歴を取得する条件が正しくありません",
  gitDiscardRejected: "この変更は破棄できません",
  gitNoCommitToAmend: "コミットがまだありません",
  gitCommitAlreadyPushed: "プッシュ済みのコミットは変更できません",
  gitCannotUndoCommit:
    "このコミットは元に戻せません（最初のコミットまたはマージコミット）",
  gitNoRemote: "リモートが設定されていません",
  gitNoUpstream: "このブランチには上流ブランチがありません",
  gitDetachedHead: "ブランチをチェックアウトしていません（detached HEAD）",
  gitRemoteNotFound: "リモートが見つかりません",
  gitAuthenticationFailed:
    "認証に失敗しました。ターミナルの git で push / pull できるか（資格情報マネージャや SSH キーの設定）を確認してください",
  gitNetworkUnavailable: "リモートに接続できませんでした",
  gitPushRejected: "プッシュが拒否されました。先にプルしてください",
  gitPullConflicts: "プルで競合が発生しました。マージの変更を解決してください",
  gitPullBlockedByLocalChanges:
    "ローカルの変更がプルで上書きされるため中止しました。先にコミットしてください",
  invalidThemePreference: "テーマ設定の値が正しくありません。",
  invalidLanguagePreference: "表示言語の設定値が正しくありません。",
  invalidViewport: "表示位置の値が正しくありません。",
  invalidProjectTreeWidth: "Project Treeの幅の値が正しくありません。",
  invalidCommandResponse: "内部処理の応答が正しくありません。",
  unexpectedCommandError: "予期しないエラーが発生しました。",
};

const LOAD_ISSUES: Record<LoadIssueKind, string> = {
  unlistedEntity: "一覧に載っていないDocument / Sheetが見つかりました。",
  missingEntity: "一覧に載っているDocument / Sheetが見つかりません。",
  invalidOrderEntry: "順序の記録に不正な項目があります。",
  duplicateEntityId: "IDが重複しています。",
  entityLoadFailed: "読み込みに失敗しました。",
  missingContent: "Blockの本文ファイルが見つかりません。",
  orphanContent: "どのBlockからも参照されていない本文ファイルがあります。",
  leftoverTempFile: "保存途中の一時ファイルが残っています。",
  unrecognizedDirectory: "認識できないフォルダがあります。",
};

export const WORKSPACE_MESSAGES_JA = {
  appRegionTreeLabel: "Project Tree",
  leftPanel: {
    tabsLabel: "左パネルの表示切り替え",
    project: "Project",
    git: "Git",
  },
  splitter: {
    label: "Project Treeの幅",
  },
  topBar: {
    noProject: "Projectが開かれていません",
    openProject: "Projectを開く",
    createProject: "新規Project",
    closeProject: "Projectを閉じる",
    openProjectInNewWindow: "新しいウィンドウでProjectを開く",
    autoSave: "自動保存",
    languageLegend: "言語",
    themeLegend: "テーマ",
    systemOption: "システム",
    themeLight: "ライト",
    themeDark: "ダーク",
  },
  notices: {
    // A light, self-clearing region; not part of the notifications panel.
    regionLabel: "お知らせ",
    documentAlreadyOpen: "既に開いています",
    projectOpenInOtherWindow: "このProjectは別のウィンドウで開いています",
    projectOpenInThisWindow: "このウィンドウで開いています",
    externalReloaded: "外部の変更を読み直しました",
    externalWatchUnavailable:
      "外部の変更を自動で検知できません。ウィンドウに戻ったときに確認します",
  },
  tree: {
    openProjectInNewWindow: "新しいウィンドウでProjectを開く",
    createFolder: "フォルダを作成",
    createDocument: "Documentを作成",
    createSheet: "Sheetを作成",
    deleteFolder: "フォルダを削除",
    deleteDocument: "Documentを削除",
    moveTo: "移動…",
    deleteFolderNotEmptyHint: "空のフォルダだけ削除できます",
    folderExpandedMarker: "▾",
    folderCollapsedMarker: "▸",
    emptyFolder: "空のフォルダです",
    rename: "名前変更",
    moveUp: "上へ移動",
    moveDown: "下へ移動",
    menuButtonText: "⋮",
    unnamedEntity: "（名前を読み込めません）",
    loadFailedMarker: "読み込み失敗",
    loadFailedHint: "読み込みに失敗したため開けません（削除はできます）",
    emptyProject: "Documentがありません",
    noProject: "Projectを開くか、新規Projectを作成してください。",
  },
  tabs: {
    documentTabsLabel: "Document Tabs",
    sheetTabsLabel: "Sheet Tabs",
    documentPanelLabel: "Document",
    sheetPanelLabel: "Sheet",
    close: "閉じる",
    closeButtonText: "×",
    retrySave: "再試行",
    createSheet: "Sheetを作成",
    deleteSheet: "Sheetを削除",
    deleteSheetButtonText: "×",
  },
  saveStatus: {
    saved: "保存済み",
    unsaved: "未保存",
    saving: "保存中",
    error: "保存エラー",
  },
  placeholder: {
    noDocument: "Documentをツリーから開いてください。",
    noProject: "Projectを開くか、新規Projectを作成してください。",
  },
  notifications: {
    panelLabel: "通知",
    emptyPanel: "通知はありません。",
    retry: "再試行",
    dismiss: "この通知を消す",
    deleteSheet: "このSheetを削除",
    details: "詳細",
    projectSource: "Project",
    appSource: "アプリ",
    errorSeverity: "エラー",
    warningSeverity: "警告",
    projectLoadedWithWarnings: "Projectを警告付きで読み込みました",
    documentLoadedWithWarnings: "Documentを警告付きで読み込みました",
    statusLabel: "読み込み状況",
    themeSaveError: "テーマ設定を保存できませんでした",
    languageSaveError: "表示言語の設定を保存できませんでした",
    autoSaveSaveError: "自動保存の設定を保存できませんでした",
    projectTreeWidthSaveError: "Project Treeの幅を保存できませんでした",
    themeLoadIssue:
      "テーマ設定を読み込めませんでした（既定の設定で起動しています）",
    loadFailedDocument: "Documentの読み込みに失敗しました（開けません）",
    loadFailedSheet: "Sheetの読み込みに失敗しました（開けません）",
    orphanContentFile:
      "Block本文ファイルを削除できませんでした（ファイルが残っています）",
    contentLoadFailed:
      "Blockの本文ファイルを読み込めませんでした（編集はできません）",
    imageLoadFailed:
      "画像を読み込めませんでした（画像ファイルが見つからないか、壊れています）",
    detailLabels: {
      kind: "種別",
      path: "パス",
      entityId: "ID",
      detail: "詳細",
    },
  },
  externalChange: {
    // The conflict question (docs/ui-design.md §14).
    documentTitle: (name: string): string =>
      `${quoted(name)}がアプリの外で変更されました`,
    projectTitle: "Projectがアプリの外で変更されました",
    unsavedBody: "保存していない変更があります。",
    unreadableBody:
      "変更された内容を読み込めないため、自動では読み直しません。",
    structureBody: "Document / Folderの構成が変わりました。",
    filesLabel: "変更されたファイル",
    changeLabels: { modified: "変更", removed: "削除" },
    unreadableMark: "読めません",
    compare: "比較",
    compareFile: "比較",
    compareTabTitle: (fileName: string): string => `比較: ${fileName}`,
    compareTabDescription: (name: string, path: string): string =>
      `${quoted(name)}の${path}: ディスク（左）と今の内容（右）の比較`,
    compareHeading: (path: string): string => `${path}: ディスクと今の内容`,
    compareLegend: "左: ディスク、右: 今の内容",
    compareDraftNotice:
      "確定済みの内容と比べています。入力中でまだ確定していない下書きは含まれません。",
    compareIdentical: "ディスク上の内容と今の内容は同じです。",
    compareRemovedOnDisk: "ディスク上では削除されています。",
    compareNotUtf8:
      "ディスク上のファイルはUTF-8として読めないため、比較できません。",
    compareTooLarge: "ファイルが大きすぎるため、比較できません。",
    compareUnavailable: "比較できません（本文を読み込めていません）。",
    compareLoading: "比較しています…",
    compareClose: "比較を閉じる",
    compareJsonUnsupported: "行の比較はできません",
    compareRemovedFile: "ディスク上では削除されています",
    keepCurrent: "今の内容を維持",
    reload: "再読み込み",
    overwrite: "上書き保存…",
    reloadConfirmTitle: "再読み込みしますか?",
    reloadConfirmBody: "保存していない変更は失われます。",
    reloadConfirm: "再読み込み",
    overwriteConfirmTitle: "上書き保存しますか?",
    overwriteConfirmBody:
      "ディスク上の変更を、今の内容で上書きします。よろしいですか?",
    overwriteConfirm: "上書き保存",
    keptBanner: "ディスク上の内容と異なります。保存は停止しています",
    bannerLabel: "外部の変更",
    projectBannerSource: "Project",
    cancel: "キャンセル",
  },
  dialogs: {
    cancel: "キャンセル",
    delete: "削除",
    undoNotice: "この操作はUndoできません。",
    deleteFolderConsequence: "このフォルダ（空）が削除されます。",
    deleteDocumentConsequence:
      "このDocumentのSheet、Block本文ファイル、Assetもすべて削除されます。",
    createProject: {
      title: "新規Project",
      nameLabel: "Project名",
      submit: "作成",
    },
    createDocument: {
      title: "Documentを作成",
      nameLabel: "Document名",
      submit: "作成",
    },
    createFolder: {
      title: "フォルダを作成",
      nameLabel: "フォルダ名",
      submit: "作成",
    },
    confirmMoveSave: {
      body: "未保存の変更があります。保存して移動しますか？",
      confirm: "保存して移動",
    },
    confirmUnsavedClose: {
      body: "未保存の変更があります。保存しますか？",
      save: "保存",
      discard: "保存せずに閉じる",
      windowTitle: "アプリを終了",
      projectTitle: "Projectを閉じる",
      switchProjectTitle: "別のProjectを開く",
    },
    moveEntry: {
      description: "移動先を選んでください。",
      choose: "ここに移動",
      newFolder: "新しいフォルダ",
      newFolderInputLabel: "新しいフォルダの名前",
      projectRoot: "Project直下",
      listLabel: "移動先",
      currentParentHint: "現在の場所です",
      selfOrDescendantHint: "自分自身またはその中には移動できません",
    },
    createSheet: {
      title: "Sheetを作成",
      nameLabel: "Sheet名",
      submit: "作成",
    },
    nameRequired: "名前を入力してください。",
    nameInvalid:
      "この名前は使用できません（長すぎる、または使用できない文字が含まれています）。",
  },
  operationHeadlines: OPERATION_HEADLINES,
  errorKinds: ERROR_KINDS,
  loadIssues: LOAD_ISSUES,
  skippedBlocks: (count: number): string => `${count}個のBlock`,
  documentSourceLabel: (name: string): string => `Document: ${name}`,
  moveEntryTitle: (name: string): string => `${quoted(name)}移動…`,
  closeDocumentConfirmationTitle: (name: string): string =>
    `${quoted(name)}を閉じる`,
  deleteConfirmationTitle: (name: string): string =>
    `「${name}」を削除しますか？`,
  // `subject` is null when the failure is not about one named thing.
  operationFailure: (
    subject: string | null,
    headline: string,
    errorText: string,
  ): string =>
    `${subject === null ? "" : `${quoted(subject)}: `}${headline}。${errorText}`,
  // Where a failed save belongs: the Project (null), or a named Document / Folder.
  saveFailure: (documentName: string | null, errorText: string): string =>
    `${documentName === null ? "Project" : quoted(documentName)}を保存できませんでした。${errorText}`,
  documentLoadStatus: (headline: string, documentName: string): string =>
    `${headline}（${documentName}）`,
  notificationCounts: (errors: number, warnings: number): string => {
    if (errors > 0 && warnings > 0) {
      return `エラー ${errors}件・警告 ${warnings}件`;
    }
    if (errors > 0) return `エラー ${errors}件`;
    if (warnings > 0) return `警告 ${warnings}件`;
    return "通知なし";
  },
  closeTabLabel: (name: string): string => `${name}を閉じる`,
  retrySaveLabel: (name: string): string => `${name}の保存を再試行`,
  deleteSheetTabLabel: (name: string): string => `Sheetを削除（${name}）`,
  treeMenuLabel: (name: string): string => `${name} のメニュー`,
  renameInputLabel: (name: string): string => `${name}の名前を変更`,
} as const;
