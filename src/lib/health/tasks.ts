/**
 * Daily plan (docs/DASHBOARD_PLAN.md section 2, step 10): 3-4 lifestyle tasks, each with a "why" whose numbers are
 * computed here. Never a diagnosis, a drug or a treatment; medical questions point to the crew medical officer
 * or flight surgeon. Most relevant first; always padded with defaults up to 3.
 */

import type { Bilingual, HazardKey, KpiKey, MeasurementValue, RedFlag, Task } from "../types";
import { KPI_DEFS, asNumber, formatValue } from "../kpi/registry";
import type { Baseline } from "./baseline";
import { formatNumber } from "./format";
import type { IndicatorEval } from "./status";

export interface TaskContext {
  today: Partial<Record<KpiKey, MeasurementValue>>;
  indicators: Record<KpiKey, IndicatorEval>;
  baselines: Partial<Record<KpiKey, Baseline>>;
  redFlags: RedFlag[];
}

export const MIN_TASKS = 3;
export const MAX_TASKS = 4;

interface Candidate {
  task: Task;
  /** 3 = red flag, 2 = red indicator, 1 = yellow indicator */
  severity: number;
  absZ: number;
}

function val(ctx: TaskContext, key: KpiKey): number | null {
  return asNumber(ctx.today[key]);
}

/** the person's own usual value, when a baseline exists */
function usual(ctx: TaskContext, key: KpiKey): number | null {
  return ctx.baselines[key]?.mean ?? null;
}

function isFlagged(ctx: TaskContext, key: KpiKey): boolean {
  const s = ctx.indicators[key].status;
  return s === "yellow" || s === "red";
}

function severityOf(ctx: TaskContext, key: KpiKey): number {
  return ctx.indicators[key].status === "red" ? 2 : 1;
}

function absZ(ctx: TaskContext, key: KpiKey): number {
  const z = ctx.indicators[key].z;
  return z === null ? 0 : Math.abs(z);
}

/** value is on the low side: under the fixed demo range, or (baseline reason) under the person's usual */
function isLowSide(ctx: TaskContext, key: KpiKey): boolean {
  const v = val(ctx, key);
  if (v === null || !isFlagged(ctx, key)) return false;
  const low = KPI_DEFS[key].thresholds?.low;
  if (low && v < low.yellow) return true;
  const ev = ctx.indicators[key];
  return ev.reason === "baseline" && ev.delta !== null && ev.delta < 0;
}

function hazardOf(key: KpiKey): HazardKey | null {
  return KPI_DEFS[key].hazards[0] ?? null;
}

const OFFICER_EN = "For any medical question, ask your crew medical officer or flight surgeon.";
const OFFICER_MN = "Эрүүл мэндийн асуулт байвал багийн эмнэлгийн офицер эсвэл нислэгийн эмчээс асуугаарай.";

/* ───────────── rule builders (each returns null when the rule does not apply) ───────────── */

function medicalOfficerTask(ctx: TaskContext): Candidate | null {
  if (ctx.redFlags.length === 0) return null;
  return {
    severity: 3,
    absZ: 0,
    task: {
      id: "contact_medical_officer",
      hazard: null,
      relatedKeys: ctx.redFlags.flatMap((f) => f.keys).filter((k, i, a) => a.indexOf(k) === i),
      title: {
        en: "Tell your crew medical officer how you feel",
        mn: "Багийн эмнэлгийн офицертоо биеийн байдлаа хэлээрэй",
      },
      why: {
        en: "Some of today's readings are in the alert range. Ground is being informed too.",
        mn: "Өнөөдрийн зарим заалт анхаарах түвшинд байна. Газрын хяналтад мөн мэдэгдэнэ.",
      },
    },
  };
}

