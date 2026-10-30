import type { Ref } from "react";
import type { FlowchartEdgeView } from "../../domain/diagram/flowchart/flowchart-view";
import { useMessages } from "../workspace/use-messages";
import { oneLine } from "./flowchart-node-list";
import { GuiListbox } from "./gui-listbox";

export interface FlowchartEdgeListProps {
  readonly shortId: string;
  readonly edges: readonly FlowchartEdgeView[];
  readonly selectedIndex: number | null;
  readonly onSelect: (index: number) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

export function FlowchartEdgeList({
  shortId,
  edges,
  selectedIndex,
  onSelect,
  onEnter,
  listRef,
}: FlowchartEdgeListProps) {
  const text = useMessages().mermaid.gui.flowchart;
  if (edges.length === 0) {
    return <p className="diagram-gui__empty">{text.emptyEdges}</p>;
  }
  return (
    <GuiListbox
      label={text.edgeListLabel(shortId)}
      selectedKey={selectedIndex === null ? null : String(selectedIndex)}
      onSelect={(key) => onSelect(Number(key))}
      onEnter={onEnter}
      listRef={listRef}
      items={edges.map((edge) => {
        const name = text.edgeOption(
          oneLine(edge.startLabel),
          oneLine(edge.endLabel),
          oneLine(edge.displayLabel),
        );
        return {
          key: String(edge.index),
          name,
          content: (
            <span className="diagram-gui__option-label" title={name}>
              {name}
            </span>
          ),
        };
      })}
    />
  );
}
