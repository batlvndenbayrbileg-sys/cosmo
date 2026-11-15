/**
 * Signature Triage offline scripted demo (docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md section 5, which replaces spec
 * section 9; build prompt T9). Pure: turns the page data (SignatureViewData) and the simulated check-ins into the list
 * of beats the /demo/signature page plays. Every Cosmo line is a deterministic template (templates.ts) filled from the
 * engine's facts; nothing here calls a network service. The presenter lines are the addendum's table, verbatim.
 *
 * Mission clock per beat (integration map section 4.9): the clock of the signature view is the selected panel's day
 * after landing; the demo sets it per beat (R+1, R+45, R+194 as the addendum table lists; day 91 for the check-in beat,
 * 9 days after C001's R+82 panel, so the advisor sees "last panel 9 days ago" and 3 of 8 kits used, spec section 7.1 b).
 */

import type { Lang } from "@/lib/types";
import { DSS_HISTORY_DAYS, DSS_TRIGGER_DAYS, TIMEPOINT_DAY, type StrainKpi } from "./config";
import { median } from "./engine";
import { assertNumbersGrounded, buildDrawFacts, buildFacts, hasDisclaimer, hasForbiddenWording } from "./facts";
import { drawAdvice, drawStateFromPanels, dssSeries, type DrawAdvice, type StrainDay } from "./strain";
import { renderDrawTemplate, renderTriageTemplate } from "./templates";
import type { PanelResult, Timepoint } from "./types";
import type { SignatureViewData } from "./view";

/* ───────────── simulated check-ins (beat b) ───────────── */

/** one simulated daily check-in on the panel clock (landing-relative day) with the five DSS inputs */
export type DemoCheckinDay = { day: number } & Record<StrainKpi, number>;

export interface DemoCheckins {
  /** always true: the file is generated, never a real person's check-ins */
  simulated: true;
  /** how the file was made */
  generatedBy: string;
  rule: string;
  /** the Inspiration4 reference crew member whose panels drive the draw advisor on that beat */
  crew: string;
  /** the last day of `days` (today on that beat) */
  today: number;
  days: DemoCheckinDay[];
}

/** the check-in beat's crew member and day: C001, 9 days after the R+82 panel */
export const DEMO_CHECKIN_CREW = "C001";
export const DEMO_CHECKIN_TODAY = TIMEPOINT_DAY["R+82"] + 9;
const CALM_DAYS_N = 14;
const STRAINED_DAYS_N = 3;

/**
 * The build-prompt T5 rule: 14 calm days (sleep_hours = 7.0 + 0.1*(i%3), sleep_quality 4, resting_hr = 58 + (i%2),
 * fatigue 2, mood 4), then 3 strained days {5.0, 2, 66, 4, 3}; the last day is `today`.
 * scripts/gen-demo-checkins.ts writes this to src/data/demo_checkins.json.
 */
export function simulatedCheckins(today: number = DEMO_CHECKIN_TODAY, crew: string = DEMO_CHECKIN_CREW): DemoCheckins {
  const n = CALM_DAYS_N + STRAINED_DAYS_N;
  const first = today - n + 1;
  const days: DemoCheckinDay[] = [];
  for (let i = 0; i < CALM_DAYS_N; i += 1) {
    days.push({ day: first + i, sleep_hours: 7.0 + 0.1 * (i % 3), sleep_quality: 4, resting_hr: 58 + (i % 2), fatigue: 2, mood: 4 });
  }
  for (let i = 0; i < STRAINED_DAYS_N; i += 1) {
    days.push({ day: first + CALM_DAYS_N + i, sleep_hours: 5.0, sleep_quality: 2, resting_hr: 66, fatigue: 4, mood: 3 });
  }
  return {
    simulated: true,
    generatedBy: "scripts/gen-demo-checkins.ts (pnpm demo:checkins)",
    rule: "build prompt T5: 14 calm days, then 3 days {sleep_hours 5.0, sleep_quality 2, resting_hr 66, fatigue 4, mood 3}",
    crew,
    today,
    days,
  };
}

function strainDays(checkins: DemoCheckins): StrainDay[] {
  return checkins.days.map(({ sleep_hours, sleep_quality, resting_hr, fatigue, mood }) => ({
    sleep_hours,
    sleep_quality,
    resting_hr,
    fatigue,
    mood,
  }));
}

/** the daily strain score of every simulated day (oldest first) */
export function demoDss(checkins: DemoCheckins): (number | null)[] {
  return dssSeries(strainDays(checkins));
}

