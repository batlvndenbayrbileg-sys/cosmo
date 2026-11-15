/**
 * Signature Triage facts and the grounding guard (docs/SIGNATURE_SPEC.md sections 6, 7.1, 7.3; build prompt T6).
 * Pure and deterministic: code computes every number, the facts carry them as the exact strings that may be spoken
 * (integers for FRI, band, days and kits; one decimal for folds), and `assertNumbersGrounded` rejects any text with a
 * number outside `facts.allowedNumbers`. On a failed check the caller sends the template (templates.ts) instead.
 */

import type { Lang } from "../types";
import {
  DSS_TRIGGER,
  DSS_TRIGGER_DAYS,
  KITS_TOTAL,
  TIMEPOINT_DAY,
  UNEXPECTED_RETEST_DAYS,
} from "./config";
import { recoveryFor } from "./recovery";
import type { DrawAdvice, DrawRule } from "./strain";
import type {
  MarkerResult,
  PanelResult,
  QcEntry,
  SecondAssayBadge,
  SecondAssayCheck,
  SecondAssayStatus,
  Timepoint,
  TriageClass,
} from "./types";

/* ───────────── fixed wording ───────────── */

/** the closing line of every Signature Triage answer (spec section 7.1; build rule 6 "the fixed line") */
export const SIGNATURE_DISCLAIMER: Readonly<Record<Lang, string>> = {
  en: "Decision support, not a diagnosis.",
  mn: "Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш.",
};

/** reference statements of the Inspiration4 crew (spec sections 1.1 and 4.8): spoken in the templates as words */
export const REFERENCE_STATEMENTS = {
  crewSameDirection: "4 of 4",
  crewBackByDay45: "3 of 4",
} as const;

/** numbers the templates use as fixed reference points: the 0-100 scale and the Inspiration4 follow-up day */
export const SCALE_MAX = 100;
export const FOLLOW_UP_DAY = 45;

/* ───────────── action table (spec section 7.3; ASSUMPTION wording, general wellness and reporting only) ───────────── */

export const ACTIONS: Readonly<Record<TriageClass, Readonly<Record<Lang, readonly string[]>>>> = {
  INSUFFICIENT: {
    en: ["no extra draw; look again at the next panel"],
    mn: ["нэмэлт цус авах шаардлагагүй; дараагийн шинжилгээгээр дахин харах"],
  },
  BASELINE: {
    en: ["none; next routine check per the draw advisor"],
    mn: ["шаардлагагүй; дараагийн ээлжит шинжилгээ цус авах зөвлөгөөний дагуу"],
  },
  INDETERMINATE: {
    en: ["no extra draw", "keep sleep and fluids regular", "look again at the next panel"],
    mn: ["нэмэлт цус авах шаардлагагүй", "нойр болон шингэнээ тогтмол байлгах", "дараагийн шинжилгээгээр дахин харах"],
  },
  EXPECTED_FLIGHT_RESPONSE: {
    en: [
      "rest, fluids, sleep",
      "no extra draw before the re-test date",
      "report fever, sore throat, rash, cold sores",
    ],
    mn: [
      "амрах, шингэн уух, унтах",
      "давтан шинжилгээний өдрөөс өмнө нэмэлт цус авахгүй",
      "халуурах, хоолой өвдөх, арьсанд тууралт гарах, уруулд цэврүү гарвал хэлэх",
    ],
  },
  UNEXPECTED_ACTIVATION: {
    en: [
      "symptom checklist now",
      "temperature",
      `re-test in ${UNEXPECTED_RETEST_DAYS} days`,
      "notify the flight surgeon at the next contact",
    ],
    mn: [
      "одоо шинж тэмдгийн жагсаалт шалгах",
      "биеийн температур хэмжих",
      `${UNEXPECTED_RETEST_DAYS} хоногийн дараа давтан шинжилгээ`,
      "дараагийн холболтоор нислэгийн эмчид мэдэгдэх",
    ],
  },
};

