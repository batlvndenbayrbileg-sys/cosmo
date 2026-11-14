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
 * Today's plan as pastel task cards, two visible side by side; a third and fourth scroll in horizontally.
 * Lifestyle suggestions only: never a diagnosis, drug or treatment.
 */
export function PlanCards({ tasks, selectedHazard }: { tasks: Task[]; selectedHazard: HazardStat | null }) {
  const { t, pick } = useI18n();

  return (
    <div className="flex flex-col gap-2">
      <ol
        tabIndex={0}
        aria-label={t("dashboard.plan.scroll")}
        className="aegis-noscrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pt-1 pb-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
                "flex w-[calc(50%-6px)] min-w-[9.5rem] shrink-0 snap-start flex-col gap-2 rounded-[22px] p-4 transition-transform duration-300 hover:-translate-y-0.5",
                related && "ring-2 ring-[var(--aegis-accent)]",
              )}
            >
              <span
                aria-hidden="true"
                className="inline-flex size-9 items-center justify-center rounded-full bg-white text-[var(--aegis-ink)] shadow-[0_4px_10px_-6px_rgba(15,27,45,0.35)]"
              >
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <p className="line-clamp-3 text-[15px] leading-snug font-semibold text-[var(--aegis-ink)]">
                {pick(task.title)}
              </p>
              <p className="line-clamp-2 text-[12px] leading-snug text-[#3f4a5c]" title={pick(task.why)}>
                <span className="font-medium">{t("dashboard.plan.because")}: </span>
                {pick(task.why)}
              </p>
              <span className="mt-auto inline-flex w-fit max-w-full truncate rounded-full bg-white/75 px-2 py-0.5 text-[11px] font-medium text-[var(--aegis-ink)]">
                {task.hazard ? pick(NASA_HAZARDS[task.hazard].name) : t("dashboard.plan.general")}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] leading-snug text-[var(--aegis-label)]">{t("dashboard.plan.note")}</p>
    </div>
  );
}
