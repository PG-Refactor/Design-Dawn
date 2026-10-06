import { describe, expect, it } from "vitest";
import { parseFolder, type RawFolder } from "./folder";

const raw: RawFolder = {
  schemaVersion: 1,
  folderId: "01928f3a-2000-7000-8000-000000000001",
  name: "Architecture",
  childOrder: [
    "01928f3a-2000-7000-8000-000000000002",
    "01928f3a-3000-7000-8000-000000000001",
  ],
};

describe("parseFolder", () => {
  it("accepts a valid folder and keeps the child order", () => {
    const parsed = parseFolder(raw);
    expect(parsed.ok && parsed.value.childOrder).toEqual(raw.childOrder);
  });

  it("rejects a repeated child ID", () => {
    const parsed = parseFolder({
      ...raw,
      childOrder: [...raw.childOrder, raw.childOrder[0] as string],
    });
    expect(!parsed.ok && parsed.error.kind).toBe("duplicateId");
  });

  it("rejects an invalid name and a newer schema", () => {
    const badName = parseFolder({ ...raw, name: "" });
    expect(!badName.ok && badName.error.kind).toBe("invalidDisplayName");
    const newer = parseFolder({ ...raw, schemaVersion: 2 });
    expect(!newer.ok && newer.error.kind).toBe("unsupportedSchemaVersion");
  });
});
