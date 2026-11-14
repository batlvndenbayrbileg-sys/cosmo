"use client";

import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { KpiKey, KpiStat, Lang, Status } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusGlyph, StatusPill } from "@/components/status";
import { useI18n } from "@/i18n/I18nProvider";
import { KPI_DEFS, formatValue } from "@/lib/kpi/registry";
import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";
import {
  cardStatus,
  displayValue,
  effectiveSd,
  formatDeltaText,
  symptomDays,
  unitLabel,
  type KpiCardModel,
  type Viewer,
} from "./logic";

type ByKey = ReadonlyMap<KpiKey, KpiStat>;

/** small chip that says the value comes from simulated demo data */
function SimulatedChip() {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex h-5 shrink-0 items-center rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        {t("shell.simulated")}
      </TooltipTrigger>
      <TooltipContent>{t("dashboard.kpi.simulatedTip")}</TooltipContent>
    </Tooltip>
  );
}

function DeltaLine({ stat, lang, compact = false }: { stat: KpiStat; lang: Lang; compact?: boolean }) {
  const delta = formatDeltaText(stat, lang);
  if (delta.text === "") return null;
  const Icon = delta.kind === "below" ? ArrowDown : delta.kind === "above" ? ArrowUp : Minus;
  return (
    <p
      data-slot="kpi-delta"
      title={compact ? delta.text : undefined}
      className={cn(
        "flex items-center text-muted-foreground",
        compact ? "min-w-0 gap-1 text-[12px] leading-tight" : "gap-1.5 text-sm",
      )}
    >
      <Icon aria-hidden="true" className={cn("shrink-0", compact ? "size-3.5" : "size-4")} />
      <span className={cn(compact && "truncate")}>{delta.text}</span>
    </p>
  );
}

