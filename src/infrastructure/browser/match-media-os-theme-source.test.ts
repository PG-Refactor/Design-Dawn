import { describe, expect, it } from "vitest";
import {
  createMatchMediaOsThemeSource,
  DARK_COLOR_SCHEME_QUERY,
  type ThemeMediaQueryList,
} from "./match-media-os-theme-source";

type ChangeListener = (event: { readonly matches: boolean }) => void;

function createFakeMediaQuery(initialMatches: boolean) {
  const listeners = new Set<ChangeListener>();
  const queries: string[] = [];
  const mediaQuery: ThemeMediaQueryList & { matches: boolean } = {
    matches: initialMatches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    matchMedia: (query: string) => {
      queries.push(query);
      return mediaQuery;
    },
    queries,
    listeners,
    change(matches: boolean) {
      mediaQuery.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
  };
}

describe("match-media OS theme source", () => {
  it("queries prefers-color-scheme: dark", () => {
    const fake = createFakeMediaQuery(true);
    createMatchMediaOsThemeSource(fake.matchMedia);
    expect(fake.queries).toEqual([DARK_COLOR_SCHEME_QUERY]);
  });

  it("reports the current theme", () => {
    expect(
      createMatchMediaOsThemeSource(
        createFakeMediaQuery(true).matchMedia,
      ).current(),
    ).toBe("dark");
    expect(
      createMatchMediaOsThemeSource(
        createFakeMediaQuery(false).matchMedia,
      ).current(),
    ).toBe("light");
  });

  it("notifies changes in both directions", () => {
    const fake = createFakeMediaQuery(false);
    const source = createMatchMediaOsThemeSource(fake.matchMedia);
    const seen: string[] = [];
    source.subscribe((theme) => seen.push(theme));
    fake.change(true);
    fake.change(false);
    expect(seen).toEqual(["dark", "light"]);
    expect(source.current()).toBe("light");
  });

  it("removes the listener on unsubscribe", () => {
    const fake = createFakeMediaQuery(false);
    const source = createMatchMediaOsThemeSource(fake.matchMedia);
    const seen: string[] = [];
    const unsubscribe = source.subscribe((theme) => seen.push(theme));
    expect(fake.listeners.size).toBe(1);
    unsubscribe();
    expect(fake.listeners.size).toBe(0);
    fake.change(true);
    expect(seen).toEqual([]);
  });

  it("reports an unknown theme when matchMedia is missing", () => {
    const source = createMatchMediaOsThemeSource(undefined);
    expect(source.current()).toBeNull();
    expect(() => source.subscribe(() => {})()).not.toThrow();
  });
});
