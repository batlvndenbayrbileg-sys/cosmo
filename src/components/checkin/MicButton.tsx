"use client";

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { LoaderCircle, Mic, MicOff, Square, Volume2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export type MicState = "idle" | "listening" | "thinking" | "speaking" | "unavailable";

/** Press longer than this and it is push-to-talk (hold); shorter is a click (toggle). */
export const HOLD_MS = 380;

export interface MicLevel {
  get: () => number;
  subscribe: (listener: () => void) => () => void;
}

export interface MicButtonProps {
  state: MicState;
  /** the current recording is push-to-talk (no auto stop) */
  pushToTalk?: boolean;
  level: MicLevel;
  /** click / Enter: start, or stop and send, or interrupt Cosmo */
  onToggle: () => void;
  /** hold the button (or hold Space while it is focused) */
  onHoldStart: () => void;
  onHoldEnd: () => void;
  describedBy?: string;
}

const subscribeNever = () => () => {};
const zeroLevel = () => 0;

/**
 * Round mic button with four visible states: idle / listening / thinking / speaking.
 *  - click or Enter toggles; hold (pointer) or hold Space (keyboard, button focused) = push-to-talk.
 *  - the ring around it swells with the live mic level while listening.
 *  - thinking is a non-interactive spinner; unavailable (no mic / permission blocked) is disabled
 *    and the text box takes over.
 */
export function MicButton({
  state,
  pushToTalk = false,
  level,
  onToggle,
  onHoldStart,
  onHoldEnd,
  describedBy,
}: MicButtonProps) {
  const { t } = useI18n();
  const liveLevel = useSyncExternalStore(
    state === "listening" ? level.subscribe : subscribeNever,
    state === "listening" ? level.get : zeroLevel,
    zeroLevel,
  );

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDown = useRef(false);
  const holding = useRef(false);
  const keyHeld = useRef(false);

  const inactive = state === "thinking" || state === "unavailable";

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const clearTimer = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const endHold = () => {
    if (holding.current) {
      holding.current = false;
      onHoldEnd();
    }
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || inactive) return;
    pointerDown.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not supported for this pointer: the up/cancel handlers still work while inside the button
    }
    clearTimer();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holding.current = true;
      onHoldStart();
    }, HOLD_MS);
  };

  const handlePointerUp = () => {
    if (!pointerDown.current) return;
    pointerDown.current = false;
    clearTimer();
    if (holding.current) endHold();
    else if (!inactive) onToggle();
  };

  const handlePointerCancel = () => {
    pointerDown.current = false;
    clearTimer();
    endHold();
  };

  const isSpace = (e: KeyboardEvent<HTMLButtonElement>) => e.key === " " || e.code === "Space";

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isSpace(e)) return;
    e.preventDefault(); // stop the native "click on Space release": Space is push-to-talk here
    if (e.repeat || keyHeld.current || inactive) return;
    keyHeld.current = true;
    onHoldStart();
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isSpace(e)) return;
    e.preventDefault();
    if (keyHeld.current) {
      keyHeld.current = false;
      onHoldEnd();
    }
  };

  const handleBlur = () => {
    if (keyHeld.current) {
      keyHeld.current = false;
      onHoldEnd();
    }
  };

  const handleClick = (e: { detail: number }) => {
    // pointer clicks are handled on pointerup; detail 0 = keyboard (Enter) or assistive technology
    if (e.detail === 0 && !inactive) onToggle();
  };

  const label =
    state === "listening" && pushToTalk ? t("checkin.mic.pushToTalk") : t(`checkin.mic.${state}`);
  const Icon =
    state === "listening"
      ? Square
      : state === "thinking"
        ? LoaderCircle
        : state === "speaking"
          ? Volume2
          : state === "unavailable"
            ? MicOff
            : Mic;

  return (
    <div className="flex flex-col items-center gap-2" data-slot="mic">
      <div className="relative flex size-24 items-center justify-center">
        {state === "listening" ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-primary/20 transition-transform duration-100 ease-out"
            style={{ transform: `scale(${1 + liveLevel * 0.45})` }}
          />
        ) : null}
        {state === "idle" ? (
          <span
            aria-hidden="true"
            className="absolute inset-2 animate-ping rounded-full bg-primary/10 [animation-duration:2.6s]"
          />
        ) : null}
        <button
          type="button"
          disabled={state === "unavailable"}
          aria-disabled={inactive}
          aria-label={t(`checkin.mic.aria.${state}`)}
          aria-describedby={describedBy}
          data-state={state}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={handleBlur}
          onClick={handleClick}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "relative flex size-20 touch-none items-center justify-center rounded-full border-2 outline-none transition-colors select-none",
            "focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:ring-offset-2",
            state === "idle" && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
            state === "listening" && "border-primary bg-card text-primary",
            state === "thinking" && "border-border bg-muted text-muted-foreground",
            state === "speaking" && "border-primary/40 bg-secondary text-primary hover:bg-secondary/80",
            state === "unavailable" && "border-border bg-muted text-muted-foreground opacity-70",
          )}
        >
          <Icon
            className={cn(
              "size-9",
              state === "thinking" && "animate-spin",
              state === "listening" && "size-8 fill-current",
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      <span className="min-h-6 text-center text-base font-medium text-foreground" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
