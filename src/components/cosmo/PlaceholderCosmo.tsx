"use client";

/**
 * PlaceholderCosmo: an original, minimal SVG character (a soft egg-shaped body, two eyes, brows,
 * cheeks and a mouth). Not modelled on any existing film, TV, game or app mascot.
 *
 * Performance: everything that changes every frame (mouth, blink, breathing, tilt, halo) is written
 * straight to SVG attributes from one requestAnimationFrame loop, so React does not re-render at
 * 60 fps. React only re-renders for state, emotion, variant and size changes.
 *
 * With a `gaze` source ("Cosmo looks at you") the eyes and brows shift a few units toward the person
 * (they stay on the face plate) and the body leans a little (no lean with reduced motion).
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { MOUTH_SMOOTHING, mouthOpenFromAmplitude, smoothAmplitude } from "./amplitude";
import { BLINK_DURATION_MS, blinkClosure, nextBlinkDelay } from "./blink";
import {
  BROW_Y,
  EYE_LEFT_X,
  EYE_RIGHT_X,
  EYE_Y,
  VIEW_SIZE,
  describeCosmo,
  emotionLook,
  mouthPath,
  scaleYAbout,
  type EyeKind,
} from "./face";
import { GAZE_CENTRE, gazeLean, lerpGaze, smoothingFactor, type Gaze, type GazeSource } from "./gaze";
import type { CosmoEmotion, CosmoProps, CosmoState } from "./types";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { variantFor, type FaceDetail } from "./variants";

const INK = "#1F2A3C";
const MOUTH_FILL = "#4A2638";
const PLATE = "#FFFFFF";
const WARM_CHEEK = "#F59FB0";
const COOL_CHEEK = "#9CC3E8";
const COOL_TINT = "#7DB2E6";
const FRECKLE = "#B5603A";

const BODY_PATH =
  "M100 30C146 30 176 62 176 110C176 154 146 180 100 180C54 180 24 154 24 110C24 62 54 30 100 30Z";

const HALO_CX = 100;
const HALO_CY = 17;
const TILT_PIVOT_Y = 176;
const BREATH_PIVOT_Y = 180;

interface Live {
  state: CosmoState;
  emotion: CosmoEmotion;
  amplitude: number;
  reduced: boolean;
  gaze: GazeSource | undefined;
}

const f2 = (n: number) => Math.round(n * 100) / 100;

/** furthest the eyes move toward the person, viewBox units (the face plate leaves room for more) */
const GAZE_EYE_X = 5;
const GAZE_EYE_Y = 3.5;

function Eye({ cx, kind, transition }: { cx: number; kind: EyeKind; transition: string }) {
  const show = (k: EyeKind): CSSProperties => ({ opacity: kind === k ? 1 : 0, transition });
  return (
    <>
      <g style={show("round")}>
        <ellipse cx={cx} cy={EYE_Y} rx={8} ry={10} fill={INK} />
        <circle cx={cx + 2.6} cy={EYE_Y - 3.6} r={2.4} fill={PLATE} />
      </g>
      <g style={show("soft")}>
        <ellipse cx={cx} cy={EYE_Y + 1} rx={8} ry={9} fill={INK} />
        <circle cx={cx + 2.6} cy={EYE_Y - 2.4} r={3} fill={PLATE} />
      </g>
      <g style={show("arc")}>
        <path
          d={`M${cx - 9} ${EYE_Y + 4}Q${cx} ${EYE_Y - 12} ${cx + 9} ${EYE_Y + 4}`}
          fill="none"
          stroke={INK}
          strokeWidth={4.5}
          strokeLinecap="round"
        />
      </g>
    </>
  );
}

function Detail({ detail, accent }: { detail: FaceDetail; accent: string }) {
  switch (detail) {
    case "freckles":
      return (
        <g fill={FRECKLE} opacity={0.7}>
          {[
            [50, 112],
            [58, 116],
            [64, 110],
            [150, 112],
            [142, 116],
            [136, 110],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={1.9} />
          ))}
        </g>
      );
    case "earDot":
      return (
        <g>
          <circle cx={25} cy={112} r={6.5} fill={accent} />
          <circle cx={25} cy={112} r={2.2} fill={PLATE} opacity={0.85} />
        </g>
      );
    case "sparkle":
      return (
        <path
          transform="translate(139 52)"
          d="M0 -11Q1.6 -1.6 11 0Q1.6 1.6 0 11Q-1.6 1.6 -11 0Q-1.6 -1.6 0 -11Z"
          fill={accent}
        />
      );
    case "glasses":
      return (
        <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
          <circle cx={EYE_LEFT_X} cy={EYE_Y} r={17} />
          <circle cx={EYE_RIGHT_X} cy={EYE_Y} r={17} />
          <path d={`M${EYE_LEFT_X + 17} ${EYE_Y}L${EYE_RIGHT_X - 17} ${EYE_Y}`} />
        </g>
      );
  }
}

