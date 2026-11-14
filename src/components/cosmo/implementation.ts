/**
 * Which Cosmo implementation to render. Pure, unit-tested.
 * Order: Rive file present (and not failed) -> RiveCosmo; else the PNG render (ImageCosmo, default);
 * else the SVG placeholder (mascotMode 'placeholder', or the PNG could not be loaded).
 */
import type { MascotMode } from "./CosmoConfig";

export type CosmoImplementation = "rive" | "image" | "placeholder";

export function resolveImplementation(input: {
  rive: boolean;
  riveFailed: boolean;
  mascotMode: MascotMode;
  imageFailed: boolean;
}): CosmoImplementation {
  if (input.rive && !input.riveFailed) return "rive";
  if (input.mascotMode === "image" && !input.imageFailed) return "image";
  return "placeholder";
}
