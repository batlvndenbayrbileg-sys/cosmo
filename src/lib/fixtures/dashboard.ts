/**
 * Hand-written dashboard payloads for developing and testing the dashboard UI without the data routes.
 * Four scenarios: Bat (overall yellow), Saraa (green, evening still to do), Mira (red flag with an alert)
 * and Alex (no data yet). Values, statuses, texts, tasks and hazards are written out by hand, the way the
 * server would return them; only the baseline arithmetic (mean, sd, delta, z) is derived from the 14-day
 * history arrays so the cards stay internally consistent.
 *
 * Every threshold in the product is a "demo parameter"; the history here is simulated demo data.
 */

import type {
  AlertRow,
  AxisScore,
  Bilingual,
  DashboardPayload,
  DayArcSlot,
  HazardKey,
  HazardStat,
  KpiKey,
  KpiStat,
  Lang,
  MeasurementSource,
  MeasurementValue,
  SlotKey,
  Status,
  StatusReason,
  SummaryPayload,
  Task,
} from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { KPI_DEFS, asNumber, rangeText } from "@/lib/kpi/registry";

/* ───────────── helpers ───────────── */

/** the 14 days before 2026-11-14, oldest first */
export const FIXTURE_HISTORY_DATES: readonly string[] = [
  "2026-10-31",
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-08",
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
];

type Series = Partial<Record<KpiKey, number[]>>;

/** repeats a short pattern to the 14 history days */
function cycle(pattern: number[], days = 14): number[] {
  return Array.from({ length: days }, (_, i) => pattern[i % pattern.length]);
}

interface KpiRow {
  value: MeasurementValue | null;
  status: Status;
  reason?: StatusReason;
}

/** one KpiStat; mean / sd / delta / z come from the key's history array (n >= 5, sample sd), like the server */
function kpi(
  key: KpiKey,
  row: KpiRow,
  series: Series,
  source: MeasurementSource | null,
): KpiStat {
  const def = KPI_DEFS[key];
  const values = def.type === "text" ? [] : (series[key] ?? []);
  const history = values.map((value, i) => ({
    date: FIXTURE_HISTORY_DATES[FIXTURE_HISTORY_DATES.length - values.length + i],
    value,
  }));

  let mean: number | null = null;
  let sd: number | null = null;
  if (values.length >= 5) {
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    mean = m;
    sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
  }

  const n = asNumber(row.value);
  let delta: number | null = null;
  let z: number | null = null;
  if (def.type !== "text" && def.type !== "boolean" && n !== null && mean !== null && sd !== null) {
    delta = n - mean;
    const spread = Math.max(sd, def.sdFloor ?? 0);
    z = spread > 0 ? delta / spread : null;
  }

  const present = row.value !== null && row.status !== "no_data";
  return {
    key,
    value: present ? row.value : null,
    unit: def.unit,
    status: row.status,
    reason: row.reason ?? (row.status === "no_data" ? "missing" : "fixed_range"),
    z,
    baselineMean: mean,
    baselineSd: sd,
    delta,
    history,
    source: present ? source : null,
    rangeText: rangeText(key),
  };
}

type Rows = Record<KpiKey, KpiRow>;

function kpis(rows: Rows, series: Series, source: MeasurementSource | null): KpiStat[] {
  return KPI_KEYS.map((key) => kpi(key, rows[key], series, source));
}

const NO_VALUE: KpiRow = { value: null, status: "no_data" };

/** hazard stat; indicator keys come from the registry, the status is written by hand */
function hazard(h: HazardKey, status: HazardStat["status"]): HazardStat {
  return { hazard: h, status, keys: KPI_KEYS.filter((k) => KPI_DEFS[k].hazards.includes(h)) };
}

function slot(s: SlotKey, logged: KpiKey[], missing: KpiKey[]): DayArcSlot {
  const state: DayArcSlot["state"] =
    missing.length === 0 ? "done" : logged.length > 0 ? "partial" : "pending";
  return { slot: s, state, logged, missing };
}

