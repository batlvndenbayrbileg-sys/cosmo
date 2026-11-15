"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, FlaskConical } from "lucide-react";
import type { Status } from "@/lib/types";
import { StatusPill } from "@/components/status";
import { TwoToneTitle } from "@/components/dashboard/parts";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import {
  URINE_GROUPS,
  flaggedAt,
  formatFold,
  noteKey,
  statusKey,
  type UrineGroup,
  type UrinePersonView,
  type UrinePointKind,
  type UrineTimepointSummary,
} from "@/lib/labs/urine";
import { cn } from "@/lib/utils";
import { UrineAnalyteChart } from "./UrineAnalyteChart";

const PILL_STATUS: Record<UrinePointKind, Status> = {
  normal: "green",
  borderline: "yellow",
  abnormal: "red",
  insufficient: "no_data",
  baseline: "no_data",
};

const BAR_CLASS: Record<UrineGroup, string> = {
  normal: "bg-status-ok",
  borderline: "bg-status-watch",
  abnormal: "bg-status-alert",
  insufficient: "bg-status-nodata",
};

export const LABS_CHART_ID = "labs-urine-chart";

/** title, honest caption and the dataset line; shared by the loaded view and its loading / error states */
export function LabsHeader({ person }: { person: string | null }) {
  const { t } = useI18n();
  return (
    <header className="flex flex-col gap-0.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-4">
      <TwoToneTitle
        id="labs-title"
        icon={FlaskConical}
        light={t("dashboard.labs.titleLight")}
        strong={t("dashboard.labs.titleStrong")}
        className="lg:[&_.icon-chip]:size-[clamp(28px,3.8vh,38px)]! lg:[&_h2]:text-[clamp(20px,2.8vh,26px)]"
      />
      <p className="text-[13px] font-medium text-[var(--aegis-ink)] lg:text-[12px]">{t("dashboard.labs.caption")}</p>
      <p className="text-[13px] font-medium text-status-watch-ink lg:text-[12px]">{t("dashboard.labs.dilution")}</p>
      {person ? (
        <p className="w-full text-[12px] leading-snug text-[var(--aegis-label)] lg:text-[11.5px]">
          {t("dashboard.labs.source", { person })}
        </p>
      ) : null}
    </header>
  );
}

/** the Labs tab's frame: header on top, the rest takes the frame's height on desktop */
export function LabsShell({ person, children }: { person: string | null; children: ReactNode }) {
  return (
    <section aria-labelledby="labs-title" data-slot="labs-urine" className="flex flex-col gap-3 lg:h-full lg:min-h-0 lg:gap-[clamp(8px,1.2vh,12px)]">
      <LabsHeader person={person} />
      {children}
    </section>
  );
}

function StackedBar({ summary }: { summary: UrineTimepointSummary }) {
  const c = summary.counts;
  if (!c) return <span aria-hidden="true" className="block h-2 rounded-full border border-dashed border-status-nodata/60" />;
  const total = URINE_GROUPS.reduce((n, g) => n + c[g], 0) || 1;
  return (
    <span aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-status-nodata-soft">
      {URINE_GROUPS.map((g) =>
        c[g] > 0 ? <span key={g} className={cn("h-full", BAR_CLASS[g])} style={{ width: `${(c[g] / total) * 100}%` }} /> : null,
      )}
    </span>
  );
}

