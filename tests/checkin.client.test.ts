import { describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  createCheckIn,
  fetchCrew,
  fetchDashboard,
  fetchDemoScript,
  fetchHealth,
  postSession,
  postTurnAudio,
  postTurnText,
  turnAudioUrl,
  type FetchLike,
} from "@/components/checkin/api";
import {
  abortableSleep,
  demoGapMs,
  parseDemoScript,
  typingPlan,
  waitUntil,
} from "@/components/checkin/demo";
import { StartGate, capReached, recordingCapMs } from "@/components/checkin/recording";
import {
  ROWS_PER_SIDE,
  bubbleItems,
  computeStageLayout,
  splitValueUnit,
  trailEnd,
  trailPath,
  worstStatus,
} from "@/components/checkin/bubbles";
import { DEFAULT_VAD_CONFIG } from "@/components/checkin/vad";
import {
  audioFileName,
  estimateSpeechMs,
  pickRecorderMimeType,
  pickVoice,
} from "@/components/checkin/speech";
import {
  checkInReducer,
  deriveCosmoState,
  initialCheckInState,
  type CheckInAction,
  type CheckInState,
} from "@/components/checkin/state";
import {
  SseParser,
  iterateSseMessages,
  iterateTurnEvents,
  parseTurnEvent,
  type SseMessage,
} from "@/components/checkin/sse";
import { parseStoredCrew } from "@/components/crew/selectedCrew";
import { roleKey, roleSlug } from "@/components/crew/roles";
import { KPI_KEYS, type SummaryPayload, type TurnEvent } from "@/lib/types";

/* ───────────── helpers ───────────── */

function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
      controller.close();
    },
  });
}

