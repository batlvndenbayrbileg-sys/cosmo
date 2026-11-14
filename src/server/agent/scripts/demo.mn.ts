import type { DemoScript } from "./index";

/**
 * Mongolian demo: Bat's check-in (same story as the English script). The first sleep answer is 5.5 hours; at the
 * read-back Bat corrects it to 6, so the final stored value is 6. Phrasing is varied: units, bare numbers, number words.
 * Needs a native-speaker review.
 */
export const DEMO_SCRIPT_MN: DemoScript = {
  language: "mn",
  values: {
    sleep_hours: 6,
    mood: 4,
    symptom_headache: 0,
    symptom_dizziness: 0,
    symptom_nausea: 0,
    bp_systolic: 124,
    bp_diastolic: 82,
    heart_rate: 68,
    temperature_c: 36.7,
    glucose_mgdl: 98,
    water_ml: 1800,
    exercise_min: 40,
    vision_check: 0,
    workload: 3,
  },
  lines: [
    { say: "Сайн байна, баярлалаа. Жаахан ядарсан ч гайгүй.", expect: "smalltalk" },
    { say: "Өглөө арай завгүй байсан ч сайхан байна.", expect: "smalltalk" },
    { say: "Тийм, хийцгээе.", expect: "start" },
    { say: "Тав хагас цаг унтсан.", expect: "sleep" },
    { say: "Дөрөв байна.", expect: "mood" },
    { say: "Үгүй, юу ч байхгүй.", expect: "symptoms" },
    { say: "124 дээр 82.", expect: "blood_pressure" },
    { say: "Пульс жаран найм.", expect: "heart_rate" },
    { say: "36.7 градус.", expect: "temperature" },
    { say: "98.", expect: "glucose" },
    { say: "Ус нэг мянга найман зуун мл.", expect: "water" },
    { say: "40 минут.", expect: "exercise" },
    { say: "Тод байна.", expect: "vision" },
    { say: "Гурав.", expect: "workload" },
    { say: "Юу ч үгүй.", expect: "day_note" },
    { say: "Үгүй, би 6 цаг унтсан.", expect: "confirm" },
    { say: "Тийм, зөв.", expect: "confirm2" },
  ],
};
