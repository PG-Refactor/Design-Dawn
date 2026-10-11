// Test doubles for the Mermaid renderer and for object URLs, which jsdom does not have.
// Not imported by production code.

import type {
  MermaidRenderer,
  MermaidThemeValues,
  RenderOutcome,
} from "../mermaid-renderer-types";

export function fakeSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="1" y="1">${label}</text></svg>`;
}

export interface RenderCall {
  readonly source: string;
  readonly theme: MermaidThemeValues;
}

export interface FakeMermaidRenderer extends MermaidRenderer {
  readonly calls: RenderCall[];
}

// Answers at once; the default answer is a small SVG labelled with the source.
export function createFakeRenderer(
  respond: (source: string) => RenderOutcome = (source) => ({
    ok: true,
    svg: fakeSvg(source.replace(/[<>&]/g, "_")),
  }),
): FakeMermaidRenderer {
  const calls: RenderCall[] = [];
  return {
    calls,
    async render(source, theme) {
      calls.push({ source, theme });
      return respond(source);
    },
  };
}

export interface PendingRender extends RenderCall {
  resolve(outcome: RenderOutcome): void;
}

export interface DeferredMermaidRenderer extends MermaidRenderer {
  readonly pending: PendingRender[];
}

// Answers only when the test says so, to resolve renders out of order.
export function createDeferredRenderer(): DeferredMermaidRenderer {
  const pending: PendingRender[] = [];
  return {
    pending,
    render(source, theme) {
      return new Promise<RenderOutcome>((resolve) => {
        pending.push({ source, theme, resolve });
      });
    },
  };
}

export interface ObjectUrlFake {
  readonly created: string[];
  readonly revoked: string[];
  // URLs created and not revoked yet.
  live(): string[];
  restore(): void;
}

export function installObjectUrlFake(): ObjectUrlFake {
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    const url = `blob:fake-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  return {
    created,
    revoked,
    live: () => created.filter((url) => !revoked.includes(url)),
    restore() {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}
