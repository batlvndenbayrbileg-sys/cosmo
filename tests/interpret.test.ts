import { describe, expect, it } from "vitest";
import { KPI_DEFS, getQuestion } from "@/lib/kpi/registry";
import type { KpiKey, Lang, MeasurementValue, QuestionId } from "@/lib/types";
import {
  interpretAnswer,
  interpretCorrection,
  interpretOpportunistic,
  interpretStart,
  interpretYesNo,
  type InterpretResult,
} from "@/server/agent/interpret";

type Values = Partial<Record<KpiKey, MeasurementValue>>;

function run(id: QuestionId, text: string, lang: Lang = "en"): InterpretResult {
  return interpretAnswer(getQuestion(id), text, lang);
}

function valuesOf(result: InterpretResult): Values {
  const out: Values = {};
  for (const r of result.records) out[r.key] = r.value;
  return out;
}

/** table row: [utterance, expected values] */
type Row = [string, Values];

function suite(id: QuestionId, lang: Lang, rows: Row[]): void {
  describe(`${id} (${lang})`, () => {
    it.each(rows)("%s", (text, expected) => {
      const result = run(id, text, lang);
      expect(valuesOf(result)).toEqual(expected);
      expect(result.unclear).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.rejectedKeys).toEqual([]);
    });
  });
}

const NO_SYMPTOMS: Values = { symptom_headache: 0, symptom_dizziness: 0, symptom_nausea: 0 };

/* ───────────── sleep ───────────── */

suite("sleep", "en", [
  ["I slept seven hours", { sleep_hours: 7 }],
  ["about six and a half hours", { sleep_hours: 6.5 }],
  ["5.5 hours", { sleep_hours: 5.5 }],
  ["8", { sleep_hours: 8 }],
  ["I got six hours and thirty minutes", { sleep_hours: 6.5 }],
  ["around 7,5 hours", { sleep_hours: 7.5 }],
  ["I only slept four hours last night", { sleep_hours: 4 }],
  ["I slept for an hour", { sleep_hours: 1 }],
  ["Seven and a half", { sleep_hours: 7.5 }],
]);

suite("sleep", "mn", [
  ["Долоон цаг унтсан", { sleep_hours: 7 }],
  ["6 цаг унтсан", { sleep_hours: 6 }],
  ["долоо хагас", { sleep_hours: 7.5 }],
  ["Тав хагас цаг унтлаа", { sleep_hours: 5.5 }],
  ["найман цаг", { sleep_hours: 8 }],
  ["зургаан цаг гучин минут", { sleep_hours: 6.5 }],
  ["7 цаг хагас унтсан", { sleep_hours: 7.5 }],
  ["нэг хагас цаг", { sleep_hours: 1.5 }],
]);

describe("sleep: edge cases", () => {
  it("records no sleep at all as 0 with the words-only confidence", () => {
    const r = run("sleep", "I didn't sleep at all");
    expect(valuesOf(r)).toEqual({ sleep_hours: 0 });
    expect(r.records[0].confidence).toBe(0.6);
  });

  it("rejects an impossible number of hours", () => {
    const r = run("sleep", "twenty hours");
    expect(r.records).toEqual([]);
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["sleep_hours"]);
  });

  it("clock times are not a duration", () => {
    for (const text of ["I slept from 11 to 6", "went to bed at 11 pm"]) {
      const r = run("sleep", text);
      expect(r.records).toEqual([]);
      expect(r.reason).toBe("ambiguous");
    }
  });

  it("uses the unit from the registry and a verbatim source text", () => {
    const [rec] = run("sleep", "I slept about 7 hours last night").records;
    expect(rec.unit).toBe("h");
    expect(rec.sourceText).toBe("7 hours");
    expect(rec.confidence).toBe(0.9);
  });

  it("is less sure when several durations are spoken", () => {
    const [rec] = run("sleep", "I slept 6 hours, two hours less than yesterday").records;
    expect(rec.value).toBe(6);
    expect(rec.confidence).toBe(0.7);
  });
});

/* ───────────── mood ───────────── */

suite("mood", "en", [
  ["four", { mood: 4 }],
  ["I'd say 3", { mood: 3 }],
  ["great", { mood: 5 }],
  ["pretty good", { mood: 4 }],
  ["terrible", { mood: 1 }],
  ["so-so", { mood: 3 }],
  ["not good", { mood: 2 }],
  ["mood is 5", { mood: 5 }],
  ["three out of five", { mood: 3 }],
  ["feeling low today", { mood: 2 }],
  ["okay", { mood: 3 }],
  ["not bad", { mood: 4 }],
]);

suite("mood", "mn", [
  ["дөрөв", { mood: 4 }],
  ["4 байна", { mood: 4 }],
  ["маш сайн", { mood: 5 }],
  ["сайн", { mood: 4 }],
  ["боломжийн", { mood: 3 }],
  ["муу", { mood: 2 }],
  ["маш муу", { mood: 1 }],
  ["гурав", { mood: 3 }],
  ["тийм ч сайн биш", { mood: 2 }],
  ["1-ээс 5 хүртэл дөрөв", { mood: 4 }],
]);

describe("mood: edge cases", () => {
  it("rejects a number outside 1-5", () => {
    const r = run("mood", "mood is 7");
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["mood"]);
  });

  it("rejects a half point as a wrong type", () => {
    const r = run("mood", "three and a half");
    expect(r.reason).toBe("type");
    expect(r.rejectedKeys).toEqual(["mood"]);
  });

  it("prefers the digit over the word and trusts it more", () => {
    const [rec] = run("mood", "good, I'd say 5").records;
    expect(rec.value).toBe(5);
    expect(rec.confidence).toBe(0.9);
  });

  it("treats opposite mood words as ambiguous", () => {
    const r = run("mood", "great but also terrible");
    expect(r.records).toEqual([]);
    expect(r.reason).toBe("ambiguous");
  });

  it("caps confidence at 0.6 when only words were heard", () => {
    expect(run("mood", "great").records[0].confidence).toBe(0.6);
  });
});

/* ───────────── symptoms ───────────── */

