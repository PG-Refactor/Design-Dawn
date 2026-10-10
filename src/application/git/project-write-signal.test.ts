import { describe, expect, it } from "vitest";
import { operationErr, operationOk } from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import {
  createProjectWriteSignal,
  GATEWAY_METHOD_KINDS,
  withWriteSignal,
} from "./project-write-signal";

type Answer = () => Promise<unknown>;

// Every gateway method answers with `answer`; the test decides which one is called.
function stubGateway(answer: Answer): PersistenceGateway {
  const stub: Record<string, Answer> = {};
  for (const name of Object.keys(GATEWAY_METHOD_KINDS)) stub[name] = answer;
  return stub as unknown as PersistenceGateway;
}

function setup(answer: Answer) {
  const signal = createProjectWriteSignal();
  const events: string[] = [];
  signal.subscribe(() => events.push("notified"));
  const gateway = withWriteSignal(
    stubGateway(async () => {
      events.push("called");
      return answer();
    }),
    signal,
  );
  return { gateway, events };
}

describe("withWriteSignal", () => {
  it("notifies after a write resolved and passes the value through", async () => {
    const { gateway, events } = setup(async () => operationOk("saved"));

    const result = await gateway.writeBlockContent(
      ...([] as unknown as Parameters<typeof gateway.writeBlockContent>),
    );

    expect(result).toEqual({ ok: true, value: "saved" });
    expect(events).toEqual(["called", "notified"]);
  });

  it("notifies after a failed result too", async () => {
    const { gateway, events } = setup(async () =>
      operationErr("ioError", "disk"),
    );

    const result = await gateway.saveDocument(
      ...([] as unknown as Parameters<typeof gateway.saveDocument>),
    );

    expect(result.ok).toBe(false);
    expect(events).toEqual(["called", "notified"]);
  });

  it("notifies after a rejection and rethrows it", async () => {
    const failure = new Error("boom");
    const { gateway, events } = setup(() => Promise.reject(failure));

    await expect(
      gateway.createDocument(
        ...([] as unknown as Parameters<typeof gateway.createDocument>),
      ),
    ).rejects.toBe(failure);

    expect(events).toEqual(["called", "notified"]);
  });

  it("does not notify for a read", async () => {
    const { gateway, events } = setup(async () => operationOk(null));

    await gateway.readBlockContent(
      ...([] as unknown as Parameters<typeof gateway.readBlockContent>),
    );
    await gateway.openProject("selection");

    expect(events).toEqual(["called", "called"]);
  });

  it("notifies for every write method and no read method", async () => {
    for (const [name, kind] of Object.entries(GATEWAY_METHOD_KINDS)) {
      const { gateway, events } = setup(async () => operationOk(null));
      const method = (gateway as unknown as Record<string, Answer>)[name];

      await method?.();

      expect(events.includes("notified"), name).toBe(kind === "write");
    }
  });
});

describe("createProjectWriteSignal", () => {
  it("keeps notifying when a listener fails, and reports the failure", () => {
    const reported: unknown[] = [];
    const signal = createProjectWriteSignal((failure) =>
      reported.push(failure),
    );
    const failure = new Error("faulty");
    let reached = false;
    signal.subscribe(() => {
      throw failure;
    });
    signal.subscribe(() => {
      reached = true;
    });

    signal.notify();

    expect(reached).toBe(true);
    expect(reported).toEqual([failure]);
  });

  it("stops notifying after unsubscribe", () => {
    const signal = createProjectWriteSignal();
    let count = 0;
    const unsubscribe = signal.subscribe(() => {
      count += 1;
    });
    signal.notify();
    unsubscribe();
    signal.notify();

    expect(count).toBe(1);
  });
});
