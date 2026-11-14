import type { DemoScript } from "./index";

/**
 * English demo: Bat's check-in. The first sleep answer is 5.5 h; at the read-back Bat corrects it to six hours,
 * so the final stored value is 6 (still below Bat's usual 7.2 h, so sleep and water stay the two findings).
 * Phrasing is deliberately varied: units, bare numbers, one number spoken as words.
 */
export const DEMO_SCRIPT_EN: DemoScript = {
  language: "en",
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
    { say: "I'm doing well, thanks. A little tired, but good.", expect: "smalltalk" },
    { say: "It was a busy morning, but I'm doing fine.", expect: "smalltalk" },
    { say: "Sure, let's do it.", expect: "start" },
    { say: "I slept about 5.5 hours.", expect: "sleep" },
    { say: "I'd say four.", expect: "mood" },
    { say: "No, nothing at all.", expect: "symptoms" },
    { say: "124 over 82.", expect: "blood_pressure" },
    { say: "68.", expect: "heart_rate" },
    { say: "Thirty six point seven.", expect: "temperature" },
    { say: "98 mg/dL.", expect: "glucose" },
    { say: "About 1.8 litres.", expect: "water" },
    { say: "40 minutes.", expect: "exercise" },
    { say: "It's sharp.", expect: "vision" },
    { say: "Around 3.", expect: "workload" },
    { say: "Nothing today.", expect: "day_note" },
    { say: "No, I slept six hours.", expect: "confirm" },
    { say: "Yes, that's right.", expect: "confirm2" },
  ],
};
