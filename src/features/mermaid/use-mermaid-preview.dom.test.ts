// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MERMAID_PREVIEW_DEBOUNCE_MS } from "../../config/mermaid-preview-config";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import {
  createDeferredRenderer,
  createFakeRenderer,
  fakeSvg,
  installObjectUrlFake,
  type ObjectUrlFake,
} from "./test-support/fake-mermaid-renderer";
import {
  type UseMermaidPreviewInput,
  useMermaidPreview,
} from "./use-mermaid-preview";

let urls: ObjectUrlFake;

beforeEach(() => {
  vi.useFakeTimers();
  urls = installObjectUrlFake();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  urls.restore();
  document.documentElement.removeAttribute("style");
});

const INITIAL: UseMermaidPreviewInput = {
  source: "flowchart TD\n  A --> B",
  debounceMs: 0,
  renderer: createFakeRenderer(),
  themeKey: "light",
};

function mount(overrides: Partial<UseMermaidPreviewInput> = {}) {
  return renderHook(
    (props: UseMermaidPreviewInput) => useMermaidPreview(props),
    {
      initialProps: { ...INITIAL, ...overrides },
    },
  );
}

const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));

describe("useMermaidPreview", () => {
  it("renders at once on the first run and exposes an object URL", async () => {
    const renderer = createFakeRenderer();
    const { result } = mount({
      renderer,
      debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
    });
    expect(result.current.status).toBe("rendering");
    await flush();
    expect(renderer.calls).toHaveLength(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.url).toBe(urls.created[0]);
  });

  it("waits for the debounce after the first draw, and only the last source is drawn", async () => {
    const renderer = createFakeRenderer();
    const { result, rerender } = mount({
      renderer,
      debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
    });
    await flush();
    renderer.calls.length = 0;

    rerender({
      ...INITIAL,
      renderer,
      debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
      source: "a",
    });
    await act(async () =>
      vi.advanceTimersByTimeAsync(MERMAID_PREVIEW_DEBOUNCE_MS - 1),
    );
    rerender({
      ...INITIAL,
      renderer,
      debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
      source: "ab",
    });
    await act(async () =>
      vi.advanceTimersByTimeAsync(MERMAID_PREVIEW_DEBOUNCE_MS - 1),
    );
    expect(renderer.calls).toHaveLength(0);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(renderer.calls.map((call) => call.source)).toEqual(["ab"]);
    expect(result.current.status).toBe("ready");
  });

  it("draws a source change at once when there is no debounce", async () => {
    const renderer = createFakeRenderer();
    const { rerender } = mount({ renderer });
    await flush();
    rerender({ ...INITIAL, renderer, source: "next" });
    await flush();
    expect(renderer.calls.map((call) => call.source)).toEqual([
      INITIAL.source,
      "next",
    ]);
  });

  it("revokes the previous URL when a newer diagram replaces it", async () => {
    const renderer = createFakeRenderer();
    const { result, rerender } = mount({ renderer });
    await flush();
    const first = result.current.url;
    rerender({ ...INITIAL, renderer, source: "next" });
    await flush();
    expect(result.current.url).not.toBe(first);
    expect(urls.revoked).toEqual([first]);
    expect(urls.live()).toEqual([result.current.url]);
  });

  it("drops a stale result without ever creating a URL for it", async () => {
    const renderer = createDeferredRenderer();
    const { result, rerender } = mount({ renderer });
    await flush();
    rerender({ ...INITIAL, renderer, source: "second" });
    await flush();
    expect(renderer.pending.map((call) => call.source)).toEqual([
      INITIAL.source,
      "second",
    ]);

    // The newer request answers first, then the older one.
    await act(async () =>
      renderer.pending[1]?.resolve({ ok: true, svg: fakeSvg("second") }),
    );
    await act(async () =>
      renderer.pending[0]?.resolve({ ok: true, svg: fakeSvg("first") }),
    );

    expect(urls.created).toHaveLength(1);
    expect(result.current.url).toBe(urls.created[0]);
    expect(result.current.status).toBe("ready");
  });

  it("does not apply a stale error over a newer diagram", async () => {
    const renderer = createDeferredRenderer();
    const { result, rerender } = mount({ renderer });
    await flush();
    rerender({ ...INITIAL, renderer, source: "second" });
    await flush();
    await act(async () =>
      renderer.pending[1]?.resolve({ ok: true, svg: fakeSvg("second") }),
    );
    await act(async () =>
      renderer.pending[0]?.resolve({ ok: false, message: "late" }),
    );
    expect(result.current.status).toBe("ready");
    expect(result.current.errorMessage).toBeNull();
  });

  it("keeps the last good diagram on error and shows the message", async () => {
    let fail = false;
    const renderer = createFakeRenderer((source) =>
      fail
        ? { ok: false, message: "Parse error" }
        : { ok: true, svg: fakeSvg(source) },
    );
    const { result, rerender } = mount({ renderer });
    await flush();
    const good = result.current.url;

    fail = true;
    rerender({ ...INITIAL, renderer, source: "broken" });
    await flush();

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Parse error");
    expect(result.current.url).toBe(good);
    expect(urls.revoked).toEqual([]);

    fail = false;
    rerender({ ...INITIAL, renderer, source: "fixed" });
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.errorMessage).toBeNull();
    expect(urls.revoked).toEqual([good]);
  });

  it("reports a failure when the SVG cannot be sanitised, and shows no image", async () => {
    const renderer = createFakeRenderer(() => ({
      ok: true,
      svg: "<p>not svg</p>",
    }));
    const { result } = mount({ renderer });
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.url).toBeNull();
    expect(urls.created).toEqual([]);
  });

  it("reports a failure when the renderer rejects despite its contract", async () => {
    const renderer: MermaidRenderer = {
      render: () => Promise.reject(new Error("broken renderer")),
    };
    const { result } = mount({ renderer });
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("broken renderer");
  });

  it("shows an empty source as empty without rendering, and drops the old image", async () => {
    const renderer = createFakeRenderer();
    const { result, rerender } = mount({ renderer });
    await flush();
    const first = result.current.url;
    renderer.calls.length = 0;

    rerender({ ...INITIAL, renderer, source: "  \n " });
    await flush();

    expect(result.current).toEqual({
      status: "empty",
      url: null,
      errorMessage: null,
    });
    expect(renderer.calls).toEqual([]);
    expect(urls.revoked).toEqual([first]);
  });

  it("starts empty for an empty source", async () => {
    const renderer = createFakeRenderer();
    const { result } = mount({ renderer, source: "" });
    await flush();
    expect(result.current.status).toBe("empty");
    expect(renderer.calls).toEqual([]);
  });

  it("revokes the URL on unmount and ignores a late result", async () => {
    const renderer = createFakeRenderer();
    const { result, unmount } = mount({ renderer });
    await flush();
    const url = result.current.url;
    unmount();
    expect(urls.revoked).toEqual([url]);

    const deferred = createDeferredRenderer();
    const late = mount({ renderer: deferred });
    await flush();
    late.unmount();
    await act(async () =>
      deferred.pending[0]?.resolve({ ok: true, svg: fakeSvg("late") }),
    );
    expect(urls.created).toHaveLength(1);
  });

  it("draws again at once when the theme changes, with the theme values resolved then", async () => {
    const renderer = createFakeRenderer();
    const { rerender } = mount({
      renderer,
      debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
    });
    await flush();
    expect(renderer.calls).toHaveLength(1);

    document.documentElement.style.setProperty("--color-text", "resolved-text");
    rerender({
      ...INITIAL,
      renderer,
      debounceMs: MERMAID_PREVIEW_DEBOUNCE_MS,
      themeKey: "dark",
    });
    await flush();

    expect(renderer.calls).toHaveLength(2);
    expect(renderer.calls[1]?.theme.textColor).toBe("resolved-text");
    expect(renderer.calls[1]?.theme.primaryTextColor).toBe("resolved-text");
  });
});
