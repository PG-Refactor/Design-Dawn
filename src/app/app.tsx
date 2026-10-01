import { APP_CONFIG } from "../config/app-config";

export function App() {
  return (
    <main>
      <h1>{APP_CONFIG.displayName}</h1>
    </main>
  );
}
