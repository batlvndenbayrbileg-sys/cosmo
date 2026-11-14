"use client";

/**
 * useSimulatedAmplitude(active): a plausible speech-like loudness (about 0.15-0.9 while active,
 * smoothly decaying to 0 afterwards). For audio that cannot be analysed (speechSynthesis, which has
 * no AnalyserNode) and for the text-only fallback where Cosmo "speaks" without sound.
 */
import { useEffect, useRef, useState } from "react";
import { MOUTH_SMOOTHING, simulatedSpeechEnvelope, smoothAmplitude } from "@/components/cosmo/amplitude";

export function useSimulatedAmplitude(active: boolean): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    // nothing to animate: already silent and not asked to speak
    if (!active && current.current === 0) return;

    let raf = 0;
    let startedAt = 0;
    let last = 0;
    let published = current.current;

    const tick = (now: number) => {
      if (startedAt === 0) {
        startedAt = now;
        last = now;
      }
      const dt = Math.min(Math.max(now - last, 0), 100);
      last = now;
      const target = active ? simulatedSpeechEnvelope((now - startedAt) / 1000, Math.random()) : 0;
      let next = smoothAmplitude(current.current, target, dt, MOUTH_SMOOTHING);
      if (!active && next < 0.005) next = 0;
      current.current = next;
      // publish only visible changes so React does not re-render for sub-pixel differences
      if (Math.abs(next - published) >= 0.01 || (next === 0 && published !== 0)) {
        published = next;
        setValue(next);
      }
      if (active || next > 0) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return value;
}
