"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { AlertRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusGlyph } from "@/components/status";
import { statusClasses, statusWordKey } from "@/components/status/statusClasses";
import { ApiRequestError, postJson } from "@/components/earth/api";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { formatClockLabel, type Viewer } from "./logic";

type AckState = "idle" | "sending" | "failed";

/**
 * Alerts strip: rendered only when alerts exist. Calm wording ("alert, not a diagnosis"); the crew viewer gets
 * an acknowledge button (POST /api/alerts/:id/ack), the ground viewer only sees the state.
 */
export function AlertsStrip({ alerts, viewer }: { alerts: AlertRow[]; viewer: Viewer }) {
  const { t, pick, lang } = useI18n();
  const [acked, setAcked] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, AckState>>({});

  if (alerts.length === 0) return null;

  async function acknowledge(id: string) {
    setPending((p) => ({ ...p, [id]: "sending" }));
    try {
      await postJson<unknown>(`/api/alerts/${encodeURIComponent(id)}/ack`);
      setAcked((a) => ({ ...a, [id]: new Date().toISOString() }));
      setPending((p) => ({ ...p, [id]: "idle" }));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPending((p) => ({ ...p, [id]: "failed" }));
      if (!(err instanceof ApiRequestError)) console.error(err);
    }
  }

  return (
    <Card
      data-slot="alerts-strip"
      aria-labelledby="alerts-strip-title"
      className="gap-3 bg-status-alert-soft/60 ring-status-alert/25"
    >
      <CardHeader>
        <CardTitle id="alerts-strip-title" className="text-lg">
          {t("dashboard.alerts.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-base text-foreground">
          {t(viewer === "crew" ? "dashboard.alerts.calm" : "dashboard.alerts.calmGround")}
        </p>
        <ul className="flex flex-col gap-2.5">
          {alerts.map((alert) => {
            const ackedAt = alert.acknowledgedAt ?? acked[alert.id] ?? null;
            const state = pending[alert.id] ?? "idle";
            return (
              <li
                key={alert.id}
                className="flex flex-col gap-2 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10"
              >
                <div className="flex items-start gap-2.5">
                  <StatusGlyph status={alert.level} size={20} className="mt-0.5" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-base text-foreground">{pick(alert.text)}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className={cn("font-medium", statusClasses(alert.level).ink)}>
                        {t(statusWordKey(alert.level))}
                      </span>
                      {" · "}
                      {formatClockLabel(alert.createdAt, lang)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {ackedAt ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Check aria-hidden="true" className="size-4" />
                      {t("dashboard.alerts.acknowledged")}
                    </span>
                  ) : viewer === "crew" ? (
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      disabled={state === "sending"}
                      onClick={() => void acknowledge(alert.id)}
                    >
                      {state === "sending"
                        ? t("dashboard.alerts.sending")
                        : t("dashboard.alerts.acknowledge")}
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("dashboard.alerts.open")}</span>
                  )}
                  {state === "failed" && !ackedAt ? (
                    <span role="status" className="text-sm text-status-alert-ink">
                      {t("dashboard.alerts.ackFailed")}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
