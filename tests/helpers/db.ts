import { getDb, resetDbForTests, type Db } from "@/server/db/client";
import { seedDatabase } from "@/server/db/seed";

/** Local noon on 14 Nov 2026: the seed covers 31 Oct .. 13 Nov (local dates). */
export const TEST_TODAY = new Date(2026, 10, 14, 12, 0, 0, 0);

/** A brand-new in-memory database (the singleton behind getDb(), so repos operate on it). */
export function freshEmptyDb(): Db {
  resetDbForTests();
  return getDb();
}

/** A brand-new in-memory database seeded with the 4 demo crew members (deterministic). */
export function freshSeededDb(opts: { today?: Date } = {}): Db {
  const db = freshEmptyDb();
  seedDatabase(db, { today: opts.today ?? TEST_TODAY });
  return db;
}

/** Inserts a bare crew member (no repo creates crew; the seed does it in bulk). */
export function insertCrew(
  db: Db,
  id: string,
  opts: { name?: string; language?: "mn" | "en" } = {},
): void {
  db.prepare(
    `INSERT INTO crew_member (id, name, role, preferred_language, mascot_variant, avatar_seed)
     VALUES (?, ?, 'Test role', ?, 0, ?)`,
  ).run(id, opts.name ?? id.toUpperCase(), opts.language ?? "en", `${id}-0`);
}
