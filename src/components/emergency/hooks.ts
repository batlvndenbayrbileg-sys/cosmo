"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUILTIN_GUIDES, type EmergencyScenario } from "@/lib/emergency";
import type { Lang } from "@/lib/types";

/**
 * The emergency library on the client. Starts with the built-in guides (bundled, so a guide shows with no network),
 * then takes the server's list, which adds or replaces the team's own content. A failed request keeps the built-ins.
 */
export function useEmergencyLibrary(): EmergencyScenario[] {
  const [lib, setLib] = useState<EmergencyScenario[]>(() => [...BUILTIN_GUIDES]);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/emergency", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { scenarios?: EmergencyScenario[] } | null) => {
        if (!cancelled && body?.scenarios?.length) setLib(body.scenarios);
      })
      .catch(() => {
        // offline or signed out: the built-in guides stay
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return lib;
}

/**
 * Cosmo reads one step aloud through /api/emergency/:id/steps/:n/audio (the server voice); when that fails (offline,
 * scripted mode) the browser voice reads it, and when there is none the text simply stays on screen.
 */
export function useStepSpeech(lang: Lang) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* no speech synthesis */
    }
  }, []);

  const speak = useCallback(
    (scenario: EmergencyScenario, index: number) => {
      const text = scenario.steps[index]?.text[lang];
      if (!text) return;
      stop();
      const browserVoice = () => {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang === "mn" ? "mn-MN" : "en-US";
          window.speechSynthesis?.speak(u);
        } catch {
          /* text stays on screen */
        }
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        browserVoice();
        return;
      }
      const audio = new Audio(`/api/emergency/${scenario.id}/steps/${index}/audio?lang=${lang}`);
      audioRef.current = audio;
      audio.play().catch(browserVoice);
    },
    [lang, stop],
  );

  useEffect(() => stop, [stop]);
  return { speak, stop };
}
