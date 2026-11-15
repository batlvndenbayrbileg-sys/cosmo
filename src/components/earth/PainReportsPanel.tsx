"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Activity, ShieldAlert } from "lucide-react";
import { LOCATION_LABEL, PAIN_POLL_MS, onsetText, severityText, type GroundPainReport } from "@/lib/pain";
import { findBuiltInGuide } from "@/lib/emergency";
import { formatClockLabel } from "@/components/dashboard/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { groundGet } from "./api";
import type { DelayId } from "./delay";

/** how many pain reports the panel shows (newest first) */
const MAX_SHOWN = 4;

/**
 * The Earth console's pain reports (src/server/pain.ts): what the crew told Cosmo hurts, how much and since when, and
 * which of their own values were unusual for that place. Polled like the SOS strip; an urgent one also arrived as an
 * SOS above. Renders nothing while there is none.
 */
export function PainReportsPanel({ delayMs, delayId, crewId }: { delayMs: number; delayId: DelayId; crewId?: string }) {
  const { t, lang, pick } = useI18n();
  const [reports, setReports] = useState<GroundPainReport[]>([]);
  const query = `delayMs=${delayMs}${crewId ? `&crewId=${encodeURIComponent(crewId)}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      groundGet<GroundPainReport[]>(`/api/ground/pain?${query}`, signal).then(
        (data) => {
          if (!cancelled && !signal.aborted) setReports(data ?? []);
        },
        () => {
          // a hiccup: keep what is shown, the next poll tries again
        },
      );
    };
    load();
    const id = window.setInterval(load, PAIN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      controller?.abort();
    };
  }, [query]);

  const shown = reports.slice(0, MAX_SHOWN);
  if (shown.length === 0) return null;

  return (
    <MotionConfig reducedMotion="user">
      <section
        data-slot="pain-panel"
        aria-labelledby="pain-panel-title"
        className="rounded-[var(--aegis-radius-card)] border border-[#2f5bd3]/25 bg-gradient-to-br from-[#EEF4FF] via-white to-[#E3ECFF] p-4 sm:p-5"
      >
        <header className="mb-3 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--aegis-accent-deep)] text-white">
            <Activity className="size-5" aria-hidden />
          </span>
          <h2 id="pain-panel-title" className="text-[20px] font-semibold tracking-tight text-[var(--aegis-ink)]">
            {t("emergency.pain.earth.title")}
          </h2>
        </header>
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {shown.map((r) => {
              const place = r.location ? pick(LOCATION_LABEL[r.location]) : t("emergency.pain.earth.unknownPlace");
              const sev = severityText(r.severity, lang);
              const since = onsetText(r.onset, lang);
              const guide = r.guideId ? findBuiltInGuide(r.guideId) : null;
              return (
                <motion.li
                  key={r.id}
                  layout
                  data-pain-report={r.id}
                  data-urgent={r.urgent ? "true" : "false"}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-[20px] bg-white/90 p-3.5 ring-1",
                    r.urgent ? "ring-2 ring-[#C53030]/60" : "ring-[var(--aegis-hairline)]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/earth/${encodeURIComponent(r.crewId)}?delay=${delayId}`}
                      className="min-w-0 flex-1 truncate rounded text-[17px] font-semibold text-[var(--aegis-ink)] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--aegis-accent)]"
                    >
                      {t("emergency.pain.earth.place", { name: r.crewName, place })}
                    </Link>
                    {r.urgent ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#C53030] px-2.5 py-0.5 text-[11px] font-bold tracking-[0.12em] text-white uppercase">
                        <ShieldAlert className="size-3.5" aria-hidden />
                        {t("emergency.pain.urgent")}
                      </span>
                    ) : null}
                  </div>
                  <p className="tnum text-[13px] text-[var(--aegis-label)]">
                    {t("emergency.pain.earth.at", { time: formatClockLabel(r.sentAt, lang) })}
                    {sev ? ` · ${t("emergency.pain.earth.severity", { value: sev })}` : ""}
                    {since ? ` · ${t("emergency.pain.earth.onset", { value: since })}` : ""}
                  </p>
                  {r.redFlags.length > 0 ? (
                    <p className="text-[13px] text-[#9B2C2C]">{r.redFlags.map((f) => t(`emergency.pain.flag.${f}`)).join(" · ")}</p>
                  ) : null}
                  {guide ? <p className="text-[13px] text-[var(--aegis-ink)]">{t("emergency.pain.earth.guide", { guide: pick(guide.title) })}</p> : null}
                  {r.items.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--aegis-accent-deep)] uppercase">{t("emergency.pain.earth.related")}</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {r.items.map((i) => (
                          <li key={i.id} className="rounded-full bg-[var(--aegis-pastel-blue)] px-2.5 py-0.5 text-[12.5px] text-[var(--aegis-ink)]">
                            {pick(i.label)}: <span className="tnum font-medium">{pick(i.valueText)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[var(--aegis-label)]">{t("emergency.pain.earth.none")}</p>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </section>
    </MotionConfig>
  );
}