/**
 * Addendum section 2, the action rows that depend on the second assay (ASSUMPTION wording, as the spec table):
 * UNEXPECTED + TWO_ASSAY_CONFIRMED keeps the spec row; UNEXPECTED + SINGLE_ASSAY repeats the measurement and does not
 * escalate; EXPECTED + SINGLE_ASSAY is the EXPECTED row plus one sentence.
 */
export const SECOND_ASSAY_ACTIONS = {
  unexpectedSingle: {
    en: [`repeat the measurement in ${UNEXPECTED_RETEST_DAYS} days`, "no escalation until a second measurement agrees"],
    mn: [`${UNEXPECTED_RETEST_DAYS} хоногийн дараа хэмжилтийг давтах`, "хоёр дахь хэмжилт таарах хүртэл дээш мэдэгдэхгүй"],
  },
  singleAssayNote: {
    en: "only one of two tests shows this",
    mn: "хоёр шинжилгээний зөвхөн нэг нь үүнийг харуулж байна",
  },
} as const satisfies Record<string, Readonly<Record<Lang, string | readonly string[]>>>;

/** the action list of a panel: spec section 7.3 by class, with the addendum section 2 rows when a badge is set */
export function actionsFor(cls: TriageClass, badge: SecondAssayBadge | null | undefined, lang: Lang): readonly string[] {
  if (badge === "SINGLE_ASSAY" && cls === "UNEXPECTED_ACTIVATION") return SECOND_ASSAY_ACTIONS.unexpectedSingle[lang];
  if (badge === "SINGLE_ASSAY" && cls === "EXPECTED_FLIGHT_RESPONSE") {
    return [...ACTIONS.EXPECTED_FLIGHT_RESPONSE[lang], SECOND_ASSAY_ACTIONS.singleAssayNote[lang]];
  }
  return ACTIONS[cls][lang];
}

/* ───────────── formatting: the exact strings that are spoken ───────────── */

/** integer (FRI, band, days, kits) */
export function spokenInt(x: number): string {
  return String(Math.round(x));
}

/**
 * A fold "x times your baseline": one decimal (build prompt T6); from 10 up an integer, as the spec speaks IL-8 at
 * C002 R+45 (fold 47.04 -> "47").
 */
export function spokenFold(fold: number): string {
  return fold >= 10 ? String(Math.round(fold)) : (Math.round(fold * 10) / 10).toFixed(1);
}

