/**
 * Cosmo mascot contract (docs/BRIEF.md section 6, docs/PLAN.md section 6).
 * Identical for the placeholder SVG character and for the Rive implementation.
 */

export const COSMO_STATES = ["idle", "listening", "thinking", "talking"] as const;
export type CosmoState = (typeof COSMO_STATES)[number];

export const COSMO_EMOTIONS = ["neutral", "happy", "concerned"] as const;
export type CosmoEmotion = (typeof COSMO_EMOTIONS)[number];

export interface CosmoProps {
  /** per crew member; any integer is safe (see variants.ts), 0-3 are distinct */
  variant: number;
  state: CosmoState;
  emotion: CosmoEmotion;
  /** 0..1, drives the mouth. Values outside the range (or NaN) are clamped. */
  amplitude: number;
  /** edge length in px; when omitted the avatar fills its container */
  size?: number;
  className?: string;
  /**
   * Additive, optional: accessible name override (the app is bilingual, this
   * component has no language of its own). Defaults to an English description.
   */
  label?: string;
}
