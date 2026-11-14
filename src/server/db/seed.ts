import "server-only";
import type { Bilingual, CrewPublic, KpiKey, Lang } from "@/lib/types";
import type { Db } from "./client";
import { localDateISO } from "./shared";

/**
 * Deterministic demo data (docs/DASHBOARD_PLAN.md section 6): 4 crew members, 14 confirmed
 * check-ins each (the 14 calendar days before `today`, confirmed around 08:30 local), every
 * numeric/boolean key every day, source 'simulated'. A mulberry32 PRNG keyed by a hash of the
 * crew member's avatarSeed makes the output identical on every run for the same `today`.
 *
 * Each continuous key's 14 noise draws are standardised (sample mean 0, sd 1) before they are
 * scaled, so the 14-day mean and sd really are the profile's numbers ("usual sleep 7.2 h").
 *
 * Seeded check-ins carry NO summary_json (the summary is computed by src/lib/health from the
 * measurements); they have no turns.
 */

export const SEED_DAYS = 14;

/** Numeric/boolean keys seeded every day (the 14 non-text keys), in storage order. */
export const SEED_KEYS = [
  "sleep_hours",
  "mood",
  "symptom_headache",
  "symptom_dizziness",
  "symptom_nausea",
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "glucose_mgdl",
  "water_ml",
  "exercise_min",
  "vision_check",
  "workload",
] as const satisfies readonly KpiKey[];
export type SeedKey = (typeof SEED_KEYS)[number];

const UNITS: Record<SeedKey, string | null> = {
  sleep_hours: "h",
  mood: null,
  symptom_headache: null,
  symptom_dizziness: null,
  symptom_nausea: null,
  bp_systolic: "mmHg",
  bp_diastolic: "mmHg",
  heart_rate: "bpm",
  temperature_c: "°C",
  glucose_mgdl: "mg/dL",
  water_ml: "ml",
  exercise_min: "min",
  vision_check: null,
  workload: null,
};

/** Hard plausibility ranges (docs/DASHBOARD_PLAN.md section 1); the seed clamps into them. */
const HARD: Record<SeedKey, readonly [number, number]> = {
  sleep_hours: [0, 14],
  mood: [1, 5],
  symptom_headache: [0, 1],
  symptom_dizziness: [0, 1],
  symptom_nausea: [0, 1],
  bp_systolic: [70, 220],
  bp_diastolic: [40, 140],
  heart_rate: [30, 200],
  temperature_c: [34, 42],
  glucose_mgdl: [40, 400],
  water_ml: [0, 6000],
  exercise_min: [0, 240],
  vision_check: [0, 2],
  workload: [1, 5],
};

type ContinuousKey =
  | "sleep_hours"
  | "mood"
  | "bp_systolic"
  | "bp_diastolic"
  | "heart_rate"
  | "temperature_c"
  | "glucose_mgdl"
  | "water_ml"
  | "exercise_min"
  | "workload";
const CONTINUOUS_KEYS: readonly ContinuousKey[] = [
  "sleep_hours",
  "mood",
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "glucose_mgdl",
  "water_ml",
  "exercise_min",
  "workload",
];

interface Spec {
  mean: number;
  sd: number;
  decimals: number;
}
type Story = "steady" | "bp_creep" | "headache_vision";

interface Profile extends CrewPublic {
  story: Story;
  spec: Record<ContinuousKey, Spec>;
}

