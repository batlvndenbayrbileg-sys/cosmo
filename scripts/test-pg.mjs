// Runs the whole test suite against the in-process Postgres (PGlite) instead of in-memory SQLite: `pnpm test:pg`.
// A tiny launcher so the environment variable is set the same way on Windows PowerShell, cmd and POSIX shells.
// Extra arguments go to vitest, e.g. `pnpm test:pg tests/seed.test.ts`.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("vitest/package.json");
const vitest = path.join(path.dirname(pkgPath), require(pkgPath).bin.vitest);
const result = spawnSync(process.execPath, [vitest, "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, COSMO_TEST_DB: ":pglite:" },
});
process.exit(result.status ?? 1);
