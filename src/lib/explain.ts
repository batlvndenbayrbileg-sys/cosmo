/**
 * "Cosmo explains": a step-by-step walkthrough of the astronaut's data, one thing at a time, in sync with what Cosmo
 * says (team request 2026-11-15: "instead of showing the whole dashboard while Cosmo just talks, explain one thing at a
 * time with clear visuals").
 *
 * Shared contract only (types and pure helpers, no server imports): the server builds the storyboard from code-computed
 * data (src/server/agent/explain.ts, never the model), the client plays it (src/components/explain/ExplainerStage.tsx).
 * Every number in a panel comes from today's stored values, the confirmed 14-day history, its baseline, the general
 * vital-sign reference or the registry's demo parameters.
 *
 * On the wire one walkthrough is ONE stored Cosmo turn whose text is the beats' captions (and the line that resumes the
 * check-in, if any) joined by newlines: beat i is voiced as line i of that turn
 * (GET /api/checkins/:id/turns/:turnId/audio?part=i), so no text travels in a URL and the transcript holds exactly what
 * Cosmo says.
 */
import { KPI_KEYS, type Bilingual, type KpiKey, type Lang, type Status } from "./types";
import { REFERENCE_CREW, type ReferenceCrewId } from "./signature/config";

/** why the walkthrough runs: after the daily summary, or a question asked at any point */
export type ExplainIntent = "summary" | "today" | "before" | "why";
export const EXPLAIN_INTENTS: readonly ExplainIntent[] = ["summary", "today", "before", "why"];

/**
 * What made a value worth a beat, most serious first:
 *  - danger:   past an urgent threshold of the general vital-sign reference (valueChecks.ts dangerValues)
 *  - outside:  outside the general resting-adult normal range (vitalReference.ts)
 *  - personal: far from the person's own 14-day baseline (|z| > 2, the status model's rule)
 *  - range:    outside the registry's demo-parameter range
 *  - trend:    a steady rise or fall over the past days while today is still in range
 *  - steady:   nothing stands out (a "was it like this before?" answer for a usual value)
 */
export type ExplainFlag = "danger" | "outside" | "personal" | "range" | "trend" | "steady";
export const EXPLAIN_FLAGS: readonly ExplainFlag[] = ["danger", "outside", "personal", "range", "trend", "steady"];

export interface ExplainPoint {
  date: string;
  value: number;
}

/** one line of a chart: the past days (oldest first, today excluded) and today's value */
export interface ExplainSeries {
  key: KpiKey;
  points: ExplainPoint[];
  today: number | null;
}

export interface ExplainRange {
  low: number | null;
  high: number | null;
}

export type ExplainPanel =
  /** the "analysing" card: what was recorded today, and how many past days it is compared with */
  | { kind: "checking"; recorded: Array<{ key: KpiKey; status: Status }>; historyDays: number }
  /** a value over the past days: the shaded personal band, the general (or demo) normal range, today highlighted */
  | {
      kind: "chart";
      key: KpiKey;
      unit: string | null;
      /** one series, or blood pressure's two (systolic first) */
      series: ExplainSeries[];
      /** personal band: baseline mean +/- 2 sd (never below the key's sdFloor); null without a baseline */
      personal: ExplainRange | null;
      /** the general resting-adult range, or the registry's demo-parameter range when the key has no general one */
      normal: (ExplainRange & { source: "general" | "demo" }) | null;
      status: Status;
      flag: ExplainFlag;
      direction: "high" | "low" | null;
    }
  /** a yes/no or category value (symptoms, vision) as a strip of days: past days and today */
  | {
      kind: "days";
      key: KpiKey;
      days: ExplainPoint[];
      today: number | null;
      status: Status;
      flag: ExplainFlag;
      /** past days with the same answer as today (or with any "yes" when today is "no") */
      count: number;
    }
  /** every vital as a round chip, green / amber / red */
  | {
      kind: "grid";
      overall: Status;
      chips: Array<{ key: KpiKey; status: Status; value: number | null; second?: number | null }>;
    }
  /** what to do next: code-chosen steps, the Contact Mission Control button, the matching emergency guide */
  | {
      kind: "actions";
      actions: Array<{ id: string; title: Bilingual }>;
      /** an alert is raised (overall red): the crew medical officer and ground are informed */
      alert: boolean;
      guide: { scenarioId: string; title: Bilingual } | null;
    }
  /** the blood-panel triage offer (Signature Triage), linked to the crew member's reference panel */
  | { kind: "signature"; reference: ReferenceCrewId | null }
  /** a sentence without a chart: no earlier days to compare with, or nothing that stands out */
  | { kind: "note"; tone: "calm" | "info" };

