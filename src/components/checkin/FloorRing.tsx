"use client";

import { useId, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LevelStore } from "@/hooks/useRecorder";

export type RingMode = "idle" | "listening" | "thinking" | "speaking";

const CYAN = "#22c3e6";
const LILAC = "#a78bfa";
const BLUE = "#4f86f7";

const zeroLevel = () => 0;
const subscribeNone = () => () => {};

/**
 * The light on the floor under Cosmo (docs/DESIGN_V2.md section 3):
 *  - always a soft blue glow ellipse and a hairline ring;
 *  - listening: a soft cyan pulse, the inner ring swells with the microphone level;
 *  - thinking: a slow lilac arc travelling round the ellipse;
 *  - speaking: a blue ring whose brightness follows Cosmo's voice amplitude.
 */
export function FloorRing({
  cx,
  cy,
  rx,
  ry,
  mode,
  amplitude,
  level,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  mode: RingMode;
  amplitude: number;
  level: LevelStore | null;
}) {
  const reduce = useReducedMotion();
  const id = useId().replace(/:/g, "");
  const mic = useSyncExternalStore(level?.subscribe ?? subscribeNone, level?.get ?? zeroLevel, zeroLevel);
  const pad = 40;
  const w = rx * 2 + pad * 2;
  const h = ry * 2 + pad * 2;
  const ox = rx + pad;
  const oy = ry + pad;
  const amp = Math.min(1, Math.max(0, Number.isFinite(amplitude) ? amplitude : 0));
  const centred = { transformBox: "fill-box", transformOrigin: "center" } as const;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="floor-ring"
      data-mode={mode}
      className="pointer-events-none absolute overflow-visible"
      style={{ left: cx - ox, top: cy - oy }}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
    >
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#bcd3ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#bcd3ff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-30%" y="-150%" width="160%" height="400%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* contact shadow + glow */}
      <ellipse cx={ox} cy={oy} rx={rx * 1.25} ry={ry * 1.7} fill={`url(#${id}-glow)`} />
      <ellipse cx={ox} cy={oy} rx={rx * 0.62} ry={ry * 0.55} fill="rgba(40,80,160,0.10)" filter={`url(#${id}-soft)`} />
      <ellipse cx={ox} cy={oy} rx={rx} ry={ry} fill="none" stroke="rgba(79,134,247,0.35)" strokeWidth={1} />

      {mode === "listening" ? (
        <>
          {!reduce ? (
            <motion.ellipse
              cx={ox}
              cy={oy}
              rx={rx}
              ry={ry}
              fill="none"
              stroke={CYAN}
              strokeWidth={2}
              style={centred}
              initial={{ scale: 1, opacity: 0.85 }}
              animate={{ scale: 1.16, opacity: 0 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            />
          ) : null}
          <ellipse
            cx={ox}
            cy={oy}
            rx={rx * (0.96 + mic * 0.12)}
            ry={ry * (0.96 + mic * 0.12)}
            fill="none"
            stroke={CYAN}
            strokeWidth={2.4}
            opacity={0.55 + mic * 0.45}
            filter={`url(#${id}-soft)`}
            style={{ transition: "rx 90ms linear, ry 90ms linear, opacity 90ms linear" }}
          />
          <ellipse cx={ox} cy={oy} rx={rx} ry={ry} fill="none" stroke={CYAN} strokeWidth={1.4} opacity={0.9} />
        </>
      ) : null}

      {mode === "thinking" ? (
        <>
          <ellipse cx={ox} cy={oy} rx={rx} ry={ry} fill="none" stroke={LILAC} strokeOpacity={0.25} strokeWidth={1.5} />
          <motion.ellipse
            cx={ox}
            cy={oy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={LILAC}
            strokeWidth={3}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="20 80"
            filter={`url(#${id}-soft)`}
            initial={{ strokeDashoffset: 0 }}
            animate={reduce ? { strokeDashoffset: 0 } : { strokeDashoffset: -100 }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
          />
          <motion.ellipse
            cx={ox}
            cy={oy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={LILAC}
            strokeWidth={1.6}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="20 80"
            initial={{ strokeDashoffset: 0 }}
            animate={reduce ? { strokeDashoffset: 0 } : { strokeDashoffset: -100 }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
          />
        </>
      ) : null}

      {mode === "speaking" ? (
        <>
          <ellipse
            cx={ox}
            cy={oy}
            rx={rx * (1 + amp * 0.05)}
            ry={ry * (1 + amp * 0.08)}
            fill="none"
            stroke={BLUE}
            strokeWidth={4}
            opacity={0.18 + amp * 0.7}
            filter={`url(#${id}-soft)`}
          />
          <ellipse cx={ox} cy={oy} rx={rx} ry={ry} fill="none" stroke={BLUE} strokeWidth={1.6} opacity={0.4 + amp * 0.6} />
        </>
      ) : null}
    </svg>
  );
}
