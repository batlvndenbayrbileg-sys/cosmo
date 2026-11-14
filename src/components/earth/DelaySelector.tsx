"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { DELAY_OPTIONS, type DelayId } from "./delay";

/**
 * Segmented Live / 3 min / 20 min selector. Always a simulation setting: callers decide whether it refetches
 * (Earth console) or only changes what is displayed (crew dashboard link card).
 */
export function DelaySelector({
  value,
  onChange,
  label,
  className,
}: {
  value: DelayId;
  onChange: (next: DelayId) => void;
  /** visible label; defaults to "Simulated link delay" */
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const labelId = useId();

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <span id={labelId} className="text-sm font-medium text-muted-foreground">
        {label ?? t("earth.delay.label")}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex gap-1.5">
        {DELAY_OPTIONS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="lg"
            variant={option.id === value ? "default" : "outline"}
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
            className="min-w-16 px-3"
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
