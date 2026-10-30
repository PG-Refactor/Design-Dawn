import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import { useMessages } from "../workspace/use-messages";
import {
  GuiDraftLabelField,
  type GuiDraftLabelFieldProps,
} from "./gui-draft-label-field";

export type FlowchartLabelFieldProps<Target> = Omit<
  GuiDraftLabelFieldProps<Target, FlowchartOperation>,
  "itemChangedText"
>;

// The label draft of the flowchart editor: the generic draft field with the flowchart's
// wording for "the element changed".
export function FlowchartLabelField<Target>(
  props: FlowchartLabelFieldProps<Target>,
) {
  const text = useMessages().mermaid.gui.flowchart;
  return <GuiDraftLabelField {...props} itemChangedText={text.itemChanged} />;
}
