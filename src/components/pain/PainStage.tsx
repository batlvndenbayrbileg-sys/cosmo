"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, CircleAlert, RadioTower, Satellite, ShieldAlert, X } from "lucide-react";
import {
  LOCATION_LABEL,
  ONSET_CHOICES,
  TAP_PHRASE,
  answerPhrase,
  onsetText,
  severityText,
  type PainItem,
  type PainLocation,
  type PainStep,
} from "@/lib/pain";
import { findBuiltInGuide, type EmergencyScenario } from "@/lib/emergency";
import type { Lang } from "@/lib/types";
import { formatClockLabel } from "@/components/dashboard/logic";
import { MascotPortrait } from "@/components/crew/MascotPortrait";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { BodyPainMap } from "./BodyPainMap";
import { dismissPain, getPainState, subscribePain, type PainUiState } from "./store";

/**
 * The pain check on screen (the `pain` turn event, src/lib/pain): a navy starfield with the large body map on the left
 * and glass panels on the right - where it hurts and how much, what in the person's own data may be related (each value
 * with its usual range shaded), the first-aid guide, the report to Earth and the next steps - plus Cosmo's words as a
 * caption. The panels appear ONE STEP AT A TIME as Cosmo reaches each part of her line (estimated from the length of
 * what she has said since her voice started; all at once with reduced motion or when she stops). For an urgent pain
 * the full guide opens by itself once she has finished speaking. Phones: one column, the body full width.
 */

const PANEL = "relative overflow-hidden rounded-[22px] border border-cyan-300/25 bg-[rgba(8,22,52,0.62)] p-4 shadow-[0_24px_60px_-30px_rgba(0,200,255,0.45)] backdrop-blur-md";
const STRIP = "text-[10.5px] font-semibold tracking-[0.16em] text-cyan-200/80 uppercase";

/** speaking speed for the reveal (characters per second) */
const CHARS_PER_SECOND: Record<Lang, number> = { en: 15, mn: 13 };
/** no voice (muted, browser speech blocked): the reveal runs on its own after this long */
const NO_VOICE_AFTER_MS = 2500;
/** within the data step, one item after the other */
const ITEM_GAP_MS = 900;

type SpeechStatus = "idle" | "loading" | "playing";

interface Clock {
  seq: number;
  /** when Cosmo's voice started (ms), or when the reveal started without one; null before */
  start: number | null;
  now: number;
  /** her voice was heard for this event */
  spoke: boolean;
  /** her voice stopped after it was heard: everything is shown */
  done: boolean;
}

/** which parts of Cosmo's line have been reached, and how long ago each was */
function useReveal(pain: PainUiState | null, speech: SpeechStatus, reduced: boolean) {
  const [clock, setClock] = useState<Clock>({ seq: -1, start: null, now: 0, spoke: false, done: false });
  useEffect(() => {
    if (!pain) return;
    const tick = () =>
      setClock((c) => {
        const now = Date.now();
        const base: Clock = c.seq === pain.seq ? c : { seq: pain.seq, start: null, now, spoke: false, done: false };
        const playing = speech === "playing";
        let start = base.start;
        if (playing && start === null) start = now;
        if (start === null && now - pain.at > NO_VOICE_AFTER_MS) start = now;
        const spoke = base.spoke || playing;
        const done = base.done || (base.spoke && speech === "idle");
        return { seq: pain.seq, start, now, spoke, done };
      });
    tick();
    const id = window.setInterval(tick, 120);
    return () => window.clearInterval(id);
  }, [pain, speech]);

  return useMemo(() => {
    const script = pain?.event.script ?? [];
    const rate = CHARS_PER_SECOND[pain?.lang ?? "en"];
    const elapsed = clock.start === null || clock.seq !== pain?.seq ? 0 : clock.now - clock.start;
    const totalMs = (script.reduce((n, p) => n + p.text.length + 1, 0) / rate) * 1000;
    const all = reduced || (clock.seq === pain?.seq && (clock.done || elapsed >= totalMs + 400));
    let offset = 0;
    const reached = new Map<PainStep, number>();
    let current = 0;
    script.forEach((part, i) => {
      const at = (offset / rate) * 1000;
      if (all || i === 0 || (clock.start !== null && elapsed >= at)) {
        reached.set(part.step, all ? Number.POSITIVE_INFINITY : Math.max(0, elapsed - at));
        current = i;
      }
      offset += part.text.length + 1;
    });
    return { reached, caption: script[current]?.text ?? "", finished: all };
  }, [pain, clock, reduced]);
}

