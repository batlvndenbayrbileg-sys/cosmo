"use client";

/**
 * "lil cosmo" on the conversation stage (top-right corner, next to the camera and language controls): a ghost pill
 * like its neighbours that opens a small card with
 *  - the download for this computer (Windows .exe or macOS .dmg, src/lib/pet/download.ts), the other build as a
 *    small link, or "Desktop app coming soon" when no build is published (never a link to a missing file);
 *  - "Open as <name>": the lilcosmo://crew/<id> link that hands this person to an installed pet.
 * Hidden on phone-sized screens: the pet is a desktop app. docs/lil-cosmo.md explains the builds and the env vars.
 */
import { useSyncExternalStore } from "react";
import Image from "next/image";
import { Clock, Download, MonitorSmartphone } from "lucide-react";
import { GHOST } from "@/components/checkin/StageControls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/I18nProvider";
import { displayName } from "@/lib/identity";
import { configuredPetUrls, detectPetPlatform, pickPetDownloads, type PetPlatform } from "@/lib/pet/download";
import { petLink } from "@/lib/pet/link";
import type { CrewPublic } from "@/lib/types";
import { cn } from "@/lib/utils";

const subscribeNever = () => () => {};

function readPlatform(): PetPlatform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectPetPlatform({
    userAgent: nav.userAgent,
    platform: nav.platform,
    uaPlatform: nav.userAgentData?.platform,
    maxTouchPoints: nav.maxTouchPoints,
  });
}

export function LilCosmoControl({ crew }: { crew: Pick<CrewPublic, "id" | "name"> }) {
  const { t, lang } = useI18n();
  // the server does not know the visitor's computer: "other" until hydrated, then the real one
  const platform = useSyncExternalStore(subscribeNever, readPlatform, () => "other" as const);
  const { primary, others } = pickPetDownloads(configuredPetUrls(), platform);
  // this computer has no build but another does (e.g. Linux): offer them all as equals
  const list = primary ? [primary] : others;
  const extra = primary ? others : [];
  const link = petLink(crew.id);
  const name = displayName(crew, lang);

  return (
    <span className="hidden sm:inline-flex" data-slot="stage-lil-cosmo">
      <Popover>
        <PopoverTrigger aria-label={t("crew.pet.aria")} title={t("crew.pet.aria")} className={cn(GHOST, "pr-3.5 pl-1.5 text-[13.5px] font-medium")}>
          <Image src="/mascot/cosmo-front.png" alt="" width={28} height={28} className="size-7 rounded-full bg-white/70 object-contain" />
          {t("crew.pet.launch")}
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-[21rem] max-w-[calc(100vw-2rem)] gap-3 rounded-2xl p-3.5" data-slot="lil-cosmo-card">
          <div className="flex items-start gap-3">
            <Image
              src="/mascot/cosmo-front.png"
              alt=""
              width={48}
              height={48}
              className="size-12 shrink-0 rounded-2xl bg-[linear-gradient(135deg,#e6efff,#f7faff)] object-contain p-0.5"
            />
            <div className="min-w-0">
              <p className="text-[15px] leading-tight font-semibold text-[var(--cosmo-ink)]">{t("crew.pet.launch")}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-[var(--cosmo-label)]">{t("crew.pet.lead")}</p>
            </div>
          </div>

          {list.length > 0 ? (
            <div className="flex flex-col gap-1.5" data-slot="lil-cosmo-downloads" data-platform={platform}>
              {list.map((d) => (
                <a
                  key={d.platform}
                  href={d.url}
                  download
                  rel="noopener"
                  data-download={d.platform}
                  className={cn(
                    "flex h-11 items-center gap-2.5 rounded-xl bg-[var(--cosmo-ink)] px-3.5 text-white outline-none",
                    "transition-[transform,opacity] hover:-translate-y-px hover:opacity-95 focus-visible:ring-3 focus-visible:ring-[var(--cosmo-accent)]/45",
                  )}
                >
                  <Download className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{t(`crew.pet.download.${d.platform}`)}</span>
                  <span className="shrink-0 text-[11px] whitespace-nowrap text-white/70">{t("crew.pet.download.size")}</span>
                </a>
              ))}
              {extra.map((d) => (
                <a
                  key={d.platform}
                  href={d.url}
                  download
                  rel="noopener"
                  data-download={d.platform}
                  className="self-start rounded px-1 text-[12.5px] text-[var(--cosmo-ink)] underline decoration-black/25 underline-offset-2 outline-none hover:decoration-black/60 focus-visible:ring-2 focus-visible:ring-[var(--cosmo-accent)]/45"
                >
                  {t(`crew.pet.also.${d.platform}`)}
                </a>
              ))}
              <p className="text-[11.5px] leading-snug text-[var(--cosmo-label)]">{t("crew.pet.unsigned")}</p>
            </div>
          ) : (
            <div
              className="flex items-center gap-2.5 rounded-xl border border-dashed border-black/15 bg-white/60 px-3.5 py-2.5"
              data-slot="lil-cosmo-soon"
            >
              <Clock className="size-4 shrink-0 text-[var(--cosmo-label)]" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-[var(--cosmo-ink)]">{t("crew.pet.soon")}</p>
                <p className="text-[11.5px] text-[var(--cosmo-label)]">{t("crew.pet.soon.hint")}</p>
              </div>
            </div>
          )}

          {link ? (
            <a
              href={link}
              data-slot="lil-cosmo-open"
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[var(--cosmo-accent)]/45"
            >
              <MonitorSmartphone className="size-4 shrink-0 text-[var(--cosmo-ink)]" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-[var(--cosmo-ink)]">{t("crew.pet.open", { name })}</span>
                <span className="block text-[11.5px] text-[var(--cosmo-label)]">{t("crew.pet.open.hint")}</span>
              </span>
            </a>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  );
}
