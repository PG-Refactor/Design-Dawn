// Starting points for a new Mermaid block, one per kind of diagram. Small but complete
// examples, so a user sees the syntax of the kind and can change it from there. The plain
// "Mermaid" item of the add menus is the flowchart (`MERMAID_BLOCK_DEFAULTS`); these are
// the other kinds. Names shown in the menus are in the message catalogs (`templates`).

export const MERMAID_TEMPLATE_IDS = [
  "sequence",
  "gantt",
  "pie",
  "class",
  "state",
  "er",
] as const;

export type MermaidTemplateId = (typeof MERMAID_TEMPLATE_IDS)[number];

export const MERMAID_TEMPLATES: Readonly<Record<MermaidTemplateId, string>> = {
  sequence: [
    "sequenceDiagram",
    "  participant C as Client",
    "  participant S as Server",
    "  C->>S: Request",
    "  S-->>C: Response",
  ].join("\n"),
  gantt: [
    "gantt",
    "  title Plan",
    "  dateFormat YYYY-MM-DD",
    "  section Phase 1",
    "  Design :a1, 2026-01-05, 5d",
    "  Build :after a1, 10d",
  ].join("\n"),
  pie: ["pie title Share", '  "A" : 40', '  "B" : 35', '  "C" : 25'].join("\n"),
  class: [
    "classDiagram",
    "  class Customer {",
    "    +name: string",
    "  }",
    "  class Order {",
    "    +id: string",
    "    +total() number",
    "  }",
    '  Customer "1" --> "*" Order : places',
  ].join("\n"),
  state: [
    "stateDiagram-v2",
    "  [*] --> Draft",
    "  Draft --> Review",
    "  Review --> Approved",
    "  Review --> Draft",
    "  Approved --> [*]",
  ].join("\n"),
  er: [
    "erDiagram",
    "  CUSTOMER ||--o{ ORDER : places",
    "  ORDER ||--|{ LINE_ITEM : contains",
  ].join("\n"),
};
