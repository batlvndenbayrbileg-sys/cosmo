import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  ConversationState,
  KpiKey,
  Lang,
  MeasurementSource,
  MeasurementValue,
  SummaryFindings,
} from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { computeBaselines, evaluateDay } from "@/lib/health";
import { KPI_DEFS, validateValue } from "@/lib/kpi/registry";
import { extractNumbers } from "@/lib/numbers/extract";
import { HttpError, NotFoundError } from "@/server/http";
import { getCheckIn } from "@/server/db/repos/checkin";
import { upsertMeasurement } from "@/server/db/repos/measurement";
import { loadHistory, loadTodayValues } from "@/server/checkin/service";

/**
 * The six tools of docs/BRIEF.md section 4 and the single place that writes measurements.
 *
 *  - TOOL_DEFINITIONS is a CONSTANT, frozen, byte-stable list (strict: true, additionalProperties: false) so the
 *    request prefix never changes and the prompt cache stays valid. Illegal calls are refused with an error
 *    tool_result instead of varying the list.
 *  - executeTool validates, cross-checks against the speaker's own words (docs/PLAN.md section 4.5), enforces state
 *    legality and persists through the repos. crewId and checkInId come from the ToolContext (the signed session),
 *    never from the model: the input schemas do not contain them and unknown fields are rejected.
 *  - The same function serves the rule-based agent, the live agent's validation pass (`dryRun`) and the final apply.
 */

export const TOOL_NAMES = [
  "record_measurement",
  "request_clarification",
  "correct_measurement",
  "get_baseline",
  "finish_confirmation",
  "compose_summary",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/* ───────────── Anthropic tool definitions (constant) ───────────── */

const KEY_PROPERTY = { type: "string", enum: [...KPI_KEYS], description: "The indicator key." } as const;
const VALUE_PROPERTY = {
  anyOf: [{ type: "number" }, { type: "string" }],
  description:
    "The value exactly as the astronaut said it: a number (yes/no symptoms as 1 or 0), or the astronaut's own words for the two note keys.",
} as const;

function defineTools(): readonly Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: "record_measurement",
      description:
        "Record one value the astronaut has just said. Use source_text to quote the exact words the value comes from. Never guess a value the astronaut did not say.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          key: KEY_PROPERTY,
          value: VALUE_PROPERTY,
          unit: { type: "string", description: "Unit of the value, empty string when it has none." },
          source_text: { type: "string", description: "Exact words from the astronaut's latest message." },
          confidence: { type: "number", description: "Between 0 and 1: how sure you are that you understood the value." },
        },
        required: ["key", "value", "unit", "source_text", "confidence"],
        additionalProperties: false,
      },
    },
    {
      name: "request_clarification",
      description:
        "Use when the astronaut's answer for an indicator is unclear, missing a number or out of range, so Cosmo asks again briefly.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          key: KEY_PROPERTY,
          reason: { type: "string", description: "Short reason, e.g. no number heard." },
        },
        required: ["key", "reason"],
        additionalProperties: false,
      },
    },
    {
      name: "correct_measurement",
      description:
        "Change a value that was already recorded, only during the read-back of the values, when the astronaut says a value is wrong.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { key: KEY_PROPERTY, value: VALUE_PROPERTY },
        required: ["key", "value"],
        additionalProperties: false,
      },
    },
    {
      name: "get_baseline",
      description: "Returns the astronaut's own 14-day mean and spread per indicator, computed by code.",
      strict: true,
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "finish_confirmation",
      description:
        "Use during the read-back: confirmed true when the astronaut says everything is correct, false when they want to change something.",
      strict: true,
      input_schema: {
        type: "object",
        properties: { confirmed: { type: "boolean" } },
        required: ["confirmed"],
        additionalProperties: false,
      },
    },
    {
      name: "compose_summary",
      description: "Returns the structured findings of today's check-in, computed by code. Phrase them, never recompute them.",
      strict: true,
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
  return Object.freeze(tools.map((t) => Object.freeze(t)));
}

/** the same list, in the same order, on every request */
export const TOOL_DEFINITIONS: readonly Anthropic.Tool[] = defineTools();

/* ───────────── inputs ───────────── */

const keySchema = z.enum(KPI_KEYS);
const valueSchema = z.union([z.number(), z.string()]);

