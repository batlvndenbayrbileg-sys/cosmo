import { Sitter } from "./figures";
import { ACCENT, ACCENT_DEEP, ALERT, Arrow, Canvas, INK, Limb } from "./kit";

/** a forearm across the canvas with a wound in the middle (close-up) */
function Arm({ wound = true }: { wound?: boolean }) {
  return (
    <g>
      <Limb d="M24 118 L216 108" w={34} />
      {wound ? <ellipse cx="120" cy="110" rx="13" ry="6" fill={ALERT} opacity="0.8" /> : null}
    </g>
  );
}

/** a helper's hand pressing down at (x, y) */
function PressingHand({ x, y, from = [x + 34, 24] as [number, number] }: { x: number; y: number; from?: [number, number] }) {
  return (
    <g>
      <Limb d={`M${from[0]} ${from[1]} L${x + 6} ${y - 14}`} tone="helper" w={14} />
      <ellipse cx={x} cy={y - 6} rx="18" ry="10" fill="var(--aegis-pastel-blue)" stroke={ACCENT_DEEP} strokeWidth="2" />
    </g>
  );
}

/** firm pressure on the wound with a clean pad */
export function PressWoundArt() {
  return (
    <Canvas floor={false}>
      <Arm />
      <rect x="96" y="92" width="48" height="16" rx="5" fill="#fff" stroke={INK} strokeOpacity="0.4" strokeWidth="1.6" />
      <PressingHand x={120} y={92} />
      <Arrow d="M70 52 L70 84" />
    </Canvas>
  );
}

/** something stuck in the wound: leave it, press on both sides */
export function PressSidesArt() {
  return (
    <Canvas floor={false}>
      <Arm />
      <path d="M120 108 L130 66" stroke={INK} strokeWidth="6" />
      <PressingHand x={94} y={104} from={[70, 30]} />
      <PressingHand x={150} y={100} from={[176, 28]} />
    </Canvas>
  );
}

/** a bandage tied firmly over the pad */
export function BandageArt() {
  return (
    <Canvas floor={false}>
      <Arm wound={false} />
      <rect x="86" y="88" width="68" height="40" rx="10" fill="#fff" stroke={INK} strokeOpacity="0.35" strokeWidth="1.6" />
      <g stroke={ACCENT} strokeWidth="5" opacity="0.75">
        <path d="M92 128 L110 88 M108 128 L126 88 M124 128 L142 88 M140 128 L154 96" />
      </g>
      <path d="M150 92 q14 -14 26 -4 q-12 6 -22 14" stroke={ACCENT_DEEP} strokeWidth="3" />
    </Canvas>
  );
}

/** head injury: something cold, wrapped in a cloth, held on the injury */
export function ColdPackArt() {
  return (
    <Canvas>
      <path d="M44 150 V78 a10 10 0 0 1 10 -10" stroke={INK} strokeOpacity="0.18" strokeWidth="6" />
      <Sitter x={100} recline={10} hand={[78, 58]} />
      <g transform="translate(64 46) rotate(-12)">
        <rect width="28" height="20" rx="6" fill="var(--aegis-pastel-blue)" stroke={ACCENT_DEEP} strokeWidth="2" />
        <path d="M14 4 v12 M8 7 l12 6 M20 7 l-12 6" stroke={ACCENT_DEEP} strokeWidth="1.6" />
      </g>
    </Canvas>
  );
}

/** the person's own auto-injector against the outer thigh */
export function AutoInjectorArt() {
  return (
    <Canvas floor={false}>
      <Limb d="M20 124 L220 114" w={40} />
      <g transform="translate(128 48) rotate(8)">
        <rect x="-9" y="0" width="18" height="56" rx="7" fill="#fff" stroke={ACCENT_DEEP} strokeWidth="2.4" />
        <rect x="-9" y="40" width="18" height="16" rx="5" fill="#F6AD55" stroke={ACCENT_DEEP} strokeWidth="2" />
        <path d="M-9 14 h18" stroke={ACCENT_DEEP} strokeWidth="1.6" />
      </g>
      <Limb d="M178 26 L140 66" tone="helper" w={14} />
      <Arrow d="M84 60 L92 92" color={ACCENT} />
    </Canvas>
  );
}
