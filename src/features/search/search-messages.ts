// User-visible strings of the Search panel, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const SEARCH_MESSAGES_JA = {
  title: "検索",
  queryLabel: "検索する文字",
  matchCase: "大文字と小文字を区別",
  search: "検索",
  replacementLabel: "置換後の文字",
  replaceAll: "すべて置換",
  replaceBlock: "置換",
  replaceBlockLabel: (where: string): string => `${where} の中を置換`,
  noProject: "Projectを開くと検索できます。",
  searching: "検索中…",
  noMatches: "見つかりませんでした。",
  matchCount: (count: number): string => `${count} 件`,
  truncated: (limit: number): string =>
    `${limit} 件までを表示しています。検索する文字を長くして絞り込んでください。`,
  unreadable: (count: number): string =>
    `${count} 個のブロックは本文を読めなかったため検索していません。`,
  replaced: (count: number): string => `${count} か所を置換しました。`,
  caption: "キャプション",
  line: (line: number): string => `${line} 行目`,
  replaceNote:
    "置換はブロックの本文だけが対象です（キャプションは対象外）。ブロックごとに元に戻せます。",
} as const;

export type SearchMessages = Widen<typeof SEARCH_MESSAGES_JA>;

const SEARCH_MESSAGES_EN: SearchMessages = {
  title: "Search",
  queryLabel: "Text to find",
  matchCase: "Match case",
  search: "Search",
  replacementLabel: "Replace with",
  replaceAll: "Replace All",
  replaceBlock: "Replace",
  replaceBlockLabel: (where) => `Replace in ${where}`,
  noProject: "Open a Project to search it.",
  searching: "Searching…",
  noMatches: "No matches.",
  matchCount: (count) => (count === 1 ? "1 match" : `${count} matches`),
  truncated: (limit) =>
    `Showing the first ${limit} matches. Search for longer text to narrow them down.`,
  unreadable: (count) =>
    count === 1
      ? "1 block was not searched because its text could not be read."
      : `${count} blocks were not searched because their text could not be read.`,
  replaced: (count) =>
    count === 1 ? "Replaced 1 occurrence." : `Replaced ${count} occurrences.`,
  caption: "Caption",
  line: (line) => `Line ${line}`,
  replaceNote:
    "Only block text is replaced (not captions). Each block can be undone on its own.",
};

export const SEARCH_MESSAGES: Readonly<
  Record<DisplayLanguage, SearchMessages>
> = { ja: SEARCH_MESSAGES_JA, en: SEARCH_MESSAGES_EN };
