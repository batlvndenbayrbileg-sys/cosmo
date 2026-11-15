import { describe, expect, it } from "vitest";
import {
  detectPain,
  ONSET_CHOICES,
  TAP_PHRASE,
  answerPhrase,
  isSeverePain,
  painGuide,
  readPainLocation,
  readPainOnset,
  readPainSeverity,
  type PainLocation,
} from "@/lib/pain";

/* ───────────── what counts as "it hurts" ───────────── */

describe("detectPain: pain statements and their place (English)", () => {
  const cases: Array<[string, PainLocation | null]> = [
    ["my head hurts", "head"],
    ["I have a headache", "head"],
    ["it hurts", null],
    ["I'm in pain", null],
    ["my chest hurts", "chest"],
    ["I have chest pain", "chest"],
    ["there's a pain in my chest", "chest"],
    ["my stomach hurts", "abdomen"],
    ["I have a stomachache", "abdomen"],
    ["my belly is sore", "abdomen"],
    ["my lower back hurts", "back"],
    ["back pain since this morning", "back"],
    ["my left arm hurts", "arm"],
    ["my shoulder aches", "arm"],
    ["my knee hurts", "leg"],
    ["my legs are cramping", "leg"],
    ["I have a sore throat", "throat"],
    ["my neck hurts", "throat"],
    ["my eyes hurt", "eye"],
    ["I have an earache", "ear"],
    ["my tooth hurts", "tooth"],
    ["my joints ache", "joint"],
    ["my right side hurts", "side"],
    ["my whole body hurts", "whole_body"],
    ["I ache all over", "whole_body"],
    ["why does my head hurt?", "head"],
    ["what helps my headache?", "head"],
    ["I can't breathe and my chest hurts", "chest"],
    ["no chest pain, but my head hurts", "head"],
    ["I have a headache, but my legs don't hurt", "head"],
    ["my head and my chest hurt", "chest"],
  ];
  for (const [text, location] of cases) {
    it(`"${text}" -> ${location ?? "no place"}`, () => {
      const r = detectPain(text);
      expect(r, text).not.toBeNull();
      expect(r?.location).toBe(location);
    });
  }
});

describe("detectPain: pain statements and their place (Mongolian)", () => {
  const cases: Array<[string, PainLocation | null]> = [
    ["өвдөж байна", null],
    ["толгой өвдөөд байна", "head"],
    ["толгой өвдөж байна", "head"],
    ["цээж өвдөж байна", "chest"],
    ["зүрх өвдөөд байна", "chest"],
    ["гэдэс өвдөж байна", "abdomen"],
    ["хэвлий өвдөөд байна", "abdomen"],
    ["нуруу өвдөж байна", "back"],
    ["гар минь өвдөөд байна", "arm"],
    ["хөл өвдөж байна", "leg"],
    ["өвдөг өвдөөд байна", "leg"],
    ["хоолой өвдөж байна", "throat"],
    ["нүд өвдөөд байна", "eye"],
    ["чих өвдөж байна", "ear"],
    ["шүд өвдөөд байна", "tooth"],
    ["үе мөч өвдөж байна", "joint"],
    ["баруун хажуу өвдөөд байна", "side"],
    ["бөөр орчим өвдөж байна", "side"],
    ["бүх бие өвдөөд байна", "whole_body"],
    ["бие минь чилээд байна", "whole_body"],
    ["яагаад толгой өвдөөд байна вэ?", "head"],
    ["толгой өвдөхгүй, гэхдээ гэдэс өвдөж байна", "abdomen"],
  ];
  for (const [text, location] of cases) {
    it(`"${text}" -> ${location ?? "no place"}`, () => {
      const r = detectPain(text);
      expect(r, text).not.toBeNull();
      expect(r?.location).toBe(location);
    });
  }
});

describe("detectPain: no false triggers", () => {
  const negatives = [
    "my legs don't hurt",
    "no pain",
    "no pain at all today",
    "I don't have a headache",
    "no headache, no dizziness, no nausea",
    "the headache is gone",
    "my back doesn't hurt anymore",
    "it wouldn't hurt to drink more water",
    "is chest pain common in space?",
    "do astronauts get back pain?",
    "if my head hurts, what should I do?",
    "I took a painkiller yesterday",
    "pain-free today",
    "you hurt my feelings",
    "I slept seven hours",
    "my heart rate is 72",
    "let's go back to the check-in",
    "толгой өвдөхгүй, эргэхгүй, дотор муухайрахгүй",
    "өвдөлт байхгүй",
    "хөл өвдөөгүй",
    "толгой өвдөх нь хэвийн үү?",
    "толгой өвдвөл яах вэ?",
    "өвдөг минь зүгээр",
    "зүрхний цохилт 72",
    "сансрын хөлөг дээр",
  ];
  for (const text of negatives) {
    it(`"${text}" is not a pain statement`, () => {
      expect(detectPain(text), text).toBeNull();
    });
  }
});

/* ───────────── severity, since when, red flags ───────────── */

