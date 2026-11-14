"use client";

import { useId, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Typing is always available, with or without a microphone. Enter sends; the field clears on send.
 * `disabled` only blocks sending while a turn is in flight (the text stays so nothing is lost).
 */
export function TextFallbackInput({
  onSend,
  disabled = false,
}: {
  onSend: (text: string) => void | Promise<unknown>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const inputId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (text === "" || disabled) return;
    setValue("");
    void onSend(text);
  };

  return (
    <form onSubmit={submit} className="flex w-full items-center gap-2" data-slot="text-input">
      <label htmlFor={inputId} className="sr-only">
        {t("checkin.text.label")}
      </label>
      <Input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("checkin.text.placeholder")}
        autoComplete="off"
        enterKeyHint="send"
        className="h-11 flex-1 rounded-xl px-4 text-base md:text-base"
      />
      <Button
        type="submit"
        disabled={disabled || value.trim() === ""}
        className="h-11 gap-2 rounded-xl px-4 text-base"
      >
        <Send aria-hidden="true" className="size-4" />
        {t("checkin.text.send")}
      </Button>
    </form>
  );
}
