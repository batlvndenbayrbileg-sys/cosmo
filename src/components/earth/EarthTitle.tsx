"use client";

import { Satellite } from "lucide-react";
import { TopBarTrack } from "@/components/shell/TopBar";
import { useI18n } from "@/i18n/I18nProvider";

/** TopBar centre piece: "Earth console · simulated link" in a light track with a black icon chip. */
export function EarthTitle() {
  const { t } = useI18n();
  return (
    <TopBarTrack className="pr-4">
      <span className="icon-chip !size-8">
        <Satellite className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-tight">
        <span className="text-[15px] font-medium text-[color:var(--cosmo-ink)]">{t("earth.topbar.title")}</span>
        <span className="text-[13px] text-[color:var(--cosmo-label)]">· {t("earth.topbar.sub")}</span>
      </span>
    </TopBarTrack>
  );
}
