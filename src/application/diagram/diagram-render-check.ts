// The port the application uses to ask "can Mermaid draw this text?" before a GUI
// operation is committed. The application layer does not import features, so the real
// implementation (features/mermaid/diagram-render-check.ts) is handed in by the caller.
// It must not throw: every failure is `ok: false` with a message.
export type DiagramRenderCheckOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type DiagramRenderCheck = (
  source: string,
) => Promise<DiagramRenderCheckOutcome>;
