"use client";

/**
 * ImageCosmo: the team's own Cosmo render (public/mascot/*.png) as the body, with a drawn, animated
 * face on the black visor.
 *
 * The renders are flat pictures with one baked-in smile, so this component:
 *  1. shows the render (front pose for greeting / talking / happy, three-quarter for the rest);
 *  2. paints a dark patch over the two baked-in eyes (colour, position and outline were measured
 *     from the picture, see mascot-poses.ts) and draws its own eyes with the same cyan-to-violet
 *     gradient and glow, plus a small glowing mouth while talking;
 *  3. adds CSS-free SVG glow overlays on the ear rings (pulse while listening) and the collar
 *     (slow pulse while thinking), and a gentle float / breath / tilt of the whole body;
 *  4. rotates the hue of the neon parts per crew variant (the white body stays white).
 *
 * Everything lives in ONE SVG whose viewBox is the pixel size of the render, so the picture and the
 * face can never drift apart whatever size the avatar is drawn at.
 *
 * Performance: everything that changes every frame is written straight to SVG attributes from one
 * requestAnimationFrame loop (like PlaceholderCosmo), React only re-renders for state / emotion /
 * variant / pose changes. None of the loop-driven attributes is a React prop, so a re-render never
 * overwrites an animated value.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MOUTH_SMOOTHING, mouthOpenFromAmplitude, smoothAmplitude } from "./amplitude";
import { BLINK_DURATION_MS, blinkClosure, nextBlinkDelay } from "./blink";
import { describeCosmo } from "./face";
import {
  breathScale,
  browPath,
  collarGlowTarget,
  earGlowTarget,
  eyeParamsFor,
  eyePath,
  eyeTransform,
  floatOffset,
  glowMouthPath,
  lerpEye,
  lerpMouth,
  mascotNeon,
  mouthLookFor,
  nextDisplayedPose,
  resolvePoseChoice,
  tiltTargetFor,
  type EyeParams,
} from "./image-face";
import {
  MASCOT_POSE_IDS,
  MASCOT_POSES,
  mascotPose,
  outlinePoints,
  poseGeometry,
  type MascotPoseChoice,
  type MascotPoseId,
} from "./mascot-poses";
import type { CosmoEmotion, CosmoProps, CosmoState } from "./types";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface ImageCosmoProps extends CosmoProps {
  /** draw the animated face and glow overlays; false = the render as it is (body motion only) */
  face?: boolean;
  /** `auto` (default) follows state / emotion */
  pose?: MascotPoseChoice;
  /** draws the measured geometry (visor outline, eye boxes, rings, collar) over the picture */
  debug?: boolean;
  /** a render could not be loaded: the caller falls back to the placeholder */
  onLoadError?: () => void;
}

interface Live {
  state: CosmoState;
  emotion: CosmoEmotion;
  amplitude: number;
  reduced: boolean;
  poseChoice: MascotPoseChoice;
}

const IMG_W = 822;
const IMG_H = 900;
/** the soles of the feet; breathing and tilt pivot here */
const PIVOT_Y = IMG_H * 0.95;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** attribute writes cached per element, so unchanged values cost nothing and new elements are always written */
class AttrWriter {
  private cache = new Map<string, { el: Element; value: string }>();
  put(key: string, el: Element | null, attr: string, value: string) {
    if (!el) return;
    const hit = this.cache.get(key);
    if (hit && hit.el === el && hit.value === value) return;
    this.cache.set(key, { el, value });
    el.setAttribute(attr, value);
  }
}