function sse(event: TurnEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function summary(text = "You are on track."): SummaryPayload {
  return {
    overall: "yellow",
    readiness: 80,
    headline: { en: "Watch", mn: "Анхаар" },
    findings: [],
    recommendations: [],
    redFlags: [],
    disclaimer: { en: "Decision support, not a diagnosis.", mn: "Шийдвэр гаргахад дэмжлэг, оношлолт биш." },
    spoken: { language: "en", text },
    audioTurnId: "t-sum",
  };
}

/* ───────────── SSE parser ───────────── */

describe("SseParser", () => {
  it("parses a complete event", () => {
    const p = new SseParser();
    expect(p.feed('event: x\ndata: {"a":1}\n\n')).toEqual([{ event: "x", data: '{"a":1}', id: null }]);
  });

  it('defaults the event name to "message"', () => {
    expect(new SseParser().feed("data: hi\n\n")).toEqual([{ event: "message", data: "hi", id: null }]);
  });

  it("is robust to chunk boundaries at every position", () => {
    const payload = 'event: a\ndata: {"x":"y"}\n\ndata: second\n\n';
    const expected = new SseParser().feed(payload);
    expect(expected).toHaveLength(2);
    for (let cut = 0; cut <= payload.length; cut++) {
      const p = new SseParser();
      const got = [...p.feed(payload.slice(0, cut)), ...p.feed(payload.slice(cut)), ...p.flush()];
      expect(got, `cut at ${cut}`).toEqual(expected);
    }
  });

  it("is robust to a split between the two characters of CRLF", () => {
    const p = new SseParser();
    const a = p.feed("data: one\r");
    const b = p.feed("\n\r");
    const c = p.feed("\n");
    expect([...a, ...b, ...c]).toEqual([{ event: "message", data: "one", id: null }]);
  });

  it("handles CRLF, CR and LF line endings", () => {
    for (const eol of ["\r\n", "\n", "\r"]) {
      const p = new SseParser();
      // a trailing lone CR is held back (it might be half of a CRLF) until the next chunk or flush
      const out = [...p.feed(`data: a${eol}data: b${eol}${eol}`), ...p.flush()];
      expect(out, JSON.stringify(eol)).toEqual([{ event: "message", data: "a\nb", id: null }]);
    }
  });

  it("joins multiple data lines with a newline", () => {
    expect(new SseParser().feed("data: one\ndata: two\ndata:\ndata: four\n\n")[0].data).toBe(
      "one\ntwo\n\nfour",
    );
  });

  it("strips exactly one leading space of the value", () => {
    expect(new SseParser().feed("data:  two spaces\n\n")[0].data).toBe(" two spaces");
    expect(new SseParser().feed("data:nospace\n\n")[0].data).toBe("nospace");
  });

  it("ignores comments and keep-alives", () => {
    const out = new SseParser().feed(": keep-alive\n\ndata: x\n\n: another\n\n");
    expect(out).toEqual([{ event: "message", data: "x", id: null }]);
  });

  it("keeps the last id and resets the event name between events", () => {
    const out = new SseParser().feed("id: 7\nevent: a\ndata: 1\n\ndata: 2\n\n");
    expect(out).toEqual([
      { event: "a", data: "1", id: "7" },
      { event: "message", data: "2", id: "7" },
    ]);
  });

  it("does not emit an event that has no data line", () => {
    expect(new SseParser().feed("event: ping\n\n")).toEqual([]);
  });

  it("flush() delivers a final event the stream did not close with a blank line", () => {
    const p = new SseParser();
    expect(p.feed("data: tail")).toEqual([]);
    expect(p.flush()).toEqual([{ event: "message", data: "tail", id: null }]);
  });

  it("keeps non-ASCII text intact (Mongolian)", () => {
    const text = "Сайн уу, Бат!";
    const out = new SseParser().feed(`data: ${text}\n\n`);
    expect(out[0].data).toBe(text);
  });
});

describe("parseTurnEvent", () => {
  const msg = (data: unknown, event = "message"): SseMessage => ({
    event,
    data: typeof data === "string" ? data : JSON.stringify(data),
    id: null,
  });

  it("parses every event type of the contract", () => {
    const events: TurnEvent[] = [
      { type: "transcript", turnId: "t1", text: "I slept six hours", language: "en" },
      { type: "state", state: "KPI_CAPTURE", expectedQuestion: "mood" },
      {
        type: "measurement",
        key: "sleep_hours",
        value: 6,
        unit: "h",
        sourceText: "six hours",
        confidence: 0.9,
        status: "yellow",
        reason: "fixed_range",
        change: "recorded",
      },
      { type: "clarification", key: "heart_rate", reason: "out of range" },
      { type: "assistant", turnId: "t2", text: "Thanks.", language: "en", emotion: "happy" },
      { type: "summary", summary: summary() },
      { type: "timing", sttMs: 100, llmMs: 800, totalMs: 1100 },
      { type: "error", code: "STT_FAILED", message: "no", recoverable: true },
      { type: "done" },
    ];
    for (const e of events) expect(parseTurnEvent(msg(e)), e.type).toEqual(e);
  });

  it("falls back to the SSE event name when the JSON has no type", () => {
    expect(parseTurnEvent(msg({}, "done"))).toEqual({ type: "done" });
    expect(parseTurnEvent(msg({ key: "mood", reason: "unclear" }, "clarification"))).toEqual({
      type: "clarification",
      key: "mood",
      reason: "unclear",
    });
  });

  it("returns null for malformed JSON, non-objects and unknown types", () => {
    expect(parseTurnEvent(msg("{not json"))).toBeNull();
    expect(parseTurnEvent(msg("[1,2]"))).toBeNull();
    expect(parseTurnEvent(msg('"text"'))).toBeNull();
    expect(parseTurnEvent(msg({ type: "mystery" }))).toBeNull();
  });

  it("returns null when a required field is missing or has the wrong type", () => {
    expect(parseTurnEvent(msg({ type: "transcript", text: "x" }))).toBeNull();
    expect(parseTurnEvent(msg({ type: "assistant", turnId: "t", text: 5 }))).toBeNull();
    expect(parseTurnEvent(msg({ type: "state", state: "NOPE" }))).toBeNull();
    expect(parseTurnEvent(msg({ type: "measurement", key: "not_a_key", value: 1 }))).toBeNull();
    expect(parseTurnEvent(msg({ type: "measurement", key: "mood", value: null }))).toBeNull();
    expect(parseTurnEvent(msg({ type: "measurement", key: "mood", value: Number.NaN }))).toBeNull();
    expect(parseTurnEvent(msg({ type: "summary", summary: { overall: "green" } }))).toBeNull();
  });

  it("normalises language codes and fills safe defaults", () => {
    const t = parseTurnEvent(msg({ type: "transcript", turnId: "t", text: "x", language: "mon" }));
    expect(t).toMatchObject({ language: "mn" });
    const a = parseTurnEvent(msg({ type: "assistant", turnId: "t", text: "x", language: "??", emotion: "angry" }));
    expect(a).toMatchObject({ language: "en", emotion: "neutral" });
    const e = parseTurnEvent(msg({ type: "error", code: "WEIRD", message: "m" }));
    expect(e).toEqual({ type: "error", code: "INTERNAL", message: "m", recoverable: true });
  });

  it("accepts every KPI key in a measurement", () => {
    for (const key of KPI_KEYS) {
      const e = parseTurnEvent(msg({ type: "measurement", key, value: key.endsWith("note") ? "text" : 1 }));
      expect(e, key).toMatchObject({ type: "measurement", key });
    }
  });
});

describe("iterateTurnEvents", () => {
  it("decodes a stream split into arbitrary byte chunks, including inside a UTF-8 character", async () => {
    const events: TurnEvent[] = [
      { type: "transcript", turnId: "t1", text: "Хоёр цаг унтсан", language: "mn" },
      { type: "state", state: "KPI_CAPTURE", expectedQuestion: "mood" },
      { type: "done" },
    ];
    const bytes = new TextEncoder().encode(events.map(sse).join(""));
    for (const size of [1, 2, 3, 7, 64]) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
      expect(await collect(iterateTurnEvents(streamOf(chunks))), `chunk size ${size}`).toEqual(events);
    }
  });

  it("skips malformed events without ending the stream", async () => {
    const body = streamOf([sse({ type: "done" }), "data: {oops\n\n", sse({ type: "done" })]);
    expect(await collect(iterateTurnEvents(body))).toEqual([{ type: "done" }, { type: "done" }]);
  });

  it("delivers an unterminated final event", async () => {
    const body = streamOf(['data: {"type":"done"}']);
    expect(await collect(iterateTurnEvents(body))).toEqual([{ type: "done" }]);
  });

  it("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(sse({ type: "done" })));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const message of iterateSseMessages(body)) {
      expect(message.event).toBe("message");
      break;
    }
    expect(cancelled).toBe(true);
  });
});

/* ───────────── reducer ───────────── */

function reduce(actions: CheckInAction[], from: CheckInState = initialCheckInState()): CheckInState {
  return actions.reduce(checkInReducer, from);
}
const ev = (event: TurnEvent): CheckInAction => ({ type: "TURN_EVENT", event });

const CREATED: CheckInAction = {
  type: "CREATED",
  created: {
    checkInId: "c1",
    state: "GREETING",
    language: "en",
    greeting: { turnId: "g1", text: "Hi Bat, I'm Cosmo." },
    resumed: false,
  },
};

describe("deriveCosmoState", () => {
  it("follows idle -> listening -> thinking -> talking -> idle", () => {
    const base = { recording: false, busy: false, speech: "idle" as const };
    expect(deriveCosmoState(base)).toBe("idle");
    expect(deriveCosmoState({ ...base, recording: true })).toBe("listening");
    expect(deriveCosmoState({ ...base, busy: true })).toBe("thinking");
    expect(deriveCosmoState({ ...base, speech: "loading" })).toBe("thinking");
    expect(deriveCosmoState({ ...base, busy: true, speech: "playing" })).toBe("talking");
    expect(deriveCosmoState({ ...base, speech: "playing" })).toBe("talking");
  });
});

