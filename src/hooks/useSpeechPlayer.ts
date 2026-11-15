"use client";

/**
 * useSpeechPlayer: Cosmo's voice.
 *
 *  1. Plays the turn's audio URL (same origin) through an <audio> element wired to
 *     useAudioAmplitude, so the mouth follows the real signal.
 *  0. If the browser's autoplay policy refuses to play (no user gesture yet) nothing is voiced and
 *     `blocked` turns true: the screen shows one "Tap to start" and speaks again from that tap.
 *  2. If the request fails (404 / 5xx / unsupported) it falls back to
 *     window.speechSynthesis with a voice picked by language. speechSynthesis has no AnalyserNode,
 *     so the mouth is driven by useSimulatedAmplitude.
 *  3. If no voice exists for the language (typical for Mongolian) the audio is skipped altogether:
 *     the text is already on screen and the mouth is animated for the estimated duration.
 *
 * `speak(turn)` resolves when the speech has finished or was stopped. The hook is half-duplex
 * friendly: `status` is "loading" from the call until the first sound, then "playing".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { estimateSpeechMs, pickVoice, speechLangTag } from "@/components/checkin/speech";
import { turnAudioUrl } from "@/components/checkin/api";
import type { SpeechStatus } from "@/components/checkin/state";
import { useAudioAmplitude } from "@/hooks/useAudioAmplitude";
import { useSimulatedAmplitude } from "@/hooks/useSimulatedAmplitude";
import type { Lang } from "@/lib/types";

export interface SpeakTurn {
  /** needed (with turnId) to reach the server audio; without them only local speech is used */
  checkInId?: string | null;
  turnId?: string | null;
  /** one line of the turn (a beat of the step-by-step walkthrough); `text` is then that line */
  part?: number;
  text: string;
  language: Lang;
}

/** How the last turn was voiced: server audio, the browser voice, or text only (mouth animation). */
export type SpeechMode = "audio" | "browser" | "silent";

export interface UseSpeechPlayerOptions {
  /** fired whenever loading / playing / idle changes (inside event handlers, never during render) */
  onStatusChange?: (status: SpeechStatus) => void;
  /** consecutive server-audio failures before the audio route is skipped (default 2) */
  maxAudioFailures?: number;
}

export interface SpeechPlayer {
  speak: (turn: SpeakTurn) => Promise<void>;
  stop: () => void;
  /** true while sound or the silent mouth animation is running */
  speaking: boolean;
  status: SpeechStatus;
  /** 0..1 */
  amplitude: number;
  /** how the most recent turn was voiced, null before the first one */
  mode: SpeechMode | null;
  /** a fallback happened: the UI shows a small non-blocking banner */
  fallback: "browser" | "silent" | null;
  /**
   * The last speak() was refused by the browser's autoplay policy (no user gesture yet). Nothing was
   * voiced; the UI offers one "Tap to start" and calls speak() again from that tap.
   */
  blocked: boolean;
  clearBlocked: () => void;
}

/** "blocked": the browser refused to play without a user gesture (autoplay policy) */
type Outcome = "ended" | "failed" | "stopped" | "blocked";

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

/* The <audio> element is mutated by plain helpers outside the component (it is shared, imperative DOM). */
interface AudioHandlers {
  onPlaying: () => void;
  onEnded: () => void;
  onError: () => void;
}

function clearAudioHandlers(el: HTMLAudioElement): void {
  el.onended = null;
  el.onerror = null;
  el.onplaying = null;
}

function resetAudio(el: HTMLAudioElement): void {
  clearAudioHandlers(el);
  el.pause();
  el.removeAttribute("src");
  el.load();
}

function startAudio(el: HTMLAudioElement, url: string, handlers: AudioHandlers): Promise<void> {
  el.onplaying = handlers.onPlaying;
  el.onended = handlers.onEnded;
  el.onerror = handlers.onError;
  el.src = url;
  return el.play();
}

/** Voices load asynchronously in Chromium: wait briefly for `voiceschanged` when the list is empty. */
async function loadVoices(s: SpeechSynthesis, waitMs = 600): Promise<SpeechSynthesisVoice[]> {
  const now = s.getVoices();
  if (now.length > 0) return now;
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      s.removeEventListener("voiceschanged", done);
      resolve(s.getVoices());
    };
    const timer = setTimeout(done, waitMs);
    s.addEventListener("voiceschanged", done);
  });
}

