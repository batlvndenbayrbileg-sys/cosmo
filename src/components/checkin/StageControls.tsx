"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowUp, CircleHelp, Info, Keyboard, Play, ScanFace, Square, TriangleAlert, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { getKpi } from "@/lib/kpi/registry";
import { cn } from "@/lib/utils";
import type { KpiKey, Lang } from "@/lib/types";
import type { FaceTrackStatus } from "./face-tracker";

/** Frosted glass surface shared by every small control on the stage. */
export const GLASS =
  "border border-white/80 bg-white/65 shadow-[0_10px_30px_-14px_rgba(40,80,160,0.35)] backdrop-blur-xl backdrop-saturate-150";

/** Ghost corner control: ~35% opacity, fully visible on hover or keyboard focus. */
export const GHOST = cn(
  GLASS,
  "inline-flex h-10 items-center justify-center gap-2 rounded-full text-[var(--cosmo-ink)]",
  "opacity-35 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100",
  "outline-none focus-visible:ring-3 focus-visible:ring-[var(--cosmo-accent)]/45",
  "aria-pressed:opacity-90",
);

/* ───────────── corners ───────────── */

export function BackControl() {
  const { t } = useI18n();
  return (
    <Link href="/" aria-label={t("checkin.back")} className={cn(GHOST, "w-10")} data-slot="stage-back">
      <ArrowLeft className="size-[18px]" aria-hidden="true" />
    </Link>
  );
}

const LANGS: Array<{ lang: Lang; short: string; nameKey: string }> = [
  { lang: "en", short: "EN", nameKey: "shell.lang.en" },
  { lang: "mn", short: "МН", nameKey: "shell.lang.mn" },
];

