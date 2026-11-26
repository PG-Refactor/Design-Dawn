import { describe, expect, it } from "vitest";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { CloseRequestSource } from "../../application/ports/window-close";
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
    needsConfirmation?: boolean | (() => boolean);
    // Steps still under way when the close request comes (`settle` ends them).
    holdSettled?: boolean;
    // Resolves the question; "hold" leaves it open until `answer` is called.
    choice?: UnsavedCloseChoice | "hold";
    scope?: CloseRequestSource["scope"];
  } = {},
) {
  const source = createFakeCloseRequestSource();
  const calls: string[] = [];
  let releaseSave: () => void = () => undefined;
  let saveResult = options.saveResult ?? operationOk(undefined);
  let answer: (choice: UnsavedCloseChoice) => void = () => undefined;
  let settle: () => void = () => undefined;
  const settledSteps =
    options.holdSettled === true
      ? new Promise<void>((resolve) => {
          settle = resolve;
        })
      : Promise.resolve();
  const handler = createWindowCloseHandler(() => ({
    settled: () => settledSteps,
    needsConfirmation: () =>
      typeof options.needsConfirmation === "function"
        ? options.needsConfirmation()
        : (options.needsConfirmation ?? false),
    afterRepaint: async () => {
      calls.push("repaint");
    },
    askUnsavedClose: (endsApp) => {
      calls.push(endsApp ? "ask" : "askWindow");
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
    finishViewportSaves: async () => {
      calls.push("flush");
      if (options.flushFails === true) throw new Error("viewport");
    },
    closeRequestSource: {
      ...source,
      confirmClose: (token) => {
        calls.push(`confirm:${token}`);
        return source.confirmClose(token);
      },
      bringForward: () => {
        calls.push("forward");
        return Promise.resolve();
      },
      closeDocumentWindows: (decision) => {
        calls.push(`closeDocuments:${decision}`);
        return source.closeDocumentWindows(decision);
      },
      scope: options.scope ?? source.scope,
    },
  }));
  return {
    handler,
    source,
    calls,
    releaseSave: () => releaseSave(),
    settle: () => settle(),
    answer: (choice: UnsavedCloseChoice) => answer(choice),
    setSaveResult: (result: OperationResult<void>) => {
      saveResult = result;
    },
  };
}

describe("closing a Project window with its Document windows", () => {
  const withDocumentWindows = (documentWindowsUnsaved: boolean) => async () =>
    operationOk({ endsApp: false, documentWindowsUnsaved });

  it("asks once for the Document windows' unsaved changes and closes them with the answer", async () => {
    const context = setup({
      choice: "discard",
      scope: withDocumentWindows(true),
    });
    await context.handler({ subscriptionToken: TOKEN, decided: null });
    expect(context.calls).toEqual([
      "forward",
      "askWindow",
      "repaint",
      "closeDocuments:discard",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("saves itself before the Document windows are told, and keeps them open when that fails", async () => {
    const context = setup({
      choice: "save",
      scope: withDocumentWindows(true),
      saveResult: operationErr("ioError", "disk"),
    });
    await context.handler({ subscriptionToken: TOKEN, decided: null });
    expect(context.calls).toEqual([
      "forward",
      "askWindow",
      "repaint",
      "saveAll",
    ]);
    expect(context.handler.isClosing()).toBe(false);
  });

  it("asks about its own changes only when the scope cannot be read", async () => {
    const context = setup({
      needsConfirmation: true,
      choice: "save",
      scope: async () => operationErr("ioError", "x"),
    });
    await context.handler({ subscriptionToken: TOKEN, decided: null });
    expect(context.calls).toEqual([
      "forward",
      "askWindow",
      "repaint",
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });
});

describe("a window closing along with its Project window", () => {
  it("asks nothing and saves when the answer was to save", async () => {
    const context = setup({ needsConfirmation: true });
    await context.handler({ subscriptionToken: TOKEN, decided: "save" });
    expect(context.calls).toEqual(["saveAll", "flush", `confirm:${TOKEN}`]);
  });

  it("closes without saving when the answer was not to save", async () => {
    const context = setup({ needsConfirmation: true });
    await context.handler({ subscriptionToken: TOKEN, decided: "discard" });
    expect(context.calls).toEqual(["flush", `confirm:${TOKEN}`]);
  });

  it("stays open when its save fails", async () => {
    const context = setup({ saveResult: operationErr("ioError", "disk") });
    await context.handler({ subscriptionToken: TOKEN, decided: "save" });
    expect(context.calls).toEqual(["saveAll"]);
    expect(context.handler.isClosing()).toBe(false);
  });
});

describe("window close handler", () => {
  it("decides only after the steps under way are done", async () => {
    let unsaved = true;
    const context = setup({
      holdSettled: true,
      choice: "save",
      needsConfirmation: () => unsaved,
    });
    const closing = context.handler({
      subscriptionToken: TOKEN,
      decided: null,
    });
    // The last Document leaves the window meanwhile.
    unsaved = false;
    context.settle();
    await closing;
    expect(context.calls).toEqual([
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("saves, flushes the viewport, then confirms with the token, in that order", async () => {
    const { handler, calls } = setup();
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual([
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("does not confirm after a failed save and accepts a later request", async () => {
    const { handler, calls, source, setSaveResult } = setup({
      saveResult: operationErr("ioError", "disk"),
    });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual(["saveAll"]);
    expect(source.confirmedTokens).toEqual([]);

    setSaveResult(operationOk(undefined));
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual([
      "saveAll",
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("still confirms when the viewport flush rejects", async () => {
    const { handler, calls } = setup({ flushFails: true });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual([
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("ignores a request that arrives while one is being processed", async () => {
    const { handler, calls, releaseSave } = setup({ holdSave: true });
    const first = handler({ subscriptionToken: TOKEN, decided: null });
    await settle();
    await handler({ subscriptionToken: TOKEN, decided: null });
    releaseSave();
    await first;
    expect(calls).toEqual([
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("accepts a new request after a failed confirmation", async () => {
    const { handler, calls, source } = setup();
    source.setConfirmResult(operationErr("ioError", "x"));
    await handler({ subscriptionToken: TOKEN, decided: null });
    source.setConfirmResult(operationOk(undefined));
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls.filter((call) => call === "saveAll")).toHaveLength(2);
  });

  it("does not ask when nothing needs confirmation", async () => {
    const { handler, calls } = setup({ choice: "discard" });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).not.toContain("ask");
  });

  // "forward": the window comes to the front before the question (a close from the
  // taskbar of a window behind others).
  it("asks first and saves like the normal path on 保存", async () => {
    const { handler, calls } = setup({
      needsConfirmation: true,
      choice: "save",
    });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual([
      "forward",
      "ask",
      "repaint",
      "saveAll",
      "closeDocuments:save",
      "flush",
      `confirm:${TOKEN}`,
    ]);
  });

  it("keeps the window open when 保存 fails to save", async () => {
    const { handler, calls, source } = setup({
      needsConfirmation: true,
      choice: "save",
      saveResult: operationErr("ioError", "disk"),
    });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual(["forward", "ask", "repaint", "saveAll"]);
    expect(source.confirmedTokens).toEqual([]);
  });

  it("confirms without saving on 保存せずに閉じる", async () => {
    const { handler, calls } = setup({
      needsConfirmation: true,
      choice: "discard",
    });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).not.toContain("saveAll");
    expect(calls).toContain(`confirm:${TOKEN}`);
  });

  it("does nothing on キャンセル and asks again on a later request", async () => {
    const { handler, calls, source } = setup({
      needsConfirmation: true,
      choice: "cancel",
    });
    await handler({ subscriptionToken: TOKEN, decided: null });
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual(["forward", "ask", "forward", "ask"]);
    expect(source.confirmedTokens).toEqual([]);
  });

  it("ignores a request while the question is open", async () => {
    const { handler, calls, answer } = setup({
      needsConfirmation: true,
      choice: "hold",
    });
    const first = handler({ subscriptionToken: TOKEN, decided: null });
    await settle();
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual(["forward", "ask"]);
    answer("discard");
    await first;
    expect(calls).toEqual([
      "forward",
      "ask",
      "repaint",
      "closeDocuments:discard",
      "flush",
      `confirm:${TOKEN}`,
    ]);
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

    const pending = handler({ subscriptionToken: TOKEN, decided: null });
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
    await failing.handler({ subscriptionToken: TOKEN, decided: null });
    expect(released).toBe(1);

    const succeeding = setup();
    succeeding.handler.onReleased(() => {
      released += 1;
    });
    await succeeding.handler({ subscriptionToken: TOKEN, decided: null });
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
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(released).toBe(0);
  });
});

describe("a window that edits a Custom Template", () => {
  function editing(unsaved: boolean, answer: "save" | "discard" | "cancel") {
    const source = createFakeCloseRequestSource();
    const calls: string[] = [];
    const handler = createWindowCloseHandler(() => ({
      settled: async () => undefined,
      needsConfirmation: () => true,
      askUnsavedClose: async () => {
        calls.push("askDocument");
        return "save";
      },
      saveAll: async () => {
        calls.push("saveAll");
        return operationOk(undefined);
      },
      finishViewportSaves: async () => undefined,
      closeRequestSource: {
        ...source,
        confirmClose: (token) => {
          calls.push(`confirm:${token}`);
          return source.confirmClose(token);
        },
        bringForward: () => {
          calls.push("forward");
          return Promise.resolve();
        },
      },
      templateEdit: {
        isEditing: () => true,
        hasUnsavedChanges: async () => unsaved,
        ask: async () => {
          calls.push("askTemplate");
          return answer;
        },
        save: async () => {
          calls.push("saveTemplate");
          return operationOk(undefined);
        },
      },
    }));
    return { handler, calls };
  }

  it("asks about the template only, saves it on Save and closes", async () => {
    const { handler, calls } = editing(true, "save");
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual([
      "forward",
      "askTemplate",
      "saveTemplate",
      `confirm:${TOKEN}`,
    ]);
  });

  it("closes without writing on Close Without Saving, and stays open on Cancel", async () => {
    const discard = editing(true, "discard");
    await discard.handler({ subscriptionToken: TOKEN, decided: null });
    expect(discard.calls).toEqual([
      "forward",
      "askTemplate",
      `confirm:${TOKEN}`,
    ]);
    const cancel = editing(true, "cancel");
    await cancel.handler({ subscriptionToken: TOKEN, decided: null });
    expect(cancel.calls).toEqual(["forward", "askTemplate"]);
    expect(cancel.handler.isClosing()).toBe(false);
  });

  it("closes at once when the template is saved", async () => {
    const { handler, calls } = editing(false, "cancel");
    await handler({ subscriptionToken: TOKEN, decided: null });
    expect(calls).toEqual([`confirm:${TOKEN}`]);
  });
});

describe("window close while printing", () => {
  function printingSetup(stop: boolean) {
    const source = createFakeCloseRequestSource();
    const calls: string[] = [];
    const handler = createWindowCloseHandler(() => ({
      settled: async () => undefined,
      needsConfirmation: () => false,
      askUnsavedClose: () => Promise.resolve("cancel" as UnsavedCloseChoice),
      saveAll: async () => {
        calls.push("saveAll");
        return operationOk(undefined);
      },
      finishViewportSaves: async () => undefined,
      printing: {
        isOpen: async () => true,
        confirmStop: async () => {
          calls.push("askStop");
          return stop;
        },
        closeAll: async () => {
          calls.push("closePrint");
        },
        setHidden: async (hidden) => {
          calls.push(hidden ? "hidePrint" : "showPrint");
        },
      },
      closeRequestSource: {
        ...source,
        confirmClose: (token) => {
          calls.push(`confirm:${token}`);
          return source.confirmClose(token);
        },
        bringForward: () => {
          calls.push("forward");
          return Promise.resolve();
        },
      },
    }));
    return { handler, calls };
  }

  it("puts the print window out of the way of the question", async () => {
    const { handler, calls } = printingSetup(true);
    await handler({ subscriptionToken: TOKEN, decided: null });
    await settle();
    expect(calls.slice(0, 4)).toEqual([
      "forward",
      "hidePrint",
      "askStop",
      "closePrint",
    ]);
    expect(calls).toContain(`confirm:${TOKEN}`);
  });

  it("brings the print window back when printing goes on", async () => {
    const { handler, calls } = printingSetup(false);
    await handler({ subscriptionToken: TOKEN, decided: null });
    await settle();
    expect(calls).toEqual(["forward", "hidePrint", "askStop", "showPrint"]);
    expect(handler.isClosing()).toBe(false);
  });
});
