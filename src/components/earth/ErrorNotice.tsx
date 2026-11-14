"use client";

import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";

/** Calm error box with a retry button. */
export function ErrorNotice({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Alert variant="destructive" className="max-w-xl">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle className="text-base">{title}</AlertTitle>
      {detail ? <AlertDescription>{detail}</AlertDescription> : null}
      {onRetry ? (
        <div className="mt-2">
          <Button type="button" size="lg" variant="outline" onClick={onRetry}>
            {t("shell.action.retry")}
          </Button>
        </div>
      ) : null}
    </Alert>
  );
}
