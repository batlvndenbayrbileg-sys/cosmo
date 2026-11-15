"use client";

import { TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

/** Calm error box with a retry button (design v2 glass card). */
export function ErrorNotice({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div role="alert" className="glass-card flex max-w-xl items-start gap-3 p-4 sm:p-5">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-status-alert-soft text-status-alert-ink">
        <TriangleAlert className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[16px] font-medium text-[color:var(--cosmo-ink)]">{title}</p>
        {detail ? <p className="text-[14px] text-[color:var(--cosmo-label)]">{detail}</p> : null}
        {onRetry ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-10 items-center rounded-full bg-[color:var(--cosmo-ink)] px-5 text-[14px] font-medium text-white outline-none hover:bg-[color:var(--cosmo-accent-deep)] focus-visible:ring-4 focus-visible:ring-[color:var(--cosmo-accent)]/45"
            >
              {t("shell.action.retry")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
