"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { CPR_RATE, beatIntervalMs, cyclePosition, formatElapsed } from "@/lib/emergency";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/**
 * CPR compression metronome: a visual pulse on every beat at 110 a minute (the sourced range is 100-120), an optional
 * click, the count inside the cycle of 30 and a running timer. `startedAt` is owned by the step view, so the timer
 * keeps running across the CPR steps. With reduced motion the ring does not swell; the dot changes colour instead.
 */
export function Metronome({
  running,
  onToggle,
  startedAt,
  onResetTimer,
}: {
  running: boolean;
  onToggle: () => void;
  /** when the guide's timer started (ms since epoch) */
  startedAt: number;
  onResetTimer: () => void;
}) {
  const { t } = useI18n();
  const rate = CPR_RATE.default;
  const interval = beatIntervalMs(rate);
  const [beats, setBeats] = useState(0);
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ctxRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  // the beat clock: checked four times a beat, one cue per due beat (never skips ahead after a slow frame)
  useEffect(() => {
    if (!running) return;
    const begin = performance.now();
    let n = 0;
    const id = window.setInterval(() => {
      const due = Math.floor((performance.now() - begin) / interval) + 1;
      if (due <= n) return;
      n += 1;
      setBeats(n);
      if (soundRef.current) click(ctxRef);
    }, interval / 4);
    return () => window.clearInterval(id);
  }, [running, interval]);

  // the running timer (once a second)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => void ctxRef.current?.close().catch(() => {}), []);

  const pos = running ? cyclePosition(beats) : 0;
  return (
    <section
      aria-label={t("emergency.metro.title")}
      className="flex flex-wrap items-center gap-3 rounded-[22px] bg-white/80 px-3 py-2.5 ring-1 ring-[var(--aegis-hairline)]"
    >
      <div className="relative flex size-14 shrink-0 items-center justify-center" aria-hidden="true">
        {running ? <span key={beats} className="aegis-beat absolute inset-0 rounded-full bg-[#C53030]/35" /> : null}
        <span
          className={cn(
            "relative size-9 rounded-full ring-4 ring-white transition-colors duration-100",
            running && beats % 2 === 0 ? "bg-[#9B2C2C]" : "bg-[#C53030]",
            !running && "bg-[#C53030]/40",
          )}
        />
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="unit-label">{t("emergency.metro.title")}</span>
        <span className="tnum text-[17px] font-medium text-[var(--aegis-ink)]">{t("emergency.metro.rate", { rate })}</span>
        <span className="tnum text-[13px] text-[var(--aegis-label)]">{t("emergency.metro.count", { n: pos })}</span>
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="unit-label">{t("emergency.metro.elapsed")}</span>
        <span className="tnum text-[22px] font-medium text-[var(--aegis-ink)]" role="timer" aria-live="off">
          {formatElapsed(now - startedAt)}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={running}
          className="inline-flex h-12 items-center gap-1.5 rounded-full bg-[#C53030] px-4 text-[15px] font-medium text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          {running ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {running ? t("emergency.metro.stop") : t("emergency.metro.start")}
        </button>
        <button
          type="button"
          onClick={() => setSound((s) => !s)}
          aria-pressed={sound}
          aria-label={t("emergency.metro.sound")}
          className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-[var(--aegis-hairline)] outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          {sound ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={onResetTimer}
          aria-label={t("emergency.metro.reset")}
          className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-[var(--aegis-hairline)] outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          <RotateCcw className="size-5" aria-hidden />
        </button>
      </div>
    </section>
  );
}

/** a short click (WebAudio); silently nothing when audio is unavailable */
function click(ctxRef: { current: AudioContext | null }) {
  try {
    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1100;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  } catch {
    /* no audio */
  }
}
