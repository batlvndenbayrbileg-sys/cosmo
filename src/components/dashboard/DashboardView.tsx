"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Radar as RadarIcon } from "lucide-react";
import type { DashboardPayload, HazardKey, KpiKey, KpiStat } from "@/lib/types";
import { useShellHeader } from "@/components/shell";
import { useI18n } from "@/i18n/I18nProvider";
import { BodyHero } from "./BodyHero";
import { CosmoDock } from "./CosmoDock";
import { DayArc } from "./DayArc";
import { EarthLinkCard } from "./EarthLinkCard";
import { HazardLens } from "./HazardLens";
import { HealthRadar } from "./HealthRadar";
import { HighlightVital } from "./HighlightVital";
import { KpiCard } from "./KpiCard";
import { PlanCards } from "./PlanCards";
import { CrewHeading, ProfileCard, StatPills } from "./ProfileCard";
import { HeartCard, HydrationCard } from "./SmallCards";
import { Timeline } from "./Timeline";
import { TopBar, type NavSection } from "./TopBar";
import { buildKpiCards, cardsRelatedToHazard, sortCardsForHazard } from "./logic";
import { Reveal } from "./motion";
import { TwoToneTitle } from "./parts";

/**
 * Contract between the check-in lane and the dashboard lane. The props are fixed.
 *
 * - `viewer: "crew"`   the astronaut's own dashboard (Cosmo card bottom-right)
 * - `viewer: "ground"` read-only Earth console view (no Cosmo card, no replay, no free-text notes)
 * - `dockSlot`         optional element rendered inside the Cosmo card. The check-in screen passes
 *                      its shared Cosmo element (a motion.div with layoutId COSMO_LAYOUT_ID) so
 *                      framer-motion can animate Cosmo from the full-screen stage into the card
 *                      inside ONE React tree. When absent the card renders its own CosmoAvatar.
 *
 * Entrance animation can be switched off from outside with <DashboardMotionProvider animate={false}>.
 * Layout: docs/DESIGN_V2.md section 2 (one glass frame: top bar; left profile column; centre body figure;
 * right radar / plan / small cards; bottom timeline; then all readings, hazards, day and Earth link).
 */
export interface DashboardViewProps {
  payload: DashboardPayload;
  viewer: "crew" | "ground";
  dockSlot?: ReactNode;
}

const SECTION_ID: Record<NavSection, string> = {
  overview: "dashboard-top",
  vitals: "dashboard-vitals",
  plan: "dashboard-plan",
  trends: "dashboard-trends",
  earth: "dashboard-earth",
};

