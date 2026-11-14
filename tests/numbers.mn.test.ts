import { describe, expect, it } from "vitest";
import { formatMnNumber, parseMnNumber } from "@/lib/numbers/mn";

describe("parseMnNumber: brief examples", () => {
  it.each([
    ["долоон", 7],
    ["ерэн найм", 98],
    ["гуч зургаа аравны тав", 36.5],
  ])("%s -> %s", (text, expected) => {
    expect(parseMnNumber(text)).toBe(expected);
  });
});

describe("parseMnNumber: spelling variants", () => {
  it.each([
    // bare units and zero
    ["тэг", 0], ["нул", 0], ["нэг", 1], ["хоёр", 2], ["гурав", 3], ["дөрөв", 4], ["тав", 5],
    ["зургаа", 6], ["долоо", 7], ["найм", 8], ["ес", 9], ["арав", 10],
    // attributive -н forms stand alone ("долоон цаг")
    ["гурван", 3], ["дөрвөн", 4], ["таван", 5], ["зургаан", 6], ["долоон", 7], ["найман", 8],
    ["есөн", 9], ["арван", 10],
    // teens
    ["арван нэг", 11], ["арван хоёр", 12], ["арван тав", 15], ["арван ес", 19],
    // tens, bare and attributive
    ["хорь", 20], ["хорин", 20], ["гуч", 30], ["гучин", 30], ["дөч", 40], ["дөчин", 40],
    ["тавь", 50], ["тавин", 50], ["жар", 60], ["жаран", 60], ["дал", 70], ["далан", 70],
    ["ная", 80], ["наян", 80], ["ер", 90], ["ерэн", 90],
    // tens + unit, either form of the tens word
    ["хорин нэг", 21], ["хорь нэг", 21], ["гучин нэг", 31], ["наян ес", 89], ["тавин таван", 55],
    // hundreds
    ["зуу", 100], ["зуун", 100], ["хоёр зуу", 200], ["зуун нэг", 101], ["зуун арав", 110],
    ["зуун арван нэг", 111], ["зуун хорь", 120], ["зуун хорин таван", 125], ["гурван зуу", 300],
    ["есөн зуун ерэн ес", 999],
    // decimals
    ["гучин зургаа цэг тав", 36.5], ["гучин зургаа цэг нэг тав", 36.15], ["тавин цэг тэг", 50],
    ["цэг тав", 0.5], ["гуч зургаа аравны тав", 36.5], ["долоо аравны хоёр", 7.2],
    ["аравны тав", 0.5],
    // half
    ["долоо хагас", 7.5], ["хагас", 0.5], ["арван хоёр хагас", 12.5],
    // digits
    ["36", 36], ["36.5", 36.5], ["36,5", 36.5], ["0", 0], ["120", 120],
    ["36 цэг 5", 36.5], ["7 хагас", 7.5],
  ])("%s -> %s", (text, expected) => {
    expect(parseMnNumber(text)).toBeCloseTo(expected, 10);
  });

  it("ignores case, extra spacing and punctuation", () => {
    expect(parseMnNumber("  ЕРЭН   Найм! ")).toBe(98);
    expect(parseMnNumber("Долоон.")).toBe(7);
    expect(parseMnNumber("гучин-зургаа, цэг тав")).toBe(36.5);
  });
});

describe("parseMnNumber: negative cases", () => {
  it.each([
    "сайн байна", "", "   ", "!!!", "долоон цаг", "ерэн найм хоног",
    "нэг нэг", "хорь хорь", "хорин тэг", "зуун тэг", "зуун зуун", "арван арван",
    "хагас долоо", "долоо цэг", "цэг", "долоо аравны", "долоо аравны арав",
    "цэг цэг тав", "seven",
  ])("%j -> null", (text) => {
    expect(parseMnNumber(text)).toBeNull();
  });

  it("is case: number plus a non-number word is not a number expression", () => {
    expect(parseMnNumber("долоон цаг")).toBeNull();
  });
});

describe("formatMnNumber", () => {
  it("produces the canonical words for sample values", () => {
    expect(formatMnNumber(0)).toBe("тэг");
    expect(formatMnNumber(7)).toBe("долоо");
    expect(formatMnNumber(10)).toBe("арав");
    expect(formatMnNumber(11)).toBe("арван нэг");
    expect(formatMnNumber(20)).toBe("хорь");
    expect(formatMnNumber(98)).toBe("ерэн найм");
    expect(formatMnNumber(100)).toBe("зуу");
    expect(formatMnNumber(125)).toBe("зуун хорин тав");
    expect(formatMnNumber(200)).toBe("хоёр зуу");
    expect(formatMnNumber(36.5)).toBe("гучин зургаа цэг тав");
  });

  it("round-trips every integer 0..200 (and up to 999)", () => {
    for (let n = 0; n <= 999; n++) {
      const words = formatMnNumber(n);
      expect(parseMnNumber(words), `${n} -> "${words}"`).toBe(n);
    }
  });

  it("round-trips one-decimal values", () => {
    for (const n of [0.5, 7.5, 36.5, 36.6, 98.3, 120.1]) {
      expect(parseMnNumber(formatMnNumber(n)), String(n)).toBeCloseTo(n, 10);
    }
  });

  it("rejects values it cannot say", () => {
    expect(() => formatMnNumber(-1)).toThrow(RangeError);
    expect(() => formatMnNumber(1000)).toThrow(RangeError);
    expect(() => formatMnNumber(1.25)).toThrow(RangeError);
    expect(() => formatMnNumber(Number.NaN)).toThrow(RangeError);
  });
});
