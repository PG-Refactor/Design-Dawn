import type { Ref } from "react";
import type { SequenceParticipantView } from "../../domain/diagram/sequence/sequence-view";
import { useMessages } from "../workspace/use-messages";
import { GuiListbox } from "./gui-listbox";
import { oneLine } from "./sequence-entry-text";

export interface SequenceParticipantListProps {
  readonly shortId: string;
  readonly participants: readonly SequenceParticipantView[];
  readonly selectedId: string | null;
  readonly onSelect: (participantId: string) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

export function SequenceParticipantList({
  shortId,
  participants,
  selectedId,
  onSelect,
  onEnter,
  listRef,
}: SequenceParticipantListProps) {
  const text = useMessages().mermaid.gui.sequence;
  if (participants.length === 0) {
    return <p className="diagram-gui__empty">{text.emptyParticipants}</p>;
  }
  return (
    <GuiListbox
      label={text.participantListLabel(shortId)}
      selectedKey={selectedId}
      onSelect={onSelect}
      onEnter={onEnter}
      listRef={listRef}
      items={participants.map((participant) => {
        const label = oneLine(participant.displayLabel);
        return {
          key: participant.id,
          name: text.participantOption(
            label,
            participant.id,
            text.kinds[participant.kind],
          ),
          content: (
            <>
              <span className="diagram-gui__option-label" title={label}>
                {label}
              </span>
              <span className="diagram-gui__option-value">
                {participant.id}
              </span>
            </>
          ),
        };
      })}
    />
  );
}
