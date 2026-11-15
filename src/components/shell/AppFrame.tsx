"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { PrototypeRibbon } from "./PrototypeRibbon";

/**
 * Design v2 page chrome: a full-bleed container on the .cosmo-bg gradient, with NO global header.
 * Each screen draws its own chrome (crew select and Earth console use <PageFrame> + <TopBar>; the
 * check-in is edge to edge with nothing but the ribbon). `main` has no padding and no max width,
 * so a page can take the whole viewport (h-dvh / fixed inset-0). The prototype ribbon is a small
 * frosted pill fixed at the very bottom.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div data-slot="app-frame" className="cosmo-bg flex min-h-dvh w-full flex-1 flex-col">
      <a
        href="#main-content"
        className="sr-only rounded-full bg-[color:var(--cosmo-ink)] px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {t("shell.skipToContent")}
      </a>
      <main id="main-content" className="relative flex w-full min-w-0 flex-1 flex-col">
        {children}
      </main>
      <PrototypeRibbon />
    </div>
  );
}
