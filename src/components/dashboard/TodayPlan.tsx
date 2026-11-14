"use client";

import type { HazardStat, Task } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";
import { NASA_HAZARDS } from "@/lib/nasa/hazards";
import { cn } from "@/lib/utils";
import { isTaskRelated } from "./logic";

/**
 * Today's plan: 3-4 lifestyle task cards, each "Do this" + "Because..." + a hazard tag.
 * Tasks related to the selected hazard are highlighted. Never a diagnosis, drug or treatment.
 */
export function TodayPlan({
  tasks,
  selectedHazard,
}: {
  tasks: Task[];
  selectedHazard: HazardStat | null;
}) {
  const { t, pick } = useI18n();

  return (
    <section aria-labelledby="today-plan-title" data-slot="today-plan" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="today-plan-title" className="text-xl font-semibold text-foreground">
          {t("dashboard.plan.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("dashboard.plan.note")}</p>
      </div>
      <ol
        className={cn(
          "grid grid-cols-1 gap-4 md:grid-cols-2",
          tasks.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3",
        )}
      >
        {tasks.map((task, i) => {
          const related = isTaskRelated(task, selectedHazard);
          return (
            <li key={task.id} data-task={task.id} data-related={related ? "true" : undefined}>
              <Card className={cn("h-full gap-3", related && "ring-2 ring-primary")}>
                <CardHeader>
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                      {t("dashboard.plan.doThis")}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex h-full flex-col gap-3">
                  <p className="text-lg leading-snug font-semibold text-foreground">{pick(task.title)}</p>
                  <p className="text-base text-muted-foreground">
                    <span className="font-medium text-foreground">{t("dashboard.plan.because")}: </span>
                    {pick(task.why)}
                  </p>
                  <div className="mt-auto pt-1">
                    <Badge variant="outline" className="h-6 px-2.5 text-xs">
                      {task.hazard ? pick(NASA_HAZARDS[task.hazard].name) : t("dashboard.plan.general")}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
