import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { signatureStrings } from "@/i18n/strings/signature";
import type { Lang } from "@/lib/types";
import { POST_TIMEPOINTS, REFERENCE_CREW, UNEXPECTED_RETEST_DAYS } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import {
  ACTIONS,
  SECOND_ASSAY_ACTIONS,
  SIGNATURE_DISCLAIMER,
  actionsFor,
  assertNumbersGrounded,
  buildFacts,
  hasDisclaimer,
  hasForbiddenWording,
  type SignatureFacts,
} from "@/lib/signature/facts";
import { buildSecondAssayEvidence } from "@/lib/signature/evidence";
import { scorePanelWithSecondAssay } from "@/lib/signature/secondAssay";
import { importPanel, initialDrawState } from "@/lib/signature/strain";
import { renderTriageTemplate, triageSituation } from "@/lib/signature/templates";
import type { PanelResult } from "@/lib/signature/types";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData, loadSecondAssay, tryLoadSecondAssay } from "@/server/signature/files";
import { triageFactsFor } from "@/server/agent/signature";
import { isSingleAssayMarker, panelOf, secondAssayBadgeView } from "@/components/signature/logic";
import { TriageCard } from "@/components/signature/TriageCard";
import { FingerprintCard } from "@/components/signature/FingerprintCard";
import { EvidenceCard } from "@/components/signature/EvidenceCard";
import { SignatureView } from "@/components/signature/SignatureView";

const lab = getLabData();
const second = loadSecondAssay().matrix;
const panels: Record<string, PanelResult> = {};
for (const c of REFERENCE_CREW) for (const t of POST_TIMEPOINTS) panels[`${c}_${t}`] = scorePanelWithSecondAssay(lab.matrix, second, c, t);
const ids = Object.keys(panels);

function previousOf(id: string): PanelResult | null {
  const [crew, tp] = id.split("_");
  const i = POST_TIMEPOINTS.indexOf(tp as (typeof POST_TIMEPOINTS)[number]);
  return i > 0 ? panels[`${crew}_${POST_TIMEPOINTS[i - 1]}`] : null;
}
const facts = (id: string, lang: Lang = "en"): SignatureFacts => buildFacts(panels[id], { lang, previous: previousOf(id), qcLog: lab.qcLog });

/** the EN / MN dialogue of one addendum section 4 situation, line wraps joined */
function addendumDialogue(label: string): { en: string; mn: string } {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "SIGNATURE_ADDENDUM_SECOND_ASSAY.md"), "utf8").replace(/\r\n/g, "\n");
  const at = doc.indexOf(`**(${label})`);
  expect(at, label).toBeGreaterThan(0);
  const block = doc.slice(at);
  const en = /EN: "([\s\S]*?)"\n\nMN:/u.exec(block)?.[1];
  const mn = /MN: "([\s\S]*?)"\n/u.exec(block)?.[1];
  const flat = (s: string | undefined) => (s ?? "").replace(/\s+/gu, " ").trim();
  return { en: flat(en), mn: flat(mn) };
}

const view = buildSignatureView(lab, second);
const html = (el: ReactElement) => renderToStaticMarkup(el);
const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const mn = (el: ReactElement) => renderToStaticMarkup(createElement(Provider, { initialLang: "mn" }, el));
const textOf = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");