suite("symptoms", "en", [
  ["No", NO_SYMPTOMS],
  ["none", NO_SYMPTOMS],
  ["No symptoms", NO_SYMPTOMS],
  ["nothing at all", NO_SYMPTOMS],
  ["no headache, dizziness or nausea", NO_SYMPTOMS],
  ["just a mild headache", { ...NO_SYMPTOMS, symptom_headache: 1 }],
  ["I feel dizzy and a bit nauseous", { ...NO_SYMPTOMS, symptom_dizziness: 1, symptom_nausea: 1 }],
  ["No headache but I feel nauseous", { ...NO_SYMPTOMS, symptom_nausea: 1 }],
  ["no headache, but a bit dizzy", { ...NO_SYMPTOMS, symptom_dizziness: 1 }],
  ["I have a headache and dizziness, no nausea", { symptom_headache: 1, symptom_dizziness: 1, symptom_nausea: 0 }],
  ["yes, a headache", { ...NO_SYMPTOMS, symptom_headache: 1 }],
  ["No, but I feel a little dizzy", { ...NO_SYMPTOMS, symptom_dizziness: 1 }],
]);

suite("symptoms", "mn", [
  ["Үгүй", NO_SYMPTOMS],
  ["байхгүй", NO_SYMPTOMS],
  ["юу ч үгүй", NO_SYMPTOMS],
  ["Толгой өвдөж байна", { ...NO_SYMPTOMS, symptom_headache: 1 }],
  ["Толгой эргэж, дотор муухайрч байна", { ...NO_SYMPTOMS, symptom_dizziness: 1, symptom_nausea: 1 }],
  ["Толгой өвдөхгүй, толгой эргэхгүй, дотор муухайрахгүй", NO_SYMPTOMS],
  ["Толгой өвдөх, толгой эргэх, дотор муухайрах зүйл байхгүй", NO_SYMPTOMS],
  ["Толгой өвдөхгүй ч дотор муухайрч байна", { ...NO_SYMPTOMS, symptom_nausea: 1 }],
  ["Үгүй, харин жаахан толгой эргэж байна", { ...NO_SYMPTOMS, symptom_dizziness: 1 }],
]);

describe("symptoms: notes and unclear cases", () => {
  it("keeps the leftover description as symptom_note", () => {
    const r = run("symptoms", "I have a headache since this morning, it started after the workout");
    expect(valuesOf(r)).toEqual({
      ...NO_SYMPTOMS,
      symptom_headache: 1,
      symptom_note: "I have a headache since this morning, it started after the workout",
    });
  });

  it("drops the clauses that only repeat the three symptoms", () => {
    const r = run("symptoms", "No headache, but my back hurts since yesterday");
    expect(valuesOf(r)).toEqual({ ...NO_SYMPTOMS, symptom_note: "my back hurts since yesterday" });
  });

  it("records a serious complaint as a note even without the three symptoms", () => {
    const r = run("symptoms", "chest pain");
    expect(valuesOf(r)).toEqual({ ...NO_SYMPTOMS, symptom_note: "chest pain" });
  });

  it("a denied complaint is never a note (it must not raise the serious-word alert)", () => {
    expect(valuesOf(run("symptoms", "no pain"))).toEqual(NO_SYMPTOMS);
    expect(valuesOf(run("symptoms", "No, I don't have chest pain"))).toEqual(NO_SYMPTOMS);
    expect(valuesOf(run("symptoms", "headache, but no chest pain"))).toEqual({ ...NO_SYMPTOMS, symptom_headache: 1 });
    expect(valuesOf(run("symptoms", "Цээж өвдөхгүй", "mn"))).toEqual(NO_SYMPTOMS);
  });

  it("keeps a Mongolian note", () => {
    const r = run("symptoms", "Цээж өвдөж байна", "mn");
    expect(valuesOf(r)).toEqual({ ...NO_SYMPTOMS, symptom_note: "Цээж өвдөж байна" });
  });

  it("does not add a note for a bare symptom word", () => {
    expect(run("symptoms", "a headache").records.map((x) => x.key)).not.toContain("symptom_note");
  });

  it("a bare yes does not say which symptom", () => {
    const r = run("symptoms", "yes");
    expect(r.records).toEqual([]);
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("ambiguous");
  });

  it("an unrelated sentence is unclear", () => {
    const r = run("symptoms", "let me think about it");
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("no_value");
  });

  it("does not let a leading No negate a later symptom", () => {
    expect(valuesOf(run("symptoms", "no I have a headache")).symptom_headache).toBe(1);
  });

  it("uses a verbatim source text and the words-only confidence", () => {
    const text = "just a mild headache";
    for (const rec of run("symptoms", text).records.filter((x) => x.key !== "symptom_note")) {
      expect(rec.confidence).toBe(0.6);
      expect(text.includes(rec.sourceText)).toBe(true);
    }
  });
});

/* ───────────── blood pressure ───────────── */

const BP = (s: number, d: number): Values => ({ bp_systolic: s, bp_diastolic: d });

suite("blood_pressure", "en", [
  ["120 over 80", BP(120, 80)],
  ["120/80", BP(120, 80)],
  ["one twenty over eighty", BP(120, 80)],
  ["my pressure is 118 over 76", BP(118, 76)],
  ["a hundred and thirty over eighty five", BP(130, 85)],
  ["125 over 82 mmHg", BP(125, 82)],
  ["one eighteen over seventy six", BP(118, 76)],
  ["blood pressure 121 80", BP(121, 80)],
]);

suite("blood_pressure", "mn", [
  ["120 дээр 80", BP(120, 80)],
  ["даралт 120 80", BP(120, 80)],
  ["даралт 118 76", BP(118, 76)],
  ["нэг зуун хорин дээр наян", BP(120, 80)],
  ["цусны даралт 130 дээр 85", BP(130, 85)],
  ["зуун хорин наян", BP(120, 80)],
  ["124 дээр 82", BP(124, 82)],
]);

