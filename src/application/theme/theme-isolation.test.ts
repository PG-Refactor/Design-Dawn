import { describe, expect, it } from "vitest";
import {
  createFakeAppSettingsGateway,
  createFakeOsThemeSource,
} from "../test-support/fake-theme";
import { openedDocumentA } from "../test-support/workspace-harness";
import { createThemeController } from "./theme-controller";

describe("theme isolation", () => {
  it("changing the theme leaves application state, history and project data untouched", async () => {
    const { store, gateway } = await openedDocumentA();
    const stateBefore = store.getState();
    const historiesBefore = [...stateBefore.documents.values()].map(
      (session) => session.history,
    );
    expect(historiesBefore.length).toBeGreaterThan(0);
    const callsBefore = [...gateway.calls];
    const diskBefore = structuredClone({
      projectName: gateway.disk.projectName,
      childOrder: gateway.disk.childOrder,
    });
    const filesBefore = new Map(gateway.files);

    const controller = createThemeController({
      gateway: createFakeAppSettingsGateway(),
      osThemeSource: createFakeOsThemeSource("light"),
    });
    await controller.initialize();
    await controller.setPreference("dark");
    await controller.setPreference("system");

    expect(store.getState()).toBe(stateBefore);
    expect(
      [...store.getState().documents.values()].map(
        (session) => session.history,
      ),
    ).toEqual(historiesBefore);
    expect(gateway.calls).toEqual(callsBefore);
    expect(gateway.calls).toEqual([]);
    expect({
      projectName: gateway.disk.projectName,
      childOrder: gateway.disk.childOrder,
    }).toEqual(diskBefore);
    expect(gateway.files).toEqual(filesBefore);
  });
});
