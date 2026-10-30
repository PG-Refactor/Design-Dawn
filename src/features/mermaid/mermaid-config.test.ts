import { describe, expect, it } from "vitest";
import {
  buildMermaidConfig,
  MERMAID_DEFAULT_SECURE_KEYS,
  MERMAID_FIXED_CONFIG,
} from "./mermaid-config";

describe("the Mermaid configuration", () => {
  it("fixes the security-relevant settings", () => {
    const config = buildMermaidConfig({});
    expect(config.securityLevel).toBe("strict");
    expect(config.htmlLabels).toBe(false);
    expect(config.startOnLoad).toBe(false);
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.deterministicIds).toBe(true);
    expect(config.theme).toBe("base");
  });

  it("leaves the upstream limits at Mermaid's defaults", () => {
    const keys = Object.keys(buildMermaidConfig({ textColor: "x" }));
    for (const key of ["maxTextSize", "maxEdges"]) {
      expect(keys).not.toContain(key);
    }
  });

  it("protects every key Mermaid protects by default, and htmlLabels", () => {
    const { secure } = buildMermaidConfig({});
    for (const key of MERMAID_DEFAULT_SECURE_KEYS)
      expect(secure).toContain(key);
    expect(secure).toContain("htmlLabels");
    expect(secure).toContain("securityLevel");
  });

  it("does not share the secure list between configurations", () => {
    expect(buildMermaidConfig({}).secure).not.toBe(
      buildMermaidConfig({}).secure,
    );
  });

  it("passes only the resolved theme values on", () => {
    const config = buildMermaidConfig({
      textColor: "value-a",
      lineColor: "",
      fontFamily: "value-b",
    });
    expect(config.themeVariables).toEqual({
      textColor: "value-a",
      fontFamily: "value-b",
    });
    expect(config.securityLevel).toBe(MERMAID_FIXED_CONFIG.securityLevel);
  });

  it("keeps a boolean darkMode, including false", () => {
    expect(buildMermaidConfig({ darkMode: true }).themeVariables).toEqual({
      darkMode: true,
    });
    expect(buildMermaidConfig({ darkMode: false }).themeVariables).toEqual({
      darkMode: false,
    });
  });
});
