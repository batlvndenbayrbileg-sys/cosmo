"use client";

import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/**
 * Plays the scripted crew side of the check-in through the real turn endpoint.
 * Always present as a small secondary control; `emphasised` (scripted mode) makes it the primary one.
 */
export function RunDemoButton({
  running,
  emphasised,
  disabled,
  onRun,
  onStop,
}: {
  running: boolean;
  emphasised: boolean;
  disabled?: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();

  if (running) {
    return (
      <Button type="button" variant="outline" onClick={onStop} className="h-9 gap-2 rounded-xl px-3 text-sm">
        <Square aria-hidden="true" className="size-3.5 fill-current" />
        {t("checkin.demo.stop")}
        <span className="sr-only">{t("checkin.demo.running")}</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={emphasised ? "default" : "ghost"}
      disabled={disabled}
      onClick={onRun}
      className={cn(
        "gap-2 rounded-xl",
        emphasised ? "h-11 px-5 text-base" : "h-9 px-3 text-sm text-muted-foreground",
      )}
    >
      <Play aria-hidden="true" className={cn("fill-current", emphasised ? "size-4" : "size-3.5")} />
      {t("checkin.demo.run")}
    </Button>
  );
}
