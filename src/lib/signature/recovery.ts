/**
 * Signature Triage recovery bound, ETA and re-test rule (docs/SIGNATURE_SPEC.md section 4.8; port of
 * `half_life_bound` and `eta_days` of docs/signature_reference/reference_engine.py). Pure and deterministic.
 *
 * Inspiration4 has no sample between day 1 and day 45, so recovery time is only bounded (exponential decay of FRI is
 * an ASSUMPTION). Half-lives are computed from FRI rounded to one decimal, as the reference engine does. ETA and
 * re-test are produced only for an EXPECTED_FLIGHT_RESPONSE panel.
 */

import { REFERENCE_CREW, RETEST_MAX, RETEST_MIN, T_LOW } from "./config";
import { SIGNATURE_REFERENCE } from "./reference";
import type { PanelResult } from "./types";

/** the reference engine's `r1`: one decimal */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * `half_life_bound`: two panels `dt` days apart; the implied half-life dt x ln 2 / ln(FRI_a / FRI_b), an UPPER bound when
 * the gap is long. Null when either FRI is missing, FRI did not fall, or FRI_b <= 0.
 */
export function halfLifeBound(fA: number | null, fB: number | null, dt: number): number | null {
  if (fA === null || fB === null || fB >= fA || fB <= 0) return null;
  return (dt * Math.LN2) / Math.log(fA / fB);
}

export interface EtaDays {
  /** days after the panel until the predicted FRI re-enters the BASELINE zone, fast half-life */
  lo: number;
  /** ... slow half-life */
  hi: number;
  /** ceil(lo), before the clip */
  retestRaw: number;
  /** first re-test, days after the panel: ceil(lo) clipped to [RETEST_MIN, RETEST_MAX] */
  retest: number;
}

/** `eta_days`: L = log2(FRI_0 / 20); ETA band = [T_fast x L, T_slow x L]; re-test = clip(ceil(T_fast x L), 3, 21) */
export function etaDays(f0: number, tHalfLo: number, tHalfHi: number): EtaDays {
  const L = Math.log2(f0 / T_LOW);
  const lo = tHalfLo * L;
  const hi = tHalfHi * L;
  const retestRaw = Math.ceil(lo);
  return { lo, hi, retestRaw, retest: Math.min(Math.max(retestRaw, RETEST_MIN), RETEST_MAX) };
}

/**
 * Half-life reference band [fast, slow] (days) from the fixture: for an Inspiration4 crew member the band of the other
 * crew (leave own value out, `recovery.eta[crew].loo_half_life_band`), for anyone else `recovery.reference_band_all`.
 */
export function referenceHalfLifeBand(crew: string): [number, number] {
  const rec = SIGNATURE_REFERENCE.recovery;
  const own = (REFERENCE_CREW as readonly string[]).includes(crew) ? rec.eta[crew]?.loo_half_life_band : undefined;
  const band = own ?? rec.reference_band_all;
  return [band[0], band[1]];
}

/** half-life upper bounds from R+1 -> R+45 (dt 44) per crew, from the scored panels; crew whose FRI rose are absent */
export function halfLifeBoundsR1toR45(panels: readonly PanelResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  const byId = new Map(panels.map((p) => [`${p.crew}_${p.timepoint}`, p]));
  const crews = [...new Set(panels.map((p) => p.crew))];
  for (const c of crews) {
    const a = byId.get(`${c}_R+1`);
    const b = byId.get(`${c}_R+45`);
    if (!a || !b) continue;
    const r = (f: number | null) => (f === null ? null : round1(f));
    const h = halfLifeBound(r(a.fri), r(b.fri), b.missionDay - a.missionDay);
    if (h !== null) out[c] = h;
  }
  return out;
}

export interface RecoveryEstimate {
  /** FRI of the panel, one decimal (the value the half-lives are applied to) */
  fri0: number;
  /** half-life band used [fast, slow], days */
  halfLifeBand: [number, number];
  /** ETA band, days after the panel */
  etaDays: [number, number];
  /** first re-test, days after the panel (clipped) */
  retestOffset: number;
  /** ceil of the fast ETA before the clip */
  retestOffsetRaw: number;
  /** mission day of the first re-test (panel day + offset, landing-relative clock) */
  retestMissionDay: number;
}

/** ETA and first re-test for one panel; null unless the panel is EXPECTED_FLIGHT_RESPONSE */
export function recoveryFor(panel: PanelResult, halfLifeBand?: readonly [number, number]): RecoveryEstimate | null {
  if (panel.cls !== "EXPECTED_FLIGHT_RESPONSE" || panel.fri === null) return null;
  const band = halfLifeBand ? ([halfLifeBand[0], halfLifeBand[1]] as [number, number]) : referenceHalfLifeBand(panel.crew);
  const fri0 = round1(panel.fri);
  const eta = etaDays(fri0, band[0], band[1]);
  return {
    fri0,
    halfLifeBand: band,
    etaDays: [eta.lo, eta.hi],
    retestOffset: eta.retest,
    retestOffsetRaw: eta.retestRaw,
    retestMissionDay: panel.missionDay + eta.retest,
  };
}
