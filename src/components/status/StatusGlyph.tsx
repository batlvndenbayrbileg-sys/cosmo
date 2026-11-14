"use client";

import type { Status } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { StatusShape } from "./StatusShape";
import { statusClasses, statusWordKey } from "./statusClasses";

/**
 * Status as a shape: green circle, yellow triangle, red diamond, hollow dashed ring for no data.
 * The SVG is decorative; a screen-reader-only label carries the status word.
 */
export function StatusGlyph({
  status,
  size = 16,
  labelled = true,
  className,
}: {
  status: Status;
  /** pixel size of the square glyph */
  size?: number;
  /** false when the status word is already printed next to the glyph (see StatusPill) */
  labelled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const c = statusClasses(status);

  return (
    <span
      data-slot="status-glyph"
      data-status={status}
      className={cn("inline-flex shrink-0 items-center justify-center", c.text, className)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <StatusShape status={status} cx={8} cy={8} r={6} />
      </svg>
      {labelled ? <span className="sr-only">{t(statusWordKey(status))}</span> : null}
    </span>
  );
}
