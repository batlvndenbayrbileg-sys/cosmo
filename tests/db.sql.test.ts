import { EventEmitter } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, openPreparedPostgres, pgSchemaReady, preparePostgres } from "@/server/db/client";
import { PG_SCHEMA_INDEXES, PG_SCHEMA_SQL, PG_SCHEMA_TABLES } from "@/server/db/schema";
import { PgliteDb, PostgresDb, SqliteDb, toPostgresSql, type Db } from "@/server/db/sql";
import { freshEmptyDb, insertCrew, TESTING_POSTGRES } from "./helpers/db";

describe("toPostgresSql", () => {
  it("numbers ? placeholders $1..$n in order", () => {
    expect(toPostgresSql("SELECT * FROM t WHERE a = ? AND b IN (?, ?) LIMIT ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b IN ($2, $3) LIMIT $4",
    );
  });

  it("leaves a ? inside single- or double-quoted text alone", () => {
    expect(toPostgresSql("SELECT '?' AS q, \"wh?\" AS w, ? AS p FROM t WHERE x = 'a?b' AND y = ?")).toBe(
      "SELECT '?' AS q, \"wh?\" AS w, $1 AS p FROM t WHERE x = 'a?b' AND y = $2",
    );
    // an escaped quote ('') closes and reopens the string, so the ? after it is still inside
    expect(toPostgresSql("SELECT 'it''s ?' AS s, ? AS p")).toBe("SELECT 'it''s ?' AS s, $1 AS p");
  });

  it("rewrites rowid (any case, whole word, qualified or not) to seq", () => {
    expect(toPostgresSql("SELECT id FROM t ORDER BY created_at ASC, rowid ASC")).toBe(
      "SELECT id FROM t ORDER BY created_at ASC, seq ASC",
    );
    expect(toPostgresSql("SELECT a.id FROM alert a ORDER BY a.ROWID DESC")).toBe(
      "SELECT a.id FROM alert a ORDER BY a.seq DESC",
    );
    expect(toPostgresSql("SELECT rowid_count, my_rowid FROM t")).toBe("SELECT rowid_count, my_rowid FROM t");
  });

  it("turns INSERT OR IGNORE into INSERT ... ON CONFLICT DO NOTHING", () => {
    expect(toPostgresSql("INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)")).toBe(
      "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    );
    expect(toPostgresSql("insert or ignore into kv (k, v)\n  VALUES (?, ?);\n")).toBe(
      "INSERT INTO kv (k, v)\n  VALUES ($1, $2) ON CONFLICT DO NOTHING",
    );
  });

  it("leaves plain SQL untouched", () => {
    const sql = "INSERT INTO kv (k, v) VALUES ('a', 1)";
    expect(toPostgresSql(sql)).toBe(sql);
  });

  it("never rewrites rowid inside a string literal or a quoted identifier", () => {
    expect(toPostgresSql("SELECT 'rowid' AS x")).toBe("SELECT 'rowid' AS x");
    expect(toPostgresSql('SELECT "rowid", rowid FROM t WHERE note = \'by rowid\'')).toBe(
      'SELECT "rowid", seq FROM t WHERE note = \'by rowid\'',
    );
  });

  it("puts ON CONFLICT DO NOTHING before RETURNING and before a trailing comment", () => {
    expect(toPostgresSql("INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?) RETURNING k")).toBe(
      "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING k",
    );
    expect(toPostgresSql("INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?) -- seed row")).toBe(
      "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT DO NOTHING -- seed row",
    );
    expect(toPostgresSql("INSERT OR IGNORE INTO kv (k, v) VALUES (?, 'x'); -- done\n")).toBe(
      "INSERT INTO kv (k, v) VALUES ($1, 'x') ON CONFLICT DO NOTHING -- done\n",
    );
  });

  it("skips comments and E'' escapes when numbering placeholders", () => {
    expect(toPostgresSql("SELECT ? -- don't count this ?\n, ? /* nor 'this' ? */ FROM t WHERE rowid = ?")).toBe(
      "SELECT $1 -- don't count this ?\n, $2 /* nor 'this' ? */ FROM t WHERE seq = $3",
    );
    expect(toPostgresSql("SELECT E'it\\'s ?', ? AS p")).toBe("SELECT E'it\\'s ?', $1 AS p");
    // a plain literal ending in a backslash is not an escape
    expect(toPostgresSql("SELECT 'a\\', ? AS p")).toBe("SELECT 'a\\', $1 AS p");
    expect(toPostgresSql("SELECT /* outer /* inner ? */ still ? */ ?")).toBe("SELECT /* outer /* inner ? */ still ? */ $1");
  });
});

/* ───────────── Postgres pool transactions (node-postgres) ───────────── */

class FakeClient extends EventEmitter {
  queries: string[] = [];
  released: unknown[] = [];
  failNext: Error | null = null;
  async query(sql: string) {
    this.queries.push(sql);
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return { rows: [], rowCount: 0 };
  }
  release(err?: unknown) {
    this.released.push(err);
  }
}

function fakePostgres(): { db: PostgresDb; client: FakeClient; ended: () => boolean } {
  const client = new FakeClient();
  let ended = false;
  const pool = {
    connect: async () => client,
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => {
      ended = true;
    },
  };
  return { db: new PostgresDb(pool as unknown as Pool), client, ended: () => ended };
}

describe("PostgresDb.transaction", () => {
  it("listens for 'error' on the checked-out client: a dropped connection fails the transaction, it does not crash", async () => {
    const { db, client } = fakePostgres();
    const reset = new Error("Connection terminated unexpectedly");
    await expect(
      db.transaction(async (tx) => {
        // what pg does when the socket drops: the active query fails and the client emits 'error'
        client.emit("error", reset);
        client.failNext = reset;
        await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "a", 1);
      }),
    ).rejects.toBe(reset);
    // the broken client is destroyed (release(err)), not handed back to the pool, and the listener is gone
    expect(client.released).toEqual([reset]);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("a healthy client goes back to the pool; a failed ROLLBACK destroys it", async () => {
    const { db, client } = fakePostgres();
    expect(await db.transaction(async () => 7)).toBe(7);
    expect(client.queries).toEqual(["BEGIN", "COMMIT"]);
    expect(client.released).toEqual([undefined]);

    const boom = new Error("boom");
    const rollbackFailed = new Error("rollback failed");
    await expect(
      db.transaction(async () => {
        client.failNext = rollbackFailed; // the next query is the ROLLBACK
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(client.released).toEqual([undefined, rollbackFailed]);
  });
});

/* ───────────── Postgres cold start ───────────── */

describe("preparePostgres", () => {
  let pg: PgliteDb;
  beforeAll(async () => {
    pg = new PgliteDb(new PGlite());
  }, 60_000);
  afterAll(async () => {
    await pg.close();
  });

  it("creates a missing schema once, then skips the schema script (no table locks) on every later cold start", async () => {
    expect(PG_SCHEMA_TABLES).toEqual(["crew_member", "check_in", "measurement", "turn", "alert", "sos_alert", "pain_report"]);
    expect(PG_SCHEMA_INDEXES.length).toBeGreaterThanOrEqual(8);
    expect(await pgSchemaReady(pg)).toBe(false);

    const exec = vi.spyOn(pg, "exec");
    await preparePostgres(pg, { seed: false });
    expect(exec.mock.calls.map(([sql]) => sql)).toContain(PG_SCHEMA_SQL);
    expect(await pgSchemaReady(pg)).toBe(true);

    exec.mockClear();
    await insertCrew(pg, "zed");
    await preparePostgres(pg, { seed: true });
    expect(exec.mock.calls.map(([sql]) => sql)).not.toContain(PG_SCHEMA_SQL);
    // a filled database is not re-seeded
    expect((await pg.get<{ n: number }>("SELECT COUNT(*) AS n FROM crew_member"))!.n).toBe(1);
    exec.mockRestore();
  }, 60_000);

  it("re-applies the schema when part of it is missing (an index dropped, row level security off)", async () => {
    await preparePostgres(pg, { seed: false });
    await pg.exec("DROP INDEX idx_alert_checkin");
    expect(await pgSchemaReady(pg)).toBe(false);
    await preparePostgres(pg, { seed: false });
    expect(await pgSchemaReady(pg)).toBe(true);

    await pg.exec("ALTER TABLE turn DISABLE ROW LEVEL SECURITY");
    expect(await pgSchemaReady(pg)).toBe(false);
    await preparePostgres(pg, { seed: false });
    expect(await pgSchemaReady(pg)).toBe(true);
  }, 60_000);

  it("a failed cold start closes its pool instead of leaving it open", async () => {
    const { db, ended } = fakePostgres();
    const refused = new Error("connect ECONNREFUSED");
    vi.spyOn(db, "transaction").mockRejectedValue(refused);
    await expect(openPreparedPostgres(db, { seed: true })).rejects.toBe(refused);
    expect(ended()).toBe(true);
    expect(db.open).toBe(false);
  });
});

/* ───────────── the same contract on both engines ───────────── */

const SQLITE_KV = "CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)";
const PG_KV = "CREATE TABLE kv (k TEXT PRIMARY KEY, seq BIGINT GENERATED ALWAYS AS IDENTITY, v INTEGER NOT NULL)";

/** fails instead of hanging when a query waits on a transaction it should have joined */
function withinMs<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: still waiting after ${ms} ms (deadlock?)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const tick = () => new Promise((r) => setTimeout(r, 2));

const engines: { name: string; open: () => Promise<Db> }[] = [
  {
    name: "SqliteDb",
    open: async () => {
      const db = new SqliteDb(new Database(":memory:"));
      await db.exec(SQLITE_KV);
      return db;
    },
  },
  {
    name: "PgliteDb",
    open: async () => {
      const db = new PgliteDb(new PGlite());
      await db.exec(PG_KV);
      return db;
    },
  },
];

describe.each(engines)("$name", ({ open }) => {
  let db: Db;
  const keys = async () => (await db.all<{ k: string }>("SELECT k FROM kv ORDER BY rowid")).map((r) => r.k);

  beforeAll(async () => {
    db = await open();
  }, 60_000);

  afterAll(async () => {
    await db.close();
    expect(db.open).toBe(false);
  });

  beforeEach(async () => {
    await db.run("DELETE FROM kv");
  });

  it("runs the SQLite dialect: ? params, rowid order, INSERT OR IGNORE, numeric COUNT(*)", async () => {
    expect((await db.run("INSERT INTO kv (k, v) VALUES (?, ?)", "b", 2)).changes).toBe(1);
    expect((await db.run("INSERT INTO kv (k, v) VALUES (?, ?)", "a", 1)).changes).toBe(1);
    expect((await db.run("INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)", "a", 99)).changes).toBe(0);
    expect(await keys()).toEqual(["b", "a"]);
    expect(await db.get("SELECT v FROM kv WHERE k = ?", "a")).toEqual({ v: 1 });
    expect(await db.get("SELECT v FROM kv WHERE k = ?", "zzz")).toBeUndefined();
    expect(await db.get("SELECT COUNT(*) AS n FROM kv")).toEqual({ n: 2 });
    expect(await db.get("SELECT '?' AS q, CAST(? AS TEXT) AS p", "x")).toEqual({ q: "?", p: "x" });
    expect((await db.run("UPDATE kv SET v = v + 1")).changes).toBe(2);
  });

  it("commits a transaction and returns its result", async () => {
    const result = await db.transaction(async (tx) => {
      await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "a", 1);
      await tick();
      await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "b", 2);
      return (await tx.get<{ n: number }>("SELECT COUNT(*) AS n FROM kv"))!.n;
    });
    expect(result).toBe(2);
    expect(await keys()).toEqual(["a", "b"]);
  });

  it("rolls back everything when the callback throws, rethrows the error, and stays usable", async () => {
    await db.run("INSERT INTO kv (k, v) VALUES (?, ?)", "kept", 0);
    const boom = new Error("boom");
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "a", 1);
        await tick();
        await tx.run("UPDATE kv SET v = 5 WHERE k = ?", "kept");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await keys()).toEqual(["kept"]);
    expect(await db.get("SELECT v FROM kv WHERE k = ?", "kept")).toEqual({ v: 0 });
    // a failing statement (duplicate key) rolls back the same way
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "b", 1);
        await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "kept", 1);
      }),
    ).rejects.toThrow(/UNIQUE|duplicate/i);
    expect(await keys()).toEqual(["kept"]);
    await db.run("INSERT INTO kv (k, v) VALUES (?, ?)", "after", 1);
    expect(await keys()).toEqual(["kept", "after"]);
  });

  it("joins the transaction when code inside it queries through the outer db handle (as getDb() callers do)", async () => {
    // a repo function deeper down calls getDb() and uses that handle, not tx: it must see the uncommitted rows, be
    // rolled back with them, and not wait for the transaction to end (which would never happen)
    const inner = async () => {
      await db.run("INSERT INTO kv (k, v) VALUES (?, ?)", "via-db", 2);
      return db.all<{ k: string }>("SELECT k FROM kv ORDER BY rowid");
    };
    await expect(
      withinMs(
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "via-tx", 1);
          expect((await inner()).map((r) => r.k)).toEqual(["via-tx", "via-db"]);
          throw new Error("undo");
        }),
        5_000,
        "outer-handle query inside a transaction",
      ),
    ).rejects.toThrow("undo");
    expect(await keys()).toEqual([]);

    await withinMs(
      db.transaction(async () => {
        await inner();
      }),
      5_000,
      "outer-handle query inside a transaction",
    );
    expect(await keys()).toEqual(["via-db"]);
  });

  it("a nested transaction() joins the outer one: it sees its rows and is undone with it", async () => {
    await expect(
      withinMs(
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "outer", 1);
          const seen = await db.transaction(async (inner) => {
            await inner.run("INSERT INTO kv (k, v) VALUES (?, ?)", "inner", 2);
            return (await inner.all<{ k: string }>("SELECT k FROM kv ORDER BY rowid")).map((r) => r.k);
          });
          expect(seen).toEqual(["outer", "inner"]);
          throw new Error("undo both");
        }),
        5_000,
        "nested transaction",
      ),
    ).rejects.toThrow("undo both");
    expect(await keys()).toEqual([]);

    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", "outer", 1);
      await db.transaction(async (inner) => {
        await inner.run("INSERT INTO kv (k, v) VALUES (?, ?)", "inner", 2);
      });
    });
    expect(await keys()).toEqual(["outer", "inner"]);
  });

  it("concurrent transactions do not interleave, and one failing does not undo the other", async () => {
    const log: string[] = [];
    const work = (name: string, fail = false) =>
      db.transaction(async (tx) => {
        log.push(`${name}:begin`);
        await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", `${name}1`, 1);
        await tick();
        await tx.run("INSERT INTO kv (k, v) VALUES (?, ?)", `${name}2`, 2);
        log.push(`${name}:end`);
        if (fail) throw new Error(`${name} fails`);
      });
    const results = await Promise.allSettled([work("a"), work("b", true), work("c")]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(log).toEqual(["a:begin", "a:end", "b:begin", "b:end", "c:begin", "c:end"]);
    expect(await keys()).toEqual(["a1", "a2", "c1", "c2"]);
  });
});

