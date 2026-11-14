"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { StatusPill } from "@/components/status/StatusPill";
import { statusClasses } from "@/components/status/statusClasses";
import { formatValue, getKpi, isTextKey } from "@/lib/kpi/registry";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { CaptureCard } from "./state";

/**
 * One captured measurement: label, value + unit, "from your words: ..." snippet, status pill from
 * the measurement event (status + reason) and a brief "corrected" flash when the value changed.
 * The card never shows a threshold as clinical: reasons say "demo range" / "differs from your usual".
 */
export const KpiCard = memo(function KpiCard({ card }: { card: CaptureCard }) {
  const { t, lang } = useI18n();
  const def = getKpi(card.key);
  const text = isTextKey(card.key);
  const value = formatValue(card.key, card.value, lang);
  const showReason = card.status === "yellow" || card.status === "red";
  const snippet = card.sourceText.trim();

  return (
    <div
      data-slot="kpi-card"
      data-status={card.status}
      data-key={card.key}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-xs",
        card.status === "yellow" && "border-status-watch/40",
        card.status === "red" && "border-status-alert/50",
        (card.status === "green" || card.status === "no_data") && "border-border",
      )}
    >
      {/* brief flash whenever the value was re-captured or corrected; keyed so it replays each time */}
      {card.flash > 0 ? (
        <motion.span
          key={`flash-${card.flash}`}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-primary/15"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{def.labels[lang]}</h3>
        <div className="flex items-center gap-2">
          {card.flash > 0 ? (
            <motion.span
              key={`chip-${card.flash}`}
              className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.85, 1, 1, 1] }}
              transition={{ duration: 2.8, times: [0, 0.08, 0.8, 1] }}
            >
              {t("checkin.card.corrected")}
            </motion.span>
          ) : null}
          <StatusPill status={card.status} size="sm" />
        </div>
      </div>

      <p
        className={cn(
          "relative mt-1 font-semibold text-foreground",
          text ? "line-clamp-3 text-lg leading-snug" : "tnum text-3xl",
        )}
      >
        {value}
      </p>

      {showReason ? (
        <p className={cn("relative mt-1 text-sm", statusClasses(card.status).ink)}>
          {t(`checkin.card.reason.${card.reason}`)}
        </p>
      ) : null}

      {snippet !== "" && !text ? (
        <p className="relative mt-2 line-clamp-2 text-sm text-muted-foreground italic">
          {t("checkin.card.fromYourWords", { text: snippet })}
        </p>
      ) : null}
    </div>
  );
});
