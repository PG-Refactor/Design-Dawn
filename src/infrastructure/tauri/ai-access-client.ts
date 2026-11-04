// The AI integration commands: typed wrappers, the payload check and the gateway.

import type {
  AiAccessGateway,
  AiAccessOverview,
  AiProjectAccess,
} from "../../application/ports/ai-access-gateway";
import { parseProjectId } from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import {
  type CommandResult,
  commandErr,
  commandOk,
  isRustErrorKind,
} from "./command-error";
import { call } from "./invoke-command";
import type { LocalStateLoadIssue } from "./local-state-types";
import {
  arrayOf,
  type Decoder,
  decodeBoolean,
  decodeString,
  nullable,
  objectOf,
} from "./payload-decoder";
import { selectProjectFolder } from "./persistence-client";
import { toVoidResult } from "./persistence-payloads";

const PAYLOAD_ROOT = "payload";

const decodeErrorKind: Decoder<LocalStateLoadIssue["kind"]> = (value, path) =>
  typeof value === "string" && isRustErrorKind(value)
    ? { ok: true, value }
    : { ok: false, detail: `${path}: expected a Rust error kind` };

const decodeProjectId: Decoder<AiProjectAccess["projectId"]> = (
  value,
  path,
) => {
  if (typeof value !== "string") {
    return { ok: false, detail: `${path}: expected a string` };
  }
  const parsed = parseProjectId(value);
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : { ok: false, detail: `${path}: expected a Project id` };
};

const decodeOverview = objectOf<AiAccessOverview>({
  openProject: nullable(
    objectOf<NonNullable<AiAccessOverview["openProject"]>>({
      projectId: decodeProjectId,
      listed: decodeBoolean,
    }),
  ),
  mcpServer: objectOf<AiAccessOverview["mcpServer"]>({
    displayPath: decodeString,
    found: decodeBoolean,
  }),
  projects: arrayOf(
    objectOf<AiProjectAccess>({
      projectId: decodeProjectId,
      name: nullable(decodeString),
      folderDisplay: decodeString,
      allowWrite: decodeBoolean,
      current: decodeBoolean,
    }),
  ),
  loadIssue: nullable(
    objectOf<LocalStateLoadIssue>({
      kind: decodeErrorKind,
      detail: decodeString,
    }),
  ),
});

export function toAiAccessOverviewResult(
  payload: unknown,
): CommandResult<AiAccessOverview> {
  const decoded = decodeOverview(payload, PAYLOAD_ROOT);
  return decoded.ok
    ? commandOk(decoded.value)
    : commandErr("invalidCommandResponse", decoded.detail);
}

const discard = (): undefined => undefined;

export function createTauriAiAccessGateway(): AiAccessGateway {
  return {
    overview: () =>
      call(COMMANDS.aiAccessOverview, {}, toAiAccessOverviewResult),
    addOpenProject: async () => {
      const result = await call(COMMANDS.addOpenProjectToAi, {}, toVoidResult);
      return result.ok ? commandOk(discard()) : result;
    },
    // The folder is chosen in Rust's dialog; only its selection id comes back here.
    addProjectFolder: async () => {
      const selection = await selectProjectFolder();
      if (!selection.ok) return selection;
      if (selection.value.status === "cancelled") return commandOk("cancelled");
      const added = await call(
        COMMANDS.addAiProjectFolder,
        { selectionId: selection.value.selectionId },
        toVoidResult,
      );
      return added.ok ? commandOk("added") : added;
    },
    setWriteAccess: async (projectId, allowWrite) => {
      const result = await call(
        COMMANDS.setAiWriteAccess,
        { projectId, allowWrite },
        toVoidResult,
      );
      return result.ok ? commandOk(discard()) : result;
    },
    answerRequest: async (projectId, answer) => {
      const result = await call(
        COMMANDS.answerAiAccessRequest,
        { projectId, answer },
        toVoidResult,
      );
      return result.ok ? commandOk(discard()) : result;
    },
    remove: async (projectId) => {
      const result = await call(
        COMMANDS.removeAiProject,
        { projectId },
        toVoidResult,
      );
      return result.ok ? commandOk(discard()) : result;
    },
  };
}
