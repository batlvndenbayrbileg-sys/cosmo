import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { signatureStrings } from "@/i18n/strings/signature";
import type { Lang } from "@/lib/types";
import { batYellow } from "@/lib/fixtures/dashboard";
import { hasForbiddenWording } from "@/lib/signature/facts";
import { SIGNATURE_DATASETS, buildEvidence } from "@/lib/signature/evidence";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData } from "@/server/signature/files";
import { drawView, numberList, recoveryTimeline } from "@/components/signature/logic";
import { RecoveryCard } from "@/components/signature/RecoveryCard";
import { EvidenceCard } from "@/components/signature/EvidenceCard";
import { SignatureView } from "@/components/signature/SignatureView";
import { NAV_ITEMS, TopBar } from "@/components/dashboard/TopBar";

const view = buildSignatureView(getLabData());
const html = (el: ReactElement) => renderToStaticMarkup(el);
// the provider's props type demands `children`; React.createElement takes children as arguments
const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const mn = (el: ReactElement) => renderToStaticMarkup(createElement(Provider, { initialLang: "mn" }, el));
const textOf = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");

describe("signature T8: Recovery & next draw logic", () => {
  it("C003 timeline: 66.9 -> 12.2 -> 30.0 -> 56.6 with bands, threshold 20, decay fan after R+1, re-test day 16", () => {
    const tl = recoveryTimeline(view, "C003", "R+1");
    expect(tl.points.map((p) => p.fri)).toEqual([66.9, 12.2, 30, 56.6]);
    expect(tl.points.map((p) => p.band)).toEqual([
      [65.1, 68.2],
      [11.6, 14.2],
      [30, 34.9],
      [56.6, 57.4],
    ]);
    expect(tl.points.map((p) => p.day)).toEqual([1, 45, 82, 194]);
    expect(tl.points[0].err![0]).toBeCloseTo(1.8, 6);
    expect(tl.points[0].err![1]).toBeCloseTo(1.3, 6);
    expect(tl.threshold).toBe(20);
    expect(tl.from?.tp).toBe("R+1");
    expect(tl.recovery?.retestMissionDay).toBe(16);
    expect(tl.recovery?.halfLifeBand).toEqual([8.07, 21.47]);
    expect(tl.fan[0]).toEqual({ day: 1, fast: 66.9, slow: 66.9 });
    expect(tl.fan[tl.fan.length - 1].day).toBe(1 + Math.ceil(tl.recovery!.etaDays[1]));
    expect(tl.fan[tl.fan.length - 1].slow).toBeLessThan(20);
    for (const f of tl.fan) expect(f.fast).toBeLessThanOrEqual(f.slow);
    expect(tl.points.map((p) => p.drawn)).toEqual([true, false, false, false]);
  });

  it("the fan follows the last expected panel up to the clock; C001 re-test day 22; none for C002 R+45", () => {
    expect(recoveryTimeline(view, "C003", "R+45").from?.tp).toBe("R+1");
    expect(recoveryTimeline(view, "C001", "R+1").recovery?.retestMissionDay).toBe(22);
    const c002 = recoveryTimeline(view, "C002", "R+45");
    expect(c002.recovery).toBeNull();
    expect(c002.fan).toEqual([]);
    expect(c002.points.map((p) => p.fri)).toEqual([36.9, 53.4, 18.2, 13.3]);
  });

  it("draw advisor on the panel day: kits, rule, pending re-test (A5 after an unexpected panel)", () => {
    const c003 = drawView(view, "C003", "R+1");
    expect(c003.advice.rule).toBe("A6");
    expect([c003.advice.kitsLeft, c003.advice.kitsTotal, c003.advice.kitsSaved]).toEqual([7, 8, 0]);
    expect(c003.nextRetestDay).toBe(16);
    expect(c003.dss).toEqual([]);
    const c002 = drawView(view, "C002", "R+45");
    expect(c002.advice.kitsLeft).toBe(6);
    expect(c002.nextRetestDay).toBe(48);
    const strained = drawView(view, "C003", "R+1", [...Array(12).fill(0), 60, 70, 80, 90]);
    expect(strained.dss).toHaveLength(14);
  });

  it("formats lists of fixture numbers", () => {
    expect(numberList([-26.8, -27.3, 0.1, 20.7], true)).toBe("-26.8, -27.3, +0.1, +20.7");
    expect(numberList([0.59, 0.03, 0.54, 0.2])).toBe("0.59, 0.03, 0.54, 0.2");
  });
});

