import { describe, expect, it } from "vitest";
import { KITS_TOTAL, REFERENCE_CREW } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import {
  dailyStrain,
  drawAdvice,
  drawStateFromPanels,
  dssSeries,
  importPanel,
  initialDrawState,
  kitsLeft,
  strainDayFromKpis,
  strainDaysFromHistory,
  type DrawState,
  type StrainDay,
} from "@/lib/signature/strain";
import type { HistoryDay } from "@/lib/health/baseline";
import type { PanelResult, TriageClass } from "@/lib/signature/types";
import { getLabData } from "@/server/signature/files";

const { matrix } = getLabData();

/** build-prompt T5 rule: 14 days, sleep_hours = 7.0 + 0.1*(i%3), sleep_quality 4, resting_hr = 58 + (i%2), fatigue 2, mood 4 */
const HISTORY: StrainDay[] = Array.from({ length: 14 }, (_, i) => ({
  sleep_hours: 7.0 + 0.1 * (i % 3),
  sleep_quality: 4,
  resting_hr: 58 + (i % 2),
  fatigue: 2,
  mood: 4,
}));
const CALM: StrainDay = { sleep_hours: 7.1, sleep_quality: 4, resting_hr: 58, fatigue: 2, mood: 4 };
const STRAINED: StrainDay = { sleep_hours: 5.0, sleep_quality: 2, resting_hr: 66, fatigue: 4, mood: 3 };

/** a state with `daysSince` since the last panel of class `cls`, the given DSS days */
function stateWith(daysSince: number, cls: TriageClass, dss: (number | null)[], extra: Partial<DrawState> = {}): DrawState {
  const today = 100;
  return {
    ...initialDrawState(today),
    lastPanelDay: today - daysSince,
    lastPanelClass: cls,
    panelsImported: 3,
    dss,
    ...extra,
  };
}
const calmDays = (n: number) => Array.from({ length: n }, () => 0);

