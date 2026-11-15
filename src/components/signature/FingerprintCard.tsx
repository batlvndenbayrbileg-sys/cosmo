"use client";

import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconChip } from "@/components/dashboard/parts";
import { useI18n } from "@/i18n/I18nProvider";
import { OTHER_LARGE_FOLD, Z_CAP } from "@/lib/signature/config";
import type { SignatureViewData } from "@/lib/signature/view";
import type { PanelResult } from "@/lib/signature/types";
import { cn } from "@/lib/utils";
import {
  drawerSeries,
  fingerprintRows,
  formatLabValue,
  isSingleAssayMarker,
  markerTooltip,
  otherChanges,
  type FingerprintRow,
} from "./logic";

const CORE_FILL = "var(--aegis-accent-deep)";
const SUPP_FILL = "#9dbcf6";
const ENVELOPE_FILL = "rgba(15, 27, 45, 0.12)";

interface ChartRow {
  name: string;
  label: string;
  bar: number;
  envelope: [number, number];
  row: FingerprintRow;
}

function FpTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ChartRow }> }) {
  const { lang } = useI18n();
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  return (
    <div className="max-w-[16rem] rounded-xl bg-white px-3 py-2 text-[12px] leading-snug text-[var(--aegis-ink)] shadow-lg ring-1 ring-[var(--aegis-hairline)]">
      <p className="font-medium">{r.label}</p>
      <p>{markerTooltip(r.row, lang)}</p>
    </div>
  );
}

