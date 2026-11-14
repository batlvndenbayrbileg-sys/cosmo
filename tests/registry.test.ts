import { describe, expect, it } from "vitest";
import { KPI_KEYS, QUESTION_IDS, type KpiKey, type QuestionId } from "@/lib/types";
import {
  CHECKIN_TARGET_KEYS,
  KPI_DEFS,
  NUMERIC_KEYS,
  QUESTIONS,
  formatValue,
  getKpi,
  getQuestion,
  nextQuestion,
  questionFilled,
  rangeText,
  validateValue,
} from "@/lib/kpi/registry";

describe("registry: shape", () => {
  it("defines exactly the 16 stored keys, each under its own name", () => {
    expect(Object.keys(KPI_DEFS).sort()).toEqual([...KPI_KEYS].sort());
    for (const key of KPI_KEYS) expect(getKpi(key).key).toBe(key);
  });

  it("has 12 questions in the documented order", () => {
    expect(QUESTIONS).toHaveLength(12);
    expect(QUESTIONS.map((q) => q.id)).toEqual([...QUESTION_IDS]);
    expect(QUESTIONS.map((q) => q.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(QUESTIONS.map((q) => q.slot)).toEqual([
      "morning", "morning", "morning", "morning", "morning", "morning",
      "midday", "midday", "afternoon", "afternoon", "evening", "evening",
    ]);
    expect(getQuestion("vision").id).toBe("vision");
  });

  it("covers every key with exactly one question, and each key names that question", () => {
    const seen: KpiKey[] = QUESTIONS.flatMap((q) => q.keys);
    expect([...seen].sort()).toEqual([...KPI_KEYS].sort());
    for (const q of QUESTIONS) for (const k of q.keys) expect(KPI_DEFS[k].question).toBe(q.id);
    for (const q of QUESTIONS) for (const k of q.keys) expect(KPI_DEFS[k].slot).toBe(q.slot);
  });

  it("has non-empty prompts in both languages", () => {
    for (const q of QUESTIONS) {
      expect(q.prompts.en.length).toBeGreaterThan(5);
      expect(q.prompts.mn.length).toBeGreaterThan(5);
    }
  });

  it("splits the keys into 14 non-text keys and 2 text keys", () => {
    expect(NUMERIC_KEYS).toHaveLength(14);
    expect(NUMERIC_KEYS).not.toContain("symptom_note");
    expect(NUMERIC_KEYS).not.toContain("day_note");
    expect(CHECKIN_TARGET_KEYS).toEqual(NUMERIC_KEYS);
  });

  it("keeps the hard ranges from the question table", () => {
    const ranges: Array<[KpiKey, number, number]> = [
      ["sleep_hours", 0, 14],
      ["mood", 1, 5],
      ["bp_systolic", 70, 220],
      ["bp_diastolic", 40, 140],
      ["heart_rate", 30, 200],
      ["temperature_c", 34, 42],
      ["glucose_mgdl", 40, 400],
      ["water_ml", 0, 6000],
      ["exercise_min", 0, 240],
      ["vision_check", 0, 2],
      ["workload", 1, 5],
    ];
    for (const [key, min, max] of ranges) {
      expect([key, KPI_DEFS[key].min, KPI_DEFS[key].max]).toEqual([key, min, max]);
    }
  });

  it("keeps the axis, hazard and sdFloor assignments from section 1.1", () => {
    expect(KPI_DEFS.symptom_nausea.axis).toBe("metabolic");
    expect(KPI_DEFS.exercise_min.axis).toBe("musculoskeletal");
    expect(KPI_DEFS.symptom_note.axis).toBeNull();
    expect(KPI_DEFS.sleep_hours.hazards).toEqual(["isolation_confinement"]);
    expect(KPI_DEFS.temperature_c.hazards).toEqual(["hostile_closed_environment"]);
    expect(KPI_DEFS.water_ml.maxLevel).toBe("yellow");
    expect(KPI_DEFS.exercise_min.maxLevel).toBe("yellow");
    expect(KPI_DEFS.workload.maxLevel).toBe("yellow");
    expect(KPI_DEFS.vision_check.maxLevel).toBeUndefined();
    expect(KPI_DEFS.sleep_hours.sdFloor).toBe(0.3);
    expect(KPI_DEFS.water_ml.sdFloor).toBe(150);
    expect(KPI_DEFS.vision_check.categories?.[2].en).toBe("Clearly blurred");
  });
});

describe("registry: validateValue", () => {
  it("accepts numbers and numeric strings, in range", () => {
    expect(validateValue("heart_rate", 72)).toEqual({ ok: true, value: 72 });
    expect(validateValue("heart_rate", "72")).toEqual({ ok: true, value: 72 });
    expect(validateValue("temperature_c", "36,6")).toEqual({ ok: true, value: 36.6 });
    expect(validateValue("sleep_hours", 5.5)).toEqual({ ok: true, value: 5.5 });
  });

  it("accepts both hard-range ends and rejects just outside", () => {
    expect(validateValue("heart_rate", 30).ok).toBe(true);
    expect(validateValue("heart_rate", 200).ok).toBe(true);
    expect(validateValue("heart_rate", 29)).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("sleep_hours", 14.1)).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("sleep_hours", -0.5)).toMatchObject({ ok: false, reason: "range" });
  });

  it("rejects 301 bpm with a bilingual range message", () => {
    const r = validateValue("heart_rate", 301);
    expect(r).toMatchObject({ ok: false, reason: "range" });
    if (!r.ok) {
      expect(r.message.en).toMatch(/30/);
      expect(r.message.en).toMatch(/200/);
      expect(r.message.mn.length).toBeGreaterThan(5);
    }
  });

  it("rejects non-numbers, empty strings, NaN, Infinity, null and booleans for numeric keys", () => {
    for (const bad of ["abc", "", "  ", NaN, Infinity, null, undefined, true, {}, [], "7 hours"]) {
      expect(validateValue("heart_rate", bad)).toMatchObject({ ok: false, reason: "type" });
    }
  });

  it("enforces integer-ness for integer, scale and category keys but not for decimals", () => {
    expect(validateValue("heart_rate", 72.5)).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("mood", 3.5)).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("water_ml", 1500.5)).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("temperature_c", 36.65).ok).toBe(true);
    expect(validateValue("heart_rate", 72.0)).toEqual({ ok: true, value: 72 });
  });

  it("reads thousands-grouped whole numbers as thousands, not as decimals", () => {
    expect(validateValue("water_ml", "2,000")).toEqual({ ok: true, value: 2000 });
    expect(validateValue("water_ml", "1.500")).toEqual({ ok: true, value: 1500 });
    expect(validateValue("water_ml", "1,000")).toEqual({ ok: true, value: 1000 });
    expect(validateValue("water_ml", "2.000")).toEqual({ ok: true, value: 2000 });
    expect(validateValue("water_ml", " 3,000 ")).toEqual({ ok: true, value: 3000 });
    // grouped but out of the 0-6000 hard range -> range error, never silently shrunk
    expect(validateValue("water_ml", "12,000")).toMatchObject({ ok: false, reason: "range" });
    // a real decimal on a whole-number key is still rejected
    expect(validateValue("water_ml", "2,5")).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("water_ml", "2300.5")).toMatchObject({ ok: false, reason: "type" });
    // decimal keys keep the decimal-comma reading
    expect(validateValue("temperature_c", "36,6")).toEqual({ ok: true, value: 36.6 });
    expect(validateValue("sleep_hours", "7.500")).toEqual({ ok: true, value: 7.5 });
  });

  it("accepts yes/no words and booleans for boolean keys, in both languages", () => {
    for (const yes of ["yes", "Yes", " YES ", "тийм", "Тийм", true, 1, "1"]) {
      expect(validateValue("symptom_headache", yes)).toEqual({ ok: true, value: 1 });
    }
    for (const no of ["no", "No", "үгүй", "Үгүй", false, 0, "0"]) {
      expect(validateValue("symptom_dizziness", no)).toEqual({ ok: true, value: 0 });
    }
  });

  it("rejects other values for boolean keys", () => {
    expect(validateValue("symptom_nausea", 2)).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("symptom_nausea", "maybe")).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("symptom_nausea", null)).toMatchObject({ ok: false, reason: "type" });
  });

  it("does not accept yes/no words for non-boolean keys", () => {
    expect(validateValue("heart_rate", "yes")).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("mood", "no")).toMatchObject({ ok: false, reason: "type" });
  });

  it("accepts the three vision category codes only", () => {
    for (const code of [0, 1, 2]) expect(validateValue("vision_check", code)).toEqual({ ok: true, value: code });
    expect(validateValue("vision_check", "1")).toEqual({ ok: true, value: 1 });
    expect(validateValue("vision_check", 3)).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("vision_check", -1)).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("vision_check", 1.5)).toMatchObject({ ok: false, reason: "type" });
  });

  it("accepts the vision category labels as words", () => {
    expect(validateValue("vision_check", "clear")).toEqual({ ok: true, value: 0 });
    expect(validateValue("vision_check", "Slightly blurred")).toEqual({ ok: true, value: 1 });
    expect(validateValue("vision_check", "Clearly blurred")).toEqual({ ok: true, value: 2 });
  });

  it("enforces the 1-5 scales", () => {
    expect(validateValue("mood", 1).ok).toBe(true);
    expect(validateValue("mood", 5).ok).toBe(true);
    expect(validateValue("mood", 0)).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("workload", 6)).toMatchObject({ ok: false, reason: "range" });
  });

  it("accepts non-empty text up to 500 characters on the text keys and trims it", () => {
    expect(validateValue("symptom_note", "  slight pressure behind the eyes ")).toEqual({
      ok: true,
      value: "slight pressure behind the eyes",
    });
    expect(validateValue("day_note", "x".repeat(500)).ok).toBe(true);
    expect(validateValue("day_note", "x".repeat(501))).toMatchObject({ ok: false, reason: "range" });
    expect(validateValue("day_note", "   ")).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("day_note", "")).toMatchObject({ ok: false, reason: "type" });
    expect(validateValue("day_note", 42)).toMatchObject({ ok: false, reason: "type" });
  });
});

