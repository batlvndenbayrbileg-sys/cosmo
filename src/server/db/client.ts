import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getEnv } from "@/server/env";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { seedIfEmpty } from "./seed";

export type Db = Database.Database;

const GLOBAL_KEY = Symbol.for("aegis.db");
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Db };

function isMemoryPath(p: string): boolean {
  return p === ":memory:" || p === "";
}

const READ_ONLY_FS_CODES = new Set(["EROFS", "EACCES", "EPERM"]);

/** the writable place for the database when the app directory is read-only (Vercel and other serverless hosts) */
export function tmpDbPath(): string {
  return path.join(os.tmpdir(), "aegis", "aegis.db");
}

/**
 * Where the database file goes. On Vercel the deployment directory is read-only and only the temp directory can be
 * written, so the default `data/aegis.db` moves there unless AEGIS_DB_PATH names a place explicitly.
 */
export function resolveDbPath(dbPath: string, env: Record<string, string | undefined> = process.env): string {
  if (isMemoryPath(dbPath)) return ":memory:";
  if (env.VERCEL && !env.AEGIS_DB_PATH?.trim()) return tmpDbPath();
  return path.resolve(dbPath);
}

/** creates the parent directory; a read-only filesystem moves the database to the temp directory instead */
function prepareFile(target: string): string {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    return target;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !READ_ONLY_FS_CODES.has(code)) throw error;
    const fallback = tmpDbPath();
    console.warn(`[aegis] cannot create ${path.dirname(target)} (${code}); using ${fallback}`);
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    return fallback;
  }
}

/**
 * Opens (and migrates) a database. `:memory:` is supported; for a file path the parent directory
 * is created (or, on a read-only filesystem, the temp directory is used). Foreign keys are always ON
 * (the composite FKs are what guarantee crew isolation); file databases use WAL. The schema is
 * applied idempotently.
 */
export function openDb(dbPath: string): Db {
  const resolved = resolveDbPath(dbPath);
  const target = resolved === ":memory:" ? resolved : prepareFile(resolved);
  const db = new Database(target);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (target !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

/**
 * Process-wide singleton, cached on globalThis so Next dev hot reloads do not leak connections or
 * (for `:memory:`) lose data. Path comes from getEnv().dbPath.
 *
 * A file database with no crew yet is filled with the demo data (as `pnpm db:seed` would, without wiping), so a fresh
 * clone or a fresh serverless instance has the roster. `:memory:` databases (the tests) are left empty: the tests seed
 * them with a fixed date themselves.
 */
export function getDb(): Db {
  const g = globalThis as GlobalWithDb;
  const existing = g[GLOBAL_KEY];
  if (existing && existing.open) return existing;
  const dbPath = getEnv().dbPath;
  const db = openDb(dbPath);
  if (!isMemoryPath(dbPath)) {
    const seeded = seedIfEmpty(db);
    if (seeded) console.info(`[aegis] empty database: seeded ${seeded.crew} crew, ${seeded.checkIns} check-ins (simulated)`);
  }
  g[GLOBAL_KEY] = db;
  return db;
}

/** Closes and forgets the singleton so the next getDb() starts from a fresh database. Tests only. */
export function resetDbForTests(): void {
  const g = globalThis as GlobalWithDb;
  const existing = g[GLOBAL_KEY];
  if (existing && existing.open) existing.close();
  delete g[GLOBAL_KEY];
}
