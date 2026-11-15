"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, Minus, Plus, X } from "lucide-react";
import type { AxisKey, DashboardPayload, Status } from "@/lib/types";
import { StatusGlyph, StatusPill, StatusShape } from "@/components/status";
import { statusWordKey } from "@/components/status/statusClasses";
import { useI18n } from "@/i18n/I18nProvider";
import { KPI_DEFS, formatValue } from "@/lib/kpi/registry";
import { NASA_HAZARDS } from "@/lib/nasa/hazards";
import { cn } from "@/lib/utils";
import { BODY_HOTSPOTS, axisHazard, axisIndicators, cycleAxis, worstAxis } from "./logic";
import { useDashboardAnimate } from "./motion";
import { AXIS_ICON, IconChip } from "./parts";

const FIG_RATIO = 1020 / 1536;
const ZOOM_IN = 1.75;
/** zoom origin when nothing is selected: the upper body */
const DEFAULT_ORIGIN = { x: 0.5, y: 0.26 };

const STATUS_RING: Record<Status, string> = {
  red: "var(--status-alert)",
  yellow: "var(--status-watch)",
  green: "var(--status-ok)",
  no_data: "var(--status-nodata)",
};

const ROUND =
  "inline-flex size-10 items-center justify-center rounded-full bg-white/90 text-[var(--cosmo-ink)] shadow-[0_6px_16px_-8px_rgba(40,80,160,0.45)] ring-1 ring-white outline-none backdrop-blur transition-[transform,box-shadow] hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/60 disabled:opacity-40 disabled:hover:translate-y-0";

/**
 * The hero: the porcelain body figure with a radial glow and a floor ring, one status hotspot per body axis
 * (shape + colour, worse ones pulse gently), a floating glass tooltip for the selected or hovered axis,
 * zoom buttons and ‹ › cycling.
 */
