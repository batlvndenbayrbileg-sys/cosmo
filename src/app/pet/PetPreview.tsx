"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { GLASS } from "@/components/checkin/StageControls";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { RunSprite } from "./RunSprite";

/** how long she runs one way, then stands, in the preview loop */
const RUN_MS = 2400;
const STAND_MS = 1600;

/**
 * /pet in a normal browser tab: what lil cosmo is, with her running back and forth along a little "screen edge".
 * Nothing is started here (no session, no conversation, no microphone or camera); the download lives in the
 * "lil cosmo" control on the Cosmo screen. Reduced motion: she stands still.
 */
export function PetPreview() {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const [running, setRunning] = useState(false);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    let run = false;
    const next = () => {
      run = !run;
      setRunning(run);
      if (run) setDir((d) => -d);
      timer = setTimeout(next, run ? RUN_MS : STAND_MS);
    };
    timer = setTimeout(next, STAND_MS);
    return () => {
      clearTimeout(timer);
      setRunning(false);
    };
  }, [reduced]);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4 py-10" data-slot="pet-preview">
      <div className={cn(GLASS, "w-full max-w-md rounded-[28px] p-6 sm:p-8")}>
        <p className="text-[13px] font-semibold tracking-wide text-[var(--aegis-label)]">{t("crew.pet.launch")}</p>
        <h1 className="mt-1 text-[22px] leading-tight font-semibold text-[var(--aegis-ink)] sm:text-[26px]">{t("crew.pet.preview.title")}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--aegis-label)]">{t("crew.pet.lead")}</p>

        {/* a strip of "screen" with her on its bottom edge */}
        <div className="relative mt-6 h-40 overflow-hidden rounded-2xl border border-white/80 bg-[linear-gradient(180deg,#e6efff_0%,#f7faff_70%,#dfe8f8_100%)]">
          <div className="absolute inset-x-0 bottom-0 h-2.5 bg-[var(--aegis-ink)]/10" aria-hidden="true" />
          <div
            className="absolute bottom-2.5 h-[112px] w-[112px] transition-[left] ease-in-out motion-reduce:transition-none"
            style={{ left: dir > 0 ? "calc(100% - 124px)" : "12px", transitionDuration: `${RUN_MS}ms` }}
          >
            <div className="h-full w-full transition-opacity duration-150" style={{ opacity: running ? 0 : 1 }}>
              <CosmoAvatar variant={0} state="idle" emotion="happy" amplitude={0} pose="front" />
            </div>
            <RunSprite running={running} dir={dir} size={112} />
          </div>
        </div>

        <p className="mt-5 text-[13.5px] leading-relaxed text-[var(--aegis-ink)]">{t("crew.pet.preview.body")}</p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--aegis-ink)] px-5 text-[14px] font-semibold text-white outline-none transition-transform hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-[var(--aegis-accent)]/45"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("crew.pet.preview.back")}
        </Link>
      </div>
    </div>
  );
}