export const SEED_CREW: readonly Profile[] = [
  {
    id: "bat",
    name: "Bat",
    role: "Flight engineer",
    preferredLanguage: "mn",
    mascotVariant: 0,
    avatarSeed: "bat-0",
    story: "steady",
    spec: {
      sleep_hours: { mean: 7.2, sd: 0.5, decimals: 1 },
      mood: { mean: 4, sd: 0.35, decimals: 0 },
      bp_systolic: { mean: 120, sd: 4, decimals: 0 },
      bp_diastolic: { mean: 78, sd: 3, decimals: 0 },
      heart_rate: { mean: 66, sd: 3, decimals: 0 },
      temperature_c: { mean: 36.6, sd: 0.15, decimals: 1 },
      glucose_mgdl: { mean: 95, sd: 8, decimals: 0 },
      water_ml: { mean: 2300, sd: 200, decimals: 0 },
      exercise_min: { mean: 45, sd: 8, decimals: 0 },
      workload: { mean: 3, sd: 1, decimals: 0 },
    },
  },
  {
    id: "saraa",
    name: "Saraa",
    role: "Mission specialist",
    preferredLanguage: "mn",
    mascotVariant: 1,
    avatarSeed: "saraa-1",
    story: "steady",
    spec: {
      sleep_hours: { mean: 7.8, sd: 0.3, decimals: 1 },
      mood: { mean: 4, sd: 0.35, decimals: 0 },
      bp_systolic: { mean: 114, sd: 3, decimals: 0 },
      bp_diastolic: { mean: 74, sd: 2, decimals: 0 },
      heart_rate: { mean: 62, sd: 3, decimals: 0 },
      temperature_c: { mean: 36.5, sd: 0.15, decimals: 1 },
      glucose_mgdl: { mean: 90, sd: 7, decimals: 0 },
      water_ml: { mean: 2500, sd: 150, decimals: 0 },
      exercise_min: { mean: 58, sd: 5, decimals: 0 },
      workload: { mean: 2, sd: 0.7, decimals: 0 },
    },
  },
  {
    id: "alex",
    name: "Alex",
    role: "Commander",
    preferredLanguage: "en",
    mascotVariant: 2,
    avatarSeed: "alex-2",
    story: "bp_creep",
    spec: {
      sleep_hours: { mean: 7.4, sd: 0.4, decimals: 1 },
      mood: { mean: 4, sd: 0.35, decimals: 0 },
      // pre-creep level; the creep itself is added on top (see generateDays)
      bp_systolic: { mean: 122, sd: 1.2, decimals: 0 },
      bp_diastolic: { mean: 80, sd: 0.8, decimals: 0 },
      heart_rate: { mean: 70, sd: 3, decimals: 0 },
      temperature_c: { mean: 36.7, sd: 0.15, decimals: 1 },
      glucose_mgdl: { mean: 100, sd: 7, decimals: 0 },
      water_ml: { mean: 2300, sd: 150, decimals: 0 },
      exercise_min: { mean: 52, sd: 5, decimals: 0 },
      workload: { mean: 2.6, sd: 0.7, decimals: 0 },
    },
  },
  {
    id: "mira",
    name: "Mira",
    role: "Medical officer",
    preferredLanguage: "en",
    mascotVariant: 3,
    avatarSeed: "mira-3",
    story: "headache_vision",
    spec: {
      sleep_hours: { mean: 7.5, sd: 0.3, decimals: 1 },
      mood: { mean: 4, sd: 0.35, decimals: 0 },
      bp_systolic: { mean: 116, sd: 3, decimals: 0 },
      bp_diastolic: { mean: 76, sd: 2, decimals: 0 },
      heart_rate: { mean: 64, sd: 3, decimals: 0 },
      temperature_c: { mean: 36.6, sd: 0.15, decimals: 1 },
      glucose_mgdl: { mean: 92, sd: 6, decimals: 0 },
      water_ml: { mean: 2400, sd: 150, decimals: 0 },
      exercise_min: { mean: 55, sd: 5, decimals: 0 },
      workload: { mean: 2.4, sd: 0.7, decimals: 0 },
    },
  },
];

const NOTES: Record<Lang, readonly string[]> = {
  en: [
    "Slept well, feeling rested.",
    "Long maintenance shift today.",
    "Good workout, legs feel strong.",
    "A bit tired after the experiment run.",
    "Nice call with family.",
  ],
  mn: [
    "Сайн унтсан, амарсан.",
    "Өнөөдөр засвар үйлчилгээний ээлж урт байлаа.",
    "Дасгал сайн хийлээ.",
    "Туршилтын дараа бага зэрэг ядарсан.",
    "Гэр бүлтэйгээ сайхан ярилцлаа.",
  ],
};

