"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Layout of the conversation view (docs/BRIEF.md section 7):
 *  - desktop: Cosmo (about 62% of the column height), live transcript under her, controls at the
 *    bottom; the captured cards in a rail on the right.
 *  - mobile: one column, the cards come below the controls.
 * Pure layout: everything is passed in as slots.
 */
export function ConversationView({
  label,
  banners,
  stage,
  transcript,
  clarification,
  controls,
  rail,
}: {
  label: string;
  banners?: ReactNode;
  stage: ReactNode;
  transcript: ReactNode;
  clarification?: ReactNode;
  controls: ReactNode;
  rail: ReactNode;
}) {
  return (
    <div
      data-slot="conversation-view"
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]"
    >
      <section
        aria-label={label}
        className="flex min-h-0 flex-col gap-3 lg:h-[calc(100dvh-12.5rem)] lg:min-h-[30rem]"
      >
        {banners ? <div className="flex flex-col gap-2">{banners}</div> : null}

        <div className={cn("flex h-[min(44dvh,24rem)] shrink-0 flex-col", "lg:h-auto lg:min-h-0 lg:basis-[62%]")}>
          {stage}
        </div>

        <div className="flex min-h-[7.5rem] flex-1 flex-col gap-2 lg:min-h-0">
          {transcript}
          {clarification}
        </div>

        <div className="shrink-0">{controls}</div>
      </section>

      <aside className="min-h-0 lg:h-[calc(100dvh-12.5rem)] lg:min-h-[30rem]">{rail}</aside>
    </div>
  );
}