export function BodyHero({ payload }: { payload: DashboardPayload }) {
  const { t, lang, pick } = useI18n();
  const animate = useDashboardAnimate();
  const axes = useMemo(() => new Map(payload.axes.map((a) => [a.axis, a])), [payload.axes]);

  const initial = useMemo(() => {
    const worst = worstAxis(payload.axes);
    const s = worst ? axes.get(worst)?.status : null;
    return s === "yellow" || s === "red" ? worst : null;
  }, [payload.axes, axes]);

  const [active, setActive] = useState<AxisKey | null>(initial);
  const [hover, setHover] = useState<AxisKey | null>(null);
  const [zoom, setZoom] = useState(1);
  const shown = hover ?? active;

  const activeSpot = BODY_HOTSPOTS.find((h) => h.axis === (active ?? hover)) ?? null;
  const origin = activeSpot ?? DEFAULT_ORIGIN;

  useEffect(() => {
    if (shown === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(null);
        setHover(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  const spring = { type: "spring" as const, stiffness: 150, damping: 24 };

  // screen position of the shown hotspot after the zoom, in figure-width / stage-height units
  const tip = (() => {
    const spot = BODY_HOTSPOTS.find((h) => h.axis === shown);
    if (!spot) return null;
    const kx = origin.x - 0.5 + (spot.x - origin.x) * zoom;
    const ky = origin.y + (spot.y - origin.y) * zoom;
    const right = spot.x <= 0.52;
    const ty = ky < 0.3 ? "-12%" : ky > 0.62 ? "-88%" : "-50%";
    return {
      spot,
      style: {
        // beside the hotspot, but kept inside the stage so it never spills over the side columns
        "--tip-left": right
          ? `min(calc(100% - var(--tip-w)), calc(50% + ${kx.toFixed(4)} * var(--fig-w) + 26px))`
          : `max(var(--tip-w), calc(50% + ${kx.toFixed(4)} * var(--fig-w) - 26px))`,
        "--tip-top": `calc(${ky.toFixed(4)} * var(--stage-h))`,
        "--tip-tx": right ? "0%" : "-100%",
        "--tip-ty": ty,
      } as CSSProperties,
    };
  })();

  const shownAxis = shown ? axes.get(shown) : undefined;

  return (
    <section
      id="dashboard-body"
      data-slot="body-hero"
      aria-labelledby="body-title"
      className="relative flex flex-col items-center max-md:overflow-x-clip lg:h-full lg:[container-type:size]"
    >
      <h2 id="body-title" className="sr-only">
        {t("dashboard.body.title")}
      </h2>

      {/* phones: a viewport-based height; desktop: the cell's height (minus the hint line), never wider than the cell */}
      <div
        className="relative w-full [--stage-h:clamp(380px,62vh,620px)] [--tip-w:268px] lg:[--stage-h:min(calc(100cqh-1.75rem),calc(100cqw*1.5))] lg:[--tip-w:clamp(184px,15vw,268px)]"
        style={{ height: "var(--stage-h)", ["--fig-w" as string]: `calc(var(--stage-h) * ${FIG_RATIO.toFixed(4)})` }}
      >
        {/* glow + floor ring */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[6%] left-1/2 h-[82%] w-[min(120%,calc(var(--fig-w)*1.7))] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(150,190,255,0.55), rgba(190,214,255,0.28) 55%, rgba(230,239,255,0) 100%)",
            filter: "blur(6px)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[1.2%] left-1/2 h-[9%] w-[calc(var(--fig-w)*1.15)] -translate-x-1/2 rounded-[50%] border border-[rgba(79,134,247,0.35)]"
          style={{ background: "radial-gradient(closest-side, rgba(79,134,247,0.14), rgba(79,134,247,0) 80%)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[3.3%] left-1/2 h-[4%] w-[calc(var(--fig-w)*0.7)] -translate-x-1/2 rounded-[50%] border border-[rgba(79,134,247,0.22)]"
        />

        <div className="absolute inset-0 overflow-hidden rounded-[28px]">
          <motion.div
            role="group"
            aria-label={t("dashboard.body.figure")}
            className="absolute top-0 left-1/2 h-full -translate-x-1/2"
            style={{ width: "var(--fig-w)", transformOrigin: `${origin.x * 100}% ${origin.y * 100}%` }}
            initial={animate ? { opacity: 0, y: 18, scale: 0.97 } : false}
            animate={{ opacity: 1, y: 0, scale: zoom }}
            transition={spring}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- large transparent render, sized by the stage */}
            <img
              src="/body/body-figure.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none h-full w-full select-none"
              style={{ filter: "drop-shadow(0 18px 30px rgba(40,80,160,0.18))" }}
            />
            {/* a slow scanning light over the figure (none with reduced motion or a static render) */}
            {animate ? (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[40%]">
                <div
                  className="cosmo-sweep absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(79,134,247,0) 40%, rgba(79,134,247,0.14) 50%, rgba(79,134,247,0) 60%)",
                    animation: "cosmo-sweep 6.5s ease-in-out 1.6s infinite",
                  }}
                />
              </div>
            ) : null}
            {BODY_HOTSPOTS.map((spot) => {
              const a = axes.get(spot.axis);
              const status: Status = a?.status ?? "no_data";
              const isShown = shown === spot.axis;
              const pulse = status === "yellow" || status === "red";
              return (
                <button
                  key={spot.axis}
                  type="button"
                  data-axis={spot.axis}
                  data-status={status}
                  aria-pressed={active === spot.axis}
                  aria-label={t("dashboard.body.hotspot", {
                    axis: t(`dashboard.axis.${spot.axis}`),
                    status: t(statusWordKey(status)),
                  })}
                  onClick={() => setActive((cur) => (cur === spot.axis ? null : spot.axis))}
                  onMouseEnter={() => setHover(spot.axis)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(spot.axis)}
                  onBlur={() => setHover(null)}
                  className="group absolute flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
                  style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
                >
                  <motion.span
                    className="relative flex items-center justify-center"
                    animate={{ scale: 1 / zoom }}
                    transition={spring}
                  >
                    {pulse ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: STATUS_RING[status],
                          animation: `cosmo-pulse ${status === "red" ? 1.8 : 2.6}s cubic-bezier(0.2,0.6,0.3,1) infinite`,
                        }}
                      />
                    ) : null}
                    <span
                      className={cn(
                        "relative flex size-[24px] items-center justify-center rounded-full bg-white shadow-[0_4px_12px_-4px_rgba(15,27,45,0.45)] ring-[3px] transition-[box-shadow,transform] duration-200 group-hover:scale-110 group-focus-visible:ring-[var(--cosmo-accent)]",
                        isShown ? "scale-110 ring-[var(--cosmo-accent)]" : "ring-white/80",
                      )}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
                        <StatusShape status={status} cx={7} cy={7.3} r={status === "no_data" ? 5.2 : 4.6} />
                      </svg>
                    </span>
                  </motion.span>
                </button>
              );
            })}
          </motion.div>
        </div>

        {/* floating glass tooltip (in flow under the figure on phones) */}
        {tip && shownAxis ? (
          <div
            role="group"
            aria-labelledby="body-tip-desktop"
            data-slot="body-tooltip"
            style={tip.style}
            className="z-30 hidden w-[var(--tip-w)] md:absolute md:block md:[top:var(--tip-top)] md:[left:var(--tip-left)] md:[transform:translate(var(--tip-tx),var(--tip-ty))] md:transition-[left,top] md:duration-300"
          >
            {tooltipCard(shownAxis.axis, 'body-tip-desktop', () => {
              setActive(null);
              setHover(null);
            })}
          </div>
        ) : null}

        {/* controls */}
        <div className="absolute bottom-3 left-2 flex flex-col gap-2">
          <button
            type="button"
            className={ROUND}
            aria-label={t("dashboard.body.zoomIn")}
            disabled={zoom > 1}
            onClick={() => setZoom(ZOOM_IN)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            className={ROUND}
            aria-label={t("dashboard.body.zoomOut")}
            disabled={zoom === 1}
            onClick={() => setZoom(1)}
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/60 p-1 ring-1 ring-white/80 backdrop-blur">
          <button
            type="button"
            className={cn(ROUND, "size-8")}
            aria-label={t("dashboard.body.prev")}
            onClick={() => setActive((cur) => cycleAxis(cur, -1))}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <span aria-live="polite" className="min-w-24 px-1 text-center text-[12px] font-medium text-[var(--cosmo-ink)]">
            {active ? t(`dashboard.axis.${active}`) : t("dashboard.body.title")}
          </span>
          <button
            type="button"
            className={cn(ROUND, "size-8")}
            aria-label={t("dashboard.body.next")}
            onClick={() => setActive((cur) => cycleAxis(cur, 1))}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      {/* phones: the tooltip card sits under the figure */}
      {shownAxis ? (
        <div className="mt-3 w-full md:hidden">
          {tooltipCard(shownAxis.axis, 'body-tip-phone', () => setActive(null))}
        </div>
      ) : (
        <p className="mt-2 text-center text-[12px] leading-[1.1rem] text-[var(--cosmo-label)]">{t("dashboard.body.hint")}</p>
      )}
    </section>
  );

  function tooltipCard(axis: AxisKey, idBase: string, onClose: () => void) {
    const a = axes.get(axis);
    if (!a) return null;
    const hazard = axisHazard(axis);
    const info = hazard ? NASA_HAZARDS[hazard] : null;
    const readings = axisIndicators(axis, payload.kpis, 3);
    return (
      <div className="flex flex-col gap-3 rounded-[22px] border border-white/90 bg-white/80 p-4 lg:gap-2.5 lg:p-[clamp(12px,1.6vh,16px)] shadow-[0_24px_50px_-20px_rgba(40,80,160,0.45)] backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <IconChip icon={AXIS_ICON[axis]} size={32} />
          <h3 id={idBase} className="min-w-0 flex-1 text-[16px] leading-tight font-medium text-[var(--cosmo-ink)]">
            {t(`dashboard.axis.${axis}`)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("dashboard.body.close")}
            className="inline-flex size-7 items-center justify-center rounded-full text-[var(--cosmo-label)] outline-none hover:bg-black/5 focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="flex items-end justify-between gap-2">
          {a.score === null ? (
            <span className="text-[14px] text-[var(--cosmo-label)]">{t("dashboard.body.noScore")}</span>
          ) : (
            <span className="flex flex-col">
              <span className="flex items-baseline gap-1">
                <span className="tnum text-[32px] leading-none font-normal text-[var(--cosmo-ink)] lg:text-[clamp(24px,3.4vh,32px)]">
                  {Math.round(a.score)}
                </span>
                <span className="text-[11px] text-[var(--cosmo-label)]">/100</span>
              </span>
              {a.baseline !== null ? (
                <span className="tnum mt-1 text-[12px] text-[var(--cosmo-label)]">
                  {t("dashboard.body.usual", { usual: Math.round(a.baseline) })}
                </span>
              ) : null}
            </span>
          )}
          <StatusPill status={a.status} size="sm" />
        </div>
        {readings.length > 0 ? (
          <ul aria-label={t("dashboard.body.readings")} className="flex flex-col gap-1.5 border-t border-[var(--cosmo-hairline)] pt-2.5">
            {readings.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 text-[var(--cosmo-label)]">{KPI_DEFS[r.key].labels[lang]}</span>
                <span className="flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap text-[var(--cosmo-ink)]">
                  <span className="tnum">{r.value === null ? "–" : formatValue(r.key, r.value, lang)}</span>
                  <StatusGlyph status={r.status} size={12} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {info ? (
          <a
            href={info.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 self-start rounded-full bg-[var(--cosmo-pastel-blue)] px-2.5 py-1 text-[12px] font-medium text-[var(--cosmo-accent-deep)] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <span className="sr-only">{t("dashboard.body.hazard")}: </span>
            {pick(info.name)}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : null}
      </div>
    );
  }
}