function TimepointSelector({
  post,
  selected,
  onSelect,
}: {
  post: readonly UrineTimepointSummary[];
  selected: string;
  onSelect: (tp: string) => void;
}) {
  const { t } = useI18n();
  const current = post.find((p) => p.timepoint === selected) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t("dashboard.labs.tp.label")} className="grid grid-cols-3 gap-2 lg:gap-[clamp(6px,0.8vw,10px)]">
        {post.map((p) => {
          const on = p.timepoint === selected;
          const aria = p.counts
            ? t("dashboard.labs.tp.aria", { tp: p.timepoint, ...p.counts })
            : t("dashboard.labs.tp.ariaNoSample", { tp: p.timepoint });
          return (
            <button
              key={p.timepoint}
              type="button"
              aria-pressed={on}
              aria-label={aria}
              data-timepoint={p.timepoint}
              onClick={() => onSelect(p.timepoint)}
              className={cn(
                "glass-card flex min-w-0 flex-col gap-1.5 px-3 py-2 text-left outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-3 focus-visible:ring-ring/60 motion-reduce:transition-none lg:py-[clamp(6px,1vh,10px)]",
                on ? "bg-white ring-2 ring-[var(--aegis-accent)]" : "hover:bg-white",
              )}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="tnum text-[17px] leading-none font-medium text-[var(--aegis-ink)]">{p.timepoint}</span>
                <span className="text-[11px] leading-tight text-[var(--aegis-label)]">{t("dashboard.labs.tp.day", { n: p.day })}</span>
              </span>
              <StackedBar summary={p} />
              <span className="tnum flex flex-wrap gap-x-2 text-[11.5px] leading-tight text-[var(--aegis-label)]">
                {p.counts ? (
                  <>
                    <span className="font-medium text-status-alert-ink">
                      {p.counts.abnormal} {t("dashboard.labs.group.abnormal")}
                    </span>
                    <span className="font-medium text-status-watch-ink">
                      {p.counts.borderline} {t("dashboard.labs.group.borderline")}
                    </span>
                  </>
                ) : (
                  t("dashboard.labs.tp.noSample")
                )}
              </span>
            </button>
          );
        })}
      </div>
      {current?.counts ? (
        <ul aria-hidden="true" className="tnum flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-[var(--aegis-label)]">
          {URINE_GROUPS.map((g) => (
            <li key={g} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-[3px]", BAR_CLASS[g])} />
              {t(`dashboard.labs.group.${g}`)} <span className="font-medium text-[var(--aegis-ink)]">{current.counts![g]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The dashboard's "Labs" tab content for one linked Inspiration4 reference crew member: a summary per post-flight
 * time point (stacked bar + selector), the flagged analytes at the chosen time point (Abnormal first, then Borderline,
 * by |sample-adjusted change|) and the selected analyte's course with the personal range shaded. Display only.
 */
export function UrinePanelView({
  view,
  initialTimepoint,
  initialAnalyte,
}: {
  view: UrinePersonView;
  initialTimepoint?: string;
  initialAnalyte?: string;
}) {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const firstSampled = view.post.find((p) => p.sampled)?.timepoint ?? view.post[0]?.timepoint ?? "R+1";
  const [tp, setTp] = useState<string>(
    initialTimepoint && view.post.some((p) => p.timepoint === initialTimepoint) ? initialTimepoint : firstSampled,
  );
  const flagged = flaggedAt(view, tp);
  const [picked, setPicked] = useState<string | null>(initialAnalyte ?? null);
  const summary = view.post.find((p) => p.timepoint === tp) ?? null;
  // the chosen analyte while it is flagged here, else the top of the list
  const active =
    flagged.find((f) => f.analyte.analyte === picked)?.analyte ??
    (picked && initialAnalyte === picked ? view.analytes.find((a) => a.analyte === picked) : undefined) ??
    flagged[0]?.analyte ??
    null;

  const choose = (name: string) => {
    setPicked(name);
    // phones: the chart sits under the list, bring it into view
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        document.getElementById(LABS_CHART_ID)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" }),
      );
    }
  };

  const statusText = (s: string) => {
    const k = statusKey(s);
    return k ? t(`dashboard.labs.status.${k}`) : s;
  };
  const noteText = (n: string) => {
    const k = noteKey(n);
    return k ? t(`dashboard.labs.note.${k}`) : n;
  };

  return (
    <LabsShell person={view.person}>
      <div className="flex flex-col gap-4 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-[clamp(14px,1.4vw,24px)]">
        <div className="flex flex-col gap-3 lg:min-h-0 lg:gap-[clamp(8px,1.2vh,12px)]">
          <TimepointSelector post={view.post} selected={tp} onSelect={setTp} />

          <section
            aria-labelledby="labs-list-title"
            data-slot="labs-flagged"
            className="glass-card flex flex-col gap-2 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:p-[clamp(10px,1.4vh,16px)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 id="labs-list-title" className="text-[15px] leading-tight font-medium text-[var(--aegis-ink)]">
                {t("dashboard.labs.list.title", { tp })}
              </h3>
              {summary?.sampled ? (
                <span className="tnum shrink-0 text-[11.5px] text-[var(--aegis-label)]">
                  {t("dashboard.labs.list.count", { n: flagged.length, total: view.analytes.length })}
                </span>
              ) : null}
            </div>
            {!summary?.sampled ? (
              <p role="status" data-slot="labs-no-sample" className="rounded-2xl border border-dashed border-status-nodata/60 bg-white/60 px-3 py-3 text-[14px] text-[var(--aegis-label)]">
                {t("dashboard.labs.noSample")}
              </p>
            ) : flagged.length === 0 ? (
              <p role="status" className="text-[14px] text-[var(--aegis-label)]">
                {t("dashboard.labs.list.none")}
              </p>
            ) : (
              <ul className="-mx-1 flex flex-col gap-1 px-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pb-1">
                {flagged.map(({ analyte, point }) => {
                  const on = active?.analyte === analyte.analyte;
                  const Arrow = point.direction === "down" ? ArrowDown : ArrowUp;
                  const fold = formatFold(point.fold);
                  return (
                    <li key={analyte.analyte}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-controls={LABS_CHART_ID}
                        data-analyte={analyte.analyte}
                        onClick={() => choose(analyte.analyte)}
                        className={cn(
                          "grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-2xl px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/60 motion-reduce:transition-none",
                          on ? "bg-[var(--aegis-pastel-blue)]/70 ring-1 ring-[var(--aegis-accent)]/40" : "hover:bg-white/80",
                        )}
                      >
                        {point.direction ? (
                          <Arrow
                            aria-label={t(`dashboard.labs.dir.${point.direction}`)}
                            className={cn("size-4", point.kind === "abnormal" ? "text-status-alert" : "text-status-watch")}
                            strokeWidth={2.2}
                          />
                        ) : (
                          <span />
                        )}
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-[14.5px] font-medium text-[var(--aegis-ink)]">{analyte.analyte}</span>
                          <span className="tnum text-[14px] text-[var(--aegis-ink)]" aria-label={t("dashboard.labs.foldAria", { fold })}>
                            {fold}
                          </span>
                        </span>
                        <StatusPill status={PILL_STATUS[point.kind]} label={statusText(point.status)} size="sm" />
                        {point.note ? (
                          <span className="col-start-2 col-end-4 text-[11.5px] leading-snug text-[var(--aegis-label)]">
                            {noteText(point.note)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section
          id={LABS_CHART_ID}
          aria-labelledby="labs-chart-title"
          aria-live="polite"
          data-slot="labs-chart"
          className="glass-card flex flex-col gap-2 p-3 sm:p-4 lg:min-h-0 lg:p-[clamp(10px,1.4vh,16px)]"
        >
          {active ? (
            <>
              <h3 id="labs-chart-title" className="text-[15px] leading-tight font-medium text-[var(--aegis-ink)]">
                {t("dashboard.labs.chart.title", { analyte: active.analyte })}
              </h3>
              <UrineAnalyteChart key={active.analyte} analyte={active} selected={tp} fill />
              <p className="text-[11px] leading-snug text-[var(--aegis-label)]">{t("dashboard.labs.chart.method")}</p>
            </>
          ) : (
            <>
              <h3 id="labs-chart-title" className="sr-only">
                {t("dashboard.labs.list.hint")}
              </h3>
              <p className="m-auto max-w-[28ch] py-6 text-center text-[14px] text-[var(--aegis-label)]">
                {summary?.sampled ? t("dashboard.labs.chart.empty") : t("dashboard.labs.noSample")}
              </p>
            </>
          )}
        </section>
      </div>
    </LabsShell>
  );
}
