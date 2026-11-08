import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { createAppServices } from "./app/create-app-services";
import { startApp } from "./app/start-app";
import { APP_CONFIG } from "./config/app-config";
import { suppressDefaultContextMenu } from "./shared/menu/default-context-menu";
import "./styles/theme-tokens.css";
import "./styles/base.css";

const rootElement = document.getElementById(APP_CONFIG.rootElementId);
if (rootElement === null) {
  throw new Error(`Root element #${APP_CONFIG.rootElementId} not found`);
}

suppressDefaultContextMenu(window);

const services = createAppServices();
const {
  themeController,
  languageController,
  autoSaveController,
  layoutSettingsController,
  textSizeController,
} = services;

void startApp({
  themeController,
  languageController,
  autoSaveController,
  layoutSettingsController,
  textSizeController,
  themeTarget: document.documentElement,
  languageTarget: document.documentElement,
  textSizeTarget: document.documentElement,
  render: () =>
    createRoot(rootElement).render(
      <StrictMode>
        <App services={services} />
      </StrictMode>,
    ),
  reportError: (error) => console.error("Theme initialization failed", error),
});
