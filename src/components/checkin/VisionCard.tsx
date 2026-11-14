"use client";

import { motion } from "framer-motion";
import { Eye } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * The text to read during the vision self-check. Shown while Cosmo is asking the vision question: three lines in
 * decreasing size (a tiny reading chart), with how to do the check. Read with one eye covered, then the other.
 */
export function VisionCard() {
  const { t } = useI18n();
  return (
    <motion.section
      data-slot="vision-card"
      aria-label={t("checkin.vision.title")}
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 160, damping: 22 }}
      className="fixed top-20 left-1/2 z-40 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[28px] border border-white/80 bg-white/90 px-7 py-6 shadow-[0_30px_70px_-30px_rgba(40,80,160,0.55)] backdrop-blur-xl"
    >
      <p className="flex items-center gap-2 text-[13px] font-medium tracking-wide text-[var(--aegis-label,#5B6678)] uppercase">
        <Eye className="size-4" aria-hidden />
        {t("checkin.vision.title")}
      </p>
      <p className="mt-1.5 text-[14px] leading-snug text-[var(--aegis-muted,#5B6678)]">{t("checkin.vision.steps")}</p>
      <div className="mt-5 space-y-3 text-[var(--aegis-ink,#0F1B2D)]">
        <p className="text-[26px] leading-tight font-medium">{t("checkin.vision.line1")}</p>
        <p className="text-[18px] leading-snug">{t("checkin.vision.line2")}</p>
        <p className="text-[13px] leading-snug">{t("checkin.vision.line3")}</p>
      </div>
    </motion.section>
  );
}