const DISCLAIMER: Bilingual = {
  en: "Decision support, not a diagnosis.",
  mn: "Шийдвэр гаргахад туслах мэдээлэл, онош биш.",
};

const bi = (en: string, mn: string): Bilingual => ({ en, mn });

/* ───────────── shared task texts (lifestyle only) ───────────── */

const TASK_DEFAULT_LIGHT: Task = {
  id: "default_light_exposure",
  hazard: "isolation_confinement",
  relatedKeys: [],
  title: bi("Keep a steady light and daily routine", "Гэрэл, өдрийн дэглэмээ тогтвортой байлгаарай"),
  why: bi(
    "A regular light and sleep routine helps you rest well in a closed habitat.",
    "Гэрэл, нойрны тогтмол дэглэм хаалттай орчинд сайн амрахад тусалдаг.",
  ),
};

const TASK_DEFAULT_STRETCH: Task = {
  id: "default_stretching",
  hazard: "gravity",
  relatedKeys: [],
  title: bi("Do 10 minutes of gentle stretching", "10 минут зөөлөн жийгээрэй"),
  why: bi(
    "Regular movement keeps muscles and joints active.",
    "Тогтмол хөдөлгөөн нь булчин, үеийг идэвхтэй байлгадаг.",
  ),
};

const TASK_DEFAULT_HYDRATION: Task = {
  id: "default_hydration",
  hazard: "gravity",
  relatedKeys: ["water_ml"],
  title: bi("Plan your water for the day", "Өдрийн усны төлөвлөгөөгөө гаргаарай"),
  why: bi(
    "Steady drinking through the day is easier than catching up in the evening.",
    "Өдрийн турш жигд ус уух нь орой нөхөж уухаас амархан.",
  ),
};

/* ───────────── Bat: overall yellow (sleep, water, exercise below his usual) ───────────── */

const BAT_SERIES: Series = {
  sleep_hours: [7.0, 7.4, 7.2, 6.9, 7.5, 7.3, 7.1, 7.6, 7.0, 7.2, 7.4, 6.8, 7.3, 7.2],
  mood: [4, 4, 5, 4, 3, 4, 4, 5, 4, 4, 4, 3, 4, 4],
  symptom_headache: cycle([0]),
  symptom_dizziness: cycle([0]),
  symptom_nausea: cycle([0]),
  bp_systolic: [117, 123, 120, 125, 116, 121, 122, 118, 120, 124, 118, 121, 119, 121],
  bp_diastolic: [76, 80, 78, 82, 75, 79, 81, 77, 78, 80, 76, 79, 78, 77],
  heart_rate: [64, 66, 68, 65, 67, 66, 66, 65, 67, 68, 64, 66, 66, 67],
  temperature_c: [36.5, 36.6, 36.7, 36.6, 36.5, 36.7, 36.6, 36.6, 36.5, 36.7, 36.6, 36.6, 36.7, 36.5],
  glucose_mgdl: [92, 96, 98, 94, 95, 97, 93, 96, 99, 94, 95, 96, 93, 97],
  water_ml: [2300, 2450, 2200, 2350, 2250, 2400, 2300, 2150, 2350, 2300, 2450, 2200, 2300, 2300],
  exercise_min: [45, 50, 40, 45, 50, 45, 40, 50, 45, 45, 40, 50, 45, 45],
  vision_check: cycle([0]),
  workload: [3, 2, 3, 3, 2, 3, 3, 2, 3, 3, 2, 3, 3, 3],
};

