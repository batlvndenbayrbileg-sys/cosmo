"use client";

/**
 * CheckInExperience: the Siri-style check-in (docs/DESIGN_V2.md section 3).
 *
 *  - phase "conversation": nothing but the big Cosmo on the .aegis-bg gradient. She greets as soon
 *    as the page opens; after every sentence the microphone opens by itself (VAD ends the utterance
 *    after 900 ms of silence). Each captured value flies out of her chest as a glass bubble and is
 *    "written" into it. Ghost controls in the corners: back, language + captions, keyboard, demo.
 *  - phase "preparing": after the confirmation (the `summary` event) the bubbles converge into
 *    Cosmo, she thinks, "Preparing your dashboard..." shows for at least PREPARE_MIN_MS.
 *  - phase "dashboard": <DashboardView> with the SAME shared Cosmo element as `dockSlot`, so Cosmo
 *    shrinks into the dashboard's Cosmo card; then she speaks the summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { Play } from "lucide-react";
import { SharedCosmo } from "./CosmoStage";
import { CaptureBubble, PenTrail, PenTrailDefs } from "./CaptureBubble";
import { VisionCard } from "./VisionCard";
import { FloorRing, type RingMode } from "./FloorRing";
import {
  BackControl,
  Corner,
  DemoControl,
  FaceFollowControl,
  GLASS,
  KeyboardControl,
  LanguageCaptionControls,
  ProgressArc,
  QuestionBubble,
  StageToasts,
  type StageToast,
} from "./StageControls";
import { ApiClientError, fetchDashboard, fetchHealth, postTour, type TourFocus } from "./api";
import { DashboardTalk, type TalkStatus } from "./DashboardTalk";
import { ListeningPill } from "./ListeningPill";
import { handsFreeAllowed, listeningPillMode, pillQuoteSource, quoteForPill } from "./listening";
import { playHeardEarcon } from "./earcon";
import { ShowStage } from "@/components/show/ShowPanels";
import { EmergencyOverlay } from "@/components/emergency/EmergencyOverlay";
import { EMERGENCY_REQUEST_EVENT } from "@/components/emergency/EmergencyGuidePanel";
import { useEmergencyLibrary } from "@/components/emergency/hooks";
import { matchEmergency } from "@/lib/emergency";
import { SosStatus, sendSosToEarth } from "@/components/sos";
import { ShieldAlert } from "lucide-react";
import { bubbleItems, computeStageLayout } from "./bubbles";
import { freshCrewLines, type CheckInError } from "./state";
import { useDemoRunner } from "./useDemoRunner";
import { faceFollowPref } from "./face-follow-pref";
import type { FaceTrackFailure } from "./face-tracker";
import { DashboardView } from "@/components/dashboard";
import { parseStoredCrew, readSelectedCrewRaw } from "@/components/crew/selectedCrew";
import { useCheckIn } from "@/hooks/useCheckIn";
import { useFaceGaze } from "@/hooks/useFaceGaze";
import { useRecorder } from "@/hooks/useRecorder";
import { useSpeechPlayer, type SpeakTurn, type SpeechPlayer } from "@/hooks/useSpeechPlayer";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { CrewPublic, DashboardPayload, HealthResponse, Lang, SummaryPayload } from "@/lib/types";
import { IdentityChip, ModeControl } from "@/components/assistant/AssistantControls";

/** Let Cosmo's glide into the dashboard settle before she starts reading the summary. */
const SUMMARY_SPEECH_DELAY_MS = 700;
/** After Cosmo stops talking, wait this long before the microphone opens again (no self-echo). */
const RELISTEN_DELAY_MS = 450;
/** A recording smaller than this is a click or noise, not speech: it is not sent. */
const MIN_AUDIO_BYTES = 1200;
/** The "preparing" moment lasts at least this long, so the dashboard never just flashes in. */
const PREPARE_MIN_MS = 1200;
/** how long the "camera blocked / not found" hint stays up */
const FACE_HINT_MS = 7000;

type Phase = "conversation" | "preparing" | "dashboard";

/** the dashboard section Cosmo talks about during the spoken tour (data-slot markers in src/components/dashboard) */
const TOUR_SELECTOR: Record<TourFocus, string> = {
  overall: '[data-slot="profile-card"]',
  alerts: '[data-slot="alerts-strip"], [data-slot="profile-card"]',
  body: '[data-slot="body-hero"]',
  vital: '[data-slot="highlight-vital"]',
  radar: '[data-slot="radar-card"]',
  plan: '[data-slot="today-plan"]',
  timeline: '[data-slot="timeline"]',
  ask: '[data-slot="cosmo-dock"]',
};

const subscribeNever = () => () => {};
function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const readViewport = () => `${window.innerWidth}x${window.innerHeight}`;
const serverViewport = () => "1440x900";

function useViewport(): { width: number; height: number } {
  const raw = useSyncExternalStore(subscribeResize, readViewport, serverViewport);
  return useMemo(() => {
    const [w, h] = raw.split("x").map(Number);
    return { width: w || 1440, height: h || 900 };
  }, [raw]);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(t: (key: string) => string, error: CheckInError): string {
  switch (error.code) {
    case "NETWORK":
      return t("checkin.error.network");
    case "STT_FAILED":
      return t("checkin.error.stt");
    case "LLM_FAILED":
      return t("checkin.error.llm");
    case "WRONG_STATE":
      return t("checkin.error.wrongState");
    default:
      return t("checkin.error.generic");
  }
}

/** Space is push-to-talk unless the person is typing or pressing another control. */
function spaceBelongsToControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-mascot]")) return false;
  return target.closest("input, textarea, select, button, a, [contenteditable='true']") !== null;
}