describe("registry: formatValue and rangeText", () => {
  it("formats values with units, labels and yes/no", () => {
    expect(formatValue("bp_systolic", 124, "en")).toBe("124 mmHg");
    expect(formatValue("sleep_hours", 5.5, "en")).toBe("5.5 h");
    expect(formatValue("sleep_hours", 5.5, "mn")).toBe("5.5 цаг");
    expect(formatValue("temperature_c", 36.7, "en")).toBe("36.7 °C");
    expect(formatValue("water_ml", 1800, "en")).toBe("1800 ml");
    expect(formatValue("symptom_headache", 1, "en")).toBe("Yes");
    expect(formatValue("symptom_headache", 0, "en")).toBe("No");
    expect(formatValue("symptom_headache", 1, "mn")).toBe("Тийм");
    expect(formatValue("vision_check", 1, "en")).toBe("Slightly blurred");
    expect(formatValue("vision_check", 0, "mn")).toBe("Тод");
    expect(formatValue("mood", 4, "en")).toBe("4/5");
    expect(formatValue("day_note", "all fine", "en")).toBe("all fine");
  });

  it("builds a rangeText with the demo-parameter label", () => {
    expect(rangeText("heart_rate")).toEqual({
      en: "Normal 50-90 bpm · demo parameter",
      mn: "Хэвийн 50-90 удаа/мин · демо параметр",
    });
    expect(rangeText("sleep_hours")?.en).toBe("Normal ≥ 7 h · demo parameter");
    expect(rangeText("temperature_c")?.en).toBe("Normal 36-37.5 °C · demo parameter");
    expect(rangeText("bp_systolic")?.en).toBe("Normal 100-129 mmHg · demo parameter");
    expect(rangeText("mood")?.en).toBe("Normal 3-5 · demo parameter");
    expect(rangeText("workload")?.en).toBe("Normal 1-3 · demo parameter");
    expect(rangeText("symptom_headache")?.en).toBe("Normal: No · demo parameter");
    expect(rangeText("vision_check")?.en).toBe("Normal: Clear · demo parameter");
  });

  it("gives every non-text key a demo-parameter range and the text keys none", () => {
    for (const key of NUMERIC_KEYS) {
      const r = rangeText(key);
      expect(r, key).not.toBeNull();
      expect(r?.en).toContain("demo parameter");
      expect(r?.mn).toContain("демо параметр");
    }
    expect(rangeText("symptom_note")).toBeNull();
    expect(rangeText("day_note")).toBeNull();
  });
});