/** the usual resting heart rate: median of the up to 14 days before the current strained run (the last 3 days) */
export function usualRestingHr(checkins: DemoCheckins): number | null {
  const before = checkins.days.slice(0, Math.max(checkins.days.length - DSS_TRIGGER_DAYS, 0)).slice(-DSS_HISTORY_DAYS);
  return before.length ? median(before.map((d) => d.resting_hr)) : null;
}

/** the draw advisor on the check-in beat: the crew member's panels up to `today`, the simulated DSS */
export function demoDrawAdvice(view: SignatureViewData, checkins: DemoCheckins): DrawAdvice {
  return drawAdvice(drawStateFromPanels(view.panels[checkins.crew] ?? [], checkins.today, demoDss(checkins)));
}

/* ───────────── beats ───────────── */

export type DemoBeatId = "intro" | "a" | "recovery" | "c1" | "c2" | "d" | "b" | "evidence";
export type DemoCard = "triage" | "fingerprint" | "recovery" | "evidence";

/** the cards the demo can show (all four are built; a beat that needs a missing one is skipped) */
export const BUILT_DEMO_CARDS: ReadonlySet<DemoCard> = new Set<DemoCard>(["triage", "fingerprint", "recovery", "evidence"]);

export interface DemoCosmoLine {
  /** the language Cosmo speaks on this beat (addendum table: (a) Mongolian, (c1) English; the others English) */
  lang: Lang;
  text: string;
  /** English captions (the same text when Cosmo speaks English) */
  caption: string;
  /** pre-generated clip name under public/demo/audio/signature/ */
  audioFile: string;
}

export interface DemoBeat {
  id: DemoBeatId;
  /** addendum section 5 time slot, seconds from the start */
  start: number;
  end: number;
  crew: string;
  /** the panel shown on the cards */
  timepoint: Timepoint;
  /** mission clock override for this beat: day after landing */
  clockDay: number;
  cards: DemoCard[];
  cosmo: DemoCosmoLine | null;
  /** what the presenter says (addendum table, verbatim) */
  presenter: string | null;
  /** simulated check-ins on screen: banner "Simulated check-ins" */
  simulated: boolean;
  /** daily strain scores for the Recovery card (beat b only) */
  dss: (number | null)[];
}

/** the presenter lines of the addendum section 5 table, verbatim */
export const PRESENTER_LINES: Readonly<Partial<Record<DemoBeatId, string>>> = {
  intro:
    "Far from Earth a blood draw is rare. The question is not 'what are my numbers' but 'is this the flight, or something new — and can I trust the test?'",
  recovery:
    "NASA has no sample between day 1 and day 45, so we give an upper bound and schedule the draw that closes the gap.",
  c2: "No flight, same pattern, two independent tests agree. Real Inspiration4 data.",
  d: "Here one test says alarm and the other says no. AEGIS does not escalate on one key.",
  evidence: "Four people is not a study. We show what held up — IL-6 — and what did not.",
};

export function demoAudioFile(id: DemoBeatId, lang: Lang): string {
  return `${id}_${lang}.mp3`;
}

function panelAt(view: SignatureViewData, crew: string, tp: Timepoint): { panel: PanelResult; previous: PanelResult | null } | null {
  const panels = view.panels[crew] ?? [];
  const i = panels.findIndex((p) => p.timepoint === tp);
  if (i < 0) return null;
  return { panel: panels[i], previous: i > 0 ? panels[i - 1] : null };
}

/** a Cosmo triage line, or null when the panel is missing or the text fails a guard (the beat is then skipped) */
function triageLine(view: SignatureViewData, crew: string, tp: Timepoint, id: DemoBeatId, lang: Lang): DemoCosmoLine | null {
  const at = panelAt(view, crew, tp);
  if (!at) return null;
  const render = (l: Lang): string | null => {
    const facts = buildFacts(at.panel, { lang: l, previous: at.previous, qcLog: view.qcLog });
    const text = renderTriageTemplate(facts, l);
    return assertNumbersGrounded(text, facts) && hasDisclaimer(text, l) && !hasForbiddenWording(text) ? text : null;
  };
  const text = render(lang);
  const caption = lang === "en" ? text : render("en");
  if (text === null || caption === null) return null;
  return { lang, text, caption, audioFile: demoAudioFile(id, lang) };
}