function SparkFor({
  stat,
  label,
  status,
  height = 44,
  viewWidth,
  className,
}: {
  stat: KpiStat;
  label: string;
  status: Status;
  height?: number;
  viewWidth?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const history = stat.history.map((h) => h.value);
  const today = typeof stat.value === "number" ? stat.value : null;
  if (history.length === 0 && today === null) return null;
  return (
    <Sparkline
      history={history}
      today={today}
      mean={stat.baselineMean}
      sd={effectiveSd(stat.key, stat.baselineSd)}
      status={status}
      label={t("dashboard.kpi.sparkAria", { label, count: history.length })}
      height={height}
      viewWidth={viewWidth}
      className={className}
    />
  );
}

function ValueText({ main, unit, size = "lg" }: { main: string; unit: string; size?: "lg" | "md" | "sm" }) {
  return (
    <p className={cn("flex items-baseline", size === "sm" ? "gap-1" : "gap-1.5")}>
      <span
        className={cn(
          "tnum font-semibold tracking-tight text-foreground",
          size === "lg" && "text-4xl leading-tight",
          size === "md" && "text-2xl leading-tight",
          size === "sm" && "text-[clamp(20px,2.9vh,30px)] leading-none",
        )}
      >
        {main}
      </span>
      {unit ? (
        <span className={cn("text-muted-foreground", size === "sm" ? "text-[13px]" : "text-lg")}>{unit}</span>
      ) : null}
    </p>
  );
}

function NoValue({ compact }: { compact: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <p
        className={cn(
          "tnum font-semibold text-muted-foreground",
          compact ? "text-[clamp(20px,2.9vh,30px)] leading-none" : "text-4xl leading-tight",
        )}
        aria-hidden="true"
      >
        –
      </p>
      <p className={cn("text-muted-foreground", compact ? "text-[12px] leading-tight" : "text-sm")}>
        {t("dashboard.kpi.noValue")}
      </p>
    </>
  );
}

/**
 * One footer line for several ranges: "Systolic: Normal 100-129 mmHg · Diastolic: Normal 60-84 mmHg · demo parameter".
 * The shared " · demo parameter" tail is printed once instead of after every range.
 */
function joinRanges(items: ReadonlyArray<{ part: string; text: string }>): string {
  if (items.length === 0) return "";
  const tailOf = (s: string) => {
    const i = s.lastIndexOf(" · ");
    return i < 0 ? "" : s.slice(i);
  };
  const tail = tailOf(items[0].text);
  const shared = tail !== "" && items.every((it) => tailOf(it.text) === tail);
  const bodies = items.map((it) => `${it.part}: ${shared ? it.text.slice(0, -tail.length) : it.text}`);
  return bodies.join(" · ") + (shared ? tail : "");
}

/** the micro-label with the demo-parameter range, one line per stat */
function RangeLine({
  stat,
  prefix,
  lang,
  compact = false,
}: {
  stat: KpiStat;
  prefix?: string;
  lang: Lang;
  compact?: boolean;
}) {
  if (!stat.rangeText) return null;
  return (
    <p data-slot="kpi-range" className={cn("text-muted-foreground", compact ? "text-[10.5px] leading-tight" : "text-xs")}>
      {prefix ? `${prefix}: ` : ""}
      {stat.rangeText[lang]}
    </p>
  );
}

function SingleBody({ stat, lang, compact }: { stat: KpiStat; lang: Lang; compact: boolean }) {
  const label = KPI_DEFS[stat.key].labels[lang];
  const has = stat.value !== null && stat.status !== "no_data";
  const shown = has ? displayValue(stat.key, stat.value as number | string, lang) : null;
  return (
    <>
      {shown ? <ValueText main={shown.main} unit={shown.unit} size={compact ? "sm" : "lg"} /> : <NoValue compact={compact} />}
      {has ? <DeltaLine stat={stat} lang={lang} compact={compact} /> : null}
      <SparkFor
        stat={stat}
        label={label}
        status={stat.status}
        height={compact ? 30 : 44}
        viewWidth={compact ? 300 : undefined}
        className={cn(compact && "mt-auto max-w-none")}
      />
      {compact ? null : <RangeLine stat={stat} lang={lang} />}
    </>
  );
}

function BpBody({
  systolic,
  diastolic,
  lang,
  compact,
}: {
  systolic?: KpiStat;
  diastolic?: KpiStat;
  lang: Lang;
  compact: boolean;
}) {
  const { t } = useI18n();
  const sys = systolic && systolic.status !== "no_data" ? systolic.value : null;
  const dia = diastolic && diastolic.status !== "no_data" ? diastolic.value : null;
  const unit = unitLabel(systolic?.unit ?? diastolic?.unit ?? "mmHg", lang);
  const rows: Array<{ stat: KpiStat | undefined; label: string }> = [
    { stat: systolic, label: t("dashboard.kpi.bp.systolic") },
    { stat: diastolic, label: t("dashboard.kpi.bp.diastolic") },
  ];
  return (
    <>
      {sys !== null && dia !== null ? (
        <ValueText
          main={`${displayValue("bp_systolic", sys, lang).main}/${displayValue("bp_diastolic", dia, lang).main}`}
          unit={unit}
          size={compact ? "sm" : "lg"}
        />
      ) : (
        <NoValue compact={compact} />
      )}
      <div className={cn("flex flex-col", compact ? "gap-[clamp(4px,1vh,10px)]" : "gap-2")}>
        {rows.map(({ stat, label }) =>
          stat ? (
            compact ? (
              <div key={stat.key} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="shrink-0 text-[12.5px] leading-tight font-medium text-foreground">{label}</span>
                  <DeltaLine stat={stat} lang={lang} compact />
                </div>
                <SparkFor
                  stat={stat}
                  label={KPI_DEFS[stat.key].labels[lang]}
                  status={stat.status}
                  height={28}
                  viewWidth={300}
                  className="max-w-none"
                />
              </div>
            ) : (
              <div key={stat.key} className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  <DeltaLine stat={stat} lang={lang} />
                </div>
                <SparkFor stat={stat} label={KPI_DEFS[stat.key].labels[lang]} status={stat.status} />
              </div>
            )
          ) : null,
        )}
      </div>
      {compact
        ? null
        : rows.map(({ stat, label }) => (stat ? <RangeLine key={stat.key} stat={stat} prefix={label} lang={lang} /> : null))}
    </>
  );
}

function SymptomsBody({
  stats,
  note,
  lang,
  compact,
}: {
  stats: KpiStat[];
  note: KpiStat | undefined;
  lang: Lang;
  compact: boolean;
}) {
  const { t } = useI18n();
  const reported = stats.filter((s) => s.value === 1);
  const anyData = stats.some((s) => s.status !== "no_data" && s.value !== null);
  const days = symptomDays(stats);
  const headline = !anyData
    ? null
    : reported.length === 0
      ? t("dashboard.kpi.noneReported")
      : reported.map((s) => KPI_DEFS[s.key].labels[lang]).join(", ");
  const noteText = note
    ? typeof note.value === "string" && note.value.trim() !== ""
      ? note.value
      : t("dashboard.kpi.noNote")
    : null;
  return (
    <>
      {headline !== null ? (
        <p
          className={cn(
            "leading-tight font-semibold text-foreground",
            compact ? "line-clamp-2 text-[clamp(15px,2vh,20px)] dash-tight:line-clamp-1" : "text-2xl",
          )}
        >
          {headline}
        </p>
      ) : (
        <NoValue compact={compact} />
      )}
      <ul className={cn(compact ? "grid grid-cols-3 gap-x-2 gap-y-0.5" : "flex flex-col gap-1.5")}>
        {stats.map((s) => (
          <li
            key={s.key}
            className={cn(
              "flex",
              compact ? "min-w-0 flex-col text-[12px] leading-tight" : "items-center justify-between gap-2 text-base",
            )}
          >
            <span className="truncate text-foreground">{KPI_DEFS[s.key].labels[lang]}</span>
            <span className={cn("flex shrink-0 items-center text-muted-foreground", compact ? "gap-1" : "gap-2")}>
              {s.value === null ? "–" : formatValue(s.key, s.value, lang)}
              <StatusGlyph status={s.status} size={compact ? 13 : 16} />
            </span>
          </li>
        ))}
      </ul>
      {days.total > 0 ? (
        <p className={cn("text-muted-foreground", compact ? "text-[11.5px] leading-tight" : "text-sm")}>
          {t("dashboard.kpi.symptomDays", { count: days.count, total: days.total })}
        </p>
      ) : null}
      {noteText !== null ? (
        <div
          className={cn(
            "rounded-lg bg-muted",
            compact ? "line-clamp-2 px-2 py-1 text-[11.5px] leading-tight dash-tight:line-clamp-1" : "px-3 py-2 text-sm",
          )}
          title={compact ? noteText : undefined}
        >
          <span className="font-medium text-foreground">{t("dashboard.kpi.note")}: </span>
          <span className="text-muted-foreground">{noteText}</span>
        </div>
      ) : null}
      {stats[0] && !compact ? <RangeLine stat={stats[0]} lang={lang} /> : null}
    </>
  );
}

function NoteBody({ stat, compact }: { stat: KpiStat | undefined; compact: boolean }) {
  const { t } = useI18n();
  const text = stat && typeof stat.value === "string" && stat.value.trim() !== "" ? stat.value : null;
  return (
    <p
      className={cn(
        text ? "text-foreground" : "text-muted-foreground",
        compact ? "line-clamp-4 text-[13.5px] leading-snug" : "text-base",
      )}
      title={compact && text ? text : undefined}
    >
      {text ?? t("dashboard.kpi.noNote")}
    </p>
  );
}

/**
 * One vital card: value + unit, status pill (glyph + word), delta line, 14-day sparkline with the
 * baseline band, and the demo-parameter range. Blood pressure and symptoms are one card each.
 * Free-text keys are only ever rendered when the card model carries them (crew viewer).
 * `compact` is the single-screen Vitals grid: the same pieces in smaller type, so 12 cards fit one screen.
 */
export function KpiCard({
  card,
  byKey,
  viewer,
  highlighted,
  compact = false,
}: {
  card: KpiCardModel;
  byKey: ByKey;
  viewer: Viewer;
  highlighted: boolean;
  compact?: boolean;
}) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const status = cardStatus(card, byKey);
  const stats = card.keys.map((k) => byKey.get(k)).filter((s): s is KpiStat => s !== undefined);
  const simulated = stats.some((s) => s.source === "simulated");
  // compact cards print the demo-parameter range(s) in one footer line next to the "simulated" chip
  const compactRange = !compact
    ? ""
    : card.kind === "bp"
      ? joinRanges(
          stats.flatMap((s) => {
            const text = s.rangeText?.[lang];
            if (!text) return [];
            const part = t(s.key === "bp_systolic" ? "dashboard.kpi.bp.systolic" : "dashboard.kpi.bp.diastolic");
            return [{ part, text }];
          }),
        )
      : (stats[0]?.rangeText?.[lang] ?? "");

  const title =
    card.kind === "bp"
      ? t("dashboard.kpi.bp.title")
      : card.kind === "symptoms"
        ? t("dashboard.kpi.symptoms.title")
        : KPI_DEFS[card.keys[0]].labels[lang];

  let body: ReactNode;
  if (card.kind === "bp") {
    body = (
      <BpBody systolic={byKey.get("bp_systolic")} diastolic={byKey.get("bp_diastolic")} lang={lang} compact={compact} />
    );
  } else if (card.kind === "symptoms") {
    body = (
      <SymptomsBody
        stats={stats}
        note={viewer === "crew" && card.noteKey ? byKey.get(card.noteKey) : undefined}
        lang={lang}
        compact={compact}
      />
    );
  } else if (card.kind === "note") {
    body = viewer === "crew" ? <NoteBody stat={byKey.get(card.keys[0])} compact={compact} /> : null;
  } else {
    body = <SingleBody stat={byKey.get(card.keys[0]) as KpiStat} lang={lang} compact={compact} />;
  }

  return (
    <Card
      data-slot="kpi-card"
      data-card={card.id}
      data-related={highlighted ? "true" : undefined}
      className={cn("h-full gap-2.5 p-0 transition-shadow", compact && "gap-0", highlighted && "ring-2 ring-primary")}
    >
      <article
        aria-labelledby={titleId}
        className={cn(
          "flex h-full flex-col",
          compact
            ? "min-h-0 gap-[clamp(3px,0.6vh,8px)] px-[clamp(10px,0.9vw,16px)] py-[clamp(8px,1.3vh,14px)] [&>*]:shrink-0"
            : "gap-2 px-4 py-4",
        )}
      >
        <header className="flex items-start justify-between gap-2">
          <h3
            id={titleId}
            className={cn(
              "font-medium text-muted-foreground",
              compact ? "min-w-0 truncate text-[13.5px] leading-tight" : "text-base",
            )}
          >
            {title}
          </h3>
          <StatusPill status={status} size="sm" className={cn(compact && "shrink-0")} />
        </header>
        {body}
        {compact ? (
          compactRange !== "" || simulated ? (
            <div className="mt-auto flex items-end justify-between gap-2 pt-0.5">
              {compactRange !== "" ? (
                <p data-slot="kpi-range" className="min-w-0 text-[10.5px] leading-tight text-muted-foreground">
                  {compactRange}
                </p>
              ) : (
                <span />
              )}
              {simulated ? <SimulatedChip /> : null}
            </div>
          ) : null
        ) : simulated ? (
          <div className="mt-auto pt-1">
            <SimulatedChip />
          </div>
        ) : null}
      </article>
    </Card>
  );
}
