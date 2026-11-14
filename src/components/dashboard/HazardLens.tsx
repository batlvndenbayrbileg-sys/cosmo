"use client";

import { ExternalLink, Minus, X } from "lucide-react";
import type { HazardKey, HazardStat, Status } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusGlyph, StatusPill } from "@/components/status";
import { statusClasses, statusWordKey } from "@/components/status/statusClasses";
import { useI18n } from "@/i18n/I18nProvider";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { NASA_HAZARDS } from "@/lib/nasa/hazards";
import { cn } from "@/lib/utils";

/** hatched fill for "not monitored here" chips (a pattern, not a colour, carries the meaning) */
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--status-nodata) 28%, transparent) 6px 7px)",
} as const;

/**
 * Hazard lens: five chips named by NASA's hazards, coloured by status with a glyph; "not monitored here" is
 * hatched. Selecting a chip highlights and sorts the related vital cards (done by DashboardView through
 * `onSelect`) and opens a small card with the hazard summary and its nasa.gov source link.
 */
export function HazardLens({
  hazards,
  selected,
  onSelect,
}: {
  hazards: HazardStat[];
  selected: HazardKey | null;
  onSelect: (next: HazardKey | null) => void;
}) {
  const { t, lang, pick } = useI18n();
  const selectedStat = hazards.find((h) => h.hazard === selected) ?? null;
  const info = selectedStat ? NASA_HAZARDS[selectedStat.hazard] : null;

  return (
    <Card data-slot="hazard-lens" aria-labelledby="hazard-lens-title" className="h-full gap-3">
      <CardHeader>
        <CardTitle id="hazard-lens-title" className="text-lg">
          {t("dashboard.hazards.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("dashboard.hazards.subtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2">
          {hazards.map((h) => {
            const name = pick(NASA_HAZARDS[h.hazard].name);
            const monitored: Status | null = h.status === "not_monitored" ? null : h.status;
            const isSelected = h.hazard === selected;
            const statusWord =
              monitored === null ? t("dashboard.hazards.notMonitored") : t(statusWordKey(monitored));
            return (
              <li key={h.hazard}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={t("dashboard.hazards.statusFor", { name, status: statusWord })}
                  data-hazard={h.hazard}
                  data-status={h.status}
                  onClick={() => onSelect(isSelected ? null : h.hazard)}
                  style={monitored === null ? HATCH : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-1.5 text-base font-medium outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50",
                    monitored === null
                      ? "border-dashed border-status-nodata/60 bg-card text-muted-foreground"
                      : statusClasses(monitored).pill,
                    isSelected && "ring-2 ring-primary",
                  )}
                >
                  {monitored === null ? (
                    <Minus aria-hidden="true" className="size-4" />
                  ) : (
                    <StatusGlyph status={monitored} size={16} labelled={false} />
                  )}
                  <span>{name}</span>
                  {monitored === null ? (
                    <span className="text-xs font-normal">{t("dashboard.hazards.notMonitored")}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {selectedStat && info ? (
          <div
            data-slot="hazard-detail"
            aria-live="polite"
            className="flex flex-col gap-2 rounded-xl bg-secondary/70 p-4 ring-1 ring-foreground/10"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{pick(info.name)}</h3>
                {selectedStat.status === "not_monitored" ? (
                  <span className="text-sm text-muted-foreground">{t("dashboard.hazards.notMonitored")}</span>
                ) : (
                  <StatusPill status={selectedStat.status} size="sm" />
                )}
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(null)}>
                <X aria-hidden="true" />
                {t("dashboard.hazards.clear")}
              </Button>
            </div>
            <p className="text-base text-foreground">{pick(info.summary)}</p>
            <p className="text-sm text-muted-foreground">
              {selectedStat.keys.length === 0
                ? t("dashboard.hazards.noLinked")
                : t("dashboard.hazards.related", {
                    list: selectedStat.keys.map((k) => KPI_DEFS[k].labels[lang]).join(", "),
                  })}
            </p>
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("dashboard.hazards.source")}: {t("dashboard.hazards.openSource")}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">{t("dashboard.hazards.caption")}</p>
      </CardContent>
    </Card>
  );
}
