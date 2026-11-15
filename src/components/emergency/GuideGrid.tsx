"use client";

import { Activity, Brain, Droplet, Flame, HeartPulse, PersonStanding, Siren, Syringe, Wind, Zap, type LucideIcon } from "lucide-react";
import type { EmergencyScenario, GuideIcon } from "@/lib/emergency";
import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { StepArt } from "./art";

const ICONS: Record<GuideIcon, LucideIcon> = {
  siren: Siren,
  person: PersonStanding,
  heart: HeartPulse,
  wind: Wind,
  drop: Droplet,
  flame: Flame,
  zap: Zap,
  pulse: Activity,
  injector: Syringe,
  brain: Brain,
};

export function GuideIconChip({ icon, urgent = false, className }: { icon?: GuideIcon; urgent?: boolean; className?: string }) {
  const Icon = ICONS[icon ?? "siren"];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white",
        urgent ? "bg-[#C53030]" : "bg-[var(--cosmo-ink)]",
        className,
      )}
    >
      <Icon className="size-5" strokeWidth={1.8} />
    </span>
  );
}

/** id of a grid card, so focus can return to it when the step view closes */
export function guideCardId(scope: string, id: string): string {
  return `${scope}-guide-card-${id}`;
}

/**
 * The scenario grid: one large card per situation (icon, title, a short line, a small illustration of the guide's
 * key step, the number of steps). Suggested guides come first and are marked; "get help now" is always last.
 */
export function GuideGrid({
  scenarios,
  lang,
  onOpen,
  suggested = [],
  scope,
  dense = false,
}: {
  scenarios: readonly EmergencyScenario[];
  lang: Lang;
  onOpen: (id: string) => void;
  suggested?: readonly string[];
  /** prefix for element ids (two grids can be on the page: the dashboard tab and the SOS overlay) */
  scope: string;
  /** the dashboard tab on desktop: cards share the panel height */
  dense?: boolean;
}) {
  const { t } = useI18n();
  const ordered = [...scenarios].sort((a, b) => rank(a, suggested) - rank(b, suggested));
  return (
    <ul
      aria-label={t("emergency.grid.label")}
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5",
        dense && "lg:h-full lg:min-h-0 lg:auto-rows-[minmax(0,1fr)] lg:gap-[clamp(8px,1.2vh,14px)]",
      )}
    >
      {ordered.map((s) => {
        const isSuggested = suggested.includes(s.id);
        const keyArt = s.steps.find((st, i) => i > 0 && st.art)?.art ?? s.steps[0]?.art;
        const help = s.id === "call-for-help";
        return (
          <li key={s.id} className="min-h-0 min-w-0">
            <button
              id={guideCardId(scope, s.id)}
              type="button"
              onClick={() => onOpen(s.id)}
              className={cn(
                "group flex h-full min-h-[132px] w-full flex-col gap-1.5 rounded-[22px] border bg-white/85 p-3 text-left shadow-[0_8px_24px_-14px_rgba(40,80,160,0.35)] outline-none transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-14px_rgba(40,80,160,0.45)] focus-visible:ring-3 focus-visible:ring-ring/60",
                help ? "border-[#C53030]/30 bg-[#FFF5F5]" : "border-[var(--cosmo-hairline)]",
                isSuggested && "ring-2 ring-[#B7791F]/60",
                dense && "lg:min-h-0",
              )}
            >
              <span className="flex items-start gap-2">
                <GuideIconChip icon={s.icon} urgent={help || s.id === "not-breathing"} className="size-9" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[16px] leading-tight font-medium text-[var(--cosmo-ink)]">{s.title[lang]}</span>
                  {s.summary ? (
                    <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--cosmo-label)]">{s.summary[lang]}</span>
                  ) : null}
                </span>
              </span>
              {keyArt ? (
                <span aria-hidden="true" className="mx-auto block min-h-0 w-full max-w-[150px] flex-1 opacity-90 max-lg:h-16">
                  <StepArt art={keyArt} />
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <span className="flex items-center justify-between gap-2 text-[11px] text-[var(--cosmo-label)]">
                <span className="tnum">{t("emergency.grid.steps", { n: s.steps.length })}</span>
                {isSuggested ? (
                  <span className="rounded-full bg-[#FEFCBF] px-2 py-0.5 font-medium text-[#744210]">{t("emergency.grid.suggested")}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function rank(s: EmergencyScenario, suggested: readonly string[]): number {
  if (s.id === "call-for-help") return 1000;
  const i = suggested.indexOf(s.id);
  return i >= 0 ? i - 100 : 0;
}
