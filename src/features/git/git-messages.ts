// User-visible texts of the Git panel,
// one catalog per display language. The meaning of a state is carried by these texts,
// never by colour alone.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const DOWN_ARROW = "↓";
const UP_ARROW = "↑";

const GIT_MESSAGES_JA = {
  panelLabel: "Git",
  diffTabIcon: "±",
  diffTabTitle: (name: string, side: "staged" | "unstaged"): string =>
    `${name} (${side === "staged" ? "Index" : "Working Tree"})`,
  diffTabDescription: (pathText: string, preview: boolean): string =>
    preview ? `${pathText}（プレビュー）` : pathText,
  diffLoading: "差分を読み込んでいます…",
  diffEmpty: "差分はありません",
  diffBinary: "バイナリファイルのため、差分を表示できません",
  diffNotUtf8: "UTF-8として読めないため、差分を表示できません",
  diffTextLabel: "差分の内容",
  diffViewToggle: "インライン表示に切り替え",
  sheetDiff: {
    modeGroup: "差分の表示",
    text: "文字",
    visual: "見た目",
    openSheet: "シートを開く",
    openSheetHint: "Project でこのシートを開き、変更されたブロックへ移動します",
    loading: "シートを読み込んでいます…",
    failed: "シートを読み込めませんでした",
    before: "変更前",
    after: "変更後",
    missing: "このシートはありません",
    unreadable: "読み込めません",
    noChange: "見た目の違いはありません",
    listLabel: "変更されたブロック",
    added: "追加",
    removed: "削除",
    moved: "移動",
    changed: "変更",
    summary: (
      added: number,
      removed: number,
      moved: number,
      changed: number,
    ): string =>
      `追加 ${added} / 削除 ${removed} / 移動 ${moved} / 変更 ${changed}`,
    paneLabel: (which: string): string => `${which}のシート`,
    zoomIn: "拡大",
    zoomOut: "縮小",
    fit: "全体を表示",
  },
  diffRemovedLabel: "削除",
  diffAddedLabel: "追加",
  diffHunkLabel: "変更箇所",
  diffFailed: "差分を取得できませんでした",
  panelTitle: "ソース管理",
  longPathsTitle: (count: number): string =>
    `パスが長すぎるファイルが ${count} 個あります`,
  longPathsBody:
    "Windows の Git では、パスが 260 文字以上のファイルは追加もコミットもできないため、コミットを止めています。フォルダを浅くするか名前を短くするか、長いパスを有効にしてください。",
  portablePathsTitle: (count: number): string =>
    `Project の中のパスが長いファイルが ${count} 個あります`,
  portablePathsBody:
    "ほかのパソコンで深いフォルダに置くと、Windows のパスの上限（260 文字）を超えることがあります。",
  longPathsList: "該当するファイル",
  longPathsMore: (count: number): string => `ほか ${count} 個`,
  enableLongPaths: "このProjectで長いパスを有効にする…",
  enableLongPathsConfirm:
    "このProjectのリポジトリの設定（.git/config）で core.longpaths を true にします。パソコン全体の Git の設定は変えません。Git for Windows で長いパスのファイルを扱えるようになります。",
  enableLongPathsDo: "有効にする",
  enableLongPathsCancel: "キャンセル",
  branchLabel: (name: string): string => `ブランチ ${name}`,
  detachedSuffix: "(detached)",
  refresh: "更新",
  refreshing: "更新中…",
  retry: "再試行",
  noProject: "Projectを開くとGitの状態を表示します",
  loading: "Gitの状態を読み込んでいます…",
  statusFailed: "Gitの状態を取得できませんでした",
  changeListLabel: "変更の一覧",
  noChanges: "変更はありません",
  operating: "処理中…",
  stage: "変更をステージ",
  unstage: "変更のステージング解除",
  stageAll: "すべての変更をステージ",
  unstageAll: "すべての変更のステージング解除",
  discard: "変更を破棄",
  discardAll: "すべての変更を破棄",
  // The confirmation before changes are thrown away.
  discardDialog: {
    singleTracked: (name: string): string => `'${name}' の変更を破棄しますか?`,
    singleUntracked: (name: string): string => `'${name}' を削除しますか?`,
    multiple: (count: number): string =>
      `${count} 個のファイルの変更を破棄しますか?`,
    untrackedNote: (count: number): string =>
      `うち ${count} 個の未追跡のファイルは削除されます。`,
    irreversible: "この操作は元に戻せません。",
    documentsNote:
      "次の Document は保存せずに閉じ、元に戻した後に開き直します。Undo の履歴は消えます。",
    projectFilesNote:
      "Project の構成ファイルが含まれるため、Project を開き直します。ほかの未保存の変更は先に保存されます。",
    confirm: "変更を破棄",
    confirmDelete: "ファイルを削除",
  },
  commitMessageLabel: "コミットメッセージ",
  commitPlaceholder: (branch: string): string =>
    `メッセージ (Ctrl+Enter で '${branch}' にコミット)`,
  commitPlaceholderGeneric: "メッセージ (Ctrl+Enter でコミット)",
  countLabel: (count: number): string => `${count} 件`,
  commit: "コミット",
  committing: "コミット中…",
  // Progress text per `GitState.runningOperation`.
  runningOperation: {
    commit: "コミットしています...",
    amend: "コミットを修正しています...",
    undo: "コミットを元に戻しています...",
    fetch: "フェッチしています...",
    pull: "プルしています...",
    push: "プッシュしています...",
    publish: "ブランチを発行しています...",
    abortMerge: "マージを中止しています...",
  },
  // A merge, cherry-pick, revert or rebase that git left unfinished.
  unfinished: {
    merge:
      "マージの途中です。競合をすべて解決してコミットすると、マージが終わります。",
    cherryPick:
      "cherry-pick の途中です。続けるか中止するには、ターミナルの git を使ってください。",
    revert:
      "リバートの途中です。続けるか中止するには、ターミナルの git を使ってください。",
    rebase:
      "リベースの途中です。続けるか中止するには、ターミナルの git を使ってください。",
  },
  abortMerge: "マージを中止...",
  abortMergeDialog: {
    title: "マージを中止しますか?",
    body: "マージをやめて、マージする前の状態に戻します。マージで変わったファイルと、ここまでに解決した内容は失われます。元に戻すことはできません。",
    confirm: "マージを中止",
  },
  // Commit options, remote operations and their menus.
  commitMenuLabel: "その他のコミット操作",
  commitActions: {
    commit: "コミット",
    amend: "コミット (修正)",
    commitPush: "コミットしてプッシュ",
    commitSync: "コミットして同期",
  },
  moreActions: "その他の操作...",
  headerActions: {
    pull: "プル",
    push: "プッシュ",
    fetch: "フェッチ",
    sync: "同期",
    undoLastCommit: "最後のコミットを元に戻す",
  },
  disabledReasons: {
    noCommits: "コミットがまだありません",
    alreadyPushed: "プッシュ済みのコミットは変更できません",
    noUpstream: "このブランチには上流ブランチがありません",
    detached: "ブランチをチェックアウトしていません",
    messageRequired: "コミットメッセージを入力してください",
    nothingToCommit: "コミットする変更がありません",
  },
  syncChanges: "変更の同期",
  behindCount: (count: number): string => `${count}${DOWN_ARROW}`,
  aheadCount: (count: number): string => `${count}${UP_ARROW}`,
  syncChangesWithCounts: (behind: number, ahead: number): string =>
    `変更の同期 ${behind}${DOWN_ARROW} ${ahead}${UP_ARROW}`,
  syncCountsLabel: (behind: number, ahead: number): string =>
    `変更の同期: ${behind} 件プル、${ahead} 件プッシュ`,
  publishBranch: "ブランチの発行",
  stageAllDialog: {
    title:
      "コミットする変更がステージされていません。すべての変更をステージして直接コミットしますか?",
    confirm: "はい",
  },
  remoteDialog: {
    title: "ブランチの発行先のリモートを選択してください",
    listLabel: "リモート",
    confirm: "発行",
  },
  commitUnsavedNote: "未保存の変更はコミットに含まれません。",
  // Shown before the note while something is unsaved, so the emphasis is not colour only.
  commitUnsavedPrefix: "注意：",
  historyToggle: "履歴",
  historyLoading: "履歴を読み込んでいます…",
  historyFailed: "履歴を取得できませんでした",
  historyEmpty: "まだコミットがありません",
  historyLoadMore: "さらに読み込む",
  historyLoadingMore: "読み込み中…",
  historyMoreFailed: "続きを読み込めませんでした",
  historyListLabel: "コミットの履歴",
  conflictNote: "競合しています",
  resolveConflict: "解決…",
  conflict: {
    title: (path: string): string => `競合の解決: ${path}`,
    description:
      "どちらかの版を選ぶか、下の欄を編集して「この内容で解決」を押すと、ファイルを書き換えてステージします。すべて解決したらコミットしてください。",
    loading: "読み込み中…",
    loadFailed:
      "このファイルの版を読み込めませんでした（テキストでない、または大きすぎます）。Git の別のツールで解決してください。",
    ours: "自分の版（このブランチ）",
    theirs: "相手の版（取り込んだ側）",
    none: "（この側にはファイルがありません）",
    useOurs: "自分の版を使う",
    useTheirs: "相手の版を使う",
    merged: "ブロックごとに自動でマージできました（シートのレイアウト）。",
    useMerged: "自動マージの結果を使う",
    conflictingBlocks: (count: number): string =>
      `両方で別々に変えられたブロックが ${count} 個あるため、自動ではマージできません。`,
    editLabel: "解決後の内容",
    resolve: "この内容で解決",
    cancel: "キャンセル",
  },
  sectionTitles: {
    conflicts: "マージの変更",
    staged: "ステージされている変更",
    changes: "変更",
  },
  // The letter is shown; the label is its accessible name (colour never carries meaning).
  changeKinds: {
    modified: { letter: "M", label: "変更" },
    added: { letter: "A", label: "追加" },
    deleted: { letter: "D", label: "削除" },
    renamed: { letter: "R", label: "名前変更" },
    copied: { letter: "C", label: "コピー" },
    typeChanged: { letter: "T", label: "種類の変更" },
    unmerged: { letter: "!", label: "競合" },
    untracked: { letter: "U", label: "未追跡" },
  },
  repositoryStateLabel: "Repositoryの状態",
  repositoryStates: {
    ready: "このProjectはGitで管理されています",
    notRepository: "このProjectはGitで管理されていません",
    unsupportedRepositoryLayout:
      "このProjectはGitリポジトリの一部として管理されています。現在のバージョンでは、Project全体がGitリポジトリである場合のみGit機能を利用できます。",
    gitUnavailable: "Gitが見つかりません（Git 2.25以上が必要です）",
    error: "Gitの状態を取得できませんでした",
  },
  diffTooLargeText: (limit: string): string =>
    `差分が大きすぎるため表示できません（上限 ${limit}）`,
  // A renamed file as "old → new".
  renamedPathText: (originalPath: string, path: string): string =>
    `${originalPath} → ${path}`,
  // The accessible name of the short commit ID, so the full one is reachable without a mouse.
  commitIdLabel: (commitId: string): string => `コミットID ${commitId}`,
} as const;