describe("severity", () => {
  it("reads 0-10 only with the scale named, unless Cosmo just asked (bare)", () => {
    expect(readPainSeverity("my head hurts, 7 out of 10")).toEqual({ value: 7, word: null });
    expect(readPainSeverity("pain 8/10")).toEqual({ value: 8, word: null });
    expect(readPainSeverity("толгой өвдөж байна, 10-аас 6")).toEqual({ value: 6, word: null });
    expect(readPainSeverity("my head hurts since 7")).toBeNull();
    expect(readPainSeverity("6")).toBeNull();
    expect(readPainSeverity("6", { bare: true })).toEqual({ value: 6, word: null });
    expect(readPainSeverity("about a six, since this morning", { bare: true })?.value).toBe(6);
    expect(readPainSeverity("зургаа, өглөөнөөс хойш", { bare: true })?.value).toBe(6);
    // a time is never a severity
    expect(readPainSeverity("for 2 hours", { bare: true })).toBeNull();
    expect(readPainSeverity("2 цагийн өмнөөс", { bare: true })).toBeNull();
  });

  it("reads severity words in both languages", () => {
    expect(readPainSeverity("it hurts a little")?.word).toBe("mild");
    expect(readPainSeverity("it's not too bad")?.word).toBe("mild");
    expect(readPainSeverity("severe pain in my back")?.word).toBe("severe");
    expect(readPainSeverity("the worst headache")?.word).toBe("severe");
    expect(readPainSeverity("толгой бага зэрэг өвдөж байна")?.word).toBe("mild");
    expect(readPainSeverity("маш хүчтэй өвдөж байна")?.word).toBe("severe");
    expect(readPainSeverity("нэлээн өвдөж байна")?.word).toBe("moderate");
  });

  it("8 or more, or 'severe', is a red flag", () => {
    expect(isSeverePain({ value: 8, word: null })).toBe(true);
    expect(isSeverePain({ value: 7, word: "severe" })).toBe(false);
    expect(isSeverePain({ value: null, word: "severe" })).toBe(true);
    expect(isSeverePain(null)).toBe(false);
  });
});

describe("since when", () => {
  const cases: Array<[string, string, number | null]> = [
    ["since this morning", "this_morning", null],
    ["it started 2 hours ago", "hours", 2],
    ["for about three days", "days", 3],
    ["for a few days now", "days", null],
    ["since yesterday", "yesterday", null],
    ["it just started", "just_now", null],
    ["half an hour ago", "minutes", 30],
    ["өглөөнөөс хойш", "this_morning", null],
    ["2 цагийн өмнөөс", "hours", 2],
    ["өчигдрөөс хойш", "yesterday", null],
    ["хэд хоног болж байна", "days", null],
    ["саяхан эхэлсэн", "just_now", null],
    ["хоёр долоо хоног болж байна", "weeks", 2],
  ];
  for (const [text, kind, amount] of cases) {
    it(`"${text}" -> ${kind}${amount === null ? "" : ` ${amount}`}`, () => {
      expect(readPainOnset(text)).toEqual({ kind, amount });
    });
  }
  it("a plain duration answering another question is not an onset", () => {
    expect(readPainOnset("I slept 7 hours")).toBeNull();
    expect(readPainOnset("7 цаг унтсан")).toBeNull();
  });
});

describe("red flags in the words", () => {
  it("chest, severe, breathing, fainting, confusion", () => {
    expect(detectPain("my chest hurts")?.redFlags).toEqual(["chest"]);
    expect(detectPain("my back hurts, 9 out of 10")?.redFlags).toEqual(["severe"]);
    expect(detectPain("my stomach hurts and I can't breathe")?.redFlags).toEqual(["breathing"]);
    expect(detectPain("my head hurts and I almost fainted")?.redFlags).toEqual(["fainting"]);
    expect(detectPain("my head hurts and I feel confused")?.redFlags).toEqual(["confusion"]);
    expect(detectPain("гэдэс өвдөөд амьсгал давчдаж байна")?.redFlags).toEqual(["breathing"]);
    expect(detectPain("толгой өвдөөд ухаан алдах шиг боллоо")?.redFlags).toEqual(["fainting"]);
  });
  it("denied red-flag words are not red flags", () => {
    expect(detectPain("my head hurts a little, no trouble breathing")?.redFlags).toEqual([]);
    expect(detectPain("толгой өвдөж байна, амьсгал давчдахгүй")?.redFlags).toEqual([]);
    expect(detectPain("my leg hurts, I'm not confused")?.redFlags).toEqual([]);
  });
});

describe("the place alone (after Cosmo asked where)", () => {
  it("reads a body part without a pain word", () => {
    expect(readPainLocation("my stomach")).toBe("abdomen");
    expect(readPainLocation("гэдэс")).toBe("abdomen");
    expect(readPainLocation("the left knee")).toBe("leg");
    expect(readPainLocation("цээж")).toBe("chest");
    expect(readPainLocation("I don't know")).toBeNull();
  });
});

describe("painGuide", () => {
  it("chest pain opens the chest pain guide; a hit head the head injury guide; urgent otherwise 'get help'", () => {
    expect(painGuide({ location: "chest", clause: "my chest hurts", redFlags: ["chest"], urgent: true })).toBe("chest-pain");
    expect(painGuide({ location: "head", clause: "i hit my head and it hurts", redFlags: [], urgent: false })).toBe("head-injury");
    expect(painGuide({ location: "back", clause: "my back hurts", redFlags: ["severe"], urgent: true })).toBe("call-for-help");
    expect(painGuide({ location: "head", clause: "my head hurts", redFlags: ["fainting"], urgent: true })).toBe("fainting");
    expect(painGuide({ location: "head", clause: "my head hurts", redFlags: [], urgent: false })).toBeNull();
  });
});

describe("what the screen sends", () => {
  it("every tapped place is read back as that place, in both languages", () => {
    for (const loc of Object.keys(TAP_PHRASE) as PainLocation[]) {
      for (const lang of ["en", "mn"] as const) expect(detectPain(TAP_PHRASE[loc][lang])?.location, `${loc} ${lang}`).toBe(loc);
    }
  });
  it("the answer card's words are read back as the severity and the onset", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const choice of ONSET_CHOICES) {
        const said = answerPhrase(6, choice.id, lang);
        expect(readPainSeverity(said, { bare: true })?.value, said).toBe(6);
        expect(readPainOnset(said), said).not.toBeNull();
      }
    }
  });
});