const INPUT_SCHEMAS = {
  record_measurement: z
    .object({
      key: keySchema,
      value: valueSchema,
      unit: z.string().nullable().optional(),
      source_text: z.string(),
      confidence: z.number().optional(),
    })
    .strict(),
  request_clarification: z.object({ key: keySchema, reason: z.string() }).strict(),
  // source_text / confidence are NOT in the model-facing schema: the rule-based path passes them for corrections
  correct_measurement: z
    .object({
      key: keySchema,
      value: valueSchema,
      source_text: z.string().optional(),
      confidence: z.number().optional(),
    })
    .strict(),
  get_baseline: z.object({}).strict(),
  finish_confirmation: z.object({ confirmed: z.boolean() }).strict(),
  compose_summary: z.object({}).strict(),
} as const;

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/* ───────────── context and results ───────────── */

export interface ToolContext {
  /** from the signed session, never from the model */
  crewId: string;
  checkInId: string;
  state: ConversationState;
  lang: Lang;
  /** the astronaut's latest utterance: every source_text must be a substring of it */
  utterance: string;
  source: MeasurementSource;
  /** keys that already hold a value */
  filled: ReadonlySet<KpiKey>;
  /** validate only: nothing is written */
  dryRun?: boolean;
}

export type ToolErrorCode =
  | "unknown_tool"
  | "bad_input"
  | "illegal_state"
  | "already_recorded"
  | "invalid_value"
  | "source_mismatch"
  | "number_mismatch"
  | "write_refused"
  | "not_found";

export type ToolEffect =
  | {
      type: "measurement";
      key: KpiKey;
      value: MeasurementValue;
      unit: string | null;
      sourceText: string;
      confidence: number;
      change: "recorded" | "corrected";
    }
  | { type: "clarification"; key: KpiKey; reason: string }
  | { type: "confirmation"; confirmed: boolean };

export type ToolResult =
  | { ok: true; name: ToolName; data: unknown; effect?: ToolEffect }
  | { ok: false; name: ToolName | null; code: ToolErrorCode; error: string; reason?: "range" | "type" | "unclear" };

/** the text sent back to the model as the tool_result content */
export function toolResultContent(result: ToolResult): string {
  return result.ok ? JSON.stringify(result.data) : result.error;
}

function fail(
  name: ToolName | null,
  code: ToolErrorCode,
  error: string,
  reason?: "range" | "type" | "unclear",
): ToolResult {
  return { ok: false, name, code, error, reason };
}

/* ───────────── state legality ───────────── */

const LEGAL_STATES: Record<ToolName, readonly ConversationState[]> = {
  record_measurement: ["GREETING", "SMALL_TALK", "KPI_CAPTURE"],
  request_clarification: ["KPI_CAPTURE", "CONFIRM"],
  correct_measurement: ["CONFIRM"],
  get_baseline: ["GREETING", "SMALL_TALK", "KPI_CAPTURE", "CONFIRM", "SUMMARY", "DONE"],
  finish_confirmation: ["CONFIRM"],
  compose_summary: ["SUMMARY", "DONE"],
};

/** exported for tests and for the directive */
export function isLegalIn(name: ToolName, state: ConversationState): boolean {
  return LEGAL_STATES[name].includes(state);
}

/* ───────────── cross-check against the speaker's words (PLAN 4.5) ───────────── */

function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** true when `needle` occurs in `haystack` ignoring case, curly quotes and runs of whitespace */
export function isSubstringOfUtterance(needle: string, haystack: string): boolean {
  const n = normalise(needle);
  return n.length > 0 && normalise(haystack).includes(n);
}

const FRACTION_WORDS = /(?<![\p{L}])(?:half|quarter|point|хагас|аравны|цэг)(?![\p{L}])/iu;

