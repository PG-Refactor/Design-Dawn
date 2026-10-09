// User-visible texts of the Git panel (docs/ui-design.md §13, docs/git-development.md §11.3).
// The meaning of a state is carried by these texts, never by colour alone.

export const GIT_MESSAGES = {
  panelLabel: "Git",
  mainAreaLabel: "Gitの差分",
  mainAreaPlaceholder: "ファイルを選択すると差分を表示します",
  refresh: "更新",
  refreshing: "更新中…",
  retry: "再試行",
  noProject: "Projectを開くとGitの状態を表示します",
  loading: "Gitの状態を読み込んでいます…",
  statusFailed: "Gitの状態を取得できませんでした",
  changeListLabel: "変更の一覧",
  noChanges: "変更はありません",
  operating: "処理中…",
  stage: "ステージ",
  unstage: "ステージ解除",
  stageAll: "すべてステージ",
  unstageAll: "すべて解除",
  conflictNote: "競合の解決はこのバージョンでは扱いません",
  sectionTitles: {
    staged: "ステージ済み",
    changes: "変更",
    untracked: "未追跡",
    conflicts: "競合",
  },
  // The letter is shown; the label is its accessible name (colour never carries meaning).
  changeKinds: {
    modified: { letter: "M", label: "変更" },
    added: { letter: "A", label: "追加" },
    deleted: { letter: "D", label: "削除" },
    renamed: { letter: "R", label: "名前変更" },
    copied: { letter: "C", label: "コピー" },
    typeChanged: { letter: "T", label: "種類の変更" },
    unmerged: { letter: "U", label: "競合" },
    untracked: { letter: "?", label: "未追跡" },
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
} as const;

// A renamed file as "old → new".
export function renamedPathText(originalPath: string, path: string): string {
  return `${originalPath} → ${path}`;
}
