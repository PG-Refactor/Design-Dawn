import type {
  SequenceArrow,
  SequenceBlock,
  SequenceBranch,
  SequenceNotePlacement,
  SequenceParticipantKind,
} from "./sequence-config";

// Result types of the sequence reader. Convention (the same as the flowchart reader): every
// object that has a `span` (UTF-16 offsets into the source) also has a `text` that is exactly
// `source.slice(span.start, span.end)`, except an empty token, whose span is a point where
// text would be written.

export interface SequenceSpan {
  readonly start: number;
  readonly end: number;
}

export interface SequenceToken {
  readonly text: string;
  readonly span: SequenceSpan;
}

interface StatementBase {
  // Position in the list of recognised statements.
  readonly index: number;
  readonly lineIndex: number;
  // The statement without its surrounding blanks, `;` and any trailing `#` comment.
  readonly text: string;
  readonly span: SequenceSpan;
}

export interface SequenceParticipantStatement extends StatementBase {
  readonly kind: "participant";
  readonly declaration: SequenceParticipantKind;
  readonly keyword: SequenceToken;
  readonly id: SequenceToken;
  readonly alias: SequenceToken | null;
}

export interface SequenceMessageStatement extends StatementBase {
  readonly kind: "message";
  readonly from: SequenceToken;
  readonly arrow: SequenceToken;
  // The arrow in its canonical (lower case) spelling.
  readonly arrowValue: SequenceArrow;
  // `+` activates the receiver, `-` deactivates the sender.
  readonly sign: SequenceToken | null;
  readonly to: SequenceToken;
  readonly messageText: SequenceToken;
}

export interface SequenceNoteStatement extends StatementBase {
  readonly kind: "note";
  readonly placement: SequenceNotePlacement;
  // `left of`, `right of` or `over`.
  readonly placementToken: SequenceToken;
  // One participant, or two for `over A,B`.
  readonly ids: readonly SequenceToken[];
  readonly noteText: SequenceToken;
}

export interface SequenceActivationStatement extends StatementBase {
  readonly kind: "activation";
  readonly activate: boolean;
  readonly id: SequenceToken;
}

export interface SequenceBlockStartStatement extends StatementBase {
  readonly kind: "blockStart";
  readonly block: SequenceBlock;
  readonly keyword: SequenceToken;
  readonly label: SequenceToken;
}

export interface SequenceBranchStatement extends StatementBase {
  readonly kind: "branch";
  readonly branch: SequenceBranch;
  readonly keyword: SequenceToken;
  readonly label: SequenceToken;
}

export interface SequenceBlockEndStatement extends StatementBase {
  readonly kind: "blockEnd";
}

export interface SequenceAutonumberStatement extends StatementBase {
  readonly kind: "autonumber";
  readonly visible: boolean;
  readonly start: number | null;
  readonly step: number | null;
  // `autonumber` with nothing after it.
  readonly bare: boolean;
}

export interface SequenceTitleStatement extends StatementBase {
  readonly kind: "title";
  readonly title: SequenceToken;
}

export type SequenceStatement =
  | SequenceParticipantStatement
  | SequenceMessageStatement
  | SequenceNoteStatement
  | SequenceActivationStatement
  | SequenceBlockStartStatement
  | SequenceBranchStatement
  | SequenceBlockEndStatement
  | SequenceAutonumberStatement
  | SequenceTitleStatement;

// Why a statement is read but not understood. The whole diagram is then read-only.
export const SEQUENCE_OPAQUE_REASONS = [
  "unrecognisedStatement",
  "reservedWordAsId",
  "wrapPrefix",
  "hashInDeclaration",
  "statementOnHeaderLine",
  "boxStatement",
  "createDestroy",
  "linkStatement",
  "accessibilityStatement",
] as const;
export type SequenceOpaqueReason = (typeof SEQUENCE_OPAQUE_REASONS)[number];

export interface SequenceOpaqueStatement {
  readonly lineIndex: number;
  readonly reason: SequenceOpaqueReason;
  readonly text: string;
  readonly span: SequenceSpan;
}
