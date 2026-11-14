/**
 * Pure reducer for the check-in conversation (transcript, captured cards, conversation state,
 * cosmoState, emotion). No React, no I/O: unit-tested in tests/checkin.client.test.ts.
 *
 * cosmoState lifecycle (docs/BRIEF.md section 8):
 *   idle -> listening (while recording) -> thinking (the moment an utterance ends or text is sent,
 *   before any event arrives) -> talking (while audio plays) -> idle.
 */
import type { CosmoEmotion, CosmoState } from "@/components/cosmo/types";
import type {
  ApiErrorCode,
  CheckInCreated,
  CheckInSnapshot,
  ConversationState,
  KpiKey,
  Lang,
  MeasurementSource,
  MeasurementValue,
  QuestionId,
  Status,
  StatusReason,
  SummaryPayload,
  TurnEvent,
} from "@/lib/types";

export type SpeechStatus = "idle" | "loading" | "playing";

export interface TranscriptLine {
  id: string;
  speaker: "crew" | "cosmo";
  text: string;
  language: Lang;
}

/** A measurement card on the right-hand rail. */
export interface CaptureCard {
  key: KpiKey;
  value: MeasurementValue;
  unit: string | null;
  /** the crew member's own words the value was taken from ("from your words: ...") */
  sourceText: string;
  confidence: number | null;
  status: Status;
  reason: StatusReason;
  source: MeasurementSource | null;
  /** how many times this card was re-captured or corrected; drives the brief "corrected" flash */
  flash: number;
}

export interface CheckInError {
  code: ApiErrorCode | "NETWORK";
  message: string;
  recoverable: boolean;
}

export interface PendingCrewLine {
  /** typed or demo-typed text; empty for a voice utterance that is still being transcribed */
  text: string;
  source: "voice" | "text";
}

export interface CheckInState {
  status: "idle" | "creating" | "ready" | "failed";
  checkInId: string | null;
  language: Lang | null;
  conversation: ConversationState | null;
  expectedQuestion: QuestionId | null;
  /** friend mode is on: a conversation on the side, with a way back to the check-in */
  companion: boolean;
  transcript: TranscriptLine[];
  pendingCrew: PendingCrewLine | null;
  /** newest first */
  cards: CaptureCard[];
  clarification: { key: KpiKey; reason: string } | null;
  emotion: CosmoEmotion;
  recording: boolean;
  /** a turn request is in flight */
  busy: boolean;
  speech: SpeechStatus;
  cosmoState: CosmoState;
  summary: SummaryPayload | null;
  timing: { sttMs: number; llmMs: number; totalMs: number } | null;
  error: CheckInError | null;
  /** counter for ids of lines that arrive without a server turn id */
  localSeq: number;
}

export type CheckInAction =
  | { type: "CREATE_START" }
  | { type: "CREATED"; created: CheckInCreated }
  | { type: "CREATE_FAILED"; error: CheckInError }
  | { type: "SNAPSHOT"; snapshot: CheckInSnapshot }
  | { type: "RECORDING"; recording: boolean }
  | { type: "SPEECH"; speech: SpeechStatus }
  | { type: "TYPING"; text: string | null }
  | { type: "SEND_START"; text?: string }
  | { type: "TURN_EVENT"; event: TurnEvent }
  | { type: "TURN_END" }
  | { type: "TURN_FAILED"; error: CheckInError }
  | { type: "DISMISS_ERROR" }
  | { type: "DISMISS_CLARIFICATION" }
  /** the conversation switched language (EN/MN on the check-in screen); `turn` is what Cosmo says about it */
  | { type: "LANGUAGE"; language: Lang; turn: { turnId: string; text: string } | null };

export function deriveCosmoState(input: {
  recording: boolean;
  busy: boolean;
  speech: SpeechStatus;
}): CosmoState {
  if (input.speech === "playing") return "talking";
  if (input.busy || input.speech === "loading") return "thinking";
  if (input.recording) return "listening";
  return "idle";
}

export function initialCheckInState(): CheckInState {
  return {
    status: "idle",
    checkInId: null,
    language: null,
    conversation: null,
    expectedQuestion: null,
    companion: false,
    transcript: [],
    pendingCrew: null,
    cards: [],
    clarification: null,
    emotion: "neutral",
    recording: false,
    busy: false,
    speech: "idle",
    cosmoState: "idle",
    summary: null,
    timing: null,
    error: null,
    localSeq: 0,
  };
}

function withDerived(state: CheckInState): CheckInState {
  const cosmoState = deriveCosmoState(state);
  return cosmoState === state.cosmoState ? state : { ...state, cosmoState };
}

function pushLine(state: CheckInState, line: Omit<TranscriptLine, "id"> & { id?: string }): CheckInState {
  if (line.id !== undefined && state.transcript.some((l) => l.id === line.id)) return state;
  const id = line.id ?? `local-${state.localSeq + 1}`;
  return {
    ...state,
    localSeq: line.id === undefined ? state.localSeq + 1 : state.localSeq,
    transcript: [...state.transcript, { ...line, id }],
  };
}

