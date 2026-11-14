"use client";

import type { Status } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "./StatusGlyph";
import { statusClasses, statusWordKey } from "./statusClasses";

const SIZES = {
  sm: { box: "gap-1 px-2 py-0.5 text-xs", glyph: 12 },
  md: { box: "gap-1.5 px-2.5 py-0.5 text-sm", glyph: 14 },
  lg: { box: "gap-2 px-3.5 py-1 text-base", glyph: 18 },
} as const;

/**
 * Glyph plus text. The word (Normal / Watch / Alert / No data) is always visible,
 * so the status never depends on colour alone. `label` overrides the word.
 */
export function StatusPill({
  status,
  label,
  size = "md",
  className,
}: {
  status: Status;
  label?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { t } = useI18n();
  const s = SIZES[size];

  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full border font-medium whitespace-nowrap",
        s.box,
        statusClasses(status).pill,
        className,
      )}
    >
      <StatusGlyph status={status} size={s.glyph} labelled={false} />
      <span>{label ?? t(statusWordKey(status))}</span>
    </span>
  );
}