/** the analyte drawer (spec section 7.2 says "the existing analyte drawer"; none exists here, so a small dialog) */
function AnalyteDrawer({
  view,
  crew,
  row,
  onClose,
}: {
  view: SignatureViewData;
  crew: string;
  row: FingerprintRow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const series = row ? drawerSeries(view, row.name, crew) : null;
  const config = { value: { label: row?.label ?? "", color: "var(--aegis-accent-deep)" } } satisfies ChartConfig;
  return (
    <Dialog open={row !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        {row && series ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("dashboard.signature.drawer.title", { marker: row.label, crew })}</DialogTitle>
              <DialogDescription>
                {t("dashboard.signature.drawer.desc", {
                  baseline: series.baseline === null ? "–" : formatLabValue(series.baseline),
                  unit: series.unit,
                })}
              </DialogDescription>
            </DialogHeader>
            <ChartContainer config={config} className="aspect-[1.8] w-full">
              <LineChart data={series.points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="rgba(15,27,45,0.06)" />
                <XAxis dataKey="tp" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} />
                {series.baseline !== null ? (
                  <ReferenceLine y={series.baseline} stroke="#9aa6b8" strokeDasharray="5 4" />
                ) : null}
                <ReferenceLine x="R+1" stroke="rgba(15,27,45,0.18)" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  connectNulls={false}
                  dot={{ r: 3.5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
            <div className="sr-only">
              <table>
                <caption>{t("dashboard.signature.drawer.table", { marker: row.label })}</caption>
                <tbody>
                  {series.points.map((p) => (
                    <tr key={p.tp}>
                      <th scope="row">{p.tp}</th>
                      <td>{p.value === null ? t("dashboard.signature.drawer.none") : `${formatLabValue(p.value)} ${series.unit}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fingerprint card (spec section 7.2 item 2): one horizontal bar per signature marker, z clipped to [-4, 4], core
 * solid and supporting lighter; behind each bar the Inspiration4 envelope (min-max z of the other three crew at R+1).
 * Tooltip: value + unit, own baseline, fold, above all pre-flight values. A row opens the analyte drawer. Below:
 * "Other large changes", information only.
 */
export function FingerprintCard({ view, panel }: { view: SignatureViewData; panel: PanelResult }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<FingerprintRow | null>(null);
  const rows = fingerprintRows(view, panel, lang);
  const others = otherChanges(panel);
  // addendum T13: MCP-1, IL-10, IL-27 are not confirmed by the second assay (shown when the panel carries the check)
  const singleAssay = panel.secondAssay ? rows.filter((r) => isSingleAssayMarker(r.name)) : [];
  const data: ChartRow[] = rows.map((r) => ({
    name: r.name,
    label: r.label,
    bar: r.bar ?? 0,
    envelope: r.envelope ? [Math.max(r.envelope[0], -Z_CAP), Math.min(r.envelope[1], Z_CAP)] : [0, 0],
    row: r,
  }));
  const config = {
    bar: { label: t("dashboard.signature.fp.col.z"), color: CORE_FILL },
    envelope: { label: t("dashboard.signature.fp.envelope"), color: ENVELOPE_FILL },
  } satisfies ChartConfig;
  const openRow = (entry: unknown) => {
    const r = (entry as { payload?: ChartRow } | undefined)?.payload?.row;
    if (r) setOpen(r);
  };

  return (
    <section aria-labelledby="sig-fp-title" data-slot="signature-fingerprint" className="glass-card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <header className="flex items-center gap-2.5">
        <IconChip icon={Fingerprint} size={32} />
        <h2 id="sig-fp-title" className="text-[17px] leading-tight font-medium text-[var(--aegis-ink)]">
          {t("dashboard.signature.fp.title")}
        </h2>
      </header>
      <p className="text-[12px] leading-snug text-[var(--aegis-label)]">{t("dashboard.signature.fp.hint", { cap: Z_CAP })}</p>

      <div aria-hidden="true">
        <ChartContainer config={config} className="aspect-[1.7] w-full">
          <BarChart data={data} layout="vertical" barGap={-14} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid horizontal={false} stroke="rgba(15,27,45,0.06)" />
            <XAxis type="number" domain={[-Z_CAP, Z_CAP]} ticks={[-Z_CAP, -2, 0, 2, Z_CAP]} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={92} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#0f1b2d" }} />
            <ReferenceLine x={0} stroke="rgba(15,27,45,0.25)" />
            <ChartTooltip cursor={{ fill: "rgba(79,134,247,0.06)" }} content={<FpTooltip />} />
            <Bar dataKey="envelope" barSize={18} fill={ENVELOPE_FILL} radius={4} isAnimationActive={false} onClick={openRow} />
            <Bar dataKey="bar" barSize={10} radius={3} onClick={openRow} className="cursor-pointer">
              {data.map((d) => (
                <Cell key={d.name} fill={d.row.tier === "core" ? CORE_FILL : SUPP_FILL} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--aegis-label)]" aria-hidden="true">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: CORE_FILL }} />
          {t("dashboard.signature.fp.core")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: SUPP_FILL }} />
          {t("dashboard.signature.fp.supporting")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: ENVELOPE_FILL }} />
          {t("dashboard.signature.fp.envelope")}
        </li>
      </ul>

      {singleAssay.length > 0 ? (
        <div data-slot="signature-single-assay" className="flex flex-col gap-1.5">
          <ul className="flex flex-wrap gap-1.5">
            {singleAssay.map((r) => (
              <li
                key={r.name}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-[#d9a441] px-2 text-[11px] text-[var(--status-watch-ink)]"
              >
                <span className="font-medium">{r.label}</span>
                <span>· {t("dashboard.signature.fp.singleAssay")}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-[var(--aegis-label)]">
            {t("dashboard.signature.fp.singleAssayNote", { list: singleAssay.map((r) => r.label).join(", ") })}
          </p>
        </div>
      ) : null}

      {/* the values behind the chart, for screen readers and as the keyboard path to the drawer */}
      <div className="sr-only">
        <table>
          <caption>{t("dashboard.signature.fp.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("dashboard.signature.fp.col.marker")}</th>
              <th scope="col">{t("dashboard.signature.fp.col.z")}</th>
              <th scope="col">{t("dashboard.signature.fp.col.envelope")}</th>
              <th scope="col">{t("dashboard.signature.fp.col.detail")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">
                  {r.label} ({t(`dashboard.signature.fp.${r.tier}`)}
                  {panel.secondAssay && isSingleAssayMarker(r.name) ? `, ${t("dashboard.signature.fp.singleAssay")}` : ""})
                </th>
                <td>
                  {r.bar === null ? "–" : r.bar.toFixed(2)}
                  {r.capped ? `, ${t("dashboard.signature.fp.capped", { cap: Z_CAP })}` : ""}
                </td>
                <td>{r.envelope ? `${r.envelope[0].toFixed(2)} – ${r.envelope[1].toFixed(2)}` : "–"}</td>
                <td>
                  {markerTooltip(r, lang)}{" "}
                  <button type="button" onClick={() => setOpen(r)}>
                    {t("dashboard.signature.fp.open", { marker: r.label })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5 rounded-2xl bg-white/60 p-3 ring-1 ring-[var(--aegis-hairline)]">
        <p className="flex items-baseline gap-2 text-[13px] font-medium text-[var(--aegis-ink)]">
          {t("dashboard.signature.fp.other.title")}
          <span className="text-[11px] font-normal text-[var(--aegis-label)]">{t("dashboard.signature.fp.other.info")}</span>
        </p>
        {others.length === 0 ? (
          <p className="text-[12px] text-[var(--aegis-label)]">{t("dashboard.signature.fp.other.none", { fold: OTHER_LARGE_FOLD })}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {others.map((o) => (
              <li
                key={o.label}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[12px] ring-1",
                  "bg-[var(--status-nodata-soft)] text-[var(--aegis-ink)] ring-[var(--aegis-hairline)]",
                )}
              >
                {t("dashboard.signature.fp.other.item", { marker: o.label, fold: o.fold })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnalyteDrawer view={view} crew={panel.crew} row={open} onClose={() => setOpen(null)} />
    </section>
  );
}
