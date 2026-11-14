"use client";

import { Sparkles } from "lucide-react";
import type { HazardStat, Task } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { NASA_HAZARDS } from "@/lib/nasa/hazards";
import { cn } from "@/lib/utils";
import { isTaskRelated } from "./logic";
import { AXIS_ICON } from "./parts";

const PASTELS = ["pastel-yellow", "pastel-blue", "pastel-mint", "pastel-lilac"] as const;

/**
 * Today's plan as pastel task cards. `strip` (overview): two visible side by side, a third and fourth scroll in
 * horizontally. `grid` (Plan view): every task in a two-column grid that fills the height it is given.
 * Lifestyle suggestions only: never a diagnosis, drug or treatment.
 */
export function PlanCards({
  tasks,
  selectedHazard,
  layout = "strip",
}: {
  tasks: Task[];
  selectedHazard: HazardStat | null;
  layout?: "strip" | "grid";
}) {
  const { t, pick } = useI18n();
  const grid = layout === "grid";

  return (
    <div className={cn("flex flex-col gap-2", grid && "lg:min-h-0 lg:flex-1")}>
      <ol
        tabIndex={grid ? undefined : 0}
        aria-label={grid ? t("dashboard.plan.title") : t("dashboard.plan.scroll")}
        className={cn(
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          grid
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:auto-rows-fr lg:gap-[clamp(8px,1.4vh,14px)]"
            : "aegis-noscrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pt-1 pb-2 lg:gap-2.5 lg:pb-1",
        )}
      >
        {tasks.map((task, i) => {
          const firstKey = task.relatedKeys[0];
          const axis = firstKey ? KPI_DEFS[firstKey].axis : null;
          const Icon = axis ? AXIS_ICON[axis] : Sparkles;
          const related = isTaskRelated(task, selectedHazard);
          return (
            <li
              key={task.id}
              data-task={task.id}
              data-related={related ? "true" : undefined}
              className={cn(
                PASTELS[i % PASTELS.length],
                "flex flex-col gap-2 rounded-[22px] p-4 transition-transform duration-300 hover:-translate-y-0.5",
                grid
                  ? "min-w-0 lg:min-h-0 lg:overflow-clip lg:p-[clamp(12px,1.8vh,18px)]"
                  : "w-[calc(50%-6px)] min-w-[9.5rem] shrink-0 snap-start lg:gap-[clamp(4px,0.8vh,8px)] lg:p-[clamp(10px,1.4vh,16px)]",
                related && "ring-2 ring-[var(--aegis-accent)]",
              )}
            >
              <div className={cn("flex flex-col gap-2", !grid && "lg:flex-row lg:items-center lg:gap-2")}>
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[var(--aegis-ink)] shadow-[0_4px_10px_-6px_rgba(15,27,45,0.35)]",
                  !grid && "lg:size-[clamp(26px,3.4vh,32px)]",
                )}
              >
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <p
                className={cn(
                  "leading-snug font-semibold text-[var(--aegis-ink)]",
                  grid ? "text-[16px] lg:text-[clamp(14px,1.9vh,17px)]" : "line-clamp-3 text-[15px] lg:line-clamp-2 lg:text-[clamp(13px,1.7vh,15px)]",
                )}
              >
                {pick(task.title)}
              </p>
              </div>
              <p
                className={cn(
                  "text-[12px] leading-snug text-[#3f4a5c]",
                  grid ? "lg:line-clamp-4 lg:text-[clamp(12px,1.6vh,14px)]" : "line-clamp-2 dash-short:line-clamp-1",
                )}
                title={pick(task.why)}
              >
                <span className="font-medium">{t("dashboard.plan.because")}: </span>
                {pick(task.why)}
              </p>
              <span className="mt-auto inline-flex w-fit max-w-full shrink-0 truncate rounded-full bg-white/75 px-2 py-0.5 text-[11px] font-medium text-[var(--aegis-ink)]">
                {task.hazard ? pick(NASA_HAZARDS[task.hazard].name) : t("dashboard.plan.general")}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={cn("text-[11px] leading-snug text-[var(--aegis-label)]", !grid && "lg:line-clamp-1 lg:text-[10.5px]")}>
        {t("dashboard.plan.note")}
      </p>
    </div>
  );
}
