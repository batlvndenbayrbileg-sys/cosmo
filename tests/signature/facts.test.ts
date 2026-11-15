import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/lib/types";
import { POST_TIMEPOINTS, REFERENCE_CREW } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import {
  ACTIONS,
  SIGNATURE_DISCLAIMER,
  assertNumbersGrounded,
  buildDrawFacts,
  buildFacts,
  hasDisclaimer,
  hasForbiddenWording,
  markerLabel,
  numbersIn,
  spokenFold,
  type SignatureFacts,
} from "@/lib/signature/facts";
import { drawAdvice, initialDrawState, type DrawRule, type DrawState } from "@/lib/signature/strain";
import {
  mnAbl,
  mnInst,
  renderDrawTemplate,
  renderTriageOffer,
  renderTriageTemplate,
  triageSituation,
} from "@/lib/signature/templates";
import type { PanelResult } from "@/lib/signature/types";
import { getLabData } from "@/server/signature/files";

const { matrix, qcLog } = getLabData();
const panels: Record<string, PanelResult> = {};
for (const c of REFERENCE_CREW) for (const t of POST_TIMEPOINTS) panels[`${c}_${t}`] = scorePanel(matrix, c, t);

function previousOf(id: string): PanelResult | null {
  const [crew, tp] = id.split("_");
  const i = POST_TIMEPOINTS.indexOf(tp as (typeof POST_TIMEPOINTS)[number]);
  return i > 0 ? panels[`${crew}_${POST_TIMEPOINTS[i - 1]}`] : null;
}
const facts = (id: string, lang: Lang = "en"): SignatureFacts =>
  buildFacts(panels[id], { lang, previous: previousOf(id), qcLog });

/** the EN / MN dialogue of one spec section 7.1 situation, line wraps joined */
function specDialogue(label: string): { en: string; mn: string } {
  const spec = fs.readFileSync(path.join(process.cwd(), "docs", "SIGNATURE_SPEC.md"), "utf8").replace(/\r\n/g, "\n");
  const at = spec.indexOf(`**(${label})`);
  expect(at, label).toBeGreaterThan(0);
  const block = spec.slice(at);
  const en = /EN: "([\s\S]*?)"\n\nMN:/u.exec(block)?.[1];
  const mn = /MN: "([\s\S]*?)"\n/u.exec(block)?.[1];
  const flat = (s: string | undefined) => (s ?? "").replace(/\s+/gu, " ").trim();
  return { en: flat(en), mn: flat(mn) };
}

/** the A2 state of spec (b): 3 strained days, last panel 9 days ago, 3 of 8 kits used */
function a2State(): DrawState {
  return { ...initialDrawState(100), lastPanelDay: 91, lastPanelClass: "BASELINE", panelsImported: 3, dss: [0, 0, 90, 90, 90] };
}

