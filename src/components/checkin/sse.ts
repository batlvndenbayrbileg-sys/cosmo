/**
 * Server-sent-events client for POST /api/checkins/:id/turn (docs/PLAN.md section 5.1).
 *
 * `EventSource` cannot POST a body, so the turn stream is read with fetch + ReadableStream and parsed
 * here. Everything in this file is pure (no React, no DOM) so it can be unit-tested in Node.
 *
 *  - SseParser: incremental line parser, robust to chunk boundaries anywhere (even inside a CRLF pair
 *    or inside a multi-byte character, because the caller decodes with `stream: true`).
 *  - parseTurnEvent: turns one SSE message into a validated TurnEvent (or null when malformed).
 *  - iterateTurnEvents: ReadableStream<Uint8Array> -> async iterator of TurnEvent.
 */
import { normalizeLanguageCode } from "@/lib/language";
import { parseShowPanels } from "@/lib/show";
import {
  KPI_KEYS,
  QUESTION_IDS,
  type ApiErrorCode,
  type ConversationState,
  type KpiKey,
  type Lang,
  type MeasurementValue,
  type QuestionId,
  type Status,
  type StatusReason,
  type SummaryPayload,
  type TurnEvent,
} from "@/lib/types";

export interface SseMessage {
  /** value of the `event:` field, "message" when absent */
  event: string;
  /** all `data:` lines joined with "\n" */
  data: string;
  /** last seen `id:` field, null when none */
  id: string | null;
}

export class SseParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private lastId: string | null = null;

  /** Feed the next decoded text chunk; returns the messages completed by it. */
  feed(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    const terminator = /\r\n|\n|\r/g;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = terminator.exec(this.buffer)) !== null) {
      // A lone "\r" at the very end of the buffer may be the first half of "\r\n": wait for more.
      if (match[0] === "\r" && match.index + 1 === this.buffer.length) break;
      this.consumeLine(this.buffer.slice(start, match.index), out);
      start = match.index + match[0].length;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /**
   * Call once when the stream ends. Processes a trailing unterminated line and dispatches a pending
   * event. (The SSE spec discards an event that is not closed by a blank line; the server always
   * closes its events, and being lenient here only matters for truncated streams.)
   */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const line = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      this.consumeLine(line, out);
    }
    this.dispatch(out);
    return out;
  }

  private consumeLine(line: string, out: SseMessage[]): void {
    if (line === "") {
      this.dispatch(out);
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventName = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      default:
        break; // "retry" and unknown fields are ignored
    }
  }

  private dispatch(out: SseMessage[]): void {
    if (this.dataLines.length > 0) {
      out.push({
        event: this.eventName === "" ? "message" : this.eventName,
        data: this.dataLines.join("\n"),
        id: this.lastId,
      });
    }
    this.eventName = "";
    this.dataLines = [];
  }
}

/* ───────────── TurnEvent validation ───────────── */

const CONVERSATION_STATES: readonly ConversationState[] = [
  "GREETING",
  "SMALL_TALK",
  "KPI_CAPTURE",
  "CONFIRM",
  "SUMMARY",
  "DONE",
];
const STATUSES: readonly Status[] = ["green", "yellow", "red", "no_data"];
const REASONS: readonly StatusReason[] = [
  "fixed_range",
  "baseline",
  "combo_rule",
  "keyword_rule",
  "missing",
];
const ERROR_CODES: readonly ApiErrorCode[] = [
  "INTERNAL",
  "NO_SESSION",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_INPUT",
  "WRONG_STATE",
  "STT_FAILED",
  "LLM_FAILED",
  "TTS_FAILED",
];
const EMOTIONS = ["neutral", "happy", "concerned"] as const;

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function lang(v: unknown): Lang {
  return (typeof v === "string" ? normalizeLanguageCode(v) : null) ?? "en";
}