/* ───────────── small parts ───────────── */

function Reveal({ show, reduced, children, delay = 0 }: { show: boolean; reduced: boolean; children: React.ReactNode; delay?: number }) {
  return (
    <AnimatePresence initial={!reduced}>
      {show ? (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: "spring", stiffness: 190, damping: 24, delay }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PulseDot({ tone, reduced }: { tone: "cyan" | "red"; reduced: boolean }) {
  const color = tone === "red" ? "bg-[#FF5A6E]" : "bg-cyan-300";
  return (
    <span aria-hidden="true" className="relative flex size-2.5 shrink-0">
      {reduced ? null : <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", color)} />}
      <span className={cn("relative size-2.5 rounded-full", color)} />
    </span>
  );
}

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/** the person's past values as a line, their usual range shaded, today's value last (red and labelled when unusual) */
function ItemChart({ item }: { item: PainItem }) {
  const { t, pick } = useI18n();
  const W = 300;
  const H = 86;
  const pad = 10;
  const series = item.value === null ? item.history : [...item.history, item.value];
  if (series.length < 2) return null;
  const band = item.personal ?? (item.normal && item.normal.low !== null && item.normal.high !== null ? { low: item.normal.low, high: item.normal.high } : null);
  const all = [...series, ...(band ? [band.low, band.high] : [])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
  const x = (i: number) => pad + ((W - 2 * pad - 52) * i) / Math.max(1, series.length - 1);
  const d = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = series.length - 1;
  const unusual = item.band !== "reported" && item.band !== "flagged";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block h-[86px] w-full" role="img" aria-label={t("emergency.pain.chartAria", { label: pick(item.label) })}>
      {band ? (
        <rect x={pad} y={y(band.high)} width={W - 2 * pad - 52} height={Math.max(2, y(band.low) - y(band.high))} rx={6} fill="#5FE3FF" fillOpacity={0.13} />
      ) : null}
      <path d={d} fill="none" stroke="#9BEFFF" strokeOpacity={0.85} strokeWidth={1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {series.slice(0, -1).map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill="#9BEFFF" />
      ))}
      <circle cx={x(last)} cy={y(series[last])} r={5} fill={unusual ? "#FF5A6E" : "#9BEFFF"} stroke="#fff" strokeWidth={1.5} />
      {unusual && item.direction ? (
        <g>
          <rect x={x(last) + 8} y={y(series[last]) - 11} width={44} height={20} rx={10} fill="#FF5A6E" />
          <text x={x(last) + 30} y={y(series[last]) + 3} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#fff">
            {t(item.direction === "high" ? "emergency.pain.high" : "emergency.pain.low").toUpperCase()}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

function ItemCard({ item }: { item: PainItem }) {
  const { t, pick } = useI18n();
  const alarm = item.band === "danger" || item.band === "outside_general";
  const ranges: string[] = [];
  if (item.personal) ranges.push(t("emergency.pain.usual", { range: `${fmt(item.personal.low)}–${fmt(item.personal.high)}` }));
  if (item.normal && (item.normal.low !== null || item.normal.high !== null)) {
    const n = item.normal;
    const r = n.low !== null && n.high !== null ? `${fmt(n.low)}–${fmt(n.high)}` : n.low !== null ? `≥ ${fmt(n.low)}` : `≤ ${fmt(n.high as number)}`;
    ranges.push(t("emergency.pain.normal", { range: r }));
  }
  return (
    <article className={cn(PANEL, "p-3.5")} data-pain-item={item.id} data-band={item.band}>
      <header className="flex items-center gap-2">
        <span className={cn(STRIP, "min-w-0 flex-1 truncate")}>{pick(item.label)}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase",
            alarm ? "bg-[#FF5A6E] text-white" : "bg-amber-300/90 text-[#1c1300]",
          )}
        >
          {t(`emergency.pain.band.${item.band}`)}
        </span>
      </header>
      <p className="tnum mt-1.5 text-[24px] leading-tight font-light text-white">{pick(item.valueText)}</p>
      <ItemChart item={item} />
      <p className="mt-1.5 text-[12.5px] leading-snug text-cyan-50/85">{pick(item.note)}</p>
      {ranges.length > 0 ? <p className="mt-1 text-[11px] text-cyan-200/70">{ranges.join(" · ")}</p> : null}
    </article>
  );
}

function SeverityBar({ value }: { value: number | null }) {
  return (
    <div className="mt-1 flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: 11 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 flex-1 rounded-full",
            value !== null && i <= value ? (i >= 8 ? "bg-[#FF5A6E]" : i >= 5 ? "bg-amber-300" : "bg-cyan-300") : "bg-white/12",
          )}
        />
      ))}
    </div>
  );
}

