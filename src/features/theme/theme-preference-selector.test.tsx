import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEME_PREFERENCES } from "../../application/local-state/theme";
import { ThemePreferenceSelector } from "./theme-preference-selector";

const THEME_SETTINGS_LEGEND = "Theme";
const THEME_PREFERENCE_LABELS = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const options = THEME_PREFERENCES.map((preference) => ({
  value: preference,
  label: THEME_PREFERENCE_LABELS[preference],
}));

function render(value: string, disabled?: boolean) {
  return renderToStaticMarkup(
    <ThemePreferenceSelector
      legend={THEME_SETTINGS_LEGEND}
      value={value}
      options={options}
      onChange={() => {}}
      disabled={disabled}
    />,
  );
}

describe("ThemePreferenceSelector", () => {
  it("renders a labelled group with exactly the three options", () => {
    const markup = render("system");
    expect(markup).toContain("<fieldset");
    expect(markup).toContain("<legend");
    expect(markup).toContain(">Theme</legend>");
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    for (const label of ["System", "Light", "Dark"]) {
      expect(markup).toContain(`${label}</label>`);
    }
  });

  it("checks only the current value", () => {
    for (const value of THEME_PREFERENCES) {
      const markup = render(value);
      expect(markup.match(/checked=""/g)).toHaveLength(1);
      expect(markup).toMatch(
        new RegExp(
          `value="${value}"[^>]*checked=""|checked=""[^>]*value="${value}"`,
        ),
      );
    }
  });

  it("shares one group name across the radios", () => {
    const names = new Set(render("light").match(/name="[^"]*"/g));
    expect(names.size).toBe(1);
  });

  it("is enabled by default and disabled on request", () => {
    expect(render("system")).not.toContain("disabled");
    const disabled = render("system", true);
    expect(disabled).toContain("<fieldset");
    expect(disabled.match(/disabled=""/g)).toHaveLength(4);
  });
});

const sources = import.meta.glob("./theme-preference-selector.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("presentational selector module", () => {
  it("imports nothing from application, infrastructure, stores or the controller", () => {
    const source = Object.values(sources)[0] ?? "";
    const specifiers = [...source.matchAll(/from\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(
        /application|infrastructure|shared\/store|controller/,
      );
    }
  });
});
