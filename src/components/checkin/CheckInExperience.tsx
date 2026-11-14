"use client";

/**
 * CheckInExperience: the whole /checkin screen as one client component with two views.
 *
 *  - view "conversation": Cosmo full-screen, live transcript, captured cards, mic + text + demo.
 *  - view "dashboard":    <DashboardView> from the dashboard lane, with the SAME shared Cosmo element
 *                         passed as `dockSlot`, so Cosmo glides from the stage into the dock.
 *
 * Flow: createCheckIn -> greeting spoken -> voice or text turns (SSE) -> `summary` event ->
 * GET /api/dashboard -> switch view -> Cosmo speaks the summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { LayoutGroup, MotionConfig } from "framer-motion";
import { CosmoStage, SharedCosmo } from "./CosmoStage";
import { ClarificationBubble } from "./ClarificationBubble";
import { ConversationView } from "./ConversationView";
import { KpiCardRail } from "./KpiCardRail";
import { MicButton, type MicState } from "./MicButton";
import { RunDemoButton } from "./RunDemoButton";
import { TextFallbackInput } from "./TextFallbackInput";
import { TranscriptPanel } from "./TranscriptPanel";
import { ApiClientError, fetchDashboard, fetchHealth } from "./api";
import type { CheckInError } from "./state";
import { useDemoRunner } from "./useDemoRunner";
import { DashboardView } from "@/components/dashboard";
import { parseStoredCrew, readSelectedCrewRaw } from "@/components/crew/selectedCrew";
import { FallbackBanner } from "@/components/shell/FallbackBanner";
import { useShellHeader } from "@/components/shell/ShellHeaderContext";
import { Button } from "@/components/ui/button";
import { useCheckIn } from "@/hooks/useCheckIn";
import { useRecorder } from "@/hooks/useRecorder";
import { useSpeechPlayer, type SpeechPlayer } from "@/hooks/useSpeechPlayer";
import { useI18n } from "@/i18n/I18nProvider";
import type { DashboardPayload, HealthResponse, SummaryPayload } from "@/lib/types";

/** Let the layout glide start before Cosmo starts reading the summary. */
const SUMMARY_SPEECH_DELAY_MS = 600;
/** After Cosmo stops talking, wait this long before the microphone opens again (no self-echo). */
const RELISTEN_DELAY_MS = 450;
/** A recording smaller than this is a click or noise, not speech: it is not sent. */
const MIN_AUDIO_BYTES = 1200;

const subscribeNever = () => () => {};

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

interface BannerItem {
  id: string;
  text: string;
  onDismiss?: () => void;
}

