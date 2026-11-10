// Fixed values of the exports.
export const EXPORT_CONFIG = {
  // A PNG is drawn at twice the diagram's size, so it stays sharp on a high-density screen
  // and in a document.
  pngScale: 2,
  // Exports always use the light theme: they end up in documents and on paper.
  theme: "light",
  // The name suggested for a diagram without a caption.
  diagramFallbackName: "diagram",
} as const;