function sleepTask(ctx: TaskContext): Candidate | null {
  const v = val(ctx, "sleep_hours");
  if (v === null || !isLowSide(ctx, "sleep_hours")) return null;
  const m = usual(ctx, "sleep_hours");
  const below = m !== null ? m - v : 0;
  const vs = formatNumber(v, 1);
  let why: Bilingual;
  if (m !== null && formatNumber(below, 1) !== "0" && below > 0) {
    const d = formatNumber(below, 1);
    const ms = formatNumber(m, 1);
    why = {
      en: `You slept ${vs} h, about ${d} h below your usual ${ms} h.`,
      mn: `Та ${vs} цаг унтсан нь ердийн ${ms} цагаас ойролцоогоор ${d} цагаар бага байна.`,
    };
  } else {
    const t = formatNumber(KPI_DEFS.sleep_hours.thresholds?.low?.yellow ?? 7, 1);
    why = {
      en: `You slept ${vs} h, below the ${t} h demo parameter.`,
      mn: `Та ${vs} цаг унтсан нь ${t} цагийн демо параметрээс бага байна.`,
    };
  }
  return {
    severity: severityOf(ctx, "sleep_hours"),
    absZ: absZ(ctx, "sleep_hours"),
    task: {
      id: "sleep_wind_down",
      hazard: hazardOf("sleep_hours"),
      relatedKeys: ["sleep_hours"],
      title: {
        en: "Start winding down earlier tonight and dim the lights",
        mn: "Өнөө орой эрт амарч, гэрлээ бүдгэрүүлээрэй",
      },
      why,
    },
  };
}

function hydrationTask(ctx: TaskContext): Candidate | null {
  const v = val(ctx, "water_ml");
  if (v === null || !isLowSide(ctx, "water_ml")) return null;
  const m = usual(ctx, "water_ml");
  const thr = KPI_DEFS.water_ml.thresholds?.low?.yellow ?? 2000;
  const target = m !== null && m > v ? m : thr;
  const amount = Math.ceil(Math.max(target - v, 250) / 50) * 50;
  const vs = formatNumber(v, 0);
  let why: Bilingual;
  if (m !== null && formatNumber(m - v, 0) !== "0" && m - v > 0) {
    why = {
      en: `You have had ${vs} ml of water, about ${formatNumber(m - v, 0)} ml below your usual ${formatNumber(m, 0)} ml.`,
      mn: `Та ${vs} мл ус уусан нь ердийн ${formatNumber(m, 0)} мл-ээс ойролцоогоор ${formatNumber(m - v, 0)} мл-ээр бага байна.`,
    };
  } else {
    why = {
      en: `You have had ${vs} ml of water, below the ${formatNumber(thr, 0)} ml demo parameter.`,
      mn: `Та ${vs} мл ус уусан нь ${formatNumber(thr, 0)} мл-ийн демо параметрээс бага байна.`,
    };
  }
  return {
    severity: severityOf(ctx, "water_ml"),
    absZ: absZ(ctx, "water_ml"),
    task: {
      id: "hydration_plan",
      hazard: hazardOf("water_ml"),
      relatedKeys: ["water_ml"],
      title: {
        en: `Drink about ${amount} ml more, spread through the day`,
        mn: `Өдрийн турш ойролцоогоор ${amount} мл ус нэмж уугаарай`,
      },
      why,
    },
  };
}

function exerciseTask(ctx: TaskContext): Candidate | null {
  const v = val(ctx, "exercise_min");
  if (v === null || !isLowSide(ctx, "exercise_min")) return null;
  const m = usual(ctx, "exercise_min");
  const thr = KPI_DEFS.exercise_min.thresholds?.low?.yellow ?? 45;
  const vs = formatNumber(v, 0);
  let why: Bilingual;
  if (m !== null && formatNumber(m - v, 0) !== "0" && m - v > 0) {
    why = {
      en: `You logged ${vs} min of exercise, about ${formatNumber(m - v, 0)} min below your usual ${formatNumber(m, 0)} min.`,
      mn: `Та ${vs} мин дасгал хийсэн нь ердийн ${formatNumber(m, 0)} минутаас ${formatNumber(m - v, 0)} минутаар бага байна.`,
    };
  } else {
    why = {
      en: `You logged ${vs} min of exercise, below the ${formatNumber(thr, 0)} min demo parameter.`,
      mn: `Та ${vs} мин дасгал хийсэн нь ${formatNumber(thr, 0)} минутын демо параметрээс бага байна.`,
    };
  }
  return {
    severity: severityOf(ctx, "exercise_min"),
    absZ: absZ(ctx, "exercise_min"),
    task: {
      id: "exercise_session",
      hazard: hazardOf("exercise_min"),
      relatedKeys: ["exercise_min"],
      title: {
        en: `Schedule a ${formatNumber(thr, 0)}-minute exercise session`,
        mn: `${formatNumber(thr, 0)} минутын дасгалын цагаа товлоорой`,
      },
      why,
    },
  };
}

