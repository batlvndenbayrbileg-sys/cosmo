import "server-only";
import { evaluateDay, type HistoryDay } from "@/lib/health";
import type { Bilingual, CrewPublic, KpiKey, Lang } from "@/lib/types";
import { composeTemplateSummary } from "@/server/dashboard/template";
import type { Db, Queryable } from "./client";
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
 * Only the LAST seeded check-in of each crew member carries a summary_json (a SummaryPayload with
 * template spoken text in the member's language, computed by src/lib/health from the seeded
 * values), so the Earth console has summaries from the start. Older seeded check-ins have none
 * and no turns. Mira's last day also gets the HEADACHE_PLUS_VISION alert, worded by the red flag
 * that evaluateDay produces for it.
 *
 * Bat is the demo user: his last seeded day is forced calm (workload capped at the demo "green"
 * bound) so it evaluates green overall, whatever the noise draw was.
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

/** demo "green" bound of workload (docs/DASHBOARD_PLAN.md section 1.1: high yellow 3) */
const CALM_WORKLOAD = 3;

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

    if (p.story === "steady" && i === SEED_DAYS - 1) {
      // the demo user's (and Saraa's) latest day must read green: no workload spike on the last day
      values.workload = Math.min(values.workload, CALM_WORKLOAD);
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

/** most rows per multi-row INSERT (well under SQLite's and Postgres's bound-parameter limits) */
const BATCH_ROWS = 200;

/**
 * Inserts `rows` with multi-row VALUES statements, in order (so insertion order, the `rowid`/`seq` tie-breaker, is the
 * same as one INSERT per row). `values` is one row's VALUES tuple, e.g. "(?, ?, NULL)"; `tail` follows the VALUES list.
 */
async function insertRows(
  tx: Queryable,
  head: string,
  values: string,
  rows: readonly unknown[][],
  tail = "",
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const chunk = rows.slice(i, i + BATCH_ROWS);
    await tx.run(`${head} VALUES ${chunk.map(() => values).join(", ")}${tail}`, ...chunk.flat());
  }
}

