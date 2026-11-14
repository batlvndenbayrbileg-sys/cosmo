import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) as string } : undefined),
    set: (opts: { name: string; value: string }) => void mocks.jar.set(opts.name, opts.value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

import { POST as postEmergencyAlert } from "@/app/api/emergency/alert/route";
import type { AlertRow } from "@/lib/types";
import { createOrResumeCheckIn } from "@/server/checkin/service";
import { setClockForTests } from "@/server/clock";
import { listAlerts } from "@/server/db/repos/alert";
import { confirmCheckIn } from "@/server/db/repos/checkin";
import { listMeasurements, upsertMeasurement } from "@/server/db/repos/measurement";
import { listTurns } from "@/server/db/repos/turn";
import { localDateISO } from "@/server/db/shared";
import { setSessionCookie } from "@/server/session";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * Read-then-write sequences that the old synchronous database could not interleave and the async one can: each must
 * still behave as one step when two requests run it at the same time.
 */

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
  mocks.jar.clear();
});
afterEach(() => {
  setClockForTests(null);
  vi.restoreAllMocks();
});

const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

describe("createOrResumeCheckIn under concurrency", () => {
  it("two starts in flight at once return the same check-in: one open row for the day, one greeting", async () => {
    const results = await Promise.all([
      createOrResumeCheckIn("bat"),
      createOrResumeCheckIn("bat"),
      createOrResumeCheckIn("bat"),
    ]);
    const ids = new Set(results.map((r) => r.checkInId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.resumed)).toHaveLength(1);
    const [id] = ids;
    expect((await listTurns("bat", id)).filter((t) => t.speaker === "cosmo")).toHaveLength(1);

    const db = await (await import("@/server/db/client")).getDb();
    const open = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM check_in WHERE crew_id = ? AND local_date = ? AND confirmed_at IS NULL",
      "bat",
      localDateISO(TEST_TODAY),
    );
    expect(open?.n).toBe(1);
    // another crew member is not held up or merged
    const saraa = await createOrResumeCheckIn("saraa");
    expect(saraa.checkInId).not.toBe(id);
  });
});

describe("upsertMeasurement under concurrency", () => {
  it("a confirmation issued between the 'not confirmed' check and the write cannot slip in before the write", async () => {
    const { checkInId } = await createOrResumeCheckIn("bat", "en");
    const { getDb } = await import("@/server/db/client");
    const db = await getDb();

    // fires a confirmation from OUTSIDE the measurement's transaction the moment the measurement INSERT is about to run
    // (the continuation is registered here, so it runs in this context, not inside the transaction)
    let fire!: () => void;
    const trigger = new Promise<void>((r) => {
      fire = r;
    });
    let confirmedFirst = false;
    const confirming = trigger.then(async () => {
      await confirmCheckIn("bat", checkInId, { confirmedAt: TEST_TODAY, summaryJson: null });
      confirmedFirst = true;
    });

    const run = db.run.bind(db);
    let insertSawConfirmed: boolean | null = null;
    vi.spyOn(db, "run").mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (/^\s*INSERT INTO measurement/.test(sql) && insertSawConfirmed === null) {
        fire();
        // give the confirmation every chance to run; with the check and the write in one transaction it must wait
        await Promise.race([confirming, tick(50)]);
        insertSawConfirmed = confirmedFirst;
      }
      return run(sql, ...params);
    });

    const upsert = upsertMeasurement("bat", checkInId, {
      key: "mood", value: 4, unit: null, sourceText: "4", confidence: 1, source: "typed",
    });
    await Promise.all([upsert, confirming]);
    // the write happened before the confirmation, never after it
    expect(insertSawConfirmed).toBe(false);
    expect((await listMeasurements("bat", checkInId)).map((m) => m.key)).toEqual(["mood"]);

    // and once confirmed, a write is refused
    await expect(
      upsertMeasurement("bat", checkInId, {
        key: "mood", value: 2, unit: null, sourceText: "2", confidence: 1, source: "typed",
      }),
    ).rejects.toThrow(expect.objectContaining({ status: 409, code: "WRONG_STATE" }));
  });
});

describe("POST /api/emergency/alert under concurrency", () => {
  const post = (body: unknown) =>
    postEmergencyAlert(
      new Request("http://localhost/api/emergency/alert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("two requests for the same check-in and scenario raise one red alert", async () => {
    await setSessionCookie({ role: "crew", crewId: "bat" });
    const { checkInId } = await createOrResumeCheckIn("bat", "en");
    const responses = await Promise.all([
      post({ scenarioId: "call-for-help", checkInId }),
      post({ scenarioId: "call-for-help", checkInId }),
      post({ scenarioId: "call-for-help", checkInId }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const alerts = await Promise.all(responses.map(async (r) => ((await r.json()) as { alert: AlertRow }).alert));
    expect(new Set(alerts.map((a) => a.id)).size).toBe(1);
    const stored = (await listAlerts("bat")).filter((a) => a.checkInId === checkInId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ level: "red", rule: "SERIOUS_SYMPTOM_WORD" });

    // a later request still returns that alert
    const again = await post({ scenarioId: "call-for-help", checkInId });
    expect(((await again.json()) as { alert: AlertRow }).alert.id).toBe(stored[0].id);
  });

  it("another crew member's check-in is still a 404", async () => {
    const { checkInId } = await createOrResumeCheckIn("saraa", "en");
    await setSessionCookie({ role: "crew", crewId: "bat" });
    const res = await post({ scenarioId: "call-for-help", checkInId });
    expect(res.status).toBe(404);
    expect(await listAlerts("saraa")).toSatisfy((rows: AlertRow[]) => rows.every((a) => a.checkInId !== checkInId));
  });
});
