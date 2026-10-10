import { describe, expect, it } from "vitest";
import { DISPLAY_LANGUAGES } from "../../config/language-config";
import { applyLanguage } from "./apply-language";

describe("applyLanguage", () => {
  it("sets lang to the display language id", () => {
    const target = { lang: "" };
    for (const language of DISPLAY_LANGUAGES) {
      applyLanguage(target, language);
      expect(target.lang).toBe(language);
    }
  });
});
