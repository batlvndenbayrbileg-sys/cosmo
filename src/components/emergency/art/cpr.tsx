import type { CSSProperties } from "react";
import { Kneeler } from "./figures";
import { ACCENT, ACCENT_DEEP, ALERT, Arrow, Canvas, INK, LyingPerson, Waves } from "./kit";

/** head tilted back, chin lifted, look and listen for breathing */
export function CheckBreathingArt() {
  return (
    <Canvas>
      <LyingPerson x={44} />
      <Kneeler x={124} reach={[44, 124]} reach2={[54, 138]} lean={22} />
      <Waves x={30} y={112} flip />
      <path d="M44 104 a12 12 0 0 1 16 -4" stroke={ACCENT_DEEP} strokeWidth="2.6" />
    </Canvas>
  );
}

/** the heel of one hand on the centre of the chest, the other hand on top */
export function HandsChestArt() {
  return (
    <Canvas>
      <LyingPerson x={36} />
      <circle cx="80" cy="128" r="15" fill={ACCENT} opacity="0.18" />
      <Kneeler x={136} reach={[80, 126]} reach2={[84, 124]} lean={26} />
      <circle cx="80" cy="128" r="5" fill={ALERT} />
    </Canvas>
  );
}

/**
 * Chest compressions. When `beatMs` is given the helper's arms push in time (a CSS animation, stopped by the
 * reduced-motion rule in globals.css); the arrows show the movement either way.
 */
export function CompressionsArt({ beatMs }: { beatMs?: number }) {
  const style = beatMs ? ({ animationDuration: `${Math.round(beatMs)}ms` } as CSSProperties) : undefined;
  return (
    <Canvas>
      <LyingPerson x={36} />
      <g className={beatMs ? "aegis-compress" : undefined} style={style}>
        <Kneeler x={136} reach={[80, 126]} reach2={[84, 124]} lean={26} />
      </g>
      <Arrow d="M60 84 L60 112" color={ACCENT_DEEP} />
      <Arrow d="M48 112 L48 86" color={ACCENT} />
      <text x="190" y="52" textAnchor="middle" fontSize="22" fontWeight="600" fill={INK} opacity="0.75">
        100–120
      </text>
      <text x="190" y="68" textAnchor="middle" fontSize="11" fill={INK} opacity="0.55">
        / min
      </text>
    </Canvas>
  );
}

/** the defibrillator: two pads on the chest, wires to the box, which talks you through it */
export function AedArt() {
  return (
    <Canvas>
      <LyingPerson x={36} />
      <rect x="70" y="122" width="14" height="18" rx="3" fill="#fff" stroke={INK} strokeWidth="2" />
      <rect x="96" y="128" width="14" height="18" rx="3" fill="#fff" stroke={INK} strokeWidth="2" />
      <path d="M77 122 C80 80 150 80 162 90 M103 128 C110 98 150 98 164 98" stroke={INK} strokeOpacity="0.55" strokeWidth="2" />
      <g transform="translate(150 60)">
        <rect width="64" height="56" rx="12" fill="#fff" stroke={ALERT} strokeWidth="3" />
        <path d="M22 18 c0 -6 10 -6 10 0 c0 -6 10 -6 10 0 c0 8 -10 14 -10 16 c0 -2 -10 -8 -10 -16 z" fill={ALERT} />
        <path d="M30 42 l6 -8 l-4 0 l6 -8" stroke={ALERT} strokeWidth="2.4" />
      </g>
      <Waves x={222} y={84} />
    </Canvas>
  );
}