describe("blood pressure: edge cases", () => {
  it("rejects an out-of-range systolic and records nothing", () => {
    const r = run("blood_pressure", "300 over 80");
    expect(r.records).toEqual([]);
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["bp_systolic"]);
  });

  it("rejects both keys when both are out of range", () => {
    const r = run("blood_pressure", "250 over 20");
    expect(r.rejectedKeys).toEqual(["bp_systolic", "bp_diastolic"]);
  });

  it("a single number is ambiguous", () => {
    const r = run("blood_pressure", "120");
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("ambiguous");
  });

  it("requires the systolic number to be larger", () => {
    const r = run("blood_pressure", "80 over 120");
    expect(r.reason).toBe("ambiguous");
    expect(r.records).toEqual([]);
  });

  it("records the pair with confidence 0.9 and one shared source text", () => {
    const r = run("blood_pressure", "my pressure is 118 over 76 today");
    expect(r.records.map((x) => [x.key, x.unit, x.confidence, x.sourceText])).toEqual([
      ["bp_systolic", "mmHg", 0.9, "118 over 76"],
      ["bp_diastolic", "mmHg", 0.9, "118 over 76"],
    ]);
  });

  it("is less sure when extra numbers are spoken", () => {
    const r = run("blood_pressure", "120 over 80 at 8 o'clock");
    expect(valuesOf(r)).toEqual(BP(120, 80));
    expect(r.records[0].confidence).toBe(0.7);
  });
});

/* ───────────── heart rate ───────────── */

suite("heart_rate", "en", [
  ["72", { heart_rate: 72 }],
  ["my pulse is 72", { heart_rate: 72 }],
  ["seventy two", { heart_rate: 72 }],
  ["68 bpm", { heart_rate: 68 }],
  ["about 80 beats per minute", { heart_rate: 80 }],
  ["heart rate sixty five", { heart_rate: 65 }],
]);

suite("heart_rate", "mn", [
  ["пульс далан хоёр", { heart_rate: 72 }],
  ["72", { heart_rate: 72 }],
  ["пульс 68", { heart_rate: 68 }],
  ["далан таван", { heart_rate: 75 }],
  ["жаран найм", { heart_rate: 68 }],
  ["зүрхний цохилт 70", { heart_rate: 70 }],
]);

describe("heart rate: edge cases", () => {
  it("rejects 301 bpm as out of range", () => {
    const r = run("heart_rate", "301 bpm");
    expect(r.records).toEqual([]);
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["heart_rate"]);
  });

  it("rejects a too-low pulse", () => {
    expect(run("heart_rate", "pulse 12").rejectedKeys).toEqual(["heart_rate"]);
  });

  it("rejects a decimal pulse as a wrong type", () => {
    const r = run("heart_rate", "72.5");
    expect(r.reason).toBe("type");
    expect(r.rejectedKeys).toEqual(["heart_rate"]);
  });

  it("ignores durations that are not the pulse", () => {
    expect(valuesOf(run("heart_rate", "after 20 minutes it was 70"))).toEqual({ heart_rate: 70 });
  });
});

/* ───────────── temperature ───────────── */

suite("temperature", "en", [
  ["36.6", { temperature_c: 36.6 }],
  ["thirty six point six", { temperature_c: 36.6 }],
  ["36 point 8", { temperature_c: 36.8 }],
  ["37", { temperature_c: 37 }],
  ["my temperature is 36.7 degrees", { temperature_c: 36.7 }],
  ["98.6 degrees Fahrenheit", { temperature_c: 37 }],
  ["36 6", { temperature_c: 36.6 }],
]);

suite("temperature", "mn", [
  ["36,6", { temperature_c: 36.6 }],
  ["гучин зургаа цэг тав", { temperature_c: 36.5 }],
  ["температур гучин зургаа цэг тав", { temperature_c: 36.5 }],
  ["гучин долоо", { temperature_c: 37 }],
  ["температур 36.8", { temperature_c: 36.8 }],
  ["гучин зургаа цэг зургаа", { temperature_c: 36.6 }],
]);

describe("temperature: edge cases", () => {
  it("rejects 50 degrees", () => {
    const r = run("temperature", "50");
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["temperature_c"]);
  });

  it("rejects a Celsius-looking 98 (no unit, no conversion)", () => {
    expect(run("temperature", "98").rejectedKeys).toEqual(["temperature_c"]);
  });

  it("converts an explicit Fahrenheit reading", () => {
    expect(valuesOf(run("temperature", "99 degrees F"))).toEqual({ temperature_c: 37.2 });
  });

  it("is less sure about a merged '36 6'", () => {
    expect(run("temperature", "36 6").records[0].confidence).toBe(0.7);
  });
});

/* ───────────── glucose ───────────── */

suite("glucose", "en", [
  ["98", { glucose_mgdl: 98 }],
  ["glucose is 105", { glucose_mgdl: 105 }],
  ["ninety eight", { glucose_mgdl: 98 }],
  ["110 mg/dL", { glucose_mgdl: 110 }],
  ["sugar 92", { glucose_mgdl: 92 }],
  ["5.4 mmol", { glucose_mgdl: 97 }],
]);

suite("glucose", "mn", [
  ["цусны сахар 98", { glucose_mgdl: 98 }],
  ["ерэн найм", { glucose_mgdl: 98 }],
  ["сахар зуун тав", { glucose_mgdl: 105 }],
  ["98 мг", { glucose_mgdl: 98 }],
  ["сахар 100", { glucose_mgdl: 100 }],
]);

describe("glucose: edge cases", () => {
  it("rejects 20 and 800", () => {
    expect(run("glucose", "20").reason).toBe("out_of_range");
    expect(run("glucose", "800").rejectedKeys).toEqual(["glucose_mgdl"]);
  });
});

/* ───────────── water ───────────── */

suite("water", "en", [
  ["1800", { water_ml: 1800 }],
  ["2 litres", { water_ml: 2000 }],
  ["1.5 l", { water_ml: 1500 }],
  ["two thousand", { water_ml: 2000 }],
  ["about 2 liters", { water_ml: 2000 }],
  ["a litre and a half", { water_ml: 1500 }],
  ["1800 ml", { water_ml: 1800 }],
  ["half a litre", { water_ml: 500 }],
  ["1 litre 500 ml", { water_ml: 1500 }],
]);

suite("water", "mn", [
  ["ус 1800", { water_ml: 1800 }],
  ["нэг хагас литр", { water_ml: 1500 }],
  ["ус нэг хагас литр", { water_ml: 1500 }],
  ["2 литр", { water_ml: 2000 }],
  ["1500 мл", { water_ml: 1500 }],
  ["хоёр литр", { water_ml: 2000 }],
  ["хагас литр", { water_ml: 500 }],
]);