function breakTask(ctx: TaskContext): Candidate | null {
  const mood = val(ctx, "mood");
  const work = val(ctx, "workload");
  const moodLow = mood !== null && isLowSide(ctx, "mood");
  const workHigh =
    work !== null && isFlagged(ctx, "workload") && work > (KPI_DEFS.workload.thresholds?.high?.yellow ?? 3);
  if (!moodLow && !workHigh) return null;

  const moodText = mood !== null ? formatNumber(mood, 0) : "";
  const workText = work !== null ? formatNumber(work, 0) : "";
  let why: Bilingual;
  if (moodLow && workHigh) {
    why = {
      en: `Your mood was ${moodText} out of 5 and today's workload was ${workText} out of 5.`,
      mn: `Өнөөдөр сэтгэл санаа ${moodText}/5, ажлын ачаалал ${workText}/5 байна.`,
    };
  } else if (moodLow) {
    why = {
      en: `Your mood was ${moodText} out of 5.`,
      mn: `Өнөөдөр сэтгэл санаа ${moodText}/5 байна.`,
    };
  } else {
    why = {
      en: `Today's workload was ${workText} out of 5.`,
      mn: `Өнөөдрийн ажлын ачаалал ${workText}/5 байлаа.`,
    };
  }
  const keys: KpiKey[] = [];
  if (moodLow) keys.push("mood");
  if (workHigh) keys.push("workload");
  // the wellbeing check's other answers that are flagged (high stress, feeling far from people) are part of the same task
  for (const k of ["stress", "connection"] as const) if (val(ctx, k) !== null && isFlagged(ctx, k)) keys.push(k);
  return {
    severity: Math.max(...keys.map((k) => severityOf(ctx, k))),
    absZ: Math.max(...keys.map((k) => absZ(ctx, k))),
    task: {
      id: "short_break_connect",
      hazard: "isolation_confinement",
      relatedKeys: keys,
      title: {
        en: "Take a short break and talk with a crew member or family",
        mn: "Богино амарч, багийн гишүүн эсвэл гэр бүлтэйгээ ярилцаарай",
      },
      why,
    },
  };
}

/**
 * The wellbeing check (docs/research/checkin-nasa.md): high stress or feeling far from people, when mood and workload
 * did not already raise the break task. A lifestyle step and who to talk to, never a diagnosis.
 */
function wellbeingTask(ctx: TaskContext): Candidate | null {
  if (breakTask(ctx)) return null;
  const stress = val(ctx, "stress");
  const conn = val(ctx, "connection");
  const stressHigh = stress !== null && isFlagged(ctx, "stress") && stress > (KPI_DEFS.stress.thresholds?.high?.yellow ?? 3);
  const connLow = conn !== null && isFlagged(ctx, "connection") && isLowSide(ctx, "connection");
  if (!stressHigh && !connLow) return null;
  const keys: KpiKey[] = [];
  if (stressHigh) keys.push("stress");
  if (connLow) keys.push("connection");
  const parts: Bilingual[] = [];
  if (stressHigh) {
    parts.push({ en: `You rated your stress ${formatNumber(stress as number, 0)} out of 5.`, mn: `Стрессээ ${formatNumber(stress as number, 0)}/5 гэж үнэлсэн.` });
  }
  if (connLow) {
    parts.push({ en: `You rated feeling connected ${formatNumber(conn as number, 0)} out of 5.`, mn: `Ойр дотно байдлаа ${formatNumber(conn as number, 0)}/5 гэж үнэлсэн.` });
  }
  return {
    severity: 1,
    absZ: Math.max(...keys.map((k) => absZ(ctx, k))),
    task: {
      id: "wellbeing_connect",
      hazard: "isolation_confinement",
      relatedKeys: keys,
      title: {
        en: connLow ? "Plan a call home or time with a crewmate" : "Take a short pause and talk it through with someone",
        mn: connLow ? "Гэр лүүгээ залгах эсвэл багийн гишүүнтэйгээ цагийг төлөвлөөрэй" : "Түр завсарлаж, хэн нэгэнтэй ярилцаарай",
      },
      why: {
        en: `${parts.map((p) => p.en).join(" ")} The flight surgeon and the psychological support team on Earth are there to talk any time.`,
        mn: `${parts.map((p) => p.mn).join(" ")} Нислэгийн эмч болон Дэлхий дээрх сэтгэл зүйн дэмжлэгийн баг хүссэн үед ярилцахад бэлэн.`,
      },
    },
  };
}