describe("signature T8: Evidence data (read from the fixture)", () => {
  const ev = buildEvidence();

  it("six markers: same direction 4/4, beyond own range 4,4,4,3,3,3, selected in 4 of 4 folds, Kim et al. coverage", () => {
    expect(ev.rows.map((r) => r.name)).toEqual(["il_6", "mcp_1", "il_10", "il_27", "glucose", "monocytes"]);
    expect(ev.rows.map((r) => `${r.direction.k}/${r.direction.n}`)).toEqual(Array(6).fill("4/4"));
    expect(ev.rows.map((r) => r.beyond.k)).toEqual([4, 4, 4, 3, 3, 3]);
    expect(ev.rows.map((r) => `${r.folds.k}/${r.folds.n}`)).toEqual(Array(6).fill("4/4"));
    expect(ev.rows.map((r) => r.kim)).toEqual([true, true, true, true, false, false]);
    expect([...ev.loco.markersInAllFolds].sort()).toEqual(ev.rows.map((r) => r.name).sort());
  });

  it("headline numbers: 3 core vs 0.83 by chance; 24 of 36 and 21 of 36 (chance 25 %); controls max 37.4", () => {
    expect(ev.core).toEqual({ observed: 3, candidates: 106, chance: 0.83, chanceIfL44Uninformative: 2.62 });
    expect([ev.loco.directionHits, ev.loco.envelopeHits, ev.loco.selections]).toEqual([24, 21, 36]);
    expect(ev.loco.chancePct).toBe(25);
    expect(ev.loco.minEffectPct).toBe(10);
    expect(ev.loco.heldoutR1).toEqual([39.5, 21.2, 38.8, 36.1]);
    expect(ev.loco.inSampleR1).toEqual([48.2, 36.9, 66.9, 36]);
    expect(ev.noise).toEqual({ n: 12, median: 8.4, max: 37.4 });
  });

  it("rejected ideas: lymphocytes, CRP, urine proxy", () => {
    expect(ev.lymphocytes.pctVsMedian).toEqual([-26.8, -27.3, 0.1, 20.7]);
    expect(ev.lymphocytes.pctVsL3).toEqual([-38.5, -46.4, -33.9, -26.9]);
    expect(ev.lymphocytes.fellVsMedian).toBe(2);
    expect(ev.lymphocytes.l3Highest).toBe(4);
    expect(ev.crp.zR1).toEqual([0.59, 0.03, 0.54, 0.2]);
    expect(ev.crp.insideOwnRange).toBe(3);
    expect(ev.urine).toEqual({ beyondOwnRange: 1, crewWithR1: 3 });
  });

  it("QC log with old -> new values, the haptoglobin exclusion and the L-44 batch check", () => {
    expect(ev.qc).toHaveLength(12);
    expect(ev.qc[0]).toEqual({ id: "QC-1", crew: "C003", timepoint: "L-92", analyte: "absolute_neutrophils", old: 10.1, new: 6826 });
    expect(ev.qc.filter((q) => q.id === "QC-2").map((q) => [q.crew, q.old])).toEqual([
      ["C002", 44],
      ["C003", 36],
      ["C004", 43],
    ]);
    expect(ev.haptoglobinExcluded).toBe(true);
    expect(ev.l44).toEqual([
      { kind: "cardio", lowest: 28, n: 35, sharePct: 80 },
      { kind: "immune", lowest: 187, n: 279, sharePct: 67 },
    ]);
    expect(ev.l44ChancePct).toBe(33);
  });
});

