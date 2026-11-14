"use client";

import { memo, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CHECKIN_TARGET_KEYS, formatValue, getKpi } from "@/lib/kpi/registry";
import { useI18n } from "@/i18n/I18nProvider";
import { KpiCard } from "./KpiCard";
import type { CaptureCard } from "./state";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function desktopSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_QUERY).matches
    : true;
}

const TARGET_KEYS: ReadonlySet<string> = new Set(CHECKIN_TARGET_KEYS);

/**
 * Captured cards: on the right of Cosmo on desktop (cards slide in from the right), below her on
 * mobile (cards slide up). Newest first. A visually hidden live region announces each capture.
 */
export const KpiCardRail = memo(function KpiCardRail({ cards }: { cards: readonly CaptureCard[] }) {
  const { t, lang } = useI18n();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => true);

  const captured = cards.filter((c) => TARGET_KEYS.has(c.key)).length;
  const total = CHECKIN_TARGET_KEYS.length;
  const newest = cards[0];

  return (
    <section
      data-slot="kpi-rail"
      aria-label={t("checkin.cards.title")}
      className="flex min-h-0 flex-col gap-3 lg:h-full"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("checkin.cards.title")}</h2>
          <span className="tnum text-sm text-muted-foreground">
            {t("checkin.cards.count", { count: captured, total })}
          </span>
        </div>
        <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${Math.min(100, (captured / total) * 100)}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {newest
          ? t("checkin.card.captured", {
              label: getKpi(newest.key).labels[lang],
              value: formatValue(newest.key, newest.value, lang),
              status: t(`shell.status.${newest.status}`),
            })
          : ""}
      </p>

      {cards.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-base text-muted-foreground">
          {t("checkin.cards.empty")}
        </p>
      ) : (
        <ul role="list" className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-1 lg:flex-1 lg:pr-1">
          <AnimatePresence initial={false}>
            {cards.map((card) => (
              <motion.li
                key={card.key}
                layout
                initial={desktop ? { opacity: 0, x: 48 } : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 28 }}
              >
                <KpiCard card={card} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
});
