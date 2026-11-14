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
            className="inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        {t("shell.simulated")}
      </TooltipTrigger>
      <TooltipContent>{t("dashboard.kpi.simulatedTip")}</TooltipContent>
    </Tooltip>
  );
}

function DeltaLine({ stat, lang }: { stat: KpiStat; lang: Lang }) {
  const delta = formatDeltaText(stat, lang);
  if (delta.text === "") return null;
  const Icon = delta.kind === "below" ? ArrowDown : delta.kind === "above" ? ArrowUp : Minus;
  return (
    <p data-slot="kpi-delta" className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{delta.text}</span>
    </p>
  );
}

function SparkFor({
  stat,
  label,
  status,
}: {
  stat: KpiStat;
  label: string;
  status: Status;
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
      height={44}
    />
  );
}

function ValueText({ main, unit, size = "lg" }: { main: string; unit: string; size?: "lg" | "md" }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "tnum font-semibold tracking-tight text-foreground",
          size === "lg" ? "text-4xl leading-tight" : "text-2xl leading-tight",
        )}
      >
        {main}
      </span>
      {unit ? <span className="text-lg text-muted-foreground">{unit}</span> : null}
    </p>
  );
}

/** the micro-label with the demo-parameter range, one line per stat */
function RangeLine({ stat, prefix, lang }: { stat: KpiStat; prefix?: string; lang: Lang }) {
  if (!stat.rangeText) return null;
  return (
    <p data-slot="kpi-range" className="text-xs text-muted-foreground">
      {prefix ? `${prefix}: ` : ""}
      {stat.rangeText[lang]}
    </p>
  );
}

function SingleBody({ stat, lang }: { stat: KpiStat; lang: Lang }) {
  const { t } = useI18n();
  const label = KPI_DEFS[stat.key].labels[lang];
  const has = stat.value !== null && stat.status !== "no_data";
  const shown = has ? displayValue(stat.key, stat.value as number | string, lang) : null;
  return (
    <>
      {shown ? (
        <ValueText main={shown.main} unit={shown.unit} />
      ) : (
        <>
          <p className="tnum text-4xl leading-tight font-semibold text-muted-foreground" aria-hidden="true">
            –
          </p>
          <p className="text-sm text-muted-foreground">{t("dashboard.kpi.noValue")}</p>
        </>
      )}
      {has ? <DeltaLine stat={stat} lang={lang} /> : null}
      <SparkFor stat={stat} label={label} status={stat.status} />
      <RangeLine stat={stat} lang={lang} />
    </>
  );
}

function BpBody({ systolic, diastolic, lang }: { systolic?: KpiStat; diastolic?: KpiStat; lang: Lang }) {
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
        />
      ) : (
        <>
          <p className="tnum text-4xl leading-tight font-semibold text-muted-foreground" aria-hidden="true">
            –
          </p>
          <p className="text-sm text-muted-foreground">{t("dashboard.kpi.noValue")}</p>
        </>
      )}
      <div className="flex flex-col gap-2">
        {rows.map(({ stat, label }) =>
          stat ? (
            <div key={stat.key} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 text-sm">
                <span className="font-medium text-foreground">{label}</span>
                <DeltaLine stat={stat} lang={lang} />
              </div>
              <SparkFor stat={stat} label={KPI_DEFS[stat.key].labels[lang]} status={stat.status} />
            </div>
          ) : null,
        )}
      </div>
      {rows.map(({ stat, label }) =>
        stat ? <RangeLine key={stat.key} stat={stat} prefix={label} lang={lang} /> : null,
      )}
    </>
  );
}

function SymptomsBody({
  stats,
  note,
  lang,
}: {
  stats: KpiStat[];
  note: KpiStat | undefined;
  lang: Lang;
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
  return (
    <>
      {headline !== null ? (
        <p className="text-2xl leading-tight font-semibold text-foreground">{headline}</p>
      ) : (
        <>
          <p className="tnum text-4xl leading-tight font-semibold text-muted-foreground" aria-hidden="true">
            –
          </p>
          <p className="text-sm text-muted-foreground">{t("dashboard.kpi.noValue")}</p>
        </>
      )}
      <ul className="flex flex-col gap-1.5">
        {stats.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-base">
            <span className="text-foreground">{KPI_DEFS[s.key].labels[lang]}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {s.value === null ? "–" : formatValue(s.key, s.value, lang)}
              <StatusGlyph status={s.status} size={16} />
            </span>
          </li>
        ))}
      </ul>
      {days.total > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.kpi.symptomDays", { count: days.count, total: days.total })}
        </p>
      ) : null}
      {note ? (
        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="font-medium text-foreground">{t("dashboard.kpi.note")}: </span>
          <span className="text-muted-foreground">
            {typeof note.value === "string" && note.value.trim() !== ""
              ? note.value
              : t("dashboard.kpi.noNote")}
          </span>
        </div>
      ) : null}
      {stats[0] ? <RangeLine stat={stats[0]} lang={lang} /> : null}
    </>
  );
}

function NoteBody({ stat }: { stat: KpiStat | undefined }) {
  const { t } = useI18n();
  const text = stat && typeof stat.value === "string" && stat.value.trim() !== "" ? stat.value : null;
  return (
    <p className={cn("text-base", text ? "text-foreground" : "text-muted-foreground")}>
      {text ?? t("dashboard.kpi.noNote")}
    </p>
  );
}

/**
 * One vital card: value + unit, status pill (glyph + word), delta line, 14-day sparkline with the
 * baseline band, and the demo-parameter range. Blood pressure and symptoms are one card each.
 * Free-text keys are only ever rendered when the card model carries them (crew viewer).
 */
export function KpiCard({
  card,
  byKey,
  viewer,
  highlighted,
}: {
  card: KpiCardModel;
  byKey: ByKey;
  viewer: Viewer;
  highlighted: boolean;
}) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const status = cardStatus(card, byKey);
  const stats = card.keys.map((k) => byKey.get(k)).filter((s): s is KpiStat => s !== undefined);
  const simulated = stats.some((s) => s.source === "simulated");

  const title =
    card.kind === "bp"
      ? t("dashboard.kpi.bp.title")
      : card.kind === "symptoms"
        ? t("dashboard.kpi.symptoms.title")
        : KPI_DEFS[card.keys[0]].labels[lang];

  let body: ReactNode;
  if (card.kind === "bp") {
    body = (
      <BpBody
        systolic={byKey.get("bp_systolic")}
        diastolic={byKey.get("bp_diastolic")}
        lang={lang}
      />
    );
  } else if (card.kind === "symptoms") {
    body = (
      <SymptomsBody
        stats={stats}
        note={viewer === "crew" && card.noteKey ? byKey.get(card.noteKey) : undefined}
        lang={lang}
      />
    );
  } else if (card.kind === "note") {
    body = viewer === "crew" ? <NoteBody stat={byKey.get(card.keys[0])} /> : null;
  } else {
    body = <SingleBody stat={byKey.get(card.keys[0]) as KpiStat} lang={lang} />;
  }

  return (
    <Card
      data-slot="kpi-card"
      data-card={card.id}
      data-related={highlighted ? "true" : undefined}
      className={cn(
        "h-full gap-2.5 p-0 transition-shadow",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <article aria-labelledby={titleId} className="flex h-full flex-col gap-2 px-4 py-4">
        <header className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="text-base font-medium text-muted-foreground">
            {title}
          </h3>
          <StatusPill status={status} size="sm" />
        </header>
        {body}
        {simulated ? (
          <div className="mt-auto pt-1">
            <SimulatedChip />
          </div>
        ) : null}
      </article>
    </Card>
  );
}
