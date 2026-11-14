"use client";

import { Check, Moon } from "lucide-react";
import type { DayArcSlot } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { nextSlot } from "./logic";

/**
 * Day arc: Morning, Midday, Afternoon, Evening, Bedtime. Each check-in slot shows a tick per reading
 * (filled when logged, hollow when still missing) and its state in words; the first slot that is not
 * done carries a "Next" marker. Bedtime is a closing milestone, not a check-in slot.
 */
export function DayArc({ dayArc }: { dayArc: DayArcSlot[] }) {
  const { t } = useI18n();
  const next = nextSlot(dayArc);

  return (
    <Card data-slot="day-arc" aria-labelledby="day-arc-title" className="h-full gap-3">
      <CardHeader>
        <CardTitle id="day-arc-title" className="text-lg">
          {t("dashboard.dayArc.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-2">
          <span
            aria-hidden="true"
            className="absolute top-4 right-[10%] left-[10%] hidden h-0.5 bg-border sm:block"
          />
          {dayArc.map((slot) => {
            const total = slot.logged.length + slot.missing.length;
            const isNext = next === slot.slot;
            return (
              <li
                key={slot.slot}
                data-slot-key={slot.slot}
                data-state={slot.state}
                aria-current={isNext ? "step" : undefined}
                className="relative flex items-center gap-3 sm:flex-col sm:gap-1.5 sm:text-center"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card",
                    slot.state === "done" && "border-primary bg-primary text-primary-foreground",
                    slot.state === "partial" && "border-primary text-primary",
                    slot.state === "pending" && "border-border text-muted-foreground",
                    isNext && "ring-4 ring-primary/20",
                  )}
                >
                  {slot.state === "done" ? (
                    <Check className="size-4" />
                  ) : slot.state === "partial" ? (
                    <span className="size-2.5 rounded-full bg-primary" />
                  ) : null}
                </span>
                <span className="flex flex-col sm:items-center">
                  <span className="text-base font-medium text-foreground">
                    {t(`dashboard.dayArc.${slot.slot}`)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(`dashboard.dayArc.${slot.state}`)}
                  </span>
                  <span className="tnum text-xs text-muted-foreground">
                    {t("dashboard.dayArc.logged", { done: slot.logged.length, total })}
                  </span>
                  <span aria-hidden="true" className="mt-1 flex flex-wrap gap-1 sm:justify-center">
                    {slot.logged.map((k) => (
                      <span key={`on-${k}`} className="size-1.5 rounded-full bg-primary" />
                    ))}
                    {slot.missing.map((k) => (
                      <span key={`off-${k}`} className="size-1.5 rounded-full border border-border" />
                    ))}
                  </span>
                </span>
                {isNext ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground sm:mt-0.5">
                    {t("dashboard.dayArc.next")}
                  </span>
                ) : null}
              </li>
            );
          })}
          <li
            data-slot-key="bedtime"
            aria-current={next === "bedtime" ? "step" : undefined}
            className="relative flex items-center gap-3 sm:flex-col sm:gap-1.5 sm:text-center"
          >
            <span
              aria-hidden="true"
              className={cn(
                "z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card text-muted-foreground",
                next === "bedtime" && "border-primary text-primary ring-4 ring-primary/20",
              )}
            >
              <Moon className="size-4" />
            </span>
            <span className="flex flex-col sm:items-center">
              <span className="text-base font-medium text-foreground">{t("dashboard.dayArc.bedtime")}</span>
              <span className="text-sm text-muted-foreground">{t("dashboard.dayArc.bedtimeHint")}</span>
            </span>
            {next === "bedtime" ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground sm:mt-0.5">
                {t("dashboard.dayArc.next")}
              </span>
            ) : null}
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