const BAT_ROWS: Rows = {
  sleep_hours: { value: 5.5, status: "yellow" },
  mood: { value: 4, status: "green" },
  symptom_headache: { value: 0, status: "green" },
  symptom_dizziness: { value: 0, status: "green" },
  symptom_nausea: { value: 0, status: "green" },
  symptom_note: NO_VALUE,
  bp_systolic: { value: 124, status: "green" },
  bp_diastolic: { value: 82, status: "green" },
  heart_rate: { value: 68, status: "green" },
  temperature_c: { value: 36.7, status: "green" },
  glucose_mgdl: { value: 98, status: "green" },
  water_ml: { value: 1800, status: "yellow" },
  exercise_min: { value: 40, status: "yellow" },
  vision_check: { value: 0, status: "green" },
  workload: { value: 3, status: "green" },
  day_note: NO_VALUE,
};

const BAT_AXES: AxisScore[] = [
  { axis: "sleep", score: 60, baseline: 94.3, status: "yellow" },
  { axis: "cardio", score: 100, baseline: 100, status: "green" },
  { axis: "metabolic", score: 90, baseline: 100, status: "yellow" },
  { axis: "neuro_ocular", score: 100, baseline: 100, status: "green" },
  { axis: "behavioral", score: 100, baseline: 100, status: "green" },
  { axis: "musculoskeletal", score: 60, baseline: 91.4, status: "yellow" },
];

const BAT_TASKS: Task[] = [
  {
    id: "sleep_wind_down",
    hazard: "isolation_confinement",
    relatedKeys: ["sleep_hours"],
    title: bi(
      "Start winding down earlier tonight and dim the lights",
      "Өнөө орой эрт амарч, гэрлээ бүдгэрүүлээрэй",
    ),
    why: bi(
      "You slept 5.5 h, about 1.7 h below your usual 7.2 h.",
      "Та 5.5 цаг унтсан нь ердийн 7.2 цагаас ойролцоогоор 1.7 цагаар бага байна.",
    ),
  },
  {
    id: "hydration_plan",
    hazard: "gravity",
    relatedKeys: ["water_ml"],
    title: bi(
      "Drink about 500 ml more, spread through the day",
      "Өдрийн турш хуваан 500 мл орчим нэмж ус уугаарай",
    ),
    why: bi(
      "You have had 1800 ml of water, about 507 ml below your usual 2307 ml.",
      "Та 1800 мл ус уусан нь ердийн 2307 мл-ээс ойролцоогоор 507 мл бага байна.",
    ),
  },
  {
    id: "exercise_session",
    hazard: "gravity",
    relatedKeys: ["exercise_min"],
    title: bi("Schedule a 45-minute exercise session", "45 минутын дасгалын цаг товлоорой"),
    why: bi(
      "You logged 40 min of exercise, below the 45 min demo parameter.",
      "Та 40 минут дасгал хийсэн нь 45 минутын демо параметрээс бага байна.",
    ),
  },
  TASK_DEFAULT_LIGHT,
];

const BAT_SUMMARY: SummaryPayload = {
  overall: "yellow",
  readiness: 85,
  headline: bi(
    "A few things to keep an eye on today. Readiness 85.",
    "Өнөөдөр анхаарах хэд хэдэн зүйл байна. Бэлэн байдал 85.",
  ),
  findings: [
    {
      key: "sleep_hours",
      status: "yellow",
      reason: "fixed_range",
      value: 5.5,
      unit: "h",
      baselineMean: 7.2,
      z: -5.7,
      direction: "low",
      text: bi(
        "Sleep was 5.5 h, about 1.7 h below your usual 7.2 h.",
        "Унтсан цаг: 5.5 цаг. Таны ердийн хэмжээ 7.2 цаг, зөрүү -1.7 цаг.",
      ),
    },
    {
      key: "water_ml",
      status: "yellow",
      reason: "fixed_range",
      value: 1800,
      unit: "ml",
      baselineMean: 2307,
      z: -3.4,
      direction: "low",
      text: bi(
        "Water intake was 1800 ml, about 507 ml below your usual 2307 ml.",
        "Уусан ус: 1800 мл. Таны ердийн хэмжээ 2307 мл, зөрүү -507 мл.",
      ),
    },
  ],
  recommendations: [BAT_TASKS[0], BAT_TASKS[1]],
  redFlags: [],
  disclaimer: DISCLAIMER,
  spoken: {
    language: "mn",
    text: "Сайн байна уу, Бат. Өнөөдөр унтсан цаг болон уусан ус ердийнхөөс бага байна. Өнөө орой эрт амарч, өдрийн турш хуваан ус уугаарай. Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш.",
  },
  audioTurnId: "turn-bat-summary",
};

