import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, resolveDbPath, tmpDbPath } from "@/server/db/client";
import { seedIfEmpty } from "@/server/db/seed";
import { hasWords } from "@/server/speech/stt";

describe("speech: hasWords (noise and filler are not an answer)", () => {
  it.each(["", "   ", "...", "(noise)", "[music] (laughter)", "Хм.", "ммм", "аан...", "uh, hmm", "Ээ"])(
    "no words: %j",
    (text) => {
      expect(hasWords(text)).toBe(false);
    },
  );
  it.each(["68", "Тийм", "хм, 68 байна", "uh, sixty eight", "Тод байна", "no"])("words: %j", (text) => {
    expect(hasWords(text)).toBe(true);
  });
});

describe("db client: where the database file goes", () => {
  it("keeps :memory: in memory", () => {
    expect(resolveDbPath(":memory:", {})).toBe(":memory:");
    expect(resolveDbPath("", { VERCEL: "1" })).toBe(":memory:");
  });

  it("resolves a relative path against the working directory off Vercel", () => {
    expect(resolveDbPath("data/aegis.db", {})).toBe(path.resolve("data/aegis.db"));
  });

  it("moves the default path to the temp directory on Vercel (read-only app directory)", () => {
    expect(resolveDbPath("data/aegis.db", { VERCEL: "1" })).toBe(tmpDbPath());
    expect(tmpDbPath().startsWith(os.tmpdir())).toBe(true);
  });

  it("honours an explicit AEGIS_DB_PATH on Vercel", () => {
    expect(resolveDbPath("/mnt/db/aegis.db", { VERCEL: "1", AEGIS_DB_PATH: "/mnt/db/aegis.db" })).toBe(
      path.resolve("/mnt/db/aegis.db"),
    );
  });
});

describe("db client: a fresh file database gets the demo roster", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-db-test-"));
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("seeds an empty file database once and leaves a filled one alone", async () => {
    const file = path.join(dir, "nested", "aegis.db");
    const db = openDb(file);
    expect(fs.existsSync(file)).toBe(true);
    const first = await seedIfEmpty(db);
    expect(first?.crew).toBeGreaterThan(0);
    expect(await seedIfEmpty(db)).toBeNull();
    const n = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM crew_member"))!.n;
    expect(n).toBe(first?.crew);
    await db.close();
  });
});
