"use client";

/**
 * The first moment on the "/" screen, before anyone is known: Cosmo greets in both languages and listens. The first
 * utterance tells who is speaking (src/lib/identity.ts): its language (speech-to-text, or the script of typed text) and
 * the on-device voice guess (voice.ts; the pitch itself never leaves the browser), or a name said outright. When that
 * is not enough Cosmo asks and the person can say or tap their name. Then Cosmo takes on that person's look with a short
 * animation and the assistant conversation opens (AssistantHome).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Users } from "lucide-react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { computeStageLayout } from "@/components/checkin/bubbles";
import { FloorRing, type RingMode } from "@/components/checkin/FloorRing";
import { Corner, GLASS, KeyboardControl } from "@/components/checkin/StageControls";
import { ApiClientError, postIdentify, postSession, type IdentifyResult } from "@/components/checkin/api";
import { useRecorder } from "@/hooks/useRecorder";
import { useI18n } from "@/i18n/I18nProvider";
import { dictionaries } from "@/i18n/dictionary";
import { displayName } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { CrewPublic, Lang } from "@/lib/types";
import type { VoiceClass } from "@/lib/voice/pitch";
import { measureVoice, readRememberedVoice, rememberVoice } from "./voice";
import { useViewport } from "./useViewport";

/** a recording smaller than this is a click or noise (as on the check-in stage) */
const MIN_AUDIO_BYTES = 1200;
/** how long the "Hi Saraa!" moment shows before the conversation opens */
const WELCOME_MS = 1100;

/** Cosmo's neutral first words, in both languages (code text: nobody is known yet, so no language is chosen) */
const GREETING: ReadonlyArray<{ lang: Lang; text: string }> = [
  { lang: "mn", text: "Сайн байна уу, би Cosmo." },
  { lang: "en", text: "Hi, I'm Cosmo." },
];

export interface Resolved {
  crew: CrewPublic;
  /** what to answer first (the person's first words), or null when they only said who they are */
  firstText: string | null;
  language: Lang;
}

type Phase = "idle" | "identifying" | "ask" | "welcome";