export const batYellow: DashboardPayload = {
  crew: {
    id: "bat",
    name: "Bat",
    role: "Flight engineer",
    preferredLanguage: "mn",
    mascotVariant: 0,
    avatarSeed: "bat-0",
  },
  missionDay: 12,
  checkIn: { id: "chk-bat-demo", confirmedAt: "2026-11-14T08:42:00.000Z", language: "mn" },
  overall: "yellow",
  readiness: 85,
  readinessBaseline: 97.6,
  kpis: kpis(BAT_ROWS, BAT_SERIES, "simulated"),
  axes: BAT_AXES,
  hazards: [
    hazard("radiation", "not_monitored"),
    hazard("isolation_confinement", "yellow"),
    hazard("distance_from_earth", "not_monitored"),
    hazard("gravity", "yellow"),
    hazard("hostile_closed_environment", "green"),
  ],
  dayArc: [
    slot(
      "morning",
      [
        "sleep_hours",
        "mood",
        "symptom_headache",
        "symptom_dizziness",
        "symptom_nausea",
        "bp_systolic",
        "bp_diastolic",
        "heart_rate",
        "temperature_c",
      ],
      [],
    ),
    slot("midday", ["glucose_mgdl", "water_ml"], []),
    slot("afternoon", ["exercise_min", "vision_check"], []),
    slot("evening", ["workload"], []),
  ],
  tasks: BAT_TASKS,
  alerts: [],
  summary: BAT_SUMMARY,
  link: { state: "online", lastSentAt: "2026-11-14T08:44:00.000Z", delayMs: 0, simulated: true },
  simulatedHistory: true,
};

/* ───────────── Saraa: green, evening still to do ───────────── */

const SARAA_SERIES: Series = {
  sleep_hours: [7.6, 7.8, 7.5, 7.7, 7.9, 7.6, 7.4, 7.7, 7.8, 7.5, 7.6, 7.7, 7.5, 7.6],
  mood: cycle([4, 4, 5, 4, 4, 4, 5]),
  symptom_headache: cycle([0]),
  symptom_dizziness: cycle([0]),
  symptom_nausea: cycle([0]),
  bp_systolic: cycle([116, 118, 117, 119, 115, 118, 117]),
  bp_diastolic: cycle([75, 76, 74, 77, 75, 76, 75]),
  heart_rate: cycle([62, 64, 63, 65, 62, 64, 63]),
  temperature_c: cycle([36.5, 36.6, 36.5, 36.6, 36.4, 36.5, 36.6]),
  glucose_mgdl: cycle([90, 93, 92, 94, 91, 93, 92]),
  water_ml: cycle([2450, 2500, 2400, 2550, 2450, 2500, 2400]),
  exercise_min: cycle([55, 60, 50, 55, 60, 55, 50]),
  vision_check: cycle([0]),
  workload: cycle([2, 3, 2, 2, 3, 2, 2]),
};

const SARAA_ROWS: Rows = {
  sleep_hours: { value: 7.6, status: "green" },
  mood: { value: 4, status: "green" },
  symptom_headache: { value: 0, status: "green" },
  symptom_dizziness: { value: 0, status: "green" },
  symptom_nausea: { value: 0, status: "green" },
  symptom_note: NO_VALUE,
  bp_systolic: { value: 118, status: "green" },
  bp_diastolic: { value: 76, status: "green" },
  heart_rate: { value: 63, status: "green" },
  temperature_c: { value: 36.5, status: "green" },
  glucose_mgdl: { value: 92, status: "green" },
  water_ml: { value: 2500, status: "green" },
  exercise_min: { value: 55, status: "green" },
  vision_check: { value: 0, status: "green" },
  workload: NO_VALUE,
  day_note: NO_VALUE,
};

