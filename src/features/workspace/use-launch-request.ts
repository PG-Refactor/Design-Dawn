import { useEffect } from "react";
import { useWorkspaceServices } from "./workspace-services-context";

// Opens the `.dawn` the app was launched with (if any) once the UI is mounted, so a
// failure can be shown in the notifications. Calling it again is harmless: the action
// shares its first call.
export function useLaunchRequest(): void {
  const { actions } = useWorkspaceServices();
  useEffect(() => {
    void actions.openLaunchRequest();
  }, [actions]);
}
