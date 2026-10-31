// The license texts shown from the Help menu. They are the very files at the repository
// root, so what the app shows can never drift from what is published. Loaded on demand:
// the third-party notices are several hundred kilobytes and are rarely opened.

export type HelpTextKind = "license" | "thirdPartyLicenses";

export type HelpTextLoader = (kind: HelpTextKind) => Promise<string>;

export const loadHelpText: HelpTextLoader = async (kind) => {
  switch (kind) {
    case "license":
      return (await import("../../../LICENSE?raw")).default;
    case "thirdPartyLicenses":
      return (await import("../../../THIRD_PARTY_NOTICES.md?raw")).default;
  }
};