const SARAA_TASKS: Task[] = [TASK_DEFAULT_HYDRATION, TASK_DEFAULT_LIGHT, TASK_DEFAULT_STRETCH];

export const saraaGreen: DashboardPayload = {
  crew: {
    id: "saraa",
    name: "Saraa",
    role: "Mission specialist",
    preferredLanguage: "mn",
    mascotVariant: 1,
    avatarSeed: "saraa-1",
  },
  missionDay: 12,
  checkIn: { id: "chk-saraa-today", confirmedAt: "2026-11-14T13:20:00.000Z", language: "mn" },
  overall: "green",
  readiness: 100,
  readinessBaseline: 100,
  kpis: kpis(SARAA_ROWS, SARAA_SERIES, "typed"),
  axes: [
    { axis: "sleep", score: 100, baseline: 100, status: "green" },
    { axis: "cardio", score: 100, baseline: 100, status: "green" },
    { axis: "metabolic", score: 100, baseline: 100, status: "green" },
    { axis: "neuro_ocular", score: 100, baseline: 100, status: "green" },
    { axis: "behavioral", score: 100, baseline: 100, status: "green" },
    { axis: "musculoskeletal", score: 100, baseline: 100, status: "green" },
  ],
  hazards: [
    hazard("radiation", "not_monitored"),
    hazard("isolation_confinement", "green"),
    hazard("distance_from_earth", "not_monitored"),
    hazard("gravity", "green"),
    hazard("hostile_closed_environment", "green"),
  ],
  dayArc: [
    slot(
      "morning",
      [
        "sleep_hours",
        "mood",
        "symptom_headache",
        "symptom_dizziness",
        "symptom_nausea",
        "bp_systolic",
        "bp_diastolic",
        "heart_rate",
        "temperature_c",
      ],
      [],
    ),
    slot("midday", ["glucose_mgdl", "water_ml"], []),
    slot("afternoon", ["exercise_min", "vision_check"], []),
    slot("evening", [], ["workload"]),
  ],
  tasks: SARAA_TASKS,
  alerts: [],
  summary: {
    overall: "green",
    readiness: 100,
    headline: bi(
      "Everything looks steady today. Readiness 100.",
      "Өнөөдөр бүх зүйл тогтвортой байна. Бэлэн байдал 100.",
    ),
    findings: [],
    recommendations: [SARAA_TASKS[0], SARAA_TASKS[1]],
    redFlags: [],
    disclaimer: DISCLAIMER,
    spoken: {
      language: "mn",
      text: "Саараа, өнөөдөр бүх үзүүлэлт тогтвортой байна. Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш.",
    },
    audioTurnId: "turn-saraa-summary",
  },
  link: { state: "online", lastSentAt: "2026-11-14T13:22:00.000Z", delayMs: 0, simulated: true },
  simulatedHistory: true,
};

/* ───────────── Mira: red flag (headache + blurred vision), alert present ───────────── */

const MIRA_SERIES: Series = {
  sleep_hours: cycle([7.4, 7.6, 7.5, 7.3, 7.7, 7.5, 7.4]),
  mood: cycle([4, 4, 5, 4, 4, 3, 4]),
  symptom_headache: cycle([0]),
  symptom_dizziness: cycle([0]),
  symptom_nausea: cycle([0]),
  bp_systolic: cycle([116, 120, 118, 119, 117, 121, 118]),
  bp_diastolic: cycle([75, 77, 76, 78, 74, 76, 77]),
  heart_rate: cycle([64, 67, 66, 65, 68, 66, 65]),
  temperature_c: cycle([36.5, 36.6, 36.7, 36.6, 36.6, 36.5, 36.7]),
  glucose_mgdl: cycle([93, 97, 95, 96, 94, 98, 95]),
  water_ml: cycle([2350, 2450, 2400, 2300, 2500, 2400, 2350]),
  exercise_min: cycle([50, 55, 45, 50, 55, 50, 45]),
  vision_check: cycle([0]),
  workload: cycle([2, 3, 2, 2, 3, 2, 3]),
};

