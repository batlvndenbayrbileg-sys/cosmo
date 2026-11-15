"use client";

import type { ReactNode } from "react";
import { Languages } from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import { StatusGlyph } from "@/components/status";
import { statusWordKey } from "@/components/status/statusClasses";
import { useI18n } from "@/i18n/I18nProvider";
import { isReadinessAvailable } from "@/lib/health/scores";
import { cn } from "@/lib/utils";
import { formatClockLabel, wellbeingSummary, type Viewer } from "./logic";
import { MascotPicture } from "./parts";

/** crew name in two lines (name / role) with the mission-day label on the right, plus the check-in meta line */
export function CrewHeading({
  payload,
  viewer,
  extra,
}: {
  payload: DashboardPayload;
  viewer: Viewer;
  /** optional pill at the end of the meta line (the open-alerts chip on the overview) */
  extra?: ReactNode;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="flex flex-col gap-2 lg:gap-[clamp(4px,0.8vh,8px)]">
      <div className="flex items-start justify-between gap-3">
        <h1 className="flex flex-col leading-[1.05] text-[var(--cosmo-ink)] dash-tight:flex-row dash-tight:flex-wrap dash-tight:items-baseline dash-tight:gap-x-2">
          <span className="text-[34px] font-normal tracking-tight lg:text-[clamp(24px,3.5vh,34px)] dash-tight:text-[24px]">{payload.crew.name}</span>
          <span className="text-[26px] font-light tracking-tight text-[var(--cosmo-label)] lg:text-[clamp(18px,2.7vh,26px)] dash-tight:text-[17px]">{payload.crew.role}</span>
        </h1>
        <span className="tnum mt-1 shrink-0 rounded-full bg-white/70 px-3 py-1 text-[12px] font-medium text-[var(--cosmo-label)] ring-1 ring-[var(--cosmo-hairline)]">
          {t("dashboard.profile.missionDay", { day: payload.missionDay })}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--cosmo-label)]">
        <span className="tnum">
          {t("dashboard.checkIn.confirmed", { time: formatClockLabel(payload.checkIn.confirmedAt, lang) })}
        </span>
        {payload.simulatedHistory ? (
          <span className="rounded-full bg-[var(--cosmo-pastel-lilac)] px-2 py-0.5 font-medium text-[#5b3fa8]">
            {t("dashboard.simulatedHistory")}
          </span>
        ) : null}
        {viewer === "ground" ? (
          <span className="rounded-full bg-white px-2 py-0.5 font-medium ring-1 ring-[var(--cosmo-hairline)]">
            {t("dashboard.viewer.ground")}
          </span>
        ) : null}
        {extra}
      </p>
    </div>
  );
}

/** the pill row: overall status, readiness, mission day, language (overlaps the profile card on desktop) */
export function StatPills({ payload, className }: { payload: DashboardPayload; className?: string }) {
  const { t } = useI18n();
  const readinessAvailable = isReadinessAvailable(payload.axes);
  // the short wellbeing check at a glance (details on the Vitals tab)
  const wellbeing = wellbeingSummary(new Map(payload.kpis.map((k) => [k.key, k])));
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <li className="pill min-h-[32px]! gap-1! px-2.5! text-[14px]! dash-tight:min-h-[28px]! dash-tight:px-2! dash-tight:text-[13px]!" data-status={payload.overall}>
        <StatusGlyph status={payload.overall} size={15} labelled={false} />
        <span className="text-[13px]">{t(statusWordKey(payload.overall))}</span>
      </li>
      <li className="pill min-h-[32px]! gap-1! px-2.5! text-[14px]! dash-tight:min-h-[28px]! dash-tight:px-2! dash-tight:text-[13px]! tnum" aria-label={readinessAvailable ? t("dashboard.readiness.aria", { value: payload.readiness }) : t("dashboard.readiness.unavailable")}>
        <span aria-hidden="true">{readinessAvailable ? payload.readiness : "–"}</span>
        <span aria-hidden="true" className="text-[11px] font-normal text-[var(--cosmo-label)]">
          {t("dashboard.profile.readiness")}
        </span>
      </li>
      {wellbeing.status !== "no_data" ? (
        <li
          data-slot="wellbeing-pill"
          data-status={wellbeing.status}
          className="pill min-h-[32px]! gap-1! px-2.5! text-[14px]! dash-tight:min-h-[28px]! dash-tight:px-2! dash-tight:text-[13px]!"
          aria-label={t("dashboard.profile.wellbeingAria", { status: t(statusWordKey(wellbeing.status)) })}
        >
          <StatusGlyph status={wellbeing.status} size={13} labelled={false} />
          <span aria-hidden="true" className="text-[11px] font-normal text-[var(--cosmo-label)]">
            {t("dashboard.profile.wellbeing")}
          </span>
        </li>
      ) : null}
      <li className="pill min-h-[32px]! gap-1! px-2.5! text-[14px]! dash-tight:min-h-[28px]! dash-tight:px-2! dash-tight:text-[13px]! tnum">
        <span>{payload.missionDay}</span>
        <span className="text-[11px] font-normal text-[var(--cosmo-label)]">{t("dashboard.profile.day")}</span>
      </li>
      <li className="pill min-h-[32px]! gap-1! px-2.5! text-[14px]! dash-tight:min-h-[28px]! dash-tight:px-2! dash-tight:text-[13px]!">
        <Languages aria-hidden="true" className="size-3.5 text-[var(--cosmo-label)]" strokeWidth={1.8} />
        <span className="sr-only">{t("dashboard.profile.lang")}: </span>
        <span>{payload.crew.preferredLanguage === "mn" ? "МН" : "EN"}</span>
      </li>
    </ul>
  );
}

/** the reference's profile photo card: the crew's Cosmo render fading into the stat pills */
export function ProfileCard({ payload }: { payload: DashboardPayload }) {
  const { t } = useI18n();
  return (
    <div data-slot="profile-card" className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="glass-card relative h-[250px] overflow-hidden lg:h-auto lg:min-h-[84px] lg:flex-1 dash-tight:hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 55% at 50% 42%, rgba(214,228,255,0.95), rgba(255,255,255,0) 70%), linear-gradient(180deg, #f3f7ff 0%, #ffffff 100%)",
          }}
        />
        <MascotPicture
          variant={payload.crew.mascotVariant}
          alt={t("dashboard.profile.mascot", { name: payload.crew.name })}
          className="absolute top-3 left-1/2 h-[118%] w-auto max-w-none -translate-x-1/2"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-24"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.96) 75%)" }}
        />
      </div>
      <StatPills payload={payload} className="relative z-10 -mt-6 justify-center px-1 dash-tight:mt-0 dash-tight:justify-start dash-tight:px-0" />
      <p className="mt-2 text-center text-[11px] leading-snug text-[var(--cosmo-label)] lg:mt-1.5 lg:line-clamp-1 dash-tight:text-left">
        {t("dashboard.profile.readinessNote")}
      </p>
    </div>
  );
}