const MIRA_ALERT_TEXT: Bilingual = {
  en: "Alert: headache together with blurred vision was reported. This is an alert, not a diagnosis. Your crew medical officer and ground have been informed (simulated link).",
  mn: "Анхааруулга: толгой өвдөх болон хараа бүдгэрэх мэдээлэл ирлээ. Энэ бол анхааруулга, онош биш. Багийн эмч болон Дэлхийн төв мэдэгдсэн (дуурайсан холбоо).",
};

/* ───────────── deterministic PRNG ───────────── */

/** FNV-1a 32-bit hash of a string. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, well-distributed 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function standardise(xs: number[]): number[] {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return xs.map((x) => (x - mean) / sd);
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function clamp(key: SeedKey, v: number): number {
  const [lo, hi] = HARD[key];
  return Math.min(hi, Math.max(lo, v));
}

/* ───────────── generation ───────────── */

interface SeedDay {
  /** 0 = oldest of the 14 days, 13 = yesterday */
  index: number;
  values: Record<SeedKey, number>;
  note: string | null;
}

/** Pure and deterministic: depends only on the profile. */
function generateDays(p: Profile): SeedDay[] {
  const rng = mulberry32(hashSeed(p.avatarSeed));

  const z = {} as Record<ContinuousKey, number[]>;
  for (const key of CONTINUOUS_KEYS) {
    z[key] = standardise(Array.from({ length: SEED_DAYS }, () => gaussian(rng)));
  }

  // three distinct days (never yesterday) get a short free-text note
  const noteDays = new Set<number>();
  while (noteDays.size < 3) noteDays.add(Math.floor(rng() * (SEED_DAYS - 1)));
  const noteChoice = Array.from({ length: SEED_DAYS }, () => Math.floor(rng() * NOTES[p.preferredLanguage].length));

  const days: SeedDay[] = [];
  for (let i = 0; i < SEED_DAYS; i++) {
    const values = {} as Record<SeedKey, number>;
    for (const key of CONTINUOUS_KEYS) {
      const s = p.spec[key];
      let v = s.mean + s.sd * z[key][i];
      if (p.story === "bp_creep") {
        // last 6 days: systolic +2/day, diastolic +1/day on top of the steady level
        const creepDay = i - (SEED_DAYS - 7); // 1..6 for the last six days, <= 0 before
        if (creepDay > 0 && key === "bp_systolic") v += 2 * creepDay;
        if (creepDay > 0 && key === "bp_diastolic") v += creepDay;
      }
      values[key] = round(clamp(key, v), s.decimals);
    }
    values.symptom_headache = 0;
    values.symptom_dizziness = 0;
    values.symptom_nausea = 0;
    values.vision_check = 0;

    if (p.story === "headache_vision" && i === SEED_DAYS - 1) {
      // yesterday: headache + slightly blurred vision, everything else exactly "normal"
      for (const key of CONTINUOUS_KEYS) {
        const s = p.spec[key];
        values[key] = round(clamp(key, s.mean), s.decimals);
      }
      values.symptom_headache = 1;
      values.vision_check = 1;
    }

    days.push({
      index: i,
      values,
      note: noteDays.has(i) ? NOTES[p.preferredLanguage][noteChoice[i]] : null,
    });
  }
  return days;
}

/* ───────────── persistence ───────────── */

export interface SeedOptions {
  /** reference "today" (the 14 days BEFORE its local date are seeded); default: now */
  today?: Date;
  /** delete every existing row first (CLI does this). Without it the seed is additive/idempotent. */
  wipe?: boolean;
}

export interface SeedResult {
  crew: number;
  checkIns: number;
  measurements: number;
  alerts: number;
  /** seeded local dates, oldest first */
  dates: string[];
}

/** Local 08:30 (+ a deterministic offset of -8..+12 minutes) on the calendar day `daysBefore` days before today. */
function confirmedAtFor(today: Date, daysBefore: number, offsetMin: number): Date {
  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - daysBefore,
    8,
    30 + offsetMin,
    0,
    0,
  );
}

