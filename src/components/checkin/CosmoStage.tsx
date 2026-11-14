"use client";

import { motion } from "framer-motion";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import type { GazeSource } from "@/components/cosmo/gaze";
import type { CosmoEmotion, CosmoState } from "@/components/cosmo/types";
import { COSMO_LAYOUT_ID } from "@/lib/motion";

const COSMO_TRANSITION = { type: "spring", stiffness: 130, damping: 21, mass: 0.9 } as const;

export interface SharedCosmoProps {
  variant: number;
  state: CosmoState;
  emotion: CosmoEmotion;
  /** 0..1, drives the mouth */
  amplitude: number;
  label: string;
  /** "Cosmo looks at you": read by the mascot's own animation loop (the lean happens inside the avatar, so this
   *  layoutId element's transform stays framer-motion's alone) */
  gaze?: GazeSource;
}

/**
 * The ONE Cosmo element of the check-in screen: a motion.div with the shared layoutId wrapping the
 * avatar. The conversation stage shows it full size; after the summary the very same element is
 * handed to the dashboard as `dockSlot`, so framer-motion shrinks it from the stage into the
 * dashboard's Cosmo card inside one React tree.
 */
export function SharedCosmo({ variant, state, emotion, amplitude, label, gaze }: SharedCosmoProps) {
  return (
    <motion.div
      layoutId={COSMO_LAYOUT_ID}
      transition={COSMO_TRANSITION}
      className="size-full"
      data-slot="shared-cosmo"
    >
      <CosmoAvatar variant={variant} state={state} emotion={emotion} amplitude={amplitude} label={label} gaze={gaze} />
    </motion.div>
  );
}
