"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { DashboardPayload } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorNotice } from "@/components/earth/ErrorNotice";
import { useResource } from "@/components/earth/useResource";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { DashboardView } from "./DashboardView";
import { DashboardMotionProvider } from "./motion";

/** URL of the crew dashboard route; without a check-in id the server answers with the latest confirmed one */
export function dashboardUrl(checkInId: string | null): string {
  return checkInId ? `/api/dashboard?checkInId=${encodeURIComponent(checkInId)}` : "/api/dashboard";
}

/**
 * /dashboard (client): reads ?checkInId=, fetches GET /api/dashboard and renders the crew DashboardView
 * without the entrance animation (reloads and deep links).
 */
export function DashboardPageClient() {
  const { t } = useI18n();
  const params = useSearchParams();
  const checkInId = params.get("checkInId");
  const dashboard = useResource<DashboardPayload>(dashboardUrl(checkInId), "plain");

  if (dashboard.status === "loading") {
    return (
      <div role="status" aria-label={t("dashboard.page.loading")} className="flex flex-col gap-4">
        <Skeleton className="h-16 w-1/2 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (dashboard.status === "error") {
    const noSession = dashboard.error.code === "NO_SESSION";
    const missing = dashboard.error.code === "NOT_FOUND";
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorNotice
          title={
            noSession
              ? t("dashboard.page.noSession")
              : missing
                ? t("dashboard.page.empty")
                : t("dashboard.page.error")
          }
          detail={noSession || missing ? undefined : dashboard.error.message}
          onRetry={noSession || missing ? undefined : dashboard.reload}
        />
        {noSession || missing ? (
          <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            {t("dashboard.page.home")}
          </Link>
        ) : null}
      </div>
    );
  }

  if (dashboard.data === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-base text-muted-foreground">{t("dashboard.page.empty")}</p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          {t("dashboard.page.home")}
        </Link>
      </div>
    );
  }

  return (
    <DashboardMotionProvider animate={false}>
      <DashboardView payload={dashboard.data} viewer="crew" />
    </DashboardMotionProvider>
  );
}
