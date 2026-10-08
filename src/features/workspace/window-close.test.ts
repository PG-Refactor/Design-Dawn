import { describe, expect, it } from "vitest";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { createFakeCloseRequestSource } from "../../application/test-support/fake-close";
import { settle } from "../../application/test-support/fakes";
import { createWindowCloseHandler } from "./window-close";
import type { UnsavedCloseChoice } from "./workspace-actions";

const TOKEN = "token-1";

function setup(
  options: {
    saveResult?: OperationResult<void>;
    flushFails?: boolean;
    holdSave?: boolean;
    needsConfirmation?: boolean;
    // Resolves the question; "hold" leaves it open until `answer` is called.
    choice?: UnsavedCloseChoice | "hold";
  } = {},
) {
  const source = createFakeCloseRequestSource();
  const calls: string[] = [];
  let releaseSave: () => void = () => undefined;
  let saveResult = options.saveResult ?? operationOk(undefined);
  let answer: (choice: UnsavedCloseChoice) => void = () => undefined;
  const handler = createWindowCloseHandler(() => ({
    needsConfirmation: () => options.needsConfirmation ?? false,
    askUnsavedClose: () => {
      calls.push("ask");
      if (options.choice === "hold" || options.choice === undefined) {
        return new Promise<UnsavedCloseChoice>((resolve) => {
          answer = resolve;
        });
      }
      return Promise.resolve(options.choice);
    },
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
    answer: (choice: UnsavedCloseChoice) => answer(choice),
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

  it("does not ask when nothing needs confirmation", async () => {
    const { handler, calls } = setup({ choice: "discard" });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).not.toContain("ask");
  });

  it("asks first and saves like the normal path on 保存", async () => {
    const { handler, calls } = setup({
      needsConfirmation: true,
      choice: "save",
    });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["ask", "saveAll", "flush", `confirm:${TOKEN}`]);
  });

  it("keeps the window open when 保存 fails to save", async () => {
    const { handler, calls, source } = setup({
      needsConfirmation: true,
      choice: "save",
      saveResult: operationErr("ioError", "disk"),
    });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["ask", "saveAll"]);
    expect(source.confirmedTokens).toEqual([]);
  });

  it("confirms without saving on 保存せずに閉じる", async () => {
    const { handler, calls } = setup({
      needsConfirmation: true,
      choice: "discard",
    });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).not.toContain("saveAll");
    expect(calls).toContain(`confirm:${TOKEN}`);
  });

  it("does nothing on キャンセル and asks again on a later request", async () => {
    const { handler, calls, source } = setup({
      needsConfirmation: true,
      choice: "cancel",
    });
    await handler({ subscriptionToken: TOKEN });
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["ask", "ask"]);
    expect(source.confirmedTokens).toEqual([]);
  });

  it("ignores a request while the question is open", async () => {
    const { handler, calls, answer } = setup({
      needsConfirmation: true,
      choice: "hold",
    });
    const first = handler({ subscriptionToken: TOKEN });
    await settle();
    await handler({ subscriptionToken: TOKEN });
    expect(calls).toEqual(["ask"]);
    answer("discard");
    await first;
    expect(calls).toEqual(["ask", "flush", `confirm:${TOKEN}`]);
  });
});

describe("close status", () => {
  it("is closing while a request is processed and tells listeners when it stops", async () => {
    const { handler, answer } = setup({
      needsConfirmation: true,
      choice: "hold",
    });
    let released = 0;
    handler.onReleased(() => {
      released += 1;
    });
    expect(handler.isClosing()).toBe(false);

    const pending = handler({ subscriptionToken: TOKEN });
    await settle();
    expect(handler.isClosing()).toBe(true);
    expect(released).toBe(0);

    answer("cancel");
    await pending;
    expect(handler.isClosing()).toBe(false);
    expect(released).toBe(1);
  });

  it("is released when saving fails, and not when the close is confirmed", async () => {
    const failing = setup({ saveResult: operationErr("ioError", "x") });
    let released = 0;
    failing.handler.onReleased(() => {
      released += 1;
    });
    await failing.handler({ subscriptionToken: TOKEN });
    expect(released).toBe(1);

    const succeeding = setup();
    succeeding.handler.onReleased(() => {
      released += 1;
    });
    await succeeding.handler({ subscriptionToken: TOKEN });
    // The window is about to be destroyed: it stays "closing" and nothing resumes.
    expect(succeeding.handler.isClosing()).toBe(true);
    expect(released).toBe(1);
  });

  it("stops notifying an unsubscribed listener", async () => {
    const { handler } = setup({ saveResult: operationErr("ioError", "x") });
    let released = 0;
    const stop = handler.onReleased(() => {
      released += 1;
    });
    stop();
    await handler({ subscriptionToken: TOKEN });
    expect(released).toBe(0);
  });
});
