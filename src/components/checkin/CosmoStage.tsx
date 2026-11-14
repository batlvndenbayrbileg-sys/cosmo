"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import type { CosmoEmotion, CosmoState } from "@/components/cosmo/types";
import { COSMO_LAYOUT_ID } from "@/lib/motion";

const COSMO_TRANSITION = { type: "spring", stiffness: 130, damping: 20, mass: 0.9 } as const;

export interface SharedCosmoProps {
  variant: number;
  state: CosmoState;
  emotion: CosmoEmotion;
  /** 0..1, drives the mouth */
  amplitude: number;
  label: string;
}

/**
 * The ONE Cosmo element of the check-in screen: a motion.div with the shared layoutId wrapping the
 * avatar. The conversation view puts it in the full-screen stage; after the summary the very same
 * element is handed to the dashboard as `dockSlot`, so framer-motion glides it from the stage into
 * the docked corner inside one React tree.
 */
export function SharedCosmo({ variant, state, emotion, amplitude, label }: SharedCosmoProps) {
  return (
    <motion.div
      layoutId={COSMO_LAYOUT_ID}
      transition={COSMO_TRANSITION}
      className="size-full"
      data-slot="shared-cosmo"
    >
      <CosmoAvatar variant={variant} state={state} emotion={emotion} amplitude={amplitude} label={label} />
    </motion.div>
  );
}

/** Square, centred slot that takes the height of its parent (60-70% of the conversation column). */
export function CosmoStage({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <div data-slot="cosmo-stage" className="flex min-h-0 w-full flex-1 flex-col items-center gap-2">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="aspect-square h-full max-w-full">{children}</div>
      </div>
      {caption}
    </div>
  );
}
