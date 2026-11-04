import { type FocusEvent as ReactFocusEvent, useRef, useState } from "react";
import type { BlockType } from "../../domain/block/block-type";
import { MenuList, type PopupMenuItem } from "../../shared/menu/menu-list";
import type { MermaidTemplateId } from "../mermaid/mermaid-templates";
import { useMessages } from "../workspace/use-messages";
import { templateEntries } from "./canvas-context-menu";
import { CREATABLE_BLOCK_TYPES } from "./creatable-block-types";

export interface BlockCreateMenuProps {
  readonly onCreate: (
    blockType: BlockType,
    mermaidTemplate?: MermaidTemplateId,
  ) => void;
  // Opens the image file dialog.
  readonly onAddImage: () => void;
}

const OPEN_KEY = "ArrowDown";

// The "+ Block" menu button (menu button pattern): the button opens a menu of the creatable
// block types, the Mermaid templates (in a submenu) and images; arrow keys move, Enter /
// click chooses, Escape closes and focus goes back to the button.
export function BlockCreateMenu({
  onCreate,
  onAddImage,
}: BlockCreateMenuProps) {
  const messages = useMessages().canvas;
  const mermaidMessages = useMessages().mermaid;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function close(): void {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function choose(item: PopupMenuItem): void {
    // Focus goes back first, so what the action opens (a dialog) remembers the button.
    close();
    item.onSelect();
  }

  // Focus leaving the whole widget (Tab away, a click elsewhere) closes the menu without
  // pulling focus back.
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only observes focus leaving the widget; it is not an interactive element.
    <div className="block-create-menu" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={(event) => {
          if (event.key === OPEN_KEY) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {messages.toolbar.addBlock}
      </button>
      {open && (
        <MenuList
          label={messages.toolbar.blockTypeMenuLabel}
          className="block-create-menu__list"
          onDismiss={close}
          onChoose={choose}
          entries={[
            ...CREATABLE_BLOCK_TYPES.map((creatable) => ({
              id: creatable.blockType,
              label: creatable.label,
              onSelect: () => onCreate(creatable.blockType),
            })),
            {
              id: "templates",
              label: messages.toolbar.templates,
              entries: templateEntries(mermaidMessages.templates, (template) =>
                onCreate("mermaid", template),
              ),
            },
            {
              id: "image",
              label: messages.toolbar.image,
              onSelect: onAddImage,
            },
          ]}
        />
      )}
    </div>
  );
}