describe("signature T6: buildFacts", () => {
  it("C003 R+1: class, FRI 67, band 65-68, IL-6 and MCP-1 x2.8, re-test in 15 days (mission day 16)", () => {
    const f = facts("C003_R+1");
    expect(f.class).toBe("EXPECTED_FLIGHT_RESPONSE");
    expect(f.fri).toBe("67");
    expect(f.band).toEqual(["65", "68"]);
    expect(f.borderline).toBe(false);
    expect(f.topMarkers.map((m) => [m.marker, m.foldRounded])).toEqual([
      ["IL-6", "2.8"],
      ["MCP-1", "2.8"],
    ]);
    expect(f.previousFri).toBeNull();
    expect(f.reference).toEqual({ crewSameDirection: "4 of 4", crewBackByDay45: "3 of 4" });
    expect(f.recovery).toEqual({ etaDays: ["14", "37"], retestInDays: "15", retestDay: "16" });
    expect(f.otherLargeChanges.map((o) => [o.marker, o.foldRounded])).toEqual([
      ["IL-13", "8.0"],
      ["IL-22", "4.0"],
    ]);
    expect(f.qcNotes).toEqual([]);
    expect(f.actions).toEqual(ACTIONS.EXPECTED_FLIGHT_RESPONSE.en);
    expect(f.disclaimer).toBe("Decision support, not a diagnosis.");
    expect(f.source).toMatch(/Inspiration4/);
  });

  it("allowedNumbers: integers for FRI and band, one decimal for folds, the fixed 100 / 45, every number in the facts", () => {
    const f = facts("C003_R+1");
    for (const n of ["67", "65", "68", "2.8", "15", "16", "14", "37", "100", "45", "1", "8.0", "4.0"]) {
      expect(f.allowedNumbers, n).toContain(n);
    }
    expect(f.allowedNumbers).not.toContain("66.9");
    expect(f.allowedNumbers).not.toContain("72");
    // every digit sequence in the facts JSON (outside names such as IL-6 or C003) is allowed
    const { allowedNumbers, ...rest } = f;
    expect(assertNumbersGrounded(JSON.stringify(rest), { allowedNumbers })).toBe(true);
  });

  it("C002 R+45: previous FRI 37, IL-6 x2.7 leads, IL-8 x47 the one other large change, re-test in 3 days", () => {
    const f = facts("C002_R+45");
    expect(f.class).toBe("UNEXPECTED_ACTIVATION");
    expect([f.fri, f.previousFri, f.daysSinceLanding]).toEqual(["53", "37", "45"]);
    expect(f.topMarkers[0]).toMatchObject({ marker: "IL-6", foldRounded: "2.7" });
    expect(f.otherLargeChanges).toEqual([{ marker: "IL-8", foldRounded: "47" }]);
    expect(f.unexpectedRetestInDays).toBe("3");
    expect(f.recovery).toBeNull();
    expect(f.actions).toEqual(ACTIONS.UNEXPECTED_ACTIVATION.en);
  });

  it("C003 R+45: QC note for the removed glucose (both languages), IL-6 fold 0.5", () => {
    expect(facts("C003_R+45").qcNotes).toEqual(["the glucose value in this sample failed a quality check and was left out"]);
    expect(facts("C003_R+45", "mn").qcNotes[0]).toMatch(/глюкоз/);
    expect(facts("C003_R+45").leadMarker?.foldRounded).toBe("0.5");
    expect(facts("C001_R+45").qcNotes).toEqual([]);
  });

  it("a panel with too few markers: fri and band null, class INSUFFICIENT, the generic template", () => {
    const p: PanelResult = { ...panels["C003_R+1"], fri: null, band: null, cls: "INSUFFICIENT", borderline: false };
    const f = buildFacts(p, { lang: "en" });
    expect([f.fri, f.band, f.recovery]).toEqual([null, null, null]);
    expect(triageSituation(f)).toBe("other");
    expect(renderTriageTemplate(f)).toMatch(/too few of the six markers/);
  });

  it("spoken formats: folds one decimal (>= 10 an integer), marker labels", () => {
    expect(spokenFold(2.8464)).toBe("2.8");
    expect(spokenFold(0.4944)).toBe("0.5");
    expect(spokenFold(47.04)).toBe("47");
    expect(markerLabel("il_6")).toBe("IL-6");
    expect(markerLabel("mcp_1")).toBe("MCP-1");
    expect(markerLabel("il_28a")).toBe("IL-28A");
    expect(markerLabel("glucose")).toBe("glucose");
  });
});

