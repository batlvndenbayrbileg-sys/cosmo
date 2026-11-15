import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getQuestion } from "@/lib/kpi/registry";
import { interpretAnswer } from "@/server/agent/interpret";
import { setClockForTests } from "@/server/clock";
import { setSensorFeedForTests } from "@/server/checkin/sensors";
import { assistantText, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * Answers in any order (team feedback 2026-11-15): a value for another measurement, named while a different question is
 * open, is taken for that measurement only and never read as the answer to the open question.
 */

describe("interpretAnswer ignores numbers that belong to another named measurement", () => {
  it.each([
    ["glucose", "өө миний даралт 120 дээр 80 байна шүү дээ"],
    ["glucose", "oh and my blood pressure was 118 over 76"],
    ["water", "пульс 64 байсан"],
    ["heart_rate", "температур 36.6"],
  ] as const)("%s question, %s -> no value for the open question", (id, text) => {
    expect(interpretAnswer(getQuestion(id), text, "mn").records).toEqual([]);
  });

  it("still reads the open question's own value next to another measurement", () => {
    const r = interpretAnswer(getQuestion("glucose"), "сахар 95, даралт 120 дээр 80", "mn");
    expect(r.records.map((x) => [x.key, x.value])).toEqual([["glucose_mgdl", 95]]);
    const w = interpretAnswer(getQuestion("workload"), "сэтгэл санаа сайн, ачаалал 3", "mn");
    expect(w.records.map((x) => [x.key, x.value])).toEqual([["workload", 3]]);
  });
});

describe("a skipped question answered later, while another one is open", () => {
  // the measurement questions are asked only without a sensor feed
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    setSensorFeedForTests(false);
    await freshSeededDb();
  });
  afterEach(() => {
    setClockForTests(null);
    setSensorFeedForTests(null);
  });

  it("stores the blood pressure only, re-asks blood sugar, then takes the next number as blood sugar", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of ["Сайн уу", "эхэлье", "4", "үгүй", "4", "4", "2", "4", "7 цаг", "алгасъя", "70", "36.6"]) await playTurn("bat", id, line);

    const late = await playTurn("bat", id, "өө миний даралт 120 дээр 80 байна шүү дээ");
    expect(eventsOf(late, "measurement").map((e) => [e.key, e.value])).toEqual([
      ["bp_systolic", 120],
      ["bp_diastolic", 80],
    ]);
    expect(assistantText(late)).toMatch(/Цусны сахар хэд байна/u);

    const next = await playTurn("bat", id, "95");
    expect(eventsOf(next, "measurement").map((e) => [e.key, e.value])).toEqual([["glucose_mgdl", 95]]);
  });
});