describe("signature T8: cards (server render smoke tests)", () => {
  it("Recovery card C003 R+1: the four panels, threshold, re-test day 16, rule, kit chips, caption", () => {
    const out = textOf(html(createElement(RecoveryCard, { view, crew: "C003", timepoint: "R+1" })));
    for (const v of ["66.9", "12.2", "30.0", "56.6", "65.1–68.2", "56.6–57.4"]) expect(out).toContain(v);
    expect(out).toContain("re-test day 16");
    expect(out).toContain("baseline zone below 20");
    expect(out).toContain("back in the baseline zone within 14–37 days (upper bounds); first re-test on day 16.");
    expect(out).toContain("Rule A6");
    expect(out).toContain("No draw needed");
    expect(out).toContain("Next re-test: day 16");
    expect(out).toContain("7 of 8 kits left");
    expect(out).toContain("0 saved");
    expect(out).toContain("Upper bounds from 3 crew; Inspiration4 has no sample between day 1 and day 45.");
    expect(out).toContain("No daily check-ins are linked to this reference panel");
  });

  it("Recovery card with simulated check-ins shows the strain sparkline and the banner", () => {
    const dss = [...Array(11).fill(5), 55, 60, 90];
    const out = html(createElement(RecoveryCard, { view, crew: "C003", timepoint: "R+1", dss, simulated: true }));
    expect(out).toContain("Simulated check-ins");
    expect(out).toContain("Daily strain score, last 14 days");
    expect(out).not.toContain("No daily check-ins are linked");
  });

  it("Recovery card C002 R+45 has no decay fan and a pending re-test on day 48", () => {
    const out = textOf(html(createElement(RecoveryCard, { view, crew: "C002", timepoint: "R+45" })));
    expect(out).toContain("No decay estimate");
    expect(out).toContain("Next re-test: day 48");
    expect(out).toContain("6 of 8 kits left");
  });

  it("Evidence card: 24 of 36, 21 of 36 (chance 25 %), 4 of 4 folds for all six, rejected ideas, QC log, DOIs", () => {
    const out = textOf(html(createElement(EvidenceCard)));
    expect(out).toContain("24 of 36");
    expect(out).toContain("21 of 36 (chance 25 %)");
    expect(out.match(/selected in 4 of 4 folds/g)).toHaveLength(6);
    expect(out).toContain("Tested and rejected");
    expect(out).toContain("Lymphocytes: against the own pre-flight median -26.8, -27.3, +0.1, +20.7 %");
    expect(out).toContain("CRP: z at R+1 0.59, 0.03, 0.54, 0.2; inside the own pre-flight range in 3 of 4.");
    expect(out).toContain("urine IL-6 beyond the own range in 1 of 3 crew");
    expect(out).toContain("Data-quality log");
    expect(out).toContain("QC-1 C003 L-92 absolute_neutrophils: 10.1 → 6826");
    expect(out).toContain("QC-1 C003 L-92 absolute_lymphocytes: 6826 → 1997");
    expect(out).toContain("QC-1 C003 L-92 mchc: 29.6 → removed");
    expect(out).toContain("QC-2 C002 R+45 glucose: 44 → removed");
    expect(out).toContain("28 of 35 cardiovascular series (80 %) and 187 of 279 immune series (67 %); chance 33 %");
    for (const d of ["10.26030/e0rx-sh52", "10.26030/mc5d-p710", "10.26030/7cax-yj10"]) expect(out).toContain(d);
    expect(out).toContain("n = 4, descriptive only.");
    expect(out).toContain("max 37.4");
    expect(out).toContain("Held-out index at R+1: 39.5, 21.2, 38.8, 36.1; with all four crew: 48.2, 36.9, 66.9, 36.0.");
    expect(out).toContain("not covered");
  });

  it("Evidence card renders in Mongolian", () => {
    const out = textOf(mn(createElement(EvidenceCard)));
    expect(out).toContain("Шалгаад татгалзсан");
    expect(out).toContain("36-аас 24");
  });

  it("the page shows all four cards; the dashboard top bar links to it for the linked reference crew member", () => {
    const page = html(createElement(SignatureView, { data: view, initialCrew: "C003", initialTimepoint: "R+1" }));
    for (const slot of ["signature-triage", "signature-fingerprint", "signature-recovery", "signature-evidence"]) {
      expect(page).toContain(`data-slot="${slot}"`);
    }
    expect(NAV_ITEMS).toHaveLength(6);
    const bar = html(createElement(TopBar, { payload: batYellow, viewer: "crew", active: "overview", onNavigate: () => {} }));
    expect(bar).toContain(`href="/signature?crew=C001&amp;checkInId=${encodeURIComponent(batYellow.checkIn.id)}"`);
    expect(bar).toContain('aria-label="Signature Triage: blood panels"');
  });
});

describe("signature T8: wording and hard-coded numbers", () => {
  it("no forbidden wording on the Recovery and Evidence cards, both languages, every crew and panel", () => {
    for (const c of view.crew) {
      for (const tp of view.timepoints) {
        const el = createElement(RecoveryCard, { view, crew: c, timepoint: tp });
        expect(hasForbiddenWording(textOf(html(el))), `${c} ${tp}`).toBe(false);
        expect(hasForbiddenWording(textOf(mn(el))), `${c} ${tp} mn`).toBe(false);
      }
    }
    expect(hasForbiddenWording(textOf(html(createElement(EvidenceCard))))).toBe(false);
    expect(hasForbiddenWording(textOf(mn(createElement(EvidenceCard))))).toBe(false);
    for (const lang of ["en", "mn"] as const) {
      for (const [k, text] of Object.entries(signatureStrings[lang])) expect(hasForbiddenWording(text), `${lang} ${k}`).toBe(false);
    }
  });

  it("evidence numbers are not hard-coded in the cards", () => {
    const dir = path.join(process.cwd(), "src", "components", "signature");
    for (const f of ["RecoveryCard.tsx", "EvidenceCard.tsx"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      for (const n of ["37.4", "0.83", "6826", "8.07", "21.47", "26.8", "0.59", ...SIGNATURE_DATASETS.map((d) => d.doi)]) {
        expect(src.includes(n), `${f} ${n}`).toBe(false);
      }
    }
  });
});
