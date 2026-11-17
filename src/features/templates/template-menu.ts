// Menu entries for the custom templates of some kinds, grouped by where they are kept
// (shared first, then this Project's and every Project's own), with a separator between
// the groups. Empty when there are none.

import {
  TEMPLATE_SCOPES,
  type TemplateKind,
  type TemplateSummary,
} from "../../application/ports/template-gateway";
import type { PopupMenuEntry } from "../../shared/menu/menu-list";
import type { TemplateMessages } from "./template-messages";

export function customTemplateEntries(
  templates: readonly TemplateSummary[],
  kinds: readonly TemplateKind[],
  messages: TemplateMessages,
  onSelect: (template: TemplateSummary) => void,
): PopupMenuEntry[] {
  const groups = TEMPLATE_SCOPES.map((scope) =>
    templates.filter(
      (template) => template.scope === scope && kinds.includes(template.kind),
    ),
  ).filter((group) => group.length > 0);
  return groups.flatMap((group, index): PopupMenuEntry[] => [
    ...(index === 0
      ? []
      : [{ id: `templateSeparator-${index}`, separator: true as const }]),
    ...group.map((template) => ({
      id: `custom-${template.scope}-${template.templateId}`,
      label:
        kinds.length > 1
          ? `${template.name}（${messages.kinds[template.kind]}・${messages.scopeShort[template.scope]}）`
          : `${template.name}（${messages.scopeShort[template.scope]}）`,
      onSelect: () => onSelect(template),
    })),
  ]);
}

// The entries, or one item that cannot be chosen saying there are none: the submenu is
// always there, so it can be found before the first template is saved.
export function orNoTemplates(
  entries: PopupMenuEntry[],
  messages: TemplateMessages,
): PopupMenuEntry[] {
  return entries.length > 0
    ? entries
    : [
        {
          id: "noCustomTemplates",
          label: messages.noTemplates,
          disabled: true,
          onSelect: () => {},
        },
      ];
}
