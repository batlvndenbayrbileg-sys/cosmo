import { RecoveryPerson, Sitter } from "./figures";
import { ACCENT, ACCENT_DEEP, Arrow, Canvas, FLOOR_Y, LyingPerson, Pad } from "./kit";

/** lie down on the back */
export function LyingArt() {
  return (
    <Canvas>
      <LyingPerson x={40} />
      <Arrow d="M100 70 L100 112" />
    </Canvas>
  );
}

/** lying down, legs raised a little on a cushion */
export function LegsRaisedArt() {
  return (
    <Canvas>
      <LyingPerson x={32} legs="raised" />
      <Arrow d="M170 92 L170 64" />
    </Canvas>
  );
}

/** sit up slowly, over a few minutes */
export function SitUpArt() {
  return (
    <Canvas>
      <Sitter x={92} knees="straight" recline={22} />
      <path d="M40 118 A52 52 0 0 1 62 70" stroke={ACCENT} strokeWidth="3" strokeDasharray="2 7" />
      <Arrow d="M58 76 L64 66" />
      <g fill={ACCENT_DEEP}>
        <circle cx="150" cy="70" r="3.4" />
        <circle cx="163" cy="70" r="3.4" opacity="0.6" />
        <circle cx="176" cy="70" r="3.4" opacity="0.3" />
      </g>
    </Canvas>
  );
}

/** on the side in the recovery position */
export function RecoveryArt() {
  return (
    <Canvas>
      <RecoveryPerson x={44} />
      <path d="M40 104 a16 16 0 0 1 22 -8" stroke={ACCENT} strokeWidth="3" />
    </Canvas>
  );
}

/** chest pain: sitting on the floor, knees bent, head and shoulders supported */
export function SitSupportedArt() {
  return (
    <Canvas>
      <Pad x={52} y={80} w={24} h={66} />
      <Pad x={120} y={FLOOR_Y - 26} w={34} h={22} fill="var(--aegis-pastel-mint)" />
      <Sitter x={96} recline={12} />
    </Canvas>
  );
}

/** possible serious head injury: keep still; brackets either side of the head and neck */
export function StayStillArt() {
  return (
    <Canvas>
      <LyingPerson x={60} />
      <g stroke={ACCENT_DEEP} strokeWidth="3.4">
        <path d="M40 118 q-8 16 0 30" />
        <path d="M86 116 q8 16 0 32" />
      </g>
    </Canvas>
  );
}

/** seizure: something soft under the head */
export function CushionHeadArt() {
  return (
    <Canvas>
      <Pad x={34} y={FLOOR_Y - 14} w={46} h={14} />
      <LyingPerson x={58} />
      <Arrow d="M58 92 L58 116" />
    </Canvas>
  );
}