/** every value the words in `source` can legitimately stand for (unit conversions, compounds, halves) */
function derivedValues(key: KpiKey, source: string): number[] {
  const nums = extractNumbers(source).map((n) => n.value);
  const out: number[] = [...nums];
  const each = (f: (n: number) => number[]) => {
    for (const n of nums) out.push(...f(n));
  };
  each((n) => [n + 0.5]); // "6 and a half", "6 цаг хагас"
  const pairs = (f: (a: number, b: number) => number) => {
    for (let i = 0; i + 1 < nums.length; i++) out.push(f(nums[i], nums[i + 1]));
  };
  switch (key) {
    case "sleep_hours":
      each((n) => [n / 60]); // minutes
      pairs((a, b) => a + b / 60); // "6 hours 30 minutes"
      break;
    case "water_ml":
      each((n) => [n * 1000, (n + 0.5) * 1000]); // litres
      pairs((a, b) => a * 1000 + b); // "1 litre 500 ml"
      break;
    case "exercise_min":
      each((n) => [n * 60]); // hours
      pairs((a, b) => a * 60 + b);
      break;
    case "temperature_c":
      each((n) => [((n - 32) * 5) / 9]); // Fahrenheit
      break;
    case "glucose_mgdl":
      each((n) => [n * 18.016]); // mmol/L
      break;
    default:
      break;
  }
  return out;
}

function toleranceFor(key: KpiKey): number {
  if (key === "temperature_c") return 0.06;
  if (key === "glucose_mgdl") return 1;
  return 0.006;
}

/**
 * "match": a number in the words equals the value; "none": nothing to verify against (no number, or a fraction word
 * the extractor cannot read); "mismatch": numbers were spoken and none of them can be the value.
 */
export function crossCheckNumber(key: KpiKey, value: number, sourceText: string): "match" | "none" | "mismatch" {
  const found = extractNumbers(sourceText);
  if (found.length === 0) return "none";
  const tol = toleranceFor(key);
  if (derivedValues(key, sourceText).some((d) => Math.abs(d - value) <= tol + 1e-9)) return "match";
  return FRACTION_WORDS.test(sourceText) ? "none" : "mismatch";
}

/* ───────────── write path shared by record and correct ───────────── */

const NUMBER_CHECKED = new Set(["number", "integer", "scale"]);
const MAX_SNIPPET = 200;

function clampConfidence(c: number | undefined): number {
  if (c === undefined || !Number.isFinite(c)) return 0.5;
  return Math.min(1, Math.max(0, c));
}

