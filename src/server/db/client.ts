import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import { getEnv } from "@/server/env";
import { PG_SCHEMA_INDEXES, PG_SCHEMA_SQL, PG_SCHEMA_TABLES, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { seedIfEmpty } from "./seed";
import { PgliteDb, PostgresDb, SqliteDb, type Db, type Queryable } from "./sql";

export type { Db, Queryable, Row } from "./sql";

/**
 * Which database the app talks to:
 *  - DATABASE_URL (or POSTGRES_URL) set: Postgres, e.g. Supabase. Every serverless instance shares it, which is what
 *    makes a check-in survive from one request to the next on Vercel.
 *  - otherwise the SQLite file at AEGIS_DB_PATH (default data/aegis.db), or `:memory:` (the tests).
 *  - AEGIS_DB_PATH=":pglite:": an in-process Postgres (PGlite), used to run the whole test suite against Postgres SQL.
 */

const GLOBAL_KEY = Symbol.for("aegis.db");
interface DbSlot {
  promise: Promise<Db>;
  /** :pglite: test databases are reused across resets (starting PGlite is slow) and emptied instead */
  wipeNext?: boolean;
  kind: "sqlite" | "memory" | "postgres" | "pglite";
}
type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: DbSlot };

const PGLITE_PATH = ":pglite:";
/** taken while creating the schema and seeding, so two cold starts cannot seed the shared database twice */
const SCHEMA_LOCK_KEY = 727_274_101;
/** the longest a cold start waits for a table lock (creating the schema) before it gives up */
const PREPARE_LOCK_TIMEOUT = "5s";

function isMemoryPath(p: string): boolean {
  return p === ":memory:" || p === "";
}

const READ_ONLY_FS_CODES = new Set(["EROFS", "EACCES", "EPERM"]);

/** the writable place for the database when the app directory is read-only (Vercel and other serverless hosts) */
export function tmpDbPath(): string {
  return path.join(os.tmpdir(), "aegis", "aegis.db");
}

/**
 * Where the SQLite file goes. On Vercel the deployment directory is read-only and only the temp directory can be
 * written, so the default `data/aegis.db` moves there unless AEGIS_DB_PATH names a place explicitly. (On Vercel set
 * DATABASE_URL instead: a temp-directory file is not shared between instances.)
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
 * Opens (and migrates) a SQLite database. `:memory:` is supported; for a file path the parent directory is created (or,
 * on a read-only filesystem, the temp directory is used). Foreign keys are always ON (the composite FKs are what
 * guarantee crew isolation); file databases use WAL. The schema is applied idempotently.
 */
export function openDb(dbPath: string): SqliteDb {
  const resolved = resolveDbPath(dbPath);
  const target = resolved === ":memory:" ? resolved : prepareFile(resolved);
  const raw = new Database(target);
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  if (target !== ":memory:") raw.pragma("journal_mode = WAL");
  raw.exec(SCHEMA_SQL);
  raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  return new SqliteDb(raw);
}

/** a fresh in-process Postgres with the schema applied (tests) */
export async function openPglite(): Promise<PgliteDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PgliteDb(new PGlite());
  await db.exec(PG_SCHEMA_SQL);
  return db;
}

/** the URL without `sslmode` (pg would then insist on verifying the pooler's certificate chain); TLS is set below */
function withoutSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url;
  }
}

function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

let int8ParserSet = false;

