"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakOnChannel, type VoiceHandle } from "@/components/voice/channel";
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
  /** the line this view started; stopping it never silences a voice someone else started later */
  const line = useRef<VoiceHandle | null>(null);

  const stop = useCallback(() => {
    line.current?.stop();
    line.current = null;
  }, []);

  // one voice at a time (src/components/voice/channel.ts): a step silences Cosmo, the SOS line and the previous step,
  // and a stopped step never falls back to the browser voice afterwards
  const speak = useCallback(
    (scenario: Pick<EmergencyScenario, "id" | "steps">, index: number) => {
      const text = scenario.steps[index]?.text[lang];
      if (!text) return;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      line.current?.stop();
      line.current = speakOnChannel(text, lang, offline ? null : `/api/emergency/${scenario.id}/steps/${index}/audio?lang=${lang}`);
    },
    [lang],
  );

  useEffect(() => stop, [stop]);
  return { speak, stop };
}