export type GitMessages = Widen<typeof GIT_MESSAGES_JA>;

const GIT_MESSAGES_EN: GitMessages = {
  panelLabel: "Git",
  diffTabIcon: "±",
  diffTabTitle: (name, side) =>
    `${name} (${side === "staged" ? "Index" : "Working Tree"})`,
  diffTabDescription: (pathText, preview) =>
    preview ? `${pathText} (Preview)` : pathText,
  diffLoading: "Loading the diff…",
  diffEmpty: "No differences",
  diffBinary: "The diff cannot be shown because the file is binary",
  diffNotUtf8: "The diff cannot be shown because the file is not valid UTF-8",
  diffTextLabel: "Diff content",
  diffViewToggle: "Toggle Inline View",
  sheetDiff: {
    modeGroup: "Show the diff as",
    text: "Text",
    visual: "Looks",
    openSheet: "Open Sheet",
    openSheetHint: "Opens this sheet in the Project at the changed block",
    loading: "Loading the sheet…",
    failed: "Could not load the sheet",
    before: "Before",
    after: "After",
    missing: "This sheet does not exist here",
    unreadable: "Cannot be read",
    noChange: "Nothing looks different",
    listLabel: "Changed blocks",
    added: "Added",
    removed: "Removed",
    moved: "Moved",
    changed: "Changed",
    summary: (added, removed, moved, changed) =>
      `${added} added / ${removed} removed / ${moved} moved / ${changed} changed`,
    paneLabel: (which) => `${which} sheet`,
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fit: "Show all",
  },
  diffRemovedLabel: "removed",
  diffAddedLabel: "added",
  diffHunkLabel: "Change at",
  diffFailed: "Could not get the diff",
  panelTitle: "Source Control",
  longPathsTitle: (count) =>
    count === 1
      ? "1 file has a path that is too long"
      : `${count} files have paths that are too long`,
  longPathsBody:
    "Git on Windows cannot add or commit files whose path is 260 characters or more, so committing is stopped. Use shallower folders or shorter names, or allow long paths.",
  portablePathsTitle: (count) =>
    count === 1
      ? "1 file has a long path inside the Project"
      : `${count} files have long paths inside the Project`,
  portablePathsBody:
    "In a deeper folder on another PC, these can pass Windows' 260-character path limit.",
  longPathsList: "The files",
  longPathsMore: (count) => `and ${count} more`,
  enableLongPaths: "Allow Long Paths for This Project…",
  enableLongPathsConfirm:
    "Sets core.longpaths to true in this Project's repository settings (.git/config). Git's settings for the whole computer are not changed. Git for Windows can then work with files that have long paths.",
  enableLongPathsDo: "Allow",
  enableLongPathsCancel: "Cancel",
  branchLabel: (name) => `Branch ${name}`,
  detachedSuffix: "(detached)",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  retry: "Retry",
  noProject: "Open a Project to see its Git status",
  loading: "Loading the Git status…",
  statusFailed: "Could not get the Git status",
  changeListLabel: "Changes",
  noChanges: "No changes",
  operating: "Working…",
  stage: "Stage Changes",
  unstage: "Unstage Changes",
  stageAll: "Stage All Changes",
  unstageAll: "Unstage All Changes",
  discard: "Discard Changes",
  discardAll: "Discard All Changes",
  discardDialog: {
    singleTracked: (name) =>
      `Are you sure you want to discard changes in '${name}'?`,
    singleUntracked: (name) => `Are you sure you want to DELETE '${name}'?`,
    multiple: (count) =>
      `Are you sure you want to discard changes in ${count} files?`,
    untrackedNote: (count) =>
      count === 1
        ? "1 untracked file will be DELETED."
        : `${count} untracked files will be DELETED.`,
    irreversible: "This action is irreversible!",
    documentsNote:
      "These Documents will be closed without saving and reopened after the discard. Their undo history will be lost.",
    projectFilesNote:
      "Project files are included, so the Project will be reopened. Other unsaved changes will be saved first.",
    confirm: "Discard Changes",
    confirmDelete: "Delete File",
  },
  commitMessageLabel: "Commit message",
  commitPlaceholder: (branch) =>
    `Message (Ctrl+Enter to commit on '${branch}')`,
  commitPlaceholderGeneric: "Message (Ctrl+Enter to commit)",
  countLabel: (count) => (count === 1 ? "1 change" : `${count} changes`),
  commit: "Commit",
  committing: "Committing…",
  runningOperation: {
    commit: "Committing...",
    amend: "Amending...",
    undo: "Undoing the commit...",
    fetch: "Fetching...",
    pull: "Pulling...",
    push: "Pushing...",
    publish: "Publishing the branch...",
    abortMerge: "Aborting the merge...",
  },
  unfinished: {
    merge:
      "A merge is in progress. Resolve every conflict and commit to finish the merge.",
    cherryPick:
      "A cherry-pick is in progress. Use git in a terminal to continue or abort it.",
    revert:
      "A revert is in progress. Use git in a terminal to continue or abort it.",
    rebase:
      "A rebase is in progress. Use git in a terminal to continue or abort it.",
  },
  abortMerge: "Abort Merge...",
  abortMergeDialog: {
    title: "Are you sure you want to abort the merge?",
    body: "The merge is stopped and everything goes back to how it was before the merge. The files the merge changed and the conflicts resolved so far are lost. This cannot be undone.",
    confirm: "Abort Merge",
  },
  commitMenuLabel: "More Commit Actions",
  commitActions: {
    commit: "Commit",
    amend: "Commit (Amend)",
    commitPush: "Commit & Push",
    commitSync: "Commit & Sync",
  },
  moreActions: "More Actions...",
  headerActions: {
    pull: "Pull",
    push: "Push",
    fetch: "Fetch",
    sync: "Sync",
    undoLastCommit: "Undo Last Commit",
  },
  disabledReasons: {
    noCommits: "There are no commits yet",
    alreadyPushed: "A pushed commit cannot be changed",
    noUpstream: "This branch has no upstream branch",
    detached: "No branch is checked out",
    messageRequired: "Enter a commit message",
    nothingToCommit: "There are no changes to commit",
  },
  syncChanges: "Synchronize Changes",
  behindCount: (count) => `${count}${DOWN_ARROW}`,
  aheadCount: (count) => `${count}${UP_ARROW}`,
  syncChangesWithCounts: (behind, ahead) =>
    `Sync Changes ${behind}${DOWN_ARROW} ${ahead}${UP_ARROW}`,
  syncCountsLabel: (behind, ahead) =>
    `Synchronize Changes: ${behind} to pull, ${ahead} to push`,
  publishBranch: "Publish Branch",
  stageAllDialog: {
    title:
      "There are no staged changes to commit. Would you like to stage all your changes and commit them directly?",
    confirm: "Yes",
  },
  remoteDialog: {
    title: "Pick a remote to publish the branch to",
    listLabel: "Remotes",
    confirm: "Publish",
  },
  commitUnsavedNote: "Unsaved changes are not included in the commit.",
  commitUnsavedPrefix: "Note: ",
  historyToggle: "History",
  historyLoading: "Loading the history…",
  historyFailed: "Could not get the history",
  historyEmpty: "No commits yet",
  historyLoadMore: "Load More",
  historyLoadingMore: "Loading…",
  historyMoreFailed: "Could not load more commits",
  historyListLabel: "Commit history",
  conflictNote: "In conflict",
  resolveConflict: "Resolve…",
  conflict: {
    title: (path) => `Resolve conflict: ${path}`,
    description:
      "Choose a version, or edit the text below and press “Resolve with This Text”: the file is rewritten and staged. When everything is resolved, commit.",
    loading: "Loading…",
    loadFailed:
      "The versions of this file could not be read (not text, or too large). Resolve it with another Git tool.",
    ours: "Ours (this branch)",
    theirs: "Theirs (merged in)",
    none: "(no file on this side)",
    useOurs: "Use Ours",
    useTheirs: "Use Theirs",
    merged: "The sheet layout merged block by block.",
    useMerged: "Use the Merged Result",
    conflictingBlocks: (count) =>
      count === 1
        ? "1 block was changed differently on both sides, so it cannot merge by itself."
        : `${count} blocks were changed differently on both sides, so it cannot merge by itself.`,
    editLabel: "Resolved text",
    resolve: "Resolve with This Text",
    cancel: "Cancel",
  },
  sectionTitles: {
    conflicts: "Merge Changes",
    staged: "Staged Changes",
    changes: "Changes",
  },
  changeKinds: {
    modified: { letter: "M", label: "Modified" },
    added: { letter: "A", label: "Added" },
    deleted: { letter: "D", label: "Deleted" },
    renamed: { letter: "R", label: "Renamed" },
    copied: { letter: "C", label: "Copied" },
    typeChanged: { letter: "T", label: "Type changed" },
    unmerged: { letter: "!", label: "Conflict" },
    untracked: { letter: "U", label: "Untracked" },
  },
  repositoryStateLabel: "Repository status",
  repositoryStates: {
    ready: "This Project is managed by Git",
    notRepository: "This Project is not managed by Git",
    unsupportedRepositoryLayout:
      "This Project is part of a larger Git repository. In this version, Git features are available only when the whole Project is the Git repository.",
    gitUnavailable: "Git was not found (Git 2.25 or later is required)",
    error: "Could not get the Git status",
  },
  diffTooLargeText: (limit) => `The diff is too large to show (limit ${limit})`,
  renamedPathText: (originalPath, path) => `${originalPath} → ${path}`,
  commitIdLabel: (commitId) => `Commit ID ${commitId}`,
};

export const GIT_MESSAGES: Readonly<Record<DisplayLanguage, GitMessages>> = {
  ja: GIT_MESSAGES_JA,
  en: GIT_MESSAGES_EN,
};
