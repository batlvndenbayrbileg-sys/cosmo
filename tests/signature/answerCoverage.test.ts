import { describe, expect, it } from "vitest";
import type { Lang } from "@/lib/types";
import { POST_TIMEPOINTS, REFERENCE_CREW } from "@/lib/signature/config";
import { SIGNATURE_DISCLAIMER, answerCoversPanel } from "@/lib/signature/facts";
import { renderTriageTemplate } from "@/lib/signature/templates";
import { acceptSignatureAnswer, answerSignatureQuestion, triageFactsFor } from "@/server/agent/signature";

/**
 * T10 fix: model wording of a triage answer must carry an action (build prompt T6 "one action") and, for an
 * UNEXPECTED_ACTIVATION panel with a second-assay badge, the badge sentence (addendum section 2: the badge decides
 * whether to escalate). Otherwise the template is sent.
 */

const D = SIGNATURE_DISCLAIMER.en;

describe("signature T10 fix: every template covers its panel", () => {
  it("all 16 panels, EN and MN: the template passes acceptSignatureAnswer and answerCoversPanel", () => {
    for (const lang of ["en", "mn"] as Lang[]) {
      for (const c of REFERENCE_CREW) {
        for (const t of POST_TIMEPOINTS) {
          const f = triageFactsFor(c, lang, { timepoint: t })!;
          const text = renderTriageTemplate(f, lang);
          expect(acceptSignatureAnswer(text, f, lang), `${lang} ${c} ${t}: ${text}`).toBe(true);
          expect(answerCoversPanel(text, f, lang), `${lang} ${c} ${t}: ${text}`).toBe(true);
        }
      }
    }
  });
});

describe("signature T10 fix: an answer without the action or the badge sentence is not spoken", () => {
  it("C002 R+45 (UNEXPECTED, two assays): index and fold but no action -> rejected; with action and agreement -> accepted", () => {
    const f = triageFactsFor("C002", "en", { timepoint: "R+45" })!;
    expect(f.class).toBe("UNEXPECTED_ACTIVATION");
    expect(f.secondAssay?.badge).toBe("TWO_ASSAY_CONFIRMED");
    const noAction = `Your index is ${f.fri}. IL-6 is about ${f.leadMarker!.foldRounded} times your baseline. ${D}`;
    expect(acceptSignatureAnswer(noAction, f, "en")).toBe(true);
    expect(answerCoversPanel(noAction, f, "en")).toBe(false);
    const noBadge = `Your index is ${f.fri}. Please re-test in 3 days. ${D}`;
    expect(answerCoversPanel(noBadge, f, "en")).toBe(false);
    const good = `Your index is ${f.fri} and a second, independent test agrees. Please re-test in 3 days. ${D}`;
    expect(answerCoversPanel(good, f, "en")).toBe(true);
    const wrong = `Your index is ${f.fri}, but only one of two tests shows this. Please re-test in 3 days. ${D}`;
    expect(answerCoversPanel(wrong, f, "en")).toBe(false);
  });

  it("C003 R+194 (UNEXPECTED, single assay): must say the two tests disagree, and may not claim they agree", () => {
    const f = triageFactsFor("C003", "en", { timepoint: "R+194" })!;
    expect(f.class).toBe("UNEXPECTED_ACTIVATION");
    expect(f.secondAssay?.badge).toBe("SINGLE_ASSAY");
    const noBadge = `Your index is ${f.fri}. Repeat the measurement in 3 days. ${D}`;
    expect(acceptSignatureAnswer(noBadge, f, "en")).toBe(true);
    expect(answerCoversPanel(noBadge, f, "en")).toBe(false);
    const claimsBoth = `Your index is ${f.fri} and both tests show IL-6 up. Repeat the measurement in 3 days. ${D}`;
    expect(answerCoversPanel(claimsBoth, f, "en")).toBe(false);
    const good = `Your index is ${f.fri}, but the two tests on this sample disagree. Repeat the measurement in 3 days. ${D}`;
    expect(answerCoversPanel(good, f, "en")).toBe(true);
    const mn = triageFactsFor("C003", "mn", { timepoint: "R+194" })!;
    const mnNoBadge = `Таны индекс ${mn.fri}. 3 хоногийн дараа хэмжилтийг давтах. ${SIGNATURE_DISCLAIMER.mn}`;
    expect(answerCoversPanel(mnNoBadge, mn, "mn")).toBe(false);
    const mnGood = `Таны индекс ${mn.fri}, гэвч хоёр шинжилгээ хоорондоо зөрж байна. 3 хоногийн дараа хэмжилтийг давтах. ${SIGNATURE_DISCLAIMER.mn}`;
    expect(answerCoversPanel(mnGood, mn, "mn")).toBe(true);
  });

  it("C001 R+1 (EXPECTED): an action is needed; the badge sentence is not required there", () => {
    const f = triageFactsFor("C001", "en", { timepoint: "R+1" })!;
    expect(f.class).toBe("EXPECTED_FLIGHT_RESPONSE");
    expect(answerCoversPanel(`Your index is ${f.fri}. ${D}`, f, "en")).toBe(false);
    expect(answerCoversPanel(`Your index is ${f.fri}. Re-test in ${f.recovery!.retestInDays} days. ${D}`, f, "en")).toBe(true);
  });

  it("BASELINE and INDETERMINATE need no action ('none; next routine check')", () => {
    const base = triageFactsFor("C001", "en", { timepoint: "R+45" })!;
    expect(base.class).toBe("BASELINE");
    expect(answerCoversPanel(`Your index is ${base.fri}. ${D}`, base, "en")).toBe(true);
    const ind = triageFactsFor("C003", "en", { timepoint: "R+82" })!;
    expect(ind.class).toBe("INDETERMINATE");
    expect(answerCoversPanel(`Your index is ${ind.fri}. ${D}`, ind, "en")).toBe(true);
  });

  it("through answerSignatureQuestion: the uncovered model text is replaced by the template", async () => {
    const ask = (crewId: string, today: number, reply: string) =>
      answerSignatureQuestion({
        crewId,
        text: "What does my blood panel mean?",
        lang: "en",
        ctx: { lang: "en", today },
        history: [],
        answer: async () => reply,
      });
    const c2 = triageFactsFor("saraa", "en", { today: 45 })!;
    expect(c2.timepoint).toBe("R+45");
    const r1 = await ask("saraa", 45, `Your index is ${c2.fri}. IL-6 is about ${c2.leadMarker!.foldRounded} times your baseline. ${D}`);
    expect(r1).toMatchObject({ worded: false, text: renderTriageTemplate(c2, "en") });
    const d = triageFactsFor("alex", "en", { today: 194 })!;
    expect(d.timepoint).toBe("R+194");
    const r2 = await ask("alex", 194, `Your index is ${d.fri}. Repeat the measurement in 3 days. ${D}`);
    expect(r2).toMatchObject({ worded: false, text: renderTriageTemplate(d, "en") });
    const ok = `Your index is ${d.fri}, but the two tests on this sample disagree. Repeat the measurement in 3 days. ${D}`;
    expect(await ask("alex", 194, ok)).toMatchObject({ worded: true, text: ok });
  });
});
