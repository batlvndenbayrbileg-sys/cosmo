"use client";

import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";

/** Header details a page can publish to the app frame (primitives only, so effects stay stable). */
export interface ShellHeaderInfo {
  title?: string;
  crewName?: string;
  missionDay?: number;
}

export const ShellHeaderContext = createContext<Dispatch<SetStateAction<ShellHeaderInfo>> | null>(
  null,
);

/**
 * Call from a client page to show the crew name / mission day in the shared header.
 * The values are cleared again when the page unmounts.
 */
export function useShellHeader({ title, crewName, missionDay }: ShellHeaderInfo): void {
  const setInfo = useContext(ShellHeaderContext);

  useEffect(() => {
    if (!setInfo) return;
    setInfo({ title, crewName, missionDay });
    return () => setInfo({});
  }, [setInfo, title, crewName, missionDay]);
}
