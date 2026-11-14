"use client";

import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const OPTIONS: Array<{ lang: Lang; labelKey: string }> = [
  { lang: "en", labelKey: "shell.lang.en" },
  { lang: "mn", labelKey: "shell.lang.mn" },
];

const ITEM_CLASS = cn(
  "h-9 min-w-20 px-3 text-sm",
  "aria-pressed:bg-primary aria-pressed:text-primary-foreground",
  "aria-pressed:hover:bg-primary aria-pressed:hover:text-primary-foreground",
);

/** English / Монгол switch. Exactly one option is always selected. */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <ToggleGroup
      aria-label={t("shell.lang.label")}
      value={[lang]}
      onValueChange={(next) => {
        // pressing the active item empties the group: ignore, a language must stay selected
        const picked = next[0];
        if (picked === "en" || picked === "mn") setLang(picked);
      }}
      variant="outline"
      spacing={0}
      className={cn("rounded-lg bg-card", className)}
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem key={o.lang} value={o.lang} lang={o.lang} className={ITEM_CLASS}>
          {t(o.labelKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
