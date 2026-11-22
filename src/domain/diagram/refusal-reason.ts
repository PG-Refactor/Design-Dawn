import { itemAt } from "../shared/item-at";

// The reason code at the start of an operation refusal's detail (`targetNotFound: no node
// X`), which a view shows as the reason a control is unavailable.
export function refusalReason(detail: string): string {
  return itemAt(detail.split(":"), 0, "").trim();
}
