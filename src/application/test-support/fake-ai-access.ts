// An in-memory AI access list: the same rules as Rust (a change to an unlisted Project
// fails), plus switches to make the next call fail.

import type {
  AiAccessGateway,
  AiAccessOverview,
  AiProjectAccess,
} from "../ports/ai-access-gateway";
import { operationErr, operationOk } from "../ports/operation-error";

export const FAKE_MCP_SERVER_PATH = "/opt/design-dawn/design-dawn-mcp";

export interface FakeAiAccessGateway extends AiAccessGateway {
  projects: AiProjectAccess[];
  // The Project the window has open (null: none).
  openProject: AiProjectAccess | null;
  // What the folder dialog gives next: a Project, or null for a cancel.
  nextFolderProject: AiProjectAccess | null;
  serverFound: boolean;
  failNextOverview: boolean;
  failNextChange: boolean;
}

export function createFakeAiAccessGateway(
  projects: AiProjectAccess[] = [],
): FakeAiAccessGateway {
  const gateway: FakeAiAccessGateway = {
    projects,
    openProject: null,
    nextFolderProject: null,
    serverFound: true,
    failNextOverview: false,
    failNextChange: false,
    overview() {
      if (gateway.failNextOverview) {
        gateway.failNextOverview = false;
        return Promise.resolve(
          operationErr("ioError", "fake overview failure"),
        );
      }
      const overview: AiAccessOverview = {
        mcpServer: {
          displayPath: FAKE_MCP_SERVER_PATH,
          found: gateway.serverFound,
        },
        projects: gateway.projects.map((project) => ({ ...project })),
        openProject:
          gateway.openProject === null
            ? null
            : {
                projectId: gateway.openProject.projectId,
                listed: isListed(gateway.openProject),
              },
        loadIssue: null,
      };
      return Promise.resolve(operationOk(overview));
    },
    addOpenProject() {
      const failed = takeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (gateway.openProject === null) {
        return Promise.resolve(operationErr("projectNotOpen", "no Project"));
      }
      add(gateway.openProject);
      return Promise.resolve(operationOk(undefined));
    },
    addProjectFolder() {
      const failed = takeFailure();
      if (failed !== null) return Promise.resolve(failed);
      const project = gateway.nextFolderProject;
      gateway.nextFolderProject = null;
      if (project === null) return Promise.resolve(operationOk("cancelled"));
      add(project);
      return Promise.resolve(operationOk("added"));
    },
    setWriteAccess(projectId, allowWrite) {
      const failed = takeFailure();
      if (failed !== null) return Promise.resolve(failed);
      const project = gateway.projects.find(
        (candidate) => candidate.projectId === projectId,
      );
      if (project === undefined) return Promise.resolve(notListed());
      gateway.projects = gateway.projects.map((candidate) =>
        candidate === project ? { ...candidate, allowWrite } : candidate,
      );
      return Promise.resolve(operationOk(undefined));
    },
    remove(projectId) {
      const failed = takeFailure();
      if (failed !== null) return Promise.resolve(failed);
      if (
        !gateway.projects.some((project) => project.projectId === projectId)
      ) {
        return Promise.resolve(notListed());
      }
      gateway.projects = gateway.projects.filter(
        (project) => project.projectId !== projectId,
      );
      return Promise.resolve(operationOk(undefined));
    },
  };
  function isListed(project: AiProjectAccess): boolean {
    return gateway.projects.some(
      (listed) => listed.projectId === project.projectId,
    );
  }
  // Read-only, at the top; a Project already listed stays as it is.
  function add(project: AiProjectAccess): void {
    if (isListed(project)) return;
    gateway.projects = [{ ...project, allowWrite: false }, ...gateway.projects];
  }
  function takeFailure() {
    if (!gateway.failNextChange) return null;
    gateway.failNextChange = false;
    return operationErr("ioError", "fake change failure");
  }
  function notListed() {
    return operationErr("entityNotFound", "not listed");
  }
  return gateway;
}
