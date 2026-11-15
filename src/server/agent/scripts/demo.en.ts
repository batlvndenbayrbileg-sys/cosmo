import type { DemoScript } from "./index";

/**
 * English demo: Bat's check-in (redesigned 2026-11-15, docs/research/checkin-nasa.md). The sensors have already logged
 * sleep and the morning vitals; Bat's resting heart rate is up after a treadmill run (the scripted demo day's story,
 * src/lib/sensors/feed.ts), so Cosmo reads it back and asks about it. Then the six spoken questions: overall feeling,
 * symptoms and the short wellbeing check. A rough night gets a supportive word; at the read-back Bat changes energy
 * to two. Phrasing is deliberately varied: numbers, number words and plain words.
 */
export const DEMO_SCRIPT_EN: DemoScript = {
  language: "en",
  values: {
    // from the simulated sensor feed (scripted demo day)
    sleep_hours: 7.5,
    bp_systolic: 117,
    bp_diastolic: 79,
    heart_rate: 82,
    temperature_c: 36.5,
    glucose_mgdl: 100,
    water_ml: 2350,
    exercise_min: 53,
    // said by Bat
    sensor_note: "Yes, I just finished a run on the treadmill.",
    mood: 4,
    symptom_headache: 0,
    symptom_dizziness: 0,
    symptom_nausea: 0,
    vision_check: 0,
    sleep_quality: 2,
    energy: 2,
    stress: 2,
    connection: 4,
  },
  lines: [
    { say: "I'm doing well, thanks. A little tired, but good.", expect: "smalltalk" },
    { say: "It was a busy morning, but I'm doing fine.", expect: "smalltalk" },
    { say: "Sure, let's do it.", expect: "start" },
    { say: "Yes, I just finished a run on the treadmill.", expect: "sensor_check" },
    { say: "I'd say four.", expect: "mood" },
    { say: "No, nothing at all.", expect: "symptoms" },
    { say: "Not great, I kept waking up.", expect: "sleep_quality" },
    { say: "Okay, maybe a three.", expect: "energy" },
    { say: "A little, about two.", expect: "stress" },
    { say: "Pretty connected, a four.", expect: "connection" },
    { say: "No, my energy is more like a two.", expect: "confirm" },
    { say: "Yes, that's right.", expect: "confirm2" },
  ],
};
