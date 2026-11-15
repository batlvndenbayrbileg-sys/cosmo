import { CoolWaterArt, CoverBurnArt, NoIceArt, RemoveRingsArt } from "./burns";

export const BurnsArts = {
  "cool-water": CoolWaterArt,
  "remove-rings": RemoveRingsArt,
  "cover-burn": CoverBurnArt,
  "no-ice": NoIceArt,
} as const;