/** "How strong? Since when?": 0-10 and a few "since" choices, sent to Cosmo as words */
function AskCard({ lang, onSay }: { lang: Lang; onSay: (text: string) => void }) {
  const { t, pick } = useI18n();
  const [severity, setSeverity] = useState<number | null>(null);
  const [onset, setOnset] = useState<string | null>(null);
  const ready = severity !== null || onset !== null;
  return (
    <section className={PANEL} aria-labelledby="pain-ask-title">
      <h3 id="pain-ask-title" className={STRIP}>
        {t("emergency.pain.askTitle")}
      </h3>
      <p className="mt-1 text-[12px] text-cyan-100/70">{t("emergency.pain.askScale")}</p>
      <div className="mt-2 grid grid-cols-11 gap-1" role="radiogroup" aria-label={t("emergency.pain.severity")}>
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={severity === i}
            onClick={() => setSeverity(i)}
            className={cn(
              "tnum h-9 rounded-lg border text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
              severity === i ? (i >= 8 ? "border-[#FF5A6E] bg-[#FF5A6E] text-white" : "border-cyan-300 bg-cyan-300 text-[#04203a]") : "border-cyan-300/25 bg-white/5 text-cyan-50 hover:bg-cyan-300/10",
            )}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("emergency.pain.onset")}>
        {ONSET_CHOICES.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={onset === o.id}
            onClick={() => setOnset(o.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
              onset === o.id ? "border-cyan-300 bg-cyan-300 text-[#04203a]" : "border-cyan-300/25 bg-white/5 text-cyan-50 hover:bg-cyan-300/10",
            )}
          >
            {pick(o.label)}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!ready}
        onClick={() => onSay(answerPhrase(severity, onset, lang))}
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-cyan-300 px-5 text-[14px] font-semibold text-[#04203a] outline-none hover:bg-cyan-200 focus-visible:ring-3 focus-visible:ring-white/60 disabled:opacity-40"
      >
        {t("emergency.pain.askSend")}
      </button>
    </section>
  );
}

/* ───────────── the stage ───────────── */