/** the "/" screen (src/components/assistant/AssistantHome): who is speaking and how the conversation opens */
export interface AssistantEntry {
  crew: CrewPublic;
  roster: CrewPublic[];
  /** the person's first words (heard while they were recognised): answered first, greeting them by name */
  firstText: string | null;
  language?: Lang;
  welcome?: "quiet" | "back";
  /** the words named someone else (or "switch person": null) */
  onIdentity: (crewId: string | null) => void;
  /** the name chip: another crew member was tapped */
  onChoose: (crew: CrewPublic) => void;
  onNoSession: () => void;
  /** every utterance first: true = handled (another person), a string = send it as text, null = send the audio */
  routeUtterance: (blob: Blob) => Promise<true | string | null>;
}

export function CheckInExperience({ entry, assistant: entryProps }: { entry?: "assistant"; assistant?: AssistantEntry } = {}) {
  const router = useRouter();
  const { lang, t } = useI18n();
  const viewport = useViewport();
  const assistantEntry = entry === "assistant" ? (entryProps ?? null) : null;

  const rawCrew = useSyncExternalStore(subscribeNever, readSelectedCrewRaw, () => null);
  const crew = useMemo(() => parseStoredCrew(rawCrew), [rawCrew]);

  const [phase, setPhase] = useState<Phase>("conversation");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  /** the dashboard load failed: what "Show dashboard" retries */
  const [dashboardFailed, setDashboardFailed] = useState<{ checkInId: string; summary: SummaryPayload | null } | null>(null);
  const [veil, setVeil] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  /** hands-free: listen again by itself after every Cosmo sentence */
  const [conversationMode, setConversationMode] = useState(true);
  const [voiceIssue, setVoiceIssue] = useState<"denied" | "unsupported" | "failed" | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [captions, setCaptions] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [tapped, setTapped] = useState(false);
  /** after the check-in: Cosmo's spoken dashboard tour, then free conversation about the results */
  const [touring, setTouring] = useState(false);
  const [tourFocus, setTourFocus] = useState<TourFocus | null>(null);
  const [afterTalk, setAfterTalk] = useState(false);
  /** index into the transcript where the after-check-in conversation starts */
  const [talkFrom, setTalkFrom] = useState(0);
  const tourCancelled = useRef(false);
  /** "Cosmo looks at you" (camera face following): off unless turned on here before */
  const faceFollow = useSyncExternalStore(faceFollowPref.subscribe, faceFollowPref.read, () => false);
  const [faceHint, setFaceHint] = useState<FaceTrackFailure | null>(null);
  /** mirror of the transcript length, read when the after-check-in conversation opens */
  const transcriptLengthRef = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The speech player and the recorder are created after useCheckIn (they report into it), so the
  // check-in callbacks reach them through refs that are filled in an effect below.
  const speakRef = useRef<SpeechPlayer["speak"] | null>(null);
  /** assistant mode: leave the dashboard for the conversation stage (set below, once the tour controls exist) */
  const backToStageRef = useRef<() => void>(() => {});
  const cancelRecordingRef = useRef<(() => void) | null>(null);
  /** the last thing Cosmo said, replayed by "Tap to start" when autoplay was blocked */
  const lastTurn = useRef<SpeakTurn | null>(null);

  /* ───────────── preparing -> dashboard ───────────── */

  const openDashboard = useCallback(
    async (checkInId: string, summary: SummaryPayload | null) => {
      setPhase("preparing");
      setDashboardFailed(null);
      const started = performance.now();
      let payload: DashboardPayload;
      try {
        payload = await fetchDashboard(checkInId);
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiClientError && error.code === "NO_SESSION") {
          router.replace("/");
          return;
        }
        setDashboardFailed({ checkInId, summary });
        return;
      }
      const wait = PREPARE_MIN_MS - (performance.now() - started);
      if (wait > 0) await sleep(wait);
      if (!alive.current) return;
      setDashboard(payload);
      setPhase("dashboard");
      // the conversation bar shows only what is said on the dashboard, not the check-in's last lines
      setTalkFrom(transcriptLengthRef.current);
      if (summary) {
        await sleep(SUMMARY_SPEECH_DELAY_MS);
        if (!alive.current) return;
        await speakRef.current?.({
          checkInId,
          turnId: summary.audioTurnId,
          text: summary.spoken.text,
          language: summary.spoken.language,
        });
        // then Cosmo walks the astronaut through the dashboard, section by section
        if (alive.current && !tourCancelled.current) {
          try {
            const tour = await postTour(checkInId, summary.spoken.language);
            setTouring(true);
            for (const step of tour.steps) {
              if (!alive.current || tourCancelled.current) break;
              setTourFocus(step.focus);
              await speakRef.current?.({ checkInId, turnId: step.turnId, text: step.text, language: tour.language });
            }
          } catch {
            // the tour is a nice-to-have: the dashboard and the conversation work without it
          } finally {
            if (alive.current) {
              setTourFocus(null);
              setTouring(false);
            }
          }
        }
      }
      if (!alive.current) return;
      // and then the astronaut can keep talking with Cosmo about the results (the Q&A panel shows only what is
      // said from here on)
      setTalkFrom(transcriptLengthRef.current);
      setAfterTalk(true);
      setConversationMode(true);
    },
    [router],
  );

  /* ───────────── check-in, speech, microphone ───────────── */

  const checkIn = useCheckIn({
    // no language: the server uses the crew member's own language (Bat and Saraa Mongolian, Alex and Mira English).
    // Sending the UI language was a bug: on the first render it is the default "en", before the stored choice loads.
    language: undefined,
    onAssistant: (turn) => {
      const speakTurn: SpeakTurn = {
        checkInId: turn.checkInId,
        turnId: turn.turnId,
        text: turn.text,
        language: turn.language,
      };
      lastTurn.current = speakTurn;
      void speakRef.current?.(speakTurn);
    },
    onSummary: (summary, checkInId) => {
      setConversationMode(false);
      cancelRecordingRef.current?.();
      void openDashboard(checkInId, summary);
    },
    onResumedFinished: (checkInId) => {
      setConversationMode(false);
      void openDashboard(checkInId, null);
    },
    onNoSession: () => (assistantEntry ? assistantEntry.onNoSession() : router.replace("/")),
    // the "/" screen: the assistant conversation, with the daily check-up behind its button (assistantTurn.ts)
    assistant: assistantEntry ? { language: assistantEntry.language, welcome: assistantEntry.welcome } : undefined,
    onAction: (action) => {
      if (action.kind === "dashboard") void openDashboard(action.checkInId, null);
      else if (action.kind === "identity") assistantEntry?.onIdentity(action.crewId);
      else backToStageRef.current();
    },
  });
  const { state } = checkIn;
  useEffect(() => {
    transcriptLengthRef.current = state.transcript.length;
  }, [state.transcript.length]);
  const { setSpeech, setRecording, sendAudio, sendText, setTyping, createCheckIn, setLanguage: setConversationLanguage } = checkIn;

  // EN/MN pressed on this screen: the conversation follows, and Cosmo says where the check-in stands in the new
  // language. Only a change of the screen language counts (at mount it is the crew member's own, set by the crew
  // screen); before the check-in exists, or when it already speaks that language, nothing is sent.
  const lastUiLang = useRef(lang);
  useEffect(() => {
    if (lang === lastUiLang.current) return;
    lastUiLang.current = lang;
    if (!state.checkInId || state.status !== "ready" || state.language === lang) return;
    void setConversationLanguage(lang);
  }, [lang, state.checkInId, state.status, state.language, setConversationLanguage]);

  const player = useSpeechPlayer({ onStatusChange: setSpeech });
  /** a "barge-in" recording is open while Cosmo speaks; `heard` once the person started talking over her */
  const bargeIn = useRef({ active: false, heard: false });
  const recorder = useRecorder({
    onUtterance: (blob) => {
      bargeIn.current = { active: false, heard: false };
      if (blob.size < MIN_AUDIO_BYTES) return;
      playHeardEarcon(); // "got it", the moment the words are sent
      if (!assistantEntry) {
        void sendAudio(blob);
        return;
      }
      // the "/" screen: a clearly different voice is recognised first (src/components/assistant/AssistantHome)
      void assistantEntry.routeUtterance(blob).then((routed) => {
        if (routed === true) return;
        if (typeof routed === "string") void sendText(routed);
        else void sendAudio(blob);
      });
    },
    // the person talks over Cosmo: she stops at once and listens (team feedback 2026-11-15)
    onSpeechStart: ({ bargeIn: overCosmo }) => {
      if (!overCosmo) return;
      bargeIn.current = { active: true, heard: true };
      player.stop();
    },
    onRecordingChange: setRecording,
    onError: (error) => {
      setVoiceIssue(error.kind === "denied" ? "denied" : error.kind === "unsupported" ? "unsupported" : "failed");
      setConversationMode(false);
    },
    // nothing but silence for a while: stop listening; a tap on Cosmo or Space starts again
    onNoSpeech: () => setConversationMode(false),
  });

  const { speak, stop: stopSpeech, clearBlocked } = player;
  const { start: startRecorder, stop: stopRecorder, cancel: cancelRecorder } = recorder;

  useEffect(() => {
    speakRef.current = speak;
    cancelRecordingRef.current = cancelRecorder;
  }, [speak, cancelRecorder]);

  // start the check-in (Cosmo greets right away) and look at /api/health once
  useEffect(() => {
    void createCheckIn();
    let cancelled = false;
    void fetchHealth().then((h) => {
      if (!cancelled) setHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, [createCheckIn]);

  /* ───────────── "Cosmo looks at you" ───────────── */

  // the camera runs only while the check-in stage is on screen (not on the dashboard) and the tab is visible;
  // a blocked or missing camera turns the feature off again and leaves a short hint
  const face = useFaceGaze({
    enabled: faceFollow,
    active: phase !== "dashboard",
    onFailure: (failure) => {
      faceFollowPref.write(false);
      setFaceHint(failure);
    },
  });
  const toggleFaceFollow = useCallback((on: boolean) => {
    faceFollowPref.write(on);
    setFaceHint(null);
  }, []);
  useEffect(() => {
    if (!faceHint) return;
    const timer = setTimeout(() => setFaceHint(null), FACE_HINT_MS);
    return () => clearTimeout(timer);
  }, [faceHint]);

  /* ───────────── derived facts ───────────── */

  const ready = state.status === "ready";
  const sttDown = health?.mode === "live" && health.stt.available === false;
  const micBlocked = recorder.permission === "denied" || voiceIssue === "denied";
  const micUsable =
    recorder.supported && recorder.permission !== "unsupported" && !micBlocked && voiceIssue === null && !sttDown;
  const scripted = health?.mode === "scripted";
  const talking = phase === "conversation";
  /** the microphone may be used: during the check-in, and on the dashboard once the spoken tour is over */
  const canTalk = talking || (phase === "dashboard" && afterTalk && !touring);

  /* ───────────── demo ───────────── */

  const live = useRef({ idle: false, finished: false });
  useEffect(() => {
    live.current = {
      idle: ready && !state.busy && state.speech === "idle",
      finished: phase !== "conversation" || state.conversation === "DONE" || state.summary !== null,
    };
  }, [ready, state.busy, state.speech, phase, state.conversation, state.summary]);

  const demo = useDemoRunner({
    language: state.language ?? lang,
    sendText,
    setTyping,
    readLive: () => live.current,
    onStart: () => {
      setConversationMode(false);
      setKeyboardOpen(false);
      cancelRecorder();
      stopSpeech();
    },
  });

  /* ───────────── voice gestures ───────────── */

  const startListening = useCallback(
    (vad: boolean) => {
      if (!ready || state.busy || demo.running || !canTalk) return;
      stopSpeech();
      void startRecorder({ vad });
    },
    [ready, state.busy, demo.running, canTalk, stopSpeech, startRecorder],
  );

  const tapToStart = useCallback(() => {
    setTapped(true);
    clearBlocked();
    setConversationMode(true);
    if (lastTurn.current) void speak(lastTurn.current);
  }, [clearBlocked, speak]);

  const showTapToStart = player.blocked && !tapped && talking;

  /** The mascot itself is the (invisible) talk button. */
  const handleMascot = () => {
    if (showTapToStart) {
      tapToStart();
      return;
    }
    if (!micUsable) {
      setKeyboardOpen(true);
      return;
    }
    if (recorder.recording) {
      stopRecorder();
      return;
    }
    if (state.cosmoState === "thinking") return;
    setConversationMode(true);
    startListening(true);
  };

  // Space = push-to-talk (hold to talk, release to send)
  const pushToTalk = useRef(false);
  useEffect(() => {
    if (!canTalk || !micUsable) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || spaceBelongsToControl(e.target)) return;
      e.preventDefault();
      if (e.repeat || pushToTalk.current) return;
      pushToTalk.current = true;
      startListening(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !pushToTalk.current) return;
      e.preventDefault();
      pushToTalk.current = false;
      stopRecorder();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [canTalk, micUsable, startListening, stopRecorder]);

  // hands-free: listen again after Cosmo has finished, and also WHILE she speaks in "barge-in" mode, so the person can
  // interrupt her by talking (her own echo is learned as the room; see BARGE_IN_VAD). Tapping Cosmo or Space works too.
  useEffect(() => {
    const speaking = state.speech === "playing";
    if (
      !conversationMode ||
      !micUsable ||
      !ready ||
      !canTalk ||
      keyboardOpen ||
      player.blocked ||
      // during the check-in a finished conversation stops listening; on the dashboard it is the Q&A (the assistant
      // keeps listening after a finished check-up)
      (talking && state.conversation === "DONE" && !state.assistant) ||
      state.busy ||
      (state.speech !== "idle" && !speaking) ||
      recorder.recording ||
      demo.running
    ) {
      return;
    }
    const timer = setTimeout(
      () => {
        bargeIn.current = { active: speaking, heard: false };
        void startRecorder({ vad: true, bargeIn: speaking });
      },
      speaking ? 0 : RELISTEN_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [
    conversationMode,
    micUsable,
    ready,
    canTalk,
    talking,
    keyboardOpen,
    player.blocked,
    state.conversation,
    state.assistant,
    state.busy,
    state.speech,
    recorder.recording,
    startRecorder,
    demo.running,
  ]);

  // Cosmo finished and nobody talked over her: the barge-in recording (tuned to her echo) turns into normal listening
  // on the same open microphone, so an answer given right away is heard from its first word (closing and reopening
  // lost ~0.5-1 s). Only when hands-free listening may go on (not with the text field open, a finished check-in, a demo)
  // and the handover works; otherwise it is closed and the listening above starts fresh when allowed.
  const { endBargeIn } = recorder;
  const handsFree = handsFreeAllowed({
    conversationMode,
    micUsable,
    ready,
    canTalk,
    keyboardOpen,
    blocked: player.blocked,
    finished: talking && state.conversation === "DONE" && !state.assistant,
    busy: state.busy,
    demoRunning: demo.running,
  });
  useEffect(() => {
    if (state.speech !== "idle") return;
    if (bargeIn.current.active && !bargeIn.current.heard && recorder.recording) {
      bargeIn.current = { active: false, heard: false };
      if (!handsFree || !endBargeIn()) cancelRecorder();
    }
  }, [state.speech, recorder.recording, cancelRecorder, endBargeIn, handsFree]);

  const handleSendText = useCallback(
    (text: string) => {
      cancelRecorder();
      stopSpeech();
      void sendText(text);
    },
    [cancelRecorder, stopSpeech, sendText],
  );

  // the "/" screen: the person's first words (heard while they were recognised) are answered first, by name
  const firstSent = useRef(false);
  const firstText = assistantEntry?.firstText ?? null;
  useEffect(() => {
    if (!firstText || firstSent.current || !ready || state.busy) return;
    firstSent.current = true;
    void sendText(firstText, { greet: true });
  }, [firstText, ready, state.busy, sendText]);

  const retryDashboard = useCallback(() => {
    if (dashboardFailed) void openDashboard(dashboardFailed.checkInId, dashboardFailed.summary);
  }, [dashboardFailed, openDashboard]);

  /* ───────────── after the check-in: tour + conversation ───────────── */

  // the section Cosmo is talking about glows and scrolls into view
  useEffect(() => {
    if (!tourFocus) return;
    const el = document.querySelector<HTMLElement>(TOUR_SELECTOR[tourFocus]);
    if (!el) return;
    el.classList.add("tour-focus");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    return () => el.classList.remove("tour-focus");
  }, [tourFocus]);

  /* ───────────── emergency guidance (team-prepared content, opened by SOS or by what is said) ───────────── */

  // the built-in guides at once (no network needed), then the server's list with the team's content
  const emergencyLib = useEmergencyLibrary();
  const [emergency, setEmergency] = useState<{ open: boolean; id: string | null; alerted: boolean }>({
    open: false,
    id: null,
    alerted: false,
  });
  const checkInIdNow = state.checkInId;

  const openEmergency = useCallback(
    (id: string | null) => {
      cancelRecorder();
      stopSpeech();
      tourCancelled.current = true;
      setConversationMode(false);
      setEmergency((prev) => ({ open: true, id, alerted: prev.alerted }));
      if (id && checkInIdNow) {
        void fetch("/api/emergency/alert", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId: id, checkInId: checkInIdNow }),
        })
          .then((r) => {
            if (r.ok) setEmergency((prev) => ({ ...prev, alerted: true }));
          })
          .catch(() => {});
      }
    },
    [cancelRecorder, stopSpeech, checkInIdNow],
  );

  // the dashboard's "Emergency guide" tab asks for help through a window event (DashboardView knows no check-in)
  useEffect(() => {
    const onRequest = (e: Event) => {
      const id = (e as CustomEvent<{ scenarioId?: string }>).detail?.scenarioId;
      if (typeof id !== "string") return;
      e.preventDefault();
      openEmergency(id);
    };
    window.addEventListener(EMERGENCY_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(EMERGENCY_REQUEST_EVENT, onRequest);
  }, [openEmergency]);

  // what the astronaut says can open the matching guidance by itself (each crew line is checked once)
  const checkedLines = useRef(0);
  useEffect(() => {
    const lines = state.transcript;
    // only what was said in this visit: a resumed conversation's history does not reopen a guide (or alert again)
    for (const line of freshCrewLines(lines, checkedLines.current)) {
      const hit = matchEmergency(line.text, emergencyLib);
      if (hit && !emergency.open) {
        openEmergency(hit.scenarioId);
        break;
      }
    }
    checkedLines.current = lines.length;
  }, [state.transcript, emergencyLib, emergency.open, openEmergency]);

  const emergencyUi = (where: "conversation" | "dashboard") => (
    <>
      <button
        type="button"
        onClick={() => {
          // SOS = an urgent alert to Earth (with a face photo), then the guidance (src/components/sos)
          void sendSosToEarth({ checkInId: checkInIdNow, lang: state.language ?? lang });
          openEmergency(null);
        }}
        aria-label={t("checkin.emergency.openLabel")}
        className={cn(
          "fixed z-[60] flex h-10 items-center gap-1.5 rounded-full border border-[#C53030]/25 bg-white/80 px-4 text-[14px] font-semibold tracking-wide text-[#C53030] shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100",
          where === "conversation" ? "top-4 left-[4.5rem] opacity-60" : "bottom-12 left-5 opacity-80",
        )}
      >
        <ShieldAlert className="size-4" aria-hidden />
        {t("checkin.emergency.open")}
      </button>
      <AnimatePresence>
        {emergency.open ? (
          <EmergencyOverlay
            scenarios={emergencyLib}
            activeId={emergency.id}
            lang={state.language ?? lang}
            alerted={emergency.alerted}
            onSelect={(id) => openEmergency(id)}
            onCallHelp={() => openEmergency("call-for-help")}
            onClose={() => setEmergency((prev) => ({ ...prev, open: false }))}
            banner={<SosStatus variant="inline" checkInId={checkInIdNow} lang={state.language ?? lang} />}
          />
        ) : null}
      </AnimatePresence>
      {emergency.open ? null : <SosStatus variant="floating" checkInId={checkInIdNow} lang={state.language ?? lang} />}
    </>
  );

  const skipTour = useCallback(() => {
    tourCancelled.current = true;
    stopSpeech();
  }, [stopSpeech]);

  // assistant mode: "back to assistant" from the dashboard returns to the conversation stage (Cosmo glides back)
  const backToStage = useCallback(() => {
    if (touring) skipTour();
    setPhase("conversation");
    setConversationMode(true);
  }, [touring, skipTour]);
  useEffect(() => {
    backToStageRef.current = backToStage;
  }, [backToStage]);

  const handleDashboardMic = useCallback(() => {
    if (recorder.recording) {
      stopRecorder();
      return;
    }
    setConversationMode(true);
    startListening(true);
  }, [recorder.recording, stopRecorder, startListening]);

  const talkLines = state.transcript.slice(talkFrom);
  const lastQuestionIndex = talkLines.map((l) => l.speaker).lastIndexOf("crew");
  const lastQuestion = lastQuestionIndex >= 0 ? talkLines[lastQuestionIndex].text : null;
  const lastAnswer =
    lastQuestionIndex >= 0 ? (talkLines.slice(lastQuestionIndex + 1).find((l) => l.speaker === "cosmo")?.text ?? null) : null;
  const talkStatus: TalkStatus = touring
    ? "touring"
    : recorder.recording
      ? "listening"
      : state.busy
        ? "thinking"
        : state.speech !== "idle"
          ? "speaking"
          : "idle";

  /* ───────────── toasts ───────────── */

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));
  const toasts: StageToast[] = [];
  if (scripted) {
    toasts.push({ id: "scripted", tone: "info", text: t("shell.banner.scripted"), onDismiss: () => dismiss("scripted") });
  }
  if (micBlocked) {
    toasts.push({ id: "mic", tone: "info", text: t("shell.banner.micBlocked"), onDismiss: () => dismiss("mic") });
  } else if (!micUsable && ready) {
    toasts.push({ id: "voice", tone: "info", text: t("shell.banner.voiceUnavailable"), onDismiss: () => dismiss("voice") });
  }
  if (player.fallback === "browser") {
    toasts.push({ id: "browserVoice", tone: "info", text: t("checkin.banner.browserVoice"), onDismiss: () => dismiss("browserVoice") });
  } else if (player.fallback === "silent") {
    toasts.push({ id: "speech", tone: "info", text: t("shell.banner.speechUnavailable"), onDismiss: () => dismiss("speech") });
  }
  if (state.status === "failed" && state.error?.code !== "NO_SESSION") {
    toasts.push({
      id: "start",
      tone: "error",
      text: t("checkin.start.failed"),
      action: t("shell.action.retry"),
    });
  } else if (state.error) {
    toasts.push({ id: "error", tone: "error", text: errorText(t, state.error), onDismiss: checkIn.dismissError });
  }
  if (faceHint) {
    toasts.push({
      id: "faceFollow",
      tone: "info",
      text: t(`checkin.faceFollow.${faceHint}`),
      onDismiss: () => setFaceHint(null),
    });
  }
  if (demo.failed) {
    toasts.push({ id: "demo", tone: "error", text: t("checkin.demo.failed"), onDismiss: () => dismiss("demo") });
  }
  if (dashboardFailed) {
    toasts.push({
      id: "dashboard",
      tone: "error",
      text: t("checkin.error.dashboard"),
      action: t("checkin.dashboard.retry"),
    });
  }
  const visibleToasts = toasts.filter((x) => x.id === "error" || x.id === "start" || x.id === "dashboard" || !dismissed.has(x.id));

  const handleToastAction = (id: string) => {
    if (id === "start") void createCheckIn();
    if (id === "dashboard") retryDashboard();
  };

  /* ───────────── render ───────────── */

  const variant = assistantEntry?.crew.mascotVariant ?? crew?.mascotVariant ?? dashboard?.crew.mascotVariant ?? 0;
  /** the "/" screen's own controls: the daily check-up / back button and who is speaking */
  const modeControl = (placement: "stage" | "dashboard") =>
    assistantEntry ? (
      <div
        className={cn(
          "fixed z-[60]",
          placement === "dashboard"
            ? // phones: on the left, which stays on screen even when the dashboard is wider than the phone
              "left-4 bottom-[5.5rem] sm:top-20 sm:right-6 sm:bottom-auto sm:left-auto"
            : // phones: above the typing field while it is open (it would cover the field)
              cn("right-4 sm:right-6 sm:bottom-44", keyboardOpen ? "bottom-[10.5rem]" : "bottom-[7.5rem]"),
        )}
      >
        <ModeControl
          assistant={state.assistant}
          conversation={state.conversation}
          placement={placement}
          disabled={!ready || state.busy || demo.running}
          onSay={handleSendText}
          onBackLocal={backToStage}
        />
      </div>
    ) : null;
  const cosmoState = phase === "preparing" ? "thinking" : state.cosmoState;

  const cosmo = (
    <SharedCosmo
      variant={variant}
      state={cosmoState}
      emotion={state.emotion}
      amplitude={player.amplitude}
      label={t("checkin.stage.label")}
      gaze={face.gaze}
    />
  );

  if (phase === "dashboard" && dashboard) {
    return (
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <DashboardView
            payload={dashboard}
            viewer="crew"
            dockSlot={cosmo}
            dockOpen={touring || afterTalk ? false : undefined}
          />
          {touring || afterTalk ? (
            <DashboardTalk
              status={talkStatus}
              question={lastQuestion}
              answer={lastAnswer}
              micUsable={micUsable}
              onMic={handleDashboardMic}
              onSkipTour={skipTour}
              onSendText={handleSendText}
            />
          ) : null}
          {/* the small panels Cosmo shows when asked about a value (show event), above her dock */}
          <ShowStage
            show={state.show}
            hold={state.busy || state.speech !== "idle"}
            onDismiss={checkIn.dismissShow}
            placement="dashboard"
            checkInId={state.checkInId}
          />
          {veil ? (
            <motion.div
              aria-hidden="true"
              className="aegis-bg pointer-events-none fixed inset-0 z-30"
              initial={{ opacity: 1, scale: 1 }}
              animate={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.75, ease: [0.4, 0, 0.2, 1] }}
              onAnimationComplete={() => setVeil(false)}
            />
          ) : null}
          {emergencyUi("dashboard")}
          {modeControl("dashboard")}
        </LayoutGroup>
      </MotionConfig>
    );
  }

  // assistant mode shows no capture bubbles: the check-up's values come back with the check-up
  const items = bubbleItems(state.assistant ? [] : state.cards);
  const layout = computeStageLayout(viewport.width, viewport.height, items.length);
  const { mascot } = layout;
  const preparing = phase === "preparing";

  const ringMode: RingMode = preparing
    ? "thinking"
    : state.cosmoState === "talking"
      ? "speaking"
      : state.cosmoState === "thinking"
        ? "thinking"
        : state.cosmoState === "listening"
          ? "listening"
          : "idle";
  const statusKey = cosmoState === "talking" ? "speaking" : cosmoState;

  const lastLine = state.transcript[state.transcript.length - 1] ?? null;
  const lastCosmo = [...state.transcript].reverse().find((l) => l.speaker === "cosmo") ?? null;
  const pending = state.pendingCrew;
  const caption: { text: string; who: "crew" | "cosmo" | "hint" } | null = pending?.text
    ? { text: pending.text, who: "crew" }
    : recorder.recording
      ? { text: `${t("checkin.status.listening")}…`, who: "hint" }
      : pending
        ? { text: t("checkin.captions.transcribing"), who: "hint" }
        : lastLine
          ? { text: lastLine.text, who: lastLine.speaker }
          : null;

  const mascotLabel = showTapToStart
    ? t("checkin.tapToStart")
    : !micUsable
      ? t("checkin.text.label")
      : recorder.recording
        ? t("checkin.mascot.stop")
        : t("checkin.mascot.talk");

  const questionWidth = Math.min(300, Math.max(200, layout.width - (mascot.x + mascot.size * 0.68) - 16));

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div
          data-slot="checkin-stage"
          data-phase={phase}
          className="aegis-bg fixed inset-0 z-50 overflow-x-hidden overflow-y-auto"
        >
          <h1 className="sr-only">{t(assistantEntry && state.assistant ? "checkin.assistant.stage.label" : "checkin.page.label")}</h1>
          <p role="status" className="sr-only">
            {preparing ? t("checkin.preparing") : t(`checkin.status.${statusKey}`)}
          </p>
          <p aria-live="polite" className="sr-only">
            {lastCosmo?.text ?? ""}
          </p>
          <p id="checkin-space-hint" className="sr-only">
            {t("checkin.hint.space")}
          </p>

          <div className="relative w-full" style={{ height: layout.height }}>
            {/* pen trails behind the bubbles */}
            {!preparing ? (
              <svg
                aria-hidden="true"
                focusable="false"
                className="pointer-events-none absolute inset-0 overflow-visible"
                width={layout.width}
                height={layout.height}
              >
                <PenTrailDefs />
                {items.map((item, i) =>
                  layout.slots[i] ? (
                    <PenTrail
                      key={item.id}
                      writeKey={`${item.id}-${item.flash}`}
                      from={layout.chest}
                      slot={layout.slots[i]}
                      width={layout.bubbleWidth}
                      height={layout.bubbleHeight}
                    />
                  ) : null,
                )}
              </svg>
            ) : null}

            <FloorRing
              {...layout.floor}
              mode={ringMode}
              amplitude={player.amplitude}
              level={recorder.recording ? recorder.level : null}
            />

            {/* the big mascot: also the invisible talk button */}
            <motion.div
              className="absolute"
              style={{ left: mascot.x, top: mascot.y, width: mascot.size, height: mascot.size }}
              initial={{ opacity: 0, scale: 0.9, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            >
              <button
                type="button"
                data-mascot=""
                onClick={handleMascot}
                aria-label={mascotLabel}
                aria-describedby="checkin-space-hint"
                aria-pressed={micUsable ? recorder.recording : undefined}
                disabled={preparing}
                className="size-full cursor-pointer rounded-[38%] outline-none focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/30 disabled:cursor-default"
              >
                {cosmo}
              </button>
            </motion.div>

            <QuestionBubble
              clarification={preparing ? null : state.clarification}
              x={mascot.x + mascot.size * 0.66}
              y={mascot.y + mascot.size * 0.01}
              maxWidth={questionWidth}
            />

            {/* the vision self-check needs something to read: show it while Cosmo asks that question */}
            <AnimatePresence>
              {!preparing &&
              phase !== "dashboard" &&
              !state.companion &&
              state.conversation === "KPI_CAPTURE" &&
              state.expectedQuestion === "vision" ? (
                <VisionCard key="vision" />
              ) : null}
            </AnimatePresence>

            {/* the small panels Cosmo shows beside her (show event): right of her on wide screens, under her on phones */}
            <ShowStage
              show={preparing ? null : state.show}
              hold={state.busy || state.speech !== "idle"}
              onDismiss={checkIn.dismissShow}
              placement={layout.mode === "wide" ? "wide" : "narrow"}
              top={layout.captionY + 36}
              checkInId={state.checkInId}
            />

            {/* captured values */}
            <ul aria-label={t("checkin.bubbles.title")} className="contents">
              {items.map((item, i) =>
                layout.slots[i] ? (
                  <CaptureBubble
                    key={item.id}
                    item={item}
                    index={i}
                    slot={layout.slots[i]}
                    width={layout.bubbleWidth}
                    height={layout.bubbleHeight}
                    chest={layout.chest}
                    converge={preparing}
                  />
                ) : null,
              )}
            </ul>

            {/* caption line (CC) or the preparing line, under the floor */}
            <div
              className="absolute inset-x-0 flex justify-center px-6"
              style={{ top: layout.captionY }}
            >
              <AnimatePresence mode="wait">
                {preparing ? (
                  <motion.p
                    key="preparing"
                    role="status"
                    className="flex items-center gap-2.5 text-[17px] font-normal text-[var(--aegis-ink)]"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                  >
                    <ProgressArc />
                    {t("checkin.preparing")}
                  </motion.p>
                ) : captions && caption ? (
                  <motion.p
                    key="caption"
                    data-slot="caption"
                    className={cn(
                      "line-clamp-2 max-w-[min(46rem,92vw)] text-center text-[15.5px] leading-snug",
                      // the open text field sits bottom-right: keep the caption clear of it on wide screens
                      keyboardOpen && layout.mode === "wide" && "max-w-[max(16rem,calc(100vw-58rem))]",
                      caption.who === "crew" && "font-medium text-[var(--aegis-ink)]",
                      caption.who === "cosmo" && "text-[var(--aegis-ink)]/80",
                      caption.who === "hint" && "text-[var(--aegis-label)] italic",
                    )}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {caption.text}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>

            {/* autoplay was blocked: one tap starts Cosmo, shown once */}
            <AnimatePresence>
              {showTapToStart ? (
                <motion.div
                  key="tap"
                  className="absolute inset-x-0 flex justify-center"
                  style={{ top: mascot.y + mascot.size * 0.5 }}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                >
                  <button
                    type="button"
                    onClick={tapToStart}
                    autoFocus
                    className={cn(
                      GLASS,
                      "flex h-14 items-center gap-3 rounded-full px-7 text-[17px] font-medium text-[var(--aegis-ink)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/40",
                    )}
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--aegis-ink)] text-white">
                      <Play className="size-3.5 translate-x-px fill-current" aria-hidden="true" />
                    </span>
                    {t("checkin.tapToStart")}
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* friend mode: a plain way back to the check-in (it says "let's continue" for the astronaut) */}
            <AnimatePresence>
              {!preparing && !showTapToStart && phase !== "dashboard" && state.companion ? (
                <motion.div
                  key="companion-back"
                  className="absolute inset-x-0 flex justify-center"
                  style={{ top: mascot.y + mascot.size * 1.02 }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <button
                    type="button"
                    data-slot="companion-back"
                    onClick={() => handleSendText(t("checkin.companion.say"))}
                    disabled={!ready || state.busy || demo.running}
                    className={cn(
                      GLASS,
                      "flex h-11 items-center rounded-full px-5 text-[15px] font-medium text-[var(--aegis-ink)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/40 disabled:opacity-60",
                    )}
                  >
                    {t("checkin.companion.back")}
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <StageToasts toasts={visibleToasts} onAction={handleToastAction} />

          {/* listening / heard you (Done) / writing it down / thinking: never a silent wait after speaking */}
          <ListeningPill
            mode={
              preparing
                ? null
                : listeningPillMode({
                    recording: recorder.recording,
                    heard: recorder.heard,
                    busy: state.busy,
                    speech: state.speech,
                    transcribing: pending?.source === "voice" && pending.text === "",
                  })
            }
            quote={quoteForPill(pillQuoteSource(pending, lastLine))}
            level={recorder.level}
            onDone={stopRecorder}
          />

          {assistantEntry ? (
            <div className="fixed top-4 left-4 z-[55] sm:top-auto sm:bottom-[5.5rem]">
              <IdentityChip
                crew={assistantEntry.crew}
                roster={assistantEntry.roster}
                onChoose={assistantEntry.onChoose}
                onDetect={() => assistantEntry.onIdentity(null)}
              />
            </div>
          ) : (
            <Corner className="fixed top-4 left-4">
              <BackControl />
            </Corner>
          )}
          {!preparing ? modeControl("stage") : null}
          <Corner className="fixed top-4 right-4">
            <FaceFollowControl on={faceFollow} status={face.status} onToggle={toggleFaceFollow} />
            <LanguageCaptionControls captions={captions} onCaptions={setCaptions} />
          </Corner>
          {!preparing ? (
            <>
              {/* the scripted demo is a check-up: it is offered once the check-up runs */}
              {!state.assistant ? (
                <Corner className="fixed bottom-16 left-4 sm:bottom-9">
                  <DemoControl
                    running={demo.running}
                    disabled={!ready || state.busy}
                    onRun={() => void demo.run()}
                    onStop={demo.stop}
                  />
                </Corner>
              ) : null}
              <Corner className="fixed right-4 bottom-16 items-end sm:bottom-9">
                <KeyboardControl
                  open={keyboardOpen}
                  onOpenChange={setKeyboardOpen}
                  onSend={handleSendText}
                  disabled={!ready || state.busy || demo.running}
                />
              </Corner>
            </>
          ) : null}

          <p
            data-slot="prototype-ribbon"
            className="fixed inset-x-0 bottom-0 z-10 px-4 py-1.5 text-center text-[11px] leading-tight text-[var(--aegis-label)]"
          >
            {t("shell.ribbon.text")}
          </p>
        </div>
        {emergencyUi("conversation")}
      </LayoutGroup>
    </MotionConfig>
  );
}
