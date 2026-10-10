import "./mermaid-placeholder-preview.css";

export interface MermaidPlaceholderPreviewProps {
  readonly source: string;
  readonly label: string;
  readonly notice: string;
  readonly emptyMessage: string;
  // Edit mode scrolls the content; in the normal state the block clips it.
  readonly scrollable?: boolean;
}

// Stands in for the diagram until real rendering exists. It deliberately does not look
// like a rendered diagram: a notice plus the source as plain text, so nobody mistakes it
// for the result. The source is a React text node, never markup.
export function MermaidPlaceholderPreview({
  source,
  label,
  notice,
  emptyMessage,
  scrollable = false,
}: MermaidPlaceholderPreviewProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region over a div is intended; <section> would not take the dynamic label as clearly.
    <div
      role="region"
      aria-label={label}
      className={
        scrollable
          ? "mermaid-placeholder mermaid-placeholder--scrollable"
          : "mermaid-placeholder"
      }
    >
      <p className="mermaid-placeholder__notice">{notice}</p>
      {source.trim() === "" ? (
        <p>{emptyMessage}</p>
      ) : (
        <pre className="mermaid-placeholder__source">{source}</pre>
      )}
    </div>
  );
}