describe("water: edge cases", () => {
  it("rejects 9000 ml", () => {
    const r = run("water", "9000");
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["water_ml"]);
  });

  it("reads a bare small number as litres, with lower confidence", () => {
    const [rec] = run("water", "2").records;
    expect(rec.value).toBe(2000);
    expect(rec.confidence).toBe(0.7);
  });

  it("a bare 50 could be anything: ambiguous", () => {
    expect(run("water", "50").reason).toBe("ambiguous");
  });

  it("glasses and bottles have no known size: ambiguous, never guessed", () => {
    const r = run("water", "8 glasses");
    expect(r.records).toEqual([]);
    expect(r.reason).toBe("ambiguous");
  });
});

/* ───────────── exercise ───────────── */

suite("exercise", "en", [
  ["40", { exercise_min: 40 }],
  ["40 minutes", { exercise_min: 40 }],
  ["an hour", { exercise_min: 60 }],
  ["half an hour", { exercise_min: 30 }],
  ["forty five minutes", { exercise_min: 45 }],
  ["none", { exercise_min: 0 }],
  ["one and a half hours", { exercise_min: 90 }],
  ["an hour and a half", { exercise_min: 90 }],
  ["I didn't exercise today", { exercise_min: 0 }],
  ["1 hour 15 minutes", { exercise_min: 75 }],
]);

suite("exercise", "mn", [
  ["дөчин минут", { exercise_min: 40 }],
  ["нэг цаг", { exercise_min: 60 }],
  ["30 минут", { exercise_min: 30 }],
  ["хагас цаг", { exercise_min: 30 }],
  ["хийгээгүй", { exercise_min: 0 }],
  ["нэг цаг хагас", { exercise_min: 90 }],
  ["Үгүй", { exercise_min: 0 }],
]);

describe("exercise: edge cases", () => {
  it("rejects more than four hours", () => {
    const r = run("exercise", "500 minutes");
    expect(r.reason).toBe("out_of_range");
    expect(r.rejectedKeys).toEqual(["exercise_min"]);
  });

  it("I don't know is unclear, not zero", () => {
    const r = run("exercise", "I don't know");
    expect(r.unclear).toBe(true);
    expect(r.reason).toBe("no_value");
    expect(r.records).toEqual([]);
  });
});

/* ───────────── vision ───────────── */

suite("vision", "en", [
  ["sharp", { vision_check: 0 }],
  ["clear", { vision_check: 0 }],
  ["slightly blurred", { vision_check: 1 }],
  ["a bit blurry", { vision_check: 1 }],
  ["a little fuzzy", { vision_check: 1 }],
  ["blurry", { vision_check: 2 }],
  ["fuzzy", { vision_check: 2 }],
  ["clearly blurred", { vision_check: 2 }],
  ["it's fine", { vision_check: 0 }],
  ["not blurred at all", { vision_check: 0 }],
  ["slightly", { vision_check: 1 }],
]);

suite("vision", "mn", [
  ["тод", { vision_check: 0 }],
  ["хэвийн", { vision_check: 0 }],
  ["бага зэрэг бүдэг", { vision_check: 1 }],
  ["жаахан бүдэг", { vision_check: 1 }],
  ["бүдэг", { vision_check: 2 }],
  ["бүдгэрсэн", { vision_check: 2 }],
  ["тод биш", { vision_check: 2 }],
  ["Тод байна", { vision_check: 0 }],
]);

describe("vision: edge cases", () => {
  it("checks 'slightly' before the plain blurred rule", () => {
    expect(valuesOf(run("vision", "slightly blurred"))).toEqual({ vision_check: 1 });
    expect(valuesOf(run("vision", "blurred"))).toEqual({ vision_check: 2 });
  });

  it("conflicting answers are ambiguous", () => {
    expect(run("vision", "clear but blurry on the left").reason).toBe("ambiguous");
  });

  it("no usable word is no_value", () => {
    expect(run("vision", "hmm").reason).toBe("no_value");
  });

  it("uses the words-only confidence", () => {
    expect(run("vision", "sharp").records[0].confidence).toBe(0.6);
  });
});

/* ───────────── workload ───────────── */

suite("workload", "en", [
  ["3", { workload: 3 }],
  ["heavy", { workload: 4 }],
  ["very heavy", { workload: 5 }],
  ["light", { workload: 2 }],
  ["moderate", { workload: 3 }],
  ["four", { workload: 4 }],
  ["about a 2", { workload: 2 }],
]);

suite("workload", "mn", [
  ["дунд", { workload: 3 }],
  ["хүнд", { workload: 4 }],
  ["маш их", { workload: 5 }],
  ["бага", { workload: 2 }],
  ["гурав", { workload: 3 }],
  ["4", { workload: 4 }],
  ["ачаалал дунд зэрэг", { workload: 3 }],
]);

describe("workload: edge cases", () => {
  it("rejects a number above 5", () => {
    expect(run("workload", "9").rejectedKeys).toEqual(["workload"]);
  });
});

/* ───────────── day note ───────────── */

describe("day_note", () => {
  it.each(["Nothing", "no", "Nothing to add", "nope", "no thanks", "Nothing today.", "That's all", "nope nothing", "no, nothing really"])(
    "%s means nothing to record, not unclear",
    (text) => {
      const r = run("day_note", text);
      expect(r.records).toEqual([]);
      expect(r.unclear).toBe(false);
      expect(r.reason).toBeNull();
    },
  );

  it.each(["үгүй", "Юу ч үгүй", "Нэмэх зүйл байхгүй", "байхгүй", "алга"])("%s (mn) means nothing to record", (text) => {
    const r = run("day_note", text, "mn");
    expect(r.records).toEqual([]);
    expect(r.unclear).toBe(false);
  });

  it("records free text verbatim", () => {
    const r = run("day_note", "Saw a beautiful sunrise over the Pacific");
    expect(r.records).toEqual([
      {
        key: "day_note",
        value: "Saw a beautiful sunrise over the Pacific",
        unit: null,
        sourceText: "Saw a beautiful sunrise over the Pacific",
        confidence: 0.9,
      },
    ]);
  });

  it("records Mongolian free text", () => {
    const r = run("day_note", "Өнөөдөр гайхалтай нар мандлаа", "mn");
    expect(valuesOf(r)).toEqual({ day_note: "Өнөөдөр гайхалтай нар мандлаа" });
  });

  it("drops a leading no before real content", () => {
    expect(valuesOf(run("day_note", "No, I enjoyed the video call with my family"))).toEqual({
      day_note: "I enjoyed the video call with my family",
    });
  });

  it("skip means nothing to record for the optional question", () => {
    expect(run("day_note", "skip").unclear).toBe(false);
  });

  it("truncates a note that is too long instead of rejecting it", () => {
    const long = "word ".repeat(200);
    const r = run("day_note", long);
    expect(r.records).toHaveLength(1);
    expect(String(r.records[0].value).length).toBeLessThanOrEqual(500);
  });
});