export function IdentifyStage({ onResolved }: { onResolved: (r: Resolved) => void }) {
  const { t, lang: uiLang, setLang } = useI18n();
  const viewport = useViewport();
  const layout = computeStageLayout(viewport.width, viewport.height, 0);
  const { mascot } = layout;

  const [phase, setPhase] = useState<Phase>("idle");
  const [ask, setAsk] = useState<{ language: Lang; candidates: CrewPublic[] } | null>(null);
  const [welcome, setWelcome] = useState<{ crew: CrewPublic; language: Lang } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [micOff, setMicOff] = useState(false);
  /** the first words, kept while Cosmo asks who is speaking (they are answered after) */
  const pendingText = useRef<string | null>(null);
  const lastVoice = useRef<VoiceClass>("unknown");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const finish = useCallback(
    (crew: CrewPublic, language: Lang, firstText: string | null) => {
      const remembered = readRememberedVoice();
      const voice = lastVoice.current !== "unknown" ? lastVoice.current : remembered?.crewId === crew.id ? remembered.voice : "unknown";
      rememberVoice({ crewId: crew.id, voice });
      setWelcome({ crew, language });
      setPhase("welcome");
      setTimeout(() => {
        if (alive.current) onResolved({ crew, firstText, language });
      }, WELCOME_MS);
    },
    [onResolved],
  );

  const handle = useCallback(
    (r: IdentifyResult, asked: boolean) => {
      if (r.crew) {
        // a name given in answer to "who am I talking to?" is not a question to answer: the first words are
        const first = asked || r.reason === "claim" ? pendingText.current : r.transcript;
        finish(r.crew, r.language, first);
        return;
      }
      pendingText.current ??= r.transcript;
      // the whole screen follows the language just heard (the hint, the typing field), not only the question
      setLang(r.language);
      setAsk({ language: r.language, candidates: r.candidates });
      setPhase("ask");
    },
    [finish, setLang],
  );

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiClientError && err.code === "STT_FAILED" && err.status === 422) {
      setPhase((p) => (p === "identifying" ? (ask ? "ask" : "idle") : p));
      return;
    }
    setError(err instanceof ApiClientError && err.code === "STT_FAILED" ? t("checkin.assistant.error.stt") : t("checkin.assistant.error.generic"));
    if (err instanceof ApiClientError && err.code === "STT_FAILED" && err.status === 502) setKeyboardOpen(true);
    setPhase(ask ? "ask" : "idle");
  }, [ask, t]);

  const recorder = useRecorder({
    onUtterance: (blob) => {
      if (blob.size < MIN_AUDIO_BYTES) return;
      const asked = phase === "ask";
      setPhase("identifying");
      setError(null);
      void (async () => {
        const voice = await measureVoice(blob);
        lastVoice.current = voice;
        const previous = readRememberedVoice()?.crewId ?? null;
        try {
          const r = await postIdentify({ audio: blob, voice, previous, asked });
          if (alive.current) handle(r, asked);
        } catch (err) {
          if (alive.current) fail(err);
        }
      })();
    },
    onError: () => {
      setMicOff(true);
      setKeyboardOpen(true);
    },
    onNoSpeech: () => {},
  });
  const { start: startRecorder, stop: stopRecorder, recording } = recorder;

  // hands-free: listen whenever Cosmo is waiting for words
  const canListen = (phase === "idle" || phase === "ask") && !micOff && !keyboardOpen && recorder.supported && recorder.permission !== "denied";
  useEffect(() => {
    if (!canListen || recording) return;
    const timer = setTimeout(() => void startRecorder({ vad: true }), 400);
    return () => clearTimeout(timer);
  }, [canListen, recording, startRecorder]);

  const sendText = (text: string) => {
    const asked = phase === "ask";
    recorder.cancel();
    setPhase("identifying");
    setError(null);
    lastVoice.current = "unknown";
    const previous = readRememberedVoice()?.crewId ?? null;
    postIdentify({ text, voice: "unknown", previous, asked }).then(
      (r) => {
        if (alive.current) handle(r, asked);
      },
      (err) => {
        if (alive.current) fail(err);
      },
    );
  };

  const choose = async (crew: CrewPublic) => {
    recorder.cancel();
    setPhase("identifying");
    try {
      await postSession(crew.id);
    } catch (err) {
      fail(err);
      return;
    }
    finish(crew, ask?.language ?? crew.preferredLanguage, pendingText.current);
  };

  const tapMascot = () => {
    if (micOff || !recorder.supported) {
      setKeyboardOpen(true);
      return;
    }
    if (recording) stopRecorder();
    else if (phase === "idle" || phase === "ask") {
      setKeyboardOpen(false);
      void startRecorder({ vad: true });
    }
  };

  const ringMode: RingMode = phase === "identifying" ? "thinking" : recording ? "listening" : "idle";
  const cosmoState = phase === "identifying" ? "thinking" : recording ? "listening" : "idle";
  const askLang = ask?.language ?? uiLang;
  const status =
    phase === "identifying"
      ? t("checkin.assistant.identifying")
      : recording
        ? t("checkin.assistant.listening")
        : t("checkin.assistant.hint");

  const wide = layout.mode === "wide";
  const align = wide ? "text-left" : "text-center";
  const statusLines = (
    <>
      {!welcome ? (
        <p role="status" className="text-center text-[14.5px] text-[var(--aegis-label)]">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={cn(GLASS, "rounded-full px-4 py-2 text-center text-[14px] text-[var(--aegis-ink)]")}>
          {error}
        </p>
      ) : null}
    </>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div data-slot="assistant-identify" data-phase={phase} className="aegis-bg fixed inset-0 z-50 overflow-x-hidden overflow-y-auto">
        <h1 className="sr-only">{t("checkin.assistant.stage.label")}</h1>
        <div className="relative w-full" style={{ height: layout.height }}>
          <FloorRing {...layout.floor} mode={ringMode} amplitude={0} level={recording ? recorder.level : null} />

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
              onClick={tapMascot}
              aria-label={t("checkin.assistant.hint")}
              disabled={phase === "welcome" || phase === "identifying"}
              className="size-full cursor-pointer rounded-[38%] outline-none focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/30 disabled:cursor-default"
            >
              {/* the person's own look arrives with a short turn-and-pop */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={welcome?.crew.mascotVariant ?? "neutral"}
                  className="size-full"
                  initial={{ opacity: 0, scale: 0.82, rotate: -10 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 1.08 }}
                  transition={{ type: "spring", stiffness: 220, damping: 16 }}
                >
                  <CosmoAvatar
                    variant={welcome?.crew.mascotVariant ?? 0}
                    state={cosmoState}
                    emotion={welcome ? "happy" : "neutral"}
                    amplitude={0}
                    label={t("checkin.assistant.stage.label")}
                  />
                </motion.div>
              </AnimatePresence>
            </button>
          </motion.div>

          {/* what Cosmo says: the neutral greeting in both languages, the question, or the person's name. Wide screens:
              a glass speech bubble beside her head; phones: under her */}
          <div
            className={cn(
              "absolute flex flex-col gap-3",
              wide ? cn(GLASS, "items-start rounded-[28px] rounded-tl-md px-6 py-5") : "inset-x-0 items-center px-4",
            )}
            style={
              wide
                ? { left: mascot.x + mascot.size * 0.8, top: mascot.y + mascot.size * 0.1, maxWidth: Math.max(260, layout.width - (mascot.x + mascot.size * 0.8) - 32) }
                : { top: layout.captionY - 8 }
            }
          >
            <AnimatePresence mode="wait">
              {welcome ? (
                <motion.p
                  key="welcome"
                  role="status"
                  className={cn(align, "text-[26px] font-light text-[var(--aegis-ink)]")}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {dictionaries[welcome.language]["checkin.assistant.welcome"].replace("{name}", displayName(welcome.crew, welcome.language))}
                </motion.p>
              ) : phase === "ask" && ask ? (
                <motion.div key="ask" className={cn("flex flex-col gap-3", wide ? "items-start" : "items-center")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <p className={cn(align, "text-[22px] font-light text-[var(--aegis-ink)]")} lang={askLang}>
                    {dictionaries[askLang]["checkin.assistant.ask"]}
                  </p>
                  <div className={cn("flex flex-wrap gap-2", wide ? "justify-start" : "justify-center")} data-slot="identify-candidates">
                    {ask.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void choose(c)}
                        className={cn(GLASS, "h-11 rounded-full px-5 text-[16px] font-medium text-[var(--aegis-ink)] outline-none focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/40")}
                      >
                        {displayName(c, askLang)}
                      </button>
                    ))}
                    <Link
                      href="/crew"
                      className="inline-flex h-11 items-center rounded-full px-4 text-[15px] text-[var(--aegis-label)] underline-offset-4 outline-none hover:underline focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/40"
                    >
                      {dictionaries[askLang]["checkin.assistant.ask.other"]}
                    </Link>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="greeting" className={cn("flex flex-col gap-1", wide ? "items-start" : "items-center")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {GREETING.map((g) => (
                    <p key={g.lang} lang={g.lang} className={cn(align, "text-[24px] leading-tight font-light text-[var(--aegis-ink)] sm:text-[28px]")}>
                      {g.text}
                    </p>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {!wide ? statusLines : null}
          </div>
          {wide ? (
            <div className="absolute inset-x-0 flex flex-col items-center gap-3 px-4" style={{ top: layout.captionY }}>
              {statusLines}
            </div>
          ) : null}
        </div>

        <Corner className="fixed top-4 right-4">
          <Link
            href="/crew"
            aria-label={t("checkin.assistant.person.list")}
            title={t("checkin.assistant.person.list")}
            data-slot="identify-crew-list"
            className={cn(GLASS, "inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium text-[var(--aegis-ink)] opacity-60 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-[var(--aegis-accent)]/45")}
          >
            <Users className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("checkin.assistant.person.list")}</span>
          </Link>
        </Corner>
        <Corner className="fixed right-4 bottom-16 items-end sm:bottom-9">
          <KeyboardControl open={keyboardOpen} onOpenChange={setKeyboardOpen} onSend={sendText} disabled={phase === "identifying" || phase === "welcome"} />
        </Corner>
        <p className="fixed inset-x-0 bottom-0 z-10 px-4 py-1.5 text-center text-[11px] leading-tight text-[var(--aegis-label)]">
          {t("shell.ribbon.text")}
        </p>
      </div>
    </MotionConfig>
  );
}
