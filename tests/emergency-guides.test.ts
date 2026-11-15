import { describe, expect, it } from "vitest";
import {
  BUILTIN_CALL_FOR_HELP,
  BUILTIN_GUIDES,
  STEP_ARTS,
  findBuiltInGuide,
  matchEmergency,
  mergeScenarios,
  scenarioSchema,
  type EmergencyScenario,
} from "@/lib/emergency";

/** strip what only the client copy has, then validate like a team scenario.json */
function asFile(s: EmergencyScenario) {
  const { builtIn, ...rest } = s;
  void builtIn;
  return { ...rest, steps: s.steps.map(({ imageUrl, ...step }) => (void imageUrl, step)) };
}

const sentences = (text: string) => text.split(/[.!?]+/).filter((p) => p.trim().length > 0).length;

const EXPECTED = [
  "not-breathing",
  "choking",
  "severe-bleeding",
  "anaphylaxis",
  "chest-pain",
  "seizure",
  "head-injury",
  "burns",
  "fainting",
  "call-for-help",
];

/** drug, medicine and dose words that must never appear (EN whole words, MN stems as whole words) */
const DRUG_EN =
  /\b(aspirin|paracetamol|acetaminophen|ibuprofen|nitroglycerin|glyceryl|antihistamines?|inhaler|adrenaline|epinephrine|medicines?|medications?|drugs?|tablets?|pills?|doses?|dosage|mg|ml|milligrams?)\b/i;
const DRUG_MN = /(?<![\p{L}])(аспирин|парацетамол|адреналин\p{L}*|эм|эмийн|эмээ|эмийг|тун|тунг|тунгаар|шахмал|ширхэг|мг|мл)(?![\p{L}])/u;

function texts(s: EmergencyScenario): Array<{ en: string; mn: string; where: string }> {
  return [
    { ...s.title, where: "title" },
    ...(s.summary ? [{ ...s.summary, where: "summary" }] : []),
    ...(s.context ? [{ ...s.context, where: "context" }] : []),
    ...s.steps.map((st, i) => ({ ...st.text, where: `step ${i + 1}` })),
  ];
}

