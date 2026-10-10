import type { LanguageState } from "../../application/language/language-controller";
import type { DisplayLanguage } from "../../config/language-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import {
  CANVAS_MESSAGES,
  type CanvasMessages,
} from "../canvas/canvas-messages";
import { GIT_MESSAGES, type GitMessages } from "../git/git-messages";
import { IMAGE_MESSAGES, type ImageMessages } from "../image/image-messages";
import {
  MARKDOWN_MESSAGES,
  type MarkdownMessages,
} from "../markdown/markdown-messages";
import {
  WORKSPACE_MESSAGES,
  type WorkspaceMessages,
} from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";

// Every catalog of one language. The object per language is created once, so the value
// the hook returns only changes when the display language does.
export interface Messages {
  readonly workspace: WorkspaceMessages;
  readonly canvas: CanvasMessages;
  readonly markdown: MarkdownMessages;
  readonly image: ImageMessages;
  readonly git: GitMessages;
}

function collectMessages(language: DisplayLanguage): Messages {
  return {
    workspace: WORKSPACE_MESSAGES[language],
    canvas: CANVAS_MESSAGES[language],
    markdown: MARKDOWN_MESSAGES[language],
    image: IMAGE_MESSAGES[language],
    git: GIT_MESSAGES[language],
  };
}

// Built from a language table, not from fixed keys, so a new language cannot be forgotten.
const MESSAGES_BY_LANGUAGE: Readonly<Record<DisplayLanguage, Messages>> = {
  ja: collectMessages("ja"),
  en: collectMessages("en"),
};

export function messagesFor(language: DisplayLanguage): Messages {
  return MESSAGES_BY_LANGUAGE[language];
}

const selectLanguage = (state: LanguageState) => state.language;

// The texts of the current display language; the component re-renders when it changes.
// All user-visible text goes through this hook (docs/coding-guidelines.md §14).
export function useMessages(): Messages {
  const { languageController } = useWorkspaceServices();
  return messagesFor(
    useStoreSelector(languageController.store, selectLanguage),
  );
}