describe("checkInReducer: lifecycle and cosmoState", () => {
  it("shows the greeting from the created check-in", () => {
    const s = reduce([{ type: "CREATE_START" }, CREATED]);
    expect(s.status).toBe("ready");
    expect(s.checkInId).toBe("c1");
    expect(s.conversation).toBe("GREETING");
    expect(s.transcript).toEqual([{ id: "g1", speaker: "cosmo", text: "Hi Bat, I'm Cosmo.", language: "en" }]);
    expect(s.cosmoState).toBe("idle");
  });

  it("goes idle -> listening -> thinking -> talking -> idle", () => {
    let s = reduce([CREATED]);
    s = checkInReducer(s, { type: "RECORDING", recording: true });
    expect(s.cosmoState).toBe("listening");
    // the utterance ends: recording stops and the turn starts in the same tick
    s = checkInReducer(s, { type: "RECORDING", recording: false });
    s = checkInReducer(s, { type: "SEND_START" });
    expect(s.cosmoState).toBe("thinking"); // before any event arrived
    s = checkInReducer(s, { type: "SPEECH", speech: "loading" });
    expect(s.cosmoState).toBe("thinking");
    s = checkInReducer(s, { type: "SPEECH", speech: "playing" });
    expect(s.cosmoState).toBe("talking");
    s = checkInReducer(s, ev({ type: "done" }));
    expect(s.cosmoState).toBe("talking"); // still speaking after the stream closed
    s = checkInReducer(s, { type: "SPEECH", speech: "idle" });
    expect(s.cosmoState).toBe("idle");
  });

  it("goes back to idle when a turn fails, and keeps typed text visible", () => {
    let s = reduce([CREATED, { type: "SEND_START", text: "I slept 6 hours" }]);
    expect(s.cosmoState).toBe("thinking");
    s = checkInReducer(s, {
      type: "TURN_FAILED",
      error: { code: "NETWORK", message: "x", recoverable: true },
    });
    expect(s.cosmoState).toBe("idle");
    expect(s.busy).toBe(false);
    expect(s.error?.code).toBe("NETWORK");
    expect(s.pendingCrew).toBeNull();
    expect(s.transcript.at(-1)).toMatchObject({ speaker: "crew", text: "I slept 6 hours" });
  });

  it("drops a voice utterance that failed before any text existed", () => {
    const s = reduce([
      CREATED,
      { type: "SEND_START" },
      { type: "TURN_FAILED", error: { code: "STT_FAILED", message: "", recoverable: true } },
    ]);
    expect(s.transcript).toHaveLength(1); // greeting only
    expect(s.pendingCrew).toBeNull();
  });

  it("records a create failure", () => {
    const s = reduce([
      { type: "CREATE_START" },
      { type: "CREATE_FAILED", error: { code: "NO_SESSION", message: "", recoverable: false } },
    ]);
    expect(s.status).toBe("failed");
    expect(s.error?.code).toBe("NO_SESSION");
  });
});

describe("checkInReducer: transcript", () => {
  it("shows a pending voice line, then replaces it with the transcript event", () => {
    let s = reduce([CREATED, { type: "SEND_START" }]);
    expect(s.pendingCrew).toEqual({ text: "", source: "voice" });
    s = checkInReducer(s, ev({ type: "transcript", turnId: "t1", text: "six hours", language: "en" }));
    expect(s.pendingCrew).toBeNull();
    expect(s.transcript.at(-1)).toEqual({ id: "t1", speaker: "crew", text: "six hours", language: "en" });
  });

  it("does not duplicate typed text when the transcript event echoes it", () => {
    let s = reduce([CREATED, { type: "SEND_START", text: "six hours" }]);
    expect(s.pendingCrew).toEqual({ text: "six hours", source: "text" });
    s = checkInReducer(s, ev({ type: "transcript", turnId: "t1", text: "six hours", language: "en" }));
    s = checkInReducer(s, ev({ type: "done" }));
    expect(s.transcript.filter((l) => l.speaker === "crew")).toHaveLength(1);
  });

  it("commits typed text when the server sends no transcript event", () => {
    let s = reduce([CREATED, { type: "SEND_START", text: "six hours" }]);
    s = checkInReducer(s, ev({ type: "assistant", turnId: "a1", text: "ok", language: "en", emotion: "neutral" }));
    expect(s.transcript.map((l) => l.speaker)).toEqual(["cosmo", "crew", "cosmo"]);
  });

  it("appends Cosmo lines, sets the emotion and ignores a repeated turn id", () => {
    let s = reduce([CREATED]);
    const assistant: TurnEvent = {
      type: "assistant",
      turnId: "a1",
      text: "That is a bit low.",
      language: "en",
      emotion: "concerned",
    };
    s = checkInReducer(s, ev(assistant));
    s = checkInReducer(s, ev(assistant));
    expect(s.emotion).toBe("concerned");
    expect(s.transcript.filter((l) => l.id === "a1")).toHaveLength(1);
  });

  it("shows typing progress and clears it when the turn is sent", () => {
    let s = reduce([CREATED, { type: "TYPING", text: "I sle" }]);
    expect(s.pendingCrew).toEqual({ text: "I sle", source: "text" });
    s = checkInReducer(s, { type: "SEND_START", text: "I slept" });
    expect(s.pendingCrew).toEqual({ text: "I slept", source: "text" });
    s = checkInReducer(s, { type: "TYPING", text: null });
    expect(s.pendingCrew).toBeNull();
  });

  it("tracks the conversation state and expected question", () => {
    const s = reduce([CREATED, ev({ type: "state", state: "KPI_CAPTURE", expectedQuestion: "sleep" })]);
    expect(s.conversation).toBe("KPI_CAPTURE");
    expect(s.expectedQuestion).toBe("sleep");
  });
});