describe("registry: question flow", () => {
  it("starts at sleep and walks the questions in order as keys get filled", () => {
    const filled = new Set<KpiKey>();
    const skipped = new Set<QuestionId>();
    const order: QuestionId[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const q = nextQuestion(filled, skipped);
      if (!q) break;
      order.push(q.id);
      // answering a question fills its required keys
      for (const k of q.keys) if (k !== "symptom_note" && k !== "day_note") filled.add(k);
      if (q.id === "day_note") skipped.add(q.id);
    }
    expect(order).toEqual([...QUESTION_IDS]);
    expect(nextQuestion(filled, skipped)).toBeNull();
  });

  it("skips questions whose keys are all filled", () => {
    const filled = new Set<KpiKey>(["sleep_hours", "mood"]);
    expect(nextQuestion(filled, new Set())?.id).toBe("symptoms");
  });

  it("skips explicitly skipped questions", () => {
    const filled = new Set<KpiKey>(["sleep_hours"]);
    expect(nextQuestion(filled, new Set<QuestionId>(["mood"]))?.id).toBe("symptoms");
  });

  it("does not require the optional symptom note", () => {
    const q = getQuestion("symptoms");
    expect(questionFilled(q, new Set<KpiKey>(["symptom_headache", "symptom_dizziness", "symptom_nausea"]))).toBe(true);
    expect(questionFilled(q, new Set<KpiKey>(["symptom_headache", "symptom_dizziness"]))).toBe(false);
  });

  it("requires both blood-pressure keys", () => {
    const q = getQuestion("blood_pressure");
    expect(questionFilled(q, new Set<KpiKey>(["bp_systolic"]))).toBe(false);
    expect(questionFilled(q, new Set<KpiKey>(["bp_systolic", "bp_diastolic"]))).toBe(true);
  });

  it("never blocks on the optional day note: a skip ends the flow", () => {
    const filled = new Set<KpiKey>(KPI_KEYS.filter((k) => k !== "day_note" && k !== "symptom_note"));
    expect(nextQuestion(filled, new Set())?.id).toBe("day_note");
    expect(nextQuestion(filled, new Set<QuestionId>(["day_note"]))).toBeNull();
    expect(questionFilled(getQuestion("day_note"), new Set<KpiKey>(["day_note"]))).toBe(true);
  });

  it("returns null when everything is filled", () => {
    expect(nextQuestion(new Set<KpiKey>(KPI_KEYS), new Set())).toBeNull();
  });
});
