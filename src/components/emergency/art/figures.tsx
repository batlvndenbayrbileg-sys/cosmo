import { FLOOR_Y, Head, Limb, type Tone } from "./kit";

type Pt = readonly [number, number];
const P = ([x, y]: Pt) => `${x} ${y}`;

/**
 * A helper kneeling on the right of a person on the floor, leaning in. `x` is the knee on the floor; both hands reach
 * to `reach` (the second hand to `reach2` when given).
 */
export function Kneeler({ x, reach, reach2, tone = "helper", lean = 0 }: { x: number; reach: Pt; reach2?: Pt; tone?: Tone; lean?: number }) {
  const knee: Pt = [x, FLOOR_Y - 6];
  const foot: Pt = [x + 36, FLOOR_Y - 5];
  const hip: Pt = [x + 8, FLOOR_Y - 40];
  const shoulder: Pt = [x - 6 - lean, FLOOR_Y - 82 + lean * 0.4];
  const head: Pt = [shoulder[0] - 8, shoulder[1] - 18];
  const elbow = (to: Pt): Pt => [(shoulder[0] + to[0]) / 2 + 6, (shoulder[1] + to[1]) / 2 - 2];
  return (
    <g>
      <Limb d={`M${P(foot)} L${P(knee)} L${P(hip)}`} tone={tone} w={12} />
      <Limb d={`M${P(hip)} L${P(shoulder)}`} tone={tone} w={19} />
      {reach2 ? <Limb d={`M${P(shoulder)} L${P(elbow(reach2))} L${P(reach2)}`} tone={tone} w={8} /> : null}
      <Limb d={`M${P(shoulder)} L${P(elbow(reach))} L${P(reach)}`} tone={tone} w={8} />
      <Head cx={head[0]} cy={head[1]} tone={tone} />
    </g>
  );
}

/**
 * A standing person, facing left. `x` is between the feet. Arms go from the shoulder to `hand` / `hand2`; `lean`
 * bends the upper body forward (to the left).
 */
export function Stander({ x, hand, hand2, tone = "patient", lean = 0 }: { x: number; hand: Pt; hand2?: Pt; tone?: Tone; lean?: number }) {
  const hip: Pt = [x, FLOOR_Y - 58];
  const shoulder: Pt = [x - lean, FLOOR_Y - 104 + Math.abs(lean) * 0.35];
  const head: Pt = [shoulder[0] - lean * 0.35, shoulder[1] - 19];
  const elbow = (to: Pt): Pt => [(shoulder[0] + to[0]) / 2 + 4, (shoulder[1] + to[1]) / 2 + 6];
  return (
    <g>
      <Limb d={`M${x - 10} ${FLOOR_Y - 2} L${P(hip)} L${x + 10} ${FLOOR_Y - 2}`} tone={tone} w={12} />
      <Limb d={`M${P(hip)} L${P(shoulder)}`} tone={tone} w={19} />
      {hand2 ? <Limb d={`M${P(shoulder)} L${P(elbow(hand2))} L${P(hand2)}`} tone={tone} w={8} /> : null}
      <Limb d={`M${P(shoulder)} L${P(elbow(hand))} L${P(hand)}`} tone={tone} w={8} />
      <Head cx={head[0]} cy={head[1]} tone={tone} />
    </g>
  );
}

/**
 * A person sitting on the floor, back leaning on a support at the left, knees bent (or legs straight). `x` is the hip.
 * `hand` places the near hand (default: resting on the knee).
 */
export function Sitter({ x, knees = "bent", tone = "patient", hand, recline = 10 }: { x: number; knees?: "bent" | "straight"; tone?: Tone; hand?: Pt; recline?: number }) {
  const hip: Pt = [x, FLOOR_Y - 9];
  const shoulder: Pt = [x - recline, FLOOR_Y - 58];
  const head: Pt = [shoulder[0] - recline * 0.3, shoulder[1] - 19];
  const knee: Pt = knees === "bent" ? [x + 34, FLOOR_Y - 38] : [x + 36, FLOOR_Y - 9];
  const foot: Pt = knees === "bent" ? [x + 58, FLOOR_Y - 6] : [x + 70, FLOOR_Y - 8];
  const h: Pt = hand ?? [knee[0] - 4, knee[1] + 4];
  return (
    <g>
      <Limb d={`M${P(hip)} L${P(knee)} L${P(foot)}`} tone={tone} w={12} />
      <Limb d={`M${P(hip)} L${P(shoulder)}`} tone={tone} w={19} />
      <Limb d={`M${P(shoulder)} L${(shoulder[0] + h[0]) / 2} ${(shoulder[1] + h[1]) / 2 + 8} L${P(h)}`} tone={tone} w={8} />
      <Head cx={head[0]} cy={head[1]} tone={tone} />
    </g>
  );
}

/** lying on the side (recovery position), head on the left resting on the hand, top knee bent forward */
export function RecoveryPerson({ x = 46, tone = "patient" }: { x?: number; tone?: Tone }) {
  const y = FLOOR_Y - 12;
  return (
    <g>
      <Limb d={`M${x + 70} ${y + 2} L${x + 118} ${y + 6} L${x + 150} ${y + 6}`} tone={tone} w={11} />
      <Limb d={`M${x + 70} ${y - 4} L${x + 96} ${y - 26} L${x + 112} ${y + 2}`} tone={tone} w={12} />
      <Limb d={`M${x + 14} ${y - 8} L${x + 72} ${y - 2}`} tone={tone} w={22} />
      <Limb d={`M${x + 22} ${y - 14} L${x + 44} ${y - 30} L${x + 52} ${y - 6}`} tone={tone} w={8} />
      <Limb d={`M${x + 6} ${y + 6} L${x - 10} ${y + 8}`} tone={tone} w={8} />
      <Head cx={x} cy={y - 6} tone={tone} />
    </g>
  );
}
