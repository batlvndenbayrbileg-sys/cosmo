"use client";

import { useState } from "react";
import type { EarthLink } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DelaySelector } from "@/components/earth/DelaySelector";
import { delayIdFor, delayLabelKey, delayMsFor, type DelayId } from "@/components/earth/delay";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { addMs, formatClockLabel, type Viewer } from "./logic";

const STATE_DOT: Record<EarthLink["state"], string> = {
  online: "bg-status-ok",
  delayed: "bg-status-watch",
  offline: "bg-status-nodata",
};

/**
 * Earth link card: state, last sent time and the simulated delay. The crew viewer gets a Live / 3 min / 20 min
 * selector that only changes what is displayed here; the ground viewer sees the delay the console was opened
 * with (read-only). Always labelled "simulated".
 */
export function EarthLinkCard({ link, viewer }: { link: EarthLink; viewer: Viewer }) {
  const { t, lang } = useI18n();
  const [chosen, setChosen] = useState<DelayId>(() => delayIdFor(link.delayMs));
  const delayId = viewer === "crew" ? chosen : delayIdFor(link.delayMs);
  const delayMs = viewer === "crew" ? delayMsFor(chosen) : link.delayMs;
  const arrival = addMs(link.lastSentAt, delayMs);

  return (
    <Card data-slot="earth-link-card" aria-labelledby="earth-link-title" className="gap-3">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle id="earth-link-title" className="text-lg">
            {t("dashboard.link.title")}
          </CardTitle>
          <span className="inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground">
            {t("shell.simulated")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-base text-foreground">
          <span aria-hidden="true" className={cn("size-2.5 rounded-full", STATE_DOT[link.state])} />
          <span className="font-medium">{t(`dashboard.link.state.${link.state}`)}</span>
        </p>
        <p className="tnum text-base text-foreground">
          {link.lastSentAt
            ? t("dashboard.link.lastSent", { time: formatClockLabel(link.lastSentAt, lang) })
            : t("dashboard.link.neverSent")}
        </p>
        <p className="text-base text-foreground">
          {t("dashboard.link.delay", { delay: t(delayLabelKey(delayId)) })}
        </p>
        {arrival && delayMs > 0 ? (
          <p className="tnum text-sm text-muted-foreground">
            {t("dashboard.link.arrives", { time: formatClockLabel(arrival, lang) })}
          </p>
        ) : null}
        {viewer === "crew" ? (
          <>
            <DelaySelector
              value={chosen}
              onChange={setChosen}
              label={t("dashboard.link.delayLabel")}
            />
            <p className="text-xs text-muted-foreground">{t("dashboard.link.note")}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