describe("signature T5: Daily Strain Score", () => {
  it("14-day history; today {7.1, 4, 58, 2, 4} -> DSS 0.0; today {5.0, 2, 66, 4, 3} -> DSS 90.0", () => {
    expect(Math.abs((dailyStrain(HISTORY, CALM) as number) - 0.0)).toBeLessThanOrEqual(0.05);
    expect(Math.abs((dailyStrain(HISTORY, STRAINED) as number) - 90.0)).toBeLessThanOrEqual(0.05);
  });

  it("matches the fixture daily_strain_test vector", () => {
    const t = SIGNATURE_REFERENCE.daily_strain_test;
    expect(dailyStrain(HISTORY, t.calm_day.input)).toBeCloseTo(t.calm_day.dss as number, 1);
    expect(dailyStrain(HISTORY, t.strained_day.input)).toBeCloseTo(t.strained_day.dss as number, 1);
  });

  it("fewer than 5 history days -> null", () => {
    expect(dailyStrain(HISTORY.slice(0, 4), STRAINED)).toBeNull();
    expect(dailyStrain([], STRAINED)).toBeNull();
    expect(dailyStrain(HISTORY.slice(0, 5), STRAINED)).not.toBeNull();
  });

  it("skips a KPI without 5 history values or without a value today; no scorable KPI -> null", () => {
    // only mood scored: -(3 - 4) / 0.5 = 2 -> 2/3
    expect(dailyStrain(HISTORY, { mood: 3 })).toBeCloseTo(200 / 3, 9);
    expect(dailyStrain(HISTORY, { mood: 3, sleep_quality: null })).toBeCloseTo(200 / 3, 9);
    const noQuality = HISTORY.map((h) => ({ ...h, sleep_quality: null }));
    expect(dailyStrain(noQuality, { sleep_quality: 1, mood: 3 })).toBeCloseTo(200 / 3, 9);
    expect(dailyStrain(HISTORY, {})).toBeNull();
  });

  it("only uses the last 14 history days", () => {
    const old: StrainDay[] = Array.from({ length: 10 }, () => ({ mood: 1 }));
    expect(dailyStrain([...old, ...HISTORY], STRAINED)).toBeCloseTo(dailyStrain(HISTORY, STRAINED) as number, 12);
  });

  it("dssSeries scores each day against the days before it (14 calm days, then 3 strained days)", () => {
    const s = dssSeries([...HISTORY, STRAINED, STRAINED, STRAINED]);
    expect(s.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(s[14]).toBeCloseTo(90.0, 9);
    expect(s[15] as number).toBeGreaterThanOrEqual(50);
    expect(s[16] as number).toBeGreaterThanOrEqual(50);
  });
});

describe("signature T5: app KPI mapping", () => {
  it("sleep_hours -> sleep_hours, heart_rate -> resting_hr, mood -> mood; no sleep_quality or fatigue", () => {
    expect(strainDayFromKpis({ sleep_hours: 6.5, heart_rate: 61, mood: 4, workload: 5, water_ml: 1500 })).toEqual({
      sleep_hours: 6.5,
      resting_hr: 61,
      mood: 4,
    });
    expect(strainDayFromKpis({ sleep_hours: "7,5", heart_rate: "n/a" })).toEqual({ sleep_hours: 7.5 });
  });

  it("history days are sorted by date and mapped", () => {
    const h: HistoryDay[] = [
      { date: "2026-10-03", values: { mood: 2 } },
      { date: "2026-10-01", values: { mood: 4, heart_rate: 60 } },
      { date: "2026-10-02", values: { sleep_hours: 7 } },
    ];
    expect(strainDaysFromHistory(h)).toEqual([{ mood: 4, resting_hr: 60 }, { sleep_hours: 7 }, { mood: 2 }]);
  });
});

describe("signature T5: draw advisor", () => {
  it("A2 fires with DSS >= 50 on 3 consecutive days and last panel 9 days ago", () => {
    const a = drawAdvice(stateWith(9, "BASELINE", [...calmDays(14), 90, 90, 90]));
    expect(a.rule).toBe("A2");
    expect(a.action).toBe("DRAW_RECOMMENDED");
    expect(a.daysSinceLastPanel).toBe(9);
    expect(a.kitsLeft).toBe(5);
    expect(a.kitsTotal).toBe(8);
  });

  it("A2 does not fire at 6 days, nor with only 2 strained days", () => {
    expect(drawAdvice(stateWith(6, "BASELINE", [...calmDays(14), 90, 90, 90])).rule).not.toBe("A2");
    expect(drawAdvice(stateWith(6, "BASELINE", [...calmDays(14), 90, 90, 90])).rule).toBe("A6");
    expect(drawAdvice(stateWith(9, "BASELINE", [...calmDays(14), 40, 90, 90])).rule).not.toBe("A2");
    expect(drawAdvice(stateWith(9, "BASELINE", [...calmDays(14), 90, 90, null])).rule).not.toBe("A2");
  });

  it("A2 with the simulated check-ins (14 calm days, then 3 days {5.0, 2, 66, 4, 3})", () => {
    const dss = dssSeries([...HISTORY, STRAINED, STRAINED, STRAINED]);
    expect(drawAdvice(stateWith(9, "BASELINE", dss)).rule).toBe("A2");
  });

  it("A3 returns SKIP and increments kitsSaved: last panel 31 days ago, class BASELINE, 7 calm days", () => {
    const s = stateWith(31, "BASELINE", calmDays(7));
    const a = drawAdvice(s);
    expect(a.rule).toBe("A3");
    expect(a.action).toBe("SKIP");
    expect(a.kitsSaved).toBe(1);
    expect(a.state.kitsSaved).toBe(1);
    expect(a.dueDay).toBe(s.today + 7);
    expect(a.kitsLeft).toBe(kitsLeft(s)); // a skip uses no kit
    expect(s.kitsSaved).toBe(0); // pure
  });

  it("A3 counts one skip once until its re-check day", () => {
    const first = drawAdvice(stateWith(31, "BASELINE", calmDays(7)));
    const nextDay = drawAdvice({ ...first.state, today: first.state.today + 1, dss: calmDays(8) });
    expect(nextDay.rule).toBe("A3");
    expect(nextDay.kitsSaved).toBe(1);
    const recheck = drawAdvice({ ...first.state, today: first.dueDay as number, dss: calmDays(14) });
    expect(recheck.rule).toBe("A3");
    expect(recheck.kitsSaved).toBe(2);
  });

  it("A3 needs class BASELINE and 7 calm days, else A4 routine draw", () => {
    expect(drawAdvice(stateWith(31, "INDETERMINATE", calmDays(7))).rule).toBe("A4");
    expect(drawAdvice(stateWith(31, "BASELINE", [...calmDays(6), 30])).rule).toBe("A4");
    expect(drawAdvice(stateWith(31, "BASELINE", calmDays(6))).rule).toBe("A4");
    expect(drawAdvice(stateWith(30, "BASELINE", [])).action).toBe("DRAW");
    expect(drawAdvice(stateWith(29, "BASELINE", calmDays(7))).rule).toBe("A6");
  });

  it("A1 beats A2 when a re-test date is due", () => {
    const strained = [...calmDays(14), 90, 90, 90];
    const due = drawAdvice(stateWith(9, "EXPECTED_FLIGHT_RESPONSE", strained, { retestDay: 100 }));
    expect(due.rule).toBe("A1");
    expect(due.action).toBe("DRAW_TODAY");
    expect(due.dueDay).toBe(100);
    expect(drawAdvice(stateWith(9, "BASELINE", strained, { retestDay: 95 })).rule).toBe("A1");
    expect(drawAdvice(stateWith(9, "BASELINE", strained, { retestDay: 101 })).rule).toBe("A2");
  });

  it("A6 otherwise; no panel yet -> A4", () => {
    expect(drawAdvice(stateWith(10, "BASELINE", calmDays(7))).rule).toBe("A6");
    expect(drawAdvice(stateWith(10, "BASELINE", calmDays(7))).action).toBe("NO_DRAW");
    const fresh = drawAdvice(initialDrawState(0));
    expect(fresh.rule).toBe("A4");
    expect(fresh.daysSinceLastPanel).toBeNull();
    expect(fresh.kitsLeft).toBe(KITS_TOTAL);
  });
});

describe("signature T5: import and kit counters", () => {
  const panel = (crew: string, t: "R+1" | "R+45" | "R+82" | "R+194"): PanelResult => scorePanel(matrix, crew, t);

  it("importing an UNEXPECTED panel sets a re-test 3 days later (A5) with a symptom check", () => {
    const p = panel("C002", "R+45");
    expect(p.cls).toBe("UNEXPECTED_ACTIVATION");
    const r = importPanel(initialDrawState(45), p);
    expect(r.rule).toBe("A5");
    expect(r.symptomCheck).toBe(true);
    expect(r.retestDay).toBe(48);
    expect(r.state.retestDay).toBe(48);
    expect(drawAdvice({ ...r.state, today: 47 }).rule).not.toBe("A1");
    expect(drawAdvice({ ...r.state, today: 48 }).rule).toBe("A1");
  });

  it("importing an EXPECTED panel sets the first re-test of section 4.8 (C003 R+1 -> day 16)", () => {
    const r = importPanel(initialDrawState(1), panel("C003", "R+1"));
    expect(r.rule).toBeNull();
    expect(r.symptomCheck).toBe(false);
    expect(r.retestDay).toBe(16);
    expect(drawAdvice({ ...r.state, today: 15 }).rule).toBe("A6");
    expect(drawAdvice({ ...r.state, today: 16 }).rule).toBe("A1");
  });

  it("each import uses one kit and consumes a pending re-test; BASELINE / INDETERMINATE set none", () => {
    let s = initialDrawState(1);
    s = importPanel(s, panel("C003", "R+1")).state;
    expect(kitsLeft(s)).toBe(7);
    s = importPanel(s, panel("C003", "R+45")).state;
    expect(s.retestDay).toBeNull();
    expect(s.lastPanelClass).toBe("BASELINE");
    expect(kitsLeft(s)).toBe(6);
    s = importPanel(s, panel("C003", "R+82")).state;
    expect(s.retestDay).toBeNull();
    expect(kitsLeft(s)).toBe(5);
  });

  it("drawStateFromPanels derives the state from the panels up to today (kits 5 of 8 after three panels)", () => {
    const ps = (["R+1", "R+45", "R+82", "R+194"] as const).map((t) => panel("C003", t));
    const s = drawStateFromPanels(ps, 91, calmDays(7));
    expect(s.panelsImported).toBe(3);
    expect(kitsLeft(s)).toBe(5);
    expect(s.lastPanelDay).toBe(82);
    expect(s.lastPanelClass).toBe("INDETERMINATE");
    const a = drawAdvice(s);
    expect(a.rule).toBe("A6");
    expect(a.daysSinceLastPanel).toBe(9);
    // after R+194 (UNEXPECTED) the A5 re-test is due 3 days later
    const later = drawStateFromPanels(ps, 197);
    expect(later.retestDay).toBe(197);
    expect(drawAdvice(later).rule).toBe("A1");
    for (const c of REFERENCE_CREW) expect(drawStateFromPanels([panel(c, "R+1")], 1).panelsImported).toBe(1);
  });
});