function visionTask(ctx: TaskContext): Candidate | null {
  const v = val(ctx, "vision_check");
  if (v === null || !isFlagged(ctx, "vision_check")) return null;
  const en = formatValue("vision_check", v, "en").toLowerCase();
  const mn = formatValue("vision_check", v, "mn").toLowerCase();
  return {
    severity: severityOf(ctx, "vision_check"),
    absZ: absZ(ctx, "vision_check"),
    task: {
      id: "vision_recheck",
      hazard: hazardOf("vision_check"),
      relatedKeys: ["vision_check"],
      title: {
        en: "Repeat the vision self-check this evening",
        mn: "Өнөө орой хараагаа дахин шалгаарай",
      },
      why: {
        en: `Your vision self-check was ${en}. If it persists, tell your crew medical officer or flight surgeon.`,
        mn: `Хараа шалгалтын үр дүн: ${mn}. Үргэлжилбэл багийн эмнэлгийн офицер эсвэл нислэгийн эмчид хэлээрэй.`,
      },
    },
  };
}

function glucoseTask(ctx: TaskContext): Candidate | null {
  const v = val(ctx, "glucose_mgdl");
  if (v === null || !isFlagged(ctx, "glucose_mgdl")) return null;
  const th = KPI_DEFS.glucose_mgdl.thresholds;
  const above = th?.high !== undefined && v > th.high.yellow;
  const below = th?.low !== undefined && v < th.low.yellow;
  const dirEn = above ? "above" : below ? "below" : "outside";
  const dirMn = above ? "дээгүүр" : below ? "доогуур" : "гадуур";
  const vs = formatNumber(v, 0);
  return {
    severity: severityOf(ctx, "glucose_mgdl"),
    absZ: absZ(ctx, "glucose_mgdl"),
    task: {
      id: "glucose_meal_schedule",
      hazard: hazardOf("glucose_mgdl"),
      relatedKeys: ["glucose_mgdl"],
      title: {
        en: "Keep your next meal on schedule and measure again later",
        mn: "Дараагийн хоолоо цагтаа идэж, дараа нь дахин хэмжээрэй",
      },
      why: {
        en: `Blood glucose was ${vs} mg/dL, ${dirEn} the demo range. ${OFFICER_EN}`,
        mn: `Цусны сахар ${vs} mg/dL байна, демо мужаас ${dirMn}. ${OFFICER_MN}`,
      },
    },
  };
}

const VITAL_RECHECK_KEYS: KpiKey[] = ["bp_systolic", "bp_diastolic", "heart_rate", "temperature_c"];

function vitalsTask(ctx: TaskContext): Candidate | null {
  const flagged = VITAL_RECHECK_KEYS.filter((k) => val(ctx, k) !== null && isFlagged(ctx, k));
  if (flagged.length === 0) return null;
  // describe the most notable one: red first, then |z|
  const lead = [...flagged].sort(
    (a, b) => severityOf(ctx, b) - severityOf(ctx, a) || absZ(ctx, b) - absZ(ctx, a),
  )[0];
  const v = val(ctx, lead) as number;
  const th = KPI_DEFS[lead].thresholds;
  const above = th?.high !== undefined && v > th.high.yellow;
  const below = th?.low !== undefined && v < th.low.yellow;
  const dirEn = above ? "above" : below ? "below" : "away from";
  const dirMn = above ? "дээгүүр" : below ? "доогуур" : "зөрүүтэй";
  return {
    severity: Math.max(...flagged.map((k) => severityOf(ctx, k))),
    absZ: Math.max(...flagged.map((k) => absZ(ctx, k))),
    task: {
      id: "vitals_recheck",
      hazard: hazardOf(lead),
      relatedKeys: flagged,
      title: {
        en: "Rest quietly for a few minutes, then measure again",
        mn: "Хэдэн минут тайван амарч, дахин хэмжээрэй",
      },
      why: {
        en: `${KPI_DEFS[lead].labels.en} was ${formatValue(lead, v, "en")}, ${dirEn} the demo range. ${OFFICER_EN}`,
        mn: `${KPI_DEFS[lead].labels.mn} ${formatValue(lead, v, "mn")} байна, демо мужаас ${dirMn}. ${OFFICER_MN}`,
      },
    },
  };
}

const SYMPTOM_WORDS: Array<{ key: KpiKey; en: string; mn: string }> = [
  { key: "symptom_headache", en: "a headache", mn: "толгой өвдсөн" },
  { key: "symptom_dizziness", en: "dizziness", mn: "толгой эргэсэн" },
  { key: "symptom_nausea", en: "nausea", mn: "дотор муухайрсан" },
];

