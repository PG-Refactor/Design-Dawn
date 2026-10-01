import {
  type WorkspaceServices,
  WorkspaceServicesProvider,
} from "../features/workspace/workspace-services-context";
import { WorkspaceShell } from "../features/workspace/workspace-shell";

export interface AppProps {
  readonly services: WorkspaceServices;
}

export function App({ services }: AppProps) {
  return (
    <WorkspaceServicesProvider services={services}>
      <WorkspaceShell />
    </WorkspaceServicesProvider>
  );
}
