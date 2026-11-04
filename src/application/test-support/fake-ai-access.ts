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
  serverFound: boolean;
  failNextOverview: boolean;
  failNextChange: boolean;
}

export function createFakeAiAccessGateway(
  projects: AiProjectAccess[] = [],
): FakeAiAccessGateway {
  const gateway: FakeAiAccessGateway = {
    projects,
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
        loadIssue: null,
      };
      return Promise.resolve(operationOk(overview));
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
