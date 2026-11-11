import { useCallback, useEffect, useRef } from "react";

// How long the pointer may cross another entry on its way into an open submenu before the
// submenu follows it (desktop menus wait like this, so a diagonal move does not close it).
export const SUBMENU_SWITCH_DELAY_MS = 300;

// Opening / closing a submenu by pointer, with the delay above: `change` applies at once
// when nothing is open, otherwise after the delay unless the pointer comes back
// (`keep`). Keyboard changes call the setter directly.
export function useSubmenuIntent(
  openId: string | null,
  setOpenId: (id: string | null) => void,
): {
  readonly change: (id: string | null) => void;
  readonly keep: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const change = useCallback(
    (id: string | null) => {
      keep();
      if (openId === null || openId === id) {
        setOpenId(id);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpenId(id);
      }, SUBMENU_SWITCH_DELAY_MS);
    },
    [openId, setOpenId, keep],
  );
  useEffect(() => keep, [keep]);
  return { change, keep };
}
