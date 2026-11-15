"use client";

import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ListChecks, Radar as RadarIcon } from "lucide-react";
import type { DashboardPayload, HazardKey, HazardStat, KpiKey, KpiStat } from "@/lib/types";
import { useShellHeader } from "@/components/shell";
import { StatusGlyph } from "@/components/status";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { suggestGuides } from "@/lib/emergency";
import { EmergencyGuidePanel } from "@/components/emergency/EmergencyGuidePanel";
import { useEmergencyLibrary } from "@/components/emergency/hooks";
import { AlertsStrip } from "./AlertsStrip";
import { IfWorseCard } from "./IfWorseCard";
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
import { TopBar, panelId, tabId, type NavSection } from "./TopBar";
import { TrendTiles } from "./TrendTiles";
import { buildKpiCards, cardsRelatedToHazard, sortCardsForHazard, worstOf, type Viewer } from "./logic";
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
 *
 * Layout (docs/DESIGN_V2.md section 2), single screen like an app:
 * - desktop (>= 1024 px): the dashboard is exactly one viewport high (100dvh) and the page never scrolls. The top
 *   bar's pills are tabs that switch the view inside the glass frame (Overview / Vitals / Plan / Trends / Earth
 *   link / Emergency guide) with a crossfade. Every view is sized from the frame's height (flex, clamp() and vh based sizes).
 * - phones and small tablets: the same tabs, the active view as one scrolling column.
 * - crew viewer: the bottom of the frame (--dashboard-bottom-reserve) stays free for the floating conversation
 *   bar (check-in lane) and Cosmo's dock, which collapses to a compact pill.
 *
 * The Overview carries the data-slot hooks the spoken tour looks for (profile-card, body-hero, highlight-vital,
 * radar-card, today-plan, timeline, cosmo-dock and, when alerts are open, alerts-strip).
 */
export interface DashboardViewProps {
  payload: DashboardPayload;
  viewer: "crew" | "ground";
  dockSlot?: ReactNode;
  /** optional: the parent controls whether Cosmo's summary card is expanded (collapsed during the spoken tour) */
  dockOpen?: boolean;
}

/**
 * Room kept free at the bottom of the frame on the crew view: the conversation bar is fixed 3rem above the
 * viewport bottom and about 72 px tall, so the frame's own bottom margin plus this reserve clears it.
 */
const CREW_BOTTOM_RESERVE = "clamp(84px, calc(124px - clamp(12px, 1.6vw, 24px)), 112px)";
const GROUND_BOTTOM_RESERVE = "clamp(14px, 2.2vh, 28px)";