describe("built-in guides", () => {
  it("ship the requested scenarios, most urgent first, with the get-help card last", () => {
    expect(BUILTIN_GUIDES.map((g) => g.id)).toEqual(EXPECTED);
    expect(BUILTIN_GUIDES.at(-1)).toBe(BUILTIN_CALL_FOR_HELP);
  });

  for (const guide of BUILTIN_GUIDES) {
    describe(guide.id, () => {
      it("validates against the scenario schema (the team's scenario.json format)", () => {
        const parsed = scenarioSchema.safeParse(asFile(guide));
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      });

      it("is built in, not yet reviewed, and every step has an illustration and no bitmap", () => {
        expect(guide.builtIn).toBe(true);
        expect(guide.reviewedBy).toBe("PENDING");
        for (const step of guide.steps) {
          expect(step.art && STEP_ARTS.includes(step.art)).toBeTruthy();
          expect(step.image).toBeUndefined();
          expect(step.imageUrl).toBeNull();
        }
      });

      it("starts with getting help: the crew medical officer and the flight surgeon, the local number on Earth", () => {
        const first = guide.steps[0];
        expect(first.art).toBe("call");
        expect(first.text.en).toMatch(/crew medical officer/);
        expect(first.text.en).toMatch(/flight surgeon/);
        expect(first.text.en).toMatch(/local emergency number/);
        expect(first.text.mn).toMatch(/багийн эмч/i);
        expect(first.text.mn).toMatch(/нислэгийн эмч/);
        expect(first.text.mn).toMatch(/яаралтай тусламжийн дугаар/);
      });

      it("has the same structure in English and Mongolian (same steps, same sentence count, all filled)", () => {
        for (const t of texts(guide)) {
          expect(t.en.trim(), `${t.where} en`).not.toBe("");
          expect(t.mn.trim(), `${t.where} mn`).not.toBe("");
          expect(/[А-Яа-яӨөҮүЁё]/.test(t.mn), `${t.where} mn is Cyrillic`).toBe(true);
          expect(sentences(t.mn), `${t.where}: ${t.en} / ${t.mn}`).toBe(sentences(t.en));
        }
      });

      it("names no medicine and no dose, except the person's own adrenaline auto-injector in the allergy guide", () => {
        for (const t of texts(guide)) {
          const allowed = guide.id === "anaphylaxis" && /their own adrenaline auto-injector/.test(t.en);
          const en = allowed ? t.en.replace(/\badrenaline auto-injector\b/, "auto-injector") : t.en;
          const mn = allowed ? t.mn.replace(/адреналины автомат тариур/, "автомат тариур") : t.mn;
          expect(DRUG_EN.exec(en)?.[0], `${guide.id} ${t.where} en`).toBeUndefined();
          expect(DRUG_MN.exec(mn)?.[0], `${guide.id} ${t.where} mn`).toBeUndefined();
        }
      });

      it("never diagnoses", () => {
        for (const t of texts(guide)) {
          expect(t.en, t.where).not.toMatch(/\b((you|they) (have|are having) (a|an)|(he|she) (has|is having) (a|an)|this is (a|an)|diagnos)\b/i);
        }
      });

      it("cites its sources with a URL and the date checked (the get-help card has no medical content)", () => {
        if (guide.id === BUILTIN_CALL_FOR_HELP.id) return;
        expect(guide.sources.length).toBeGreaterThan(0);
        for (const s of guide.sources) {
          expect(s.url).toMatch(/^https:\/\//);
          expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      });

      it("links only to guides that exist", () => {
        for (const step of guide.steps) if (step.link) expect(findBuiltInGuide(step.link)).not.toBeNull();
      });
    });
  }

  it("the allergy guide keeps the auto-injector line, worded as the person's own", () => {
    const step = findBuiltInGuide("anaphylaxis")?.steps[1];
    expect(step?.art).toBe("auto-injector");
    expect(step?.text.en).toMatch(/If they have their own adrenaline auto-injector/);
  });

  it("CPR steps carry the metronome", () => {
    const cpr = findBuiltInGuide("not-breathing");
    expect(cpr?.steps.filter((s) => s.metronome).length).toBeGreaterThanOrEqual(1);
    expect(cpr?.steps.some((s) => /100 to 120 times a minute/.test(s.text.en))).toBe(true);
  });
});

describe("voice routing to the built-in guides", () => {
  const lib = BUILTIN_GUIDES;
  const cases: Array<[string, string]> = [
    ["he fainted", "fainting"],
    ["I think she passed out", "fainting"],
    ["ухаан алдлаа", "fainting"],
    ["амьсгалахгүй байна", "not-breathing"],
    ["he is not breathing", "not-breathing"],
    ["fainted and isn't breathing", "not-breathing"],
    ["хахаж байна", "choking"],
    ["she is choking", "choking"],
    ["цус их гарч байна", "severe-bleeding"],
    ["it's bleeding a lot", "severe-bleeding"],
    ["түлэгдсэн", "burns"],
    ["I burned my hand", "burns"],
    ["he is having a seizure", "seizure"],
    ["таталт өгч байна", "seizure"],
    ["chest pain", "chest-pain"],
    ["цээж өвдөж байна", "chest-pain"],
    ["a severe allergic reaction", "anaphylaxis"],
    ["he hit his head", "head-injury"],
    ["толгойгоо цохисон", "head-injury"],
  ];
  for (const [phrase, id] of cases) {
    it(`"${phrase}" opens ${id}`, () => {
      expect(matchEmergency(phrase, lib)?.scenarioId).toBe(id);
    });
  }

  it("ordinary check-in answers stay closed (dizziness alone is not an emergency)", () => {
    for (const phrase of ["I slept seven hours", "a little dizzy this morning", "толгой бага зэрэг эргэсэн", "no headache"]) {
      expect(matchEmergency(phrase, lib), phrase).toBeNull();
    }
  });

  it("a team scenario with a built-in id replaces it in place; other team scenarios come first", () => {
    const team: EmergencyScenario = { ...BUILTIN_GUIDES[8], builtIn: false, title: { en: "Team fainting", mn: "Багийн" } };
    const extra: EmergencyScenario = { ...BUILTIN_CALL_FOR_HELP, id: "team-extra", builtIn: false };
    const merged = mergeScenarios([team, extra]);
    expect(merged[0].id).toBe("team-extra");
    expect(merged.filter((s) => s.id === "fainting")).toEqual([team]);
    expect(merged).toHaveLength(BUILTIN_GUIDES.length + 1);
  });
});
