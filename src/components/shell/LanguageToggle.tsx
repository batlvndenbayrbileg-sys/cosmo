"use client";

import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

// The short codes are written in their own script and never translated (like the language names).
const OPTIONS: Array<{ lang: Lang; short: string; nameKey: string }> = [
  { lang: "en", short: "EN", nameKey: "shell.lang.en" },
  { lang: "mn", short: "МН", nameKey: "shell.lang.mn" },
];

/**
 * Compact EN / МН switch: a light rounded track with two pill buttons; the active language is a
 * white raised pill. Exactly one option is always selected (aria-pressed), and each button carries
 * the full language name as its accessible name.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("shell.lang.label")}
      data-slot="language-toggle"
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-0.5 rounded-full border border-white/80 bg-[rgba(15,27,45,0.06)] p-1",
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const active = o.lang === lang;
        return (
          <button
            key={o.lang}
            type="button"
            lang={o.lang}
            aria-pressed={active}
            aria-label={t(o.nameKey)}
            title={t(o.nameKey)}
            onClick={() => {
              if (!active) setLang(o.lang);
            }}
            className={cn(
              "inline-flex h-9 min-w-11 items-center justify-center rounded-full px-3 text-sm font-medium outline-none",
              "transition-[background-color,color,box-shadow] duration-200",
              "focus-visible:ring-3 focus-visible:ring-[color:var(--aegis-accent)]/45",
              active
                ? "bg-white text-[color:var(--aegis-ink)] shadow-[0_4px_12px_-6px_rgba(40,80,160,0.4)]"
                : "text-[color:var(--aegis-label)] hover:bg-white/60 hover:text-[color:var(--aegis-ink)]",
            )}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
