"use client";

import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { IconChip } from "@/components/dashboard/parts";
import { useI18n } from "@/i18n/I18nProvider";
import { T_HIGH, T_LOW, TIMEPOINT_DAY } from "@/lib/signature/config";
import type { PanelResult, Timepoint } from "@/lib/signature/types";
import { cn } from "@/lib/utils";
import {
  FRI_MAX,
  classLabel,
  classTone,
  formatFri,
  noiseCaption,
  noiseStrip,
  reasonText,
  trackPct,
  triageTrack,
  type BadgeTone,
  type ZoneTone,
} from "./logic";

/** light clinical tints for the 0-100 track (spec section 7.2: slate, amber, teal / red) */
const ZONE_BG: Record<ZoneTone, string> = {
  slate: "bg-[#e7ebf1]",
  amber: "bg-[var(--status-watch-soft)]",
  teal: "bg-[#d7f0ec]",
  red: "bg-[var(--status-alert-soft)]",
};

export const BADGE_TONE: Record<BadgeTone, string> = {
  teal: "border-[#9fd8cf] bg-[#e6f6f3] text-[#0f6b62]",
  red: "border-[#f0b7b7] bg-[var(--status-alert-soft)] text-[var(--status-alert-ink)]",
  amber: "border-[#ecd3a1] bg-[var(--status-watch-soft)] text-[var(--status-watch-ink)]",
  slate: "border-[#d5dbe4] bg-[var(--status-nodata-soft)] text-[var(--status-nodata-ink)]",
};

/** the 12 no-flight control scores as a strip plot on the same 0-100 scale */
function NoiseStripPlot() {
  const { t, lang } = useI18n();
  const strip = noiseStrip();
  const W = 260;
  const H = 44;
  const x = (v: number) => 8 + (trackPct(v) / 100) * (W - 16);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-medium text-[var(--aegis-ink)]">{t("dashboard.signature.sure.title")}</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-11 w-full"
        role="img"
        aria-label={t("dashboard.signature.sure.strip", { list: strip.dots.join(", ") })}
      >
        <rect x={x(0)} y={14} width={x(T_LOW) - x(0)} height={16} rx={3} fill="#e7ebf1" />
        <rect x={x(T_LOW)} y={14} width={x(T_HIGH) - x(T_LOW)} height={16} fill="var(--status-watch-soft)" />
        <rect x={x(T_HIGH)} y={14} width={x(FRI_MAX) - x(T_HIGH)} height={16} rx={3} fill="#f3f6fa" />
        {strip.dots.map((d, i) => (
          <circle key={i} data-control={d} cx={x(d)} cy={22} r={4} fill="var(--aegis-ink)" fillOpacity={0.55} stroke="white" strokeWidth={1} />
        ))}
        {[0, T_LOW, T_HIGH, FRI_MAX].map((v) => (
          <text key={v} x={x(v)} y={42} textAnchor="middle" fontSize={9} fill="#5b6678">
            {v}
          </text>
        ))}
      </svg>
      <p className="text-[12px] leading-snug text-[var(--aegis-label)]">
        {t("dashboard.signature.sure.body", { n: strip.n, median: strip.median, max: strip.max })}
      </p>
      <p className="text-[12px] font-medium leading-snug text-[var(--aegis-ink)]">{noiseCaption(strip, lang)}</p>
    </div>
  );
}

/**
 * Triage card (spec section 7.2 item 1): a 0-100 track with three zones, a dot at the Flight Response Index and a
 * whisker for its band; class badge (+ "borderline"), one-line reason, panel day, the "How sure are we?" popover with
 * the 12 no-flight controls, and the timepoint selector that switches the panel for every card.
 */