/* ───────────── unclear answers (every question) ───────────── */

describe("unclear answers", () => {
  const numericQuestions: QuestionId[] = [
    "sleep",
    "mood",
    "blood_pressure",
    "heart_rate",
    "temperature",
    "glucose",
    "water",
    "workload",
    "vision",
  ];

  it.each(numericQuestions)("%s: skip / I don't know / мэдэхгүй -> unclear, no_value", (id) => {
    for (const text of ["skip", "I don't know", "мэдэхгүй", "", "   "]) {
      const r = run(id, text);
      expect(r.records).toEqual([]);
      expect(r.unclear).toBe(true);
      expect(r.reason).toBe("no_value");
      expect(r.rejectedKeys).toEqual([]);
    }
  });

  it("symptoms: skip and I don't know are unclear", () => {
    for (const text of ["skip", "I don't know", "мэдэхгүй"]) {
      const r = run("symptoms", text);
      expect(r.unclear).toBe(true);
      expect(r.reason).toBe("no_value");
    }
  });

  it("small talk with no value is unclear for numeric questions", () => {
    expect(run("heart_rate", "hmm, let me think").reason).toBe("no_value");
    expect(run("temperature", "I feel warm").reason).toBe("no_value");
  });
});

/* ───────────── registry consistency ───────────── */

describe("records are always valid registry values", () => {
  const samples: Array<[QuestionId, string]> = [
    ["sleep", "I slept 7 hours"],
    ["mood", "four"],
    ["symptoms", "a mild headache, since morning"],
    ["blood_pressure", "120 over 80"],
    ["heart_rate", "72"],
    ["temperature", "36.6"],
    ["glucose", "98"],
    ["water", "2 litres"],
    ["exercise", "an hour"],
    ["vision", "slightly blurred"],
    ["workload", "3"],
    ["day_note", "good day"],
  ];

  it.each(samples)("%s", (id, text) => {
    const r = run(id, text);
    expect(r.records.length).toBeGreaterThan(0);
    for (const rec of r.records) {
      expect(getQuestion(id).keys).toContain(rec.key);
      expect(rec.unit).toBe(KPI_DEFS[rec.key].unit);
      expect(rec.confidence).toBeGreaterThanOrEqual(0.6);
      expect(rec.confidence).toBeLessThanOrEqual(0.9);
      expect(rec.sourceText.length).toBeGreaterThan(0);
      expect(text.includes(rec.sourceText)).toBe(true);
    }
  });
});

/* ───────────── corrections ───────────── */

describe("interpretCorrection", () => {
  it("No, I slept 7 hours -> sleep question, sleep_hours = 7", () => {
    const c = interpretCorrection("No, I slept 7 hours", "en");
    expect(c.question?.id).toBe("sleep");
    expect(valuesOf(c.result)).toEqual({ sleep_hours: 7 });
  });

  it.each<[string, QuestionId, Values]>([
    ["Actually my pressure was 118 over 76", "blood_pressure", BP(118, 76)],
    ["No, my pulse is 70", "heart_rate", { heart_rate: 70 }],
    ["the temperature was 36.8", "temperature", { temperature_c: 36.8 }],
    ["glucose is 105", "glucose", { glucose_mgdl: 105 }],
    ["I drank 2 litres of water", "water", { water_ml: 2000 }],
    ["I exercised for 45 minutes", "exercise", { exercise_min: 45 }],
    ["my mood is 3", "mood", { mood: 3 }],
    ["vision is slightly blurred", "vision", { vision_check: 1 }],
    ["workload was 4", "workload", { workload: 4 }],
    ["I do have a headache", "symptoms", { ...NO_SYMPTOMS, symptom_headache: 1 }],
  ])("%s", (text, id, expected) => {
    const c = interpretCorrection(text, "en");
    expect(c.question?.id).toBe(id);
    expect(valuesOf(c.result)).toEqual(expected);
  });

  it.each<[string, QuestionId, Values]>([
    ["Үгүй, би 6 цаг унтсан", "sleep", { sleep_hours: 6 }],
    ["Буруу, даралт 118 76", "blood_pressure", BP(118, 76)],
    ["пульс далан хоёр", "heart_rate", { heart_rate: 72 }],
    ["температур гучин зургаа цэг тав", "temperature", { temperature_c: 36.5 }],
    ["сахар 105", "glucose", { glucose_mgdl: 105 }],
    ["ус нэг хагас литр", "water", { water_ml: 1500 }],
    ["дасгал 30 минут хийсэн", "exercise", { exercise_min: 30 }],
    ["сэтгэл 5", "mood", { mood: 5 }],
    ["хараа бага зэрэг бүдэг", "vision", { vision_check: 1 }],
    ["ачаалал дөрөв", "workload", { workload: 4 }],
    ["толгой өвдөж байна", "symptoms", { ...NO_SYMPTOMS, symptom_headache: 1 }],
  ])("%s (mn)", (text, id, expected) => {
    const c = interpretCorrection(text, "mn");
    expect(c.question?.id).toBe(id);
    expect(valuesOf(c.result)).toEqual(expected);
  });

  it("falls back on the unit when no keyword is spoken", () => {
    const c = interpretCorrection("No, 6 hours", "en");
    expect(c.question?.id).toBe("sleep");
    expect(valuesOf(c.result)).toEqual({ sleep_hours: 6 });
  });

  it("a measurement keyword beats a mood cue", () => {
    const c = interpretCorrection("I feel my pulse is 80", "en");
    expect(c.question?.id).toBe("heart_rate");
  });

  it("returns no question when the target cannot be found", () => {
    const c = interpretCorrection("hmm, something is off", "en");
    expect(c.question).toBeNull();
    expect(c.result.unclear).toBe(true);
    expect(c.result.records).toEqual([]);
  });

  it("an out-of-range correction is rejected, not stored", () => {
    const c = interpretCorrection("No, I slept 25 hours", "en");
    expect(c.question?.id).toBe("sleep");
    expect(c.result.records).toEqual([]);
    expect(c.result.rejectedKeys).toEqual(["sleep_hours"]);
  });
});

