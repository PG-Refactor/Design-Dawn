import { describe, expect, it } from "vitest";
import { createNavigatorSystemLanguageSource } from "./navigator-system-language-source";

describe("createNavigatorSystemLanguageSource", () => {
  it("returns the navigator languages in order", () => {
    const source = createNavigatorSystemLanguageSource({
      languages: ["ja-JP", "en-US"],
    });
    expect(source.current()).toEqual(["ja-JP", "en-US"]);
  });

  it("returns an empty list without a navigator or languages", () => {
    expect(createNavigatorSystemLanguageSource(undefined).current()).toEqual(
      [],
    );
    expect(createNavigatorSystemLanguageSource({}).current()).toEqual([]);
  });
});