describe("signature T6: templates (spec section 7.1, verbatim)", () => {
  it("(a) for C003 R+1 contains 67, 65, 68, 2.8, 15 and passes the guard; EN and MN equal the spec", () => {
    const spec = specDialogue("a");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C003_R+1", lang);
      expect(triageSituation(f)).toBe("a");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(spec[lang]);
      for (const n of ["67", "65", "68", "2.8", "15"]) expect(text, `${lang} ${n}`).toContain(n);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
      expect(hasDisclaimer(text, lang), lang).toBe(true);
    }
  });

  it("(c2) for C002 R+45 contains 37, 53, 2.7, 47, 3 and passes the guard; EN and MN equal the spec", () => {
    const spec = specDialogue("c2");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C002_R+45", lang);
      expect(triageSituation(f)).toBe("c2");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(spec[lang]);
      for (const n of ["37", "53", "2.7", "47", "3"]) expect(text, `${lang} ${n}`).toContain(n);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
      expect(hasDisclaimer(text, lang), lang).toBe(true);
    }
  });

  it("(c1) for C003 R+45 equals the spec (index 12 down from 67, IL-6 about half, glucose QC note)", () => {
    const spec = specDialogue("c1");
    for (const lang of ["en", "mn"] as const) {
      const f = facts("C003_R+45", lang);
      expect(triageSituation(f)).toBe("c1");
      const text = renderTriageTemplate(f, lang);
      expect(text, lang).toBe(spec[lang]);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
    }
  });

  it("(b) rule A2 equals the spec: strain above 50 for three days, about 5 hours, 8 beats above usual, 9 days, 5 of 8 kits", () => {
    const spec = specDialogue("b");
    const advice = drawAdvice(a2State());
    expect(advice.rule).toBe("A2");
    for (const lang of ["en", "mn"] as const) {
      // T5 test vector: resting HR history 58 / 59 (median 58.5), today 66 -> 7.5 -> "8"; sleep 5.0 -> "5"
      const f = buildDrawFacts(advice, { lang, crew: "C001", sleepHours: 5.0, restingHr: 66, restingHrUsual: 58.5 });
      expect([f.daysSinceLastPanel, f.kitsLeft, f.kitsTotal, f.sleepHours, f.restingHrAboveUsual]).toEqual(["9", "5", "8", "5", "8"]);
      const text = renderDrawTemplate(f, lang);
      expect(text, lang).toBe(spec[lang]);
      expect(assertNumbersGrounded(text, f), lang).toBe(true);
      expect(hasDisclaimer(text, lang), lang).toBe(true);
    }
  });

  it("every panel and every draw rule renders in both languages with grounded numbers and the disclaimer last", () => {
    for (const id of Object.keys(panels)) {
      for (const lang of ["en", "mn"] as const) {
        const f = facts(id, lang);
        const text = renderTriageTemplate(f, lang);
        expect(assertNumbersGrounded(text, f), `${id} ${lang}: ${text}`).toBe(true);
        expect(hasDisclaimer(text, lang), `${id} ${lang}`).toBe(true);
        expect(text, `${id} ${lang}`).not.toMatch(/undefined|null|NaN|\{|\}/);
      }
    }
    const states: Record<DrawRule, DrawState> = {
      A1: { ...a2State(), retestDay: 98, dss: [] },
      A2: a2State(),
      A3: { ...a2State(), lastPanelDay: 69, dss: [0, 0, 0, 0, 0, 0, 0] },
      A4: { ...initialDrawState(100) },
      A6: { ...a2State(), dss: [0] },
    };
    for (const [rule, state] of Object.entries(states)) {
      const advice = drawAdvice(state);
      expect(advice.rule).toBe(rule);
      for (const lang of ["en", "mn"] as const) {
        const f = buildDrawFacts(advice, { lang, crew: "C001" });
        const text = renderDrawTemplate(f, lang);
        expect(assertNumbersGrounded(text, f), `${rule} ${lang}: ${text}`).toBe(true);
        expect(hasDisclaimer(text, lang), `${rule} ${lang}`).toBe(true);
      }
    }
  });

  it("no forbidden wording (build rule 6) in any template, both languages", () => {
    const texts: string[] = [];
    for (const id of Object.keys(panels)) for (const lang of ["en", "mn"] as const) texts.push(renderTriageTemplate(facts(id, lang), lang));
    for (const state of [a2State(), { ...a2State(), retestDay: 98 }, { ...a2State(), lastPanelDay: 69, dss: [0, 0, 0, 0, 0, 0, 0] }, initialDrawState(5), { ...a2State(), dss: [0] }]) {
      for (const lang of ["en", "mn"] as const) {
        texts.push(renderDrawTemplate(buildDrawFacts(drawAdvice(state), { lang, crew: "C001", sleepHours: 5, restingHr: 66, restingHrUsual: 58 }), lang));
      }
    }
    for (const lang of ["en", "mn"] as const) {
      texts.push(renderTriageOffer("C001", lang));
      for (const cls of Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>) texts.push(...ACTIONS[cls][lang]);
    }
    expect(texts.length).toBeGreaterThan(60);
    for (const t of texts) {
      expect(hasForbiddenWording(t), t).toBe(false);
      expect(t.toLowerCase()).not.toMatch(/immune suppression|metabolic stress|recovers in 45 days|abnormal/);
      // "diagnosis" only inside the fixed disclaimer line
      expect(t.split(SIGNATURE_DISCLAIMER.en).join("").split(SIGNATURE_DISCLAIMER.mn).join("")).not.toMatch(/diagnos|онош/iu);
    }
  });

  it("hasForbiddenWording catches the build-rule-6 phrases and 'normal' as a verdict, allows 'normal fluids'", () => {
    expect(hasForbiddenWording("This shows immune suppression.")).toBe(true);
    expect(hasForbiddenWording("Some metabolic stress here.")).toBe(true);
    expect(hasForbiddenWording("You recovers in 45 days.")).toBe(true);
    expect(hasForbiddenWording("Your panel is normal.")).toBe(true);
    expect(hasForbiddenWording("This is abnormal.")).toBe(true);
    expect(hasForbiddenWording("This looks like a diagnosis of something.")).toBe(true);
    expect(hasForbiddenWording("Таны шинжилгээ хэвийн байна.")).toBe(true);
    expect(hasForbiddenWording("Drink normal fluids. Decision support, not a diagnosis.")).toBe(false);
  });

  it("Mongolian case endings after numerals follow the spec examples", () => {
    expect(["100", "67", "65", "37", "8", "48", "40", "53"].map(mnAbl)).toEqual([
      "100-аас",
      "67-оос",
      "65-аас",
      "37-оос",
      "8-аас",
      "48-аас",
      "40-өөс",
      "53-аас",
    ]);
    expect(mnInst("8")).toBe("8-аар");
    expect(mnInst("2")).toBe("2-оор");
  });
});

