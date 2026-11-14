"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/** Always-visible footer notice: prototype, demo thresholds, simulated history. */
export function PrototypeRibbon({ className }: { className?: string }) {
  const { t } = useI18n();

  return (
    <footer
      data-slot="prototype-ribbon"
      className={cn(
        "sticky bottom-0 z-30 border-t border-border bg-secondary px-4 py-1.5 text-center text-xs text-muted-foreground sm:px-6",
        className,
      )}
    >
      {t("shell.ribbon.text")}
    </footer>
  );
}