export function seedDatabase(db: Db, opts: SeedOptions = {}): SeedResult {
  const today = opts.today ?? new Date();
  const result: SeedResult = { crew: 0, checkIns: 0, measurements: 0, alerts: 0, dates: [] };

  const run = db.transaction(() => {
    if (opts.wipe) {
      for (const table of ["alert", "turn", "measurement", "check_in", "crew_member"]) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
    }

    const upsertCrew = db.prepare(
      `INSERT INTO crew_member (id, name, role, preferred_language, mascot_variant, avatar_seed)
       VALUES (@id, @name, @role, @lang, @mascot, @seed)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, role = excluded.role,
         preferred_language = excluded.preferred_language, mascot_variant = excluded.mascot_variant,
         avatar_seed = excluded.avatar_seed`,
    );
    const insertCheckIn = db.prepare(
      `INSERT OR IGNORE INTO check_in
         (id, crew_id, started_at, confirmed_at, local_date, language, summary_json, state, state_json)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'DONE', '{}')`,
    );
    const insertMeasurement = db.prepare(
      `INSERT OR IGNORE INTO measurement
         (id, check_in_id, crew_id, key, value, value_text, unit, source_text, confidence, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'simulated', ?)`,
    );
    const insertAlert = db.prepare(
      `INSERT OR IGNORE INTO alert (id, crew_id, check_in_id, created_at, level, rule, text_json)
       VALUES (?, ?, ?, ?, 'red', 'HEADACHE_PLUS_VISION', ?)`,
    );

    for (const profile of SEED_CREW) {
      upsertCrew.run({
        id: profile.id,
        name: profile.name,
        role: profile.role,
        lang: profile.preferredLanguage,
        mascot: profile.mascotVariant,
        seed: profile.avatarSeed,
      });
      result.crew += 1;

      // separate stream for time jitter so it never perturbs the value draws
      const timeRng = mulberry32(hashSeed(`${profile.avatarSeed}:time`));
      const days = generateDays(profile);

      for (const day of days) {
        const daysBefore = SEED_DAYS - day.index;
        const confirmed = confirmedAtFor(today, daysBefore, Math.floor(timeRng() * 21) - 8);
        const started = new Date(confirmed.getTime() - 6 * 60_000);
        const localDate = localDateISO(started);
        const checkInId = `ci-${profile.id}-${localDate}`;

        insertCheckIn.run(
          checkInId,
          profile.id,
          started.toISOString(),
          confirmed.toISOString(),
          localDate,
          profile.preferredLanguage,
        );
        result.checkIns += 1;
        if (!result.dates.includes(localDate)) result.dates.push(localDate);

        let n = 0;
        const at = () => new Date(started.getTime() + (n++ + 1) * 20_000).toISOString();
        for (const key of SEED_KEYS) {
          insertMeasurement.run(`${checkInId}:${key}`, checkInId, profile.id, key, day.values[key], null, UNITS[key], at());
          result.measurements += 1;
        }
        if (day.note !== null) {
          insertMeasurement.run(`${checkInId}:day_note`, checkInId, profile.id, "day_note", null, day.note, null, at());
          result.measurements += 1;
        }

        if (profile.story === "headache_vision" && day.index === SEED_DAYS - 1) {
          insertAlert.run(
            `al-${checkInId}-HEADACHE_PLUS_VISION`,
            profile.id,
            checkInId,
            new Date(confirmed.getTime() + 1_000).toISOString(),
            JSON.stringify(MIRA_ALERT_TEXT),
          );
          result.alerts += 1;
        }
      }
    }
    result.dates.sort();
  });
  run();
  return result;
}

/** Seeds only when there is no crew member yet. Returns null when nothing was done. */
export function seedIfEmpty(db: Db, opts: Omit<SeedOptions, "wipe"> = {}): SeedResult | null {
  const row = db.prepare("SELECT COUNT(*) AS n FROM crew_member").get() as { n: number };
  return row.n > 0 ? null : seedDatabase(db, opts);
}
