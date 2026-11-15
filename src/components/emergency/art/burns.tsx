import { ACCENT, ACCENT_DEEP, ALERT, Arrow, Canvas, INK, Limb, NoSign } from "./kit";

function BurntArm() {
  return (
    <g>
      <Limb d="M24 124 L216 114" w={32} />
      <ellipse cx="120" cy="116" rx="18" ry="7" fill={ALERT} opacity="0.35" />
    </g>
  );
}

/** cool running water for at least 20 minutes */
export function CoolWaterArt() {
  return (
    <Canvas floor={false}>
      <path d="M36 30 H112 a10 10 0 0 1 10 10 V52" stroke={INK} strokeOpacity="0.55" strokeWidth="9" />
      <g stroke={ACCENT} strokeWidth="3" strokeDasharray="7 6" opacity="0.85">
        <path d="M114 60 V104 M122 60 V106 M130 60 V104" />
      </g>
      <BurntArm />
      <text x="190" y="62" textAnchor="middle" fontSize="20" fontWeight="600" fill={ACCENT_DEEP}>
        20′
      </text>
    </Canvas>
  );
}

/** take off rings and watches before the area swells */
export function RemoveRingsArt() {
  return (
    <Canvas floor={false}>
      <Limb d="M20 124 L118 114" w={28} />
      <Limb d="M118 114 L168 92" w={9} />
      <Limb d="M120 116 L174 106" w={9} />
      <Limb d="M120 120 L172 122" w={9} />
      <Limb d="M114 108 L140 82" w={9} />
      <ellipse cx="120" cy="118" rx="16" ry="6" fill={ALERT} opacity="0.3" />
      <circle cx="196" cy="78" r="8" stroke="#D69E2E" strokeWidth="4" />
      <Arrow d="M166 92 L186 82" />
      <rect x="62" y="104" width="14" height="30" rx="4" stroke={INK} strokeOpacity="0.5" strokeWidth="3" strokeDasharray="4 4" />
    </Canvas>
  );
}

/** once cooled: cover loosely with cling film or a clean plastic bag */
export function CoverBurnArt() {
  return (
    <Canvas floor={false}>
      <BurntArm />
      <path
        d="M70 90 q25 -8 50 0 t50 0 L178 140 q-25 8 -50 0 t-50 0 Z"
        fill={ACCENT}
        fillOpacity="0.12"
        stroke={ACCENT_DEEP}
        strokeWidth="2"
        strokeDasharray="5 5"
      />
    </Canvas>
  );
}

/** no ice, no creams or gels, do not burst blisters */
export function NoIceArt() {
  return (
    <Canvas floor={false}>
      <rect x="54" y="64" width="44" height="44" rx="10" fill="var(--cosmo-pastel-blue)" stroke={ACCENT_DEEP} strokeWidth="2.4" />
      <path d="M64 74 l10 8" stroke="#fff" strokeWidth="4" />
      <NoSign cx={76} cy={86} r={34} />
      <g transform="translate(164 86) rotate(-20)">
        <rect x="-12" y="-28" width="24" height="48" rx="6" fill="#fff" stroke={INK} strokeWidth="2.2" />
        <rect x="-7" y="-38" width="14" height="10" rx="2" fill={INK} />
      </g>
      <NoSign cx={164} cy={86} r={34} />
    </Canvas>
  );
}
