import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Must match build.devUrl and devCsp in src-tauri/tauri.conf.json.
const DEV_SERVER_PORT = 1420;
const DEV_SERVER_HOST = "localhost";

// Bind-mounted Windows files may not emit inotify events, so polling is opt-in.
const ENV_PREFIX = "DAWN_";
const WATCH_POLLING_ENV_NAME = "DAWN_WATCH_POLLING";

export default defineConfig(({ mode }) => {
  // loadEnv also reads process.env, so variables set by compose.yaml apply.
  const env = loadEnv(mode, ".", ENV_PREFIX);

  return {
    plugins: [react()],
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_ENV_"],
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
      host: DEV_SERVER_HOST,
      watch: {
        ignored: ["**/src-tauri/**"],
        usePolling: env[WATCH_POLLING_ENV_NAME] === "true",
      },
    },
    test: {
      environment: "node",
    },
  };
});