describe("signature T13: templates (addendum section 4, verbatim)", () => {
  it("(a) for C001 R+1 contains 48, 40, 60, 2.4, 21 and passes the number guard; EN and MN equal the addendum", () => {
    const want = addendumDialogue("a");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C001_R+1", lang);
      expect(f.secondAssay?.badge).toBe("TWO_ASSAY_CONFIRMED");
      expect(triageSituation(f)).toBe("a");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(want[lang]);
      for (const n of ["48", "40", "60", "2.4", "21"]) expect(text, `${lang} ${n}`).toContain(n);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
      expect(hasDisclaimer(text, lang), lang).toBe(true);
    }
  });

  it("(c1) for C001 R+45 equals the addendum (index 1, down from 48, IL-6 below the pre-flight baseline)", () => {
    const want = addendumDialogue("c1");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C001_R+45", lang);
      expect(triageSituation(f)).toBe("c1");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(want[lang]);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
    }
  });

  it("(c2) for C002 R+45 contains 37, 53, 47, 40, 3; EN and MN equal the addendum", () => {
    const want = addendumDialogue("c2");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C002_R+45", lang);
      expect(triageSituation(f)).toBe("c2");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(want[lang]);
      for (const n of ["37", "53", "47", "40", "3"]) expect(text, `${lang} ${n}`).toContain(n);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
      expect(hasDisclaimer(text, lang), lang).toBe(true);
    }
  });

  it("(d) for C003 R+194 contains 57, 2.2, 3 and not the words 'flight surgeon'; EN and MN equal the addendum", () => {
    const want = addendumDialogue("d");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C003_R+194", lang);
      expect(f.secondAssay?.badge).toBe("SINGLE_ASSAY");
      expect(triageSituation(f)).toBe("d");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(want[lang]);
      for (const n of ["57", "2.2", "3"]) expect(text, `${lang} ${n}`).toContain(n);
      expect(text.toLowerCase()).not.toContain("flight surgeon");
      expect(text).not.toContain("нислэгийн эмч");
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
      expect(hasDisclaimer(text, lang), lang).toBe(true);
    }
  });

  it("template choice: UNEXPECTED + SINGLE_ASSAY -> (d), UNEXPECTED + TWO_ASSAY_CONFIRMED -> (c2); without the second assay the spec dialogue", () => {
    expect(triageSituation(facts("C003_R+194"))).toBe("d");
    expect(triageSituation(facts("C002_R+45"))).toBe("c2");
    // EXPECTED + SINGLE_ASSAY (C003 R+1): the (a) shape plus "only one of two tests shows this"
    const c003 = renderTriageTemplate(facts("C003_R+1"));
    expect(triageSituation(facts("C003_R+1"))).toBe("a");
    expect(c003).toContain("IL-6 is about 2.8 times your baseline, but only one of two tests shows this.");
    expect(renderTriageTemplate(facts("C003_R+1", "mn"), "mn")).toContain("хоёр шинжилгээний зөвхөн нэг нь үүнийг харуулж байна");
    // a panel scored without the second assay: spec section 7.1 (a) for C003 R+1, unchanged
    const plain = buildFacts(scorePanel(lab.matrix, "C003", "R+1"), { lang: "en", qcLog: lab.qcLog });
    expect(plain.secondAssay).toBeNull();
    expect(renderTriageTemplate(plain)).toContain("IL-6 and MCP-1 are about 2.8 times your baseline.");
  });

  it("C001 first re-test offset is 21 (mission day 22)", () => {
    const f = facts("C001_R+1");
    expect(f.recovery?.retestInDays).toBe("21");
    expect(f.recovery?.retestDay).toBe("22");
  });

  it("every panel with the second assay renders in both languages: grounded numbers, disclaimer last, no forbidden wording", () => {
    for (const id of ids) {
      for (const lang of ["en", "mn"] as const) {
        const f = facts(id, lang);
        const text = renderTriageTemplate(f, lang);
        expect(assertNumbersGrounded(text, f), `${id} ${lang}: ${text}`).toBe(true);
        expect(hasDisclaimer(text, lang), `${id} ${lang}`).toBe(true);
        expect(hasForbiddenWording(text), `${id} ${lang}: ${text}`).toBe(false);
        expect(text, `${id} ${lang}`).not.toMatch(/undefined|null|NaN|\{|\}/);
        expect(text.split(SIGNATURE_DISCLAIMER.en).join("").split(SIGNATURE_DISCLAIMER.mn).join("")).not.toMatch(/diagnos|онош/iu);
      }
    }
  });
});

