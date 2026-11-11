// User-visible strings of the Search panel, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const SEARCH_MESSAGES_JA = {
  title: "検索",
  queryLabel: "検索する文字",
  matchCase: "大文字と小文字を区別",
  toggleReplace: "置換の表示を切り替え",
  replacementLabel: "置換後の文字",
  replaceAll: "すべて置換",
  replaceBlockLabel: (where: string): string => `${where} の中を置換`,
  replaceMatchLabel: (where: string): string => `${where} を置換`,
  noProject: "Projectを開くと検索できます。",
  searching: "検索中…",
  noMatches: "見つかりませんでした。",
  matchCount: (count: number): string => `${count} 件`,
  matchSummary: (count: number, blocks: number): string =>
    `${count} 件（${blocks} ブロック）`,
  truncated: (limit: number): string =>
    `${limit} 件までを表示しています。検索する文字を長くして絞り込んでください。`,
  unreadable: (count: number): string =>
    `${count} 個のブロックは本文を読めなかったため検索していません。`,
  replaced: (count: number): string => `${count} か所を置換しました。`,
  captionsSkipped: (count: number): string =>
    `${count} 個のキャプションは、置換すると長すぎるため置換しませんでした。`,
  caption: "キャプション",
  line: (line: number): string => `${line} 行目`,
  sheetFindLabel: "シート内の検索",
  findInSheetMenu: "シート内を検索",
  searchProjectMenu: "Projectを検索",
  previousMatch: "前の一致 (Shift+Enter)",
  nextMatch: "次の一致 (Enter)",
  closeFind: "閉じる",
  replaceOne: "置換",
  position: (current: number, total: number): string => `${current} / ${total}`,
  noResults: "結果なし",
  replaceNote:
    "本文とキャプションを置換します。ブロックごとに元に戻せます（本文とキャプションは別々）。",
} as const;

export type SearchMessages = Widen<typeof SEARCH_MESSAGES_JA>;

const SEARCH_MESSAGES_EN: SearchMessages = {
  title: "Search",
  queryLabel: "Text to find",
  matchCase: "Match case",
  toggleReplace: "Toggle Replace",
  replacementLabel: "Replace with",
  replaceAll: "Replace All",
  replaceBlockLabel: (where) => `Replace in ${where}`,
  replaceMatchLabel: (where) => `Replace ${where}`,
  noProject: "Open a Project to search it.",
  searching: "Searching…",
  noMatches: "No matches.",
  matchCount: (count) => (count === 1 ? "1 match" : `${count} matches`),
  matchSummary: (count, blocks) =>
    `${count === 1 ? "1 match" : `${count} matches`} in ${blocks === 1 ? "1 block" : `${blocks} blocks`}`,
  truncated: (limit) =>
    `Showing the first ${limit} matches. Search for longer text to narrow them down.`,
  unreadable: (count) =>
    count === 1
      ? "1 block was not searched because its text could not be read."
      : `${count} blocks were not searched because their text could not be read.`,
  replaced: (count) =>
    count === 1 ? "Replaced 1 occurrence." : `Replaced ${count} occurrences.`,
  captionsSkipped: (count) =>
    count === 1
      ? "1 caption was not replaced because the result would be too long."
      : `${count} captions were not replaced because the results would be too long.`,
  caption: "Caption",
  line: (line) => `Line ${line}`,
  sheetFindLabel: "Find in Sheet",
  findInSheetMenu: "Find in Sheet",
  searchProjectMenu: "Search Project",
  previousMatch: "Previous Match (Shift+Enter)",
  nextMatch: "Next Match (Enter)",
  closeFind: "Close",
  replaceOne: "Replace",
  position: (current, total) => `${current} of ${total}`,
  noResults: "No results",
  replaceNote:
    "Replaces in block text and captions. Each block can be undone on its own (text and caption separately).",
};

export const SEARCH_MESSAGES: Readonly<
  Record<DisplayLanguage, SearchMessages>
> = { ja: SEARCH_MESSAGES_JA, en: SEARCH_MESSAGES_EN };
