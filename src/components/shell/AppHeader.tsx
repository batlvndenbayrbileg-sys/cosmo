"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { LanguageToggle } from "./LanguageToggle";

export interface AppHeaderProps {
  /** defaults to the app title ("AEGIS") */
  title?: string;
  crewName?: string;
  missionDay?: number;
  /** extra controls placed before the language toggle */
  right?: ReactNode;
}

function Mark() {
  // small constellation-style mark: ring with three stars (circle, triangle, diamond)
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="12" fill="none" strokeWidth="1.5" className="stroke-primary" />
      <circle cx="16" cy="4.5" r="2.6" className="fill-status-ok" />
      <polygon points="26 21.6 29.2 27 22.8 27" className="fill-status-watch" />
      <polygon points="6 20 8.4 22.8 6 25.6 3.6 22.8" className="fill-status-alert" />
    </svg>
  );
}

export function AppHeader({ title, crewName, missionDay, right }: AppHeaderProps) {
  const { t } = useI18n();

  return (
    <header
      data-slot="app-header"
      className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85"
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label={t("shell.header.home")}
          className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Mark />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-lg font-semibold tracking-wide text-foreground">
              {title ?? t("shell.title")}
            </span>
            <span className="truncate text-sm text-muted-foreground">{t("shell.subtitle")}</span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {crewName || missionDay !== undefined ? (
            <div className="flex flex-col items-end leading-tight">
              {crewName ? (
                <span className="text-base font-medium text-foreground">{crewName}</span>
              ) : null}
              {missionDay !== undefined ? (
                <span className="tnum text-sm text-muted-foreground">
                  {t("shell.header.missionDay", { day: missionDay })}
                </span>
              ) : null}
            </div>
          ) : null}
          {right}
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
