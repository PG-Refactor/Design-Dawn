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
