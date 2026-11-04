// User-visible strings of the AI integration (MCP) screen, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const AI_ACCESS_MESSAGES_JA = {
  menuItem: "AI連携（MCP）…",
  title: "AI連携（MCP）",
  registerHeading: "AIツールに登録する",
  registerIntro:
    "Claude・Codex・GitHub Copilot・Cursor などの AI ツールに、次のコマンドを MCP サーバーとして1回だけ登録します。Project を指定する必要はありません。",
  commandLabel: "コマンド",
  jsonLabel: "設定ファイルに書く場合（JSON）",
  registerHint:
    "登録のしかたは AI ツールごとに異なります。各ツールのヘルプで「MCP サーバーの追加」を参照してください。",
  copy: "コピー",
  copied: "コピーしました",
  copyFailed: "コピーできませんでした。欄を選んでコピーしてください",
  serverMissing:
    "この場所に MCP サーバーが見つかりません。アプリと同じフォルダに design-dawn-mcp を置いてください。",
  projectsHeading: "AIが使えるProject",
  projectsIntro:
    "AI が使えるのは、ここに追加したProjectだけです。AI はふだん「使用中」のProject（最後に使ったウィンドウのもの）を操作し、AI から別のProjectを選ぶこともできます。AI が編集できるのは、編集を許可したProjectだけです。",
  projectsEmpty: "まだありません。下のボタンでProjectを追加してください。",
  addOpenProject: "今開いているProjectを追加",
  addProjectFolder: "フォルダを指定して追加…",
  openProjectListed: "開いているProjectは追加済みです",
  noOpenProject: "このウィンドウではProjectを開いていません",
  addFailed:
    "追加できませんでした。Projectのフォルダ（project.json があるフォルダ）を選んでください。",
  current: "使用中",
  missingProject: "（見つかりません）",
  allowWrite: "AIによる編集を許可",
  remove: "一覧から外す",
  removeLabel: (name: string): string => `${name}を一覧から外す`,
  allowWriteLabel: (name: string): string => `${name}: AIによる編集を許可`,
  loading: "読み込み中…",
  loadFailed: "読み込めませんでした",
  listUnreadable:
    "保存されている一覧を読み込めませんでした。Projectを開き直すと作り直されます。",
  changeFailed: "変更できませんでした",
  close: "閉じる",
} as const;

export type AiAccessMessages = Widen<typeof AI_ACCESS_MESSAGES_JA>;

const AI_ACCESS_MESSAGES_EN: AiAccessMessages = {
  menuItem: "AI Integration (MCP)…",
  title: "AI Integration (MCP)",
  registerHeading: "Register with an AI tool",
  registerIntro:
    "Register the command below once as an MCP server in your AI tool (Claude, Codex, GitHub Copilot, Cursor and others). No Project needs to be named.",
  commandLabel: "Command",
  jsonLabel: "For a configuration file (JSON)",
  registerHint:
    "Each AI tool registers MCP servers its own way; see “adding an MCP server” in the tool’s help.",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Could not copy. Select the field and copy it",
  serverMissing:
    "The MCP server is not at this place. Put design-dawn-mcp in the same folder as the app.",
  projectsHeading: "Projects AI can use",
  projectsIntro:
    "An AI can use only the Projects you add here. It normally works on the Project “in use” (the one of the window used last) and can choose another one. An AI can edit only the Projects you allow.",
  projectsEmpty: "None yet. Add a Project with the buttons below.",
  addOpenProject: "Add the Open Project",
  addProjectFolder: "Add a Folder…",
  openProjectListed: "The open Project is already added",
  noOpenProject: "No Project is open in this window",
  addFailed:
    "Could not add it. Choose a Project folder (the one with project.json).",
  current: "In use",
  missingProject: "(not found)",
  allowWrite: "Allow editing by AI",
  remove: "Remove from list",
  removeLabel: (name) => `Remove ${name} from the list`,
  allowWriteLabel: (name) => `${name}: allow editing by AI`,
  loading: "Loading…",
  loadFailed: "Could not be loaded",
  listUnreadable:
    "The stored list could not be read. It is made again when you open a Project.",
  changeFailed: "Could not change it",
  close: "Close",
};

export const AI_ACCESS_MESSAGES: Readonly<
  Record<DisplayLanguage, AiAccessMessages>
> = { ja: AI_ACCESS_MESSAGES_JA, en: AI_ACCESS_MESSAGES_EN };