describe("checkInReducer: cards", () => {
  const measurement = (over: Partial<Extract<TurnEvent, { type: "measurement" }>> = {}): TurnEvent => ({
    type: "measurement",
    key: "sleep_hours",
    value: 5.5,
    unit: "h",
    sourceText: "five and a half hours",
    confidence: 0.92,
    status: "yellow",
    reason: "fixed_range",
    change: "recorded",
    ...over,
  });

  it("adds a card per measurement, newest first, keeping the source snippet and status", () => {
    const s = reduce([
      CREATED,
      ev(measurement()),
      ev(measurement({ key: "mood", value: 4, unit: null, status: "green", sourceText: "pretty good" })),
    ]);
    expect(s.cards.map((c) => c.key)).toEqual(["mood", "sleep_hours"]);
    expect(s.cards[1]).toMatchObject({
      value: 5.5,
      unit: "h",
      sourceText: "five and a half hours",
      status: "yellow",
      reason: "fixed_range",
      flash: 0,
    });
  });

  it("updates a card in place on a correction and bumps the flash counter", () => {
    let s = reduce([CREATED, ev(measurement()), ev(measurement({ key: "mood", value: 4, unit: null, status: "green" }))]);
    s = checkInReducer(s, ev(measurement({ value: 7, status: "green", change: "corrected", sourceText: "7 hours" })));
    expect(s.cards.map((c) => c.key)).toEqual(["mood", "sleep_hours"]); // position kept
    const card = s.cards.find((c) => c.key === "sleep_hours");
    expect(card).toMatchObject({ value: 7, status: "green", sourceText: "7 hours", flash: 1 });
    s = checkInReducer(s, ev(measurement({ value: 8, change: "corrected" })));
    expect(s.cards.find((c) => c.key === "sleep_hours")?.flash).toBe(2);
  });

  it("shows a clarification and clears it when that key is captured", () => {
    let s = reduce([CREATED, ev({ type: "clarification", key: "sleep_hours", reason: "out of range" })]);
    expect(s.clarification).toEqual({ key: "sleep_hours", reason: "out of range" });
    s = checkInReducer(s, ev(measurement({ key: "mood", value: 3, unit: null, status: "green" })));
    expect(s.clarification).not.toBeNull(); // another key does not clear it
    s = checkInReducer(s, ev(measurement()));
    expect(s.clarification).toBeNull();
  });

  it("clears a clarification when the next turn starts, and on dismiss", () => {
    let s = reduce([CREATED, ev({ type: "clarification", key: "mood", reason: "?" }), { type: "SEND_START", text: "4" }]);
    expect(s.clarification).toBeNull();
    s = reduce([CREATED, ev({ type: "clarification", key: "mood", reason: "?" }), { type: "DISMISS_CLARIFICATION" }]);
    expect(s.clarification).toBeNull();
  });

  it("hydrates transcript, cards and state from a resume snapshot, hiding system turns", () => {
    const s = reduce([
      CREATED,
      {
        type: "SNAPSHOT",
        snapshot: {
          checkIn: { id: "c1", state: "KPI_CAPTURE", language: "mn", confirmedAt: null },
          measurements: [
            {
              key: "sleep_hours",
              value: 6,
              unit: "h",
              sourceText: "6 цаг",
              confidence: 0.9,
              source: "voice",
              createdAt: "2026-11-14T08:00:00.000Z",
              status: "yellow",
              reason: "fixed_range",
            },
            {
              key: "mood",
              value: 4,
              unit: null,
              sourceText: null,
              confidence: null,
              source: "typed",
              createdAt: "2026-11-14T08:01:00.000Z",
              status: "green",
              reason: "fixed_range",
            },
          ],
          turns: [
            { id: "x1", speaker: "cosmo", text: "Сайн уу", language: "mn", createdAt: "2026-11-14T08:00:00.000Z" },
            { id: "x2", speaker: "system", text: "tool call", language: "mn", createdAt: "2026-11-14T08:00:01.000Z" },
            { id: "x3", speaker: "crew", text: "6 цаг", language: "mn", createdAt: "2026-11-14T08:00:02.000Z" },
          ],
        },
      },
    ]);
    expect(s.conversation).toBe("KPI_CAPTURE");
    expect(s.language).toBe("mn");
    expect(s.transcript.map((l) => l.id)).toEqual(["x1", "x3"]);
    expect(s.cards.map((c) => c.key)).toEqual(["mood", "sleep_hours"]); // newest first
    expect(s.cards[0].sourceText).toBe("");
    expect(s.cards[1].source).toBe("voice");
  });
});

