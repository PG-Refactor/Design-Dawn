import { describe, expect, it } from "vitest";
import { operationOk, settleOperation } from "./ports/operation-error";
import { createSerialQueue } from "./serial-queue";

describe("createSerialQueue", () => {
  it("runs tasks in order, and keeps running after one rejects", async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const failing = queue.run(async () => {
      order.push("first");
      throw new Error("boom");
    });
    const second = queue.run(async () => {
      order.push("second");
      return 2;
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("settleOperation", () => {
  it("passes a result through and turns a rejection into an error result", async () => {
    await expect(settleOperation(async () => operationOk(1))).resolves.toEqual(
      operationOk(1),
    );
    await expect(
      settleOperation(() => Promise.reject(new Error("broken"))),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "unexpectedCommandError", detail: "broken" },
    });
    await expect(
      settleOperation(() => Promise.reject("plain")),
    ).resolves.toMatchObject({ error: { detail: "plain" } });
  });
});