export function TriageCard({
  panel,
  timepoints,
  onTimepoint,
}: {
  panel: PanelResult;
  timepoints: readonly Timepoint[];
  onTimepoint: (tp: Timepoint) => void;
}) {
  const { t, lang } = useI18n();
  const track = triageTrack(panel);
  const strip = noiseStrip();
  const cls = classLabel(panel.cls, lang);

  return (
    <section
      aria-labelledby="sig-triage-title"
      data-slot="signature-triage"
      data-fri={track.fri === null ? "" : formatFri(track.fri)}
      className="glass-card flex min-w-0 flex-col gap-4 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center gap-2.5">
        <IconChip icon={Gauge} size={32} />
        <h2 id="sig-triage-title" className="text-[17px] leading-tight font-medium text-[var(--aegis-ink)]">
          {t("dashboard.signature.triage.title")}
        </h2>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("h-6 px-2.5 text-[12px]", BADGE_TONE[classTone(panel.cls)])}>
            {cls}
          </Badge>
          {panel.borderline ? (
            <Badge variant="outline" className={cn("h-6 px-2.5 text-[12px]", BADGE_TONE.amber)}>
              {t("dashboard.signature.borderline")}
            </Badge>
          ) : null}
        </span>
      </header>

      <div className="flex flex-col gap-1">
        <span className="unit-label">{t("dashboard.signature.triage.index")}</span>
        {track.friLabel !== null && track.bandLabel ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="num-xl">{track.friLabel}</span>
            <span className="text-[13px] text-[var(--aegis-label)]">{t("dashboard.signature.triage.outOf", { max: FRI_MAX })}</span>
            <span className="text-[13px] text-[var(--aegis-label)]">
              {t("dashboard.signature.triage.range", { lo: track.bandLabel[0], hi: track.bandLabel[1] })}
            </span>
          </p>
        ) : (
          <p className="text-[14px] text-[var(--aegis-label)]">{t("dashboard.signature.triage.none")}</p>
        )}
      </div>

      <div
        role="img"
        aria-label={
          track.friLabel !== null && track.bandLabel
            ? t("dashboard.signature.triage.aria", { fri: track.friLabel, max: FRI_MAX, lo: track.bandLabel[0], hi: track.bandLabel[1], cls })
            : t("dashboard.signature.triage.none")
        }
        className="flex flex-col gap-1.5"
      >
        <div className="relative h-7">
          <div className="absolute inset-x-0 top-2 h-3 overflow-hidden rounded-full ring-1 ring-[var(--aegis-hairline)]">
            {track.zones.map((z) => (
              <span
                key={z.from}
                className={cn("absolute inset-y-0", ZONE_BG[z.tone])}
                style={{ left: `${trackPct(z.from)}%`, width: `${trackPct(z.to) - trackPct(z.from)}%` }}
              />
            ))}
          </div>
          {track.band ? (
            <span
              aria-hidden="true"
              data-slot="signature-whisker"
              className="absolute top-[13px] h-[2px] bg-[var(--aegis-ink)]/70 transition-[left,width] duration-500"
              style={{ left: `${trackPct(track.band[0])}%`, width: `${Math.max(trackPct(track.band[1]) - trackPct(track.band[0]), 0.5)}%` }}
            >
              <span className="absolute -top-[5px] left-0 h-3 w-[2px] bg-[var(--aegis-ink)]/70" />
              <span className="absolute -top-[5px] right-0 h-3 w-[2px] bg-[var(--aegis-ink)]/70" />
            </span>
          ) : null}
          {track.fri !== null ? (
            <span
              aria-hidden="true"
              data-slot="signature-dot"
              className="absolute top-[7px] size-[14px] -translate-x-1/2 rounded-full bg-[var(--aegis-ink)] ring-[3px] ring-white shadow transition-[left] duration-500"
              style={{ left: `${trackPct(track.fri)}%` }}
            />
          ) : null}
        </div>
        <div aria-hidden="true" className="relative h-4 text-[10px] text-[var(--aegis-label)]">
          {track.ticks.map((v) => (
            <span key={v} className="absolute -translate-x-1/2 tnum" style={{ left: `${trackPct(v)}%` }}>
              {v}
            </span>
          ))}
        </div>
        <div aria-hidden="true" className="hidden grid-cols-[20fr_20fr_60fr] gap-x-1 text-[10px] leading-tight text-[var(--aegis-label)] sm:grid">
          <span>{t("dashboard.signature.triage.zone.low")}</span>
          <span>{t("dashboard.signature.triage.zone.mid")}</span>
          <span>{t("dashboard.signature.triage.zone.high")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="text-[14px] text-[var(--aegis-ink)]">{reasonText(panel, lang)}</p>
        <p className="text-[12px] text-[var(--aegis-label)]">
          {t("dashboard.signature.triage.panel", { tp: panel.timepoint, day: panel.missionDay })}
        </p>
        <p className="text-[11px] text-[var(--aegis-label)]">{t("dashboard.signature.source", { crew: panel.crew })}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          aria-label={t("dashboard.signature.tpLabel")}
          value={[panel.timepoint]}
          onValueChange={(v) => {
            const next = v[0] as Timepoint | undefined;
            if (next) onTimepoint(next);
          }}
          spacing={1}
          className="rounded-full bg-[rgba(15,27,45,0.05)] p-1"
        >
          {timepoints.map((tp) => (
            <ToggleGroupItem
              key={tp}
              value={tp}
              aria-label={t("dashboard.signature.tpAria", { tp, day: TIMEPOINT_DAY[tp] })}
              className="h-8 rounded-full px-3 text-[13px] text-[var(--aegis-label)] aria-pressed:bg-white aria-pressed:text-[var(--aegis-ink)] aria-pressed:shadow-sm"
            >
              {tp}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Popover>
          <PopoverTrigger className="text-[13px] font-medium text-[var(--aegis-accent-deep)] underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/60 rounded">
            {t("dashboard.signature.sure.button")}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] rounded-[18px] bg-white/95 p-3">
            <NoiseStripPlot />
          </PopoverContent>
        </Popover>
      </div>
      <p className="-mt-2 text-[11px] text-[var(--aegis-label)]">{noiseCaption(strip, lang)}</p>
    </section>
  );
}
