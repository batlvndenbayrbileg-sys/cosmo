import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getEnv } from "@/server/env";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

export type Db = Database.Database;

const GLOBAL_KEY = Symbol.for("aegis.db");
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Db };

function isMemoryPath(p: string): boolean {
  return p === ":memory:" || p === "";
}

/**
 * Opens (and migrates) a database. `:memory:` is supported; for a file path the parent directory
 * is created. Foreign keys are always ON (the composite FKs are what guarantee crew isolation);
 * file databases use WAL. The schema is applied idempotently.
 */
export function openDb(dbPath: string): Db {
  let target = dbPath;
  if (isMemoryPath(dbPath)) {
    target = ":memory:";
  } else {
    target = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
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
 */
export function getDb(): Db {
  const g = globalThis as GlobalWithDb;
  const existing = g[GLOBAL_KEY];
  if (existing && existing.open) return existing;
  const db = openDb(getEnv().dbPath);
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
