"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  Brain,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplet,
  Dumbbell,
  Eye,
  Gauge,
  HeartPulse,
  Info,
  LayoutDashboard,
  LifeBuoy,
  Microscope,
  Moon,
  Pause,
  Play,
  RadioTower,
  ScanLine,
  Smile,
  TestTube,
  Thermometer,
  X,
  type LucideIcon,
} from "lucide-react";
import type { KpiKey, Status } from "@/lib/types";
import { KPI_DEFS } from "@/lib/kpi/registry";
import type { ExplainBeat, ExplainEvent, ExplainPanel } from "@/lib/explain";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { digitsOf, valueText } from "@/components/show/format";
import { formatNumber } from "@/lib/health/format";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { chartGeometry, shortDate } from "./geometry";

/**
 * Cosmo explains, one thing at a time (src/lib/explain.ts): a full-screen overlay on the space-earth picture with Cosmo
 * at the side, ONE panel per beat appearing in sync with what she says (a beat moves on when the voice of its caption
 * ends; without a voice after about 4 s), the caption at the bottom, and pause / back / next / close. Keyboard: arrows
 * change the step, Space pauses, Escape closes. Reduced motion: nothing moves, steps change instantly. Phones stack.
 *
 * Every number on screen comes from the event (the server's code-computed storyboard), never from the model.
 */

/** a beat without a voice stays this long (the fallback the brief asks for) */
export const FALLBACK_BEAT_MS = 4000;
/** even with a voice, a beat is on screen at least this long, so a panel never just flashes */
export const MIN_BEAT_MS = 1600;

/* the stage's palette: navy space, cyan glass (the style reference), status colours that read on dark */
const CYAN = "#67E8F9";
const STATUS_ON_DARK: Record<Status, string> = {
  green: "#4ADE80",
  yellow: "#FBBF24",
  red: "#F87171",
  no_data: "#64748B",
};

const KEY_ICON: Partial<Record<KpiKey, LucideIcon>> = {
  sleep_hours: Moon,
  mood: Smile,
  symptom_headache: Brain,
  symptom_dizziness: Brain,
  symptom_nausea: Brain,
  bp_systolic: Gauge,
  bp_diastolic: Gauge,
  heart_rate: HeartPulse,
  temperature_c: Thermometer,
  glucose_mgdl: TestTube,
  water_ml: Droplet,
  exercise_min: Dumbbell,
  vision_check: Eye,
  workload: Briefcase,
};

const GLASS =
  "relative overflow-hidden rounded-[22px] border border-[#67E8F9]/35 bg-[#0B1A3A]/70 shadow-[0_0_0_1px_rgba(103,232,249,0.06),0_30px_80px_-30px_rgba(8,47,120,0.9)] backdrop-blur-xl";

export interface ExplainerStageProps {
  explain: ExplainEvent;
  checkInId: string | null;
  /** Cosmo at the side (the check-in screen hands over its shared element, so she glides there) */
  cosmo?: ReactNode;
  /** for the Contact Mission Control button's face */
  mascotVariant?: number;
  /** voices one beat (line `part` of the walkthrough turn); resolves when it ended or was stopped */
  speak?: (beat: { part: number; text: string }) => Promise<void>;
  stopSpeech?: () => void;
  /** the last beat has been said */
  onFinished?: () => void;
  onClose: () => void;
  /** after the summary: the full dashboard */
  onOpenDashboard?: () => void;
  /** the existing SOS / ground alert flow */
  onContactGround?: () => void;
  onOpenGuide?: (scenarioId: string) => void;
  /** starting step (tests, server render) */
  initialStep?: number;
  /** false: start paused (tests); default true */
  autoPlay?: boolean;
  /** close by itself this long after the last beat (unset: stay until closed) */
  autoCloseMs?: number;
}