export function ImageCosmo({
  variant,
  state,
  emotion,
  amplitude,
  size,
  className,
  label,
  face = true,
  pose: poseChoice = "auto",
  debug = false,
  onLoadError,
}: ImageCosmoProps) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [displayPose, setDisplayPose] = useState<MascotPoseId>(() => resolvePoseChoice(poseChoice, state, emotion));
  const pose = mascotPose(displayPose);
  const geo = useMemo(() => poseGeometry(pose), [pose]);
  const neon = mascotNeon(variant, pose);

  const live = useRef<Live>({ state, emotion, amplitude, reduced, poseChoice });
  const geoRef = useRef(geo);
  const initialPose = useRef(displayPose);
  const callbacks = useRef({ onLoadError });
  useEffect(() => {
    live.current = { state, emotion, amplitude, reduced, poseChoice };
    geoRef.current = geo;
    callbacks.current = { onLoadError };
  });

  const bodyRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const fadeRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const mouthGroupRef = useRef<SVGGElement>(null);
  const mouthPathRef = useRef<SVGPathElement>(null);
  const eyeGroupRefs = useRef<(SVGGElement | null)[]>([null, null]);
  const eyeCoreRefs = useRef<(SVGPathElement | null)[]>([null, null]);
  const eyeGlowRefs = useRef<(SVGPathElement | null)[]>([null, null]);
  const browGroupRefs = useRef<(SVGGElement | null)[]>([null, null]);
  const earRefs = useRef<(SVGGElement | null)[]>([null, null]);
  const collarRef = useRef<SVGGElement>(null);
  const eyeGradRefs = useRef<(SVGLinearGradientElement | null)[]>([null, null]);

  // Fetch both renders up front (so a pose change never pops in) and report a failure once.
  useEffect(() => {
    let alive = true;
    const images = MASCOT_POSE_IDS.map((id) => {
      const img = new window.Image();
      img.onerror = () => {
        if (alive) callbacks.current.onLoadError?.();
      };
      img.src = MASCOT_POSES[id].src;
      return img;
    });
    return () => {
      alive = false;
      for (const img of images) img.onerror = null;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    let last = start;
    const w = new AttrWriter();

    const first = live.current;
    let eyeP: EyeParams = eyeParamsFor(first.state, first.emotion);
    let mouthLook = mouthLookFor(first.emotion);
    let mouthOpen = 0;
    let mouthVis = 0;
    let tilt = 0;
    let earGlow = 0;
    let collarGlow = 0;
    let fade = 1;
    let displayed = initialPose.current;
    let lastSwitch = start;
    let switching: MascotPoseId | null = null;
    let blinkStart = Number.NEGATIVE_INFINITY;
    let nextBlinkAt = start + nextBlinkDelay();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(Math.max(now - last, 0), 100);
      last = now;
      const t = now - start;
      const cur = live.current;
      const g = geoRef.current;

      // ---- which render: switch with a short dip, never faster than the minimum dwell
      const want = resolvePoseChoice(cur.poseChoice, cur.state, cur.emotion);
      if (switching === null) {
        const next = nextDisplayedPose(displayed, want, cur.poseChoice === "auto" ? now - lastSwitch : Infinity);
        if (next !== displayed) switching = next;
      }
      const fadeTarget = switching === null ? 1 : 0;
      fade = cur.reduced ? fadeTarget : smoothAmplitude(fade, fadeTarget, dt, { attackMs: 55, releaseMs: 55 });
      if (switching !== null && fade < 0.06) {
        displayed = switching;
        lastSwitch = now;
        switching = null;
        setDisplayPose(displayed);
      }
      w.put("fade", fadeRef.current, "opacity", r2(fade).toString());

      // ---- body: float, breath (idle), attentive tilt (listening); all still with reduced motion
      const tiltTarget = tiltTargetFor(cur.state);
      tilt = cur.reduced ? tiltTarget : smoothAmplitude(tilt, tiltTarget, dt, { attackMs: 220, releaseMs: 220 });
      const dy = floatOffset(t, cur.reduced);
      const breath = breathScale(t, cur.state, cur.reduced);
      w.put(
        "body",
        bodyRef.current,
        "transform",
        `translate(0 ${r2(dy)}) rotate(${r2(tilt)} ${IMG_W / 2} ${PIVOT_Y}) ` +
          `translate(${IMG_W / 2} ${PIVOT_Y}) scale(1 ${r2(breath)}) translate(${-IMG_W / 2} ${-PIVOT_Y})`,
      );
      const lift = Math.min(1, Math.max(0, -dy / 4));
      w.put("shadow", shadowRef.current, "opacity", r2(0.14 - 0.05 * lift).toString());

      const faceEl = faceRef.current;
      if (faceEl) {
        // ---- eyes: blend toward the target shape, blink every 2.5 to 6 s (none with reduced motion)
        eyeP = lerpEye(eyeP, eyeParamsFor(cur.state, cur.emotion), 1 - Math.exp(-dt / 110));
        let closure = 0;
        if (!cur.reduced) {
          if (now >= nextBlinkAt) {
            blinkStart = now;
            nextBlinkAt = now + BLINK_DURATION_MS + nextBlinkDelay();
          }
          closure = blinkClosure(now - blinkStart);
        }
        for (const i of [0, 1] as const) {
          const e = g.eyes[i];
          const side = i === 0 ? -1 : 1;
          const d = eyePath(eyeP, e.u);
          const sw = r2(eyeP.strokeW * e.u).toString();
          w.put(`eg${i}`, eyeGroupRefs.current[i], "transform", eyeTransform(e.cx, e.cy, e.u, eyeP, side, closure));
          w.put(`ed${i}`, eyeCoreRefs.current[i], "d", d);
          w.put(`es${i}`, eyeCoreRefs.current[i], "stroke-width", sw);
          w.put(`gd${i}`, eyeGlowRefs.current[i], "d", d);
          w.put(`gs${i}`, eyeGlowRefs.current[i], "stroke-width", r2(eyeP.strokeW * e.u * 1.35).toString());
          w.put(
            `bt${i}`,
            browGroupRefs.current[i],
            "transform",
            eyeTransform(e.cx, e.cy, e.u, { ...eyeP, scaleY: 1 }, side, 0),
          );
          w.put(`bo${i}`, browGroupRefs.current[i], "opacity", r2(eyeP.browOpacity).toString());
        }

        // ---- mouth: opening follows the amplitude (small deadzone, quick attack, slower release)
        mouthOpen = smoothAmplitude(mouthOpen, mouthOpenFromAmplitude(cur.amplitude), dt, MOUTH_SMOOTHING);
        mouthLook = lerpMouth(mouthLook, mouthLookFor(cur.emotion), 1 - Math.exp(-dt / 140));
        const mouthTarget = cur.state === "talking" || mouthOpen > 0.02 ? 1 : 0;
        mouthVis = smoothAmplitude(mouthVis, mouthTarget, dt, { attackMs: 90, releaseMs: 160 });
        w.put("mo", mouthGroupRef.current, "opacity", r2(mouthVis).toString());
        w.put("mt", mouthGroupRef.current, "transform", `translate(${r2(g.mouth.cx)} ${r2(g.mouth.cy)})`);
        w.put("md", mouthPathRef.current, "d", glowMouthPath(mouthLook, mouthOpen, g.mouth.u));
        w.put("mf", mouthPathRef.current, "fill-opacity", r2(Math.min(0.3, mouthOpen * 0.6)).toString());

        // ---- glows: ear rings pulse while listening, collar pulses while thinking
        earGlow = smoothAmplitude(earGlow, earGlowTarget(cur.state, cur.reduced, t), dt, { attackMs: 160, releaseMs: 240 });
        collarGlow = smoothAmplitude(collarGlow, collarGlowTarget(cur.state, cur.reduced, t), dt, {
          attackMs: 220,
          releaseMs: 320,
        });
        for (const i of [0, 1] as const) w.put(`ear${i}`, earRefs.current[i], "opacity", r2(earGlow).toString());
        w.put("collar", collarRef.current, "opacity", r2(collarGlow).toString());

        // reveal once the first frame has written the face (until then the render's own smile shows)
        faceEl.style.opacity = "1";
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const id = (name: string) => `${uid}${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const u = geo.mouth.u;
  const hue = neon.hueDeg;
  const eyeUnits = geo.eyes;
  const ringStroke = (r: { rx: number; ry: number }) => Math.max(3, Math.min(r.rx, r.ry) * 0.42);

  return (
    <svg
      viewBox={`0 0 ${IMG_W} ${IMG_H}`}
      role="img"
      aria-label={label ?? describeCosmo(state, emotion)}
      focusable="false"
      className={["block shrink-0 select-none", className].filter(Boolean).join(" ")}
      style={{ width: size ?? "100%", height: size ?? "100%", pointerEvents: "none", overflow: "visible" }}
    >
      <defs>
        {/* soft edge: the patch over the baked-in eyes and the hue mask */}
        {face || hue !== 0 ? (
          <filter id={id("soft")} x="-30%" y="-40%" width="160%" height="180%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        ) : null}
        {hue !== 0 ? (
          <>
            <filter id={id("hue")} colorInterpolationFilters="sRGB">
              <feColorMatrix type="hueRotate" values={String(hue)} />
            </filter>
            <mask id={id("neonMask")} maskUnits="userSpaceOnUse" x="0" y="0" width={IMG_W} height={IMG_H}>
              <g fill="#fff" filter={url("soft")}>
                {geo.neonBoxes.map((b, i) => (
                  <rect key={i} x={b.x - 14} y={b.y - 14} width={b.w + 28} height={b.h + 28} rx={20} />
                ))}
              </g>
            </mask>
          </>
        ) : null}
        {face ? (
          <>
            <clipPath id={id("visor")}>
              <polygon points={outlinePoints(pose, 1.5)} />
            </clipPath>
            {/* glow blurs: regions in user space, because the bounding box of a short stroke (an oval eye,
                the collar curve) is far smaller than the glow around it */}
            {eyeUnits.map((e, i) => (
              <filter
                key={i}
                id={id(`eyeGlow${i}`)}
                filterUnits="userSpaceOnUse"
                x={-e.u}
                y={-e.u}
                width={2 * e.u}
                height={2 * e.u}
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur stdDeviation="7" />
              </filter>
            ))}
            <filter
              id={id("glow")}
              filterUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={IMG_W}
              height={IMG_H}
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="7" />
            </filter>
            {eyeUnits.map((e, i) => (
              <linearGradient
                key={i}
                id={id(`eye${i}`)}
                gradientUnits="userSpaceOnUse"
                x1={-e.u / 2}
                x2={e.u / 2}
                y1="0"
                y2="0"
                ref={(el) => {
                  eyeGradRefs.current[i] = el;
                }}
              >
                <stop offset="0" stopColor={neon.eyes[i].from} />
                <stop offset="1" stopColor={neon.eyes[i].to} />
              </linearGradient>
            ))}
            <linearGradient
              id={id("glass")}
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="0"
              y1={pose.visor.glass[0].y * IMG_H}
              y2={pose.visor.glass[2].y * IMG_H}
            >
              <stop offset="0" stopColor={pose.visor.glass[0].color} />
              <stop
                offset={
                  (pose.visor.glass[1].y - pose.visor.glass[0].y) / (pose.visor.glass[2].y - pose.visor.glass[0].y)
                }
                stopColor={pose.visor.glass[1].color}
              />
              <stop offset="1" stopColor={pose.visor.glass[2].color} />
            </linearGradient>
            <linearGradient id={id("mouth")} gradientUnits="userSpaceOnUse" x1={-0.28 * u} x2={0.28 * u} y1="0" y2="0">
              <stop offset="0" stopColor={neon.mouth.from} />
              <stop offset="1" stopColor={neon.mouth.to} />
            </linearGradient>
          </>
        ) : null}
      </defs>

      <ellipse
        ref={shadowRef}
        cx={IMG_W / 2}
        cy={IMG_H * 0.958}
        rx={IMG_W * 0.27}
        ry={IMG_H * 0.017}
        fill="#1F2A3C"
        opacity={0.14}
      />

      <g ref={bodyRef}>
        <g ref={fadeRef}>
          <image href={pose.src} x="0" y="0" width={IMG_W} height={IMG_H} aria-hidden="true" />
          {hue !== 0 ? (
            <image
              href={pose.src}
              x="0"
              y="0"
              width={IMG_W}
              height={IMG_H}
              filter={url("hue")}
              mask={url("neonMask")}
              aria-hidden="true"
            />
          ) : null}

          {face ? (
            <>
              {/* visor: patch over the baked-in eyes, then our own eyes and mouth, all clipped to the glass */}
              <g clipPath={url("visor")}>
                <g ref={faceRef} style={{ opacity: 0 }}>
                  <g fill={url("glass")} filter={url("soft")}>
                    {geo.patches.map((p, i) => (
                      <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} />
                    ))}
                  </g>
                  {eyeUnits.map((e, i) => (
                    <g key={i}>
                      <g
                        ref={(el) => {
                          eyeGroupRefs.current[i] = el;
                        }}
                      >
                        <path
                          ref={(el) => {
                            eyeGlowRefs.current[i] = el;
                          }}
                          fill="none"
                          stroke={url(`eye${i}`)}
                          strokeLinecap="round"
                          opacity={0.9}
                          filter={url(`eyeGlow${i}`)}
                        />
                        <path
                          ref={(el) => {
                            eyeCoreRefs.current[i] = el;
                          }}
                          fill="none"
                          stroke={url(`eye${i}`)}
                          strokeLinecap="round"
                        />
                      </g>
                      <g
                        ref={(el) => {
                          browGroupRefs.current[i] = el;
                        }}
                        opacity={0}
                      >
                        <path
                          d={browPath(e.u)}
                          fill="none"
                          stroke={url(`eye${i}`)}
                          strokeWidth={0.075 * e.u}
                          strokeLinecap="round"
                        />
                      </g>
                    </g>
                  ))}
                  <g ref={mouthGroupRef} opacity={0}>
                    <path
                      ref={mouthPathRef}
                      fill={url("mouth")}
                      fillOpacity={0}
                      stroke={url("mouth")}
                      strokeWidth={0.09 * u}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                </g>
              </g>

              {/* ear rings and collar: additive glow overlays */}
              <g style={{ mixBlendMode: "screen" }}>
                {geo.ears.map((r, i) =>
                  r ? (
                    <g
                      key={i}
                      ref={(el) => {
                        earRefs.current[i] = el;
                      }}
                      opacity={0}
                    >
                      <ellipse
                        cx={r.cx}
                        cy={r.cy}
                        rx={r.rx}
                        ry={r.ry}
                        fill="none"
                        stroke={neon.ear}
                        strokeWidth={ringStroke(r) * 1.6}
                        filter={url("glow")}
                      />
                      <ellipse
                        cx={r.cx}
                        cy={r.cy}
                        rx={r.rx}
                        ry={r.ry}
                        fill="none"
                        stroke="#FFFFFF"
                        strokeOpacity={0.55}
                        strokeWidth={ringStroke(r) * 0.5}
                      />
                    </g>
                  ) : null,
                )}
                <g ref={collarRef} opacity={0}>
                  <path
                    d={geo.collar.d}
                    fill="none"
                    stroke={neon.collar}
                    strokeWidth={geo.collar.strokeW * 2}
                    strokeLinecap="round"
                    filter={url("glow")}
                  />
                  <path
                    d={geo.collar.d}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeOpacity={0.5}
                    strokeWidth={geo.collar.strokeW * 0.6}
                    strokeLinecap="round"
                  />
                </g>
              </g>
            </>
          ) : null}

          {debug ? (
            <g fill="none" strokeWidth={1.5} data-debug="geometry">
              <polygon points={outlinePoints(pose)} stroke="#00FF66" />
              <ellipse
                cx={pose.visor.cx * IMG_W}
                cy={pose.visor.cy * IMG_H}
                rx={pose.visor.rx * IMG_W}
                ry={pose.visor.ry * IMG_H}
                transform={`rotate(${pose.visor.rotationDeg} ${pose.visor.cx * IMG_W} ${pose.visor.cy * IMG_H})`}
                stroke="#FFD400"
                strokeDasharray="6 4"
              />
              {geo.eyes.map((e, i) => (
                <rect key={i} x={e.cx - e.w / 2} y={e.cy - e.h / 2} width={e.w} height={e.h} stroke="#FF3B30" />
              ))}
              {geo.patches.map((p, i) => (
                <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} stroke="#FF9500" strokeDasharray="3 3" />
              ))}
              {geo.ears.map((r, i) =>
                r ? <ellipse key={i} cx={r.cx} cy={r.cy} rx={r.rx} ry={r.ry} stroke="#FF00FF" /> : null,
              )}
              <path d={geo.collar.d} stroke="#00E5FF" />
              {geo.neonBoxes.map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} stroke="#FFFFFF" strokeOpacity={0.6} />
              ))}
              <circle cx={geo.mouth.cx} cy={geo.mouth.cy} r={4} stroke="#FF3B30" />
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  );
}
