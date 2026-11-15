"use client";

import { ChevronDown, ShieldQuestion } from "lucide-react";
import { IconChip } from "@/components/dashboard/parts";
import { useI18n } from "@/i18n/I18nProvider";
import { T_HIGH, T_LOW } from "@/lib/signature/config";
import {
  AGREEMENT_RHO_GOOD,
  KIM_2024_DOI,
  SIGNATURE_DATASETS,
  TWINS_STUDY_DOI,
  buildEvidence,
  buildSecondAssayEvidence,
  type SecondAssayEvidenceRow,
} from "@/lib/signature/evidence";
import { CardLimits } from "./CardLimits";
import { formatFri, markerName, numberList } from "./logic";

const SUMMARY =
  "flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-1 py-1.5 text-[13px] font-medium text-[var(--cosmo-ink)] outline-none focus-visible:ring-3 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden";

function Headline({ value, text }: { value: string; text: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-2xl bg-white/60 p-3 ring-1 ring-[var(--cosmo-hairline)]">
      <span className="text-[20px] leading-tight font-medium text-[var(--cosmo-ink)] tnum">{value}</span>
      <span className="text-[12px] leading-snug text-[var(--cosmo-label)]">{text}</span>
    </li>
  );
}

/**
 * Evidence card, "Why trust this, and where not to" (spec section 7.2 item 4 and section 8): the six markers with
 * direction, beyond-own-range, leave-one-out folds and Kim et al. coverage; three headline numbers; collapsible
 * "Tested and rejected" and "Data-quality log"; dataset DOIs and "n = 4, descriptive only". Every number is read from the
 * fixture through buildEvidence (build prompt T8), none is written here.
 */