/* ───────────── yes / no ───────────── */

describe("interpretYesNo", () => {
  it.each([
    "yes",
    "Yeah",
    "yep",
    "correct",
    "right",
    "ok",
    "okay",
    "sure",
    "that's right",
    "that’s right",
    "all good",
    "Yes, that's right.",
    "no changes",
    "not wrong",
  ])("%s -> true", (text) => {
    expect(interpretYesNo(text, "en")).toBe(true);
  });

  it.each(["no", "nope", "wrong", "incorrect", "not quite", "No, I slept 7 hours", "that's not right", "not correct"])(
    "%s -> false",
    (text) => {
      expect(interpretYesNo(text, "en")).toBe(false);
    },
  );

  it.each(["тийм", "зөв", "за", "болно", "бүгд зөв", "Тийм, зөв", "буруу биш"])("%s -> true (mn)", (text) => {
    expect(interpretYesNo(text, "mn")).toBe(true);
  });

  it.each(["үгүй", "буруу", "биш", "зөв биш", "Үгүй, би 6 цаг унтсан"])("%s -> false (mn)", (text) => {
    expect(interpretYesNo(text, "mn")).toBe(false);
  });

  it.each(["", "I slept seven hours", "hmm", "right now I feel dizzy"])("%s -> null", (text) => {
    expect(interpretYesNo(text, "en")).toBeNull();
  });

  it("a yes that is taken back after 'but' is a no", () => {
    expect(interpretYesNo("Yes, but change the sleep", "en")).toBe(false);
    expect(interpretYesNo("Тийм, гэхдээ засах зүйл байна", "mn")).toBe(false);
    // a yes that names a value or a measurement after "but" is a correction, never a confirmation
    expect(interpretYesNo("ok but sleep was 6", "en")).toBe(false);
    // harmless extra words do not take the yes back
    expect(interpretYesNo("yes, but I am a bit tired", "en")).toBe(true);
  });
});

describe("interpretStart", () => {
  it.each(["yes", "sure", "ok", "Let's do it", "let's start", "go ahead", "ready", "of course", "sounds good", "yeah why not"])(
    "%s -> yes",
    (text) => {
      expect(interpretStart(text, "en")).toBe("yes");
    },
  );

  it.each(["no", "not now", "later", "maybe later", "not yet", "nope", "not today", "Let's do it later"])(
    "%s -> no",
    (text) => {
      expect(interpretStart(text, "en")).toBe("no");
    },
  );

  it.each(["тийм", "за", "болно", "хийцгээе", "эхэлье", "бэлэн", "Тийм, хийцгээе"])("%s -> yes (mn)", (text) => {
    expect(interpretStart(text, "mn")).toBe("yes");
  });

  it.each(["үгүй", "дараа", "одоохондоо", "дараа хийе", "болохгүй"])("%s -> no (mn)", (text) => {
    expect(interpretStart(text, "mn")).toBe("no");
  });

  it.each(["I feel good", "I'm a bit tired", "I'm okay", "I'm fine", "Сайн байна", "what is this?", ""])("%s -> unclear", (text) => {
    expect(interpretStart(text, "en")).toBe("unclear");
  });
});

/* ───────────── opportunistic extraction ───────────── */

describe("interpretOpportunistic", () => {
  const pairs = (text: string): Array<[KpiKey, MeasurementValue]> =>
    interpretOpportunistic(text, "en").map((r) => [r.key, r.value]);

  it("takes a keyword with a number: I slept 6 hours and my pulse is 70", () => {
    expect(pairs("I slept 6 hours and my pulse is 70")).toEqual([
      ["sleep_hours", 6],
      ["heart_rate", 70],
    ]);
  });

  it("takes blood pressure and exercise", () => {
    expect(pairs("my blood pressure is 120 over 80, 40 minutes of exercise")).toEqual([
      ["bp_systolic", 120],
      ["bp_diastolic", 80],
      ["exercise_min", 40],
    ]);
  });

  it("takes a number that comes before its keyword when it carries a unit", () => {
    expect(pairs("I got 7 hours of sleep")).toEqual([["sleep_hours", 7]]);
  });

  it("takes temperature, glucose and water", () => {
    expect(pairs("temperature 36.6, glucose 98 and I drank 2 litres of water")).toEqual([
      ["temperature_c", 36.6],
      ["glucose_mgdl", 98],
      ["water_ml", 2000],
    ]);
  });

  it("takes mood and workload only as numbers", () => {
    expect(pairs("my mood is 4 and the workload was 3")).toEqual([
      ["mood", 4],
      ["workload", 3],
    ]);
    expect(pairs("my mood is great")).toEqual([]);
  });

  it("works in Mongolian", () => {
    expect(
      interpretOpportunistic("Би долоон цаг унтсан, пульс далан хоёр", "mn").map((r) => [r.key, r.value]),
    ).toEqual([
      ["sleep_hours", 7],
      ["heart_rate", 72],
    ]);
  });

  it("ignores small talk without a keyword and number pair", () => {
    expect(pairs("I feel good today, a little tired")).toEqual([]);
    expect(pairs("I slept badly")).toEqual([]);
    expect(pairs("I need 8 coffees")).toEqual([]);
    expect(pairs("")).toEqual([]);
  });

  it("ignores values that are out of range", () => {
    expect(pairs("my pulse is 301")).toEqual([]);
  });

  it("never guesses a bare number for a keyword", () => {
    expect(pairs("water 2")).toEqual([]);
  });

  it("returns records with the registry unit and a verbatim source text", () => {
    const text = "I slept 6 hours";
    const [rec] = interpretOpportunistic(text, "en");
    expect(rec.unit).toBe("h");
    expect(rec.confidence).toBe(0.9);
    expect(text.includes(rec.sourceText)).toBe(true);
  });
});