/** Validate one decoded JSON object. `type` has already been resolved by the caller. */
function validateTurnEvent(type: string, raw: Rec): TurnEvent | null {
  switch (type) {
    case "transcript": {
      const turnId = str(raw.turnId);
      const text = str(raw.text);
      if (turnId === null || text === null) return null;
      return { type, turnId, text, language: lang(raw.language) };
    }
    case "state": {
      if (!isOneOf(CONVERSATION_STATES, raw.state)) return null;
      const expected = isOneOf(QUESTION_IDS, raw.expectedQuestion)
        ? (raw.expectedQuestion as QuestionId)
        : null;
      return {
        type,
        state: raw.state,
        expectedQuestion: expected,
        ...(typeof raw.companion === "boolean" ? { companion: raw.companion } : {}),
      };
    }
    case "measurement": {
      if (!isOneOf(KPI_KEYS, raw.key)) return null;
      const value = raw.value;
      if (typeof value !== "number" && typeof value !== "string") return null;
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      const key: KpiKey = raw.key;
      const measurementValue: MeasurementValue = value;
      return {
        type,
        key,
        value: measurementValue,
        unit: str(raw.unit),
        sourceText: str(raw.sourceText) ?? "",
        confidence: finiteNumber(raw.confidence) ?? 0,
        status: isOneOf(STATUSES, raw.status) ? raw.status : "no_data",
        reason: isOneOf(REASONS, raw.reason) ? raw.reason : "fixed_range",
        change: raw.change === "corrected" ? "corrected" : "recorded",
      };
    }
    case "clarification": {
      if (!isOneOf(KPI_KEYS, raw.key)) return null;
      return { type, key: raw.key, reason: str(raw.reason) ?? "" };
    }
    case "assistant": {
      const turnId = str(raw.turnId);
      const text = str(raw.text);
      if (turnId === null || text === null) return null;
      return {
        type,
        turnId,
        text,
        language: lang(raw.language),
        emotion: isOneOf(EMOTIONS, raw.emotion) ? raw.emotion : "neutral",
      };
    }
    case "summary": {
      const summary = raw.summary;
      if (!isRecord(summary)) return null;
      const spoken = summary.spoken;
      if (!isRecord(spoken) || typeof spoken.text !== "string") return null;
      if (!isOneOf(STATUSES, summary.overall)) return null;
      // Trust boundary: the server builds SummaryPayload from typed code; we only guard the fields
      // this screen reads (spoken.text, overall). The dashboard payload is fetched separately.
      return { type, summary: summary as unknown as SummaryPayload };
    }
    case "show": {
      const panels = parseShowPanels(raw.panels);
      return panels.length > 0 ? { type, panels } : null;
    }
    case "timing": {
      return {
        type,
        sttMs: finiteNumber(raw.sttMs) ?? 0,
        llmMs: finiteNumber(raw.llmMs) ?? 0,
        totalMs: finiteNumber(raw.totalMs) ?? 0,
      };
    }
    case "error": {
      return {
        type,
        code: isOneOf(ERROR_CODES, raw.code) ? raw.code : "INTERNAL",
        message: str(raw.message) ?? "",
        recoverable: typeof raw.recoverable === "boolean" ? raw.recoverable : true,
      };
    }
    case "done":
      return { type };
    default:
      return null;
  }
}

/**
 * One SSE message -> TurnEvent. The server puts the discriminator in the JSON (`{"type": ...}`);
 * when it is missing the SSE `event:` name is used instead. Malformed JSON, unknown types and events
 * missing required fields return null (the caller skips them: one bad event must not kill a turn).
 */
export function parseTurnEvent(message: SseMessage): TurnEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const type = typeof raw.type === "string" ? raw.type : message.event;
  return validateTurnEvent(type, raw);
}

/** Decode a byte stream into SSE messages. Cancels the stream if the consumer stops early. */
export async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const message of parser.feed(decoder.decode(value, { stream: true }))) yield message;
    }
    for (const message of parser.feed(decoder.decode())) yield message;
    for (const message of parser.flush()) yield message;
    finished = true;
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // a pending read after cancel() can make releaseLock throw; nothing left to release
    }
  }
}

/** Decode a byte stream into validated TurnEvents (malformed events are skipped). */
export async function* iterateTurnEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<TurnEvent, void, undefined> {
  for await (const message of iterateSseMessages(body)) {
    const event = parseTurnEvent(message);
    if (event) yield event;
  }
}
