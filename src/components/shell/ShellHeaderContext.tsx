"use client";

/** Header details a page used to publish to the old global header (design v1). */
export interface ShellHeaderInfo {
  title?: string;
  crewName?: string;
  missionDay?: number;
}

/**
 * Design v2 has no global header: every screen draws its own glass top bar (TopBar), and the
 * check-in screen has no chrome at all. This hook is kept so existing callers keep compiling; it is
 * a harmless no-op.
 */
export function useShellHeader(info: ShellHeaderInfo): void {
  void info; // intentionally empty
}
