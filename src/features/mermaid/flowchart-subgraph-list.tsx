import type { Ref } from "react";
import type { FlowchartSubgraphView } from "../../domain/diagram/flowchart/flowchart-view";
import { useMessages } from "../workspace/use-messages";
import { oneLine } from "./flowchart-node-list";
import { GuiListbox } from "./gui-listbox";

export interface FlowchartSubgraphListProps {
  readonly shortId: string;
  readonly subgraphs: readonly FlowchartSubgraphView[];
  readonly selectedId: string | null;
  readonly onSelect: (subgraphId: string) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

export function FlowchartSubgraphList({
  shortId,
  subgraphs,
  selectedId,
  onSelect,
  onEnter,
  listRef,
}: FlowchartSubgraphListProps) {
  const text = useMessages().mermaid.gui.flowchart;
  if (subgraphs.length === 0) {
    return <p className="diagram-gui__empty">{text.emptySubgraphs}</p>;
  }
  return (
    <GuiListbox
      label={text.subgraphListLabel(shortId)}
      selectedKey={selectedId}
      onSelect={onSelect}
      onEnter={onEnter}
      listRef={listRef}
      items={subgraphs.map((subgraph) => {
        const title = oneLine(subgraph.title);
        const members =
          subgraph.memberLabels.length === 0
            ? text.noMembers
            : subgraph.memberLabels.map(oneLine).join(text.memberSeparator);
        return {
          key: subgraph.id,
          name: text.subgraphOption(title, subgraph.id, members),
          content: (
            <>
              <span className="diagram-gui__option-label" title={members}>
                {title}
              </span>
              <span className="diagram-gui__option-value">{subgraph.id}</span>
            </>
          ),
        };
      })}
    />
  );
}
