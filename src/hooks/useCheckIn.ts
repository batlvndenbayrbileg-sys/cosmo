"use client";

/**
 * useCheckIn: the client side of one check-in.
 *
 *  - createCheckIn(): POST /api/checkins (resumes today's unfinished check-in), hydrates a resumed
 *    one from GET /api/checkins/:id, hands the greeting to `onAssistant` so Cosmo speaks it.
 *  - sendText(text) / sendAudio(blob): POST /api/checkins/:id/turn and read the SSE stream with
 *    fetch + ReadableStream. The reducer (components/checkin/state.ts) turns TurnEvents into the
 *    transcript, the capture cards, the conversation state, cosmoState and the emotion.
 *  - cosmoState goes to "thinking" synchronously when a turn starts, before any event arrives.
 *
 * Only one turn can be in flight; further sends are refused (they return false) until it is done.
 * `crewId` is never sent: the signed session cookie identifies the crew member.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  ApiClientError,
  createCheckIn as apiCreateCheckIn,
  fetchSnapshot,
  postLanguage as apiPostLanguage,
  postTurnAudio,
  postTurnText,
} from "@/components/checkin/api";
import { iterateTurnEvents } from "@/components/checkin/sse";
import {
  checkInReducer,
  initialCheckInState,
  type CheckInError,
  type CheckInState,
  type SpeechStatus,
} from "@/components/checkin/state";
import type { CosmoEmotion } from "@/components/cosmo/types";
import type { CheckInCreated, ConversationState, Lang, SummaryPayload } from "@/lib/types";
import { noteSosFromTurn } from "@/components/sos/store";
import { notePainFromTurn } from "@/components/pain/store";

export interface AssistantTurn {
  checkInId: string;
  turnId: string;
  text: string;
  language: Lang;
  emotion: CosmoEmotion;
}

export interface UseCheckInOptions {
  /**
   * language requested for a new check-in; undefined = the crew member's own preferred language (the check-in screen
   * leaves it undefined so a Mongolian crew member's check-in is always Mongolian)
   */
  language?: Lang;
  /**
   * Cosmo has something to say (greeting or a reply). The summary turn is not reported here: its
   * text arrives with the `summary` event and is spoken from `onSummary` after the dashboard shows.
   */
  onAssistant?: (turn: AssistantTurn) => void;
  /** the `summary` event arrived: load the dashboard, switch the view, speak summary.spoken.text */
  onSummary?: (summary: SummaryPayload, checkInId: string) => void;
  /** a resumed check-in that was already confirmed: go straight to the dashboard */
  onResumedFinished?: (checkInId: string) => void;
  /** a request came back 401: the session is gone, send the person to the crew screen */
  onNoSession?: () => void;
}

export interface UseCheckIn {
  state: CheckInState;
  createCheckIn: () => Promise<void>;
  sendText: (text: string) => Promise<boolean>;
  sendAudio: (audio: Blob) => Promise<boolean>;
  /** mirror the recorder's state into cosmoState */
  setRecording: (recording: boolean) => void;
  /** mirror the speech player's state into cosmoState */
  setSpeech: (speech: SpeechStatus) => void;
  /** live "typing" text shown as a pending crew line (used by the demo) */
  setTyping: (text: string | null) => void;
  dismissError: () => void;
  dismissClarification: () => void;
  /** hide the panels Cosmo is showing */
  dismissShow: () => void;
  /**
   * The crew member switched EN/MN on the screen: the open check-in continues in that language (Cosmo says so and
   * repeats where it stands, through `onAssistant`). Resolves false when nothing changed or the request failed.
   */
  setLanguage: (language: Lang) => Promise<boolean>;
}

function toError(error: unknown): CheckInError {
  if (error instanceof ApiClientError) {
    return { code: error.code, message: error.message, recoverable: error.code !== "NO_SESSION" };
  }
  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : "Unknown error",
    recoverable: true,
  };
}

function isFinishedState(state: ConversationState): boolean {
  return state === "DONE";
}

