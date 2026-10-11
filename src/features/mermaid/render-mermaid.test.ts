// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MERMAID_ERROR_MESSAGE_MAX_LENGTH } from "../../config/mermaid-preview-config";
import {
  createMermaidRenderer,
  type MermaidApi,
  type MermaidLoader,
} from "./render-mermaid";

afterEach(() => {
  document.body.replaceChildren();
});

interface FakeMermaid extends MermaidApi {
  readonly initialize: ReturnType<typeof vi.fn<MermaidApi["initialize"]>>;
  readonly render: ReturnType<typeof vi.fn<MermaidApi["render"]>>;
}

function fakeMermaid(
  render: MermaidApi["render"] = async (id) => ({ svg: `<svg id="${id}"/>` }),
): FakeMermaid {
  return {
    initialize: vi.fn<MermaidApi["initialize"]>(),
    render: vi.fn<MermaidApi["render"]>(render),
  };
}

const loaderOf =
  (mermaid: MermaidApi): MermaidLoader =>
  async () =>
    mermaid;

describe("the Mermaid renderer", () => {
  it("renders with a fresh id each time and returns the SVG untouched", async () => {
    const mermaid = fakeMermaid();
    const renderer = createMermaidRenderer(loaderOf(mermaid));

    const first = await renderer.render("a", {});
    const second = await renderer.render("b", {});

    const ids = mermaid.render.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(2);
    expect(first).toEqual({ ok: true, svg: `<svg id="${ids[0]}"/>` });
    expect(second.ok).toBe(true);
  });

  it("initialises with the fixed configuration, and again only when the theme values change", async () => {
    const mermaid = fakeMermaid();
    const renderer = createMermaidRenderer(loaderOf(mermaid));

    await renderer.render("a", { textColor: "one" });
    await renderer.render("b", { textColor: "one" });
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize.mock.calls[0]?.[0]).toMatchObject({
      securityLevel: "strict",
      htmlLabels: false,
      themeVariables: { textColor: "one" },
    });

    await renderer.render("c", { textColor: "two" });
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    await renderer.render("d", { textColor: "two" });
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
  });

  it("loads the library once, on first use", async () => {
    const load = vi.fn(loaderOf(fakeMermaid()));
    const renderer = createMermaidRenderer(load);
    expect(load).not.toHaveBeenCalled();
    await renderer.render("a", {});
    await renderer.render("b", {});
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries to load again after a failed load", async () => {
    const mermaid = fakeMermaid();
    const load = vi
      .fn<MermaidLoader>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockResolvedValue(mermaid);
    const renderer = createMermaidRenderer(load);

    expect(await renderer.render("a", {})).toEqual({
      ok: false,
      message: "chunk missing",
    });
    expect((await renderer.render("a", {})).ok).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("runs one render at a time, in call order", async () => {
    const releases: Array<() => void> = [];
    let running = 0;
    let highest = 0;
    const started: string[] = [];
    const mermaid = fakeMermaid(
      (_id, source) =>
        new Promise((resolve) => {
          running += 1;
          highest = Math.max(highest, running);
          started.push(source);
          releases.push(() => {
            running -= 1;
            resolve({ svg: source });
          });
        }),
    );
    const renderer = createMermaidRenderer(loaderOf(mermaid));

    const results = [
      renderer.render("one", {}),
      renderer.render("two", {}),
      renderer.render("three", {}),
    ];
    await vi.waitFor(() => expect(started).toEqual(["one"]));
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toEqual(["one", "two"]));
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toEqual(["one", "two", "three"]));
    releases.shift()?.();

    expect((await Promise.all(results)).map((result) => result.ok)).toEqual([
      true,
      true,
      true,
    ]);
    expect(highest).toBe(1);
  });

  it("turns a failure into a value, keeps the queue going and cleans up Mermaid's leftovers", async () => {
    const mermaid = fakeMermaid(async (id, source) => {
      if (source === "bad") {
        // What Mermaid leaves in the page when it fails on an unexpected path.
        const leftover = document.createElement("div");
        leftover.id = `d${id}`;
        document.body.append(leftover);
        throw new Error("Parse error on line 2");
      }
      return { svg: "<svg/>" };
    });
    const renderer = createMermaidRenderer(loaderOf(mermaid));

    const failed = await renderer.render("bad", {});
    const next = await renderer.render("good", {});

    expect(failed).toEqual({ ok: false, message: "Parse error on line 2" });
    expect(document.body.children).toHaveLength(0);
    expect(next.ok).toBe(true);
  });

  it("reports a thrown non-Error as text and truncates a long message", async () => {
    const long = "x".repeat(MERMAID_ERROR_MESSAGE_MAX_LENGTH + 50);
    const mermaid = fakeMermaid(async (_id, source) => {
      throw source === "string" ? "plain text" : new Error(long);
    });
    const renderer = createMermaidRenderer(loaderOf(mermaid));

    expect(await renderer.render("string", {})).toEqual({
      ok: false,
      message: "plain text",
    });
    const truncated = await renderer.render("long", {});
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) {
      expect(truncated.message.length).toBe(
        MERMAID_ERROR_MESSAGE_MAX_LENGTH + 1,
      );
      expect(truncated.message.endsWith("…")).toBe(true);
    }
  });

  it("does not remember a configuration that failed to apply", async () => {
    const mermaid = fakeMermaid();
    mermaid.initialize.mockImplementationOnce(() => {
      throw new Error("bad config");
    });
    const renderer = createMermaidRenderer(loaderOf(mermaid));

    expect((await renderer.render("a", {})).ok).toBe(false);
    expect((await renderer.render("a", {})).ok).toBe(true);
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
  });
});
