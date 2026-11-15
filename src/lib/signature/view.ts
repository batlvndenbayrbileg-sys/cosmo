/**
 * Signature Triage page data (docs/SIGNATURE_SPEC.md section 7.2; build prompt T7-T8). Pure: takes the parsed + QC'd
 * matrix and returns one serialisable object with everything the four cards show for C001..C004, so the client page
 * never reads files and never recomputes the engine. Every number comes from engine.ts / recovery.ts or the fixture.
 */

import { CORE_SIGNATURE, POST_TIMEPOINTS, REFERENCE_CREW, SUPPORTING_SIGNATURE, type ReferenceCrewId } from "./config";
import { bareName, scale, scorePanel, zscore } from "./engine";
import type { LabData } from "./load";
import { scorePanelWithSecondAssay } from "./secondAssay";
import type {
  LabFileKind,
  MarkerKey,
  MarkerSeries,
  MarkerTier,
  PanelResult,
  QcEntry,
  SecondAssayMatrix,
  Timepoint,
} from "./types";

/** unit of a signature marker by source file (spec section 3) */
export const MARKER_UNIT: Readonly<Record<LabFileKind, string>> = {
  immune: "pg/mL",
  cardio: "pg/mL",
  cmp: "mg/dL",
  cbc: "%",
};

export interface SignatureMarkerInfo {
  key: MarkerKey;
  /** bare analyte name, the key of `PanelResult.markers` (e.g. "il_6") */
  name: string;
  tier: MarkerTier;
  unit: string;
  /** after QC, per reference crew member: the seven draws */
  series: Record<string, MarkerSeries>;
  /** z at R+1 per reference crew member (pooled scale on C001..C004); the Inspiration4 envelope is built from these */
  zR1: Record<string, number | null>;
}

export interface SignatureViewData {
  crew: ReferenceCrewId[];
  /** the four post-flight panels, in day order */
  timepoints: Timepoint[];
  /** crew -> the four scored post-flight panels, in day order */
  panels: Record<string, PanelResult[]>;
  /** the six signature markers in display order: IL-6, MCP-1, IL-10, IL-27, glucose, monocytes % */
  markers: SignatureMarkerInfo[];
  qcLog: QcEntry[];
}

function fileOf(key: MarkerKey): LabFileKind {
  return key.slice(0, key.indexOf(":")) as LabFileKind;
}

/**
 * everything the signature page shows, computed once on the server; with `second` (the second-assay matrix, addendum
 * T13) every panel also carries its two-key check (`PanelResult.secondAssay`)
 */
export function buildSignatureView({ matrix, qcLog }: LabData, second?: SecondAssayMatrix | null): SignatureViewData {
  const crew = [...REFERENCE_CREW];
  const panels: Record<string, PanelResult[]> = {};
  for (const c of crew) {
    panels[c] = POST_TIMEPOINTS.map((t) => (second ? scorePanelWithSecondAssay(matrix, second, c, t) : scorePanel(matrix, c, t)));
  }

  const markers: SignatureMarkerInfo[] = [];
  for (const [keys, tier] of [
    [CORE_SIGNATURE, "core"],
    [SUPPORTING_SIGNATURE, "supporting"],
  ] as const) {
    for (const key of keys) {
      const s = scale(matrix, key);
      const series: Record<string, MarkerSeries> = {};
      const zR1: Record<string, number | null> = {};
      for (const c of crew) {
        series[c] = { ...(matrix[key]?.[c] ?? {}) };
        zR1[c] = zscore(matrix, key, c, "R+1", s);
      }
      markers.push({ key, name: bareName(key), tier, unit: MARKER_UNIT[fileOf(key)], series, zR1 });
    }
  }
  return { crew, timepoints: [...POST_TIMEPOINTS], panels, markers, qcLog: qcLog.map((q) => ({ ...q })) };
}
