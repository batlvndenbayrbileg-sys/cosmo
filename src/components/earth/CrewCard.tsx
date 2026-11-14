"use client";

import Link from "next/link";
import type { CrewStatusCard } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConstellationGlyph, StatusGlyph, StatusPill } from "@/components/status";
import { crewCardReadiness, formatClockLabel } from "@/components/dashboard/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { DelayId } from "./delay";

/** Crew status card on the Earth console: identity glyph, overall pill, readiness, last check-in, open alerts. */
export function CrewCard({ card, delayId }: { card: CrewStatusCard; delayId: DelayId }) {
  const { t, lang } = useI18n();
  const { crew } = card;
  const red = card.overall === "red";
  // sparse data: the engine reports a bare 0, which must never be shown as a real readiness
  const readiness = crewCardReadiness(card);

  return (
    <Link
      href={`/earth/${encodeURIComponent(crew.id)}?delay=${delayId}`}
      aria-label={`${t("earth.crew.cardLabel", { name: crew.name, role: crew.role })}. ${t("earth.crew.open")}`}
      data-slot="crew-card"
      data-crew={crew.id}
      className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card
        className={cn(
          "h-full gap-3 transition-shadow group-hover:shadow-md",
          red && "ring-2 ring-status-alert/50",
        )}
      >
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <ConstellationGlyph
            stars={card.stars}
            readiness={readiness}
            size={132}
            label={crew.name}
          />
          <div className="flex flex-col gap-0.5">
            <p className="text-xl font-semibold text-foreground">{crew.name}</p>
            <p className="text-base text-muted-foreground">{crew.role}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <StatusPill status={card.overall} size="md" />
            {red ? (
              <Badge className="h-6 gap-1.5 border border-status-alert/40 bg-status-alert-soft px-2.5 text-xs text-status-alert-ink">
                <StatusGlyph status="red" size={12} labelled={false} />
                {t("earth.crew.alertBadge")}
              </Badge>
            ) : null}
          </div>
          <p className="tnum text-base text-foreground">
            {readiness === null
              ? t("earth.crew.readinessNone")
              : t("earth.crew.readiness", { value: Math.round(readiness) })}
          </p>
          <p className="tnum text-sm text-muted-foreground">
            {card.lastCheckInAt
              ? t("earth.crew.lastCheckIn", { time: formatClockLabel(card.lastCheckInAt, lang) })
              : t("earth.crew.noCheckIn")}
          </p>
          <p className="tnum text-sm text-muted-foreground">
            {t("earth.crew.openAlerts", { count: card.openAlerts })}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
