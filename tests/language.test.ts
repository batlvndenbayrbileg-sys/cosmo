import { describe, expect, it } from "vitest";
import { detectLanguage, normalizeLanguageCode } from "@/lib/language";

describe("normalizeLanguageCode", () => {
  it.each([
    ["mn", "mn"], ["mon", "mn"], ["mong", "mn"], ["khk", "mn"], ["mongolian", "mn"],
    ["MN", "mn"], ["Mongolian", "mn"], ["mn-MN", "mn"], ["mn_MN", "mn"], [" khk ", "mn"],
    ["en", "en"], ["eng", "en"], ["english", "en"], ["EN", "en"], ["en-US", "en"], ["en_GB", "en"],
  ])("%j -> %s", (input, expected) => {
    expect(normalizeLanguageCode(input)).toBe(expected);
  });

  it.each([undefined, null, "", "  ", "fr", "ru", "de-DE", "mongol", "zz"])("%j -> null", (input) => {
    expect(normalizeLanguageCode(input)).toBeNull();
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "prototype", "Constructor-US"])(
    "Object.prototype member name %j -> null (never a non-Lang value)",
    (input) => {
      expect(normalizeLanguageCode(input)).toBeNull();
    },
  );
});

describe("detectLanguage", () => {
  it("detects Mongolian Cyrillic text", () => {
    const r = detectLanguage("Сайн байна уу, би өнөөдөр сайхан унтсан");
    expect(r.lang).toBe("mn");
    expect(r.confidence).toBe(1);
  });

  it("detects English text", () => {
    const r = detectLanguage("Good morning, I slept well");
    expect(r.lang).toBe("en");
    expect(r.confidence).toBe(1);
  });

  it("lets the dominant script win in a mixed sentence, with confidence = its share", () => {
    const mostlyMn = detectLanguage("Миний цусны даралт өнөөдөр сайн, pulse 68");
    expect(mostlyMn.lang).toBe("mn");
    expect(mostlyMn.confidence).toBeGreaterThan(0.55);
    expect(mostlyMn.confidence).toBeLessThan(1);

    const mostlyEn = detectLanguage("My blood pressure is fine, даралт");
    expect(mostlyEn.lang).toBe("en");
    expect(mostlyEn.confidence).toBeGreaterThan(0.55);
    expect(mostlyEn.confidence).toBeLessThan(1);
  });

  it("ignores digits and punctuation when counting", () => {
    expect(detectLanguage("120/80, 36.6 !!! сайн")).toEqual({ lang: "mn", confidence: 1 });
  });

  it("uses the hint on a near tie", () => {
    // 4 Cyrillic letters vs 4 Latin letters
    expect(detectLanguage("сайн okay", "mn").lang).toBe("mn");
    expect(detectLanguage("сайн okay", "en").lang).toBe("en");
    expect(detectLanguage("сайн okay").lang).toBe("en"); // no hint -> en
    expect(detectLanguage("сайн okay", "fr").lang).toBe("en"); // unusable hint -> en
  });

  it("does NOT detect Latin-transliterated Mongolian as Mongolian (documented limit)", () => {
    // Script-based detection cannot tell "sain baina uu" from English; the session hint is the fix.
    expect(detectLanguage("sain baina uu, bi doloon tsag untsan").lang).toBe("en");
  });

  it("uses the hint for digit-only or empty text, with confidence 0", () => {
    expect(detectLanguage("120 80", "mn")).toEqual({ lang: "mn", confidence: 0 });
    expect(detectLanguage("98", "mongolian")).toEqual({ lang: "mn", confidence: 0 });
    expect(detectLanguage("36.6", "en-US")).toEqual({ lang: "en", confidence: 0 });
    expect(detectLanguage("")).toEqual({ lang: "en", confidence: 0 });
    expect(detectLanguage("120 80", null)).toEqual({ lang: "en", confidence: 0 });
  });

  it("never returns a non-Lang value for a hostile hint (falls back to en)", () => {
    for (const hint of ["constructor", "__proto__", "toString"]) {
      expect(detectLanguage("123", hint)).toEqual({ lang: "en", confidence: 0 });
      expect(detectLanguage("сайн okay", hint).lang).toBe("en");
    }
  });

  it("does not let the hint override a clear script", () => {
    expect(detectLanguage("Сайн байна уу", "en").lang).toBe("mn");
    expect(detectLanguage("How are you", "mn").lang).toBe("en");
  });
});
