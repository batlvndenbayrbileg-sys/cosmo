"use client";

import { useId } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { DELAY_OPTIONS, type DelayId } from "./delay";

/**
 * Segmented Live / 3 min / 20 min pill selector (design v2: light rounded track, the active option is
 * a raised white pill with a dot). Always a simulation setting: callers decide whether it refetches
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
      <span id={labelId} className="unit-label">
        {label ?? t("earth.delay.label")}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex items-center gap-0.5 rounded-full border border-white/80 bg-[rgba(15,27,45,0.06)] p-1"
      >
        {DELAY_OPTIONS.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={cn(
                "tnum inline-flex h-9 min-w-16 items-center justify-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium outline-none",
                "transition-[background-color,color,box-shadow] duration-200",
                "focus-visible:ring-3 focus-visible:ring-[color:var(--cosmo-accent)]/45",
                active
                  ? "bg-white text-[color:var(--cosmo-ink)] shadow-[0_4px_12px_-6px_rgba(40,80,160,0.45)]"
                  : "text-[color:var(--cosmo-label)] hover:bg-white/60 hover:text-[color:var(--cosmo-ink)]",
              )}
            >
              {active ? (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[color:var(--cosmo-accent)]" />
              ) : null}
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