export type ExplainPanelKind = ExplainPanel["kind"];
const PANEL_KINDS: readonly ExplainPanelKind[] = ["checking", "chart", "days", "grid", "actions", "signature", "note"];

/** one step of the walkthrough as the server builds it: both languages, so tests can hold the two side by side */
export interface StoryBeat {
  id: string;
  caption: Bilingual;
  panel: ExplainPanel;
}

export interface Storyboard {
  intent: ExplainIntent;
  beats: StoryBeat[];
}

/** one step as it travels to the client: the caption in the check-in's language */
export interface ExplainBeat {
  id: string;
  /** the line of the stored turn this beat says (its audio is ?part=<part>) */
  part: number;
  caption: string;
  panel: ExplainPanel;
}

/** the `explain` turn event (src/lib/types.ts TurnEvent) */
export interface ExplainEvent {
  type: "explain";
  intent: ExplainIntent;
  /** the stored Cosmo turn holding the captions, one per line (beat i = line i) */
  turnId: string;
  language: Lang;
  beats: ExplainBeat[];
  /** said after the last beat to pick the check-in up again ("How many hours did you sleep?"), the turn's last line */
  resume: { part: number; text: string } | null;
}

/** at most this many beats: a short walkthrough, never a second dashboard */
export const MAX_EXPLAIN_BEATS = 7;

/** the text of the stored turn: the captions and the resume line, one per line */
export function explainTurnText(beats: ReadonlyArray<{ caption: string }>, resume: string | null): string {
  const lines = beats.map((b) => oneLine(b.caption));
  if (resume && resume.trim()) lines.push(oneLine(resume));
  return lines.join("\n");
}

/** line `part` of a stored turn (what one beat says); null when there is no such line */
export function turnPart(text: string, part: number): string | null {
  if (!Number.isInteger(part) || part < 0) return null;
  const lines = text.split("\n");
  const line = lines[part];
  return line !== undefined && line.trim() !== "" ? line.trim() : null;
}

