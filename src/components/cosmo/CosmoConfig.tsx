"use client";

/**
 * Tells every CosmoAvatar below it which implementation to use:
 *  - `rive`: the designer's Rive file is available. The root layout decides on the server (for
 *    example `fs.existsSync("public/cosmo.riv")`) and wraps the app:
 *    <CosmoConfigProvider rive={hasRive}>...</CosmoConfigProvider>.
 *  - `mascotMode`: 'image' (default) = the team's PNG render with a drawn face (ImageCosmo);
 *    'placeholder' = the original SVG character. Used when Rive is not available (or failed).
 *  - `faceOverlay`: draw the animated face / glow overlays on the render (default true);
 *    false = the render as it is.
 * Every CosmoAvatar prop of the same name overrides the provider.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type MascotMode = "image" | "placeholder";

export interface CosmoConfig {
  rive: boolean;
  mascotMode: MascotMode;
  faceOverlay: boolean;
}

const DEFAULT_CONFIG: CosmoConfig = { rive: false, mascotMode: "image", faceOverlay: true };

const CosmoConfigContext = createContext<CosmoConfig>(DEFAULT_CONFIG);

export function CosmoConfigProvider({
  rive,
  mascotMode = "image",
  faceOverlay = true,
  children,
}: {
  rive: boolean;
  mascotMode?: MascotMode;
  faceOverlay?: boolean;
  children: ReactNode;
}) {
  const value = useMemo<CosmoConfig>(() => ({ rive, mascotMode, faceOverlay }), [rive, mascotMode, faceOverlay]);
  return <CosmoConfigContext.Provider value={value}>{children}</CosmoConfigContext.Provider>;
}

/** Without a provider this returns { rive: false, mascotMode: 'image', faceOverlay: true }. */
export function useCosmoConfig(): CosmoConfig {
  return useContext(CosmoConfigContext);
}
