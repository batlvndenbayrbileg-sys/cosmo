import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planCompanion } from "@/server/agent/companion";
import { setClockForTests } from "@/server/clock";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/** Found in a live Mongolian replay (2026-11-15): an explicit request to talk lost to a vague word read as a value. */
describe("planCompanion: a request to talk wins over a vague reading", () => {
  const kpi = { state: "KPI_CAPTURE" as const, companion: false };

  it("enters even when the rules read a value out of the words ('их стресстэй' as workload 4)", () => {
    expect(planCompanion(kpi, "Чамтай жаахан ярилцаж болох уу? Сүүлийн үед их стресстэй байна.", true)).toMatchObject({
      kind: "enter",
      entry: "request",
    });
  });

  it("still yields to a concrete number in the same words", () => {
    expect(planCompanion(kpi, "сонсооч, би 7 цаг унтсан", true)).toBeNull();
    expect(planCompanion(kpi, "listen to me, I slept seven hours", true)).toBeNull();
  });
});

describe("live flow: greeting and a request to talk mid check-in (Mongolian)", () => {
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    await freshSeededDb();
  });
  afterEach(() => setClockForTests(null));

  it("'Сайн уу' mid check-in is greeted back and the question asked again", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of ["Сайн уу", "эхэлье", "7 цаг"]) await playTurn("bat", id, line);
    const ev = await playTurn("bat", id, "Сайн уу");
    expect(assistantText(ev)).toMatch(/^Сайн байна, баярлалаа!/u);
    expect(assistantText(ev)).toMatch(/Сэтгэл санаа ямар байна/u);
    expect(eventsOf(ev, "clarification")).toEqual([]);
  });

  it("a request to talk at the workload question opens friend mode and records nothing", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of ["Сайн уу", "эхэлье", "7 цаг", "4", "үгүй", "120 дээр 80", "70", "36.6", "95", "2 литр", "30 минут", "тод"]) {
      await playTurn("bat", id, line);
    }
    const ev = await playTurn("bat", id, "Чамтай жаахан ярилцаж болох уу? Сүүлийн үед их стресстэй байна.");
    expect(eventsOf(ev, "measurement")).toEqual([]);
    expect((await ctxOf("bat", id)).companion).toBe(true);
  });

  it("while talking at the day-note question, what is said is not stored as the note", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of ["Сайн уу", "эхэлье", "7 цаг", "4", "үгүй", "120 дээр 80", "70", "36.6", "95", "2 литр", "30 минут", "тод", "3"]) {
      await playTurn("bat", id, line);
    }
    await playTurn("bat", id, "Чамтай ярилцаж болох уу?");
    const ev = await playTurn("bat", id, "Ажил их, шөнө сайн унтаж чадахгүй байна.");
    expect(eventsOf(ev, "measurement")).toEqual([]);
    const ctx = await ctxOf("bat", id);
    expect(ctx.companion).toBe(true);
    expect(ctx.state).toBe("KPI_CAPTURE");
  });
});
