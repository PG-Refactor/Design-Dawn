import { createContext, useContext } from "react";
import type { MermaidRenderer } from "./mermaid-renderer-types";
import { mermaidRenderer } from "./render-mermaid";

// The real renderer is the default, so the app needs no provider; a DOM test supplies a
// fake with <MermaidRendererContext.Provider> and never loads the library.
export const MermaidRendererContext =
  createContext<MermaidRenderer>(mermaidRenderer);

export function useMermaidRenderer(): MermaidRenderer {
  return useContext(MermaidRendererContext);
}
