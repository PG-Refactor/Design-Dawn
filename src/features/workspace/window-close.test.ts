import { describe, expect, it } from "vitest";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { createFakeCloseRequestSource } from "../../application/test-support/fake-close";
import { settle } from "../../application/test-support/fakes";
import { createWindowCloseHandler } from "./window-close";

const TOKEN = "token-1";

function setup(
  options: {
    saveResult?: OperationResult<void>;
    flushFails?: boolean;
    holdSave?: boolean;
  } = {},
) {
  const source = createFakeCloseRequestSource();
  const calls: string[] = [];
  let releaseSave: () => void = () => undefined;
  let saveResult = options.saveResult ?? operationOk(undefined);
  const handler = createWindowCloseHandler(() => ({
    saveAll: async () => {
      calls.push("saveAll");
      if (options.holdSave === true) {
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
      }
      return saveResult;
    },
    flushViewport: async () => {
      calls.push("flush");
      if (options.flushFails === true) throw new Error("viewport");
    },
    closeRequestSource: {
      subscribe: source.subscribe,
      confirmClose: (token) => {
        calls.push(`confirm:${token}`);
        return source.confirmClose(token);
      },
    },
  }));
  return {
    handler,
    source,
    calls,
    releaseSave: () => releaseSave(),
    setSaveResult: (result: OperationResult<void>) => {
      saveResult = result;
    },
  };
}

describe("window close handler", () => {
  it("saves, flushes the viewport, then confirms with the token, in that order", async () => {
    const { handler, calls } = setup();
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["saveAll", "flush", `confirm:${TOKEN}`]);
  });

  it("does not confirm after a failed save and accepts a later request", async () => {
    const { handler, calls, source, setSaveResult } = setup({
      saveResult: operationErr("ioError", "disk"),
    });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["saveAll"]);
    expect(source.confirmedTokens).toEqual([]);

    setSaveResult(operationOk(undefined));
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["saveAll", "saveAll", "flush", `confirm:${TOKEN}`]);
  });

  it("still confirms when the viewport flush rejects", async () => {
    const { handler, calls } = setup({ flushFails: true });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["saveAll", "flush", `confirm:${TOKEN}`]);
  });

  it("ignores a request that arrives while one is being processed", async () => {
    const { handler, calls, releaseSave } = setup({ holdSave: true });
    const first = handler({ subscriptionToken: TOKEN });
    await settle();
    await handler({ subscriptionToken: TOKEN });
    releaseSave();
    await first;
    expect(calls).toEqual(["saveAll", "flush", `confirm:${TOKEN}`]);
  });

  it("accepts a new request after a failed confirmation", async () => {
    const { handler, calls, source } = setup();
    source.setConfirmResult(operationErr("ioError", "x"));
    await handler({ subscriptionToken: TOKEN });
    source.setConfirmResult(operationOk(undefined));
    await handler({ subscriptionToken: TOKEN });
    expect(calls.filter((call) => call === "saveAll")).toHaveLength(2);
  });
});