export async function seedDatabase(db: Db, opts: SeedOptions = {}): Promise<SeedResult> {
  const today = opts.today ?? new Date();
  const result: SeedResult = { crew: 0, checkIns: 0, measurements: 0, alerts: 0, dates: [] };

  // everything is computed first (pure and deterministic), then written in one transaction
  const crewRows: unknown[][] = [];
  const checkInRows: unknown[][] = [];
  const measurementRows: unknown[][] = [];
  const summaryRows: Array<[summaryJson: string, checkInId: string, crewId: string]> = [];
  const alertRows: unknown[][] = [];

  for (const profile of SEED_CREW) {
    crewRows.push([
      profile.id,
      profile.name,
      profile.role,
      profile.preferredLanguage,
      profile.mascotVariant,
      profile.avatarSeed,
    ]);
    result.crew += 1;

    // separate stream for time jitter so it never perturbs the value draws
    const timeRng = mulberry32(hashSeed(`${profile.avatarSeed}:time`));
    const days = generateDays(profile);
    /** confirmed days before the one being written, for the baseline of the last day's summary */
    const history: HistoryDay[] = [];

    for (const day of days) {
      const daysBefore = SEED_DAYS - day.index;
      const confirmed = confirmedAtFor(today, daysBefore, Math.floor(timeRng() * 21) - 8);
      const started = new Date(confirmed.getTime() - 6 * 60_000);
      const localDate = localDateISO(started);
      const checkInId = `ci-${profile.id}-${localDate}`;

      checkInRows.push([
        checkInId,
        profile.id,
        started.toISOString(),
        confirmed.toISOString(),
        localDate,
        profile.preferredLanguage,
      ]);
      result.checkIns += 1;
      if (!result.dates.includes(localDate)) result.dates.push(localDate);

      let n = 0;
      const at = () => new Date(started.getTime() + (n++ + 1) * 20_000).toISOString();
      for (const key of SEED_KEYS) {
        measurementRows.push([`${checkInId}:${key}`, checkInId, profile.id, key, day.values[key], null, UNITS[key], at()]);
        result.measurements += 1;
      }
      if (day.note !== null) {
        measurementRows.push([`${checkInId}:day_note`, checkInId, profile.id, "day_note", null, day.note, null, at()]);
        result.measurements += 1;
      }

      const values: HistoryDay["values"] = { ...day.values };
      if (day.note !== null) values.day_note = day.note;

      if (day.index === SEED_DAYS - 1) {
        // last seeded check-in: stored summary (template wording) so ground has it from the start
        const evaluation = evaluateDay(values, history);
        const summary = composeTemplateSummary(evaluation.summary, profile.preferredLanguage);
        summaryRows.push([JSON.stringify(summary), checkInId, profile.id]);

        if (profile.story === "headache_vision") {
          const flag = evaluation.redFlags.find((f) => f.rule === "HEADACHE_PLUS_VISION");
          if (!flag) throw new Error("seed: Mira's last day must raise HEADACHE_PLUS_VISION");
          const text: Bilingual = flag.text;
          alertRows.push([
            `al-${checkInId}-HEADACHE_PLUS_VISION`,
            profile.id,
            checkInId,
            new Date(confirmed.getTime() + 1_000).toISOString(),
            "red",
            "HEADACHE_PLUS_VISION",
            JSON.stringify(text),
          ]);
          result.alerts += 1;
        }
      }
      history.push({ date: localDate, values });
    }
  }
  result.dates.sort();

  await db.transaction(async (tx) => {
    if (opts.wipe) {
      for (const table of ["sos_alert", "alert", "turn", "measurement", "check_in", "crew_member"]) {
        await tx.run(`DELETE FROM ${table}`);
      }
    }

    await insertRows(
      tx,
      "INSERT INTO crew_member (id, name, role, preferred_language, mascot_variant, avatar_seed)",
      "(?, ?, ?, ?, ?, ?)",
      crewRows,
      ` ON CONFLICT (id) DO UPDATE SET name = excluded.name, role = excluded.role,
         preferred_language = excluded.preferred_language, mascot_variant = excluded.mascot_variant,
         avatar_seed = excluded.avatar_seed`,
    );
    await insertRows(
      tx,
      `INSERT OR IGNORE INTO check_in
         (id, crew_id, started_at, confirmed_at, local_date, language, summary_json, state, state_json)`,
      "(?, ?, ?, ?, ?, ?, NULL, 'DONE', '{}')",
      checkInRows,
    );
    await insertRows(
      tx,
      `INSERT OR IGNORE INTO measurement
         (id, check_in_id, crew_id, key, value, value_text, unit, source_text, confidence, source, created_at)`,
      "(?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'simulated', ?)",
      measurementRows,
    );
    for (const [summaryJson, checkInId, crewId] of summaryRows) {
      await tx.run(
        "UPDATE check_in SET summary_json = ? WHERE id = ? AND crew_id = ? AND summary_json IS NULL",
        summaryJson,
        checkInId,
        crewId,
      );
    }
    // same columns as repos/alert.insertAlert, but written on the `db` handle that is being seeded
    // (the repo functions always use the process-wide getDb() singleton)
    await insertRows(
      tx,
      "INSERT OR IGNORE INTO alert (id, crew_id, check_in_id, created_at, level, rule, text_json)",
      "(?, ?, ?, ?, ?, ?, ?)",
      alertRows,
    );
  });
  return result;
}

/** Seeds only when there is no crew member yet. Returns null when nothing was done. */
export async function seedIfEmpty(db: Db, opts: Omit<SeedOptions, "wipe"> = {}): Promise<SeedResult | null> {
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM crew_member");
  return Number(row?.n ?? 0) > 0 ? null : seedDatabase(db, opts);
}
