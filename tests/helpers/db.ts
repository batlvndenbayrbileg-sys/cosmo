import { getDb, openDb, openPglite, resetDbForTests, type Db } from "@/server/db/client";
import { seedDatabase } from "@/server/db/seed";

/** true when the suite runs against the in-process Postgres (`pnpm test:pg`) */
export const TESTING_POSTGRES = process.env.COSMO_DB_PATH === ":pglite:";

/**
 * A separate, empty database on the engine the suite runs against (not the getDb() singleton), for tests that compare
 * two databases. The caller closes it.
 */
export async function openScratchDb(): Promise<Db> {
  return TESTING_POSTGRES ? openPglite() : openDb(":memory:");
}

/** Local noon on 14 Nov 2026: the seed covers 31 Oct .. 13 Nov (local dates). */
export const TEST_TODAY = new Date(2026, 10, 14, 12, 0, 0, 0);

/** A brand-new in-memory database (the singleton behind getDb(), so repos operate on it). */
export async function freshEmptyDb(): Promise<Db> {
  resetDbForTests();
  return getDb();
}

/** A brand-new in-memory database seeded with the 4 demo crew members (deterministic). */
export async function freshSeededDb(opts: { today?: Date } = {}): Promise<Db> {
  const db = await freshEmptyDb();
  await seedDatabase(db, { today: opts.today ?? TEST_TODAY });
  return db;
}

/** Inserts a bare crew member (no repo creates crew; the seed does it in bulk). */
export async function insertCrew(
  db: Db,
  id: string,
  opts: { name?: string; language?: "mn" | "en" } = {},
): Promise<void> {
  await db.run(
    `INSERT INTO crew_member (id, name, role, preferred_language, mascot_variant, avatar_seed)
     VALUES (?, ?, 'Test role', ?, 0, ?)`,
    id,
    opts.name ?? id.toUpperCase(),
    opts.language ?? "en",
    `${id}-0`,
  );
}