/** hours and similar: one decimal at most, no trailing ".0" (7.0 -> "7", 5.5 -> "5.5") */
export function spokenTenth(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** analyte name as spoken: il_6 -> IL-6, mcp_1 -> MCP-1, tnfα -> TNFα; plain words stay as they are */
export function markerLabel(analyte: string): string {
  const m = /^([a-zα-ω]+)_(\d+[a-z]?)$/u.exec(analyte);
  if (m) return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
  if (/^(tnf|ifn)/u.test(analyte)) return analyte.slice(0, 3).toUpperCase() + analyte.slice(3);
  if (analyte === "crp") return "CRP";
  return analyte;
}

/* ───────────── triage facts ───────────── */

export interface FactsMarker {
  /** spoken label, e.g. "IL-6" */
  marker: string;
  tier: "core" | "supporting";
  /** fold vs own pre-flight baseline, as spoken */
  foldRounded: string;
  /** above every / inside / below every own pre-flight value */
  envelope: "hi" | "in" | "lo";
}

export interface SignatureFacts {
  kind: "triage";
  lang: Lang;
  /** the Inspiration4 reference crew member whose panel this is (C001..C004) */
  crew: string;
  /** always shown with the panel: these are reference data, not the app crew member's own blood */
  source: string;
  timepoint: Timepoint;
  /** days after landing of this panel (R+N = N) */
  daysSinceLanding: string;
  class: TriageClass;
  /** Flight Response Index 0-100, integer; null when too few markers */
  fri: string | null;
  /** uncertainty band [low, high], integers */
  band: [string, string] | null;
  borderline: boolean;
  /** the two core markers with the largest z (spoken order) */
  topMarkers: FactsMarker[];
  /** IL-6, the lead marker of the signature (the recovery sentence speaks it) */
  leadMarker: FactsMarker | null;
  /** FRI of the previous post-flight panel of the same crew member, if any */
  previousFri: string | null;
  previousClass: TriageClass | null;
  reference: typeof REFERENCE_STATEMENTS;
  /** EXPECTED_FLIGHT_RESPONSE only: ETA band (days after the panel) and the first re-test */
  recovery: { etaDays: [string, string]; retestInDays: string; retestDay: string } | null;
  /** UNEXPECTED_ACTIVATION only: re-test in this many days */
  unexpectedRetestInDays: string | null;
  /** information only: up to three other immune / cardiovascular analytes with a large change */
  otherLargeChanges: Array<{ marker: string; foldRounded: string }>;
  /** QC notes for this panel (spec section 1.5), in the facts' language */
  qcNotes: string[];
  /** spec section 7.3, keyed by class */
  actions: readonly string[];
  /** second-assay cross-check (addendum T12); null when the panel was scored without the second assay */
  secondAssay: FactsSecondAssay | null;
  disclaimer: string;
  /** every number above as the exact string that may be spoken, plus the fixed reference numbers */
  allowedNumbers: string[];
}

/** one marker of the two-key check, folds as spoken */
export interface FactsSecondAssayMarker {
  marker: string;
  status: SecondAssayStatus;
  /** fold on the primary platform vs own pre-flight median, as spoken */
  primaryFoldRounded: string | null;
  /** fold on the second platform vs own pre-flight median, as spoken */
  secondFoldRounded: string | null;
}

/**
 * Keys carry no digits on purpose: the facts JSON is handed to the model, and every digit sequence in it (outside
 * names such as IL-6) must be one of `allowedNumbers`.
 */
export interface FactsSecondAssay {
  /** IL-6, the marker that decides the badge */
  lead: FactsSecondAssayMarker;
  /** IL-8 (CXCL8 on the second platform) */
  chemokine: FactsSecondAssayMarker;
  badge: SecondAssayBadge | null;
}

export interface FactsContext {
  lang: Lang;
  /** the previous post-flight panel of the same crew member (null / absent for R+1) */
  previous?: PanelResult | null;
  /** the loader's QC log; the entries of this crew member and timepoint become notes */
  qcLog?: readonly QcEntry[];
}

const SOURCE: Readonly<Record<Lang, string>> = {
  en: "Inspiration4 reference data (NASA OSDR), shown for demonstration",
  mn: "Inspiration4-ийн жишиг өгөгдөл (NASA OSDR), үзүүлэх зорилгоор",
};

const QC_GLUCOSE_NOTE: Readonly<Record<Lang, string>> = {
  en: "the glucose value in this sample failed a quality check and was left out",
  mn: "энэ дээжийн глюкозын утга чанарын шалгалтад тэнцээгүй тул тооцоонд оруулаагүй",
};

const QC_CBC_NOTE: Readonly<Record<Lang, string>> = {
  en: "a shifted blood-count row in this sample was repaired by a quality check",
  mn: "энэ дээжийн цусны эсийн тооллын мөрийг чанарын шалгалтаар зассан",
};

function factsMarker(analyte: string, m: MarkerResult): FactsMarker {
  return { marker: markerLabel(analyte), tier: m.tier, foldRounded: spokenFold(m.fold), envelope: m.envelope };
}

/** QC notes for one panel, one per rule that touched it */
export function qcNotesFor(panel: Pick<PanelResult, "crew" | "timepoint">, qcLog: readonly QcEntry[], lang: Lang): string[] {
  const own = qcLog.filter((q) => q.crew === panel.crew && q.timepoint === panel.timepoint);
  const notes: string[] = [];
  if (own.some((q) => q.rule === "QC2_glucose_artifact")) notes.push(QC_GLUCOSE_NOTE[lang]);
  if (own.some((q) => q.rule === "QC1_cbc_row_shift")) notes.push(QC_CBC_NOTE[lang]);
  return notes;
}

/** true when this panel's glucose was removed by QC-2 */
export function glucoseRemoved(panel: Pick<PanelResult, "crew" | "timepoint">, qcLog: readonly QcEntry[]): boolean {
  return qcLog.some((q) => q.rule === "QC2_glucose_artifact" && q.crew === panel.crew && q.timepoint === panel.timepoint);
}

export function buildFacts(panel: PanelResult, context: FactsContext): SignatureFacts {
  const { lang } = context;
  const previous = context.previous ?? null;
  const allowed = new Set<string>([String(SCALE_MAX), String(FOLLOW_UP_DAY), "4", "3"]);
  const add = (s: string | null | undefined): string | null => {
    if (s !== null && s !== undefined) allowed.add(s);
    return s ?? null;
  };

  const core = Object.entries(panel.markers)
    .filter(([, m]) => m.tier === "core")
    .sort((a, b) => b[1].z - a[1].z);
  const topMarkers = core.slice(0, 2).map(([a, m]) => factsMarker(a, m));
  for (const m of topMarkers) add(m.foldRounded);
  const il6Raw = panel.markers["il_6"];
  const il6 = il6Raw ? factsMarker("il_6", il6Raw) : null;
  if (il6) add(il6.foldRounded);

  const fri = panel.fri === null ? null : add(spokenInt(panel.fri));
  const band: [string, string] | null = panel.band
    ? [add(spokenInt(panel.band[0])) as string, add(spokenInt(panel.band[1])) as string]
    : null;
  const previousFri = previous && previous.fri !== null ? add(spokenInt(previous.fri)) : null;

  const rec = recoveryFor(panel);
  const recovery = rec
    ? {
        etaDays: [add(spokenInt(rec.etaDays[0])) as string, add(spokenInt(rec.etaDays[1])) as string] as [string, string],
        retestInDays: add(String(rec.retestOffset)) as string,
        retestDay: add(String(rec.retestMissionDay)) as string,
      }
    : null;
  const unexpectedRetestInDays = panel.cls === "UNEXPECTED_ACTIVATION" ? add(String(UNEXPECTED_RETEST_DAYS)) : null;

  const otherLargeChanges = panel.otherLargeChanges.map((o) => ({
    marker: markerLabel(o.analyte),
    foldRounded: add(spokenFold(o.fold)) as string,
  }));

  const daysSinceLanding = add(String(TIMEPOINT_DAY[panel.timepoint] ?? panel.missionDay)) as string;

  const sa = panel.secondAssay;
  const saMarker = (marker: string, c: SecondAssayCheck): FactsSecondAssayMarker => ({
    marker,
    status: c.status,
    primaryFoldRounded: c.primaryFold === null ? null : add(spokenFold(c.primaryFold)),
    secondFoldRounded: c.secondFold === null ? null : add(spokenFold(c.secondFold)),
  });
  const secondAssay: FactsSecondAssay | null = sa
    ? { lead: saMarker("IL-6", sa.il6), chemokine: saMarker("IL-8", sa.il8), badge: sa.badge }
    : null;

  return {
    kind: "triage",
    lang,
    crew: panel.crew,
    source: SOURCE[lang],
    timepoint: panel.timepoint,
    daysSinceLanding,
    class: panel.cls,
    fri,
    band,
    borderline: panel.borderline,
    topMarkers,
    leadMarker: il6,
    previousFri,
    previousClass: previous ? previous.cls : null,
    reference: REFERENCE_STATEMENTS,
    recovery,
    unexpectedRetestInDays,
    otherLargeChanges,
    qcNotes: qcNotesFor(panel, context.qcLog ?? [], lang),
    actions: actionsFor(panel.cls, sa?.badge, lang),
    secondAssay,
    disclaimer: SIGNATURE_DISCLAIMER[lang],
    allowedNumbers: [...allowed],
  };
}

/* ───────────── draw-advice facts ───────────── */

export interface DrawFacts {
  kind: "draw";
  lang: Lang;
  /** the Inspiration4 reference crew member whose panels drive the advice */
  crew: string;
  source: string;
  rule: DrawRule;
  action: DrawAdvice["action"];
  /** the strain-score trigger (spec section 4.10, A2) */
  strainTrigger: string;
  strainTriggerDays: string;
  /** today's DSS, integer; null when not computable */
  strainToday: string | null;
  daysSinceLastPanel: string | null;
  kitsLeft: string;
  kitsTotal: string;
  kitsSaved: string;
  /** A1: days the re-test is overdue (0 = due today); A3: days until the re-check */
  dueInDays: string | null;
  /** today's hours of sleep, as spoken */
  sleepHours: string | null;
  /** today's resting heart rate minus the usual (median of the history), beats, integer; only when above */
  restingHrAboveUsual: string | null;
  disclaimer: string;
  allowedNumbers: string[];
}

export interface DrawFactsContext {
  lang: Lang;
  crew: string;
  /** today's sleep in hours, if recorded */
  sleepHours?: number | null;
  /** today's resting heart rate and the usual one (median of the history), if both known */
  restingHr?: number | null;
  restingHrUsual?: number | null;
}

export function buildDrawFacts(advice: DrawAdvice, context: DrawFactsContext): DrawFacts {
  const allowed = new Set<string>([String(DSS_TRIGGER), String(DSS_TRIGGER_DAYS)]);
  const add = (s: string | null): string | null => {
    if (s !== null) allowed.add(s);
    return s;
  };
  const today = advice.state.today;
  const dssToday = advice.state.dss.length > 0 ? advice.state.dss[advice.state.dss.length - 1] : null;
  const due =
    advice.dueDay === null ? null : advice.rule === "A1" ? Math.max(today - advice.dueDay, 0) : Math.max(advice.dueDay - today, 0);
  const hrDelta =
    context.restingHr !== null && context.restingHr !== undefined && context.restingHrUsual !== null && context.restingHrUsual !== undefined
      ? Math.round(context.restingHr - context.restingHrUsual)
      : null;
  return {
    kind: "draw",
    lang: context.lang,
    crew: context.crew,
    source: SOURCE[context.lang],
    rule: advice.rule,
    action: advice.action,
    strainTrigger: String(DSS_TRIGGER),
    strainTriggerDays: String(DSS_TRIGGER_DAYS),
    strainToday: add(dssToday === null || dssToday === undefined ? null : spokenInt(dssToday)),
    daysSinceLastPanel: add(advice.daysSinceLastPanel === null ? null : String(advice.daysSinceLastPanel)),
    kitsLeft: add(String(advice.kitsLeft)) as string,
    kitsTotal: add(String(advice.kitsTotal ?? KITS_TOTAL)) as string,
    kitsSaved: add(String(advice.kitsSaved)) as string,
    dueInDays: add(due === null ? null : String(due)),
    sleepHours: add(context.sleepHours === null || context.sleepHours === undefined ? null : spokenTenth(context.sleepHours)),
    restingHrAboveUsual: add(hrDelta !== null && hrDelta > 0 ? String(hrDelta) : null),
    disclaimer: SIGNATURE_DISCLAIMER[context.lang],
    allowedNumbers: [...allowed],
  };
}

/* ───────────── guards ───────────── */

/** names that carry digits but are not numbers (build prompt T6), plus every analyte label of the same shape */
const KNOWN_TOKENS = /\b(?:IL-6|IL-8|IL-10|IL-27|MCP-1)\b|Inspiration4|\b[A-Z]{2,5}α?-\d+[A-Z]?\b|\bC00\d\b|\bR\+\d+\b|\bL-\d+\b/gu;

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

/** the numbers in `text` after the known tokens are removed (decimal comma read as a point) */
export function numbersIn(text: string): string[] {
  return (text.replace(KNOWN_TOKENS, " ").match(NUMBER_RE) ?? []).map((n) => n.replace(",", "."));
}

/** every number in `text` is one of `facts.allowedNumbers` (exact string) */
export function assertNumbersGrounded(text: string, facts: { allowedNumbers: readonly string[] }): boolean {
  const allowed = new Set(facts.allowedNumbers);
  return numbersIn(text).every((n) => allowed.has(n));
}

/** the answer ends with the fixed disclaimer of its language */
export function hasDisclaimer(text: string, lang: Lang): boolean {
  return text.trim().endsWith(SIGNATURE_DISCLAIMER[lang]);
}

/* ───────────── T10 fix: the answer carries the action and, where it changes the action, the badge ───────────── */

/** words of the spec 7.3 / addendum 2 actions (re-test, rest, fluids, sleep, symptom check, temperature, flight surgeon, draw) */
const ACTION_CUE: Readonly<Record<Lang, RegExp>> = {
  en: /\bre-?test|\brepeat|\brest\b|\bfluids?\b|\bsleep\b|\bsymptom|\btemperature|\bflight surgeon|\bdraw\b|\blook again|\breport\b/iu,
  mn: /давт|амр|шингэн|унт|шинж тэмдг|температур|нислэгийн эмч|цус ав|дахин харах|мэдэгд|хэлэх/iu,
};

/** SINGLE_ASSAY: the two tests do not agree */
const SINGLE_ASSAY_CUE: Readonly<Record<Lang, RegExp>> = {
  en: /only one of (?:the )?two (?:tests|assays)|disagree|the other (?:test|assay|one)\b/iu,
  mn: /зөвхөн нэг|зөрж/iu,
};

/** TWO_ASSAY_CONFIRMED: a second, independent test agrees */
const TWO_ASSAY_CUE: Readonly<Record<Lang, RegExp>> = {
  en: /\bboth\b|\bsecond,? (?:independent )?(?:test|assay)|\btwo (?:independent )?(?:tests|assays)\b[^.!?]*\b(?:agree|match|confirm)/iu,
  mn: /хоёр дахь|бие даасан хоёр|хоёуланд|таарч/iu,
};

/**
 * The model's wording of a triage answer must also carry what the template carries where it matters (build prompt T6
 * "one action"; addendum section 2): for EXPECTED_FLIGHT_RESPONSE and UNEXPECTED_ACTIVATION at least one action of the
 * action table, and for UNEXPECTED_ACTIVATION with a second-assay badge the badge sentence (both tests agree, or only
 * one of two tests shows it), because there the badge decides the action (escalate, or repeat the measurement and do not
 * escalate); a SINGLE_ASSAY answer may not claim agreement and a TWO_ASSAY_CONFIRMED answer may not claim disagreement.
 * BASELINE, INDETERMINATE and INSUFFICIENT need no action ("none; next routine check"). On failure the template is sent.
 */
export function answerCoversPanel(
  text: string,
  facts: Pick<SignatureFacts, "class" | "secondAssay">,
  lang: Lang,
): boolean {
  const t = text.split(SIGNATURE_DISCLAIMER[lang]).join(" ");
  const needsAction = facts.class === "EXPECTED_FLIGHT_RESPONSE" || facts.class === "UNEXPECTED_ACTIVATION";
  if (needsAction && !ACTION_CUE[lang].test(t)) return false;
  const badge = facts.secondAssay?.badge ?? null;
  if (facts.class === "UNEXPECTED_ACTIVATION" && badge === "SINGLE_ASSAY") {
    if (!SINGLE_ASSAY_CUE[lang].test(t) || TWO_ASSAY_CUE[lang].test(t)) return false;
  }
  if (facts.class === "UNEXPECTED_ACTIVATION" && badge === "TWO_ASSAY_CONFIRMED") {
    if (!TWO_ASSAY_CUE[lang].test(t) || SINGLE_ASSAY_CUE[lang].test(t)) return false;
  }
  return true;
}

/** phrases that contain a forbidden word but are not a verdict (spec template sentences, copied verbatim) */
const ALLOWED_PHRASES = [/normal fluids/giu, /шингэнээ хэвийн ууж/giu];

/**
 * Build rule 6: "immune suppression", "metabolic stress", "recovers in 45 days", "diagnosis" (outside the fixed
 * disclaimer line) and "normal" / "abnormal" as a verdict (EN and MN).
 */
export function hasForbiddenWording(text: string): boolean {
  let t = text;
  for (const d of Object.values(SIGNATURE_DISCLAIMER)) t = t.split(d).join(" ");
  for (const p of ALLOWED_PHRASES) t = t.replace(p, " ");
  return /immune\s+suppression|metabolic\s+stress|recovers\s+in\s+45\s+days|diagnos|\bnormal\b|\babnormal\b|онош|хэвийн/iu.test(t);
}
