import type { GitGateway } from "../../application/ports/git-gateway";
import { gitStage, gitStatus, gitUnstage } from "./git-client";

// `CommandResult` and `OperationResult` share one shape, so the client is the gateway.
export function createTauriGitGateway(): GitGateway {
  return { gitStatus, stage: gitStage, unstage: gitUnstage };
}