export function PainStage({
  speech,
  busy,
  onSay,
  onOpenGuide,
  guides,
  mascotVariant = 0,
}: {
  /** Cosmo's voice: the panels follow what she is saying */
  speech: SpeechStatus;
  /** a turn is in flight (taps wait) */
  busy: boolean;
  /** say these words to Cosmo (a tapped place, the answer card) */
  onSay: (text: string) => void;
  /** open an emergency guide (the existing overlay) */
  onOpenGuide: (guideId: string) => void;
  /** the guide library the app shows (team content included) */
  guides: readonly EmergencyScenario[];
  mascotVariant?: number;
}) {
  const { t, pick } = useI18n();
  const reduced = usePrefersReducedMotion();
  const pain = useSyncExternalStore(subscribePain, getPainState, () => null);
  const { reached, caption, finished } = useReveal(pain, speech, reduced);
  const event = pain?.event ?? null;
  const lang: Lang = pain?.lang ?? "en";

  // urgent: the full guide opens by itself once Cosmo has said her line (once per event)
  const openedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!pain || !event?.urgent || !event.guideId || !finished || speech !== "idle") return;
    if (openedFor.current === pain.seq) return;
    openedFor.current = pain.seq;
    onOpenGuide(event.guideId);
  }, [pain, event, finished, speech, onOpenGuide]);

  // Escape closes the stage
  useEffect(() => {
    if (!pain) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) dismissPain();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pain]);

  const guide = event?.guideId ? (guides.find((g) => g.id === event.guideId) ?? findBuiltInGuide(event.guideId)) : null;
  const say = (text: string) => {
    if (!busy) onSay(text);
  };
  const tap = (location: PainLocation) => say(TAP_PHRASE[location][lang]);
  const urgent = event?.urgent ?? false;
  const place = event?.location ? pick(LOCATION_LABEL[event.location]) : null;
  const sentTime = event?.sentAt ? formatClockLabel(event.sentAt, lang) : "";
  // a step Cosmo does not say this time (the data after an answer to "how strong?") shows from the start
  const seen = (step: PainStep) => reached.has(step) || (step === "data" && !(event?.script ?? []).some((p) => p.step === "data"));
  const dataAt = reached.get("data") ?? (seen("data") ? Number.POSITIVE_INFINITY : 0);

  return (
    <AnimatePresence>
      {pain && event ? (
        <motion.section
          key="pain-stage"
          data-slot="pain-stage"
          data-urgent={urgent ? "true" : "false"}
          aria-label={t("emergency.pain.region")}
          className="fixed inset-0 z-[55] overflow-y-auto overscroll-contain bg-[#030a1c] text-white"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* the starfield with Earth's horizon (the only other bitmap), darkened for reading */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 bg-[url('/visuals/space-earth.png')] bg-cover bg-bottom opacity-70"
          />
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(3,10,28,0.55),rgba(3,10,28,0.25)_45%,rgba(3,10,28,0.8))]" />

          <div className="relative mx-auto flex min-h-full w-full max-w-[1280px] flex-col gap-4 px-4 pt-16 pb-28 md:px-6">
            {/* header strip: Cosmo, the title in caps, urgent, close */}
            <header className="flex items-center gap-3">
              <MascotPortrait variant={mascotVariant} size={44} state={speech === "playing" ? "talking" : "idle"} emotion="concerned" />
              <div className={cn(PANEL, "flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 py-2.5")}>
                <PulseDot tone={urgent ? "red" : "cyan"} reduced={reduced} />
                <p className={cn(STRIP, "min-w-0 flex-1 truncate text-cyan-50")}>
                  {place ? t("emergency.pain.headerPlace", { place }) : t("emergency.pain.header")}
                </p>
                {urgent ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FF5A6E] px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.14em] text-white uppercase">
                    <ShieldAlert className="size-3.5" aria-hidden="true" />
                    {t("emergency.pain.urgent")}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={dismissPain}
                aria-label={t("emergency.pain.close")}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-white/5 text-cyan-50 outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-cyan-300/60"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-start">
              {/* the body */}
              <div className="flex flex-col gap-2 md:sticky md:top-4">
                <BodyPainMap
                  selected={event.location}
                  urgent={urgent}
                  onTap={tap}
                  reduced={reduced}
                  className="mx-auto w-full max-w-[520px] md:max-w-none"
                />
                {event.awaiting === "location" ? (
                  <p className="text-center text-[15px] font-medium text-cyan-100" role="status">
                    {t("emergency.pain.tapHint")}
                  </p>
                ) : null}
              </div>

              {/* the panels, one step at a time */}
              <div className="flex flex-col gap-3" aria-live="polite">
                <Reveal show reduced={reduced}>
                  <section className={PANEL} aria-label={t("emergency.pain.where")}>
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <dt className={STRIP}>{t("emergency.pain.where")}</dt>
                        <dd className="mt-1 text-[19px] font-medium">{place ?? t("emergency.pain.notSaid")}</dd>
                      </div>
                      <div>
                        <dt className={STRIP}>{t("emergency.pain.severity")}</dt>
                        <dd className="mt-1 text-[19px] font-medium">{severityText(event.severity, lang) || t("emergency.pain.notSaid")}</dd>
                        <SeverityBar value={event.severity?.value ?? (event.severity?.word === "severe" ? 9 : event.severity?.word === "moderate" ? 5 : event.severity?.word === "mild" ? 2 : null)} />
                      </div>
                      <div>
                        <dt className={STRIP}>{t("emergency.pain.onset")}</dt>
                        <dd className="mt-1 text-[19px] font-medium">{onsetText(event.onset, lang) || t("emergency.pain.notSaid")}</dd>
                      </div>
                    </dl>
                    {event.redFlags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className={cn(STRIP, "text-[#FFB3BD]")}>{t("emergency.pain.flags")}</span>
                        {event.redFlags.map((f) => (
                          <span key={f} className="rounded-full border border-[#FF5A6E]/60 bg-[#FF5A6E]/15 px-2.5 py-0.5 text-[12px] text-[#FFD6DC]">
                            {t(`emergency.pain.flag.${f}`)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </section>
                </Reveal>

                {event.awaiting !== "location" ? (
                  <Reveal show={seen("data")} reduced={reduced}>
                    <section aria-label={t("emergency.pain.dataTitle")} className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-2 px-1">
                        <PulseDot tone="cyan" reduced={reduced} />
                        <h3 className={STRIP}>{t("emergency.pain.dataTitle")}</h3>
                      </div>
                      {event.items.length === 0 ? (
                        <p className={cn(PANEL, "text-[14px] text-cyan-50/90")}>{t("emergency.pain.dataNone")}</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                          {event.items.map((item, i) => (
                            <Reveal key={item.id} show={dataAt >= i * ITEM_GAP_MS} reduced={reduced}>
                              <ItemCard item={item} />
                            </Reveal>
                          ))}
                        </div>
                      )}
                    </section>
                  </Reveal>
                ) : (
                  <p className={cn(PANEL, "text-[13.5px] text-cyan-50/80")}>{t("emergency.pain.dataWaiting")}</p>
                )}

                {guide ? (
                  <Reveal show={seen("guide") || (seen("earth") && !urgent)} reduced={reduced}>
                    <section className={cn(PANEL, urgent && "border-[#FF5A6E]/60")} aria-labelledby="pain-guide-title">
                      <div className="flex items-center gap-2">
                        <CircleAlert className={cn("size-4", urgent ? "text-[#FF8A98]" : "text-cyan-200")} aria-hidden="true" />
                        <h3 id="pain-guide-title" className={STRIP}>
                          {t("emergency.pain.guideTitle")}
                        </h3>
                      </div>
                      <p className="mt-1.5 text-[18px] font-medium">{pick(guide.title)}</p>
                      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-snug text-cyan-50/85">
                        {guide.steps.slice(0, 3).map((s, i) => (
                          <li key={i}>{pick(s.text)}</li>
                        ))}
                      </ol>
                      <button
                        type="button"
                        onClick={() => onOpenGuide(guide.id)}
                        className={cn(
                          "mt-3 inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-[14px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-white/60",
                          urgent ? "bg-[#FF5A6E] text-white hover:bg-[#ff7385]" : "bg-cyan-300 text-[#04203a] hover:bg-cyan-200",
                        )}
                      >
                        {t("emergency.pain.guideOpen")}
                        <ArrowUpRight className="size-4" aria-hidden="true" />
                      </button>
                    </section>
                  </Reveal>
                ) : null}

                <Reveal show={seen("earth") || (event.awaiting === "location" && !urgent)} reduced={reduced}>
                  <section className={cn(PANEL, "flex items-start gap-3")} aria-labelledby="pain-earth-title">
                    <span className={cn("mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full", urgent ? "bg-[#FF5A6E]/20 text-[#FF8A98]" : "bg-cyan-300/15 text-cyan-200")}>
                      {event.reportSent || event.sos === "sent" || event.sos === "duplicate" ? <Satellite className="size-4.5" aria-hidden="true" /> : <RadioTower className="size-4.5" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 id="pain-earth-title" className={STRIP}>
                        {t("emergency.pain.earthTitle")}
                      </h3>
                      <p className="mt-1 flex items-center gap-1.5 text-[14.5px] font-medium" role="status">
                        {event.reportSent || event.sos === "sent" || event.sos === "duplicate" ? <Check className="size-4 text-emerald-300" aria-hidden="true" /> : null}
                        {event.sos === "failed"
                          ? t("emergency.pain.earthFailed")
                          : event.sos === "duplicate"
                            ? t("emergency.pain.earthDuplicate")
                            : event.sos === "sent"
                              ? t("emergency.pain.earthUrgent", { time: sentTime })
                              : event.reportSent
                                ? t("emergency.pain.earthSent", { time: sentTime })
                                : event.awaiting === "location"
                                  ? t("emergency.pain.earthWaiting")
                                  : t("emergency.pain.earthReportFailed")}
                      </p>
                    </div>
                  </section>
                </Reveal>

                <Reveal show={seen("earth")} reduced={reduced}>
                  <section className={PANEL} aria-labelledby="pain-actions-title">
                    <h3 id="pain-actions-title" className={STRIP}>
                      {t("emergency.pain.actionsTitle")}
                    </h3>
                    <ol className="mt-2 flex flex-col gap-2">
                      {(urgent ? ["urgent1", "urgent2", "urgent3"] : ["calm1", "calm2", "calm3"]).map((k, i) => (
                        <li key={k} className="flex items-center gap-2.5 text-[14px]">
                          <span
                            className={cn(
                              "tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                              urgent && i === 0 ? "bg-[#FF5A6E] text-white" : "bg-cyan-300/20 text-cyan-100",
                            )}
                          >
                            {i + 1}
                          </span>
                          {t(`emergency.pain.action.${k}`)}
                        </li>
                      ))}
                    </ol>
                  </section>
                </Reveal>

                {event.awaiting === "details" ? (
                  <Reveal show={seen("ask")} reduced={reduced}>
                    <AskCard key={pain.seq} lang={lang} onSay={say} />
                  </Reveal>
                ) : null}
              </div>
            </div>

            <p className="text-center text-[10px] font-semibold tracking-[0.16em] text-cyan-100/55 uppercase">{t("emergency.pain.footer")}</p>
          </div>

          {/* Cosmo's words as a caption, in step with the panels */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center px-4 pb-4">
            <p
              aria-label={t("emergency.pain.caption")}
              className="max-w-3xl rounded-2xl bg-[rgba(3,10,28,0.78)] px-4 py-2.5 text-center text-[14.5px] leading-snug text-white/95 ring-1 ring-cyan-300/20 backdrop-blur"
            >
              <span className="mr-1.5 font-semibold text-cyan-200">{t("emergency.pain.cosmo")}:</span>
              {caption}
            </p>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
