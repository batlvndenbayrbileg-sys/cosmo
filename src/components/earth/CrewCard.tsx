"use client";

import Link from "next/link";
import { ArrowRight, BellRing, Clock3 } from "lucide-react";
import type { CrewStatusCard } from "@/lib/types";
import { ConstellationGlyph, StatusGlyph, StatusPill, statusWordKey } from "@/components/status";
import { MascotPortrait } from "@/components/crew/MascotPortrait";
import { roleKey } from "@/components/crew/roles";
import { crewCardReadiness, formatClockLabel } from "@/components/dashboard/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { DelayId } from "./delay";

/**
 * Crew status card on the Earth console (design v2 glass card): mascot portrait, name and role,
 * an alert badge, the vitals constellation, the overall status pill, readiness and the last
 * check-in. The whole card opens that crew member's read-only dashboard.
 */
export function CrewCard({ card, delayId }: { card: CrewStatusCard; delayId: DelayId }) {
  const { t, lang } = useI18n();
  const { crew } = card;
  const red = card.overall === "red";
  // sparse data: the engine reports a bare 0, which must never be shown as a real readiness
  const readiness = crewCardReadiness(card);
  const key = roleKey(crew.role);
  const role = key ? t(key) : crew.role;

  return (
    <Link
      href={`/earth/${encodeURIComponent(crew.id)}?delay=${delayId}`}
      aria-label={[
        t("earth.crew.cardLabel", { name: crew.name, role }),
        t(statusWordKey(card.overall)),
        readiness === null
          ? t("earth.crew.readinessNone")
          : t("earth.crew.readiness", { value: Math.round(readiness) }),
        t("earth.crew.openAlerts", { count: card.openAlerts }),
        t("earth.crew.open"),
      ].join(". ")}
      data-slot="crew-card"
      data-crew={crew.id}
      className={cn(
        "glass-card group flex h-full flex-col gap-4 p-4 outline-none sm:p-5",
        "transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1",
        "hover:shadow-[0_26px_50px_-24px_rgba(40,80,160,0.45)]",
        "focus-visible:ring-4 focus-visible:ring-[color:var(--aegis-accent)]/45",
        red && "ring-2 ring-status-alert/45",
      )}
    >
      {/* identity row */}
      <div className="flex items-center gap-3">
        <MascotPortrait variant={crew.mascotVariant} size={52} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[19px] font-medium text-[color:var(--aegis-ink)]">{crew.name}</span>
          <span className="line-clamp-2 text-[13px] text-[color:var(--aegis-label)]">{role}</span>
        </div>
        {red ? (
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-status-alert/35 bg-status-alert-soft px-2.5 text-[12px] font-medium text-status-alert-ink">
            <StatusGlyph status="red" size={12} labelled={false} />
            {t("earth.crew.alertBadge")}
          </span>
        ) : null}
      </div>

      {/* constellation + numbers */}
      <div className="flex items-center gap-4">
        <div className="shrink-0 rounded-full bg-white/80 p-1 ring-1 ring-[color:var(--aegis-hairline)]">
          <ConstellationGlyph stars={card.stars} readiness={readiness} size={124} label={crew.name} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <StatusPill status={card.overall} size="lg" className="self-start" />
          {readiness === null ? (
            <span className="text-[13px] text-[color:var(--aegis-label)]">{t("earth.crew.readinessNone")}</span>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <span className="unit-label">{t("earth.crew.lastLabel")}</span>
            <span className="tnum flex items-center gap-1.5 text-[15px] text-[color:var(--aegis-ink)]">
              <Clock3 className="size-3.5 shrink-0 text-[color:var(--aegis-label)]" aria-hidden="true" />
              {card.lastCheckInAt ? formatClockLabel(card.lastCheckInAt, lang) : t("earth.crew.never")}
            </span>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[color:var(--aegis-hairline)] pt-3">
        <span className="tnum flex min-w-0 items-center gap-1.5 text-[13px] text-[color:var(--aegis-label)]">
          <BellRing className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("earth.crew.openAlerts", { count: card.openAlerts })}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate font-medium text-[color:var(--aegis-ink)] group-hover:text-[color:var(--aegis-accent-deep)]">
            {t("earth.crew.open")}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--aegis-ink)] text-white transition-colors duration-300 group-hover:bg-[color:var(--aegis-accent-deep)]"
        >
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
