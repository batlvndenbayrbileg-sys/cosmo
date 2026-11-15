"use client";

/**
 * useSummaryAudio: replay of the check-in summary.
 *
 * 1. Plays the stored summary turn (same-origin /api/checkins/<id>/turns/<turnId>/audio) through one lazily
 *    created <audio> element; its loudness drives Cosmo's mouth via useAudioAmplitude.
 * 2. If there is no audio turn, or playback fails, it speaks the text with window.speechSynthesis; that has no
 *    analyser, so useSimulatedAmplitude animates the mouth instead.
 * 3. If neither is available the hook reports `canPlay: false` and the dock says so.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAudioAmplitude } from "@/hooks/useAudioAmplitude";
import { useSimulatedAmplitude } from "@/hooks/useSimulatedAmplitude";
import type { Lang } from "@/lib/types";
import { claimVoice } from "@/components/voice/channel";
import { summaryAudioUrl } from "./logic";

export type SummaryAudioMode = "idle" | "audio" | "speech";

export interface SummaryAudioOptions {
  checkInId: string;
  audioTurnId: string | null;
  /** text spoken by the browser voice when the audio file cannot be played */
  text: string;
  language: Lang;
}

export interface SummaryAudio {
  mode: SummaryAudioMode;
  playing: boolean;
  /** 0..1 for Cosmo's mouth */
  amplitude: number;
  /** false when there is no audio turn and the browser has no speech synthesis, or playback failed everywhere */
  canPlay: boolean;
  play: () => void;
  stop: () => void;
}

const noopSubscribe = () => () => {};
const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

function useSpeechSupport(): boolean {
  // server and first client render agree on `false`; the real value arrives right after hydration
  return useSyncExternalStore(noopSubscribe, speechSupported, () => false);
}

const SPEECH_LANG: Record<Lang, string> = { en: "en-US", mn: "mn-MN" };

export function useSummaryAudio({
  checkInId,
  audioTurnId,
  text,
  language,
}: SummaryAudioOptions): SummaryAudio {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<SummaryAudioMode>("idle");
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSrcRef = useRef<string | null>(null);
  const speech = useSpeechSupport();

  // the latest text, read from event handlers
  const latest = useRef({ text, language });
  useEffect(() => {
    latest.current = { text, language };
  }, [text, language]);

  const audioLoudness = useAudioAmplitude(audio);
  const speechLoudness = useSimulatedAmplitude(mode === "speech");

  const cancelSpeech = useCallback(() => {
    if (speechSupported()) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(() => {
    if (!speechSupported() || latest.current.text.trim() === "") {
      setMode("idle");
      setFailed(true);
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(latest.current.text);
    utterance.lang = SPEECH_LANG[latest.current.language];
    utterance.onend = () => setMode("idle");
    utterance.onerror = () => setMode("idle");
    setMode("speech");
    synth.speak(utterance);
  }, []);

  /** the replay holds the one voice of the tab (src/components/voice/channel.ts) while it plays */
  const release = useRef<(() => void) | null>(null);
  const silence = useCallback(() => {
    release.current = null;
    audioRef.current?.pause();
    cancelSpeech();
    setMode("idle");
  }, [cancelSpeech]);

  const stop = useCallback(() => {
    release.current?.();
    silence();
  }, [silence]);

  const play = useCallback(() => {
    setFailed(false);
    release.current?.();
    // Cosmo, a guide step or the SOS line stop first; another voice starting later stops this replay
    release.current = claimVoice(silence);
    cancelSpeech();
    if (audioTurnId === null) {
      speak();
      return;
    }
    const src = summaryAudioUrl(checkInId, audioTurnId);
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.addEventListener("ended", () => setMode("idle"));
      audioRef.current = el;
      setAudio(el);
    }
    if (audioSrcRef.current !== src) {
      el.src = src;
      audioSrcRef.current = src;
    } else {
      el.currentTime = 0;
    }
    setMode("audio");
    el.play().catch((error: unknown) => {
      // stopped before it started (AbortError): never voice it afterwards
      if ((error as { name?: unknown } | null)?.name === "AbortError" || release.current === null) return;
      // missing file, blocked autoplay or unsupported source: fall back to the browser voice
      speak();
    });
  }, [audioTurnId, checkInId, cancelSpeech, silence, speak]);

  // leaving the page stops any sound
  useEffect(() => {
    return () => {
      release.current?.();
      release.current = null;
      audioRef.current?.pause();
      if (speechSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return {
    mode,
    playing: mode !== "idle",
    amplitude: Math.max(audioLoudness, speechLoudness),
    canPlay: !failed && (audioTurnId !== null || speech),
    play,
    stop,
  };
}
