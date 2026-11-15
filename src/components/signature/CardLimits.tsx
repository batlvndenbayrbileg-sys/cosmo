"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/I18nProvider";

/** the four cards, as the i18n keys name them */
export const SIGNATURE_LIMIT_CARDS = ["triage", "fp", "rec", "ev"] as const;
export type SignatureLimitCard = (typeof SIGNATURE_LIMIT_CARDS)[number];

/**
 * The tooltip of a card title (build prompt T10): the card title with a "Limitations" line under it, one sentence from
 * spec section 8. The same text is the trigger's accessible name, so it is reachable without hovering.
 */
export function CardLimits({ card }: { card: SignatureLimitCard }) {
  const { t } = useI18n();
  const title = t(`dashboard.signature.${card}.title`);
  const label = t("dashboard.signature.limits.label");
  const text = t(`dashboard.signature.limits.${card}`);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            role="note"
            data-slot="signature-limits"
            data-card={card}
            aria-label={`${title}. ${label}: ${text}`}
            className="inline-flex size-6 items-center justify-center rounded-full text-[var(--cosmo-label)] outline-none hover:text-[var(--cosmo-ink)] focus-visible:ring-3 focus-visible:ring-ring/60"
          />
        }
      >
        <Info aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </TooltipTrigger>
      <TooltipContent className="max-w-[20rem] flex-col items-start gap-1 text-left">
        <span className="font-medium">{title}</span>
        <span>
          {label}: {text}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