describe("checkInReducer: summary, timing, errors", () => {
  it("stores the summary and timing", () => {
    const s = reduce([
      CREATED,
      ev({ type: "summary", summary: summary("All good.") }),
      ev({ type: "timing", sttMs: 1, llmMs: 2, totalMs: 3 }),
    ]);
    expect(s.summary?.spoken.text).toBe("All good.");
    expect(s.timing).toEqual({ sttMs: 1, llmMs: 2, totalMs: 3 });
  });

  it("stores an error event and lets it be dismissed", () => {
    let s = reduce([CREATED, ev({ type: "error", code: "LLM_FAILED", message: "boom", recoverable: true })]);
    expect(s.error).toEqual({ code: "LLM_FAILED", message: "boom", recoverable: true });
    s = checkInReducer(s, { type: "DISMISS_ERROR" });
    expect(s.error).toBeNull();
  });

  it("clears the previous error when a new turn starts", () => {
    const s = reduce([
      CREATED,
      { type: "TURN_FAILED", error: { code: "NETWORK", message: "", recoverable: true } },
      { type: "SEND_START", text: "hi" },
    ]);
    expect(s.error).toBeNull();
  });

  it("does not mutate the previous state", () => {
    const before = reduce([CREATED]);
    const snapshot = JSON.stringify(before);
    checkInReducer(before, { type: "SEND_START", text: "hi" });
    checkInReducer(before, ev({ type: "assistant", turnId: "a", text: "x", language: "en", emotion: "happy" }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("a whole turn: SSE bytes -> events -> state", () => {
  it("folds a realistic stream into transcript, card, clarification, state and cosmoState", async () => {
    const turn: TurnEvent[] = [
      { type: "transcript", turnId: "t1", text: "I slept five and a half hours", language: "en" },
      {
        type: "measurement",
        key: "sleep_hours",
        value: 5.5,
        unit: "h",
        sourceText: "five and a half hours",
        confidence: 0.93,
        status: "yellow",
        reason: "baseline",
        change: "recorded",
      },
      { type: "clarification", key: "mood", reason: "I did not catch a number from 1 to 5" },
      { type: "state", state: "KPI_CAPTURE", expectedQuestion: "mood" },
      { type: "assistant", turnId: "a1", text: "That is a little short. How is your mood, 1 to 5?", language: "en", emotion: "concerned" },
      { type: "timing", sttMs: 300, llmMs: 900, totalMs: 1300 },
      { type: "done" },
    ];
    // split into awkward 5-byte chunks to exercise the real decoding path
    const bytes = new TextEncoder().encode(turn.map(sse).join(""));
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 5) chunks.push(bytes.slice(i, i + 5));

    let state = reduce([CREATED, { type: "SEND_START" }]);
    expect(state.cosmoState).toBe("thinking"); // before the first event
    for await (const event of iterateTurnEvents(streamOf(chunks))) {
      state = checkInReducer(state, { type: "TURN_EVENT", event });
    }
    state = checkInReducer(state, { type: "TURN_END" });

    expect(state.transcript.map((l) => [l.speaker, l.text])).toEqual([
      ["cosmo", "Hi Bat, I'm Cosmo."],
      ["crew", "I slept five and a half hours"],
      ["cosmo", "That is a little short. How is your mood, 1 to 5?"],
    ]);
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0]).toMatchObject({ key: "sleep_hours", value: 5.5, status: "yellow", reason: "baseline" });
    expect(state.clarification?.key).toBe("mood");
    expect(state.conversation).toBe("KPI_CAPTURE");
    expect(state.expectedQuestion).toBe("mood");
    expect(state.emotion).toBe("concerned");
    expect(state.timing?.llmMs).toBe(900);
    expect(state.busy).toBe(false);
    expect(state.cosmoState).toBe("idle");
  });
});

/* ───────────── demo helpers ───────────── */

describe("parseDemoScript", () => {
  it("accepts an array of strings", () => {
    expect(parseDemoScript(["I slept 5.5 hours", "  Mood is four  ", ""])).toEqual({
      language: null,
      utterances: ["I slept 5.5 hours", "Mood is four"],
    });
  });

  it("keeps only the crew side of a turn list", () => {
    const script = parseDemoScript({
      language: "mn",
      turns: [
        { speaker: "cosmo", text: "Сайн уу" },
        { speaker: "crew", text: "Сайн, 5.5 цаг унтсан" },
        { role: "assistant", text: "Баярлалаа" },
        { role: "user", text: "Сэтгэл санаа дөрөв" },
      ],
    });
    expect(script).toEqual({ language: "mn", utterances: ["Сайн, 5.5 цаг унтсан", "Сэтгэл санаа дөрөв"] });
  });

  it("understands { crew, cosmo } pairs and alternative list names", () => {
    expect(parseDemoScript({ script: [{ crew: "one", cosmo: "x" }, { crew: "two" }] })?.utterances).toEqual([
      "one",
      "two",
    ]);
    expect(parseDemoScript({ utterances: ["a", "b"] })?.utterances).toEqual(["a", "b"]);
  });

  it("returns null when there is nothing the crew says", () => {
    expect(parseDemoScript(null)).toBeNull();
    expect(parseDemoScript({})).toBeNull();
    expect(parseDemoScript({ turns: [{ speaker: "cosmo", text: "hello" }] })).toBeNull();
    expect(parseDemoScript({ turns: [{ speaker: "stranger", text: "hello" }] })).toBeNull();
    expect(parseDemoScript([])).toBeNull();
  });
});

describe("demo pacing", () => {
  it("keeps the gap between utterances within 1.0 to 1.5 s", () => {
    expect(demoGapMs(0)).toBe(1000);
    expect(demoGapMs(1)).toBe(1500);
    expect(demoGapMs(0.5)).toBe(1250);
    expect(demoGapMs(-3)).toBe(1000);
    expect(demoGapMs(9)).toBe(1500);
    expect(demoGapMs(Number.NaN)).toBe(1000);
  });

  it("types an utterance as growing prefixes ending with the full text", () => {
    const plan = typingPlan("Hello there");
    expect(plan.frames.at(-1)).toBe("Hello there");
    for (let i = 1; i < plan.frames.length; i++) {
      expect(plan.frames[i].startsWith(plan.frames[i - 1])).toBe(true);
      expect(plan.frames[i].length).toBeGreaterThan(plan.frames[i - 1].length);
    }
    expect(plan.frames[0].length).toBeGreaterThan(0);
  });

  it("never takes longer than the maximum, however long the sentence", () => {
    const long = "word ".repeat(400);
    const plan = typingPlan(long, { frameMs: 30, maxTotalMs: 2800 });
    expect(plan.frames.length * plan.frameMs).toBeLessThanOrEqual(2800 + plan.frameMs);
    expect(plan.frames.at(-1)).toBe(long);
  });

  it("types Cyrillic by character, not by UTF-16 unit", () => {
    const plan = typingPlan("Өнөөдөр");
    expect(plan.frames.at(-1)).toBe("Өнөөдөр");
    expect(plan.frames.every((f) => !f.includes("�"))).toBe(true);
  });

  it("has no frames for empty text", () => {
    expect(typingPlan("").frames).toEqual([]);
  });

  it("abortableSleep resolves true after the delay and false when aborted", async () => {
    const live = new AbortController();
    expect(await abortableSleep(5, live.signal)).toBe(true);
    const aborted = new AbortController();
    const p = abortableSleep(10_000, aborted.signal);
    aborted.abort();
    expect(await p).toBe(false);
    expect(await abortableSleep(10, aborted.signal)).toBe(false);
  });
});

describe("waitUntil", () => {
  it("resolves true once the predicate has been true for the stable period", async () => {
    const signal = new AbortController().signal;
    let calls = 0;
    const started = Date.now();
    const ok = await waitUntil(() => ++calls >= 3, signal, { timeoutMs: 2000, pollMs: 5, stableMs: 30 });
    expect(ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("restarts the stable period when the predicate flickers", async () => {
    const signal = new AbortController().signal;
    const answers = [true, true, false, true];
    let i = 0;
    const started = Date.now();
    const ok = await waitUntil(() => answers[Math.min(i++, answers.length - 1)], signal, {
      timeoutMs: 2000,
      pollMs: 10,
      stableMs: 40,
    });
    expect(ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40); // at least one full stable period after the flicker
  });

  it("gives up with false on timeout and on abort", async () => {
    const never = () => false;
    expect(await waitUntil(never, new AbortController().signal, { timeoutMs: 30, pollMs: 5 })).toBe(false);
    const controller = new AbortController();
    const pending = waitUntil(never, controller.signal, { timeoutMs: 10_000, pollMs: 5 });
    controller.abort();
    expect(await pending).toBe(false);
  });
});

/* ───────────── speech helpers ───────────── */

describe("speech helpers", () => {
  it("records audio/webm;codecs=opus when supported, else leaves the default", () => {
    expect(pickRecorderMimeType((t) => t === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
    expect(
      pickRecorderMimeType(() => {
        throw new Error("nope");
      }),
    ).toBeUndefined();
  });

  it("names the upload after its container", () => {
    expect(audioFileName("audio/webm;codecs=opus")).toBe("utterance.webm");
    expect(audioFileName("audio/mp4")).toBe("utterance.m4a");
    expect(audioFileName("audio/ogg;codecs=opus")).toBe("utterance.ogg");
    expect(audioFileName("")).toBe("utterance.webm");
  });

  const voices = [
    { name: "Generic", lang: "fr-FR" },
    { name: "UK", lang: "en-GB" },
    { name: "US remote", lang: "en-US", localService: false },
    { name: "US local", lang: "en_US", localService: true },
    { name: "Mongolian", lang: "mn-MN" },
  ];

  it("picks English voices by preference and a Mongolian voice when one exists", () => {
    expect(pickVoice(voices, "en")?.name).toBe("US local");
    expect(pickVoice(voices, "mn")?.name).toBe("Mongolian");
  });

  it("returns null when there is no voice for the language (Mongolian is often missing)", () => {
    expect(pickVoice(voices.filter((v) => !v.lang.startsWith("mn")), "mn")).toBeNull();
    expect(pickVoice([], "en")).toBeNull();
    expect(pickVoice([{ name: "x", lang: "mono" }], "mn")).toBeNull(); // "mono" is not "mn"
  });

  it("prefers the default voice among equals", () => {
    const list = [
      { name: "A", lang: "en-AU" },
      { name: "B", lang: "en-AU", default: true },
    ];
    expect(pickVoice(list, "en")?.name).toBe("B");
  });

  it("estimates a plausible spoken duration, clamped", () => {
    expect(estimateSpeechMs("", "en")).toBe(0);
    expect(estimateSpeechMs("Hi", "en")).toBe(1200);
    const ten = estimateSpeechMs("one two three four five six seven eight nine ten", "en");
    expect(ten).toBeGreaterThan(3000);
    expect(ten).toBeLessThan(6000);
    expect(estimateSpeechMs("word ".repeat(2000), "en")).toBe(25_000);
  });
});

/* ───────────── API client ───────────── */

describe("api client", () => {
  it("posts the crew id as JSON and sends the cookie", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    await postSession("bat", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/session");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(init?.body))).toEqual({ crewId: "bat" });
  });

  it("turns an error response into ApiClientError with the server's code", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: { code: "NO_SESSION", message: "Sign in" } }, { status: 401 });
    await expect(createCheckIn("en", fetchImpl)).rejects.toMatchObject({
      name: "ApiClientError",
      code: "NO_SESSION",
      status: 401,
      message: "Sign in",
    });
  });

  it("maps a non-JSON failure by HTTP status", async () => {
    const f404: FetchLike = async () => new Response("<html>", { status: 404 });
    await expect(fetchDashboard("c1", f404)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const f500: FetchLike = async () => new Response("oops", { status: 500 });
    await expect(fetchDashboard("c1", f500)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it('reports a network failure as code "NETWORK"', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    const err = await postSession("bat", fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("rethrows an abort instead of calling it a network failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(null);
    };
    const err = await postTurnText("c1", "hi", controller.signal, fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
  });

  it("requests the language when creating a check-in and never sends a crewId", async () => {
    const created = { checkInId: "c1", state: "GREETING", language: "mn", greeting: { turnId: "g", text: "x" }, resumed: false };
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(created));
    expect(await createCheckIn("mn", fetchImpl)).toEqual(created);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toEqual({ language: "mn" });
  });

  it("posts typed text as JSON and asks for an event stream", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(streamOf([sse({ type: "done" })])));
    await postTurnText("c 1", "I slept 6 hours", undefined, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/checkins/c%201/turn");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "I slept 6 hours" });
    expect((init?.headers as Record<string, string>).Accept).toBe("text/event-stream");
  });

  it("uploads audio as multipart field `audio` without a hand-set content type", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(streamOf([])));
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
    await postTurnAudio("c1", blob, undefined, fetchImpl);
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.body).toBeInstanceOf(FormData);
    const file = (init?.body as FormData).get("audio");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("utterance.webm");
    expect(Object.keys(init?.headers as Record<string, string>)).not.toContain("Content-Type");
  });

  it("builds same-origin audio URLs with encoded ids", () => {
    expect(turnAudioUrl("c1", "t/2")).toBe("/api/checkins/c1/turns/t%2F2/audio");
  });

  it("reads the crew list as a bare array or wrapped, dropping invalid entries", async () => {
    const good = { id: "bat", name: "Bat", role: "Flight engineer", preferredLanguage: "mn", mascotVariant: 0, avatarSeed: "bat" };
    const bare: FetchLike = async () => jsonResponse([good, { id: 5 }]);
    expect(await fetchCrew(bare)).toEqual([good]);
    const wrapped: FetchLike = async () => jsonResponse({ crew: [good] });
    expect(await fetchCrew(wrapped)).toEqual([good]);
    const junk: FetchLike = async () => jsonResponse({ nope: true });
    expect(await fetchCrew(junk)).toEqual([]);
  });

  it("requests the dashboard for one check-in", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ ok: 1 }));
    await fetchDashboard("c1", fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/dashboard?checkInId=c1");
  });

  it("returns null from fetchHealth when the endpoint fails", async () => {
    const bad: FetchLike = async () => new Response("x", { status: 500 });
    expect(await fetchHealth(bad)).toBeNull();
    const thrown: FetchLike = async () => {
      throw new TypeError("offline");
    };
    expect(await fetchHealth(thrown)).toBeNull();
  });

  it("fetches and parses the demo script for a language", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ turns: [{ speaker: "crew", text: "hi" }] }));
    expect(await fetchDemoScript("mn", fetchImpl)).toEqual({ language: null, utterances: ["hi"] });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/demo/script?lang=mn");
    const empty: FetchLike = async () => jsonResponse({ turns: [] });
    await expect(fetchDemoScript("en", empty)).rejects.toBeInstanceOf(ApiClientError);
  });
});

