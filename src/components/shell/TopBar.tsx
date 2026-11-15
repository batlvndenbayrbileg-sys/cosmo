"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { CosmoMark } from "./CosmoMark";
import { LanguageToggle } from "./LanguageToggle";

export interface TopBarProps {
  /** shown next to the logo button (defaults to the "Cosmo / health companion" wordmark) */
  brand?: ReactNode;
  /** optional centre slot (a title pill, a segmented nav...) */
  center?: ReactNode;
  /** extra controls placed before the language toggle */
  right?: ReactNode;
  /** where the logo button leads (default "/") */
  homeHref?: string;
  className?: string;
}

/**
 * Glass top bar used INSIDE a glass frame (<PageFrame>): round white logo button on the left, an
 * optional centre slot, and the EN / МН language toggle on the right. On phones the centre slot
 * wraps to its own full-width row under the logo and the toggle.
 */
export function TopBar({ brand, center, right, homeHref = "/", className }: TopBarProps) {
  const { t } = useI18n();

  return (
    <header
      data-slot="top-bar"
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3",
        center ? "md:grid-cols-[1fr_auto_1fr]" : null,
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={homeHref}
          aria-label={t("shell.header.home")}
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white outline-none",
            "border border-[color:var(--cosmo-hairline)] shadow-[0_6px_18px_-10px_rgba(40,80,160,0.45)]",
            "transition-transform duration-200 hover:scale-[1.04] focus-visible:ring-3 focus-visible:ring-[color:var(--cosmo-accent)]/45",
          )}
        >
          <CosmoMark />
        </Link>
        {brand === undefined ? (
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="truncate text-[15px] font-semibold tracking-[0.14em] text-[color:var(--cosmo-ink)]">
              {t("shell.title")}
            </span>
            <span className="truncate text-[11px] text-[color:var(--cosmo-label)]">{t("shell.subtitle")}</span>
          </span>
        ) : (
          brand
        )}
      </div>

      {center ? (
        <div className="order-last col-span-2 flex min-w-0 justify-center md:order-none md:col-span-1">
          {center}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {right}
        <LanguageToggle />
      </div>
    </header>
  );
}

/**
 * Light rounded "track" pill for the TopBar centre slot (like the reference's segmented nav).
 * Children are free-form (icon + text).
 */
export function TopBarTrack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-white/80 bg-[rgba(15,27,45,0.05)] px-1.5 py-1",
        className,
      )}
    >
      {children}
    </div>
  );
}
