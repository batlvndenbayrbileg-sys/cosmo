"use client";

import { useMemo, useSyncExternalStore } from "react";

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const readViewport = () => `${window.innerWidth}x${window.innerHeight}`;
const serverViewport = () => "1440x900";

/** the window size, re-read on resize (the same shape as the check-in stage's own) */
export function useViewport(): { width: number; height: number } {
  const raw = useSyncExternalStore(subscribeResize, readViewport, serverViewport);
  return useMemo(() => {
    const [w, h] = raw.split("x").map(Number);
    return { width: w || 1440, height: h || 900 };
  }, [raw]);
}