/* ───────────── crew helpers ───────────── */

describe("crew helpers", () => {
  const crew = { id: "bat", name: "Bat", role: "Flight engineer", preferredLanguage: "mn", mascotVariant: 1, avatarSeed: "bat" };

  it("round-trips a stored crew member and rejects malformed data", () => {
    expect(parseStoredCrew(JSON.stringify(crew))).toEqual(crew);
    expect(parseStoredCrew(null)).toBeNull();
    expect(parseStoredCrew("{broken")).toBeNull();
    expect(parseStoredCrew("42")).toBeNull();
    expect(parseStoredCrew(JSON.stringify({ ...crew, preferredLanguage: "fr" }))).toBeNull();
    expect(parseStoredCrew(JSON.stringify({ ...crew, mascotVariant: "1" }))).toBeNull();
  });

  it("drops unexpected extra fields from stored data (no health data can ride along)", () => {
    const parsed = parseStoredCrew(JSON.stringify({ ...crew, readiness: 91, notes: "secret" }));
    expect(parsed).toEqual(crew);
    expect(Object.keys(parsed ?? {}).sort()).toEqual(
      ["avatarSeed", "id", "mascotVariant", "name", "preferredLanguage", "role"],
    );
  });

  it("translates known roles and leaves unknown ones alone", () => {
    expect(roleSlug("Flight engineer")).toBe("flight_engineer");
    expect(roleKey("Flight engineer")).toBe("crew.role.flight_engineer");
    expect(roleKey("Mission specialist")).toBe("crew.role.mission_specialist");
    expect(roleKey("Commander")).toBe("crew.role.commander");
    expect(roleKey("Medical officer")).toBe("crew.role.medical_officer");
    expect(roleKey("Chef")).toBeNull();
  });
});

