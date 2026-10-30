import type { Ref } from "react";
import type { FlowchartNodeView } from "../../domain/diagram/flowchart/flowchart-view";
import { useMessages } from "../workspace/use-messages";
import { GuiListbox } from "./gui-listbox";

export interface FlowchartNodeListProps {
  readonly shortId: string;
  readonly nodes: readonly FlowchartNodeView[];
  readonly selectedId: string | null;
  readonly onSelect: (nodeId: string) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

// Single-line text of a label for a list row (line breaks shown as blanks).
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ");
}

export function FlowchartNodeList({
  shortId,
  nodes,
  selectedId,
  onSelect,
  onEnter,
  listRef,
}: FlowchartNodeListProps) {
  const text = useMessages().mermaid.gui.flowchart;
  if (nodes.length === 0) {
    return <p className="diagram-gui__empty">{text.emptyNodes}</p>;
  }
  return (
    <GuiListbox
      label={text.nodeListLabel(shortId)}
      selectedKey={selectedId}
      onSelect={onSelect}
      onEnter={onEnter}
      listRef={listRef}
      items={nodes.map((node) => {
        const label = oneLine(node.displayLabel);
        return {
          key: node.id,
          name: text.nodeOption(label, node.id),
          content: (
            <>
              <span className="diagram-gui__option-label" title={label}>
                {label}
              </span>
              <span className="diagram-gui__option-value">{node.id}</span>
            </>
          ),
        };
      })}
    />
  );
}
