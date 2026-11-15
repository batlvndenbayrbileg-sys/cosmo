"use client";

/**
 * The assistant screen's own controls, placed on the check-in stage by CheckInExperience (entry="assistant"):
 *  - ModeControl, on the right side: "Daily check-up" (or "Continue daily check-up" / "Today's results") while the
 *    assistant is on, "Back to assistant" while the check-up runs or the dashboard shows. Both say the command out loud
 *    as the person's words (the same turn as the voice command), so the server switches the mode and keeps progress.
 *  - IdentityChip, top centre: the name of the person Cosmo is talking with; a tap opens the roster to correct it,
 *    "Listen again" to detect anew, and links to the crew list and the Earth console.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Check, ChevronDown, ClipboardCheck, Ear, Satellite, Users } from "lucide-react";
import { GLASS } from "@/components/checkin/StageControls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/I18nProvider";
import { displayName } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { ConversationState, CrewPublic } from "@/lib/types";
import { variantFor } from "@/components/cosmo/variants";

/** the colour of that person's Cosmo: the render's cyan-violet glow turned by the variant's hue (variants.ts) */
function variantDot(variant: number): CSSProperties {
  return { background: "linear-gradient(135deg, #17F1F8, #AF63F6)", filter: `hue-rotate(${variantFor(variant).hueDeg}deg)` };
}

export type CheckupButtonState = "start" | "continue" | "done";

/** what the "Daily check-up" button says, from where the check-up stands */
export function checkupButtonState(conversation: ConversationState | null): CheckupButtonState {
  if (conversation === "DONE" || conversation === "SUMMARY") return "done";
  if (conversation === null || conversation === "GREETING") return "start";
  return "continue";
}

export function ModeControl({
  assistant,
  conversation,
  disabled,
  placement,
  onSay,
  onBackLocal,
}: {
  /** assistant mode is on */
  assistant: boolean;
  conversation: ConversationState | null;
  disabled: boolean;
  /** "stage": the conversation screen; "dashboard": over the dashboard (always "back to assistant") */
  placement: "stage" | "dashboard";
  /** says the command as the person's words (a turn) */
  onSay: (text: string) => void;
  /** the dashboard was opened from the assistant: back is a screen change only */
  onBackLocal?: () => void;
}) {
  const { t } = useI18n();
  const back = placement === "dashboard" || !assistant;
  const state = checkupButtonState(conversation);
  const label = back ? t("checkin.assistant.back") : t(`checkin.assistant.checkup.${state}`);
  const hint = back ? t("checkin.assistant.back.hint") : t(`checkin.assistant.checkup.hint.${state}`);
  const say = () => {
    if (back) {
      if (placement === "dashboard" && assistant && onBackLocal) onBackLocal();
      else onSay(t("checkin.assistant.say.back"));
      return;
    }
    onSay(t(state === "continue" ? "checkin.assistant.say.continue" : "checkin.assistant.say.start"));
  };
  return (
    <motion.button
      type="button"
      data-slot={back ? "assistant-back" : "assistant-checkup"}
      data-checkup={state}
      aria-label={`${label}. ${hint}`}
      onClick={say}
      disabled={disabled}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 24 }}
      className={cn(
        GLASS,
        "group flex items-center gap-3 text-left text-[var(--aegis-ink)] outline-none",
        placement === "stage" ? "rounded-[22px] py-2.5 pr-5 pl-2.5" : "rounded-full py-1.5 pr-4 pl-1.5 [&>span:first-child]:size-8 [&>span:first-child]:rounded-full",
        "transition-[transform,opacity] hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-[var(--aegis-accent)]/40 disabled:opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl text-white",
          back ? "bg-[var(--aegis-label)]" : "bg-[var(--aegis-ink)]",
        )}
      >
        {back ? <ArrowLeft className="size-5" /> : state === "done" ? <Check className="size-5" /> : <ClipboardCheck className="size-5" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[15.5px] leading-tight font-semibold">{label}</span>
        {/* over the dashboard the button stays small: the label only */}
        {placement === "stage" ? <span className="text-[12.5px] leading-tight text-[var(--aegis-label)]">{hint}</span> : null}
      </span>
    </motion.button>
  );
}

export function IdentityChip({
  crew,
  roster,
  onChoose,
  onDetect,
}: {
  crew: CrewPublic | null;
  roster: CrewPublic[];
  onChoose: (crew: CrewPublic) => void;
  onDetect: () => void;
}) {
  const { t, lang } = useI18n();
  if (!crew) return null;
  const name = displayName(crew, lang);
  const item =
    "flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14.5px] text-[var(--aegis-ink)] outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[var(--aegis-accent)]/45";
  return (
    <Popover>
      <PopoverTrigger
        data-slot="assistant-person"
        aria-label={`${t("checkin.assistant.person.label", { name })}. ${t("checkin.assistant.person.menu")}`}
        className={cn(
          GLASS,
          // phones: just the coloured dot in the top-left corner (the name is in its label); wider: the name too
          "inline-flex h-10 items-center gap-2 rounded-full px-1.5 text-[14px] font-medium text-[var(--aegis-ink)] outline-none sm:pr-3",
          "opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-[var(--aegis-accent)]/45",
        )}
      >
        <span aria-hidden="true" className="size-7 rounded-full ring-2 ring-white" style={variantDot(crew.mascotVariant)} />
        <span className="hidden sm:inline">{name}</span>
        <ChevronDown className="hidden size-3.5 opacity-60 sm:inline" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-60 gap-1 p-1.5" data-slot="assistant-person-menu">
        <p className="px-2.5 pt-1 pb-1.5 text-[12px] font-medium tracking-wide text-[var(--aegis-label)] uppercase">
          {t("checkin.assistant.person.menu")}
        </p>
        {roster.map((c) => (
          <button key={c.id} type="button" className={item} onClick={() => onChoose(c)} aria-pressed={c.id === crew.id}>
            <span aria-hidden="true" className="size-5 rounded-full" style={variantDot(c.mascotVariant)} />
            <span className="flex-1">{displayName(c, lang)}</span>
            {c.id === crew.id ? <Check className="size-4" aria-hidden="true" /> : null}
          </button>
        ))}
        <div className="my-1 h-px bg-black/10" aria-hidden="true" />
        <button type="button" className={item} onClick={onDetect}>
          <Ear className="size-4" aria-hidden="true" />
          {t("checkin.assistant.person.detect")}
        </button>
        <Link href="/crew" className={item}>
          <Users className="size-4" aria-hidden="true" />
          {t("checkin.assistant.person.list")}
        </Link>
        <Link href="/earth" className={item}>
          <Satellite className="size-4" aria-hidden="true" />
          {t("checkin.assistant.person.earth")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