describe("StartGate: a release that arrives while the microphone is still opening", () => {
  it("is not deferred when no start is in flight", () => {
    const gate = new StartGate();
    expect(gate.defer("stop")).toBe(false);
    expect(gate.begin()).toBe(true);
    expect(gate.settle()).toBeNull();
  });

  it("remembers a stop that arrives between begin() and settle()", () => {
    const gate = new StartGate();
    gate.begin();
    expect(gate.starting).toBe(true);
    expect(gate.defer("stop")).toBe(true);
    expect(gate.settle()).toBe("stop");
    expect(gate.starting).toBe(false);
  });

  it("a cancel wins over a stop, in either order", () => {
    const a = new StartGate();
    a.begin();
    a.defer("stop");
    a.defer("cancel");
    expect(a.settle()).toBe("cancel");
    const b = new StartGate();
    b.begin();
    b.defer("cancel");
    b.defer("stop");
    expect(b.settle()).toBe("cancel");
  });

  it("does not run two starts at once, and a new start forgets the old request", () => {
    const gate = new StartGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.defer("stop");
    gate.settle();
    gate.begin();
    expect(gate.settle()).toBeNull();
  });
});

describe("recordingCapMs: the recorder's own hard limit", () => {
  it("caps push-to-talk (no VAD) at the 30 s maximum utterance", () => {
    expect(recordingCapMs(DEFAULT_VAD_CONFIG, false)).toBe(30_000);
  });

  it("with VAD the cap backstops the VAD limits (waiting for speech + one utterance)", () => {
    // 30 s waiting for speech (was 20 s) + one 30 s utterance
    expect(recordingCapMs(DEFAULT_VAD_CONFIG, true)).toBe(60_000);
  });

  it("capReached is inclusive of the limit", () => {
    expect(capReached(29_999, 30_000)).toBe(false);
    expect(capReached(30_000, 30_000)).toBe(true);
  });
});