/** a Postgres pool (Supabase: use the Transaction pooler URI, port 6543). The schema is applied by getDb(). */
export function openPostgres(url: string): PostgresDb {
  if (!int8ParserSet) {
    // COUNT(*) and other int8 values: numbers, as SQLite returns them
    pg.types.setTypeParser(20, (v: string) => Number(v));
    int8ParserSet = true;
  }
  const pool = new pg.Pool({
    connectionString: withoutSslMode(url),
    // encrypted; the Supabase pooler's chain is not in Node's default CA store
    ssl: isLocalHost(url) ? undefined : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => console.error("[aegis] idle Postgres client error:", err.message));
  return new PostgresDb(pool);
}

/**
 * true when every table and index of PG_SCHEMA_SQL exists in the current schema and every table has row level
 * security on. A catalog read only: it takes no lock on the tables.
 */
export async function pgSchemaReady(db: Queryable): Promise<boolean> {
  const tables = PG_SCHEMA_TABLES.map(() => "?").join(", ");
  const indexes = PG_SCHEMA_INDEXES.map(() => "?").join(", ");
  const row = await db.get<{ tables: number; indexes: number }>(
    `SELECT
       (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity
           AND c.relname IN (${tables})) AS tables,
       (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = current_schema() AND c.relkind = 'i' AND c.relname IN (${indexes})) AS indexes`,
    ...PG_SCHEMA_TABLES,
    ...PG_SCHEMA_INDEXES,
  );
  return Number(row?.tables) === PG_SCHEMA_TABLES.length && Number(row?.indexes) === PG_SCHEMA_INDEXES.length;
}

/**
 * Creates the Postgres schema when it is missing and, when `seed` is set, fills an empty database with the demo data.
 *
 * Runs on the first getDb() of every serverless instance, so the steady state must stay cheap and lock nothing that
 * live requests use: the schema script is skipped when the catalog shows it is already applied (even its no-op
 * statements would lock the tables: CREATE INDEX IF NOT EXISTS takes SHARE and ALTER TABLE ... ENABLE ROW LEVEL
 * SECURITY takes ACCESS EXCLUSIVE until COMMIT). Waits for table locks are bounded by lock_timeout, so a cold start fails
 * (and the next request retries) rather than stalling the database.
 */
export async function preparePostgres(db: Db, opts: { seed: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    // two cold starts at once: the second waits here until the first has created and seeded everything
    await tx.get("SELECT pg_advisory_xact_lock(?)", SCHEMA_LOCK_KEY);
    await db.exec(`SET LOCAL lock_timeout = '${PREPARE_LOCK_TIMEOUT}'`);
    if (!(await pgSchemaReady(tx))) await db.exec(PG_SCHEMA_SQL);
    if (opts.seed) {
      const seeded = await seedIfEmpty(db);
      if (seeded) console.info(`[aegis] empty database: seeded ${seeded.crew} crew, ${seeded.checkIns} check-ins (simulated)`);
    }
  });
}

/** preparePostgres, closing the pool when it fails: the next getDb() opens a new one, and the old one must not linger */
export async function openPreparedPostgres(db: Db, opts: { seed: boolean }): Promise<Db> {
  try {
    await preparePostgres(db, opts);
    return db;
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

async function openConfigured(): Promise<DbSlot> {
  const env = getEnv();
  if (env.databaseUrl) {
    const db = openPostgres(env.databaseUrl);
    return { promise: openPreparedPostgres(db, { seed: true }), kind: "postgres" };
  }
  if (env.dbPath === PGLITE_PATH) {
    return { promise: openPglite(), kind: "pglite" };
  }
  const db = openDb(env.dbPath);
  if (isMemoryPath(env.dbPath)) return { promise: Promise.resolve(db), kind: "memory" };
  // a file database with no crew yet is filled with the demo data (as `pnpm db:seed` would, without wiping), so a
  // fresh clone or a fresh instance has the roster
  const promise = seedIfEmpty(db).then((seeded) => {
    if (seeded) console.info(`[aegis] empty database: seeded ${seeded.crew} crew, ${seeded.checkIns} check-ins (simulated)`);
    return db as Db;
  });
  return { promise, kind: "sqlite" };
}

/**
 * The process-wide database, opened (and prepared) once and cached on globalThis so Next dev hot reloads do not leak
 * connections or (for `:memory:`) lose data.
 *
 * `:memory:` and `:pglite:` databases (the tests) are left empty: the tests seed them with a fixed date themselves.
 */
export async function getDb(): Promise<Db> {
  const g = globalThis as GlobalWithDb;
  let slot = g[GLOBAL_KEY];
  if (slot) {
    const db = await slot.promise.catch(() => null);
    if (db && db.open) {
      if (slot.wipeNext) {
        slot.wipeNext = false;
        await db.exec("TRUNCATE alert, turn, measurement, check_in, crew_member RESTART IDENTITY CASCADE");
      }
      return db;
    }
    if (g[GLOBAL_KEY] === slot) delete g[GLOBAL_KEY];
  }
  slot = g[GLOBAL_KEY];
  if (!slot) {
    // the slot is stored before anything is awaited, so concurrent first calls share one open
    const opening = openConfigured();
    const pending: DbSlot = { promise: opening.then((s) => s.promise), kind: "sqlite" };
    g[GLOBAL_KEY] = pending;
    opening.then(
      (s) => {
        pending.kind = s.kind;
      },
      () => {
        if (g[GLOBAL_KEY] === pending) delete g[GLOBAL_KEY];
      },
    );
    slot = pending;
  }
  return slot.promise;
}

/**
 * Forgets the singleton so the next getDb() starts from an empty database. Tests only. A `:pglite:` database is kept
 * and emptied on the next getDb() (starting PGlite for every test would be slow).
 */
export function resetDbForTests(): void {
  const g = globalThis as GlobalWithDb;
  const slot = g[GLOBAL_KEY];
  if (!slot) return;
  if (slot.kind === "pglite") {
    slot.wipeNext = true;
    return;
  }
  delete g[GLOBAL_KEY];
  void slot.promise.then((db) => db.close()).catch(() => undefined);
}
