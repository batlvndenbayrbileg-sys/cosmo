"use client";

/**
 * RiveCosmo: the designer's cosmo.riv behind the same props as PlaceholderCosmo.
 * Loads RIVE_SRC and drives state machine "Cosmo" with inputs isTalking, isListening, isThinking
 * (bool), emotion (0 neutral, 1 happy, 2 concerned), mouthOpen (0..100) and variant (number).
 * Every input lookup is guarded: a missing or differently-typed input is skipped, never thrown.
 *
 * Do not import this file statically. CosmoAvatar loads it with next/dynamic (ssr: false) so the
 * Rive runtime is only downloaded when Rive is available.
 */
import { useRive } from "@rive-app/react-canvas";
import { useEffect, useRef } from "react";
import { describeCosmo } from "./face";
import {
  RIVE_SRC,
  RIVE_STATE_MACHINE,
  applyRiveValues,
  riveValues,
  type RiveInputLike,
} from "./rive-inputs";
import type { CosmoProps } from "./types";

export interface RiveCosmoProps extends CosmoProps {
  /** called once the file and state machine are loaded and playing */
  onLoaded?: () => void;
  /** called when the file cannot be loaded; the caller falls back to the placeholder */
  onLoadError?: () => void;
}

export default function RiveCosmo({
  variant,
  state,
  emotion,
  amplitude,
  size,
  className,
  label,
  onLoaded,
  onLoadError,
}: RiveCosmoProps) {
  const inputsRef = useRef<RiveInputLike[] | null>(null);
  const latest = useRef({ variant, state, emotion, amplitude });
  const callbacks = useRef({ onLoaded, onLoadError });

  useEffect(() => {
    latest.current = { variant, state, emotion, amplitude };
    callbacks.current = { onLoaded, onLoadError };
  });

  const push = () => {
    try {
      applyRiveValues(inputsRef.current, riveValues(latest.current));
    } catch {
      // never break the avatar
    }
  };

  const { RiveComponent, rive } = useRive({
    src: RIVE_SRC,
    stateMachines: RIVE_STATE_MACHINE,
    autoplay: true,
    onLoad: () => {
      callbacks.current.onLoaded?.();
    },
    onLoadError: () => {
      callbacks.current.onLoadError?.();
    },
  });

  // collect the inputs once the runtime instance exists
  useEffect(() => {
    if (!rive) {
      inputsRef.current = null;
      return;
    }
    try {
      inputsRef.current = rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? null;
    } catch {
      inputsRef.current = null;
    }
    push();
  }, [rive]);

  // push every prop change (amplitude changes at audio frame rate)
  useEffect(() => {
    push();
  }, [variant, state, emotion, amplitude]);

  return (
    <div
      role="img"
      aria-label={label ?? describeCosmo(state, emotion)}
      className={className}
      style={{
        width: size ?? "100%",
        height: size ?? "100%",
        pointerEvents: "none",
      }}
    >
      <RiveComponent aria-hidden="true" style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