export function useSpeechPlayer(options: UseSpeechPlayerOptions = {}): SpeechPlayer {
  const { onStatusChange, maxAudioFailures = 2 } = options;

  // The element is created once on the client; on the server `Audio` does not exist.
  const [audio] = useState<HTMLAudioElement | null>(() =>
    typeof Audio === "undefined" ? null : new Audio(),
  );
  const [status, setStatusState] = useState<SpeechStatus>("idle");
  const [mode, setMode] = useState<SpeechMode | null>(null);
  const [fallback, setFallback] = useState<"browser" | "silent" | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [simulating, setSimulating] = useState(false);
  /** which signal drives the mouth for the turn being voiced right now */
  const [source, setSource] = useState<"audio" | "local">("audio");

  const audioAmplitude = useAudioAmplitude(audio);
  const simulatedAmplitude = useSimulatedAmplitude(simulating);

  const statusCallback = useRef(onStatusChange);
  useEffect(() => {
    statusCallback.current = onStatusChange;
  }, [onStatusChange]);

  const audioFailures = useRef(0);
  /** incremented by every speak() and by stop(); a run that sees a newer value gives up */
  const runId = useRef(0);
  /** resolves the in-flight speak() promise early when something stops it */
  const cancelCurrent = useRef<(() => void) | null>(null);

  const setStatus = useCallback((next: SpeechStatus) => {
    setStatusState(next);
    statusCallback.current?.(next);
  }, []);

  const teardown = useCallback(() => {
    if (audio) resetAudio(audio);
    synth()?.cancel();
    setSimulating(false);
  }, [audio]);

  const stop = useCallback(() => {
    runId.current += 1;
    const cancel = cancelCurrent.current;
    cancelCurrent.current = null;
    teardown();
    setStatus("idle");
    cancel?.();
  }, [teardown, setStatus]);

  /** Plays the server clip. "failed" means: use the fallback. */
  const playServerAudio = useCallback(
    (url: string, mine: number): Promise<Outcome> => {
      const el = audio;
      if (!el) return Promise.resolve("failed");
      return new Promise<Outcome>((resolve) => {
        let settled = false;
        const finish = (outcome: Outcome) => {
          if (settled) return;
          settled = true;
          cancelCurrent.current = null;
          clearAudioHandlers(el);
          resolve(outcome);
        };
        cancelCurrent.current = () => finish("stopped");
        startAudio(el, url, {
          onPlaying: () => {
            if (runId.current === mine) setStatus("playing");
          },
          onEnded: () => finish("ended"),
          onError: () => finish("failed"),
        }).catch((error: unknown) => {
          // NotAllowedError = autoplay blocked; NotSupportedError = the route answered 404/5xx
          if (error instanceof DOMException && error.name === "AbortError") return; // superseded
          if (error instanceof DOMException && error.name === "NotAllowedError") {
            finish("blocked");
            return;
          }
          finish("failed");
        });
      });
    },
    [audio, setStatus],
  );

  /** Browser voice, or the silent mouth animation when no voice exists. */
  const playLocal = useCallback(
    async (turn: SpeakTurn, mine: number): Promise<{ outcome: Outcome; mode: SpeechMode }> => {
      const s = synth();
      const voices = s ? await loadVoices(s) : [];
      if (runId.current !== mine) return { outcome: "stopped", mode: "silent" };
      const voice = pickVoice(voices, turn.language);
      const expected = estimateSpeechMs(turn.text, turn.language);

      return new Promise((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (outcome: Outcome, usedMode: SpeechMode) => {
          if (settled) return;
          settled = true;
          cancelCurrent.current = null;
          if (timer) clearTimeout(timer);
          resolve({ outcome, mode: usedMode });
        };
        const localMode: SpeechMode = s && voice ? "browser" : "silent";
        cancelCurrent.current = () => finish("stopped", localMode);
        setSimulating(true);
        setStatus("playing");

        if (!s || !voice) {
          // no voice: the text is on screen, the mouth moves for the estimated duration
          timer = setTimeout(() => finish("ended", "silent"), expected);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(turn.text);
        utterance.voice = voice;
        utterance.lang = voice.lang || speechLangTag(turn.language);
        utterance.onend = () => finish("ended", "browser");
        utterance.onerror = (e) => {
          // "canceled" / "interrupted" are our own stop(); anything else leaves the text on screen
          if (e.error === "canceled" || e.error === "interrupted") finish("stopped", "browser");
          else if (e.error === "not-allowed") finish("blocked", "browser"); // autoplay policy, not a missing voice
          else finish("ended", "silent"); // engine refused (for example not-allowed): the text stays on screen
        };
        // safety net: some engines never fire `end`
        timer = setTimeout(() => finish("ended", "browser"), expected * 2 + 4000);
        s.cancel();
        s.speak(utterance);
      });
    },
    [setStatus],
  );

  const speak = useCallback(
    async (turn: SpeakTurn): Promise<void> => {
      if (turn.text.trim() === "") return;
      runId.current += 1;
      const mine = runId.current;
      const previous = cancelCurrent.current;
      cancelCurrent.current = null;
      teardown();
      previous?.();
      setStatus("loading");
      setSource("audio");

      const canTryServer =
        audio !== null &&
        !!turn.checkInId &&
        !!turn.turnId &&
        audioFailures.current < maxAudioFailures;

      if (canTryServer) {
        const outcome = await playServerAudio(turnAudioUrl(turn.checkInId as string, turn.turnId as string, turn.part), mine);
        if (runId.current !== mine) return; // stopped or superseded: whoever did that owns the status
        if (outcome === "ended") {
          audioFailures.current = 0;
          setMode("audio");
          setFallback(null);
          teardown();
          setStatus("idle");
          return;
        }
        if (outcome === "stopped") return;
        if (outcome === "blocked") {
          // the speech route works, the browser just wants a gesture first: not a failure, no fallback
          teardown();
          setBlocked(true);
          setStatus("idle");
          return;
        }
        audioFailures.current += 1;
        teardown();
      }
      setSource("local");

      const { outcome, mode: usedMode } = await playLocal(turn, mine);
      if (runId.current !== mine) return;
      if (outcome === "blocked") {
        setSimulating(false);
        setBlocked(true);
        setStatus("idle");
        return;
      }
      setMode(usedMode);
      setFallback(usedMode === "browser" ? "browser" : "silent");
      setSimulating(false);
      if (outcome !== "stopped") setStatus("idle");
    },
    [audio, maxAudioFailures, playLocal, playServerAudio, setStatus, teardown],
  );

  // stop everything when the screen goes away
  useEffect(() => {
    return () => {
      runId.current += 1;
      cancelCurrent.current = null;
      if (audio) resetAudio(audio);
      synth()?.cancel();
    };
  }, [audio]);

  const clearBlocked = useCallback(() => setBlocked(false), []);

  return {
    speak,
    stop,
    blocked,
    clearBlocked,
    speaking: status === "playing",
    status,
    amplitude: source === "audio" ? audioAmplitude : simulatedAmplitude,
    mode,
    fallback,
  };
}