export function LanguageCaptionControls({
  captions,
  onCaptions,
}: {
  captions: boolean;
  onCaptions: (on: boolean) => void;
}) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="flex items-center gap-2" data-slot="stage-lang">
      <div
        role="group"
        aria-label={t("shell.lang.label")}
        className={cn(GLASS, "flex h-10 items-center rounded-full p-1 opacity-35 transition-opacity duration-200 focus-within:opacity-100 hover:opacity-100")}
      >
        {LANGS.map((o) => (
          <button
            key={o.lang}
            type="button"
            lang={o.lang}
            aria-pressed={lang === o.lang}
            aria-label={t(o.nameKey)}
            onClick={() => setLang(o.lang)}
            className={cn(
              "h-8 min-w-10 rounded-full px-2.5 text-[13px] font-medium text-[var(--cosmo-ink)] outline-none",
              "focus-visible:ring-3 focus-visible:ring-[var(--cosmo-accent)]/45",
              lang === o.lang ? "bg-[var(--cosmo-ink)] text-white" : "hover:bg-white/80",
            )}
          >
            {o.short}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={captions}
        aria-label={t("checkin.captions.toggle")}
        title={t("checkin.captions.toggle")}
        onClick={() => onCaptions(!captions)}
        className={cn(GHOST, "w-10 text-[12px] font-semibold tracking-wide", captions && "bg-[var(--cosmo-ink)] text-white")}
      >
        CC
      </button>
    </div>
  );
}

/**
 * "Cosmo looks at you": turns camera face following on and off (off by default, the choice is remembered).
 * The tooltip and the accessible description say that the video never leaves the browser. While the camera
 * is actually running a small green dot sits on the button (and "Camera on" is announced).
 */
export function FaceFollowControl({
  on,
  status,
  onToggle,
}: {
  on: boolean;
  status: FaceTrackStatus;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const descId = useId();
  const label = t("checkin.faceFollow.toggle");
  const privacy = t("checkin.faceFollow.privacy");
  const live = on && status === "on";
  return (
    <span className="relative inline-flex" data-slot="stage-face-follow" data-camera={live ? "on" : "off"}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        aria-describedby={descId}
        title={`${label}. ${privacy}`}
        onClick={() => onToggle(!on)}
        className={cn(GHOST, "w-10", on && "bg-[var(--cosmo-ink)] text-white")}
      >
        <ScanFace className="size-[18px]" aria-hidden="true" />
      </button>
      <span id={descId} className="sr-only">
        {privacy}
      </span>
      <span role="status" className="sr-only">
        {live ? t("checkin.faceFollow.on") : ""}
      </span>
      {live ? (
        <span
          aria-hidden="true"
          title={t("checkin.faceFollow.on")}
          data-slot="camera-on"
          className="pointer-events-none absolute -top-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      ) : null}
    </span>
  );
}

export function DemoControl({
  running,
  disabled,
  onRun,
  onStop,
}: {
  running: boolean;
  disabled: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-slot="stage-demo"
      disabled={!running && disabled}
      onClick={running ? onStop : onRun}
      className={cn(GHOST, "px-4 text-[13px] font-medium disabled:pointer-events-none", running && "opacity-80")}
    >
      {running ? (
        <Square className="size-3.5 fill-current" aria-hidden="true" />
      ) : (
        <Play className="size-3.5 fill-current" aria-hidden="true" />
      )}
      {running ? t("checkin.demo.stop") : t("checkin.demo.run")}
      {running ? <span className="sr-only">{t("checkin.demo.running")}</span> : null}
    </button>
  );
}

/** Keyboard icon (bottom-right) that opens a minimal glass field for typed answers. */
export function KeyboardControl({
  open,
  onOpenChange,
  onSend,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const inputId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    onOpenChange(false);
    buttonRef.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (text === "" || disabled) return;
    setValue("");
    onSend(text);
  };

  return (
    <div className="flex flex-col items-end gap-2" data-slot="stage-keyboard">
      <AnimatePresence>
        {open ? (
          <motion.form
            key="field"
            onSubmit={submit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className={cn(GLASS, "flex w-[min(26rem,calc(100vw-2rem))] items-center gap-1.5 rounded-full p-1.5 pl-4")}
          >
            <label htmlFor={inputId} className="sr-only">
              {t("checkin.text.label")}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("checkin.text.placeholder")}
              autoComplete="off"
              enterKeyHint="send"
              className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--cosmo-ink)] outline-none placeholder:text-[var(--cosmo-label)]/80"
            />
            <button
              type="submit"
              disabled={disabled || value.trim() === ""}
              aria-label={t("checkin.text.send")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--cosmo-ink)] text-white outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-[var(--cosmo-accent)]/45 disabled:opacity-30"
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          </motion.form>
        ) : null}
      </AnimatePresence>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label={open ? t("checkin.keyboard.close") : t("checkin.keyboard.open")}
        title={open ? t("checkin.keyboard.close") : t("checkin.keyboard.open")}
        onClick={() => (open ? close() : onOpenChange(true))}
        className={cn(GHOST, "w-10", open && "opacity-90")}
      >
        {open ? <X className="size-[18px]" aria-hidden="true" /> : <Keyboard className="size-[18px]" aria-hidden="true" />}
      </button>
    </div>
  );
}

/* ───────────── toasts ───────────── */

export interface StageToast {
  id: string;
  text: string;
  tone: "info" | "error";
  onDismiss?: () => void;
  /** label of the toast's one action button; pressing it calls StageToasts `onAction(id)` */
  action?: string;
}

/** Small glass toasts at the top centre: errors and notices, never a red sentence mid-screen. */
export function StageToasts({ toasts, onAction }: { toasts: StageToast[]; onAction?: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <div
      className="pointer-events-none fixed top-16 left-1/2 z-30 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2 md:top-4 md:w-[min(30rem,calc(100vw-16rem))]"
      data-slot="stage-toasts"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            role={toast.tone === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className={cn(GLASS, "pointer-events-auto flex max-w-full items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3.5")}
          >
            {toast.tone === "error" ? (
              <TriangleAlert className="size-4 shrink-0 text-status-watch-ink" aria-hidden="true" />
            ) : (
              <Info className="size-4 shrink-0 text-[var(--cosmo-accent-deep)]" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-[var(--cosmo-ink)]">{toast.text}</p>
            {toast.action ? (
              <button
                type="button"
                onClick={() => onAction?.(toast.id)}
                className="h-8 shrink-0 rounded-full bg-[var(--cosmo-ink)] px-3 text-[13px] font-medium text-white outline-none focus-visible:ring-3 focus-visible:ring-[var(--cosmo-accent)]/45"
              >
                {toast.action}
              </button>
            ) : null}
            {toast.onDismiss ? (
              <button
                type="button"
                onClick={toast.onDismiss}
                aria-label={t("shell.action.dismiss")}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--cosmo-label)] outline-none hover:bg-white/80 focus-visible:ring-3 focus-visible:ring-[var(--cosmo-accent)]/45"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── question bubble ───────────── */

/**
 * The server sends a machine reason code with each clarification ("unclear", "out_of_range", "not_a_number",
 * "not_verified"); it is shown as a sentence in the screen's language, never as the raw code.
 */
const CLARIFY_REASON_KEYS: Record<string, string> = {
  unclear: "checkin.clarify.reason.unclear",
  out_of_range: "checkin.clarify.reason.outOfRange",
  not_a_number: "checkin.clarify.reason.notANumber",
  not_verified: "checkin.clarify.reason.notVerified",
};

/** Soft question bubble beside Cosmo's head while she needs one more detail; it leaves once answered. */
export function QuestionBubble({
  clarification,
  x,
  y,
  maxWidth,
}: {
  clarification: { key: KpiKey; reason: string } | null;
  x: number;
  y: number;
  maxWidth: number;
}) {
  const { t, lang } = useI18n();
  return (
    <AnimatePresence>
      {clarification ? (
        <motion.div
          key={clarification.key}
          role="note"
          data-slot="question-bubble"
          className="absolute z-10"
          style={{ left: x, top: y, maxWidth, transformOrigin: "0% 100%" }}
          initial={{ opacity: 0, scale: 0.6, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -6 }}
          transition={{ type: "spring", stiffness: 220, damping: 20 }}
        >
          <div className={cn(GLASS, "relative flex items-start gap-2.5 rounded-[22px] rounded-bl-md bg-[var(--cosmo-pastel-lilac)]/80 px-3.5 py-2.5")}>
            <CircleHelp className="mt-0.5 size-[18px] shrink-0 text-[#6d4fd8]" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[14.5px] font-medium leading-snug text-[var(--cosmo-ink)]">
                {t("checkin.clarify.title", { label: getKpi(clarification.key).labels[lang] })}
              </p>
              {CLARIFY_REASON_KEYS[clarification.reason.trim()] ? (
                <p className="mt-0.5 text-[13px] leading-snug text-[var(--cosmo-label)]">
                  {t(CLARIFY_REASON_KEYS[clarification.reason.trim()])}
                </p>
              ) : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ───────────── small pieces ───────────── */

/** Slim spinning progress arc for the "preparing your dashboard" line. */
export function ProgressArc({ size = 18 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      animate={{ rotate: 360 }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
    >
      <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(79,134,247,0.18)" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="var(--cosmo-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="14 50.3"
      />
    </motion.svg>
  );
}

export function Corner({ className, children }: { className: string; children: ReactNode }) {
  return <div className={cn("absolute z-20 flex items-center gap-2", className)}>{children}</div>;
}
