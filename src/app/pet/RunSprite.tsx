"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { RUN_FADE_MS, RUN_FRAMES, runFrameAt } from "@/lib/pet/sprite";

/**
 * Cosmo running (arms and legs pumping), for the desktop pet while the window travels along the bottom of the screen.
 * The team's 12 frames (public/mascot/run, scripts/prepare-run-frames.ps1) are drawn facing right; `dir` -1 mirrors
 * them to run left. All frames stay mounted (decoded once, no flicker) and a requestAnimationFrame loop shows one at a
 * time through refs, picked from the time since the run began (src/lib/pet/sprite.ts), so the stride never drifts and
 * playing it never re-renders React. Reduced motion: one still mid-stride frame, no cycling.
 */
export function RunSprite({ running, dir, size = 124 }: { running: boolean; dir: number; size?: number }) {
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const reduced = usePrefersReducedMotion();

  // decode every frame up front, so the first run starts on a ready picture
  useEffect(() => {
    for (const img of imgs.current) void img?.decode?.().catch(() => {});
  }, []);

  useEffect(() => {
    const show = (n: number) => {
      imgs.current.forEach((img, i) => {
        if (img) img.style.visibility = i === n ? "visible" : "hidden";
      });
    };
    if (!running || reduced) {
      show(runFrameAt(0, { reducedMotion: reduced }));
      return;
    }
    let raf = 0;
    let start: number | null = null;
    let shown = -1;
    const tick = (t: number) => {
      start ??= t;
      const n = runFrameAt(t - start);
      if (n !== shown) {
        shown = n;
        show(n);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, reduced]);

  return (
    <div
      aria-hidden
      data-slot="pet-run"
      data-running={running ? "true" : "false"}
      className="pointer-events-none absolute inset-0 ease-out motion-reduce:transition-none"
      style={{
        opacity: running ? 1 : 0,
        transform: `scaleX(${dir < 0 ? -1 : 1})`,
        transitionProperty: "opacity",
        transitionDuration: `${RUN_FADE_MS}ms`,
      }}
    >
      {RUN_FRAMES.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- plain frames swapped 20x a second, no optimisation wanted
        <img
          key={src}
          ref={(el) => {
            imgs.current[i] = el;
          }}
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_6px_8px_rgba(20,40,90,0.25)]"
          style={{ visibility: i === 0 ? "visible" : "hidden" }}
        />
      ))}
    </div>
  );
}