/** Typed text that never got a `transcript` event is still shown, so it is not lost. */
function commitPending(state: CheckInState): CheckInState {
  const pending = state.pendingCrew;
  if (!pending) return state;
  const cleared = { ...state, pendingCrew: null };
  if (pending.text.trim() === "") return cleared;
  return pushLine(cleared, {
    speaker: "crew",
    text: pending.text,
    language: state.language ?? "en",
  });
}

function upsertCard(cards: CaptureCard[], event: Extract<TurnEvent, { type: "measurement" }>): CaptureCard[] {
  const existing = cards.find((c) => c.key === event.key);
  const card: CaptureCard = {
    key: event.key,
    value: event.value,
    unit: event.unit,
    sourceText: event.sourceText,
    confidence: event.confidence,
    status: event.status,
    reason: event.reason,
    source: existing?.source ?? null,
    flash: existing ? existing.flash + 1 : 0,
  };
  if (!existing) return [card, ...cards];
  return cards.map((c) => (c.key === event.key ? card : c));
}

function applyEvent(state: CheckInState, event: TurnEvent): CheckInState {
  switch (event.type) {
    case "transcript": {
      const cleared = { ...state, pendingCrew: null };
      return pushLine(cleared, {
        id: event.turnId,
        speaker: "crew",
        text: event.text,
        language: event.language,
      });
    }
    case "state":
      return { ...state, conversation: event.state, expectedQuestion: event.expectedQuestion, companion: event.companion === true };
    case "measurement": {
      const clarification = state.clarification?.key === event.key ? null : state.clarification;
      return { ...state, cards: upsertCard(state.cards, event), clarification };
    }
    case "clarification":
      return { ...state, clarification: { key: event.key, reason: event.reason } };
    case "assistant": {
      const committed = commitPending(state);
      return pushLine({ ...committed, emotion: event.emotion }, {
        id: event.turnId,
        speaker: "cosmo",
        text: event.text,
        language: event.language,
      });
    }
    case "summary":
      return { ...state, summary: event.summary };
    case "timing":
      return { ...state, timing: { sttMs: event.sttMs, llmMs: event.llmMs, totalMs: event.totalMs } };
    case "error":
      return {
        ...state,
        error: { code: event.code, message: event.message, recoverable: event.recoverable },
      };
    case "done":
      return { ...commitPending(state), busy: false };
  }
}

export function checkInReducer(state: CheckInState, action: CheckInAction): CheckInState {
  switch (action.type) {
    case "CREATE_START":
      return { ...state, status: "creating", error: null };

    case "CREATED": {
      const { created } = action;
      const base: CheckInState = {
        ...state,
        status: "ready",
        checkInId: created.checkInId,
        language: created.language,
        conversation: created.state,
        error: null,
      };
      return withDerived(
        pushLine(base, {
          id: created.greeting.turnId,
          speaker: "cosmo",
          text: created.greeting.text,
          language: created.language,
        }),
      );
    }

    case "CREATE_FAILED":
      return { ...state, status: "failed", error: action.error };

    case "SNAPSHOT": {
      const { snapshot } = action;
      const transcript: TranscriptLine[] = snapshot.turns
        .filter((t) => t.speaker !== "system")
        .map((t) => ({
          id: t.id,
          speaker: t.speaker === "crew" ? "crew" : "cosmo",
          text: t.text,
          language: t.language,
        }));
      const cards: CaptureCard[] = [...snapshot.measurements]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((m) => ({
          key: m.key,
          value: m.value,
          unit: m.unit,
          sourceText: m.sourceText ?? "",
          confidence: m.confidence,
          status: m.status,
          reason: m.reason,
          source: m.source,
          flash: 0,
        }));
      return {
        ...state,
        language: snapshot.checkIn.language,
        conversation: snapshot.checkIn.state,
        // keep local lines (for example the greeting) when the server has no turns yet
        transcript: transcript.length > 0 ? transcript : state.transcript,
        cards,
      };
    }

    case "RECORDING":
      return withDerived({ ...state, recording: action.recording });

    case "SPEECH":
      return withDerived({ ...state, speech: action.speech });

    case "TYPING":
      return {
        ...state,
        pendingCrew: action.text === null ? null : { text: action.text, source: "text" },
      };

    case "SEND_START": {
      const text = action.text?.trim();
      return withDerived({
        ...state,
        busy: true,
        error: null,
        clarification: null,
        pendingCrew: text ? { text, source: "text" } : { text: "", source: "voice" },
      });
    }

    case "TURN_EVENT":
      return withDerived(applyEvent(state, action.event));

    case "TURN_END":
      return withDerived({ ...commitPending(state), busy: false });

    case "TURN_FAILED": {
      // keep what the person typed visible; a voice utterance that failed has no text to keep
      return withDerived({ ...commitPending(state), busy: false, error: action.error });
    }

    case "DISMISS_ERROR":
      return { ...state, error: null };

    case "DISMISS_CLARIFICATION":
      return { ...state, clarification: null };

    case "LANGUAGE": {
      const switched = { ...state, language: action.language, clarification: null };
      return action.turn
        ? pushLine(switched, { id: action.turn.turnId, speaker: "cosmo", text: action.turn.text, language: action.language })
        : switched;
    }
  }
}
