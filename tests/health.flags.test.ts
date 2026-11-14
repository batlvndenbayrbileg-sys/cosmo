import { describe, expect, it } from "vitest";
import type { KpiKey, RedFlagRule } from "@/lib/types";
import { evaluateIndicators } from "@/lib/health/status";
import {
  SERIOUS_WORDS_EN,
  SERIOUS_WORDS_MN,
  evaluateRedFlags,
  findSeriousWords,
} from "@/lib/health/flags";
import { evaluateDay } from "@/lib/health";
import { collectStrings, normalToday, steadyHistory, type DayValues } from "./helpers/health";

function flagsFor(today: DayValues) {
  return evaluateRedFlags(today, evaluateIndicators(today, {}));
}

function rules(today: DayValues): RedFlagRule[] {
  return flagsFor(today).map((f) => f.rule);
}

describe("red flags: none on normal data", () => {
  it("fires nothing on a normal day", () => {
    expect(flagsFor(normalToday())).toEqual([]);
  });

  it("fires nothing on a normal day with harmless notes in English and Mongolian", () => {
    expect(rules(normalToday({ symptom_note: "slept well, nice view of Earth", day_note: "Сайхан өдөр байлаа" }))).toEqual([]);
  });

  it("fires nothing on an empty day", () => {
    expect(flagsFor({})).toEqual([]);
  });

  it("fires nothing through evaluateDay on normal data with history", () => {
    expect(evaluateDay(normalToday(), steadyHistory()).redFlags).toEqual([]);
  });

  it("does not fire on yellow-only readings (a yellow indicator is a watch, not an alert flag)", () => {
    expect(rules(normalToday({ heart_rate: 105, sleep_hours: 6, symptom_headache: 1, vision_check: 0 }))).toEqual([]);
  });
});

describe("red flags: VITAL_RED", () => {
  const redCases: Array<[KpiKey, number]> = [
    ["bp_systolic", 145],
    ["bp_systolic", 85],
    ["bp_diastolic", 95],
    ["bp_diastolic", 50],
    ["heart_rate", 115],
    ["heart_rate", 38],
    ["temperature_c", 38.4],
    ["temperature_c", 35.2],
    ["glucose_mgdl", 200],
    ["glucose_mgdl", 55],
  ];

  it.each(redCases)("fires for %s = %s", (key, value) => {
    const flags = flagsFor(normalToday({ [key]: value }));
    expect(flags.map((f) => f.rule)).toEqual(["VITAL_RED"]);
    expect(flags[0].keys).toEqual([key]);
  });

  it("fires for vision_check = 2 and for mood = 1", () => {
    const vision = flagsFor(normalToday({ vision_check: 2 }));
    expect(vision.map((f) => f.rule)).toEqual(["VITAL_RED"]);
    expect(vision[0].keys).toEqual(["vision_check"]);

    const mood = flagsFor(normalToday({ mood: 1 }));
    expect(mood.map((f) => f.rule)).toEqual(["VITAL_RED"]);
    expect(mood[0].keys).toEqual(["mood"]);
  });

  it("lists every triggering key in one flag", () => {
    const flags = flagsFor(normalToday({ heart_rate: 120, glucose_mgdl: 200, mood: 1 }));
    expect(flags).toHaveLength(1);
    expect(flags[0].keys).toEqual(["heart_rate", "glucose_mgdl", "mood"]);
  });

  it("does not fire for mood 2 (yellow) or vision 1 (yellow)", () => {
    expect(rules(normalToday({ mood: 2, vision_check: 1 }))).toEqual([]);
  });

  it("does not fire for a clamped lifestyle key such as water 500 ml", () => {
    expect(rules(normalToday({ water_ml: 500, exercise_min: 0, workload: 5 }))).toEqual([]);
  });
});

describe("red flags: HEADACHE_PLUS_VISION", () => {
  it("fires for headache with slightly blurred vision", () => {
    const flags = flagsFor(normalToday({ symptom_headache: 1, vision_check: 1 }));
    expect(flags.map((f) => f.rule)).toEqual(["HEADACHE_PLUS_VISION"]);
    expect(flags[0].keys).toEqual(["symptom_headache", "vision_check"]);
  });

  it("fires together with VITAL_RED when vision is clearly blurred", () => {
    expect(rules(normalToday({ symptom_headache: 1, vision_check: 2 }))).toEqual(["VITAL_RED", "HEADACHE_PLUS_VISION"]);
  });

  it("does not fire for headache alone or for blurred vision alone", () => {
    expect(rules(normalToday({ symptom_headache: 1, vision_check: 0 }))).toEqual([]);
    expect(rules(normalToday({ symptom_headache: 0, vision_check: 1 }))).toEqual([]);
  });

  it("does not fire when the headache answer is missing", () => {
    const today = normalToday({ vision_check: 1 });
    delete today.symptom_headache;
    expect(rules(today)).toEqual([]);
  });
});

