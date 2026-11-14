"use client";

import { LoaderCircle } from "lucide-react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { useI18n } from "@/i18n/I18nProvider";
import type { CrewPublic } from "@/lib/types";
import { cn } from "@/lib/utils";
import { roleKey } from "./roles";

/**
 * One crew member: name, role, language and their Cosmo avatar variant in idle.
 * Privacy: this card is built from CrewPublic only (roster fields). It never shows health data.
 */
export function CrewCard({
  crew,
  busy,
  disabled,
  onSelect,
}: {
  crew: CrewPublic;
  /** this card's session request is in flight */
  busy: boolean;
  /** another card was chosen, or a request is running */
  disabled: boolean;
  onSelect: (crew: CrewPublic) => void;
}) {
  const { t } = useI18n();
  const key = roleKey(crew.role);
  const role = key ? t(key) : crew.role;
  const language = t(`shell.lang.${crew.preferredLanguage}`);

  return (
    <button
      type="button"
      onClick={() => onSelect(crew)}
      disabled={disabled}
      aria-busy={busy}
      aria-label={t("crew.card.aria", { name: crew.name, role })}
      data-slot="crew-card"
      data-crew-id={crew.id}
      className={cn(
        "group flex w-full flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 text-center shadow-xs outline-none",
        "transition-[transform,box-shadow,border-color] duration-200",
        "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
        "focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-border disabled:hover:shadow-xs",
        busy && "border-primary opacity-100",
      )}
    >
      <div className="size-32 shrink-0 sm:size-36">
        <CosmoAvatar
          variant={crew.mascotVariant}
          state="idle"
          emotion="neutral"
          amplitude={0}
          label={crew.name}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-2xl font-semibold tracking-tight text-foreground">{crew.name}</span>
        <span className="text-base text-muted-foreground">{role}</span>
        <span className="text-sm text-muted-foreground">
          {t("crew.card.language", { language })}
        </span>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground",
          "transition-colors group-hover:bg-primary/90",
        )}
      >
        {busy ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            {t("crew.card.starting")}
          </>
        ) : (
          t("crew.card.start")
        )}
      </span>
    </button>
  );
}