/* ───────────── review round 2: regression tests ───────────── */

function expectUnclear(id: QuestionId, text: string, reason: "no_value" | "ambiguous"): void {
  const r = run(id, text);
  expect(r.records).toEqual([]);
  expect(r.unclear).toBe(true);
  expect(r.reason).toBe(reason);
}

describe("review: sleep clock times are not durations", () => {
  it.each([
    "I slept at 11",
    "I went to bed at 11 and woke at 6",
    "11 to 6",
    "from 11 until 6",
    "I fell asleep around 11",
    "өчигдөр орой 11 цагт унтсан",
    "11 цагаас 6 цаг хүртэл",
  ])("%s -> ambiguous, nothing recorded", (text) => {
    expectUnclear("sleep", text, "ambiguous");
  });

  it.each(["6 to 7 hours", "between 6 and 7 hours", "5 or 6 hours"])("range %s -> ambiguous", (text) => {
    expectUnclear("sleep", text, "ambiguous");
  });

  it("a duration spoken next to a clock time wins and the clock time is ignored", () => {
    for (const text of ["I went to bed at 11 and slept 7 hours", "I slept 7 hours, woke at 6", "7 hours, from 11 pm"]) {
      const r = run("sleep", text);
      expect(valuesOf(r)).toEqual({ sleep_hours: 7 });
      expect(r.records[0].confidence).toBe(0.9);
    }
  });

  it("an 'around' that is not about bedtime stays a duration", () => {
    expect(valuesOf(run("sleep", "I slept around 7"))).toEqual({ sleep_hours: 7 });
  });

  it.each<[string, number, number]>([
    ["6:30", 6.5, 0.7],
    ["six thirty", 6.5, 0.7],
    ["6 30", 6.5, 0.7],
    ["7h30", 7.5, 0.9],
    ["7h 30", 7.5, 0.9],
    ["I slept 6 hours 45", 6.75, 0.9],
    ["seven hours and fifteen minutes", 7.25, 0.9],
  ])("hours and minutes %s -> %s h", (text, hours, confidence) => {
    const r = run("sleep", text);
    expect(valuesOf(r)).toEqual({ sleep_hours: hours });
    expect(r.records[0].confidence).toBe(confidence);
  });
});

describe("review: a negated sleep phrase is not 'zero hours'", () => {
  it.each([
    "I didn't sleep well",
    "I couldn't sleep much",
    "I didn't sleep enough",
    "I haven't slept properly",
    "сайн унтаагүй",
    "хангалттай унтаагүй",
  ])("%s -> asks for the hours (no_value)", (text) => {
    expectUnclear("sleep", text, "no_value");
  });

  it.each([
    "I didn't sleep at all",
    "I didn't sleep",
    "I didn't sleep last night",
    "no sleep",
    "not a wink",
    "I didn't get any sleep",
    "огт унтаагүй",
    "өчигдөр унтаагүй",
    "нэг ч минут унтаагүй",
    "нойргүй хонсон",
  ])("%s -> 0 hours at the words-only confidence", (text) => {
    const r = run("sleep", text);
    expect(valuesOf(r)).toEqual({ sleep_hours: 0 });
    expect(r.records[0].confidence).toBe(0.6);
    expect(text.includes(r.records[0].sourceText)).toBe(true);
  });

  it("'no sleep problems' is not a total absence of sleep", () => {
    expectUnclear("sleep", "no sleep problems", "no_value");
  });
});

describe("review: Mongolian 'нэг' as a quantifier is not the number 1", () => {
  it("mood: 'нэг их сайн биш' means not so good, 'нэг их муу биш' means not so bad", () => {
    expect(valuesOf(run("mood", "нэг их сайн биш байна", "mn"))).toEqual({ mood: 2 });
    expect(valuesOf(run("mood", "нэг их муу биш", "mn"))).toEqual({ mood: 4 });
  });

  it("mood: a lone 'нэг' is still 1, but a matched mood word outranks it", () => {
    expect(valuesOf(run("mood", "нэг", "mn"))).toEqual({ mood: 1 });
    expect(valuesOf(run("mood", "нэг гайгүй", "mn"))).toEqual({ mood: 3 });
  });

  it("workload: 'нэг их ачаалал байгаагүй' means there was not much", () => {
    expect(valuesOf(run("workload", "нэг их ачаалал байгаагүй", "mn"))).toEqual({ workload: 2 });
    expect(valuesOf(run("workload", "ачаалал огт байгаагүй", "mn"))).toEqual({ workload: 1 });
  });

  it("sleep and exercise accept 'нэг' only with a unit", () => {
    expectUnclear("sleep", "нэг их унтаагүй", "no_value");
    expectUnclear("exercise", "нэг их хийгээгүй", "no_value");
    expectUnclear("sleep", "нэг", "no_value");
    expect(valuesOf(run("sleep", "нэг цаг унтсан", "mn"))).toEqual({ sleep_hours: 1 });
    expect(valuesOf(run("exercise", "нэг цаг", "mn"))).toEqual({ exercise_min: 60 });
  });

  it("a hedged English negation of exercise asks for the minutes, a plain one is 0", () => {
    expectUnclear("exercise", "I didn't exercise much", "no_value");
    expect(valuesOf(run("exercise", "I didn't exercise"))).toEqual({ exercise_min: 0 });
    expect(valuesOf(run("exercise", "no, that was a rest day"))).toEqual({ exercise_min: 0 });
  });
});

describe("review: Mongolian thousands (мянга)", () => {
  it.each<[string, number]>([
    ["ус нэг мянга найман зуун мл", 1800],
    ["1 мянга 800 мл", 1800],
    ["мянга хоёр зуун", 1200],
    ["нэг мянга найман зуу", 1800],
    ["хоёр мянга", 2000],
    ["нэг мянга таван зуун мл", 1500],
    ["мянга мл", 1000],
    ["ус мянга", 1000],
  ])("%s -> %i ml", (text, ml) => {
    const r = run("water", text, "mn");
    expect(valuesOf(r)).toEqual({ water_ml: ml });
    expect(r.records[0].confidence).toBe(0.9);
    expect(text.includes(r.records[0].sourceText)).toBe(true);
  });

  it("does not disturb litres or plain numbers", () => {
    expect(valuesOf(run("water", "нэг хагас литр", "mn"))).toEqual({ water_ml: 1500 });
    expect(valuesOf(run("water", "ус 1800", "mn"))).toEqual({ water_ml: 1800 });
  });
});

