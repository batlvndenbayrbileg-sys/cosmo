"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { LOCATION_LABEL, type PainLocation } from "@/lib/pain";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { BODY_IMAGE, BODY_REGIONS, OFF_FIGURE, regionOf, type RegionShape } from "./regions";

/**
 * The large holographic body (public/visuals/body-front.png) with an SVG overlay of tappable places. Each place is a
 * button (keyboard and screen reader too, labelled in the screen's language); the place that hurts glows and pulses
 * (a static highlight with reduced motion), with a callout naming it. "Back" and "whole body" are buttons beside the
 * figure. A tap is reported to the caller, which says it to Cosmo as words.
 */

const CYAN = "#5FE3FF";
const RED = "#FF5A6E";

function Shape({ shape, ...rest }: { shape: RegionShape } & React.SVGProps<SVGEllipseElement & SVGPathElement>) {
  if (shape.kind === "ellipse") {
    return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...(rest as React.SVGProps<SVGEllipseElement>)} />;
  }
  return <path d={shape.d} {...(rest as React.SVGProps<SVGPathElement>)} />;
}

export function BodyPainMap({
  selected,
  urgent,
  onTap,
  reduced,
  className,
}: {
  selected: PainLocation | null;
  urgent: boolean;
  /** a place was tapped; absent: the map only shows */
  onTap?: (location: PainLocation) => void;
  reduced: boolean;
  className?: string;
}) {
  const { t, pick } = useI18n();
  const tone = urgent ? RED : CYAN;
  const region = regionOf(selected);
  const whole = selected === "whole_body";
  const back = selected === "back";

  const press = (location: PainLocation) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onTap?.(location);
    }
  };

  const glow = (key: string, shape: RegionShape, strong: boolean) => (
    <motion.g key={key} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
      <Shape shape={shape} fill={tone} fillOpacity={strong ? 0.32 : 0.16} stroke={tone} strokeWidth={3} filter="url(#pain-glow)" />
      {reduced ? null : (
        <motion.g
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: [0.85, 0, 0.85], scale: [1, 1.35, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <Shape shape={shape} fill="none" stroke={tone} strokeWidth={2.5} />
        </motion.g>
      )}
    </motion.g>
  );

  const labelText = selected ? pick(LOCATION_LABEL[selected]).toUpperCase() : "";
  const labelX = 512;
  const labelY = region ? Math.max(40, Math.min(980, region.anchor.y - 18)) : 0;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div
        className="relative w-full overflow-hidden rounded-[28px] ring-1 ring-cyan-300/25"
        style={{ aspectRatio: `${BODY_IMAGE.width} / ${BODY_IMAGE.height}` }}
      >
        <Image
          src={BODY_IMAGE.src}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 40vw"
          className="pointer-events-none object-contain select-none"
          loading="eager"
        />
        <svg
          viewBox={`0 0 ${BODY_IMAGE.width} ${BODY_IMAGE.height}`}
          className="absolute inset-0 size-full"
          role="group"
          aria-label={t("emergency.pain.mapAria")}
        >
          <defs>
            <filter id="pain-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* the highlight: the place said or tapped (the whole figure for "whole body", the torso outline for "back") */}
          <g pointerEvents="none" data-slot="pain-highlight" data-location={selected ?? ""}>
            {region ? region.shapes.map((s, i) => glow(`sel-${i}`, s, true)) : null}
            {whole
              ? BODY_REGIONS.filter((r) => r.location !== "joint" && r.location !== "eye" && r.location !== "ear" && r.location !== "tooth").flatMap((r) =>
                  r.shapes.map((s, i) => glow(`whole-${r.location}-${i}`, s, false)),
                )
              : null}
            {back ? (
              <path
                d="M262 200 L426 200 L436 470 L252 470 Z"
                fill={tone}
                fillOpacity={0.12}
                stroke={tone}
                strokeWidth={3}
                strokeDasharray="10 8"
                filter="url(#pain-glow)"
              />
            ) : null}
          </g>

          {/* the tappable places */}
          {BODY_REGIONS.map((r) => {
            const label = pick(LOCATION_LABEL[r.location]);
            const isSel = r.location === selected;
            return (
              <g
                key={r.location}
                role={onTap ? "button" : undefined}
                tabIndex={onTap ? 0 : undefined}
                aria-label={onTap ? t("emergency.pain.regionAria", { place: label }) : undefined}
                aria-pressed={onTap ? isSel : undefined}
                data-region={r.location}
                onClick={onTap ? () => onTap(r.location) : undefined}
                onKeyDown={onTap ? press(r.location) : undefined}
                className={cn(
                  "outline-none",
                  onTap ? "cursor-pointer [&:hover>*]:fill-cyan-300/20 [&:focus-visible>*]:fill-cyan-300/25 [&:focus-visible>*]:stroke-cyan-200" : "pointer-events-none",
                )}
              >
                {r.shapes.map((s, i) => (
                  <Shape key={i} shape={s} fill="transparent" stroke="transparent" strokeWidth={2} />
                ))}
              </g>
            );
          })}

          {/* the callout: a thin line from the place to its name */}
          {region && selected ? (
            <motion.g
              pointerEvents="none"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <circle cx={region.anchor.x} cy={region.anchor.y} r={5} fill={tone} />
              <polyline
                points={`${region.anchor.x},${region.anchor.y} ${labelX - 30},${labelY + 18} ${labelX},${labelY + 18}`}
                fill="none"
                stroke={tone}
                strokeWidth={2}
                strokeDasharray="4 5"
              />
              <rect x={labelX} y={labelY} width={164} height={36} rx={10} fill="rgba(6,16,38,0.82)" stroke={tone} strokeWidth={1.5} />
              <text
                x={labelX + 82}
                y={labelY + 24}
                textAnchor="middle"
                fontSize={16}
                fontWeight={600}
                letterSpacing="0.06em"
                fill="#E8FBFF"
                {...(labelText.length > 11 ? { textLength: 148, lengthAdjust: "spacingAndGlyphs" } : {})}
              >
                {labelText}
              </text>
            </motion.g>
          ) : null}
        </svg>
      </div>

      {/* places a front view cannot point at */}
      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={t("emergency.pain.otherPlaces")}>
        {OFF_FIGURE.map((location) => {
          const isSel = location === selected;
          return (
            <button
              key={location}
              type="button"
              data-region={location}
              disabled={!onTap}
              aria-pressed={isSel}
              onClick={() => onTap?.(location)}
              className={cn(
                "rounded-full border px-4 py-2 text-[13px] font-medium tracking-wide transition-colors outline-none focus-visible:ring-3 focus-visible:ring-cyan-300/60 disabled:cursor-default",
                isSel
                  ? urgent
                    ? "border-[#FF5A6E] bg-[#FF5A6E]/20 text-white"
                    : "border-cyan-300 bg-cyan-300/20 text-white"
                  : "border-cyan-300/30 bg-white/5 text-cyan-50/90 hover:bg-cyan-300/10",
              )}
            >
              {pick(LOCATION_LABEL[location])}
            </button>
          );
        })}
      </div>
    </div>
  );
}
