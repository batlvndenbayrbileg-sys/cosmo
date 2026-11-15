import { Kneeler } from "./figures";
import { ACCENT, Arrow, Canvas, INK, LyingPerson, NoSign } from "./kit";

/** clear the space: hard or sharp things moved away, people step back */
export function ClearSpaceArt() {
  return (
    <Canvas>
      <LyingPerson x={74} />
      <g stroke={ACCENT} strokeWidth="2.4" opacity="0.8">
        <path d="M74 112 l6 -6 l6 6 l6 -6" />
        <path d="M150 116 l6 -6 l6 6 l6 -6" />
      </g>
      <g transform="translate(30 126)">
        <path d="M-10 -14 h20 l-3 22 h-14 z" fill="#fff" stroke={INK} strokeWidth="2" />
      </g>
      <Arrow d="M48 100 L22 92" />
      <rect x="198" y="112" width="24" height="22" rx="4" fill="#fff" stroke={INK} strokeWidth="2" />
      <Arrow d="M190 100 L216 92" />
    </Canvas>
  );
}

/** do not hold them down, nothing in the mouth */
export function HandsOffArt() {
  return (
    <Canvas>
      <LyingPerson x={52} />
      <Kneeler x={172} reach={[128, 82]} reach2={[140, 78]} lean={2} />
      <path d="M30 106 L50 120" stroke={INK} strokeWidth="5" />
      <NoSign cx={44} cy={110} r={18} />
    </Canvas>
  );
}