const MIRA_ROWS: Rows = {
  sleep_hours: { value: 6.4, status: "yellow" },
  mood: { value: 3, status: "green" },
  symptom_headache: { value: 1, status: "yellow" },
  symptom_dizziness: { value: 0, status: "green" },
  symptom_nausea: { value: 0, status: "green" },
  // free text: crew-only; the Earth console never renders it
  symptom_note: { value: "Mild pressure behind my eyes after waking.", status: "green" },
  bp_systolic: { value: 122, status: "green" },
  bp_diastolic: { value: 79, status: "green" },
  heart_rate: { value: 68, status: "green" },
  temperature_c: { value: 36.8, status: "green" },
  glucose_mgdl: { value: 101, status: "green" },
  water_ml: { value: 1900, status: "yellow" },
  exercise_min: { value: 30, status: "yellow" },
  vision_check: { value: 1, status: "yellow" },
  workload: { value: 4, status: "yellow" },
  day_note: { value: "Long day in the lab. Eyes felt tired by the afternoon.", status: "green" },
};

const MIRA_TASKS: Task[] = [
  {
    id: "contact_medical_officer",
    hazard: null,
    relatedKeys: ["symptom_headache", "vision_check"],
    title: bi(
      "Tell your crew medical officer how you feel",
      "Багийн эмнэлгийн офицерт өөрийн байдлаа хэлээрэй",
    ),
    why: bi(
      "Some of today's readings are in the alert range. Ground is being informed too.",
      "Өнөөдрийн зарим үзүүлэлт сэрэмжлүүлэг түвшинд байна. Дэлхийд мөн мэдэгдэж байна.",
    ),
  },
  {
    id: "vision_recheck",
    hazard: "gravity",
    relatedKeys: ["vision_check"],
    title: bi("Repeat the vision self-check this evening", "Өнөө орой хараагаа дахин шалгаарай"),
    why: bi(
      "Your vision self-check was slightly blurred. If it persists, tell your crew medical officer or flight surgeon.",
      "Таны хараа бага зэрэг бүдэг байсан. Үргэлжилбэл багийн эмнэлгийн офицер эсвэл нислэгийн эмчид хэлээрэй.",
    ),
  },
  {
    id: "sleep_wind_down",
    hazard: "isolation_confinement",
    relatedKeys: ["sleep_hours"],
    title: bi(
      "Start winding down earlier tonight and dim the lights",
      "Өнөө орой эрт амарч, гэрлээ бүдгэрүүлээрэй",
    ),
    why: bi(
      "You slept 6.4 h, about 1.1 h below your usual 7.5 h.",
      "Та 6.4 цаг унтсан нь ердийн 7.5 цагаас ойролцоогоор 1.1 цагаар бага байна.",
    ),
  },
  {
    id: "hydration_plan",
    hazard: "gravity",
    relatedKeys: ["water_ml"],
    title: bi(
      "Drink about 500 ml more, spread through the day",
      "Өдрийн турш хуваан 500 мл орчим нэмж ус уугаарай",
    ),
    why: bi(
      "You have had 1900 ml of water, below the 2000 ml demo parameter.",
      "Та 1900 мл ус уусан нь 2000 мл-ийн демо параметрээс бага байна.",
    ),
  },
];