export function useCheckIn(options: UseCheckInOptions): UseCheckIn {
  const [state, dispatch] = useReducer(checkInReducer, undefined, initialCheckInState);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const checkInId = useRef<string | null>(null);
  const creating = useRef(false);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const createCheckIn = useCallback(async (): Promise<void> => {
    // StrictMode runs effects twice in development: one POST is enough (it is idempotent anyway)
    if (creating.current || checkInId.current) return;
    creating.current = true;
    dispatch({ type: "CREATE_START" });
    try {
      const created: CheckInCreated = await apiCreateCheckIn(optionsRef.current.language);
      checkInId.current = created.checkInId;
      dispatch({ type: "CREATED", created });

      if (created.resumed) {
        try {
          const snapshot = await fetchSnapshot(created.checkInId);
          dispatch({ type: "SNAPSHOT", snapshot });
          if (isFinishedState(snapshot.checkIn.state) || snapshot.checkIn.confirmedAt) {
            optionsRef.current.onResumedFinished?.(created.checkInId);
          }
        } catch {
          // the greeting is already on screen; a missing history is not worth blocking the check-in
        }
        return; // do not repeat the greeting out loud for a resumed check-in
      }

      optionsRef.current.onAssistant?.({
        checkInId: created.checkInId,
        turnId: created.greeting.turnId,
        text: created.greeting.text,
        language: created.language,
        emotion: "happy",
      });
    } catch (error) {
      const failure = toError(error);
      dispatch({ type: "CREATE_FAILED", error: failure });
      if (failure.code === "NO_SESSION") optionsRef.current.onNoSession?.();
    } finally {
      creating.current = false;
    }
  }, []);

  /** Runs one turn: open the stream, feed events to the reducer, always end in a clean state. */
  const runTurn = useCallback(
    async (open: (id: string, signal: AbortSignal) => Promise<Response>, typed?: string): Promise<boolean> => {
      const id = checkInId.current;
      if (!id || inFlight.current) return false;
      inFlight.current = true;
      const controller = new AbortController();
      abort.current = controller;
      dispatch({ type: "SEND_START", text: typed }); // cosmoState -> thinking, synchronously

      // the SUMMARY turn's text is spoken from the `summary` event, not from its `assistant` event
      let turnState: ConversationState | null = null;
      let turnLang: Lang = "en";
      try {
        const response = await open(id, controller.signal);
        if (!response.body) throw new ApiClientError("INTERNAL", "Empty response", response.status);
        for await (const event of iterateTurnEvents(response.body)) {
          if (!mounted.current) return true;
          dispatch({ type: "TURN_EVENT", event });
          if (event.type === "state") turnState = event.state;
          if (event.type === "assistant" && turnState !== "SUMMARY") {
            optionsRef.current.onAssistant?.({
              checkInId: id,
              turnId: event.turnId,
              text: event.text,
              language: event.language,
              emotion: event.emotion,
            });
          }
          if (event.type === "summary") optionsRef.current.onSummary?.(event.summary, id);
          if (event.type === "transcript") turnLang = event.language;
          // "tell Earth": the server stored the urgent alert; the SOS card takes the photo for it (src/components/sos)
          if (event.type === "sos") noteSosFromTurn(event, turnLang, id);
          // "it hurts": the body map, the related data and the guide (src/components/pain)
          if (event.type === "pain") notePainFromTurn(event, turnLang);
        }
        dispatch({ type: "TURN_END" });
      } catch (error) {
        if (controller.signal.aborted) {
          dispatch({ type: "TURN_END" });
        } else if (error instanceof ApiClientError && error.code === "STT_FAILED" && error.status === 422) {
          // no words in the recording (noise, a cough, "hmm"): nothing to answer and nothing to apologise for. The turn
          // ends quietly and hands-free listening simply starts again.
          dispatch({ type: "TURN_END" });
        } else {
          const failure = toError(error);
          dispatch({ type: "TURN_FAILED", error: failure });
          if (failure.code === "NO_SESSION") optionsRef.current.onNoSession?.();
        }
      } finally {
        inFlight.current = false;
        if (abort.current === controller) abort.current = null;
      }
      return true;
    },
    [],
  );

  const sendText = useCallback(
    (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (trimmed === "") return Promise.resolve(false);
      return runTurn((id, signal) => postTurnText(id, trimmed, signal), trimmed);
    },
    [runTurn],
  );

  const sendAudio = useCallback(
    (audio: Blob): Promise<boolean> => runTurn((id, signal) => postTurnAudio(id, audio, signal)),
    [runTurn],
  );

  const setRecording = useCallback((recording: boolean) => dispatch({ type: "RECORDING", recording }), []);
  const setSpeech = useCallback((speech: SpeechStatus) => dispatch({ type: "SPEECH", speech }), []);
  const setTyping = useCallback((text: string | null) => dispatch({ type: "TYPING", text }), []);
  const dismissError = useCallback(() => dispatch({ type: "DISMISS_ERROR" }), []);
  const dismissClarification = useCallback(() => dispatch({ type: "DISMISS_CLARIFICATION" }), []);
  const dismissShow = useCallback(() => dispatch({ type: "DISMISS_SHOW" }), []);

  const setLanguage = useCallback(async (language: Lang): Promise<boolean> => {
    const id = checkInId.current;
    if (!id) return false;
    try {
      const res = await apiPostLanguage(id, language);
      if (!mounted.current) return false;
      dispatch({ type: "LANGUAGE", language: res.language, turn: res.turn });
      if (res.turn) {
        optionsRef.current.onAssistant?.({
          checkInId: id,
          turnId: res.turn.turnId,
          text: res.turn.text,
          language: res.language,
          emotion: "neutral",
        });
      }
      return res.turn !== null;
    } catch (error) {
      const failure = toError(error);
      if (failure.code === "NO_SESSION") optionsRef.current.onNoSession?.();
      return false;
    }
  }, []);

  return {
    state,
    createCheckIn,
    sendText,
    sendAudio,
    setRecording,
    setSpeech,
    setTyping,
    dismissError,
    dismissClarification,
    dismissShow,
    setLanguage,
  };
}
