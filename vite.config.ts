import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

// Must match build.devUrl and devCsp in src-tauri/tauri.conf.json.
const DEV_SERVER_PORT = 1420;
const DEV_SERVER_HOST = "localhost";

// Bind-mounted Windows files may not emit inotify events, so polling is opt-in.
const ENV_PREFIX = "DAWN_";
const WATCH_POLLING_ENV_NAME = "DAWN_WATCH_POLLING";

// Machine input for scripts/third-party-notices.mjs. Vite lists exactly the node_modules
// packages that ended up in the production bundle. A dotted path keeps it out of the
// way of the app's own assets; the script reads it from here.
const LICENSE_REPORT_FILE_NAME = ".vite/license.json";

// Coverage reports (`npm run coverage`); ignored by Git.
const COVERAGE_DIRECTORY = "coverage";

// Git worktrees for parallel work (development tooling creates them here); never part of this checkout.
const WORKTREES_GLOB = "**/.claude/worktrees/**";

export default defineConfig(({ mode }) => {
  // loadEnv also reads process.env, so variables set by compose.yaml apply.
  const env = loadEnv(mode, ".", ENV_PREFIX);

  return {
    plugins: [react()],
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_ENV_"],
    build: { license: { fileName: LICENSE_REPORT_FILE_NAME } },
    server: {
      port: DEV_SERVER_PORT,
      strictPort: true,
      host: DEV_SERVER_HOST,
      watch: {
        ignored: ["**/src-tauri/**", WORKTREES_GLOB],
        usePolling: env[WATCH_POLLING_ENV_NAME] === "true",
      },
    },
    test: {
      environment: "node",
      // CSS sources are read as text by the token tests; without this vitest returns "".
      css: { include: [/\.css/] },
      // A worktree carries its own copy of every test.
      exclude: [...configDefaults.exclude, WORKTREES_GLOB],
      // `npm run coverage`: statements (C0) and branches (C1) of the app's own code. Tests,
      // test helpers and type-only files are not measured.
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/**/test-support/**",
          "src/**/*test-support.{ts,tsx}",
          "src/**/test-fixtures.ts",
          "src/**/*.d.ts",
        ],
        reporter: ["text-summary", "json-summary", "json", "html"],
        reportsDirectory: COVERAGE_DIRECTORY,
      },
    },
  };
});
