"use client";

import { Info, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/**
 * Non-blocking notice at the top of a screen, e.g. "Voice unavailable - using text input".
 * `role="status"` announces it politely; it never steals focus or covers the content.
 */
export function FallbackBanner({
  message,
  onDismiss,
  className,
}: {
  message: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div
      role="status"
      data-slot="fallback-banner"
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-status-watch/30 bg-status-watch-soft px-4 py-2.5 text-base text-status-watch-ink",
        className,
      )}
    >
      <Info className="size-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("shell.action.dismiss")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-status-watch/15 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