export function DashboardView({ payload, viewer, dockSlot }: DashboardViewProps) {
  const { t } = useI18n();
  const [selectedHazard, setSelectedHazard] = useState<HazardKey | null>(null);
  const [section, setSection] = useState<NavSection>("overview");

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

  const navigate = useCallback((next: NavSection) => {
    setSection(next);
    const el = document.getElementById(SECTION_ID[next]);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, []);

  return (
    <div
      data-slot="dashboard"
      data-viewer={viewer}
      className="relative mx-auto flex w-full max-w-[1360px] flex-col gap-6"
    >
      <div
        id="dashboard-top"
        className="glass-frame backdrop-filter-none! flex scroll-mt-24 flex-col gap-6 p-4! sm:p-6! xl:p-8!"
      >
        <Reveal index={0}>
          <TopBar payload={payload} viewer={viewer} active={section} onNavigate={navigate} />
        </Reveal>

        {payload.overall === "no_data" ? (
          <p
            role="status"
            className="rounded-2xl border border-dashed border-status-nodata/50 bg-white/60 px-4 py-3 text-[15px] text-[var(--aegis-label)]"
          >
            {t("dashboard.noDataBanner")}
          </p>
        ) : null}

        {/* three columns on desktop; one column in the DESIGN_V2 mobile order below xl */}
        <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,27fr)_minmax(0,40fr)_minmax(0,27fr)] xl:items-start xl:gap-7">
          {/* left column */}
          <div className="contents xl:flex xl:flex-col xl:gap-5">
            <Reveal index={1} className="order-1 xl:order-none">
              <CrewHeading payload={payload} viewer={viewer} />
            </Reveal>
            <Reveal index={2} className="order-2 xl:order-none">
              <div className="hidden xl:block">
                <ProfileCard payload={payload} />
              </div>
              <StatPills payload={payload} className="xl:hidden" />
            </Reveal>
            <Reveal index={4} className="order-4 xl:order-none">
              <HighlightVital payload={payload} />
            </Reveal>
          </div>

          {/* centre hero */}
          <Reveal index={3} className="order-3 xl:order-none">
            <BodyHero payload={payload} />
          </Reveal>

          {/* right column */}
          <div className="contents xl:flex xl:flex-col xl:gap-5">
            <Reveal index={5} className="order-5 xl:order-none">
              <section aria-labelledby="radar-title" data-slot="radar-card" className="flex flex-col gap-3">
                <TwoToneTitle
                  id="radar-title"
                  icon={RadarIcon}
                  light={t("dashboard.radar.titleLight")}
                  strong={t("dashboard.radar.titleStrong")}
                />
                <div className="glass-card px-3 pt-2 pb-3">
                  <p className="px-2 pt-1 text-[12px] text-[var(--aegis-label)]">{t("dashboard.radar.subtitle")}</p>
                  <HealthRadar axes={payload.axes} />
                </div>
              </section>
            </Reveal>
            <Reveal index={6} className="order-6 xl:order-none">
              <section
                id="dashboard-plan"
                aria-labelledby="plan-title"
                data-slot="today-plan"
                className="flex scroll-mt-24 flex-col gap-3"
              >
                <TwoToneTitle
                  id="plan-title"
                  light={t("dashboard.plan.titleLight")}
                  strong={t("dashboard.plan.titleStrong")}
                />
                <PlanCards tasks={payload.tasks} selectedHazard={hazardStat} />
              </section>
            </Reveal>
            <Reveal index={7} className="order-7 xl:order-none">
              <div className="grid grid-cols-2 gap-3">
                <HeartCard stat={byKey.get("heart_rate")} />
                <HydrationCard byKey={byKey} />
              </div>
            </Reveal>
          </div>
        </div>

        <Reveal index={8}>
          <Timeline payload={payload} />
        </Reveal>
      </div>

      {/* details: every reading, the hazard lens, the day and the Earth link */}
      <div className="glass-frame backdrop-filter-none! flex flex-col gap-6 p-4! sm:p-6! xl:p-8!">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section
            id="dashboard-vitals"
            aria-labelledby="vitals-title"
            data-slot="vitals"
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <div className="flex flex-col gap-0.5">
              <h2 id="vitals-title" className="text-[26px] leading-tight font-light text-[var(--aegis-ink)]">
                {t("dashboard.details.title")}
              </h2>
              <p className="text-[13px] text-[var(--aegis-label)]">{t("dashboard.vitals.subtitle")}</p>
              <p className="text-[13px] text-[var(--aegis-label)]">{t("dashboard.vitals.legend")}</p>
              {hazardStat ? (
                <p role="status" className="text-[13px] font-medium text-[var(--aegis-accent-deep)]">
                  {t("dashboard.vitals.sorted")}
                </p>
              ) : null}
              {viewer === "ground" ? (
                <p className="text-[13px] text-[var(--aegis-label)]">{t("dashboard.vitals.textHidden")}</p>
              ) : null}
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {ordered.map((card) => (
                <li key={card.id}>
                  <KpiCard card={card} byKey={byKey} viewer={viewer} highlighted={related.has(card.id)} />
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-col gap-4">
            <HazardLens hazards={payload.hazards} selected={selectedHazard} onSelect={setSelectedHazard} />
            <DayArc dayArc={payload.dayArc} />
            <section id="dashboard-earth" aria-label={t("dashboard.nav.earth")} className="scroll-mt-24">
              <EarthLinkCard link={payload.link} viewer={viewer} />
            </section>
          </div>
        </div>
      </div>

      {viewer === "crew" ? (
        <>
          <div aria-hidden="true" className="hidden h-64 md:block" />
          <CosmoDock payload={payload} dockSlot={dockSlot} />
        </>
      ) : null}
    </div>
  );
}
