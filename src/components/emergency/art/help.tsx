import { Kneeler, Sitter, Stander } from "./figures";
import { ACCENT, ACCENT_DEEP, ALERT, Canvas, INK, LyingPerson, Waves } from "./kit";

/** step 1 everywhere: a crewmate calling for help, with the medical cross in a speech bubble */
export function CallArt() {
  return (
    <Canvas>
      <Stander x={92} tone="helper" hand={[78, 42]} hand2={[104, 104]} />
      <rect x="72" y="34" width="9" height="18" rx="3" fill={INK} />
      <Waves x={62} y={42} flip color={ACCENT_DEEP} />
      <g transform="translate(150 54)">
        <path d="M-34 -26 h68 a14 14 0 0 1 14 14 v28 a14 14 0 0 1 -14 14 h-44 l-14 12 v-12 h-10 a14 14 0 0 1 -14 -14 v-28 a14 14 0 0 1 14 -14 z" fill="#fff" stroke={ALERT} strokeWidth="2.4" />
        <path d="M0 -14 v28 M-14 0 h28" stroke={ALERT} strokeWidth="7" />
      </g>
    </Canvas>
  );
}

/** a helper kneeling beside a seated person, a hand on the shoulder; `talk` adds a calm speech bubble */
export function StayWithArt({ talk = false }: { talk?: boolean }) {
  return (
    <Canvas>
      <path d="M44 150 V78 a10 10 0 0 1 10 -10" stroke={INK} strokeOpacity="0.18" strokeWidth="6" />
      <Sitter x={74} />
      <Kneeler x={168} reach={[78, 98]} reach2={[110, 118]} lean={4} />
      {talk ? (
        <g transform="translate(176 40)">
          <rect x="-24" y="-16" width="48" height="30" rx="14" fill="#fff" stroke={ACCENT} strokeWidth="2.2" />
          <path d="M-10 -1 h20 M-10 6 h12" stroke={ACCENT} strokeWidth="3" />
        </g>
      ) : null}
    </Canvas>
  );
}

export function StayArt() {
  return <StayWithArt />;
}

export function ReassureArt() {
  return <StayWithArt talk />;
}

/** keep watching: a person lying down, a helper beside them, an eye above */
export function WatchArt() {
  return (
    <Canvas>
      <LyingPerson x={44} />
      <Kneeler x={168} reach={[100, 132]} lean={10} />
      <g transform="translate(88 64)">
        <path d="M-26 0 Q0 -22 26 0 Q0 22 -26 0 Z" fill="#fff" stroke={ACCENT_DEEP} strokeWidth="2.4" />
        <circle r="8" fill={ACCENT} />
        <circle r="3" fill={INK} />
      </g>
    </Canvas>
  );
}

/** note the time: a stopwatch */
export function TimerArt() {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return `M${120 + Math.sin(a) * 38} ${92 - Math.cos(a) * 38} L${120 + Math.sin(a) * 44} ${92 - Math.cos(a) * 44}`;
  });
  return (
    <Canvas floor={false}>
      <rect x="110" y="30" width="20" height="10" rx="4" fill={INK} />
      <circle cx="120" cy="92" r="52" fill="#fff" stroke={INK} strokeWidth="3" />
      <path d="M120 92 m0 -44 a44 44 0 0 1 38 22 L120 92 Z" fill="var(--cosmo-pastel-blue)" />
      <g stroke={INK} strokeOpacity="0.4" strokeWidth="2.4">
        {ticks.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path d="M120 92 L120 56" stroke={ACCENT_DEEP} strokeWidth="4" />
      <path d="M120 92 L150 76" stroke={ALERT} strokeWidth="3" />
      <circle cx="120" cy="92" r="5" fill={INK} />
    </Canvas>
  );
}
