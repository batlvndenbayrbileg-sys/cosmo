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
    // every test run uses a throw-away database, never data/aegis.db: in-memory SQLite by default, or the in-process
    // Postgres (PGlite) when AEGIS_TEST_DB=":pglite:" (`pnpm test:pg`). test.env overrides the shell's AEGIS_DB_PATH, so
    // the override has its own name.
    env: { AEGIS_DB_PATH: process.env.AEGIS_TEST_DB || ":memory:", DEMO_MODE: "scripted" },
    testTimeout: 15_000,
    // the first getDb() of a PGlite test file starts a WebAssembly Postgres, which takes seconds while every worker does
    // the same at once
    hookTimeout: process.env.AEGIS_TEST_DB === ":pglite:" ? 60_000 : 10_000,
  },
});
