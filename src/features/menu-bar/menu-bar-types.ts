// The description of a menu bar. Presentational: it knows nothing about stores, actions
// or messages, so the menu bar can be tested on its own and reused.

export interface MenuActionItem {
  readonly kind: "item";
  readonly id: string;
  readonly label: string;
  // Shown on the right; `aria-keyshortcuts` is derived from `shortcutKeys`.
  readonly shortcutHint?: string;
  readonly shortcutKeys?: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface MenuCheckboxItem {
  readonly kind: "checkbox";
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface MenuRadioOption {
  readonly value: string;
  readonly label: string;
}

// A labelled set of mutually exclusive choices (`role="group"` of `menuitemradio`).
export interface MenuRadioGroup {
  readonly kind: "radioGroup";
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly MenuRadioOption[];
  readonly disabled?: boolean;
  readonly onSelect: (value: string) => void;
}

export interface MenuSeparator {
  readonly kind: "separator";
  readonly id: string;
}

export type MenuEntry =
  | MenuActionItem
  | MenuCheckboxItem
  | MenuRadioGroup
  | MenuSeparator;

export interface MenuDefinition {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}