/** Cosmo's draw-advice line (spec section 7.1 b) on the check-in beat */
export function demoDrawLine(view: SignatureViewData, checkins: DemoCheckins, lang: Lang): string | null {
  const advice = demoDrawAdvice(view, checkins);
  const last = checkins.days[checkins.days.length - 1];
  const facts = buildDrawFacts(advice, {
    lang,
    crew: checkins.crew,
    sleepHours: last?.sleep_hours ?? null,
    restingHr: last?.resting_hr ?? null,
    restingHrUsual: usualRestingHr(checkins),
  });
  const text = renderDrawTemplate(facts, lang);
  return assertNumbersGrounded(text, facts) && hasDisclaimer(text, lang) && !hasForbiddenWording(text) ? text : null;
}

interface BeatPlan {
  id: DemoBeatId;
  start: number;
  end: number;
  crew: string;
  timepoint: Timepoint;
  cards: DemoCard[];
  /** the beat has a Cosmo line in this language */
  cosmo?: Lang;
}

/** addendum section 5, row by row */
const PLAN: readonly BeatPlan[] = [
  { id: "intro", start: 0, end: 20, crew: "C001", timepoint: "R+1", cards: [] },
  { id: "a", start: 20, end: 55, crew: "C001", timepoint: "R+1", cards: ["triage", "fingerprint"], cosmo: "mn" },
  { id: "recovery", start: 55, end: 70, crew: "C001", timepoint: "R+1", cards: ["recovery"] },
  { id: "c1", start: 70, end: 85, crew: "C001", timepoint: "R+45", cards: ["triage"], cosmo: "en" },
  { id: "c2", start: 85, end: 120, crew: "C002", timepoint: "R+45", cards: ["triage", "fingerprint"], cosmo: "en" },
  { id: "d", start: 120, end: 145, crew: "C003", timepoint: "R+194", cards: ["triage", "fingerprint"], cosmo: "en" },
  { id: "b", start: 145, end: 160, crew: DEMO_CHECKIN_CREW, timepoint: "R+82", cards: ["recovery"], cosmo: "en" },
  { id: "evidence", start: 160, end: 180, crew: "C001", timepoint: "R+1", cards: ["evidence"] },
];

/**
 * The beats of the addendum section 5 script, in order. A beat is skipped (never a blank screen) when one of its cards
 * is not in `built`, its panel is missing, or its Cosmo line cannot be rendered with grounded numbers.
 */
export function buildDemoBeats(
  view: SignatureViewData,
  checkins: DemoCheckins,
  built: ReadonlySet<DemoCard> = BUILT_DEMO_CARDS,
): DemoBeat[] {
  const beats: DemoBeat[] = [];
  for (const p of PLAN) {
    if (!p.cards.every((c) => built.has(c))) continue;
    if (!panelAt(view, p.crew, p.timepoint)) continue;
    const checkinBeat = p.id === "b";
    if (checkinBeat && checkins.crew !== p.crew) continue;
    let cosmo: DemoCosmoLine | null = null;
    if (p.cosmo) {
      if (checkinBeat) {
        const text = demoDrawLine(view, checkins, p.cosmo);
        const caption = p.cosmo === "en" ? text : demoDrawLine(view, checkins, "en");
        cosmo = text && caption ? { lang: p.cosmo, text, caption, audioFile: demoAudioFile(p.id, p.cosmo) } : null;
      } else {
        cosmo = triageLine(view, p.crew, p.timepoint, p.id, p.cosmo);
      }
      if (!cosmo) continue;
    }
    beats.push({
      id: p.id,
      start: p.start,
      end: p.end,
      crew: p.crew,
      timepoint: p.timepoint,
      clockDay: checkinBeat ? checkins.today : TIMEPOINT_DAY[p.timepoint],
      cards: [...p.cards],
      cosmo,
      presenter: PRESENTER_LINES[p.id] ?? null,
      simulated: checkinBeat,
      dss: checkinBeat ? demoDss(checkins) : [],
    });
  }
  return beats;
}

/** every Cosmo line of the script in one language (the audio generator voices these) */
export function demoSpokenLines(beats: readonly DemoBeat[], lang: Lang, view: SignatureViewData, checkins: DemoCheckins): { id: DemoBeatId; text: string }[] {
  const out: { id: DemoBeatId; text: string }[] = [];
  for (const b of beats) {
    if (!b.cosmo) continue;
    if (b.cosmo.lang === lang) {
      out.push({ id: b.id, text: b.cosmo.text });
      continue;
    }
    const text = b.id === "b" ? demoDrawLine(view, checkins, lang) : triageLine(view, b.crew, b.timepoint, b.id, lang)?.text;
    if (text) out.push({ id: b.id, text });
  }
  return out;
}