function symptomTask(ctx: TaskContext): Candidate | null {
  const present = SYMPTOM_WORDS.filter((s) => val(ctx, s.key) === 1);
  if (present.length === 0) return null;
  return {
    severity: 1,
    absZ: 0,
    task: {
      id: "symptom_rest",
      hazard: hazardOf(present[0].key),
      relatedKeys: present.map((s) => s.key),
      title: {
        en: "Pause for a short rest and note how you feel later",
        mn: "Түр амарч, дараа нь биеийн байдлаа ажиглаарай",
      },
      why: {
        en: `You reported ${present.map((s) => s.en).join(" and ")} today. If it continues, ask your crew medical officer or flight surgeon.`,
        mn: `Та өнөөдөр ${present.map((s) => s.mn).join(", ")} гэж тэмдэглэсэн. Үргэлжилбэл багийн эмнэлгийн офицер эсвэл нислэгийн эмчээс асуугаарай.`,
      },
    },
  };
}

/* ───────────── defaults (padding up to 3) ───────────── */

function defaultTasks(ctx: TaskContext): Array<{ replaces: string; task: Task }> {
  const water = val(ctx, "water_ml");
  return [
    {
      replaces: "hydration_plan",
      task: {
        id: "default_hydration",
        hazard: hazardOf("water_ml"),
        relatedKeys: ["water_ml"],
        title: { en: "Plan your water for the day", mn: "Өдрийн усны төлөвлөгөөгөө гаргаарай" },
        why: {
          en:
            water !== null
              ? `Steady sips through the day are an easy habit; you have logged ${formatNumber(water, 0)} ml so far.`
              : "Steady sips through the day are an easy habit to keep.",
          mn:
            water !== null
              ? `Өдрийн турш цөөн цөөнөөр ус уух нь хялбар дадал. Одоогоор ${formatNumber(water, 0)} мл бүртгэсэн.`
              : "Өдрийн турш цөөн цөөнөөр ус уух нь хялбар дадал.",
        },
      },
    },
    {
      replaces: "sleep_wind_down",
      task: {
        id: "default_light_exposure",
        hazard: "isolation_confinement",
        relatedKeys: ["sleep_hours"],
        title: {
          en: "Keep a steady light and daily routine",
          mn: "Тогтмол гэрэл, өдрийн дэглэмээ барьээрэй",
        },
        why: {
          en: "A regular light and sleep routine helps you rest well in a closed habitat.",
          mn: "Тогтмол гэрэл, нойрны дэглэм нь битүү орчинд сайн амрахад тусална.",
        },
      },
    },
    {
      replaces: "exercise_session",
      task: {
        id: "default_stretching",
        hazard: "gravity",
        relatedKeys: ["exercise_min"],
        title: { en: "Do 10 minutes of gentle stretching", mn: "10 минут зөөлөн жийгээрэй" },
        why: {
          en: "Regular movement keeps muscles and joints active.",
          mn: "Тогтмол хөдөлгөөн булчин, үений идэвхийг дэмжинэ.",
        },
      },
    },
  ];
}

/**
 * Builds the day's tasks: rule-based candidates ranked red-flag first, then red before yellow, then by |z|;
 * at most 4; padded with defaults to at least 3.
 */
export function buildTasks(ctx: TaskContext): Task[] {
  const builders = [
    medicalOfficerTask,
    sleepTask,
    hydrationTask,
    exerciseTask,
    breakTask,
    wellbeingTask,
    visionTask,
    glucoseTask,
    vitalsTask,
    symptomTask,
  ];
  const candidates: Candidate[] = [];
  for (const build of builders) {
    const c = build(ctx);
    if (c) candidates.push(c);
  }
  // stable sort: ties keep rule order
  const ranked = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.severity - a.c.severity || b.c.absZ - a.c.absZ || a.i - b.i)
    .map((x) => x.c.task);

  const tasks = ranked.slice(0, MAX_TASKS);
  if (tasks.length < MIN_TASKS) {
    const taken = new Set(tasks.map((t) => t.id));
    const defaults = defaultTasks(ctx);
    // prefer defaults that do not duplicate a rule task already present, then fall back to the rest
    const preferred = defaults.filter((d) => !taken.has(d.replaces));
    const rest = defaults.filter((d) => taken.has(d.replaces));
    for (const d of [...preferred, ...rest]) {
      if (tasks.length >= MIN_TASKS) break;
      tasks.push(d.task);
    }
  }
  return tasks;
}
