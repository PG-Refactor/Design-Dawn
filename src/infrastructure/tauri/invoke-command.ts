// The only place that calls `invoke`. Expected failures come back as `{ ok: false, error }`;
// nothing here throws for them.

import { invoke } from "@tauri-apps/api/core";
import type { CommandName } from "./command-constants";
import {
  type CommandResult,
  commandErr,
  toCommandError,
} from "./command-error";

export type CommandArguments = Readonly<Record<string, unknown>>;

// A command whose argument is raw bytes (a pasted image): JSON would turn them into an
// array of numbers several times their size. Everything else travels as headers.
export async function callWithBytes<T>(
  command: CommandName,
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  convert: (payload: unknown) => CommandResult<T>,
): Promise<CommandResult<T>> {
  let payload: unknown;
  try {
    payload = await invoke<unknown>(command, bytes, {
      headers: { ...headers },
    });
  } catch (rejection) {
    const error = toCommandError(rejection);
    return commandErr(error.kind, error.detail);
  }
  return convert(payload);
}

export async function call<T>(
  command: CommandName,
  args: CommandArguments,
  convert: (payload: unknown) => CommandResult<T>,
): Promise<CommandResult<T>> {
  let payload: unknown;
  try {
    payload = await invoke<unknown>(command, { ...args });
  } catch (rejection) {
    const error = toCommandError(rejection);
    return commandErr(error.kind, error.detail);
  }
  return convert(payload);
}