export function PlaceholderCosmo({
  variant,
  state,
  emotion,
  amplitude,
  size,
  className,
  label,
  gaze,
}: CosmoProps) {
  const reduced = usePrefersReducedMotion();
  const look = emotionLook(emotion);
  const v = variantFor(variant);

  const live = useRef<Live>({ state, emotion, amplitude, reduced, gaze });
  useEffect(() => {
    live.current = { state, emotion, amplitude, reduced, gaze };
  });

  const tiltRef = useRef<SVGGElement>(null);
  const breathRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);
  const eyeLeftRef = useRef<SVGGElement>(null);
  const eyeRightRef = useRef<SVGGElement>(null);
  const browLeftRef = useRef<SVGGElement>(null);
  const browRightRef = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let mouth = 0;
    let tilt = 0;
    let breathWeight = 0;
    let haloOpacity = 0;
    let blinkStart = Number.NEGATIVE_INFINITY;
    let nextBlinkAt = last + nextBlinkDelay();
    let gazeNow: Gaze = { ...GAZE_CENTRE };
    let leanDeg = 0;
    const written = new Map<string, string>();

    const put = (key: string, el: Element | null, attr: string, value: string) => {
      if (!el || written.get(key) === value) return;
      written.set(key, value);
      el.setAttribute(attr, value);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(Math.max(now - last, 0), 100);
      last = now;
      const cur = live.current;

      // mouth follows amplitude, also with reduced motion
      mouth = smoothAmplitude(mouth, mouthOpenFromAmplitude(cur.amplitude), dt, MOUTH_SMOOTHING);
      put("mouth", mouthRef.current, "d", mouthPath(emotionLook(cur.emotion), mouth));

      // blink: randomised timer, 140 ms; none at all with reduced motion
      let closure = 0;
      if (!cur.reduced) {
        if (now >= nextBlinkAt) {
          blinkStart = now;
          nextBlinkAt = now + BLINK_DURATION_MS + nextBlinkDelay();
        }
        closure = blinkClosure(now - blinkStart);
      }
      // gaze: eyes (and brows) shift toward the person, also with reduced motion; back to centre without
      const seen = cur.gaze?.current ?? null;
      gazeNow = lerpGaze(gazeNow, seen ?? GAZE_CENTRE, smoothingFactor(dt, seen ? 90 : 380));
      const gx = f2(gazeNow.x * GAZE_EYE_X);
      const gy = f2(gazeNow.y * GAZE_EYE_Y);
      const eyeScale = 1 - 0.92 * closure;
      const eyeT = `translate(${gx} ${gy}) ${scaleYAbout(EYE_Y, eyeScale)}`;
      put("eyeL", eyeLeftRef.current, "transform", eyeT);
      put("eyeR", eyeRightRef.current, "transform", eyeT);
      const browT = `translate(${f2(gx * 0.6)} ${f2(gy * 0.6)})`;
      put("browL", browLeftRef.current, "transform", browT);
      put("browR", browRightRef.current, "transform", browT);

      // breathing in idle only, never with reduced motion
      const breathTarget = cur.state === "idle" && !cur.reduced ? 1 : 0;
      breathWeight = smoothAmplitude(breathWeight, breathTarget, dt, { attackMs: 400, releaseMs: 400 });
      const breath = 1 + 0.016 * breathWeight * Math.sin((Math.PI * 2 * now) / 4200);
      const sx = 1 + (breath - 1) * 0.5;
      put(
        "breath",
        breathRef.current,
        "transform",
        `matrix(${f2(sx)} 0 0 ${f2(breath)} ${f2(100 * (1 - sx))} ${f2(BREATH_PIVOT_Y * (1 - breath))})`,
      );

      // attentive head tilt while listening (a pose, so it stays with reduced motion but does not glide)
      const tiltTarget = cur.state === "listening" ? 5 : 0;
      tilt = cur.reduced ? tiltTarget : smoothAmplitude(tilt, tiltTarget, dt, { attackMs: 170, releaseMs: 170 });
      // and a small lean toward the person (none with reduced motion)
      const leanTarget = gazeLean(seen ? gazeNow : null, cur.reduced).rotateDeg;
      leanDeg = cur.reduced ? leanTarget : leanDeg + (leanTarget - leanDeg) * smoothingFactor(dt, 260);
      put("tilt", tiltRef.current, "transform", `rotate(${f2(tilt + leanDeg)} 100 ${TILT_PIVOT_Y})`);

      // halo: slow opacity and scale pulse while thinking (steady, no pulse, with reduced motion)
      const wave = 0.5 + 0.5 * Math.sin((Math.PI * 2 * now) / 2400 - Math.PI / 2);
      const thinking = cur.state === "thinking";
      const haloTarget = !thinking ? 0 : cur.reduced ? 0.7 : 0.3 + 0.55 * wave;
      haloOpacity = smoothAmplitude(haloOpacity, haloTarget, dt, { attackMs: 160, releaseMs: 160 });
      const haloScale = thinking && !cur.reduced ? 1 + 0.08 * wave : 1;
      put("haloO", haloRef.current, "opacity", f2(haloOpacity).toString());
      put(
        "haloT",
        haloRef.current,
        "transform",
        `matrix(${f2(haloScale)} 0 0 ${f2(haloScale)} ${f2(HALO_CX * (1 - haloScale))} ${f2(HALO_CY * (1 - haloScale))})`,
      );
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const t = reduced ? "none" : "opacity 180ms ease, fill 220ms ease, transform 220ms ease";
  const browStyle = (side: "left" | "right"): CSSProperties => ({
    transform: `translateY(${look.browLift}px) rotate(${side === "left" ? -look.browInnerRaiseDeg : look.browInnerRaiseDeg}deg)`,
    transformBox: "fill-box",
    transformOrigin: "center",
    transition: t,
  });
  const cheekFill = look.cheekTone === "warm" ? WARM_CHEEK : COOL_CHEEK;

  return (
    <svg
      viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
      role="img"
      aria-label={label ?? describeCosmo(state, emotion)}
      focusable="false"
      className={["block shrink-0 select-none", className].filter(Boolean).join(" ")}
      style={{
        width: size ?? "100%",
        height: size ?? "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <ellipse cx={100} cy={190} rx={52} ry={6} fill={INK} opacity={0.1} />
      <g ref={tiltRef}>
        <g ref={haloRef} opacity={0}>
          <ellipse cx={HALO_CX} cy={HALO_CY} rx={30} ry={7} fill="none" stroke={v.accent} strokeWidth={4} />
        </g>
        <ellipse cx={72} cy={180} rx={15} ry={7} fill={v.accent} />
        <ellipse cx={128} cy={180} rx={15} ry={7} fill={v.accent} />
        <g ref={breathRef}>
          <path d={BODY_PATH} fill={v.body} stroke={v.bodyShade} strokeWidth={3} />
          <path d={BODY_PATH} fill={COOL_TINT} style={{ opacity: look.coolTint, transition: t }} />
          <path
            d="M52 78C58 58 76 46 96 44"
            fill="none"
            stroke={PLATE}
            strokeWidth={6}
            strokeLinecap="round"
            opacity={0.55}
          />
          <rect x={38} y={66} width={124} height={86} rx={42} fill={PLATE} opacity={0.78} />
          <ellipse
            cx={56}
            cy={122}
            rx={9}
            ry={6}
            fill={cheekFill}
            style={{ opacity: look.cheekOpacity, transition: t }}
          />
          <ellipse
            cx={144}
            cy={122}
            rx={9}
            ry={6}
            fill={cheekFill}
            style={{ opacity: look.cheekOpacity, transition: t }}
          />
          <Detail detail={v.detail} accent={v.accent} />
          <g ref={eyeLeftRef}>
            <Eye cx={EYE_LEFT_X} kind={look.eye} transition={t} />
          </g>
          <g ref={eyeRightRef}>
            <Eye cx={EYE_RIGHT_X} kind={look.eye} transition={t} />
          </g>
          <g ref={browLeftRef}>
            <line
              x1={EYE_LEFT_X - 9}
              x2={EYE_LEFT_X + 9}
              y1={BROW_Y}
              y2={BROW_Y}
              stroke={INK}
              strokeWidth={3.2}
              strokeLinecap="round"
              opacity={look.browOpacity}
              style={browStyle("left")}
            />
          </g>
          <g ref={browRightRef}>
            <line
              x1={EYE_RIGHT_X - 9}
              x2={EYE_RIGHT_X + 9}
              y1={BROW_Y}
              y2={BROW_Y}
              stroke={INK}
              strokeWidth={3.2}
              strokeLinecap="round"
              opacity={look.browOpacity}
              style={browStyle("right")}
            />
          </g>
          <path
            ref={mouthRef}
            d={mouthPath(look, 0)}
            fill={MOUTH_FILL}
            stroke={INK}
            strokeWidth={4.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}
