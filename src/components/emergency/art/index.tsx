import type { ComponentType } from "react";
import type { StepArt as StepArtKey } from "@/lib/emergency";
import { BurnsArts } from "./burns-map";
import { AbdominalThrustsArt, BackBlowsArt, CoughArt } from "./choking";
import { AedArt, CheckBreathingArt, CompressionsArt, HandsChestArt } from "./cpr";
import { CallArt, ReassureArt, StayArt, TimerArt, WatchArt } from "./help";
import {
  CushionHeadArt,
  LegsRaisedArt,
  LyingArt,
  RecoveryArt,
  SitSupportedArt,
  SitUpArt,
  StayStillArt,
} from "./positions";
import { ClearSpaceArt, HandsOffArt } from "./seizure";
import { AutoInjectorArt, BandageArt, ColdPackArt, PressSidesArt, PressWoundArt } from "./wounds";

/** every step illustration, by the key used in the guide data (tests check that all keys are drawn) */
export const STEP_ART: Record<StepArtKey, ComponentType<{ beatMs?: number }>> = {
  call: CallArt,
  "stay-with": StayArt,
  reassure: ReassureArt,
  watch: WatchArt,
  timer: TimerArt,
  lying: LyingArt,
  "legs-raised": LegsRaisedArt,
  "sit-up": SitUpArt,
  recovery: RecoveryArt,
  "sit-supported": SitSupportedArt,
  "stay-still": StayStillArt,
  "cushion-head": CushionHeadArt,
  "check-breathing": CheckBreathingArt,
  "hands-chest": HandsChestArt,
  compressions: CompressionsArt,
  aed: AedArt,
  cough: CoughArt,
  "back-blows": BackBlowsArt,
  "abdominal-thrusts": AbdominalThrustsArt,
  "press-wound": PressWoundArt,
  "press-sides": PressSidesArt,
  bandage: BandageArt,
  "cold-pack": ColdPackArt,
  "auto-injector": AutoInjectorArt,
  "clear-space": ClearSpaceArt,
  "hands-off": HandsOffArt,
  ...BurnsArts,
};

/** the illustration of one step; `beatMs` makes the compression art push in time with the metronome */
export function StepArt({ art, beatMs }: { art: StepArtKey; beatMs?: number }) {
  const Art = STEP_ART[art];
  return <Art beatMs={beatMs} />;
}
