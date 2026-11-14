import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type BetterSqlite3 from "better-sqlite3";
import type { Pool, PoolClient } from "pg";

/**
 * One small async database interface over three engines:
 *  - SQLite (better-sqlite3): local development and the default test run
 *  - Postgres (node-postgres): the deployed app (Supabase), shared by every serverless instance
 *  - PGlite (in-process Postgres): the test run that proves the Postgres SQL works (AEGIS_DB_PATH=":pglite:")
 *
 * Queries are written once, in the SQLite dialect the app always used: `?` placeholders, `rowid` as the insertion-order
 * tie-breaker and `INSERT OR IGNORE`. The Postgres adapters translate them (`$1..$n`, the `seq` identity column every
 * Postgres table has, `ON CONFLICT DO NOTHING`).
 *
 * Transactions: `db.transaction(async (tx) => ...)`. Inside the callback every query made through ANY handle of the same
 * database (tx, or getDb() deeper down the call stack) runs inside that transaction, tracked with AsyncLocalStorage, so a
 * repo function called from inside a transaction can neither escape it nor deadlock on it. A nested transaction() joins
 * the outer one.
 */

export type Row = Record<string, unknown>;
export type Dialect = "sqlite" | "postgres";

export interface Queryable {
  /** every row */
  all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]>;
  /** the first row, or undefined */
  get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  /** INSERT / UPDATE / DELETE: how many rows changed */
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

export interface Db extends Queryable {
  readonly dialect: Dialect;
  /** false once close() was called */
  readonly open: boolean;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** runs several statements separated by `;` (schema scripts); no parameters */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/* ───────────── SQLite dialect -> Postgres ───────────── */

const pgCache = new Map<string, string>();

interface SqlSegment {
  /** true for SQL text; false for a string literal, a quoted identifier or a comment (copied unchanged) */
  code: boolean;
  text: string;
}

/**
 * Splits a statement into SQL text and the parts no rewrite may touch: '...' literals ('' escapes; E'...' also takes
 * backslash escapes), "..." identifiers ("" escapes), -- line comments and (nested) block comments. An unterminated
 * one runs to the end of the statement.
 */
function splitSql(sql: string): SqlSegment[] {
  const segs: SqlSegment[] = [];
  let code = "";
  let i = 0;
  const flush = () => {
    if (code) segs.push({ code: true, text: code });
    code = "";
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    let end = -1;
    if (ch === "'") {
      const escapes = /(^|[^\w$])[eE]$/.test(code);
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === "\\") j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      end = Math.min(j + 1, sql.length);
    } else if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j += 1;
      }
      end = Math.min(j + 1, sql.length);
    } else if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      end = nl === -1 ? sql.length : nl;
    } else if (ch === "/" && next === "*") {
      let depth = 0;
      let j = i;
      while (j < sql.length) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
          if (depth === 0) break;
        } else {
          j += 1;
        }
      }
      end = Math.min(j, sql.length);
    }
    if (end === -1) {
      code += ch;
      i += 1;
    } else {
      flush();
      segs.push({ code: false, text: sql.slice(i, end) });
      i = end;
    }
  }
  flush();
  return segs;
}

const INSERT_OR_IGNORE = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i;

/**
 * `?` -> `$n`, `rowid` -> `seq`, `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING` (placed before a RETURNING
 * clause, else at the end of the statement). Only SQL text is rewritten: string literals, quoted identifiers and
 * comments are left exactly as written.
 */
export function toPostgresSql(sql: string): string {
  const cached = pgCache.get(sql);
  if (cached !== undefined) return cached;

  let n = 0;
  const segs = splitSql(sql).map((s) =>
    s.code
      ? { code: true, text: s.text.replace(/\?/g, () => `$${++n}`).replace(/\browid\b/gi, "seq") }
      : s,
  );

  const insertAt = segs.findIndex((s) => s.code && INSERT_OR_IGNORE.test(s.text));
  if (insertAt !== -1) {
    segs[insertAt] = { code: true, text: segs[insertAt].text.replace(INSERT_OR_IGNORE, "INSERT INTO") };
    const returningAt = segs.findIndex((s, idx) => idx >= insertAt && s.code && /\bRETURNING\b/i.test(s.text));
    if (returningAt !== -1) {
      const s = segs[returningAt];
      segs[returningAt] = { code: true, text: s.text.replace(/\bRETURNING\b/i, "ON CONFLICT DO NOTHING $&") };
    } else {
      // after the last SQL text (a trailing `;` is dropped), before any trailing comment
      let last = segs.length - 1;
      while (last > insertAt && !(segs[last].code && segs[last].text.replace(/[;\s]/g, "") !== "")) last -= 1;
      const after = last < segs.length - 1 ? " " : "";
      segs[last] = { code: true, text: segs[last].text.replace(/;?\s*$/, ` ON CONFLICT DO NOTHING${after}`) };
    }
  }

  const out = segs.map((s) => s.text).join("");
  if (pgCache.size < 2000) pgCache.set(sql, out);
  return out;
}