describe("review: Mongolian symptom phrases with words between 'толгой' and the verb", () => {
  it.each<[string, Values]>([
    ["толгой маш их өвдөж байна", { symptom_headache: 1, symptom_dizziness: 0, symptom_nausea: 0 }],
    ["толгой маань өвдөж байна", { symptom_headache: 1, symptom_dizziness: 0, symptom_nausea: 0 }],
    ["толгой жаахан эргэж байна", { symptom_headache: 0, symptom_dizziness: 1, symptom_nausea: 0 }],
    ["толгой нь бага зэрэг эргэж байна", { symptom_headache: 0, symptom_dizziness: 1, symptom_nausea: 0 }],
    ["дотор маш муухай байна", { symptom_headache: 0, symptom_dizziness: 0, symptom_nausea: 1 }],
    ["толгой маш их өвдөхгүй байна", NO_SYMPTOMS],
    ["толгой өвдөхгүй, толгой эргэхгүй", NO_SYMPTOMS],
  ])("%s", (text, expected) => {
    const r = run("symptoms", text, "mn");
    expect(valuesOf(r)).toMatchObject(expected);
    expect(r.unclear).toBe(false);
  });
});

describe("review: a negation does not leak onto the next symptom", () => {
  it.each<[string, Values]>([
    ["no headache, a bit nauseous", { symptom_headache: 0, symptom_dizziness: 0, symptom_nausea: 1 }],
    ["no headache, nauseous", { symptom_headache: 0, symptom_dizziness: 0, symptom_nausea: 1 }],
    ["no headache and some dizziness", { symptom_headache: 0, symptom_dizziness: 1, symptom_nausea: 0 }],
    ["no headache or dizziness, mild nausea", { symptom_headache: 0, symptom_dizziness: 0, symptom_nausea: 1 }],
    ["no headache, no dizziness, nausea yes", { symptom_headache: 0, symptom_dizziness: 0, symptom_nausea: 1 }],
    ["headache, dizziness", { symptom_headache: 1, symptom_dizziness: 1, symptom_nausea: 0 }],
    // true negated lists still stay negated
    ["no headache or nausea", NO_SYMPTOMS],
    ["no headache, dizziness or nausea", NO_SYMPTOMS],
    ["no headache, no dizziness, no nausea", NO_SYMPTOMS],
    ["neither headache nor dizziness nor nausea", NO_SYMPTOMS],
    ["no headache and no nausea, a bit dizzy", { symptom_headache: 0, symptom_dizziness: 1, symptom_nausea: 0 }],
  ])("%s", (text, expected) => {
    expect(valuesOf(run("symptoms", text))).toMatchObject(expected);
  });
});

describe("review: the symptom note is verbatim", () => {
  const noteOf = (text: string): { value: MeasurementValue; sourceText: string } | undefined =>
    run("symptoms", text).records.find((r) => r.key === "symptom_note");

  it("is one contiguous slice of the utterance, original separators included", () => {
    const text = "headache but my back hurts a lot; also sore neck";
    const note = noteOf(text);
    expect(note?.value).toBe("my back hurts a lot; also sore neck");
    expect(text.includes(note?.sourceText ?? "?")).toBe(true);
    expect(text.includes(String(note?.value))).toBe(true);
  });

  it("keeps the source a substring when a denial sits between two kept clauses, and never copies the denial", () => {
    const text = "my back hurts, no chest pain, also sore neck";
    const note = noteOf(text);
    expect(note).toBeDefined();
    expect(text.includes(note?.sourceText ?? "?")).toBe(true);
    expect(String(note?.value)).not.toMatch(/chest/);
  });

  it("every record source across several symptom utterances is a substring of the input", () => {
    for (const text of [
      "headache, my neck is sore",
      "no dizziness. chest pain, and a cough",
      "толгой өвдөж байна, нуруу хөндүүрлэж байна",
      "a bit of nausea; also my knee hurts",
    ]) {
      for (const r of run("symptoms", text).records) expect(text.includes(r.sourceText)).toBe(true);
    }
  });
});

describe("review: a yes that carries a correction is not a yes", () => {
  it.each([
    "yes, but the pulse was 70",
    "right, but the pulse was 70",
    "yes except the sleep",
    "correct except the pulse",
    "yes, apart from the pressure",
    "yes, except for the water, it was 2000",
    "тийм, гэхдээ пульс 70",
    "тийм, харин даралт 130",
    "зөв, зөвхөн пульс 70",
  ])("%s -> false", (text) => {
    expect(interpretYesNo(text, "en")).toBe(false);
  });

  it.each(["yes", "yes, but I am tired", "correct, but a long day", "тийм, гэхдээ ядарсан"])("%s -> true", (text) => {
    expect(interpretYesNo(text, "en")).toBe(true);
  });
});

describe("review: opportunistic extraction never reads small talk as a duration", () => {
  const pairs = (text: string): Array<[KpiKey, MeasurementValue]> =>
    interpretOpportunistic(text, "en").map((r) => [r.key, r.value]);

  it.each([
    "I fell asleep around 11",
    "I went to sleep at 11",
    "sleep quality 3",
    "I did exercise 2 times",
    "I slept 6",
    "water 2",
  ])("%s -> nothing", (text) => {
    expect(pairs(text)).toEqual([]);
  });

  it("drops a key spoken with two different values", () => {
    expect(pairs("I slept 8 hours yesterday but only 5 today")).toEqual([]);
    expect(pairs("I slept 8 hours and later I slept 5 hours")).toEqual([]);
  });

  it("still takes a clear value with a unit, even next to a clock time", () => {
    expect(pairs("I slept 7 hours, woke at 6, and my pulse is 70")).toEqual([
      ["sleep_hours", 7],
      ["heart_rate", 70],
    ]);
  });
});