export function DashboardView({ payload, viewer, dockSlot, dockOpen }: DashboardViewProps) {
  const { t, lang } = useI18n();
  const reduced = usePrefersReducedMotion();
  const [selectedHazard, setSelectedHazard] = useState<HazardKey | null>(null);
  const [section, setSection] = useState<NavSection>("overview");

  useShellHeader({
    crewName: `${payload.crew.name} Â· ${payload.crew.role}`,
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

  const navigate = useCallback((next: NavSection) => setSection(next), []);

  // emergency guide: built-in guides at once (works offline), team content when the server has it
  const emergencyLib = useEmergencyLibrary();
  const [guideId, setGuideId] = useState<string | null>(null);
  const suggestions = useMemo(() => suggestGuides(payload, emergencyLib), [payload, emergencyLib]);
  const openGuide = useCallback((id: string) => {
    setGuideId(id);
    setSection("guide");
  }, []);

  const openAlerts = payload.alerts.filter((a) => a.acknowledgedAt === null);
  const alertsChip =
    openAlerts.length > 0 ? (
      <button
        type="button"
        data-slot="alerts-strip"
        onClick={() => setSection("earth")}
        aria-label={t("dashboard.alerts.chipAria", { n: openAlerts.length })}
        className="inline-flex items-center gap-1 rounded-full bg-status-alert-soft px-2 py-0.5 font-medium text-status-alert-ink ring-1 ring-status-alert/30 outline-none hover:brightness-[0.98] focus-visible:ring-3 focus-visible:ring-ring/60"
      >
        <StatusGlyph status={worstOf(openAlerts.map((a) => a.level))} size={11} labelled={false} />
        {openAlerts.length === 1 ? t("dashboard.alerts.chipOne") : t("dashboard.alerts.chip", { n: openAlerts.length })}
      </button>
    ) : null;

  const panel: Record<NavSection, () => ReactNode> = {
    overview: () => (
      <OverviewPanel
        payload={payload}
        viewer={viewer}
        byKey={byKey}
        hazardStat={hazardStat}
        alertsChip={
          <>
            {payload.overall === "no_data" ? (
              // desktop: the no-data note sits in the heading meta line instead of a full-width row
              <span
                role="status"
                className="hidden rounded-full border border-dashed border-status-nodata/60 bg-white/70 px-2 py-0.5 font-medium lg:inline-flex"
              >
                {t("dashboard.noDataBanner")}
              </span>
            ) : null}
            {alertsChip}
            <IfWorseCard suggestion={suggestions[0]} scenarios={emergencyLib} onOpen={openGuide} />
          </>
        }
      />
    ),
    guide: () => (
      <EmergencyGuidePanel
        scenarios={emergencyLib}
        lang={lang}
        openId={guideId}
        onOpenId={setGuideId}
        suggested={suggestions.map((s) => s.scenarioId)}
      />
    ),
    vitals: () => (
      <section aria-labelledby="vitals-title" data-slot="vitals" className="flex flex-col gap-3 lg:h-full lg:min-h-0">
        <div className="flex flex-col gap-0.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-4">
          <h2 id="vitals-title" className="text-[26px] leading-tight font-light text-[var(--aegis-ink)] lg:text-[clamp(20px,2.8vh,26px)]">
            {t("dashboard.details.title")}
          </h2>
          <p className="text-[13px] text-[var(--aegis-label)] lg:text-[12px]">{t("dashboard.vitals.subtitle")}</p>
          <p className="text-[13px] text-[var(--aegis-label)] lg:text-[12px]">{t("dashboard.vitals.legend")}</p>
          {hazardStat ? (
            <p role="status" className="text-[13px] font-medium text-[var(--aegis-accent-deep)] lg:text-[12px]">
              {t("dashboard.vitals.sorted")}
            </p>
          ) : null}
          {viewer === "ground" ? (
            <p className="text-[13px] text-[var(--aegis-label)] lg:text-[12px]">{t("dashboard.vitals.textHidden")}</p>
          ) : null}
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:auto-rows-[minmax(0,1fr)] lg:grid-flow-row-dense lg:grid-cols-5 lg:gap-[clamp(8px,1.2vh,14px)]">
          {ordered.map((card) => (
            <li key={card.id} className={cn("min-h-0 min-w-0", (card.kind === "bp" || card.kind === "symptoms") && "lg:row-span-2")}>
              <KpiCard card={card} byKey={byKey} viewer={viewer} highlighted={related.has(card.id)} compact />
            </li>
          ))}
        </ul>
      </section>
    ),
    plan: () => (
      <div className="flex flex-col gap-5 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-[clamp(14px,1.4vw,24px)]">
        <section aria-labelledby="plan-title" data-slot="today-plan-full" className="flex flex-col gap-3 lg:min-h-0">
          <TwoToneTitle
            id="plan-title"
            icon={ListChecks}
            light={t("dashboard.plan.titleLight")}
            strong={t("dashboard.plan.titleStrong")}
            className="lg:[&_h2]:text-[clamp(20px,2.8vh,26px)]"
          />
          <PlanCards tasks={payload.tasks} selectedHazard={hazardStat} layout="grid" />
        </section>
        <div className="flex flex-col gap-4 lg:min-h-0 lg:gap-[clamp(10px,1.4vh,16px)] lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:pr-1.5">
          <HazardLens hazards={payload.hazards} selected={selectedHazard} onSelect={setSelectedHazard} />
          <DayArc dayArc={payload.dayArc} />
        </div>
      </div>
    ),
    trends: () => (
      <div className="flex flex-col gap-5 lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-[clamp(10px,1.6vh,18px)]">
        <Timeline payload={payload} size="large" />
        <div className="flex flex-col gap-5 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-[clamp(14px,1.4vw,24px)]">
          <section aria-labelledby="trend-radar-title" className="glass-card flex flex-col gap-2 p-4 lg:min-h-0 lg:p-[clamp(12px,1.6vh,18px)]">
            <TwoToneTitle
              id="trend-radar-title"
              icon={RadarIcon}
              light={t("dashboard.radar.titleLight")}
              strong={t("dashboard.radar.titleStrong")}
              className="lg:[&_h2]:text-[clamp(18px,2.4vh,24px)]"
            />
            <p className="text-[12px] leading-snug text-[var(--aegis-label)]">{t("dashboard.radar.subtitle")}</p>
            <HealthRadar axes={payload.axes} fill />
          </section>
          <section aria-labelledby="trends-title" className="flex flex-col gap-3 lg:min-h-0">
            <div className="flex flex-col gap-0.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-4">
              <TwoToneTitle
                id="trends-title"
                icon={CalendarDays}
                light={t("dashboard.trends.titleLight")}
                strong={t("dashboard.trends.titleStrong")}
                className="lg:[&_h2]:text-[clamp(18px,2.4vh,24px)]"
              />
              <p className="text-[12px] text-[var(--aegis-label)]">{t("dashboard.trends.subtitle")}</p>
            </div>
            <TrendTiles byKey={byKey} />
          </section>
        </div>
      </div>
    ),
    earth: () => (
      <div className="flex flex-col gap-5 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start lg:gap-[clamp(14px,1.4vw,24px)]">
        <section aria-label={t("dashboard.nav.earth")} className="lg:min-h-0">
          <EarthLinkCard link={payload.link} viewer={viewer} />
        </section>
        <div className="lg:max-h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-1">
          {payload.alerts.length > 0 ? (
            <AlertsStrip alerts={payload.alerts} viewer={viewer} />
          ) : (
            <div role="status" className="glass-card flex flex-col gap-1 px-5 py-4">
              <h2 className="text-lg font-medium text-[var(--aegis-ink)]">{t("dashboard.alerts.title")}</h2>
              <p className="text-[15px] text-[var(--aegis-label)]">{t("dashboard.top.noAlerts")}</p>
            </div>
          )}
        </div>
      </div>
    ),
  };

  const rootStyle = {
    "--dashboard-bottom-reserve": viewer === "crew" ? CREW_BOTTOM_RESERVE : GROUND_BOTTOM_RESERVE,
  } as CSSProperties;

  return (
    <div
      data-slot="dashboard"
      data-viewer={viewer}
      data-fit="screen"
      style={rootStyle}
      className="relative mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-3 pt-3 pb-16 sm:px-5 sm:pt-5 lg:h-dvh lg:gap-0 lg:p-[clamp(12px,1.6vw,24px)]"
    >
      <div className="glass-frame flex flex-col gap-5 backdrop-filter-none! p-4! sm:p-6! lg:min-h-0 lg:flex-1 lg:gap-[clamp(10px,1.6vh,18px)] lg:px-[clamp(16px,1.7vw,30px)]! lg:pt-[clamp(12px,2vh,26px)]! lg:pb-[var(--dashboard-bottom-reserve)]!">
        <Reveal index={0}>
          <TopBar payload={payload} viewer={viewer} active={section} onNavigate={navigate} />
        </Reveal>

        {payload.overall === "no_data" ? (
          <p
            role="status"
            className="rounded-2xl border border-dashed border-status-nodata/50 bg-white/60 px-4 py-3 text-[15px] text-[var(--aegis-label)] lg:hidden"
          >
            {t("dashboard.noDataBanner")}
          </p>
        ) : null}

        <div className="relative lg:min-h-0 lg:flex-1">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={section}
              role="tabpanel"
              id={panelId(section)}
              aria-labelledby={tabId(section)}
              tabIndex={-1}
              data-panel={section}
              className="outline-none lg:h-full lg:min-h-0"
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -6 }}
              transition={{ duration: reduced ? 0.12 : 0.26, ease: [0.4, 0, 0.2, 1] }}
            >
              {panel[section]()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {viewer === "crew" ? (
        <>
          <div aria-hidden="true" className="hidden h-24 md:block lg:hidden" />
          <CosmoDock payload={payload} dockSlot={dockSlot} dockOpen={dockOpen} />
        </>
      ) : null}
    </div>
  );
}

/** the reference layout compressed into one screen: left profile column, centre body, right column, bottom strip */
function OverviewPanel({
  payload,
  viewer,
  byKey,
  hazardStat,
  alertsChip,
}: {
  payload: DashboardPayload;
  viewer: Viewer;
  byKey: ReadonlyMap<KpiKey, KpiStat>;
  hazardStat: HazardStat | null;
  alertsChip: ReactNode;
}) {
  const { t } = useI18n();
  const COL = "lg:flex lg:min-h-0 lg:flex-col";
  return (
    <div className="flex flex-col gap-6 lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-[clamp(10px,1.6vh,18px)]">
      {/* three columns on desktop; one column in the DESIGN_V2 mobile order below lg */}
      <div className="flex flex-col gap-6 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,27fr)_minmax(0,40fr)_minmax(0,27fr)] lg:gap-[clamp(14px,1.6vw,28px)] dash-short:grid-cols-[minmax(0,27fr)_minmax(0,31fr)_minmax(0,34fr)]">
        {/* left column */}
        <div className={cn("contents", COL, "lg:gap-[clamp(8px,1.5vh,18px)]")}>
          <Reveal index={1} className="order-1 lg:order-none">
            <CrewHeading payload={payload} viewer={viewer} extra={alertsChip} />
          </Reveal>
          <Reveal index={2} className={cn("order-2 lg:order-none", COL, "lg:flex-[0.9] dash-tight:flex-none")}>
            <div className={cn("hidden", COL, "lg:flex-1")}>
              <ProfileCard payload={payload} />
            </div>
            <StatPills payload={payload} className="lg:hidden" />
          </Reveal>
          <Reveal index={4} className={cn("order-4 lg:order-none", COL, "lg:flex-[1.3]")}>
            <HighlightVital payload={payload} />
          </Reveal>
        </div>

        {/* centre hero */}
        <Reveal index={3} className="order-3 lg:order-none lg:h-full lg:min-h-0">
          <BodyHero payload={payload} />
        </Reveal>

        {/* right column: radar, plan, small cards stacked; on shorter screens the small cards sit beside the radar */}
        <div
          className={cn(
            "contents",
            COL,
            "lg:gap-[clamp(8px,1.4vh,16px)]",
            "dash-short:grid dash-short:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] dash-short:grid-rows-[minmax(0,1fr)_auto] dash-short:gap-x-[clamp(8px,0.8vw,12px)] dash-short:[grid-template-areas:'radar_small'_'plan_plan']",
          )}
        >
          <Reveal index={5} className={cn("order-5 lg:order-none", COL, "lg:flex-1 dash-short:[grid-area:radar]")}>
            <section
              aria-labelledby="radar-title"
              data-slot="radar-card"
              className={cn("flex flex-col gap-3", "lg:min-h-0 lg:flex-1 lg:gap-[clamp(4px,0.8vh,10px)]")}
            >
              <TwoToneTitle
                id="radar-title"
                icon={RadarIcon}
                light={t("dashboard.radar.titleLight")}
                strong={t("dashboard.radar.titleStrong")}
                className="lg:gap-2.5 lg:[&_.icon-chip]:size-[clamp(28px,3.8vh,38px)]! lg:[&_h2]:text-[clamp(18px,2.6vh,26px)]"
              />
              <div className="glass-card flex flex-col px-3 pt-2 pb-3 lg:min-h-0 lg:flex-1 lg:pt-[clamp(4px,0.8vh,8px)] lg:pb-[clamp(4px,1vh,12px)]">
                <p className="px-2 pt-1 text-[12px] leading-snug text-[var(--aegis-label)] lg:truncate lg:pt-0 dash-short:sr-only">
                  {t("dashboard.radar.subtitle")}
                </p>
                <HealthRadar axes={payload.axes} fill />
              </div>
            </section>
          </Reveal>
          <Reveal index={6} className="order-6 lg:order-none dash-short:[grid-area:plan]">
            <section
              aria-labelledby="plan-title"
              data-slot="today-plan"
              className="flex flex-col gap-3 lg:gap-[clamp(4px,0.8vh,10px)]"
            >
              <TwoToneTitle
                id="plan-title"
                light={t("dashboard.plan.titleLight")}
                strong={t("dashboard.plan.titleStrong")}
                className="lg:[&_h2]:text-[clamp(18px,2.6vh,26px)]"
              />
              <PlanCards tasks={payload.tasks} selectedHazard={hazardStat} />
            </section>
          </Reveal>
          <Reveal index={7} className={cn("order-7 lg:order-none", "dash-short:flex dash-short:min-h-0 dash-short:flex-col dash-short:[grid-area:small]")}>
            <div className="grid grid-cols-2 gap-3 lg:gap-[clamp(8px,1vw,12px)] dash-short:min-h-0 dash-short:flex-1 dash-short:grid-cols-1 dash-short:grid-rows-2 dash-short:gap-[clamp(6px,1vh,10px)]">
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
  );
}