/** Postgres returns COUNT(*) and other int8 values as strings (pg) or bigint (PGlite): make them numbers. */
function normaliseRow<T>(row: Row): T {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (typeof v === "bigint") row[key] = Number(v);
  }
  return row as T;
}

/** better-sqlite3 binds booleans as errors and undefined as errors: keep the old call sites' behaviour explicit. */
function sqliteParams(params: unknown[]): unknown[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p === undefined ? null : p));
}

function pgParams(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

/* ───────────── shared transaction plumbing ───────────── */

interface TxContext {
  owner: object;
  q: Queryable;
  /** multi-statement script on the transaction's connection */
  exec: (sql: string) => Promise<void>;
}
const txStore = new AsyncLocalStorage<TxContext>();

function currentTxContext(owner: object): TxContext | null {
  const ctx = txStore.getStore();
  return ctx && ctx.owner === owner ? ctx : null;
}

function currentTx(owner: object): Queryable | null {
  return currentTxContext(owner)?.q ?? null;
}

/* ───────────── SQLite ───────────── */

export class SqliteDb implements Db {
  readonly dialect = "sqlite" as const;
  private readonly statements = new Map<string, BetterSqlite3.Statement>();
  /** serialises access: a transaction spans awaits, and nothing else may run inside it meanwhile */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly direct: Queryable;

  constructor(private readonly raw: BetterSqlite3.Database) {
    this.direct = {
      all: async <T>(sql: string, ...params: unknown[]) => this.stmt(sql).all(...sqliteParams(params)) as T[],
      get: async <T>(sql: string, ...params: unknown[]) =>
        this.stmt(sql).get(...sqliteParams(params)) as T | undefined,
      run: async (sql: string, ...params: unknown[]) => ({
        changes: this.stmt(sql).run(...sqliteParams(params)).changes,
      }),
    };
  }

  /** the underlying better-sqlite3 handle (pragmas in tests); bypasses the queue, so never use it for app queries */
  get sqlite(): BetterSqlite3.Database {
    return this.raw;
  }

  get open(): boolean {
    return this.raw.open;
  }

  private stmt(sql: string): BetterSqlite3.Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const inTx = currentTx(this);
    if (inTx) return fn();
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.exclusive(() => this.direct.all<T>(sql, ...params));
  }

  get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return this.exclusive(() => this.direct.get<T>(sql, ...params));
  }

  run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return this.exclusive(() => this.direct.run(sql, ...params));
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const inTx = currentTx(this);
    if (inTx) return fn(inTx);
    const exec = async (sql: string) => {
      this.raw.exec(sql);
    };
    return this.exclusive(() =>
      txStore.run({ owner: this, q: this.direct, exec }, async () => {
        this.raw.exec("BEGIN");
        try {
          const result = await fn(this.direct);
          this.raw.exec("COMMIT");
          return result;
        } catch (error) {
          if (this.raw.inTransaction) this.raw.exec("ROLLBACK");
          throw error;
        }
      }),
    );
  }

  async exec(sql: string): Promise<void> {
    await this.exclusive(async () => {
      this.raw.exec(sql);
    });
  }

  async close(): Promise<void> {
    if (this.raw.open) this.raw.close();
  }
}

/* ───────────── Postgres (node-postgres) ───────────── */

