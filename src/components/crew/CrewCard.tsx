"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Languages, LoaderCircle } from "lucide-react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { useI18n } from "@/i18n/I18nProvider";
import type { CrewPublic } from "@/lib/types";
import { cn } from "@/lib/utils";
import { variantTint } from "./MascotPortrait";
import { roleKey } from "./roles";

/**
 * One crew member on the start screen: a large glass card with their Cosmo render (front pose,
 * variant hue) on a pastel stage, name, role and language, and a black "Start check-in" pill.
 * The card lifts on hover / focus and Cosmo smiles. Privacy: built from CrewPublic only (roster
 * fields), it never shows health data.
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
  const [engaged, setEngaged] = useState(false);
  const key = roleKey(crew.role);
  const role = key ? t(key) : crew.role;
  const language = t(`shell.lang.${crew.preferredLanguage}`);
  const tint = variantTint(crew.mascotVariant);
  const lively = (engaged && !disabled) || busy;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(crew)}
      disabled={disabled}
      aria-busy={busy}
      aria-label={t("crew.card.aria", { name: crew.name, role })}
      data-slot="crew-card"
      data-crew-id={crew.id}
      onHoverStart={() => setEngaged(true)}
      onHoverEnd={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      whileHover={disabled ? undefined : { y: -6 }}
      whileFocus={disabled ? undefined : { y: -6 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 170, damping: 22 }}
      className={cn(
        "glass-card group flex w-full flex-col gap-4 p-3 pb-4 text-left outline-none sm:p-3.5 sm:pb-5",
        "transition-shadow duration-300",
        "hover:shadow-[0_26px_50px_-24px_rgba(40,80,160,0.45)]",
        "focus-visible:ring-4 focus-visible:ring-[color:var(--cosmo-accent)]/45",
        "disabled:cursor-not-allowed",
        disabled && !busy && "opacity-55",
        busy && "ring-2 ring-[color:var(--cosmo-accent)]",
      )}
    >
      {/* pastel stage with the render */}
      <div
        className={cn("relative aspect-[16/11] w-full overflow-hidden rounded-[18px] min-[480px]:aspect-[5/4] lg:aspect-[4/4.3]", tint.fill)}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: `radial-gradient(55% 50% at 50% 48%, ${tint.glow}, transparent 72%)` }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55)_0%,transparent_45%)]"
        />
        {/* floor ring under the feet */}
        <span
          aria-hidden="true"
          className="absolute bottom-[7%] left-1/2 h-[9%] w-[58%] -translate-x-1/2 rounded-[50%] border border-[rgba(79,134,247,0.35)] bg-white/35"
        />
        <div className="absolute inset-x-[8%] top-[5%] bottom-[5%]">
          <CosmoAvatar
            variant={crew.mascotVariant}
            state={busy ? "thinking" : "idle"}
            emotion={lively ? "happy" : "neutral"}
            amplitude={0}
            pose="front"
            label={crew.name}
          />
        </div>
        <span
          className="pill absolute top-3 left-3 !min-h-8 gap-1.5 !px-3 text-[13px]"
          title={t("crew.card.language", { language })}
        >
          <Languages className="size-3.5 text-[color:var(--cosmo-label)]" aria-hidden="true" />
          <span lang={crew.preferredLanguage}>{language}</span>
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 px-1.5">
        <span className="truncate text-[26px] leading-tight font-medium tracking-tight text-[color:var(--cosmo-ink)]">
          {crew.name}
        </span>
        <span className="truncate text-[15px] text-[color:var(--cosmo-label)]">{role}</span>
      </div>

      <span
        aria-hidden="true"
        className={cn(
          "mx-1 inline-flex h-12 items-center justify-between gap-2 rounded-full bg-[color:var(--cosmo-ink)] pr-1.5 pl-5 text-[15px] font-medium text-white",
          "transition-[background-color] duration-300 group-hover:bg-[color:var(--cosmo-accent-deep)]",
        )}
      >
        <span className="truncate">{busy ? t("crew.card.starting") : t("crew.card.start")}</span>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15">
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          )}
        </span>
      </span>
    </motion.button>
  );
}
