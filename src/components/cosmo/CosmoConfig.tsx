"use client";

/**
 * Tells every CosmoAvatar below it whether the designer's Rive file is available.
 * The root layout decides on the server (for example `fs.existsSync("public/cosmo.riv")`) and
 * wraps the app: <CosmoConfigProvider rive={hasRive}>...</CosmoConfigProvider>.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface CosmoConfig {
  rive: boolean;
}

const CosmoConfigContext = createContext<CosmoConfig>({ rive: false });

export function CosmoConfigProvider({ rive, children }: { rive: boolean; children: ReactNode }) {
  const value = useMemo<CosmoConfig>(() => ({ rive }), [rive]);
  return <CosmoConfigContext.Provider value={value}>{children}</CosmoConfigContext.Provider>;
}

/** Without a provider this returns { rive: false }, so the placeholder is used. */
export function useCosmoConfig(): CosmoConfig {
  return useContext(CosmoConfigContext);
}
