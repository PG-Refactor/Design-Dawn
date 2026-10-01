import type { BlockId } from "../domain/shared/entity-id";
import { generateBlockId } from "./entity-id-generator";

// Injectable so tests get deterministic ids. Extend with more entity kinds as operations
// that create them move into the application layer.
export interface IdGenerator {
  blockId(): BlockId;
}

export function createDefaultIdGenerator(): IdGenerator {
  return { blockId: generateBlockId };
}