function pgQueryable(client: Pool | PoolClient): Queryable {
  return {
    all: async <T>(sql: string, ...params: unknown[]) => {
      const res = await client.query(toPostgresSql(sql), pgParams(params));
      return res.rows.map((r) => normaliseRow<T>(r as Row));
    },
    get: async <T>(sql: string, ...params: unknown[]) => {
      const res = await client.query(toPostgresSql(sql), pgParams(params));
      return res.rows[0] === undefined ? undefined : normaliseRow<T>(res.rows[0] as Row);
    },
    run: async (sql: string, ...params: unknown[]) => {
      const res = await client.query(toPostgresSql(sql), pgParams(params));
      return { changes: res.rowCount ?? 0 };
    },
  };
}

export class PostgresDb implements Db {
  readonly dialect = "postgres" as const;
  private closed = false;
  private readonly poolQ: Queryable;

  constructor(private readonly pool: Pool) {
    this.poolQ = pgQueryable(pool);
  }

  get open(): boolean {
    return !this.closed;
  }

  private q(): Queryable {
    return currentTx(this) ?? this.poolQ;
  }

  all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.q().all<T>(sql, ...params);
  }

  get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return this.q().get<T>(sql, ...params);
  }

  run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return this.q().run(sql, ...params);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const inTx = currentTx(this);
    if (inTx) return fn(inTx);
    const client = await this.pool.connect();
    // pg-pool removes its idle 'error' listener while a client is checked out, and a client whose connection drops
    // emits 'error' after failing its queries: with no listener that would be an uncaught exception. The failure
    // itself reaches the caller through the failed query; the broken client is destroyed, not returned to the pool.
    let broken: Error | undefined;
    const onError = (err: Error) => {
      broken ??= err;
    };
    client.on("error", onError);
    const q = pgQueryable(client);
    const exec = async (sql: string) => {
      await client.query(sql);
    };
    try {
      await client.query("BEGIN");
      const result = await txStore.run({ owner: this, q, exec }, () => fn(q));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackError: unknown) => {
        // a connection that cannot even roll back must not be reused
        broken ??= rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      });
      throw error;
    } finally {
      client.removeListener("error", onError);
      client.release(broken);
    }
  }

  async exec(sql: string): Promise<void> {
    const tx = currentTxContext(this);
    if (tx) {
      await tx.exec(sql);
      return;
    }
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

/* ───────────── PGlite (in-process Postgres, tests) ───────────── */

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query: PgliteLike["query"]; exec: PgliteLike["exec"] }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly closed?: boolean;
}

function pgliteQueryable(client: Pick<PgliteLike, "query">): Queryable {
  return {
    all: async <T>(sql: string, ...params: unknown[]) => {
      const res = await client.query<Row>(toPostgresSql(sql), pgParams(params));
      return res.rows.map((r) => normaliseRow<T>(r));
    },
    get: async <T>(sql: string, ...params: unknown[]) => {
      const res = await client.query<Row>(toPostgresSql(sql), pgParams(params));
      return res.rows[0] === undefined ? undefined : normaliseRow<T>(res.rows[0]);
    },
    run: async (sql: string, ...params: unknown[]) => {
      const res = await client.query<Row>(toPostgresSql(sql), pgParams(params));
      return { changes: res.affectedRows ?? 0 };
    },
  };
}

export class PgliteDb implements Db {
  readonly dialect = "postgres" as const;
  private closed = false;
  private readonly baseQ: Queryable;

  constructor(private readonly pg: PgliteLike) {
    this.baseQ = pgliteQueryable(pg);
  }

  get open(): boolean {
    return !this.closed;
  }

  private q(): Queryable {
    return currentTx(this) ?? this.baseQ;
  }

  all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.q().all<T>(sql, ...params);
  }

  get<T = Row>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return this.q().get<T>(sql, ...params);
  }

  run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return this.q().run(sql, ...params);
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const inTx = currentTx(this);
    if (inTx) return fn(inTx);
    return this.pg.transaction(async (raw) => {
      const q = pgliteQueryable(raw);
      const exec = async (sql: string) => {
        await raw.exec(sql);
      };
      return txStore.run({ owner: this, q, exec }, () => fn(q));
    });
  }

  async exec(sql: string): Promise<void> {
    const tx = currentTxContext(this);
    if (tx) {
      await tx.exec(sql);
      return;
    }
    await this.pg.exec(sql);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pg.close();
  }
}
