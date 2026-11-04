// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProjectAccess } from "../../application/ports/ai-access-gateway";
import { FAKE_MCP_SERVER_PATH } from "../../application/test-support/fake-ai-access";
import { settle } from "../../application/test-support/fakes";
import type { ProjectId } from "../../domain/shared/entity-id";
import { chooseMenuItem } from "../workspace/test-support/menu-helpers";
import {
  renderShell,
  type ShellHarness,
} from "../workspace/test-support/shell-harness";
import { WORKSPACE_MESSAGES } from "../workspace/workspace-messages";
import { AI_ACCESS_MESSAGES } from "./ai-access-messages";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const JA = AI_ACCESS_MESSAGES.ja;
const TOP_BAR = WORKSPACE_MESSAGES.ja.topBar;
const ORDER = "01928f3a-0000-7000-8000-000000000001" as ProjectId;
const BILLING = "01928f3a-0000-7000-8000-000000000002" as ProjectId;

function projects(): AiProjectAccess[] {
  return [
    {
      projectId: ORDER,
      name: "Order Service",
      folderDisplay: "/work/order-service",
      allowWrite: false,
      current: true,
    },
    {
      projectId: BILLING,
      name: null,
      folderDisplay: "/work/billing",
      allowWrite: true,
      current: false,
    },
  ];
}

async function openDialog(): Promise<{
  shell: ShellHarness;
  dialog: HTMLElement;
}> {
  const shell = await renderShell({
    systemLanguages: ["ja"],
    seed: (harness) => {
      harness.aiAccess.projects = projects();
    },
  });
  await chooseMenuItem(shell.user, TOP_BAR.fileMenu, JA.menuItem);
  await act(settle);
  return { shell, dialog: screen.getByRole("dialog", { name: JA.title }) };
}

describe("the AI integration screen", () => {
  it("shows the command and the JSON to register, with the server path filled in", async () => {
    const { dialog } = await openDialog();
    const command = within(dialog).getByRole("textbox", {
      name: JA.commandLabel,
    }) as HTMLInputElement;
    expect(command.value).toBe(FAKE_MCP_SERVER_PATH);
    const json = within(dialog).getByRole("textbox", {
      name: JA.jsonLabel,
    }) as HTMLTextAreaElement;
    expect(JSON.parse(json.value)).toEqual({
      mcpServers: { "design-dawn": { command: FAKE_MCP_SERVER_PATH } },
    });
    expect(within(dialog).queryByText(JA.serverMissing)).toBeNull();
  });

  it("copies the command to the clipboard", async () => {
    const { shell, dialog } = await openDialog();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const [copyCommand] = within(dialog).getAllByRole("button", {
      name: JA.copy,
    });
    if (copyCommand === undefined) throw new Error("no copy button");
    await shell.user.click(copyCommand);
    expect(writeText).toHaveBeenCalledWith(FAKE_MCP_SERVER_PATH);
    expect(within(dialog).getByText(JA.copied)).toBeTruthy();
  });

  it("lists the Projects with the one in use and a missing one marked", async () => {
    const { dialog } = await openDialog();
    const rows = within(dialog).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(JA.current)).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).getByText(JA.missingProject),
    ).toBeTruthy();
  });

  it("allows changes per Project and removes a Project from the list", async () => {
    const { shell, dialog } = await openDialog();
    const allow = within(dialog).getByRole("checkbox", {
      name: JA.allowWriteLabel("Order Service"),
    }) as HTMLInputElement;
    expect(allow.checked).toBe(false);
    await shell.user.click(allow);
    await act(settle);
    expect(shell.aiAccess.projects[0]?.allowWrite).toBe(true);
    expect(
      (
        within(dialog).getByRole("checkbox", {
          name: JA.allowWriteLabel("Order Service"),
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    await shell.user.click(
      within(dialog).getByRole("button", {
        name: JA.removeLabel(JA.missingProject),
      }),
    );
    await act(settle);
    expect(shell.aiAccess.projects.map((project) => project.projectId)).toEqual(
      [ORDER],
    );
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
  });

  it("says when a change failed and shows the list as it is", async () => {
    const { shell, dialog } = await openDialog();
    shell.aiAccess.failNextChange = true;
    await shell.user.click(
      within(dialog).getByRole("checkbox", {
        name: JA.allowWriteLabel("Order Service"),
      }),
    );
    await act(settle);
    expect(within(dialog).getByText(JA.changeFailed)).toBeTruthy();
    expect(shell.aiAccess.projects[0]?.allowWrite).toBe(false);
  });

  it("warns when the MCP server is missing and closes with Escape", async () => {
    const shell = await renderShell({
      systemLanguages: ["ja"],
      seed: (harness) => {
        harness.aiAccess.serverFound = false;
      },
    });
    await chooseMenuItem(shell.user, TOP_BAR.fileMenu, JA.menuItem);
    await act(settle);
    const dialog = screen.getByRole("dialog", { name: JA.title });
    expect(within(dialog).getByText(JA.serverMissing)).toBeTruthy();
    expect(within(dialog).getByText(JA.projectsEmpty)).toBeTruthy();
    await shell.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds the Project open in this window, read-only, and then says it is added", async () => {
    const shell = await renderShell({
      systemLanguages: ["ja"],
      seed: (harness) => {
        harness.aiAccess.openProject = {
          projectId: ORDER,
          name: "Order Service",
          folderDisplay: "/work/order-service",
          allowWrite: false,
          current: true,
        };
      },
    });
    await chooseMenuItem(shell.user, TOP_BAR.fileMenu, JA.menuItem);
    await act(settle);
    const dialog = screen.getByRole("dialog", { name: JA.title });
    expect(within(dialog).getByText(JA.projectsEmpty)).toBeTruthy();
    await shell.user.click(
      within(dialog).getByRole("button", { name: JA.addOpenProject }),
    );
    await act(settle);
    expect(shell.aiAccess.projects.map((project) => project.projectId)).toEqual(
      [ORDER],
    );
    expect(
      (
        within(dialog).getByRole("checkbox", {
          name: JA.allowWriteLabel("Order Service"),
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        within(dialog).getByRole("button", {
          name: JA.addOpenProject,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(within(dialog).getByText(JA.openProjectListed)).toBeTruthy();
  });

  it("adds a Project from a folder, and does nothing when the dialog is cancelled", async () => {
    const { shell, dialog } = await openDialog();
    expect(within(dialog).getByText(JA.noOpenProject)).toBeTruthy();
    await shell.user.click(
      within(dialog).getByRole("button", { name: JA.addProjectFolder }),
    );
    await act(settle);
    expect(shell.aiAccess.projects).toHaveLength(2);

    shell.aiAccess.nextFolderProject = {
      projectId: "01928f3a-0000-7000-8000-000000000003" as ProjectId,
      name: "Docs",
      folderDisplay: "/work/docs",
      allowWrite: true,
      current: false,
    };
    await shell.user.click(
      within(dialog).getByRole("button", { name: JA.addProjectFolder }),
    );
    await act(settle);
    expect(shell.aiAccess.projects[0]?.name).toBe("Docs");
    expect(shell.aiAccess.projects[0]?.allowWrite).toBe(false);
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);

    shell.aiAccess.failNextChange = true;
    await shell.user.click(
      within(dialog).getByRole("button", { name: JA.addProjectFolder }),
    );
    await act(settle);
    expect(within(dialog).getByText(JA.addFailed)).toBeTruthy();
  });
});
