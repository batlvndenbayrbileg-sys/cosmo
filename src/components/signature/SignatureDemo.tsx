"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Mic, RotateCcw, User } from "lucide-react";
import { PageFrame } from "@/components/shell/PageFrame";
import { TopBar, TopBarTrack } from "@/components/shell/TopBar";
import { Toggle } from "@/components/ui/toggle";
import { useI18n } from "@/i18n/I18nProvider";
import type { DemoBeat } from "@/lib/signature/demo";
import { SIGNATURE_DISCLAIMER } from "@/lib/signature/facts";
import type { Timepoint } from "@/lib/signature/types";
import type { SignatureViewData } from "@/lib/signature/view";
import { cn } from "@/lib/utils";
import { EvidenceCard } from "./EvidenceCard";
import { FingerprintCard } from "./FingerprintCard";
import { RecoveryCard } from "./RecoveryCard";
import { TriageCard } from "./TriageCard";
import { panelOf } from "./logic";

const PILL =
  "inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] text-[var(--aegis-ink)] ring-1 ring-[var(--aegis-hairline)] outline-none hover:bg-white/80 focus-visible:ring-3 focus-visible:ring-ring/60 disabled:opacity-40";

/** m:ss of a time slot */
function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** keys of an element that handles Space / arrows itself (a focused button, a toggle group item, an input) */
function ownsKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button, a, input, textarea, select, [role='radio'], [role='slider']"));
}

/**
 * /demo/signature body (addendum section 5; build prompt T9): plays the scripted beats with Next (Space / right arrow)
 * and an auto-play option. Each beat sets the crew member, the panel and the mission clock of the cards it shows; Cosmo's
 * line is a template computed on the server, spoken from a pre-generated clip only when that file exists, else captions
 * only. No fetch, no Anthropic, no ElevenLabs.
 */
