import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app is per-user and dynamic (session cookie + SQLite on every request), so the
  // scaffold's `cacheComponents` / `partialPrefetching` defaults are deliberately off.
  // better-sqlite3 is a native module and must not be bundled; pg (Postgres/Supabase) and PGlite (tests) stay
  // external too, so their optional native/wasm parts are loaded by Node at run time.
  serverExternalPackages: ["better-sqlite3", "pg", "@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