describe("red flags: SERIOUS_SYMPTOM_WORD", () => {
  it("keeps editable keyword arrays with the documented words", () => {
    for (const w of ["chest pain", "can't breathe", "cannot breathe", "faint", "fainted", "unconscious", "severe pain"]) {
      expect(SERIOUS_WORDS_EN).toContain(w);
    }
    for (const w of ["цээж өвд", "амьсгал давс", "ухаан алд", "ухаан балр", "хүчтэй өвд"]) {
      expect(SERIOUS_WORDS_MN).toContain(w);
    }
  });

  it.each([
    "I had chest pain last night",
    "CHEST PAIN",
    "Chest   pain after exercise",
    "I can't breathe well",
    "I CAN’T BREATHE",
    "cannot breathe properly",
    "I felt faint",
    "I fainted in the module",
    "he was unconscious",
    "severe pain in my back",
  ])("fires in English for %j on the symptom note", (text) => {
    const flags = flagsFor(normalToday({ symptom_note: text }));
    expect(flags.map((f) => f.rule)).toEqual(["SERIOUS_SYMPTOM_WORD"]);
    expect(flags[0].keys).toEqual(["symptom_note"]);
  });

  it.each([
    "Цээж өвдөөд байна",
    "ЦЭЭЖ ӨВДӨЖ БАЙНА",
    "амьсгал давчдаад байсан",
    "Ухаан алдсан",
    "ухаан балартлаа",
    "хүчтэй өвдөлт мэдэрлээ",
  ])("fires in Mongolian for %j", (text) => {
    expect(rules(normalToday({ day_note: text }))).toEqual(["SERIOUS_SYMPTOM_WORD"]);
  });

  it("scans both note keys and reports which one matched", () => {
    const both = flagsFor(normalToday({ symptom_note: "faint", day_note: "chest pain" }));
    expect(both).toHaveLength(1);
    expect(both[0].keys).toEqual(["symptom_note", "day_note"]);
    const dayOnly = flagsFor(normalToday({ day_note: "severe pain" }));
    expect(dayOnly[0].keys).toEqual(["day_note"]);
  });

  it("matches whole English words only", () => {
    expect(findSeriousWords("a faintly audible hum")).toEqual([]);
    expect(findSeriousWords("faint, then fine")).toEqual(["faint"]);
    expect(rules(normalToday({ symptom_note: "faintly audible hum from the fan" }))).toEqual([]);
  });

  it("does not fire on unrelated words in either language", () => {
    expect(findSeriousWords("had a quiet day, a little tired")).toEqual([]);
    expect(findSeriousWords("Бага зэрэг ядарсан")).toEqual([]);
    expect(findSeriousWords("")).toEqual([]);
  });

  it("does not scan numeric keys or non-string values", () => {
    expect(rules(normalToday({ symptom_note: 5 }))).toEqual([]);
  });
});

describe("red flags: wording", () => {
  const everything = flagsFor(
    normalToday({
      heart_rate: 130,
      symptom_headache: 1,
      vision_check: 2,
      symptom_note: "chest pain",
    }),
  );

  it("raises all three rules together when all triggers are present", () => {
    expect(everything.map((f) => f.rule)).toEqual(["VITAL_RED", "HEADACHE_PLUS_VISION", "SERIOUS_SYMPTOM_WORD"]);
  });

  it("is calm: says the crew medical officer and ground are informed, in both languages, never 'diagnosis'", () => {
    for (const flag of everything) {
      expect(flag.text.en.length).toBeGreaterThan(20);
      expect(flag.text.mn.length).toBeGreaterThan(20);
      expect(flag.text.en).toMatch(/crew medical officer/i);
      expect(flag.text.en).toMatch(/ground/i);
      expect(flag.text.mn).toContain("эмнэлгийн офицер");
      expect(flag.text.mn).toMatch(/газрын хяналт/);
      for (const s of collectStrings(flag.text)) expect(s).not.toMatch(/diagnos|онош/i);
      expect(flag.text.en).not.toMatch(/emergency|danger|critical|!/i);
    }
  });

  it("names the readings that triggered VITAL_RED, with units", () => {
    const vital = everything.find((f) => f.rule === "VITAL_RED")!;
    expect(vital.text.en).toContain("Heart rate 130 bpm");
    expect(vital.text.en).toContain("Vision check Clearly blurred");
  });
});
