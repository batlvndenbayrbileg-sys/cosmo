"use client";

import { motion } from "framer-motion";
import { CircleHelp, X } from "lucide-react";
import { getKpi } from "@/lib/kpi/registry";
import { useI18n } from "@/i18n/I18nProvider";
import type { KpiKey } from "@/lib/types";

/** Short polite note when Cosmo needs one more detail (unclear or out-of-range answer). */
export function ClarificationBubble({
  clarification,
  onDismiss,
}: {
  clarification: { key: KpiKey; reason: string };
  onDismiss: () => void;
}) {
  const { t, lang } = useI18n();
  const label = getKpi(clarification.key).labels[lang];
  const reason = clarification.reason.trim();

  return (
    <motion.div
      role="note"
      data-slot="clarification"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-start gap-3 rounded-2xl border border-status-watch/30 bg-status-watch-soft px-4 py-3 text-status-watch-ink"
    >
      <CircleHelp className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{t("checkin.clarify.title", { label })}</p>
        {reason !== "" ? <p className="text-sm opacity-90">{reason}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("checkin.clarify.dismiss")}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-status-watch/15 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </motion.div>
  );
}
