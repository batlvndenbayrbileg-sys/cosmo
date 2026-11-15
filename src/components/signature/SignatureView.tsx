"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageFrame } from "@/components/shell/PageFrame";
import { TopBar, TopBarTrack } from "@/components/shell/TopBar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/I18nProvider";
import { SIGNATURE_DISCLAIMER } from "@/lib/signature/facts";
import type { SignatureViewData } from "@/lib/signature/view";
import type { Timepoint } from "@/lib/signature/types";
import { EvidenceCard } from "./EvidenceCard";
import { FingerprintCard } from "./FingerprintCard";
import { RecoveryCard } from "./RecoveryCard";
import { TriageCard } from "./TriageCard";
import { panelOf } from "./logic";

/**
 * /signature page body (spec section 7.2; integration map section 4.4): crew switch C001..C004 (Inspiration4 reference
 * data), and the cards in a 2 x 2 grid (stacked on phones). The timepoint selector on the Triage card switches the
 * panel of every card; crew and panel are mirrored into the URL (?crew=&tp=) without a server round trip.
 */
export function SignatureView({
  data,
  initialCrew,
  initialTimepoint,
  backHref,
}: {
  data: SignatureViewData;
  initialCrew: string;
  initialTimepoint: Timepoint;
  /** where "Back to the dashboard" leads (the dashboard link passes its check-in) */
  backHref?: string | null;
}) {
  const { t, lang } = useI18n();
  const [crew, setCrew] = useState<string>((data.crew as readonly string[]).includes(initialCrew) ? initialCrew : data.crew[0]);
  const [tp, setTp] = useState<Timepoint>(data.timepoints.includes(initialTimepoint) ? initialTimepoint : data.timepoints[0]);
  const panel = panelOf(data, crew, tp);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("crew", crew);
      url.searchParams.set("tp", tp);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // URL mirroring is a convenience only
    }
  }, [crew, tp]);

  return (
    <PageFrame data-slot="signature">
        <TopBar
          center={
            <TopBarTrack>
              <span className="px-3 text-[15px] font-medium text-[var(--cosmo-ink)]">{t("dashboard.signature.title")}</span>
            </TopBarTrack>
          }
          right={
            backHref ? (
              <Link
                href={backHref}
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] text-[var(--cosmo-ink)] ring-1 ring-[var(--cosmo-hairline)] outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">{t("dashboard.signature.back")}</span>
                <span className="sr-only sm:hidden">{t("dashboard.signature.back")}</span>
              </Link>
            ) : null
          }
        />

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[28px] leading-tight font-light tracking-tight text-[var(--cosmo-ink)] sm:text-[32px]">
              {t("dashboard.signature.title")}
            </h1>
            <p className="max-w-2xl text-[15px] text-[var(--cosmo-label)]">{t("dashboard.signature.subtitle")}</p>
          </div>
          <div className="flex flex-col items-start gap-1.5 lg:items-end">
            <span className="unit-label">{t("dashboard.signature.crewLabel")}</span>
            <ToggleGroup
              aria-label={t("dashboard.signature.crewLabel")}
              value={[crew]}
              onValueChange={(v) => {
                if (v[0]) setCrew(v[0]);
              }}
              spacing={1}
              className="rounded-full bg-[rgba(15,27,45,0.05)] p-1"
            >
              {data.crew.map((c) => (
                <ToggleGroupItem
                  key={c}
                  value={c}
                  className="h-9 rounded-full px-3.5 text-[14px] text-[var(--cosmo-label)] aria-pressed:bg-white aria-pressed:text-[var(--cosmo-ink)] aria-pressed:shadow-sm"
                >
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        <div role="region" aria-label={t("dashboard.signature.cardsLabel")} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <TriageCard panel={panel} timepoints={data.timepoints} onTimepoint={setTp} />
          <FingerprintCard view={data} panel={panel} />
          <RecoveryCard view={data} crew={crew} timepoint={panel.timepoint} />
          <EvidenceCard />
        </div>

        <p className="text-center text-[13px] text-[var(--cosmo-label)]">{SIGNATURE_DISCLAIMER[lang]}</p>
    </PageFrame>
  );
}