export function EvidenceCard() {
  const { t, lang } = useI18n();
  const ev = buildEvidence();
  const qcValue = (v: number | null) => (v === null ? t("dashboard.signature.ev.qc.removed") : String(v));
  const l44 = Object.fromEntries(ev.l44.map((b) => [b.kind, b]));
  // addendum T13: the second, independent assay (column, headline, L-44 check)
  const sa = buildSecondAssayEvidence();
  const saRow = Object.fromEntries(sa.rows.map((r) => [r.name, r])) as Record<string, SecondAssayEvidenceRow | undefined>;
  const saCell = (r: SecondAssayEvidenceRow | undefined) =>
    !r || r.kind === "clinical"
      ? t("dashboard.signature.ev.sa.clinical")
      : t(r.kind === "agrees" ? "dashboard.signature.ev.sa.agrees" : "dashboard.signature.ev.sa.not", { rho: String(r.rho) });

  return (
    <section aria-labelledby="sig-ev-title" data-slot="signature-evidence" className="glass-card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <header className="flex items-center gap-2.5">
        <IconChip icon={ShieldQuestion} size={32} />
        <h2 id="sig-ev-title" className="text-[17px] leading-tight font-medium text-[var(--cosmo-ink)]">
          {t("dashboard.signature.ev.title")}
        </h2>
        <CardLimits card="ev" />
      </header>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[30rem] border-separate border-spacing-0 text-left text-[12px]">
          <caption className="sr-only">{t("dashboard.signature.ev.table")}</caption>
          <thead>
            <tr className="text-[11px] text-[var(--cosmo-label)]">
              <th scope="col" className="py-1.5 pr-2 font-medium">{t("dashboard.signature.ev.col.marker")}</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">{t("dashboard.signature.ev.col.direction")}</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">{t("dashboard.signature.ev.col.beyond")}</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">{t("dashboard.signature.ev.col.folds")}</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">{t("dashboard.signature.ev.col.kim")}</th>
              <th scope="col" className="py-1.5 font-medium">{t("dashboard.signature.ev.col.second")}</th>
            </tr>
          </thead>
          <tbody>
            {ev.rows.map((r) => (
              <tr key={r.name} className="text-[var(--cosmo-ink)]">
                <th scope="row" className="border-t border-[var(--cosmo-hairline)] py-1.5 pr-2 font-medium">
                  {markerName(r.name, lang)}{" "}
                  <span className="font-normal text-[var(--cosmo-label)]">({t(`dashboard.signature.fp.${r.tier}`)})</span>
                </th>
                <td className="border-t border-[var(--cosmo-hairline)] py-1.5 pr-2 tnum">
                  {t("dashboard.signature.ev.share", { k: r.direction.k, n: r.direction.n })}
                </td>
                <td className="border-t border-[var(--cosmo-hairline)] py-1.5 pr-2 tnum">
                  {t("dashboard.signature.ev.share", { k: r.beyond.k, n: r.beyond.n })}
                </td>
                <td className="border-t border-[var(--cosmo-hairline)] py-1.5 pr-2">
                  {t("dashboard.signature.ev.folds", { k: r.folds.k, n: r.folds.n })}
                </td>
                <td className="border-t border-[var(--cosmo-hairline)] py-1.5 pr-2">
                  {r.kim ? t("dashboard.signature.ev.kim.yes") : t("dashboard.signature.ev.kim.no")}
                </td>
                <td data-second-assay={saRow[r.name]?.kind ?? "clinical"} className="border-t border-[var(--cosmo-hairline)] py-1.5 tnum">
                  {saCell(saRow[r.name])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Headline
          value={t("dashboard.signature.ev.h.core", { k: ev.core.observed })}
          text={t("dashboard.signature.ev.h.coreText", {
            candidates: ev.core.candidates,
            chance: ev.core.chance,
            chanceL44: ev.core.chanceIfL44Uninformative,
          })}
        />
        <Headline
          value={t("dashboard.signature.ev.h.dir", { k: ev.loco.directionHits, n: ev.loco.selections })}
          text={t("dashboard.signature.ev.h.dirText", { pct: ev.loco.minEffectPct })}
        />
        <Headline
          value={t("dashboard.signature.ev.h.env", { k: ev.loco.envelopeHits, n: ev.loco.selections, chance: ev.loco.chancePct })}
          text={t("dashboard.signature.ev.h.envText")}
        />
        <Headline
          value={t("dashboard.signature.ev.h.noise", { max: ev.noise.max })}
          text={t("dashboard.signature.ev.h.noiseText", { n: ev.noise.n, median: ev.noise.median, low: T_LOW, high: T_HIGH })}
        />
      </ul>
      <p className="-mt-1 text-[12px] leading-snug text-[var(--cosmo-label)]">
        {t("dashboard.signature.ev.h.heldout", {
          heldout: ev.loco.heldoutR1.map(formatFri).join(", "),
          insample: ev.loco.inSampleR1.map(formatFri).join(", "),
        })}
      </p>
      <div data-slot="signature-second-assay-evidence" className="flex flex-col gap-1 rounded-2xl bg-white/60 p-3 ring-1 ring-[var(--cosmo-hairline)]">
        <p className="text-[14px] font-medium leading-snug text-[var(--cosmo-ink)] tnum">
          {t("dashboard.signature.ev.sa.headline", { n: sa.matchedPairs, rho: String(sa.medianRho) })}
        </p>
        <p className="text-[12px] leading-snug text-[var(--cosmo-label)]">
          {t("dashboard.signature.ev.sa.text", {
            k: sa.pairsAtGoodRho,
            n: sa.matchedPairs,
            good: String(AGREEMENT_RHO_GOOD),
            list: sa.sameDirectionBoth.map((m) => markerName(m, lang)).join(", "),
            panels: sa.il6Panels.n,
            same: sa.il6Panels.sameSign,
            spearman: String(sa.il6Panels.spearman),
          })}
        </p>
      </div>
      {/* T14 (spec section 8 item 4b): static text, Cosmo does not speak the numbers of that paper */}
      <div data-slot="signature-twins" className="flex flex-col gap-1 rounded-2xl bg-white/60 p-3 ring-1 ring-[var(--cosmo-hairline)]">
        <p className="text-[13px] font-medium leading-snug text-[var(--cosmo-ink)]">{t("dashboard.signature.ev.twins.title")}</p>
        <p className="text-[12px] leading-snug text-[var(--cosmo-label)]">
          {t("dashboard.signature.ev.twins.study")} {t("dashboard.signature.ev.twins.limits")}
        </p>
        <a
          href={`https://doi.org/${TWINS_STUDY_DOI}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] leading-snug text-[var(--cosmo-label)] underline-offset-2 hover:underline"
        >
          {t("dashboard.signature.ev.twins.ref", { doi: TWINS_STUDY_DOI })}
        </a>
      </div>

      <details className="group rounded-2xl bg-white/50 px-2 py-1 ring-1 ring-[var(--cosmo-hairline)]">
        <summary className={SUMMARY}>
          {t("dashboard.signature.ev.rejected")}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="flex list-disc flex-col gap-1.5 py-2 pl-5 text-[12px] leading-snug text-[var(--cosmo-ink)]">
          <li>
            {t("dashboard.signature.ev.rej.lymph", {
              median: numberList(ev.lymphocytes.pctVsMedian, true),
              fell: ev.lymphocytes.fellVsMedian,
              n: ev.crewCount,
              l3: numberList(ev.lymphocytes.pctVsL3, true),
              high: ev.lymphocytes.l3Highest,
            })}
          </li>
          <li>{t("dashboard.signature.ev.rej.crp", { z: numberList(ev.crp.zR1), inside: ev.crp.insideOwnRange, n: ev.crewCount })}</li>
          <li>{t("dashboard.signature.ev.rej.urine", { k: ev.urine.beyondOwnRange, n: ev.urine.crewWithR1 })}</li>
        </ul>
      </details>

      <details className="group rounded-2xl bg-white/50 px-2 py-1 ring-1 ring-[var(--cosmo-hairline)]">
        <summary className={SUMMARY}>
          {t("dashboard.signature.ev.qc")}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="flex flex-col gap-1 py-2 pl-1 text-[12px] leading-snug text-[var(--cosmo-ink)]">
          {ev.qc.map((q, i) => (
            <li key={i} className="tnum">
              {t("dashboard.signature.ev.qc.row", {
                id: q.id,
                crew: q.crew,
                tp: q.timepoint,
                analyte: q.analyte,
                old: qcValue(q.old),
                new: qcValue(q.new),
              })}
            </li>
          ))}
          {ev.haptoglobinExcluded ? <li>{t("dashboard.signature.ev.qc.haptoglobin")}</li> : null}
          {l44.cardio && l44.immune ? (
            <li>
              {t("dashboard.signature.ev.qc.l44", {
                kc: l44.cardio.lowest,
                nc: l44.cardio.n,
                pc: l44.cardio.sharePct,
                ki: l44.immune.lowest,
                ni: l44.immune.n,
                pi: l44.immune.sharePct,
                chance: ev.l44ChancePct,
              })}
            </li>
          ) : null}
          <li>{t("dashboard.signature.ev.qc.l44second", { k: sa.l44.lowest, n: sa.l44.n, pct: sa.l44.sharePct })}</li>
        </ul>
      </details>

      <footer className="flex flex-col gap-1 border-t border-[var(--cosmo-hairline)] pt-3 text-[11px] leading-snug text-[var(--cosmo-label)]">
        <span className="font-medium text-[var(--cosmo-ink)]">{t("dashboard.signature.ev.sources")}</span>
        <ul className="flex flex-col gap-0.5">
          {SIGNATURE_DATASETS.map((d) => (
            <li key={d.id}>
              <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                {t("dashboard.signature.ev.dataset", { id: d.id, doi: d.doi })}
              </a>
            </li>
          ))}
          <li>
            <a href={`https://doi.org/${KIM_2024_DOI}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              {t("dashboard.signature.ev.kimRef", { doi: KIM_2024_DOI })}
            </a>
          </li>
        </ul>
        <span>{t("dashboard.signature.ev.n", { n: ev.crewCount })}</span>
      </footer>
    </section>
  );
}
