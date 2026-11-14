"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DashboardPayload, HazardKey, KpiKey, KpiStat } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConstellationGlyph, StatusPill } from "@/components/status";
import { useShellHeader } from "@/components/shell";
import { useI18n } from "@/i18n/I18nProvider";
import { isReadinessAvailable } from "@/lib/health/scores";
import { AlertsStrip } from "./AlertsStrip";
import { CosmoDock } from "./CosmoDock";
import { DayArc } from "./DayArc";
import { EarthLinkCard } from "./EarthLinkCard";
import { HazardLens } from "./HazardLens";
import { HealthRadar } from "./HealthRadar";
import { KpiCard } from "./KpiCard";
import { ReadinessOrb } from "./ReadinessOrb";
import { TodayPlan } from "./TodayPlan";
import { cardsRelatedToHazard, buildKpiCards, formatClockLabel, sortCardsForHazard } from "./logic";
import { Reveal } from "./motion";

/**
 * Contract between the check-in lane and the dashboard lane. The props are fixed.
 *
 * - `viewer: "crew"`   the astronaut's own dashboard (Cosmo docked bottom-right)
 * - `viewer: "ground"` read-only Earth console view (no Cosmo dock, no replay, no free-text notes)
 * - `dockSlot`         optional element rendered inside the Cosmo dock. The check-in screen passes
 *                      its shared Cosmo element (a motion.div with layoutId COSMO_LAYOUT_ID) so
 *                      framer-motion can animate Cosmo from the full-screen stage into the dock
 *                      inside ONE React tree. When absent the dock renders its own CosmoAvatar.
 *
 * Entrance animation can be switched off from outside with <DashboardMotionProvider animate={false}>.
 */
export interface DashboardViewProps {
  payload: DashboardPayload;
  viewer: "crew" | "ground";
  dockSlot?: ReactNode;
}

export function DashboardView({ payload, viewer, dockSlot }: DashboardViewProps) {
  const { t, lang } = useI18n();
  const [selectedHazard, setSelectedHazard] = useState<HazardKey | null>(null);

  useShellHeader({
    crewName: `${payload.crew.name} · ${payload.crew.role}`,
    missionDay: payload.missionDay,
  });

  const byKey = useMemo(
    () => new Map<KpiKey, KpiStat>(payload.kpis.map((k) => [k.key, k])),
    [payload.kpis],
  );
  const cards = useMemo(() => buildKpiCards(payload.kpis, viewer), [payload.kpis, viewer]);
  const hazardStat = payload.hazards.find((h) => h.hazard === selectedHazard) ?? null;
  const ordered = useMemo(() => sortCardsForHazard(cards, hazardStat), [cards, hazardStat]);
  const related = useMemo(() => cardsRelatedToHazard(cards, hazardStat), [cards, hazardStat]);

  const readinessAvailable = isReadinessAvailable(payload.axes);
  const stars = payload.kpis.map((k) => ({ key: k.key, status: k.status }));

  return (
    <div data-slot="dashboard" data-viewer={viewer} className="flex flex-col gap-6">
      {/* header */}
      <Reveal index={0}>
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-muted-foreground">{t("dashboard.title")}</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{payload.crew.name}</h1>
            <p className="text-lg text-muted-foreground">
              {payload.crew.role} · {t("shell.header.missionDay", { day: payload.missionDay })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("dashboard.overall")}</span>
              <StatusPill status={payload.overall} size="lg" />
            </span>
            <span className="tnum text-sm text-muted-foreground">
              {t("dashboard.checkIn.confirmed", {
                time: formatClockLabel(payload.checkIn.confirmedAt, lang),
              })}
            </span>
            {viewer === "ground" ? (
              <Badge variant="outline" className="h-6 px-2.5 text-xs">
                {t("dashboard.viewer.ground")}
              </Badge>
            ) : null}
            {payload.simulatedHistory ? (
              <Badge variant="secondary" className="h-6 px-2.5 text-xs">
                {t("dashboard.simulatedHistory")}
              </Badge>
            ) : null}
          </div>
        </header>
      </Reveal>

      {payload.overall === "no_data" ? (
        <p
          role="status"
          className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-base text-muted-foreground"
        >
          {t("dashboard.noDataBanner")}
        </p>
      ) : null}

      {/* row 1: constellation + readiness | radar | alerts + Earth link */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <Reveal index={1} className="xl:col-span-4">
          <Card data-slot="hero" className="h-full gap-3">
            <CardHeader>
              <CardTitle className="text-lg">{t("dashboard.readiness.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
                <div className="flex flex-col items-center gap-1">
                  <ConstellationGlyph
                    stars={stars}
                    readiness={readinessAvailable ? payload.readiness : null}
                    size={200}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("dashboard.constellation.caption")}
                  </span>
                </div>
                <ReadinessOrb
                  readiness={payload.readiness}
                  baseline={payload.readinessBaseline}
                  available={readinessAvailable}
                  overall={payload.overall}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("dashboard.readiness.explain")}</p>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal index={2} className="xl:col-span-4">
          <Card data-slot="radar-card" className="h-full gap-3">
            <CardHeader>
              <CardTitle className="text-lg">{t("dashboard.radar.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("dashboard.radar.subtitle")}</p>
            </CardHeader>
            <CardContent>
              <HealthRadar axes={payload.axes} />
            </CardContent>
          </Card>
        </Reveal>

        <Reveal index={3} className="flex flex-col gap-4 lg:col-span-2 xl:col-span-4">
          <AlertsStrip alerts={payload.alerts} viewer={viewer} />
          <EarthLinkCard link={payload.link} viewer={viewer} />
        </Reveal>
      </div>

      {/* row 2: hazard lens + day arc */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Reveal index={4} className="xl:col-span-7">
          <HazardLens hazards={payload.hazards} selected={selectedHazard} onSelect={setSelectedHazard} />
        </Reveal>
        <Reveal index={5} className="xl:col-span-5">
          <DayArc dayArc={payload.dayArc} />
        </Reveal>
      </div>

      {/* row 3: today's plan */}
      <Reveal index={6}>
        <TodayPlan tasks={payload.tasks} selectedHazard={hazardStat} />
      </Reveal>

      {/* row 4: vitals grid */}
      <section aria-labelledby="vitals-title" data-slot="vitals" className="flex flex-col gap-3">
        <Reveal index={7}>
          <div className="flex flex-col gap-0.5">
            <h2 id="vitals-title" className="text-xl font-semibold text-foreground">
              {t("dashboard.vitals.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("dashboard.vitals.subtitle")}</p>
            <p className="text-sm text-muted-foreground">{t("dashboard.vitals.legend")}</p>
            {hazardStat ? (
              <p role="status" className="text-sm font-medium text-primary">
                {t("dashboard.vitals.sorted")}
              </p>
            ) : null}
            {viewer === "ground" ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.vitals.textHidden")}</p>
            ) : null}
          </div>
        </Reveal>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ordered.map((card, i) => (
            <li key={card.id}>
              <Reveal index={8 + i} className="h-full">
                <KpiCard card={card} byKey={byKey} viewer={viewer} highlighted={related.has(card.id)} />
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {viewer === "crew" ? (
        <>
          <div aria-hidden="true" className="h-[22rem]" />
          <CosmoDock payload={payload} dockSlot={dockSlot} />
        </>
      ) : null}
    </div>
  );
}