function oneLine(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

/* ───────────── reading an `explain` event on the client ───────────── */

const STATUSES: readonly Status[] = ["green", "yellow", "red", "no_data"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isKey = (v: unknown): v is KpiKey => (KPI_KEYS as readonly unknown[]).includes(v);
const status = (v: unknown): Status => (STATUSES.includes(v as Status) ? (v as Status) : "no_data");
const flag = (v: unknown): ExplainFlag => (EXPLAIN_FLAGS.includes(v as ExplainFlag) ? (v as ExplainFlag) : "steady");

function bilingual(v: unknown): Bilingual | null {
  return isRecord(v) && typeof v.en === "string" && typeof v.mn === "string" ? { en: v.en, mn: v.mn } : null;
}

function points(v: unknown): ExplainPoint[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isRecord)
    .map((p) => ({ date: typeof p.date === "string" ? p.date : "", value: num(p.value) }))
    .filter((p): p is ExplainPoint => p.value !== null);
}

function range(v: unknown): ExplainRange | null {
  if (!isRecord(v)) return null;
  const low = num(v.low);
  const high = num(v.high);
  return low === null && high === null ? null : { low, high };
}

function readPanel(raw: unknown): ExplainPanel | null {
  if (!isRecord(raw) || !PANEL_KINDS.includes(raw.kind as ExplainPanelKind)) return null;
  switch (raw.kind as ExplainPanelKind) {
    case "checking": {
      const recorded = Array.isArray(raw.recorded)
        ? raw.recorded.filter(isRecord).filter((r) => isKey(r.key)).map((r) => ({ key: r.key as KpiKey, status: status(r.status) }))
        : [];
      return { kind: "checking", recorded, historyDays: Math.max(0, Math.round(num(raw.historyDays) ?? 0)) };
    }
    case "chart": {
      if (!isKey(raw.key)) return null;
      const series = Array.isArray(raw.series)
        ? raw.series
            .filter(isRecord)
            .filter((s) => isKey(s.key))
            .map((s) => ({ key: s.key as KpiKey, points: points(s.points), today: num(s.today) }))
            .slice(0, 2)
        : [];
      if (series.length === 0) return null;
      const normal = range(raw.normal);
      const source = isRecord(raw.normal) && raw.normal.source === "general" ? "general" : "demo";
      return {
        kind: "chart",
        key: raw.key,
        unit: typeof raw.unit === "string" ? raw.unit : null,
        series,
        personal: range(raw.personal),
        normal: normal ? { ...normal, source } : null,
        status: status(raw.status),
        flag: flag(raw.flag),
        direction: raw.direction === "high" || raw.direction === "low" ? raw.direction : null,
      };
    }
    case "days": {
      if (!isKey(raw.key)) return null;
      return {
        kind: "days",
        key: raw.key,
        days: points(raw.days),
        today: num(raw.today),
        status: status(raw.status),
        flag: flag(raw.flag),
        count: Math.max(0, Math.round(num(raw.count) ?? 0)),
      };
    }
    case "grid": {
      const chips = Array.isArray(raw.chips)
        ? raw.chips
            .filter(isRecord)
            .filter((c) => isKey(c.key))
            .map((c) => ({
              key: c.key as KpiKey,
              status: status(c.status),
              value: num(c.value),
              ...(c.second !== undefined ? { second: num(c.second) } : {}),
            }))
        : [];
      return { kind: "grid", overall: status(raw.overall), chips };
    }
    case "actions": {
      const actions = Array.isArray(raw.actions)
        ? raw.actions
            .filter(isRecord)
            .map((a) => ({ id: typeof a.id === "string" ? a.id : "", title: bilingual(a.title) }))
            .filter((a): a is { id: string; title: Bilingual } => a.id !== "" && a.title !== null)
        : [];
      const guide =
        isRecord(raw.guide) && typeof raw.guide.scenarioId === "string" && bilingual(raw.guide.title)
          ? { scenarioId: raw.guide.scenarioId, title: bilingual(raw.guide.title) as Bilingual }
          : null;
      return { kind: "actions", actions, alert: raw.alert === true, guide };
    }
    case "signature": {
      const reference = (REFERENCE_CREW as readonly unknown[]).includes(raw.reference) ? (raw.reference as ReferenceCrewId) : null;
      return { kind: "signature", reference };
    }
    case "note":
      return { kind: "note", tone: raw.tone === "info" ? "info" : "calm" };
  }
}

/**
 * The beats of an `explain` event as sent by the server. The server builds them from typed code; this only drops what
 * the screen could not draw (an unknown panel, a beat without words), at most MAX_EXPLAIN_BEATS. Null when nothing is
 * left or the event is malformed.
 */
export function parseExplainEvent(raw: Record<string, unknown>): ExplainEvent | null {
  if (typeof raw.turnId !== "string" || raw.turnId === "") return null;
  const intent = EXPLAIN_INTENTS.includes(raw.intent as ExplainIntent) ? (raw.intent as ExplainIntent) : "today";
  const language: Lang = raw.language === "mn" ? "mn" : "en";
  const beats: ExplainBeat[] = [];
  if (Array.isArray(raw.beats)) {
    raw.beats.forEach((b, i) => {
      if (!isRecord(b) || typeof b.id !== "string" || typeof b.caption !== "string" || b.caption.trim() === "") return;
      const panel = readPanel(b.panel);
      const part = num(b.part);
      if (panel) beats.push({ id: b.id, part: part !== null && Number.isInteger(part) && part >= 0 ? part : i, caption: b.caption, panel });
    });
  }
  if (beats.length === 0) return null;
  const r = raw.resume;
  const resume =
    isRecord(r) && typeof r.text === "string" && r.text.trim() !== "" && Number.isInteger(num(r.part)) && (num(r.part) as number) >= 0
      ? { part: num(r.part) as number, text: r.text }
      : null;
  return { type: "explain", intent, turnId: raw.turnId, language, beats: beats.slice(0, MAX_EXPLAIN_BEATS), resume };
}