describe("signature T13: actions and draw advisor A5", () => {
  it("actions per addendum section 2", () => {
    expect(facts("C002_R+45").actions).toEqual(ACTIONS.UNEXPECTED_ACTIVATION.en);
    expect(facts("C003_R+194").actions).toEqual(["repeat the measurement in 3 days", "no escalation until a second measurement agrees"]);
    expect(facts("C003_R+194", "mn").actions).toEqual(SECOND_ASSAY_ACTIONS.unexpectedSingle.mn);
    expect(facts("C003_R+1").actions).toEqual([...ACTIONS.EXPECTED_FLIGHT_RESPONSE.en, "only one of two tests shows this"]);
    expect(facts("C001_R+1").actions).toEqual(ACTIONS.EXPECTED_FLIGHT_RESPONSE.en);
    expect(facts("C001_R+45").actions).toEqual(ACTIONS.BASELINE.en);
    expect(actionsFor("UNEXPECTED_ACTIVATION", null, "en")).toEqual(ACTIONS.UNEXPECTED_ACTIVATION.en);
    for (const lang of ["en", "mn"] as const) {
      for (const a of [...SECOND_ASSAY_ACTIONS.unexpectedSingle[lang], SECOND_ASSAY_ACTIONS.singleAssayNote[lang]]) {
        expect(hasForbiddenWording(a), a).toBe(false);
      }
    }
  });

  it("A5: re-test in 3 days for both badges; escalation flag only when TWO_ASSAY_CONFIRMED", () => {
    const confirmed = importPanel(initialDrawState(45), panels["C002_R+45"]);
    expect([confirmed.rule, confirmed.retestDay, confirmed.escalate, confirmed.symptomCheck]).toEqual(["A5", 45 + UNEXPECTED_RETEST_DAYS, true, true]);
    const single = importPanel(initialDrawState(194), panels["C003_R+194"]);
    expect([single.rule, single.retestDay, single.escalate, single.symptomCheck]).toEqual(["A5", 194 + UNEXPECTED_RETEST_DAYS, false, false]);
    // without the second assay the spec rule is unchanged (every UNEXPECTED panel escalates)
    const plain = importPanel(initialDrawState(194), scorePanel(lab.matrix, "C003", "R+194"));
    expect([plain.rule, plain.escalate, plain.symptomCheck]).toEqual(["A5", true, true]);
    const expected = importPanel(initialDrawState(1), panels["C001_R+1"]);
    expect([expected.rule, expected.escalate, expected.retestDay]).toEqual([null, false, 22]);
  });

  it("Cosmo's facts carry the two-key check (the server scores with the second assay)", () => {
    expect(tryLoadSecondAssay()).not.toBeNull();
    const f = triageFactsFor("bat", "en", { timepoint: "R+1" })!;
    expect(f.crew).toBe("C001");
    expect(f.secondAssay?.badge).toBe("TWO_ASSAY_CONFIRMED");
    expect(renderTriageTemplate(f, "en")).toBe(addendumDialogue("a").en);
    expect(triageFactsFor("C003", "en", { timepoint: "R+194" })?.secondAssay?.badge).toBe("SINGLE_ASSAY");
  });
});

