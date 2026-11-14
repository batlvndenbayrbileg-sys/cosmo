"use client";

import Link from "next/link";
import { Activity, Bell, CalendarDays, LayoutGrid, ListChecks, Satellite, type LucideIcon } from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { AlertsStrip } from "./AlertsStrip";
import type { Viewer } from "./logic";
import { MascotPicture } from "./parts";

export type NavSection = "overview" | "vitals" | "plan" | "trends" | "earth";

export const NAV_ITEMS: ReadonlyArray<{ id: NavSection; icon: LucideIcon }> = [
  { id: "overview", icon: LayoutGrid },
  { id: "vitals", icon: Activity },
  { id: "plan", icon: ListChecks },
  { id: "trends", icon: CalendarDays },
  { id: "earth", icon: Satellite },
];

const ROUND_BTN =
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-[var(--aegis-ink)] shadow-[0_4px_14px_-8px_rgba(40,80,160,0.35)] ring-1 ring-[var(--aegis-hairline)] outline-none transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_8px_18px_-8px_rgba(40,80,160,0.4)] focus-visible:ring-3 focus-visible:ring-ring/60";

function Mark() {
  // AEGIS mark: ring with three status stars (circle, triangle, diamond)
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="12" fill="none" strokeWidth="1.8" stroke="var(--aegis-accent-deep)" />
      <circle cx="16" cy="4.5" r="2.6" className="fill-status-ok" />
      <polygon points="26 21.6 29.2 27 22.8 27" className="fill-status-watch" />
      <polygon points="6 20 8.4 22.8 6 25.6 3.6 22.8" className="fill-status-alert" />
    </svg>
  );
}

export function TopBar({
  payload,
  viewer,
  active,
  onNavigate,
}: {
  payload: DashboardPayload;
  viewer: Viewer;
  active: NavSection;
  onNavigate: (section: NavSection) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const open = payload.alerts.filter((a) => a.acknowledgedAt === null).length;

  return (
    <div data-slot="dashboard-topbar" className="flex items-center gap-3 md:gap-4">
      <Link href="/" aria-label={t("dashboard.top.home")} className={cn(ROUND_BTN, "size-11")}>
        <Mark />
      </Link>

      <nav aria-label={t("dashboard.nav.label")} className="mx-auto hidden min-w-0 md:block">
        <ul className="flex items-center gap-1 rounded-full bg-[rgba(15,27,45,0.05)] p-1 ring-1 ring-white/70">
          {NAV_ITEMS.map(({ id, icon: Icon }) => {
            const current = id === active;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => onNavigate(id)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full px-4 text-[15px] whitespace-nowrap text-[var(--aegis-label)] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/60",
                    current
                      ? "bg-white font-medium text-[var(--aegis-ink)] shadow-[0_4px_12px_-6px_rgba(40,80,160,0.35)]"
                      : "hover:bg-white/60 hover:text-[var(--aegis-ink)]",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
                  <span className={cn(!current && "hidden lg:inline")}>{t(`dashboard.nav.${id}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-2.5 md:ml-0">
        <div className="hidden items-center gap-2.5 pr-1 lg:flex">
          <span className="relative size-11 overflow-hidden rounded-full bg-[var(--aegis-pastel-blue)] ring-2 ring-white">
            <MascotPicture
              variant={payload.crew.mascotVariant}
              className="absolute top-[2px] left-1/2 w-[150%] max-w-none -translate-x-1/2"
            />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[11px] text-[var(--aegis-label)]">
              {viewer === "ground" ? t("dashboard.viewer.ground") : t("dashboard.top.welcome")}
            </span>
            <span className="text-[15px] font-medium text-[var(--aegis-ink)]">{payload.crew.name}</span>
          </span>
        </div>

        <Popover>
          <PopoverTrigger
            className={ROUND_BTN}
            aria-label={open > 0 ? t("dashboard.top.alertsOpen", { n: open }) : t("dashboard.top.alerts")}
          >
            <Bell aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
            {open > 0 ? (
              <span
                aria-hidden="true"
                className="absolute top-2 right-2.5 size-2.5 rounded-full bg-status-alert ring-2 ring-white"
              />
            ) : null}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            className="w-[min(24rem,calc(100vw-2rem))] rounded-[22px] border border-white/80 bg-white/90 p-2 shadow-[0_24px_60px_-24px_rgba(40,80,160,0.45)] backdrop-blur-xl"
          >
            {payload.alerts.length === 0 ? (
              <p className="px-3 py-2.5 text-[15px] text-[var(--aegis-label)]">{t("dashboard.top.noAlerts")}</p>
            ) : (
              <AlertsStrip alerts={payload.alerts} viewer={viewer} />
            )}
          </PopoverContent>
        </Popover>

        <button
          type="button"
          aria-label={lang === "en" ? t("dashboard.top.toMn") : t("dashboard.top.toEn")}
          onClick={() => setLang(lang === "en" ? "mn" : "en")}
          className={cn(ROUND_BTN, "text-[13px] font-semibold tracking-wide")}
        >
          {lang === "en" ? "EN" : "МН"}
        </button>
      </div>
    </div>
  );
}