const MIRA_ALERT: AlertRow = {
  id: "alert-mira-1",
  crewId: "mira",
  checkInId: "chk-mira-today",
  createdAt: "2026-11-14T09:05:00.000Z",
  level: "red",
  rule: "HEADACHE_PLUS_VISION",
  text: bi(
    "Alert: headache together with blurred vision. Please tell your crew medical officer. Not a diagnosis.",
    "Сэрэмжлүүлэг: толгой өвдөхийн хамт хараа бүдгэрсэн байна. Багийн эмнэлгийн офицерт мэдэгдээрэй. Онош биш.",
  ),
  acknowledgedAt: null,
};

export const miraRed: DashboardPayload = {
  crew: {
    id: "mira",
    name: "Mira",
    role: "Medical officer",
    preferredLanguage: "en",
    mascotVariant: 3,
    avatarSeed: "mira-3",
  },
  missionDay: 12,
  checkIn: { id: "chk-mira-today", confirmedAt: "2026-11-14T09:02:00.000Z", language: "en" },
  overall: "red",
  readiness: 60,
  readinessBaseline: 100,
  kpis: kpis(MIRA_ROWS, MIRA_SERIES, "voice"),
  axes: [
    { axis: "sleep", score: 60, baseline: 100, status: "yellow" },
    { axis: "cardio", score: 100, baseline: 100, status: "green" },
    { axis: "metabolic", score: 90, baseline: 100, status: "yellow" },
    { axis: "neuro_ocular", score: 73.3, baseline: 100, status: "yellow" },
    { axis: "behavioral", score: 80, baseline: 100, status: "yellow" },
    { axis: "musculoskeletal", score: 60, baseline: 100, status: "yellow" },
  ],
  hazards: [
    hazard("radiation", "not_monitored"),
    hazard("isolation_confinement", "yellow"),
    hazard("distance_from_earth", "not_monitored"),
    hazard("gravity", "yellow"),
    hazard("hostile_closed_environment", "green"),
  ],
  dayArc: [
    slot(
      "morning",
      [
        "sleep_hours",
        "mood",
        "symptom_headache",
        "symptom_dizziness",
        "symptom_nausea",
        "symptom_note",
        "bp_systolic",
        "bp_diastolic",
        "heart_rate",
        "temperature_c",
      ],
      [],
    ),
    slot("midday", ["glucose_mgdl", "water_ml"], []),
    slot("afternoon", ["exercise_min", "vision_check"], []),
    slot("evening", ["workload", "day_note"], []),
  ],
  tasks: MIRA_TASKS,
  alerts: [MIRA_ALERT],
  summary: {
    overall: "red",
    readiness: 60,
    headline: bi(
      "Alert: a few readings need attention. Readiness 60.",
      "Сэрэмжлүүлэг: хэд хэдэн үзүүлэлт анхаарал шаардаж байна. Бэлэн байдал 60.",
    ),
    findings: [
      {
        key: "vision_check",
        status: "yellow",
        reason: "combo_rule",
        value: 1,
        unit: null,
        baselineMean: 0,
        z: null,
        direction: "high",
        text: bi("Vision check: slightly blurred.", "Хараа шалгалт: бага зэрэг бүдэг."),
      },
      {
        key: "symptom_headache",
        status: "yellow",
        reason: "fixed_range",
        value: 1,
        unit: null,
        baselineMean: null,
        z: null,
        direction: "high",
        text: bi("Headache reported today.", "Өнөөдөр толгой өвдсөн гэж тэмдэглэсэн."),
      },
    ],
    recommendations: [MIRA_TASKS[0], MIRA_TASKS[1]],
    redFlags: [
      {
        rule: "HEADACHE_PLUS_VISION",
        keys: ["symptom_headache", "vision_check"],
        text: bi(
          "Headache together with blurred vision. Your crew medical officer and ground are being informed.",
          "Толгой өвдөхийн хамт хараа бүдгэрсэн. Багийн эмнэлгийн офицер болон Дэлхийд мэдэгдэж байна.",
        ),
      },
    ],
    disclaimer: DISCLAIMER,
    spoken: {
      language: "en",
      text: "Mira, a headache together with blurred vision is on the alert list today. Please tell your crew medical officer. This is decision support, not a diagnosis.",
    },
    audioTurnId: "turn-mira-summary",
  },
  link: { state: "online", lastSentAt: "2026-11-14T09:04:00.000Z", delayMs: 0, simulated: true },
  simulatedHistory: true,
};