describe("signature T6: assertNumbersGrounded", () => {
  const f = facts("C003_R+1");

  it("a text containing 72 for C003 R+1 fails the guard", () => {
    expect(assertNumbersGrounded("Your index is 72 out of 100. Decision support, not a diagnosis.", f)).toBe(false);
    expect(assertNumbersGrounded("Your index is 67 out of 100, range 65 to 68. Decision support, not a diagnosis.", f)).toBe(true);
  });

  it("removes the known tokens (IL-6, IL-8, IL-10, IL-27, MCP-1, Inspiration4) before extracting numbers", () => {
    expect(numbersIn("IL-6, IL-8, IL-10, IL-27 and MCP-1 in the Inspiration4 crew")).toEqual([]);
    expect(numbersIn("IL-6 is 2.8 times, index 67")).toEqual(["2.8", "67"]);
    expect(numbersIn("about 2,8 times")).toEqual(["2.8"]);
    expect(assertNumbersGrounded("IL-6 and MCP-1 are about 2.8 times your baseline.", f)).toBe(true);
    // a fold with more precision than the facts give is not grounded
    expect(assertNumbersGrounded("IL-6 is 2.85 times your baseline.", f)).toBe(false);
  });

  it("a text without the disclaimer is rejected", () => {
    const text = renderTriageTemplate(f, "en");
    expect(hasDisclaimer(text, "en")).toBe(true);
    expect(hasDisclaimer(text.replace(SIGNATURE_DISCLAIMER.en, "").trim(), "en")).toBe(false);
    expect(hasDisclaimer("Your index is 67. Decision support, not a diagnosis. Anything else?", "en")).toBe(false);
    expect(hasDisclaimer(renderTriageTemplate(facts("C003_R+1", "mn"), "mn"), "mn")).toBe(true);
  });
});
