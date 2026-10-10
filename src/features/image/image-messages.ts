// User-visible strings of the Image block, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const IMAGE_MESSAGES_JA = {
  loadFailed: "画像を読み込めません",
  pathLabel: "パス",
  // The file name is not used: the contentPath is shown in the error state instead, and the
  // id tail (`shortBlockId`) is what names blocks everywhere else.
  altText: (shortId: string): string => `画像（${shortId}）`,
} as const;

export type ImageMessages = Widen<typeof IMAGE_MESSAGES_JA>;

const IMAGE_MESSAGES_EN: ImageMessages = {
  loadFailed: "The image cannot be loaded",
  pathLabel: "Path",
  altText: (shortId) => `Image (${shortId})`,
};

export const IMAGE_MESSAGES: Readonly<Record<DisplayLanguage, ImageMessages>> =
  { ja: IMAGE_MESSAGES_JA, en: IMAGE_MESSAGES_EN };