describe("Siri-style stage: bubble items", () => {
  const m = (over: Partial<Extract<TurnEvent, { type: "measurement" }>>): TurnEvent => ({
    type: "measurement",
    key: "sleep_hours",
    value: 5.5,
    unit: "h",
    sourceText: "",
    confidence: 0.9,
    status: "green",
    reason: "fixed_range",
    change: "recorded",
    ...over,
  });

  it("lists bubbles in capture order and merges blood pressure into one bubble", () => {
    const s = reduce([
      CREATED,
      ev(m({ key: "sleep_hours" })),
      ev(m({ key: "bp_diastolic", value: 82, unit: "mmHg", status: "yellow" })),
      ev(m({ key: "mood", value: 4, unit: null })),
      ev(m({ key: "bp_systolic", value: 124, unit: "mmHg", status: "green" })),
    ]);
    const items = bubbleItems(s.cards);
    expect(items.map((i) => i.id)).toEqual(["sleep_hours", "bp", "mood"]);
    const bp = items[1];
    expect(bp.cards.map((c) => c.key)).toEqual(["bp_systolic", "bp_diastolic"]);
    expect(bp.status).toBe("yellow");
  });

  it("keeps a corrected bubble in its slot and bumps its flash", () => {
    let s = reduce([CREATED, ev(m({ key: "sleep_hours" })), ev(m({ key: "mood", value: 4, unit: null }))]);
    s = checkInReducer(s, ev(m({ key: "sleep_hours", value: 7, change: "corrected" })));
    const items = bubbleItems(s.cards);
    expect(items.map((i) => i.id)).toEqual(["sleep_hours", "mood"]);
    expect(items[0].flash).toBe(1);
  });

  it("worstStatus ranks red > yellow > green > no data", () => {
    expect(worstStatus(["green", "red", "yellow"])).toBe("red");
    expect(worstStatus(["no_data", "green"])).toBe("green");
    expect(worstStatus([])).toBe("no_data");
  });

  it("splits a trailing unit off a formatted value only when the KPI has one", () => {
    expect(splitValueUnit("124 mmHg", "mmHg")).toEqual({ value: "124", unit: "mmHg" });
    expect(splitValueUnit("5.5 цаг", "h")).toEqual({ value: "5.5", unit: "цаг" });
    expect(splitValueUnit("Slightly blurred", null)).toEqual({ value: "Slightly blurred", unit: "" });
    expect(splitValueUnit("4/5", null)).toEqual({ value: "4/5", unit: "" });
  });
});

describe("Siri-style stage: layout", () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  for (const [w, h] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1024, 768],
  ] as const) {
    it(`${w}x${h}: mascot ~70% high, 14 bubbles alternate sides, never over the body or each other`, () => {
      const layout = computeStageLayout(w, h, 14);
      expect(layout.mode).toBe("wide");
      expect(layout.mascot.size).toBeLessThanOrEqual(h * 0.7 + 0.5);
      expect(layout.slots).toHaveLength(14);
      const body = {
        x: w / 2 - layout.mascot.size * 0.43,
        y: layout.mascot.y,
        w: layout.mascot.size * 0.86,
        h: layout.mascot.size,
      };
      const boxes = layout.slots.map((s) => ({ x: s.x, y: s.y, w: layout.bubbleWidth, h: layout.bubbleHeight }));
      boxes.forEach((b, i) => {
        expect(overlaps(b, body), `slot ${i} over the mascot`).toBe(false);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(w);
        expect(layout.slots[i].side).toBe(i % 2 === 0 ? "left" : "right");
        for (let j = i + 1; j < boxes.length; j += 1) {
          expect(overlaps(b, boxes[j]), `slots ${i} and ${j}`).toBe(false);
        }
      });
      // top to bottom on each side
      const lefts = layout.slots.filter((s) => s.side === "left").map((s) => s.y);
      expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
      expect(lefts).toHaveLength(ROWS_PER_SIDE);
    });
  }

  it("squeezes more than 7 rows per side rather than dropping a bubble", () => {
    const layout = computeStageLayout(1440, 900, 16);
    expect(layout.slots).toHaveLength(16);
    const last = layout.slots[15];
    expect(last.y + layout.bubbleHeight).toBeLessThanOrEqual(layout.mascot.y + layout.mascot.size + 1);
  });

  it("phones: mascot on top, bubbles in a two-column grid below, stage grows to fit", () => {
    const layout = computeStageLayout(390, 844, 15);
    expect(layout.mode).toBe("narrow");
    expect(layout.slots.every((s) => s.side === "below")).toBe(true);
    expect(layout.slots[0].y).toBeGreaterThan(layout.mascot.y + layout.mascot.size);
    const last = layout.slots[14];
    expect(layout.height).toBeGreaterThanOrEqual(last.y + layout.bubbleHeight);
    expect(layout.slots.every((s) => s.x >= 0 && s.x + layout.bubbleWidth <= 390)).toBe(true);
  });

  it("the chest sits inside the mascot box and the floor under its feet", () => {
    const l = computeStageLayout(1440, 900, 0);
    expect(l.chest.x).toBeGreaterThan(l.mascot.x);
    expect(l.chest.x).toBeLessThan(l.mascot.x + l.mascot.size);
    expect(l.chest.y).toBeGreaterThan(l.mascot.y + l.mascot.size * 0.4);
    expect(l.floor.cy).toBeGreaterThan(l.mascot.y + l.mascot.size * 0.9);
    expect(l.captionY).toBeGreaterThan(l.floor.cy);
  });

  it("the pen trail ends on the bubble edge that faces the mascot and is a curved path", () => {
    const slotL = { x: 100, y: 200, side: "left" as const };
    const slotR = { x: 900, y: 200, side: "right" as const };
    expect(trailEnd(slotL, 260, 58)).toEqual({ x: 360, y: 229 });
    expect(trailEnd(slotR, 260, 58)).toEqual({ x: 900, y: 229 });
    const d = trailPath({ x: 700, y: 500 }, { x: 360, y: 229 });
    expect(d).toMatch(/^M 700 500 Q [-\d.]+ [-\d.]+ 360 229$/);
  });
});