/* ───────────── Alex: no data yet ───────────── */

const ALEX_ROWS = Object.fromEntries(KPI_KEYS.map((k) => [k, NO_VALUE])) as Rows;

const ALEX_TASKS: Task[] = [TASK_DEFAULT_HYDRATION, TASK_DEFAULT_LIGHT, TASK_DEFAULT_STRETCH];

export const alexNoData: DashboardPayload = {
  crew: {
    id: "alex",
    name: "Alex",
    role: "Commander",
    preferredLanguage: "en",
    mascotVariant: 2,
    avatarSeed: "alex-2",
  },
  missionDay: 12,
  checkIn: { id: "chk-alex-empty", confirmedAt: "2026-11-14T07:30:00.000Z", language: "en" },
  overall: "no_data",
  readiness: 0,
  readinessBaseline: null,
  kpis: kpis(ALEX_ROWS, {}, null),
  axes: (["sleep", "cardio", "metabolic", "neuro_ocular", "behavioral", "musculoskeletal"] as const).map(
    (axis): AxisScore => ({ axis, score: null, baseline: null, status: "no_data" }),
  ),
  hazards: [
    hazard("radiation", "not_monitored"),
    hazard("isolation_confinement", "no_data"),
    hazard("distance_from_earth", "not_monitored"),
    hazard("gravity", "no_data"),
    hazard("hostile_closed_environment", "no_data"),
  ],
  dayArc: [
    slot("morning", [], [
      "sleep_hours",
      "mood",
      "symptom_headache",
      "symptom_dizziness",
      "symptom_nausea",
      "bp_systolic",
      "bp_diastolic",
      "heart_rate",
      "temperature_c",
    ]),
    slot("midday", [], ["glucose_mgdl", "water_ml"]),
    slot("afternoon", [], ["exercise_min", "vision_check"]),
    slot("evening", [], ["workload"]),
  ],
  tasks: ALEX_TASKS,
  alerts: [],
  summary: {
    overall: "no_data",
    readiness: 0,
    headline: bi(
      "Not enough data yet for an overall picture.",
      "Нийт дүр зураг гаргахад өгөгдөл хараахан хүрэлцэхгүй байна.",
    ),
    findings: [],
    recommendations: [ALEX_TASKS[0], ALEX_TASKS[1]],
    redFlags: [],
    disclaimer: DISCLAIMER,
    spoken: { language: "en", text: "" },
    audioTurnId: null,
  },
  link: { state: "offline", lastSentAt: null, delayMs: 0, simulated: true },
  simulatedHistory: false,
};

/* ───────────── registry for /dev/dashboard and the tests ───────────── */

export type FixtureId = "bat-yellow" | "saraa-green" | "mira-red" | "alex-no-data";

export interface DashboardFixture {
  id: FixtureId;
  label: Record<Lang, string>;
  payload: DashboardPayload;
}

export const DASHBOARD_FIXTURES: DashboardFixture[] = [
  { id: "bat-yellow", label: { en: "Bat - watch", mn: "Бат - анхаар" }, payload: batYellow },
  { id: "saraa-green", label: { en: "Saraa - normal", mn: "Саараа - хэвийн" }, payload: saraaGreen },
  { id: "mira-red", label: { en: "Mira - alert", mn: "Мира - сэрэмжлүүлэг" }, payload: miraRed },
  { id: "alex-no-data", label: { en: "Alex - no data", mn: "Алекс - өгөгдөлгүй" }, payload: alexNoData },
];

export function getDashboardFixture(id: FixtureId): DashboardFixture {
  const found = DASHBOARD_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`Unknown dashboard fixture: ${id}`);
  return found;
}