export function SignatureDemo({
  view,
  beats,
  audioBase,
  audioFiles,
  initialBeat = 0,
}: {
  view: SignatureViewData;
  beats: DemoBeat[];
  /** public URL of the clip folder */
  audioBase: string;
  /** clips that exist (server check) */
  audioFiles: readonly string[];
  initialBeat?: number;
}) {
  const { t, lang } = useI18n();
  const last = beats.length - 1;
  const [index, setIndex] = useState(() => Math.min(Math.max(initialBeat, 0), Math.max(last, 0)));
  const [autoplay, setAutoplay] = useState(false);
  /** a panel picked on the Triage card for the current beat only */
  const [override, setOverride] = useState<{ index: number; tp: Timepoint } | null>(null);
  const [audioFailed, setAudioFailed] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const beat = beats[index];
  const audioFile = beat?.cosmo && audioFiles.includes(beat.cosmo.audioFile) ? beat.cosmo.audioFile : null;
  const hasAudio = audioFile !== null && audioFailed !== index;

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, last)), [last]);
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Next: Space or right arrow (left arrow goes back), unless a focused control handles the key itself
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || ownsKeys(e.target)) return;
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back]);

  // the beat's pre-generated clip (local file only); a refused or broken clip falls back to captions only
  useEffect(() => {
    if (!audioFile) {
      audioRef.current = null;
      return;
    }
    const a = new Audio(`${audioBase}/${audioFile}`);
    audioRef.current = a;
    const fail = () => {
      setAudioFailed(index);
      a.dispatchEvent(new Event("ended"));
    };
    a.addEventListener("error", fail);
    a.play().catch(fail);
    return () => {
      a.removeEventListener("error", fail);
      a.pause();
      if (audioRef.current === a) audioRef.current = null;
    };
  }, [audioBase, audioFile, index]);

  // auto-play: next beat when the beat's time slot is over and its clip (if any) has ended
  useEffect(() => {
    if (!autoplay || !beat || index >= last) return;
    let slotOver = false;
    const a = audioRef.current;
    let clipOver = a === null;
    const advance = () => {
      if (slotOver && clipOver) next();
    };
    const timer = window.setTimeout(() => {
      slotOver = true;
      advance();
    }, (beat.end - beat.start) * 1000);
    const onEnded = () => {
      clipOver = true;
      advance();
    };
    a?.addEventListener("ended", onEnded);
    return () => {
      window.clearTimeout(timer);
      a?.removeEventListener("ended", onEnded);
    };
  }, [autoplay, beat, index, last, next]);

  if (!beat) return null;

  const tp = override && override.index === index ? override.tp : beat.timepoint;
  const panel = panelOf(view, beat.crew, tp);
  const many = beat.cards.length > 1;

  return (
    <PageFrame data-slot="signature-demo" data-beat={beat.id}>
      <TopBar
        center={
          <TopBarTrack>
            <span className="px-3 text-[15px] font-medium text-[var(--aegis-ink)]">{t("dashboard.signature.demo.title")}</span>
          </TopBarTrack>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="unit-label">
            {t("dashboard.signature.demo.beat", { n: index + 1, total: beats.length })} ·{" "}
            {t("dashboard.signature.demo.slot", { from: clock(beat.start), to: clock(beat.end) })}
          </p>
          <h1 className="text-[28px] leading-tight font-light tracking-tight text-[var(--aegis-ink)] sm:text-[32px]">
            {t(`dashboard.signature.demo.beatName.${beat.id}`)}
          </h1>
          <p className="max-w-2xl text-[14px] text-[var(--aegis-label)]">{t("dashboard.signature.demo.subtitle")}</p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span className="unit-label">{t("dashboard.signature.demo.crew")}</span>
          <ul className="flex gap-1 rounded-full bg-[rgba(15,27,45,0.05)] p-1" aria-label={t("dashboard.signature.demo.crew")}>
            {view.crew.map((c) => (
              <li
                key={c}
                aria-current={c === beat.crew ? "true" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-full px-3.5 text-[14px] text-[var(--aegis-label)]",
                  c === beat.crew && "bg-white text-[var(--aegis-ink)] shadow-sm",
                )}
              >
                {c}
              </li>
            ))}
          </ul>
          <p data-slot="signature-demo-clock" className="flex items-center gap-1.5 text-[14px] text-[var(--aegis-ink)]">
            <Clock aria-hidden="true" className="size-4" />
            {t("dashboard.signature.demo.clock", { day: beat.clockDay })} (R+{beat.clockDay})
          </p>
        </div>
      </div>

      {beat.simulated ? (
        <p
          role="status"
          data-slot="signature-demo-simulated"
          className="rounded-2xl bg-[var(--status-watch-soft)] px-4 py-2.5 text-[14px] font-medium text-[var(--status-watch-ink)]"
        >
          {t("dashboard.signature.demo.simulated")}
        </p>
      ) : null}

      <section
        aria-live="polite"
        data-slot="signature-demo-captions"
        className="flex flex-col gap-3 rounded-2xl bg-white/70 p-4 ring-1 ring-[var(--aegis-hairline)] sm:p-5"
      >
        {beat.cosmo ? (
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--aegis-label)]">
              <Mic aria-hidden="true" className="size-3.5" />
              <span className="font-medium text-[var(--aegis-ink)]">{t("dashboard.signature.demo.cosmo")}</span>
              <span>{t(`dashboard.signature.demo.lang.${beat.cosmo.lang}`)}</span>
              <span>· {hasAudio ? t("dashboard.signature.demo.audio") : t("dashboard.signature.demo.captionsOnly")}</span>
            </p>
            {beat.cosmo.lang !== "en" ? (
              <p lang={beat.cosmo.lang} className="text-[13px] leading-snug text-[var(--aegis-label)]">
                {beat.cosmo.text}
              </p>
            ) : null}
            <p lang="en" className="text-[16px] leading-relaxed text-[var(--aegis-ink)]">
              {beat.cosmo.caption}
            </p>
          </div>
        ) : null}
        {beat.presenter ? (
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--aegis-ink)]">
              <User aria-hidden="true" className="size-3.5" />
              {t("dashboard.signature.demo.presenter")}
            </p>
            <p lang="en" className="text-[16px] leading-relaxed text-[var(--aegis-ink)] italic">
              {beat.presenter}
            </p>
          </div>
        ) : null}
      </section>

      {beat.cards.length ? (
        <div
          key={beat.id}
          className={cn("grid grid-cols-1 gap-5 animate-in fade-in duration-300", many ? "lg:grid-cols-2" : "mx-auto w-full max-w-[760px]")}
        >
          {beat.cards.map((card) => {
            switch (card) {
              case "triage":
                return (
                  <TriageCard key={card} panel={panel} timepoints={view.timepoints} onTimepoint={(x) => setOverride({ index, tp: x })} />
                );
              case "fingerprint":
                return <FingerprintCard key={card} view={view} panel={panel} />;
              case "recovery":
                return (
                  <RecoveryCard
                    key={card}
                    view={view}
                    crew={beat.crew}
                    timepoint={panel.timepoint}
                    dss={beat.dss}
                    simulated={beat.simulated}
                    today={beat.simulated ? beat.clockDay : undefined}
                  />
                );
              case "evidence":
                return <EvidenceCard key={card} />;
            }
          })}
        </div>
      ) : null}

      <nav aria-label={t("dashboard.signature.demo.controls")} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PILL} onClick={back} disabled={index === 0}>
            <ChevronLeft aria-hidden="true" className="size-4" />
            {t("dashboard.signature.demo.back")}
          </button>
          {index < last ? (
            <button type="button" data-slot="signature-demo-next" className={PILL} onClick={next}>
              {t("dashboard.signature.demo.next")}
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <button type="button" className={PILL} onClick={() => setIndex(0)}>
              <RotateCcw aria-hidden="true" className="size-4" />
              {t("dashboard.signature.demo.restart")}
            </button>
          )}
          <Toggle
            pressed={autoplay}
            onPressedChange={setAutoplay}
            className="h-10 rounded-full px-4 text-[14px] ring-1 ring-[var(--aegis-hairline)] aria-pressed:bg-[var(--aegis-pastel-blue)]"
          >
            {t("dashboard.signature.demo.autoplay")}
          </Toggle>
          <span className="text-[12px] text-[var(--aegis-label)]">
            {index < last ? t("dashboard.signature.demo.keys") : t("dashboard.signature.demo.end")}
          </span>
        </div>
        <ol className="flex flex-wrap gap-1.5">
          {beats.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                aria-label={`${i + 1}. ${t(`dashboard.signature.demo.beatName.${b.id}`)}`}
                aria-current={i === index ? "step" : undefined}
                onClick={() => setIndex(i)}
                className={cn(
                  "block h-2.5 w-7 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
                  i === index ? "bg-[var(--aegis-ink)]" : i < index ? "bg-[var(--aegis-ink)]/40" : "bg-[rgba(15,27,45,0.12)]",
                )}
              />
            </li>
          ))}
        </ol>
      </nav>

      <p className="text-center text-[13px] text-[var(--aegis-label)]">{SIGNATURE_DISCLAIMER[lang]}</p>
    </PageFrame>
  );
}
