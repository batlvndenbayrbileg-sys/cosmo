import { KPI_KEYS, type Bilingual, type KpiKey } from "../types";
import {
  MAX_PAIN_ITEMS,
  ONSET_KINDS,
  PAIN_ITEM_BANDS,
  PAIN_RED_FLAGS,
  PAIN_STEPS,
  SEVERITY_WORDS,
  isPainLocation,
  type OnsetKind,
  type PainEventData,
  type PainItem,
  type PainItemBand,
  type PainOnset,
  type PainRedFlag,
  type PainScriptPart,
  type PainSeverity,
  type PainStep,
  type SeverityWord,
} from "./types";

/**
 * Reading a `pain` event on the client (src/components/checkin/sse.ts) or a stored report's JSON columns. The server
 * builds them from typed code; this only drops what the screen could not draw.
 */

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bilingual(v: unknown): Bilingual | null {
  return isRecord(v) && typeof v.en === "string" && typeof v.mn === "string" ? { en: v.en, mn: v.mn } : null;
}

function range(v: unknown): { low: number | null; high: number | null } | null {
  if (!isRecord(v)) return null;
  const low = finite(v.low);
  const high = finite(v.high);
  return low === null && high === null ? null : { low, high };
}

export function parseSeverity(v: unknown): PainSeverity | null {
  if (!isRecord(v)) return null;
  const value = finite(v.value);
  const word = oneOf<SeverityWord>(SEVERITY_WORDS, v.word) ? v.word : null;
  const okValue = value !== null && Number.isInteger(value) && value >= 0 && value <= 10 ? value : null;
  return okValue === null && word === null ? null : { value: okValue, word };
}

export function parseOnset(v: unknown): PainOnset | null {
  if (!isRecord(v) || !oneOf<OnsetKind>(ONSET_KINDS, v.kind)) return null;
  return { kind: v.kind, amount: finite(v.amount) };
}

export function parsePainItem(raw: unknown): PainItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const kind = raw.kind === "vital" || raw.kind === "symptom" || raw.kind === "signature" || raw.kind === "labs" ? raw.kind : null;
  const label = bilingual(raw.label);
  const valueText = bilingual(raw.valueText);
  const note = bilingual(raw.note);
  if (!kind || !label || !valueText || !note || !oneOf<PainItemBand>(PAIN_ITEM_BANDS, raw.band)) return null;
  const personal = range(raw.personal);
  return {
    id: raw.id,
    kind,
    key: oneOf<KpiKey>(KPI_KEYS, raw.key) ? raw.key : null,
    label,
    valueText,
    spoken: bilingual(raw.spoken) ?? valueText,
    value: finite(raw.value),
    direction: raw.direction === "high" || raw.direction === "low" ? raw.direction : null,
    band: raw.band,
    date: typeof raw.date === "string" ? raw.date : null,
    personal: personal && personal.low !== null && personal.high !== null ? { low: personal.low, high: personal.high } : null,
    normal: range(raw.normal),
    history: Array.isArray(raw.history) ? raw.history.map(finite).filter((n): n is number => n !== null).slice(-14) : [],
    note,
  };
}

export function parsePainItems(raw: unknown): PainItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parsePainItem).filter((i): i is PainItem => i !== null).slice(0, MAX_PAIN_ITEMS);
}

export function parseRedFlags(raw: unknown): PainRedFlag[] {
  return Array.isArray(raw) ? raw.filter((f): f is PainRedFlag => oneOf(PAIN_RED_FLAGS, f)) : [];
}

function parseScript(raw: unknown): PainScriptPart[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Rec => isRecord(p) && oneOf<PainStep>(PAIN_STEPS, p.step) && typeof p.text === "string")
    .map((p) => ({ step: p.step as PainStep, text: p.text as string }));
}

/** the event's data (everything but `type`), or null when it is not a pain event the screen can draw */
export function parsePainEvent(raw: unknown): PainEventData | null {
  if (!isRecord(raw) || typeof raw.urgent !== "boolean") return null;
  return {
    reportId: typeof raw.reportId === "string" ? raw.reportId : null,
    location: isPainLocation(raw.location) ? raw.location : null,
    severity: parseSeverity(raw.severity),
    onset: parseOnset(raw.onset),
    items: parsePainItems(raw.items),
    guideId: typeof raw.guideId === "string" && /^[\w-]{1,60}$/.test(raw.guideId) ? raw.guideId : null,
    urgent: raw.urgent,
    redFlags: parseRedFlags(raw.redFlags),
    reportSent: raw.reportSent === true,
    sentAt: typeof raw.sentAt === "string" ? raw.sentAt : null,
    sos: raw.sos === "sent" || raw.sos === "duplicate" || raw.sos === "failed" ? raw.sos : null,
    awaiting: raw.awaiting === "location" || raw.awaiting === "details" ? raw.awaiting : null,
    script: parseScript(raw.script),
  };
}