export function CheckInExperience() {
  const router = useRouter();
  const { lang, t } = useI18n();

  const rawCrew = useSyncExternalStore(subscribeNever, readSelectedCrewRaw, () => null);
  const crew = useMemo(() => parseStoredCrew(rawCrew), [rawCrew]);

  const [initialLang] = useState(lang);
  const [view, setView] = useState<"conversation" | "dashboard">("conversation");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashboardStatus, setDashboardStatus] = useState<"idle" | "loading" | "error">("idle");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [conversationMode, setConversationMode] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [voiceIssue, setVoiceIssue] = useState<"denied" | "unsupported" | "failed" | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
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
  const cancelRecordingRef = useRef<(() => void) | null>(null);

  /* ───────────── dashboard hand-over ───────────── */

  const openDashboard = useCallback(
    async (checkInId: string, summary: SummaryPayload | null) => {
      setDashboardStatus("loading");
      try {
        const payload = await fetchDashboard(checkInId);
        if (!alive.current) return;
        setDashboard(payload);
        setView("dashboard");
        setDashboardStatus("idle");
      } catch (error) {
        if (!alive.current) return;
        if (error instanceof ApiClientError && error.code === "NO_SESSION") router.replace("/");
        setDashboardStatus("error");
      }
      if (summary && alive.current) {
        await new Promise((resolve) => setTimeout(resolve, SUMMARY_SPEECH_DELAY_MS));
        if (!alive.current) return;
        void speakRef.current?.({
          checkInId,
          turnId: summary.audioTurnId,
          text: summary.spoken.text,
          language: summary.spoken.language,
        });
      }
    },
    [router],
  );

  /* ───────────── check-in, speech, microphone ───────────── */

  const checkIn = useCheckIn({
    language: initialLang,
    onAssistant: (turn) => {
      void speakRef.current?.({
        checkInId: turn.checkInId,
        turnId: turn.turnId,
        text: turn.text,
        language: turn.language,
      });
    },
    onSummary: (summary, checkInId) => {
      setConversationMode(false);
      cancelRecordingRef.current?.();
      void openDashboard(checkInId, summary);
    },
    onResumedFinished: (checkInId) => {
      void openDashboard(checkInId, null);
    },
    onNoSession: () => router.replace("/"),
  });
  const { state } = checkIn;
  const { setSpeech, setRecording, sendAudio, sendText, setTyping, createCheckIn } = checkIn;

  const player = useSpeechPlayer({ onStatusChange: setSpeech });
  const recorder = useRecorder({
    onUtterance: (blob) => {
      if (blob.size < MIN_AUDIO_BYTES) return;
      void sendAudio(blob);
    },
    onRecordingChange: (recording) => {
      setRecording(recording);
      if (!recording) setPushToTalk(false);
    },
    onError: (error) => {
      setVoiceIssue(error.kind === "denied" ? "denied" : error.kind === "unsupported" ? "unsupported" : "failed");
      setConversationMode(false);
    },
    onNoSpeech: () => setConversationMode(false),
  });

  const { speak, stop: stopSpeech } = player;
  const { start: startRecorder, stop: stopRecorder, cancel: cancelRecorder } = recorder;

  useEffect(() => {
    speakRef.current = speak;
    cancelRecordingRef.current = cancelRecorder;
  }, [speak, cancelRecorder]);

  // start the check-in and look at /api/health once
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

  useShellHeader({ crewName: crew?.name, missionDay: dashboard?.missionDay });

  /* ───────────── derived facts ───────────── */

  const ready = state.status === "ready";
  const sttDown = health?.mode === "live" && health.stt.available === false;
  const micBlocked = recorder.permission === "denied" || voiceIssue === "denied";
  const micUsable =
    recorder.supported && recorder.permission !== "unsupported" && !micBlocked && voiceIssue === null && !sttDown;
  const scripted = health?.mode === "scripted";

  const micState: MicState = !micUsable
    ? "unavailable"
    : state.cosmoState === "talking"
      ? "speaking"
      : state.cosmoState === "thinking"
        ? "thinking"
        : recorder.recording
          ? "listening"
          : "idle";

  /* ───────────── demo ───────────── */

  const live = useRef({ idle: false, finished: false });
  useEffect(() => {
    live.current = {
      idle: ready && !state.busy && state.speech === "idle",
      finished: view === "dashboard" || state.conversation === "DONE" || state.summary !== null,
    };
  }, [ready, state.busy, state.speech, view, state.conversation, state.summary]);

  const demo = useDemoRunner({
    language: state.language ?? lang,
    sendText,
    setTyping,
    readLive: () => live.current,
    onStart: () => {
      setConversationMode(false);
      cancelRecorder();
      stopSpeech();
    },
  });

  /* ───────────── microphone gestures ───────────── */

  const startListening = useCallback(
    (vad: boolean) => {
      if (!ready || state.busy || demo.running) return;
      stopSpeech();
      setPushToTalk(!vad);
      void startRecorder({ vad });
    },
    [ready, state.busy, demo.running, stopSpeech, startRecorder],
  );

  const handleMicToggle = () => {
    if (micState === "listening") {
      stopRecorder();
      return;
    }
    if (micState === "speaking" || micState === "idle") {
      setConversationMode(true);
      startListening(true);
    }
  };
  const handleHoldStart = () => {
    if (micState === "speaking" || micState === "idle") startListening(false);
  };
  const handleHoldEnd = () => stopRecorder();

  // hands-free: after Cosmo has finished, listen again (half-duplex: never while she speaks)
  useEffect(() => {
    if (
      !conversationMode ||
      !micUsable ||
      !ready ||
      view !== "conversation" ||
      state.conversation === "DONE" ||
      state.busy ||
      state.speech !== "idle" ||
      recorder.recording ||
      demo.running
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void startRecorder({ vad: true });
    }, RELISTEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    conversationMode,
    micUsable,
    ready,
    view,
    state.conversation,
    state.busy,
    state.speech,
    recorder.recording,
    startRecorder,
    demo.running,
  ]);

  const handleSendText = useCallback(
    async (text: string) => {
      cancelRecorder();
      stopSpeech();
      return sendText(text);
    },
    [cancelRecorder, stopSpeech, sendText],
  );

  /* ───────────── banners ───────────── */

  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));
  const banners: BannerItem[] = [];
  if (scripted) {
    banners.push({ id: "scripted", text: t("shell.banner.scripted"), onDismiss: () => dismiss("scripted") });
  }
  if (micBlocked) {
    banners.push({ id: "mic", text: t("shell.banner.micBlocked") });
  } else if (!micUsable && ready) {
    banners.push({ id: "voice", text: t("shell.banner.voiceUnavailable") });
  }
  if (player.fallback === "browser") {
    banners.push({ id: "browserVoice", text: t("checkin.banner.browserVoice"), onDismiss: () => dismiss("browserVoice") });
  } else if (player.fallback === "silent") {
    banners.push({ id: "speech", text: t("shell.banner.speechUnavailable"), onDismiss: () => dismiss("speech") });
  }
  if (state.error && state.status !== "failed") {
    banners.push({ id: "error", text: errorText(t, state.error), onDismiss: checkIn.dismissError });
  }
  if (demo.failed) {
    banners.push({ id: "demo", text: t("checkin.demo.failed"), onDismiss: () => dismiss("demo") });
  }
  const visibleBanners = banners.filter((b) => b.id === "error" || !dismissed.has(b.id));

  /* ───────────── render ───────────── */

  const variant = crew?.mascotVariant ?? dashboard?.crew.mascotVariant ?? 0;
  const statusKey =
    state.cosmoState === "talking" ? "speaking" : state.cosmoState;

  const cosmo = (
    <SharedCosmo
      variant={variant}
      state={state.cosmoState}
      emotion={state.emotion}
      amplitude={player.amplitude}
      label={t("checkin.stage.label")}
    />
  );

  if (view === "dashboard" && dashboard) {
    return (
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <DashboardView payload={dashboard} viewer="crew" dockSlot={cosmo} />
        </LayoutGroup>
      </MotionConfig>
    );
  }

  const startFailed = state.status === "failed" && state.error?.code !== "NO_SESSION";

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <h1 className="sr-only">{t("checkin.page.label")}</h1>
        <ConversationView
          label={t("checkin.page.label")}
          banners={
            <>
              {visibleBanners.map((b) => (
                <FallbackBanner key={b.id} message={b.text} onDismiss={b.onDismiss} />
              ))}
              {dashboardStatus === "error" && state.checkInId ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-status-alert/30 bg-status-alert-soft px-4 py-2.5 text-base text-status-alert-ink">
                  <span className="min-w-0 flex-1" role="status">
                    {t("checkin.error.dashboard")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg px-3 text-sm"
                    onClick={() => {
                      if (state.checkInId) void openDashboard(state.checkInId, null);
                    }}
                  >
                    {t("checkin.dashboard.retry")}
                  </Button>
                </div>
              ) : null}
              {dashboardStatus === "loading" ? (
                <p role="status" className="text-center text-base text-muted-foreground">
                  {t("checkin.dashboard.opening")}
                </p>
              ) : null}
            </>
          }
          stage={
            <CosmoStage
              caption={
                <p role="status" className="flex items-center gap-2 text-base font-medium text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={
                      state.cosmoState === "idle"
                        ? "size-2.5 rounded-full bg-status-nodata"
                        : "size-2.5 animate-pulse rounded-full bg-primary"
                    }
                  />
                  {t(`checkin.status.${statusKey}`)}
                </p>
              }
            >
              {cosmo}
            </CosmoStage>
          }
          transcript={
            state.status === "creating" || state.status === "idle" ? (
              <p role="status" className="m-auto text-base text-muted-foreground">
                {t("checkin.starting")}
              </p>
            ) : startFailed ? (
              <div className="m-auto flex flex-col items-center gap-3 text-center">
                <p role="alert" className="text-base text-status-alert-ink">
                  {t("checkin.start.failed")}
                </p>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => void createCheckIn()}>
                  {t("shell.action.retry")}
                </Button>
              </div>
            ) : (
              <TranscriptPanel
                lines={state.transcript}
                pending={state.pendingCrew}
                className="min-h-0 flex-1"
              />
            )
          }
          clarification={
            state.clarification ? (
              <ClarificationBubble clarification={state.clarification} onDismiss={checkIn.dismissClarification} />
            ) : null
          }
          controls={
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-5">
              <MicButton
                state={micState}
                pushToTalk={pushToTalk || !recorder.autoStop}
                level={recorder.level}
                onToggle={handleMicToggle}
                onHoldStart={handleHoldStart}
                onHoldEnd={handleHoldEnd}
                describedBy="checkin-mic-hint"
              />
              <div className="flex w-full min-w-0 flex-1 flex-col gap-2 pt-1">
                <TextFallbackInput onSend={handleSendText} disabled={!ready || state.busy || demo.running} />
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p id="checkin-mic-hint" className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {micUsable ? t("checkin.mic.hint") : t("checkin.mic.unavailable")}
                  </p>
                  <div className="flex flex-col items-end gap-1">
                    <RunDemoButton
                      running={demo.running}
                      emphasised={scripted === true}
                      disabled={!ready || state.busy}
                      onRun={() => void demo.run()}
                      onStop={demo.stop}
                    />
                    {scripted && !demo.running ? (
                      <p className="max-w-64 text-right text-sm text-muted-foreground">{t("checkin.demo.hint")}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          }
          rail={<KpiCardRail cards={state.cards} />}
        />
      </LayoutGroup>
    </MotionConfig>
  );
}
