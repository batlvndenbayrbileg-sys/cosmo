import { Stander } from "./figures";
import { ACCENT, ALERT, Arrow, Canvas, Waves } from "./kit";

/** encourage coughing */
export function CoughArt() {
  return (
    <Canvas>
      <Stander x={120} hand={[104, 50]} hand2={[132, 104]} />
      <Waves x={92} y={46} flip color={ACCENT} />
      <g fill={ACCENT} opacity="0.7">
        <circle cx="70" cy="40" r="3" />
        <circle cx="62" cy="54" r="2.4" />
      </g>
    </Canvas>
  );
}

/** leaning forward; sharp blows between the shoulder blades with the heel of the hand */
export function BackBlowsArt() {
  return (
    <Canvas>
      <Stander x={96} lean={24} hand={[70, 112]} hand2={[80, 116]} />
      <Stander x={164} tone="helper" hand={[98, 60]} hand2={[84, 82]} />
      <Arrow d="M132 26 L104 50" color={ALERT} />
      <circle cx="96" cy="58" r="11" fill={ALERT} opacity="0.14" />
    </Canvas>
  );
}

/** standing behind; a fist between the belly button and the bottom of the chest; pull in and up */
export function AbdominalThrustsArt() {
  return (
    <Canvas>
      <Stander x={94} lean={6} hand={[78, 104]} hand2={[86, 108]} />
      <Stander x={128} tone="helper" hand={[92, 86]} hand2={[96, 90]} />
      <circle cx="93" cy="88" r="8" fill={ALERT} opacity="0.2" />
      <Arrow d="M60 110 L84 84" color={ALERT} />
    </Canvas>
  );
}
