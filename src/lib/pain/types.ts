import type { Bilingual, KpiKey } from "../types";

/**
 * "It hurts": the pain check (src/lib/pain). Shared contract only, no I/O: the words are read by detect.ts (both
 * languages), the related data items are chosen by related.ts from the person's own stored values, Cosmo's lines are
 * written by speech.ts, the server stores the report (src/server/pain.ts) and the client draws the body map
 * (src/components/pain). Every number in an item comes from the stored data; nothing here names a condition or a drug,
 * and every screen and line says it is not a diagnosis.
 */

/** the places on the body map (front view) plus the back and the whole body */
export const PAIN_LOCATIONS = [
  "head",
  "eye",
  "ear",
  "tooth",
  "throat",
  "chest",
  "abdomen",
  "side",
  "back",
  "arm",
  "leg",
  "joint",
  "whole_body",
] as const;
export type PainLocation = (typeof PAIN_LOCATIONS)[number];

export function isPainLocation(v: unknown): v is PainLocation {
  return typeof v === "string" && (PAIN_LOCATIONS as readonly string[]).includes(v);
}

export type SeverityWord = "mild" | "moderate" | "severe";
export const SEVERITY_WORDS: readonly SeverityWord[] = ["mild", "moderate", "severe"];

/** 0-10 as said ("7 out of 10"), or a word ("a little", "хүчтэй"); never a number the person did not say */
export interface PainSeverity {
  value: number | null;
  word: SeverityWord | null;
}

export const ONSET_KINDS = [
  "just_now",
  "minutes",
  "hours",
  "this_morning",
  "last_night",
  "today",
  "yesterday",
  "days",
  "weeks",
] as const;
export type OnsetKind = (typeof ONSET_KINDS)[number];

/** since when, as said: a kind and, when a number was said with it, the number ("for 2 hours" = hours, 2) */
export interface PainOnset {
  kind: OnsetKind;
  amount: number | null;
}

/**
 * Why a pain is urgent: chest pain; severe pain (8 or more out of 10, or "severe"); pain together with breathing
 * trouble, fainting or confusion words; a value today past a general danger threshold.
 */
export const PAIN_RED_FLAGS = ["chest", "severe", "breathing", "fainting", "confusion", "danger_vital"] as const;
export type PainRedFlag = (typeof PAIN_RED_FLAGS)[number];

/** what the words said about the pain (detect.ts) */
export interface PainReading {
  location: PainLocation | null;
  severity: PainSeverity | null;
  onset: PainOnset | null;
  /** red flags found in the words themselves (chest, severe, breathing, fainting, confusion) */
  redFlags: PainRedFlag[];
  /** the clause the pain was found in (for guide matching), lower case */
  clause: string;
  /** the pain words as heard, at most 60 characters ("chest hurts", "толгой өвдөж") */
  phrase: string;
}

/* ───────────── related data items ───────────── */

/**
 * How a value is unusual: past a general danger threshold, outside the general normal range for resting adults,
 * outside the app's demo range (registry thresholds, always labelled as a demo parameter), outside the person's own
 * usual range (mean ± 2 sd of the past days), a symptom reported today, or a flag in reference lab data.
 */
export type PainItemBand = "danger" | "outside_general" | "outside_demo" | "outside_personal" | "reported" | "flagged";

export const PAIN_ITEM_BANDS: readonly PainItemBand[] = [
  "danger",
  "outside_general",
  "outside_demo",
  "outside_personal",
  "reported",
  "flagged",
];

export interface PainItem {
  /** stable per item: "bp", "vital-heart_rate", "symptom-symptom_headache", "signature", "labs-urine" */
  id: string;
  kind: "vital" | "symptom" | "signature" | "labs";
  /** the indicator (systolic for blood pressure); null for the lab items */
  key: KpiKey | null;
  label: Bilingual;
  /** the value as shown ("142/91 mmHg", "Yes", "FRI 64") */
  valueText: Bilingual;
  /** the label and value as Cosmo says them ("blood pressure 142 over 91", "sleep 4.5 hours") */
  spoken: Bilingual;
  /** the number drawn on the chart (systolic for blood pressure); null when there is none */
  value: number | null;
  direction: "high" | "low" | null;
  band: PainItemBand;
  /** the day the value is from: null = today, else the last confirmed day (YYYY-MM-DD) that has it */
  date: string | null;
  /** the person's own usual range (mean ± 2 sd, never narrower than the key's floor); null without a baseline */
  personal: { low: number; high: number } | null;
  /** the general normal range (or the demo range for keys without a general one); either side may be open */
  normal: { low: number | null; high: number | null } | null;
  /** past days, oldest first (at most 14), for the chart */
  history: number[];
  /** why it is listed ("above your usual range of 62-74"), code-written */
  note: Bilingual;
}

/** at most this many items are listed (the most unusual first) */
export const MAX_PAIN_ITEMS = 4;

/* ───────────── the turn event ───────────── */

/** the parts of Cosmo's line, in the order she says them; the screen shows each part as she reaches it */
export type PainStep = "ack" | "where" | "data" | "guide" | "earth" | "ask" | "resume";
export const PAIN_STEPS: readonly PainStep[] = ["ack", "where", "data", "guide", "earth", "ask", "resume"];

export interface PainScriptPart {
  step: PainStep;
  text: string;
}

export type PainSosStatus = "sent" | "duplicate" | "failed";

/** the `pain` turn event (TurnEvent in src/lib/types.ts) without its `type` */
export interface PainEventData {
  /** the stored report; null when storing it failed */
  reportId: string | null;
  location: PainLocation | null;
  severity: PainSeverity | null;
  onset: PainOnset | null;
  items: PainItem[];
  /** the emergency guide to open (src/lib/emergency), or null */
  guideId: string | null;
  urgent: boolean;
  redFlags: PainRedFlag[];
  /** the report is on the Earth console (stored with its sent time) */
  reportSent: boolean;
  sentAt: string | null;
  /** urgent only: the SOS alert raised through the SOS flow (src/lib/sos), as the server confirmed it */
  sos: PainSosStatus | null;
  /** what Cosmo asked next: where it hurts, or how strong and since when; null when she asked nothing */
  awaiting: "location" | "details" | null;
  /** Cosmo's line in parts (the assistant event carries the same text, joined) */
  script: PainScriptPart[];
}

/** a stored report (repos/pain.ts); the ground console reads the sent ones */
export interface PainReport {
  id: string;
  crewId: string;
  checkInId: string;
  createdAt: string;
  updatedAt: string;
  location: PainLocation | null;
  severity: PainSeverity | null;
  onset: PainOnset | null;
  items: PainItem[];
  redFlags: PainRedFlag[];
  urgent: boolean;
  guideId: string | null;
  sosAlertId: string | null;
  sentAt: string | null;
  awaiting: "location" | "details" | null;
  askedTurnId: string | null;
}

/** the Earth console's row: the crew member's name is joined in, and nothing Cosmo asked is there */
export type GroundPainReport = Omit<PainReport, "awaiting" | "askedTurnId"> & { crewName: string };

/** how often the Earth console asks for new pain reports */
export const PAIN_POLL_MS = 5_000;