function writeMeasurement(
  tc: ToolContext,
  name: "record_measurement" | "correct_measurement",
  input: { key: KpiKey; value: MeasurementValue; source_text?: string; confidence?: number },
): ToolResult {
  const { key } = input;
  const def = KPI_DEFS[key];

  const checked = validateValue(key, input.value);
  if (!checked.ok) {
    return fail(
      name,
      "invalid_value",
      `Rejected: ${checked.message.en} Do not record it; call request_clarification for ${key}.`,
      checked.reason,
    );
  }
  const value = checked.value;

  const sourceText = (input.source_text ?? tc.utterance).trim().slice(0, MAX_SNIPPET) || tc.utterance.trim().slice(0, MAX_SNIPPET);
  if (name === "record_measurement") {
    if ((input.source_text ?? "").trim().length === 0 || !isSubstringOfUtterance(sourceText, tc.utterance)) {
      return fail(
        name,
        "source_mismatch",
        "Rejected: source_text is not a quote from the astronaut's latest message. Quote their exact words, or call request_clarification.",
        "unclear",
      );
    }
  }
  if (def.type === "text") {
    if (!isSubstringOfUtterance(String(value), tc.utterance)) {
      return fail(
        name,
        "source_mismatch",
        "Rejected: a note must be the astronaut's own words from their latest message.",
        "unclear",
      );
    }
  }

  let confidence = clampConfidence(input.confidence);
  if (NUMBER_CHECKED.has(def.type) && typeof value === "number") {
    // numbers are checked against what was SAID: for a correction that is the whole utterance when no snippet is given
    const basis = input.source_text !== undefined ? sourceText : tc.utterance;
    const verdict = crossCheckNumber(key, value, basis);
    if (verdict === "mismatch") {
      return fail(
        name,
        "number_mismatch",
        `Rejected: the number ${value} does not appear in the astronaut's words. Do not record it; call request_clarification for ${key}.`,
        "unclear",
      );
    }
    if (verdict === "none") confidence = Math.min(confidence, 0.6);
  }

  const change = name === "correct_measurement" ? "corrected" : "recorded";
  if (!tc.dryRun) {
    try {
      upsertMeasurement(tc.crewId, tc.checkInId, {
        key,
        value,
        unit: def.unit,
        sourceText,
        confidence,
        source: tc.source,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(name, "write_refused", `Not saved: ${err.message}.`);
      }
      throw err;
    }
  }
  const effect: ToolEffect = { type: "measurement", key, value, unit: def.unit, sourceText, confidence, change };
  return { ok: true, name, data: { saved: true, key, value, unit: def.unit, change }, effect };
}

/* ───────────── code-computed data for get_baseline / compose_summary ───────────── */

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

function baselineData(tc: ToolContext): unknown {
  const checkIn = getCheckIn(tc.crewId, tc.checkInId);
  const history = loadHistory(tc.crewId, checkIn.localDate);
  const baselines = computeBaselines(history);
  const out: Record<string, { mean: number | null; sd: number | null; n: number }> = {};
  for (const [key, b] of Object.entries(baselines)) {
    if (b) out[key] = { mean: round2(b.mean), sd: round2(b.sd), n: b.n };
  }
  return { windowDays: 14, note: "A baseline needs at least 5 days; otherwise mean and sd are null.", baselines: out };
}

/** the findings for today's values, computed by code (never by the model) */
export function computeFindings(crewId: string, checkInId: string): SummaryFindings {
  const checkIn = getCheckIn(crewId, checkInId);
  const { values } = loadTodayValues(crewId, checkInId);
  return evaluateDay(values, loadHistory(crewId, checkIn.localDate)).summary;
}

/* ───────────── dispatcher ───────────── */

/**
 * Runs one tool call. Never throws for bad model input: every refusal is an `ok: false` result whose `error` is a
 * short instruction the model can act on (a clarification question to the astronaut, usually).
 */
export function executeTool(tc: ToolContext, name: string, input: unknown): ToolResult {
  try {
    return dispatch(tc, name, input);
  } catch (err) {
    // a check-in that is not this crew member's looks exactly like one that does not exist
    if (err instanceof NotFoundError) return fail(isToolName(name) ? name : null, "not_found", "Check-in not found.");
    throw err;
  }
}

function dispatch(tc: ToolContext, name: string, input: unknown): ToolResult {
  if (!isToolName(name)) return fail(null, "unknown_tool", `Unknown tool: ${name}.`);
  const parsed = INPUT_SCHEMAS[name].safeParse(input ?? {});
  if (!parsed.success) {
    return fail(name, "bad_input", `Invalid input for ${name}: ${parsed.error.issues[0]?.message ?? "malformed"}.`);
  }
  if (!isLegalIn(name, tc.state)) {
    return fail(name, "illegal_state", `${name} is not available in state ${tc.state}.`);
  }

  switch (name) {
    case "record_measurement": {
      const i = parsed.data as z.infer<(typeof INPUT_SCHEMAS)["record_measurement"]>;
      if (tc.filled.has(i.key)) {
        return fail(
          name,
          "already_recorded",
          `${i.key} already has a value. Do not overwrite it; the astronaut can change it at the read-back.`,
        );
      }
      return writeMeasurement(tc, name, i);
    }
    case "correct_measurement": {
      const i = parsed.data as z.infer<(typeof INPUT_SCHEMAS)["correct_measurement"]>;
      return writeMeasurement(tc, name, i);
    }
    case "request_clarification": {
      const i = parsed.data as z.infer<(typeof INPUT_SCHEMAS)["request_clarification"]>;
      const reason = i.reason.trim().slice(0, 200) || "unclear";
      return {
        ok: true,
        name,
        data: { noted: true, key: i.key },
        effect: { type: "clarification", key: i.key, reason },
      };
    }
    case "get_baseline":
      return { ok: true, name, data: baselineData(tc) };
    case "finish_confirmation": {
      const i = parsed.data as z.infer<(typeof INPUT_SCHEMAS)["finish_confirmation"]>;
      const data = i.confirmed ? { confirmed: true, summary: computeFindings(tc.crewId, tc.checkInId) } : { confirmed: false };
      return { ok: true, name, data, effect: { type: "confirmation", confirmed: i.confirmed } };
    }
    case "compose_summary":
      return { ok: true, name, data: computeFindings(tc.crewId, tc.checkInId) };
  }
}
