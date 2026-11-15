import type { DemoScript } from "./index";

/**
 * Mongolian demo: Bat's check-in (same story as the English script): the sensors logged sleep and the morning vitals,
 * the resting heart rate is up after a treadmill run and Cosmo asks about it, then the six spoken questions. At the
 * read-back Bat changes energy to two. Phrasing is varied: numbers, number words and plain words.
 * Needs a native-speaker review.
 */
export const DEMO_SCRIPT_MN: DemoScript = {
  language: "mn",
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
    sensor_note: "Тийм, сая гүйлтийн зам дээр гүйгээд ирлээ.",
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
    { say: "Сайн байна, баярлалаа. Жаахан ядарсан ч гайгүй.", expect: "smalltalk" },
    { say: "Өглөө арай завгүй байсан ч сайхан байна.", expect: "smalltalk" },
    { say: "Тийм, хийцгээе.", expect: "start" },
    { say: "Тийм, сая гүйлтийн зам дээр гүйгээд ирлээ.", expect: "sensor_check" },
    { say: "Дөрөв байна.", expect: "mood" },
    { say: "Үгүй, юу ч байхгүй.", expect: "symptoms" },
    { say: "Тийм ч сайн биш, байн байн сэрсэн.", expect: "sleep_quality" },
    { say: "Дунд зэрэг, гурав.", expect: "energy" },
    { say: "Бага зэрэг, хоёр.", expect: "stress" },
    { say: "Ойр байна, дөрөв.", expect: "connection" },
    { say: "Үгүй, эрч хүч минь хоёр орчим.", expect: "confirm" },
    { say: "Тийм, зөв.", expect: "confirm2" },
  ],
};