describe("SqliteDb: serialised access", () => {
  it("a query issued outside a running transaction waits for it and sees only committed rows", async () => {
    const db = new SqliteDb(new Database(":memory:"));
    await db.exec(SQLITE_KV);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tx = db.transaction(async (t) => {
      await t.run("INSERT INTO kv (k, v) VALUES (?, ?)", "a", 1);
      await gate;
      await t.run("INSERT INTO kv (k, v) VALUES (?, ?)", "b", 2);
    });
    // issued from the test's own context, not from inside the transaction
    const outside = db.all<{ k: string }>("SELECT k FROM kv ORDER BY rowid");
    let outsideDone = false;
    void outside.then(() => {
      outsideDone = true;
    });
    await tick();
    expect(outsideDone).toBe(false);
    release();
    await tx;
    expect((await outside).map((r) => r.k)).toEqual(["a", "b"]);
    await db.close();
  });
});

describe("getDb(): the configured engine", () => {
  it("is the engine the suite runs against (in-memory SQLite, or PGlite under `pnpm test:pg`)", async () => {
    const db = await freshEmptyDb();
    expect(db.dialect).toBe(TESTING_POSTGRES ? "postgres" : "sqlite");
    expect(db.open).toBe(true);
  }, 60_000);

  it("a getDb() call inside the singleton's transaction joins it", async () => {
    const db = await freshEmptyDb();
    const count = async () => (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM crew_member"))!.n;
    await expect(
      withinMs(
        db.transaction(async () => {
          await insertCrew(await getDb(), "zed");
          expect(await count()).toBe(1);
          throw new Error("undo");
        }),
        5_000,
        "getDb() inside a transaction",
      ),
    ).rejects.toThrow("undo");
    expect(await count()).toBe(0);
    await db.transaction(async () => {
      await insertCrew(await getDb(), "zed");
    });
    expect(await count()).toBe(1);
  }, 60_000);
});
