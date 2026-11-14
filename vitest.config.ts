import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws outside Next's react-server condition; neutralise it for unit tests
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // every test run uses its own throw-away SQLite file, never data/aegis.db
    env: { AEGIS_DB_PATH: ":memory:", DEMO_MODE: "scripted" },
    testTimeout: 15_000,
  },
});
