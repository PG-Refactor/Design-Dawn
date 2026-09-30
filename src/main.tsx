import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { APP_CONFIG } from "./config/app-config";

const rootElement = document.getElementById(APP_CONFIG.rootElementId);
if (rootElement === null) {
  throw new Error(`Root element #${APP_CONFIG.rootElementId} not found`);
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
