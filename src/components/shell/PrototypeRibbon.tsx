"use client";

import { FlaskConical } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/**
 * Always-visible honesty notice: prototype, demo thresholds, simulated history.
 * Design v2: a small frosted pill fixed at the very bottom of the viewport, centred, above every
 * screen (including the chrome-free check-in). It never takes pointer focus away from the page:
 * only the pill itself receives pointer events.
 */
export function PrototypeRibbon({ className }: { className?: string }) {
  const { t } = useI18n();

  return (
    <footer
      data-slot="prototype-ribbon"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <p
        className={cn(
          "pointer-events-auto flex max-w-[min(100%,56rem)] items-center gap-2 rounded-full px-3.5 py-1",
          "border border-white/70 bg-white/55 text-[11px] leading-snug text-[color:var(--cosmo-label)]",
          "shadow-[0_6px_20px_-12px_rgba(40,80,160,0.35)] backdrop-blur-md backdrop-saturate-150",
        )}
      >
        <FlaskConical className="size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>{t("shell.ribbon.text")}</span>
      </p>
    </footer>
  );
}
