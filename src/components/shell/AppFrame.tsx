"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { AppHeader } from "./AppHeader";
import { PrototypeRibbon } from "./PrototypeRibbon";
import { ShellHeaderContext, type ShellHeaderInfo } from "./ShellHeaderContext";

/**
 * Page chrome: header, main (max 1440px, 16px gutter on phones) and the prototype ribbon.
 * Pages may publish crew name / mission day with `useShellHeader`.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [header, setHeader] = useState<ShellHeaderInfo>({});

  return (
    <ShellHeaderContext.Provider value={setHeader}>
      <div className="flex min-h-screen flex-1 flex-col">
        <a
          href="#main-content"
          className="sr-only rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        >
          {t("shell.skipToContent")}
        </a>
        <AppHeader {...header} />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </main>
        <PrototypeRibbon />
      </div>
    </ShellHeaderContext.Provider>
  );
}