describe("signature T13: cards", () => {
  it("Triage card badge: 'Confirmed by two assays' (teal outline) or 'Single assay' (amber outline), tooltip with the two IL-6 folds", () => {
    const c001 = secondAssayBadgeView(panelOf(view, "C001", "R+1"), "en")!;
    expect(c001).toMatchObject({ badge: "TWO_ASSAY_CONFIRMED", tone: "teal", label: "Confirmed by two assays" });
    expect(c001.tooltip).toContain("x2.39");
    expect(c001.tooltip).toContain("x1.46");
    const c003 = secondAssayBadgeView(panelOf(view, "C003", "R+194"), "en")!;
    expect(c003).toMatchObject({ badge: "SINGLE_ASSAY", tone: "amber", label: "Single assay" });
    expect(c003.tooltip).toContain("x2.16");
    expect(c003.tooltip).toContain("x0.54");
    expect(secondAssayBadgeView(panelOf(view, "C002", "R+1"), "en")).toBeNull();
    expect(secondAssayBadgeView(scorePanel(lab.matrix, "C001", "R+1"), "en")).toBeNull();

    const out = html(createElement(TriageCard, { panel: panelOf(view, "C001", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }));
    expect(out).toContain('data-badge="TWO_ASSAY_CONFIRMED"');
    expect(out).toContain(">Confirmed by two assays<");
    expect(out).toContain("Expected flight response");
    const single = html(createElement(TriageCard, { panel: panelOf(view, "C003", "R+194"), timepoints: view.timepoints, onTimepoint: () => {} }));
    expect(single).toContain(">Single assay<");
    expect(mn(createElement(TriageCard, { panel: panelOf(view, "C002", "R+45"), timepoints: view.timepoints, onTimepoint: () => {} }))).toContain(
      "Хоёр шинжилгээгээр батлагдсан",
    );
  });

  it("Fingerprint card: 'single-assay marker' tag on MCP-1, IL-10, IL-27 only", () => {
    expect(["il_6", "mcp_1", "il_10", "il_27", "glucose", "monocytes"].filter(isSingleAssayMarker)).toEqual(["mcp_1", "il_10", "il_27"]);
    const out = textOf(html(createElement(FingerprintCard, { view, panel: panelOf(view, "C001", "R+1") })));
    for (const m of ["MCP-1", "IL-10", "IL-27"]) expect(out).toMatch(new RegExp(`${m}\\s+· single-assay marker`));
    expect(out).not.toMatch(/IL-6\s+· single-assay marker/);
    expect(out).toContain("Single-assay markers: MCP-1, IL-10, IL-27.");
    // a panel scored without the second assay shows no tag
    const plain = buildSignatureView(lab);
    expect(textOf(html(createElement(FingerprintCard, { view: plain, panel: panelOf(plain, "C001", "R+1") })))).not.toContain("single-assay marker");
  });

  it("Evidence card: 'Second assay' column and the headline from the second fixture", () => {
    const sa = buildSecondAssayEvidence();
    expect(sa.rows.map((r) => [r.name, r.kind, r.rho])).toEqual([
      ["il_6", "agrees", 0.65],
      ["mcp_1", "not_confirmed", 0.37],
      ["il_10", "not_confirmed", -0.02],
      ["il_27", "not_confirmed", -0.12],
      ["glucose", "clinical", null],
      ["monocytes", "clinical", null],
    ]);
    expect([sa.matchedPairs, sa.medianRho, sa.pairsAtGoodRho]).toEqual([55, 0.09, 4]);
    expect(sa.sameDirectionBoth).toEqual(["il_6"]);
    expect(sa.l44).toEqual({ lowest: 109, n: 609, sharePct: 18 });
    expect(sa.il6Panels).toEqual({ sameSign: 13, n: 16, spearman: 0.63 });

    const out = textOf(html(createElement(EvidenceCard)));
    expect(out).toContain("Second assay");
    expect(out).toContain("agrees, 0.65");
    expect(out).toContain("not confirmed (0.37)");
    expect(out).toContain("not confirmed (-0.02)");
    expect(out).toContain("not confirmed (-0.12)");
    expect(out.match(/single clinical method/g)).toHaveLength(2);
    expect(out).toContain("55 proteins measured twice: typical agreement 0.09");
    expect(out).toContain("Same direction in all crew at R+1 on both assays: IL-6.");
    expect(out).toContain("same sign on both in 13, rank correlation 0.63");
    expect(out).toContain("L-44 is the lowest pre-flight draw in 109 of 609 series (18 %)");
    const outMn = textOf(mn(createElement(EvidenceCard)));
    expect(outMn).toContain("55 уургийг хоёр удаа хэмжсэн: ердийн тохирол 0.09");
    expect(outMn).toContain("609 цувралаас 109-д (18 %)");
  });

  it("the second-assay numbers are not hard-coded in the cards", () => {
    const dir = path.join(process.cwd(), "src", "components", "signature");
    for (const f of ["TriageCard.tsx", "FingerprintCard.tsx", "EvidenceCard.tsx"]) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const n of ["0.65", "0.09", "0.37", "109", "609", "2.39", "1.46", "40.11"]) expect(src.includes(n), `${f} ${n}`).toBe(false);
    }
  });

  it("new strings exist in both languages; no forbidden wording on any page with the second assay, both languages", () => {
    const keys = Object.keys(signatureStrings.en).filter((k) => /\.sa\.|singleAssay|col\.second|l44second/.test(k));
    expect(keys).toHaveLength(14);
    for (const k of keys) {
      expect(signatureStrings.mn[k], k).toBeTruthy();
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(signatureStrings.mn[k]), k).toEqual(vars(signatureStrings.en[k]));
    }
    for (const c of view.crew) {
      for (const tp of view.timepoints) {
        const page = createElement(SignatureView, { data: view, initialCrew: c, initialTimepoint: tp });
        expect(hasForbiddenWording(textOf(html(page))), `${c} ${tp} en`).toBe(false);
        expect(hasForbiddenWording(textOf(mn(page))), `${c} ${tp} mn`).toBe(false);
      }
    }
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