export function ExplainerStage({
  explain,
  checkInId,
  cosmo,
  mascotVariant = 0,
  speak,
  stopSpeech,
  onFinished,
  onClose,
  onOpenDashboard,
  onContactGround,
  onOpenGuide,
  initialStep = 0,
  autoPlay = true,
  autoCloseMs,
}: ExplainerStageProps) {
  const { t, lang } = useI18n();
  const reduced = usePrefersReducedMotion();
  const titleId = useId();
  const beats = explain.beats;
  const [step, setStep] = useState(() => Math.min(Math.max(0, initialStep), beats.length - 1));
  const [paused, setPaused] = useState(!autoPlay);
  const [finished, setFinished] = useState(false);
  const beat = beats[step];

  // the callbacks change on every parent render; the playback effect reads them through refs
  const live = useRef({ speak, stopSpeech, onFinished, onClose, beats });
  useEffect(() => {
    live.current = { speak, stopSpeech, onFinished, onClose, beats };
  });

  useEffect(() => {
    if (!finished || autoCloseMs === undefined) return;
    const timer = setTimeout(() => live.current.onClose(), autoCloseMs);
    return () => clearTimeout(timer);
  }, [finished, autoCloseMs]);

  /* ── playback: one beat after the other, each as long as its voice (or FALLBACK_BEAT_MS) ── */
  useEffect(() => {
    if (paused || finished) return;
    const current = live.current.beats[step];
    if (!current) return;
    let cancelled = false;
    let speaking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    void (async () => {
      const say = live.current.speak;
      if (say) {
        speaking = true;
        try {
          await say({ part: current.part, text: current.caption });
        } catch {
          // no voice for this beat: the caption is on screen, the timer below keeps the pace
        }
        speaking = false;
      }
      if (cancelled) return;
      // a voice that ended at once was never heard (blocked autoplay, nothing to play): the beat keeps the fallback pace
      const elapsed = Date.now() - started;
      const rest = (say && elapsed >= 500 ? MIN_BEAT_MS : FALLBACK_BEAT_MS) - elapsed;
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, rest));
      });
      if (cancelled) return;
      if (step < live.current.beats.length - 1) setStep(step + 1);
      else {
        setFinished(true);
        live.current.onFinished?.();
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // only this beat's own voice is stopped (never a line the screen says after the walkthrough)
      if (speaking) live.current.stopSpeech?.();
    };
  }, [step, paused, finished]);

  const go = useCallback(
    (to: number) => {
      const next = Math.min(Math.max(0, to), beats.length - 1);
      setFinished(false);
      setStep(next);
    },
    [beats.length],
  );
  // pausing ends the playback effect, whose cleanup stops the voice; after the last beat, play says it again
  const togglePause = useCallback(() => {
    if (finished) {
      setFinished(false);
      setPaused(false);
      return;
    }
    setPaused((p) => !p);
  }, [finished]);
  const playing = !paused && !finished;

  /* ── keyboard: arrows, Space, Escape ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(step + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(step - 1);
      } else if (e.key === " " || e.code === "Space") {
        if (target?.closest("button, a")) return; // the focused control's own Space
        e.preventDefault();
        togglePause();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step, togglePause, onClose]);

  // focus moves into the walkthrough when it opens (screen readers hear the region; keys work at once)
  const dialogRef = useRef<HTMLDivElement>(null);
  // and goes back to where it was when the walkthrough closes (a keyboard user is not dropped at the page's top)
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  if (!beat) return null;
  const enter = reduced ? { opacity: 1 } : { opacity: 0, y: 18, scale: 0.985 };
  const shown = { opacity: 1, y: 0, scale: 1 };
  const leave = reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.99 };
  const transition = reduced ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-slot="explainer-stage"
      data-step={step}
      data-intent={explain.intent}
      // above the screen's floating SOS button (z-60): the top bar carries the same action at every step; the emergency
      // guidance (z-70) and the SOS status card (z-65) still come on top
      className="fixed inset-0 z-[62] flex flex-col overflow-x-hidden overflow-y-auto text-white outline-none"
      style={{ background: "#040B1F" }}
    >
      {/* space-earth picture (generated, public/visuals), with a navy wash for contrast */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-cover bg-bottom"
        style={{ backgroundImage: "url(/visuals/space-earth.png)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{ background: "linear-gradient(180deg, rgba(4,11,31,0.55) 0%, rgba(4,11,31,0.35) 45%, rgba(4,11,31,0.8) 100%)" }}
      />

      <h2 id={titleId} className="sr-only">
        {t("checkin.explain.region")}
      </h2>
      <p className="sr-only">{t("checkin.explain.keys")}</p>

      {/* top bar: step dots and close */}
      <div className="relative z-10 flex items-center gap-3 px-4 pt-4 sm:px-6">
        <p className="text-[11px] font-medium tracking-[0.18em] text-[#A5F3FC]/80 uppercase" aria-live="off">
          {t("checkin.explain.step", { n: step + 1, total: beats.length })}
        </p>
        <ol className="flex flex-1 items-center gap-1.5" aria-hidden="true">
          {beats.map((b, i) => (
            <li
              key={b.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < step ? "bg-[#67E8F9]/70" : i === step ? "bg-[#67E8F9]" : "bg-white/15",
              )}
            />
          ))}
        </ol>
        {onContactGround ? (
          <button
            type="button"
            onClick={onContactGround}
            data-slot="explainer-sos"
            title={t("checkin.explain.actions.contactHint")}
            className="flex h-10 items-center gap-1.5 rounded-full border border-[#F87171]/50 bg-[#F87171]/10 px-3 text-[12.5px] font-semibold text-[#FECACA] outline-none hover:bg-[#F87171]/20 focus-visible:ring-3 focus-visible:ring-[#F87171]/60"
          >
            <RadioTower className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("checkin.explain.actions.contact")}</span>
            <span className="sr-only sm:hidden">{t("checkin.explain.actions.contact")}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("checkin.explain.close")}
          className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/85 outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-[#67E8F9]/60"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Cosmo at the side, the panel of this beat beside her */}
      <div className="relative z-10 flex flex-1 flex-col gap-4 px-4 pt-3 pb-4 sm:px-6 md:flex-row md:items-center md:gap-6 md:pt-0">
        <div className="flex shrink-0 items-center gap-3 md:w-[200px] md:flex-col md:items-center lg:w-[240px]">
          <div className="relative size-[76px] shrink-0 md:size-[170px] lg:size-[200px]" data-slot="explainer-cosmo">
            <div
              aria-hidden="true"
              className="absolute inset-[8%] rounded-full blur-2xl"
              style={{ background: "radial-gradient(circle, rgba(103,232,249,0.35), rgba(103,232,249,0) 70%)" }}
            />
            <div className="relative size-full">{cosmo}</div>
          </div>
          <p className="text-[12px] leading-snug text-[#A5F3FC]/75 md:text-center">{t(`checkin.explain.header.${beat.panel.kind}`, { label: labelOfPanel(beat.panel, lang) })}</p>
        </div>

        <div className="relative min-w-0 flex-1 md:max-w-[760px]">
          <AnimatePresence mode="wait" initial={!reduced}>
            <motion.section
              key={beat.id}
              data-slot="explainer-panel"
              data-panel={beat.panel.kind}
              aria-label={t(`checkin.explain.header.${beat.panel.kind}`, { label: labelOfPanel(beat.panel, lang) })}
              initial={enter}
              animate={shown}
              exit={leave}
              transition={transition}
            >
              <BeatPanel
                beat={beat}
                checkInId={checkInId}
                reduced={reduced}
                mascotVariant={mascotVariant}
                onContactGround={onContactGround}
                onOpenGuide={onOpenGuide}
              />
            </motion.section>
          </AnimatePresence>
        </div>
      </div>

      {/* caption + controls (they stay on screen when a tall panel scrolls on a phone) */}
      <div className="sticky bottom-0 z-10 px-4 pb-3 sm:px-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-3 rounded-[20px] border border-white/10 bg-[#020817]/70 p-3 backdrop-blur-xl md:flex-row md:items-center md:gap-4 md:p-4">
          <p
            data-slot="explainer-caption"
            aria-live="polite"
            className="max-h-[28vh] min-w-0 flex-1 overflow-y-auto text-[15px] leading-snug text-white/95 md:max-h-none md:text-[16.5px]"
          >
            {beat.caption}
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ControlButton label={t("checkin.explain.back")} onClick={() => go(step - 1)} disabled={step === 0}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </ControlButton>
            <ControlButton
              label={playing ? t("checkin.explain.pause") : t("checkin.explain.play")}
              onClick={togglePause}
              primary
              slot="explainer-pause"
            >
              {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4 translate-x-px" aria-hidden="true" />}
            </ControlButton>
            <ControlButton label={t("checkin.explain.next")} onClick={() => go(step + 1)} disabled={step >= beats.length - 1}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </ControlButton>
            {onOpenDashboard ? (
              <button
                type="button"
                onClick={onOpenDashboard}
                data-slot="explainer-dashboard"
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full border px-4 text-[13.5px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-[#67E8F9]/60",
                  finished ? "border-[#67E8F9] bg-[#67E8F9] text-[#04122B]" : "border-white/20 bg-white/5 text-white/90 hover:bg-white/10",
                )}
              >
                <LayoutDashboard className="size-4" aria-hidden="true" />
                {t("checkin.explain.dashboard")}
              </button>
            ) : null}
          </div>
        </div>
        <p data-slot="explainer-footer" className="mt-2 text-center text-[10.5px] font-medium tracking-[0.16em] text-white/45 uppercase">
          {t("checkin.explain.footer")}
        </p>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  primary,
  slot,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  slot?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-slot={slot}
      className={cn(
        "flex size-10 items-center justify-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-[#67E8F9]/60 disabled:opacity-35",
        primary ? "border-[#67E8F9]/60 bg-[#67E8F9]/15 text-[#CFFAFE]" : "border-white/15 bg-white/5 text-white/85 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

const NARROW_QUERY = "(max-width: 639px)";
function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
/** true on phone-width screens; the server render and hydration see a wide screen */
function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

function labelOfPanel(panel: ExplainPanel, lang: "en" | "mn"): string {
  if (panel.kind === "chart" || panel.kind === "days") {
    if (panel.kind === "chart" && panel.series.length === 2) return lang === "mn" ? "Цусны даралт" : "Blood pressure";
    return KPI_DEFS[panel.key].labels[lang];
  }
  return "";
}

/* ───────────── panels ───────────── */

function HeaderStrip({ text, right }: { text: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[#67E8F9]/20 bg-[#67E8F9]/[0.06] px-4 py-2">
      <span className="size-1.5 rounded-full bg-[#67E8F9]" aria-hidden="true" />
      <h3 className="min-w-0 flex-1 text-[11px] font-semibold tracking-[0.18em] text-[#A5F3FC] uppercase">{text}</h3>
      {right}
    </header>
  );
}

function BeatPanel({
  beat,
  checkInId,
  reduced,
  mascotVariant,
  onContactGround,
  onOpenGuide,
}: {
  beat: ExplainBeat;
  checkInId: string | null;
  reduced: boolean;
  mascotVariant: number;
  onContactGround?: () => void;
  onOpenGuide?: (scenarioId: string) => void;
}) {
  const { t, lang } = useI18n();
  const p = beat.panel;
  const header = t(`checkin.explain.header.${p.kind}`, { label: labelOfPanel(p, lang) });
  switch (p.kind) {
    case "checking":
      return <CheckingPanel panel={p} header={header} reduced={reduced} />;
    case "chart":
      return <ChartPanel panel={p} header={header} reduced={reduced} />;
    case "days":
      return <DaysPanel panel={p} header={header} reduced={reduced} />;
    case "grid":
      return <GridPanel panel={p} header={header} reduced={reduced} />;
    case "actions":
      return (
        <ActionsPanel
          panel={p}
          header={header}
          reduced={reduced}
          mascotVariant={mascotVariant}
          onContactGround={onContactGround}
          onOpenGuide={onOpenGuide}
        />
      );
    case "signature": {
      const query = new URLSearchParams();
      if (p.reference) query.set("crew", p.reference);
      if (checkInId) query.set("checkInId", checkInId);
      const qs = query.toString();
      return (
        <div className={GLASS} data-panel-body="signature">
          <HeaderStrip text={header} />
          <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#67E8F9]/12 text-[#A5F3FC]" aria-hidden="true">
              <Microscope className="size-7" strokeWidth={1.6} />
            </span>
            <p className="flex-1 text-[15px] leading-snug text-white/85">{t("checkin.explain.signature.text")}</p>
            <a
              href={`/signature${qs ? `?${qs}` : ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 self-start rounded-full bg-[#67E8F9] px-4 py-2 text-[13.5px] font-semibold text-[#04122B] outline-none focus-visible:ring-3 focus-visible:ring-white/70"
            >
              {t("checkin.explain.signature.open")}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      );
    }
    case "note":
      return (
        <div className={GLASS} data-panel-body="note">
          <HeaderStrip text={header} />
          <div className="flex items-center gap-4 p-6">
            <span
              className="flex size-16 shrink-0 items-center justify-center rounded-full border border-[#67E8F9]/40 text-[#A5F3FC]"
              aria-hidden="true"
            >
              {p.tone === "calm" ? <Check className="size-7" /> : <Info className="size-7" />}
            </span>
            <p className="text-[19px] font-medium text-white/90">{t(`checkin.explain.note.${p.tone}`)}</p>
          </div>
        </div>
      );
  }
}

function CheckingPanel({
  panel,
  header,
  reduced,
}: {
  panel: Extract<ExplainPanel, { kind: "checking" }>;
  header: string;
  reduced: boolean;
}) {
  const { t, lang } = useI18n();
  const n = panel.recorded.length;
  return (
    <div className="relative">
      {/* the dotted arc from Cosmo to the analyser card (wide screens) */}
      <svg aria-hidden="true" className="pointer-events-none absolute top-1/2 -left-[150px] hidden h-[120px] w-[160px] -translate-y-1/2 overflow-visible md:block" viewBox="0 0 160 120">
        <motion.path
          d="M4 96 C 50 10, 110 10, 156 56"
          fill="none"
          stroke={CYAN}
          strokeOpacity={0.7}
          strokeWidth={2}
          strokeDasharray="2 7"
          strokeLinecap="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduced ? 0 : 0.9, ease: "easeOut" }}
        />
        <circle cx="156" cy="56" r="4" fill={CYAN} />
      </svg>
      <div className={GLASS} data-panel-body="checking">
        <HeaderStrip
          text={header}
          right={
            <span className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.16em] text-[#FDE68A] uppercase">
              <span className={cn("size-2 rounded-full bg-[#FBBF24]", !reduced && "animate-pulse")} aria-hidden="true" />
              {t("checkin.explain.analyzing")}
            </span>
          }
        />
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-[#67E8F9]/12 text-[#A5F3FC]" aria-hidden="true">
              <ScanLine className="size-6" strokeWidth={1.6} />
            </span>
            <div>
              <p className="text-[17px] font-semibold text-white">{t("checkin.explain.analyzer")}</p>
              <p className="text-[13px] text-white/65">
                {panel.historyDays > 0
                  ? t("checkin.explain.analyzed", { n, days: panel.historyDays })
                  : t("checkin.explain.analyzedNoHistory", { n })}
              </p>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {panel.recorded.map((r, i) => {
              const Icon = KEY_ICON[r.key] ?? Activity;
              return (
                <motion.li
                  key={r.key}
                  className="flex min-w-0 items-center gap-2 text-[13px] text-white/85"
                  initial={reduced ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: reduced ? 0 : 0.25 + i * 0.12, duration: reduced ? 0 : 0.3 }}
                >
                  <Icon className="size-3.5 shrink-0 text-[#A5F3FC]" aria-hidden="true" />
                  <span className="truncate">{KPI_DEFS[r.key].labels[lang]}</span>
                  <Check className="ml-auto size-3.5 shrink-0" style={{ color: STATUS_ON_DARK[r.status] }} aria-hidden="true" />
                </motion.li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function pillKey(panel: { flag: string; direction?: "high" | "low" | null }): string {
  if (panel.flag === "steady") return "checkin.explain.pill.steady";
  return `checkin.explain.pill.${panel.flag}.${panel.direction ?? "high"}`;
}

function Pill({ status, text }: { status: Status; text: string }) {
  const color = STATUS_ON_DARK[status];
  return (
    <span
      data-slot="explainer-pill"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase"
      style={{ borderColor: `${color}80`, background: `${color}1f`, color }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function ChartPanel({ panel, header, reduced }: { panel: Extract<ExplainPanel, { kind: "chart" }>; header: string; reduced: boolean }) {
  const { t, lang } = useI18n();
  // a narrower drawing on phones, so the axis labels stay readable when the chart is scaled to the screen
  const narrow = useNarrow();
  const W = narrow ? 360 : 640;
  const H = narrow ? 220 : 240;
  const digits = digitsOf(panel.key);
  const g = chartGeometry(panel, W, H, digits);
  const main = panel.series[0];
  const label = labelOfPanel(panel, lang);
  const todayText =
    main.today === null
      ? t("checkin.explain.noToday")
      : panel.series.length === 2 && panel.series[1].today !== null
        ? `${formatNumber(main.today, 0)}/${formatNumber(panel.series[1].today as number, 0)} mmHg`
        : valueText(panel.key, main.today, lang, true);
  const flagged = panel.flag !== "steady" && panel.flag !== "trend";
  const todayColor = flagged ? STATUS_ON_DARK[panel.status === "green" ? "yellow" : panel.status] : CYAN;
  return (
    <div className={GLASS} data-panel-body="chart">
      <HeaderStrip text={header} right={<Pill status={flagged ? (panel.status === "green" ? "yellow" : panel.status) : "green"} text={t(pillKey(panel))} />} />
      <div className="flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex items-baseline gap-2">
          <span className="tnum text-[34px] leading-none font-light tracking-[-0.02em] text-white">{todayText}</span>
          <span className="text-[12px] tracking-[0.12em] text-white/55 uppercase">{t("checkin.explain.legend.today")}</span>
        </div>
        <svg
          role="img"
          aria-label={t("checkin.explain.chartAria", { label, n: main.points.length, today: todayText })}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full overflow-visible"
          data-slot="explainer-chart"
        >
          {/* the person's own usual range */}
          {g.personal ? (
            <motion.rect
              data-slot="explainer-band"
              x={g.left}
              y={g.personal.top}
              width={g.right - g.left}
              height={Math.max(2, g.personal.bottom - g.personal.top)}
              rx={6}
              fill={CYAN}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 0.16 }}
              transition={{ duration: reduced ? 0 : 0.8, delay: reduced ? 0 : 0.3 }}
            />
          ) : null}
          {/* the general (or demo) normal range */}
          {g.normal
            ? (["low", "high"] as const).map((side) =>
                g.normal && g.normal[side] !== null ? (
                  <line
                    key={side}
                    data-slot="explainer-normal"
                    x1={g.left}
                    x2={g.right}
                    y1={g.normal[side] as number}
                    y2={g.normal[side] as number}
                    stroke="#C4B5FD"
                    strokeOpacity={0.75}
                    strokeWidth={1.4}
                    strokeDasharray="6 6"
                  />
                ) : null,
              )
            : null}
          {g.yTicks.map((tick) => (
            <text key={`${tick.y}-${tick.label}`} x={g.left - 8} y={tick.y + 4} textAnchor="end" fontSize={11} fill="rgba(255,255,255,0.5)">
              {tick.label}
            </text>
          ))}
          <line x1={g.left} x2={g.right} y1={g.bottom} y2={g.bottom} stroke="rgba(255,255,255,0.15)" />
          {g.xFirst ? (
            <text x={g.xFirst.x} y={H - 6} fontSize={11} fill="rgba(255,255,255,0.5)">
              {shortDate(g.xFirst.date, lang)}
            </text>
          ) : null}
          <text x={g.xToday} y={H - 6} fontSize={11} textAnchor="end" fill="rgba(255,255,255,0.75)">
            {t("checkin.explain.legend.today")}
          </text>
          {g.series.map((s, si) => (
            <g key={s.key}>
              {s.path ? (
                <motion.path
                  d={s.path}
                  fill="none"
                  stroke={si === 0 ? "#E0F2FE" : "#93C5FD"}
                  strokeOpacity={si === 0 ? 0.9 : 0.7}
                  strokeWidth={2}
                  strokeDasharray={si === 0 ? undefined : "5 5"}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduced ? 0 : 1.1, ease: "easeOut", delay: reduced ? 0 : 0.15 }}
                />
              ) : null}
              {s.dots.map((d, i) => (
                <circle key={`${d.date}-${i}`} cx={d.x} cy={d.y} r={2.6} fill="#E0F2FE" fillOpacity={0.75} />
              ))}
              {s.today ? (
                <g data-slot="explainer-today">
                  {!reduced ? (
                    <motion.circle
                      cx={s.today.x}
                      cy={s.today.y}
                      r={8}
                      fill="none"
                      stroke={todayColor}
                      strokeWidth={2}
                      initial={{ opacity: 0.9, scale: 0.6 }}
                      animate={{ opacity: [0.9, 0], scale: [0.6, 1.9] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: 1.2 }}
                      style={{ transformOrigin: `${s.today.x}px ${s.today.y}px` }}
                    />
                  ) : null}
                  <circle cx={s.today.x} cy={s.today.y} r={6} fill={todayColor} stroke="#04122B" strokeWidth={2} />
                </g>
              ) : null}
            </g>
          ))}
        </svg>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-white/65">
          {panel.personal ? (
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-[#67E8F9]/35" aria-hidden="true" />
              {t("checkin.explain.legend.personal")}
            </li>
          ) : null}
          {panel.normal ? (
            <li className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-[#C4B5FD]" aria-hidden="true" />
              {t(panel.normal.source === "general" ? "checkin.explain.legend.general" : "checkin.explain.legend.demo")}
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: todayColor }} aria-hidden="true" />
            {t("checkin.explain.legend.today")}
          </li>
        </ul>
      </div>
    </div>
  );
}

function DaysPanel({ panel, header, reduced }: { panel: Extract<ExplainPanel, { kind: "days" }>; header: string; reduced: boolean }) {
  const { t, lang } = useI18n();
  const flagged = panel.flag !== "steady";
  const color = STATUS_ON_DARK[panel.status === "green" || panel.status === "no_data" ? "green" : panel.status];
  const word = (v: number | null) =>
    v === null
      ? t("checkin.explain.noToday")
      : KPI_DEFS[panel.key].type === "category"
        ? valueText(panel.key, v, lang, true)
        : v > 0
          ? t("checkin.explain.days.yes")
          : t("checkin.explain.days.no");
  return (
    <div className={GLASS} data-panel-body="days">
      <HeaderStrip text={header} right={flagged ? <Pill status={panel.status === "green" ? "yellow" : panel.status} text={t(pillKey(panel))} /> : null} />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] leading-none font-light text-white">{word(panel.today)}</span>
          <span className="text-[12px] tracking-[0.12em] text-white/55 uppercase">{t("checkin.explain.days.today")}</span>
        </div>
        <ol className="flex flex-wrap items-end gap-2" aria-label={t("checkin.explain.days.count", { count: panel.count, n: panel.days.length })}>
          {panel.days.map((d, i) => (
            <motion.li
              key={`${d.date}-${i}`}
              title={`${shortDate(d.date, lang)}: ${word(d.value)}`}
              className="size-5 rounded-full border"
              style={d.value > 0 ? { background: `${color}cc`, borderColor: color } : { borderColor: "rgba(255,255,255,0.25)" }}
              initial={reduced ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: reduced ? 0 : 0.2 + i * 0.05, duration: reduced ? 0 : 0.25 }}
            />
          ))}
          <li
            className="ml-1 flex size-8 items-center justify-center rounded-full border-2 text-[10px] font-semibold"
            style={(panel.today ?? 0) > 0 ? { background: color, borderColor: color, color: "#04122B" } : { borderColor: CYAN, color: CYAN }}
          >
            {t("checkin.explain.days.todayShort")}
          </li>
        </ol>
        <p className="text-[13px] text-white/65">{t("checkin.explain.days.count", { count: panel.count, n: panel.days.length })}</p>
      </div>
    </div>
  );
}

function GridPanel({ panel, header, reduced }: { panel: Extract<ExplainPanel, { kind: "grid" }>; header: string; reduced: boolean }) {
  const { t, lang } = useI18n();
  return (
    <div className={GLASS} data-panel-body="grid">
      <HeaderStrip text={header} />
      <div className="relative flex gap-4 p-4 sm:p-5">
        {/* the holographic body (generated, public/visuals): the chips are the vitals it carries */}
        <div
          aria-hidden="true"
          className="hidden w-[150px] shrink-0 bg-contain bg-center bg-no-repeat opacity-90 sm:block"
          // the render's own navy background melts into the glass: lightened onto it, its edges faded out
          style={{
            backgroundImage: "url(/visuals/body-front.png)",
            minHeight: 230,
            mixBlendMode: "screen",
            maskImage: "radial-gradient(ellipse 60% 55% at 50% 50%, #000 62%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 50% 50%, #000 62%, transparent 100%)",
          }}
        />
        <ul className="grid flex-1 grid-cols-4 gap-x-1.5 gap-y-2.5 sm:gap-x-2 sm:gap-y-3 lg:grid-cols-5">
          {panel.chips.map((c, i) => {
            const color = STATUS_ON_DARK[c.status];
            const value =
              c.value === null
                ? "–"
                : c.key === "bp_systolic" && c.second !== undefined && c.second !== null
                  ? `${formatNumber(c.value, 0)}/${formatNumber(c.second, 0)}`
                  : valueText(c.key, c.value, lang, false);
            const label = c.key === "bp_systolic" ? (lang === "mn" ? "Цусны даралт" : "Blood pressure") : KPI_DEFS[c.key].labels[lang];
            return (
              <motion.li
                key={c.key}
                data-chip={c.key}
                data-status={c.status}
                className="flex flex-col items-center gap-1 text-center"
                initial={reduced ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: reduced ? 0 : 0.15 + i * 0.07, duration: reduced ? 0 : 0.3 }}
                aria-label={t("checkin.explain.grid.aria", { label, value, status: t(`checkin.explain.status.${c.status}`) })}
              >
                <span
                  className="relative flex size-12 items-center justify-center rounded-full border-2 bg-[#0B1A3A]/80 text-[10px] font-bold tracking-[0.02em] sm:size-14 sm:text-[11px] sm:tracking-[0.04em]"
                  style={{ borderColor: color, color: c.status === "no_data" ? "rgba(255,255,255,0.45)" : "#F0F9FF", boxShadow: c.status === "red" ? `0 0 18px ${color}66` : undefined }}
                  aria-hidden="true"
                >
                  {t(`checkin.explain.chip.${c.key}`)}
                  {c.status === "red" || c.status === "yellow" ? (
                    <span
                      className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full text-[11px] font-bold text-[#04122B]"
                      style={{ background: color }}
                    >
                      !
                    </span>
                  ) : null}
                </span>
                <span className="tnum text-[12px] text-white/85" aria-hidden="true">
                  {value}
                </span>
                <span className="line-clamp-1 text-[10.5px] text-white/50" aria-hidden="true">
                  {label}
                </span>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ActionsPanel({
  panel,
  header,
  reduced,
  mascotVariant,
  onContactGround,
  onOpenGuide,
}: {
  panel: Extract<ExplainPanel, { kind: "actions" }>;
  header: string;
  reduced: boolean;
  mascotVariant: number;
  onContactGround?: () => void;
  onOpenGuide?: (scenarioId: string) => void;
}) {
  const { t, pick } = useI18n();
  const guide = panel.guide;
  return (
    <div className={GLASS} data-panel-body="actions">
      <HeaderStrip text={header} />
      <div className="flex flex-col gap-4 p-5">
        {panel.alert ? (
          <p className="flex items-center gap-2 rounded-xl border border-[#F87171]/50 bg-[#F87171]/12 px-3 py-2 text-[13px] font-medium text-[#FECACA]" role="note">
            <span className={cn("size-2 rounded-full bg-[#F87171]", !reduced && "animate-pulse")} aria-hidden="true" />
            {t("checkin.explain.actions.alert")}
          </p>
        ) : null}
        <ol className="flex flex-col gap-2.5">
          {panel.actions.map((a, i) => (
            <motion.li
              key={a.id}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
              initial={reduced ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduced ? 0 : 0.2 + i * 0.25, duration: reduced ? 0 : 0.35 }}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[#67E8F9]/60 text-[14px] font-semibold text-[#A5F3FC]">
                {i + 1}
              </span>
              <span className="text-[15px] text-white/90">{pick(a.title)}</span>
            </motion.li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {onContactGround ? (
            <button
              type="button"
              onClick={onContactGround}
              data-slot="explainer-contact"
              title={t("checkin.explain.actions.contactHint")}
              className="flex h-12 items-center gap-2.5 rounded-full border border-[#F87171]/60 bg-[#F87171]/15 pr-5 pl-1.5 text-[14.5px] font-semibold text-[#FEE2E2] outline-none hover:bg-[#F87171]/25 focus-visible:ring-3 focus-visible:ring-[#F87171]/60"
            >
              <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0B1A3A]" aria-hidden="true">
                <CosmoAvatar variant={mascotVariant} state="idle" emotion="concerned" amplitude={0} size={36} />
              </span>
              <RadioTower className="size-4" aria-hidden="true" />
              {t("checkin.explain.actions.contact")}
            </button>
          ) : null}
          {guide && onOpenGuide ? (
            <button
              type="button"
              onClick={() => onOpenGuide(guide.scenarioId)}
              data-slot="explainer-guide"
              className="flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 text-[14px] font-medium text-white/90 outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-[#67E8F9]/60"
            >
              <LifeBuoy className="size-4" aria-hidden="true" />
              {t("checkin.explain.actions.guide", { title: pick(guide.title) })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
