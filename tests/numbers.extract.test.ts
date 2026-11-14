import { describe, expect, it } from "vitest";
import { extractNumbers, matchesAnyNumber } from "@/lib/numbers/extract";

const values = (text: string): number[] => extractNumbers(text).map((n) => n.value);

describe("extractNumbers: digits", () => {
  it("finds integers, decimals with . or , and slash pairs", () => {
    expect(values("about 98 percent")).toEqual([98]);
    expect(values("36,6")).toEqual([36.6]);
    expect(values("temperature 36.6 C")).toEqual([36.6]);
    expect(values("120/80")).toEqual([120, 80]);
    expect(values("даралт 120 80")).toEqual([120, 80]);
  });

  it("reads comma + three digits as a thousands separator", () => {
    expect(values("drank 2,500 ml")).toEqual([2500]);
  });

  it("reports positions, source text and kind", () => {
    const [n] = extractNumbers("hr is 68 bpm");
    expect(n).toEqual({ value: 68, start: 6, end: 8, text: "68", kind: "digits" });
  });

  it("returns nothing when there is no number", () => {
    expect(extractNumbers("I feel fine today")).toEqual([]);
    expect(extractNumbers("")).toEqual([]);
  });
});

describe("extractNumbers: English words", () => {
  it.each([
    ["I slept seven hours", [7]],
    ["thirty six point five", [36.5]],
    ["one hundred twenty", [120]],
    ["a hundred and ten", [110]],
    ["seven and a half", [7.5]],
    ["seven and a half hours", [7.5]],
    ["ninety eight", [98]],
    ["twenty-one", [21]],
    ["two thousand five hundred", [2500]],
    ["My blood pressure is one twenty over eighty", [120, 80]],
    ["one thirty over ninety", [130, 90]],
    ["sixty eight", [68]],
  ] as Array<[string, number[]]>)("%s", (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it("does not merge adjacent separate numbers", () => {
    expect(values("seven eight")).toEqual([7, 8]);
    expect(values("one twenty over eighty")).toEqual([120, 80]);
  });
});

describe("extractNumbers: Mongolian words", () => {
  it('treats "ерэн найм" as ONE number and never splits "гучин нэг"', () => {
    expect(values("ерэн найм")).toEqual([98]);
    expect(values("гучин нэг")).toEqual([31]);
    expect(extractNumbers("ерэн найм")).toHaveLength(1);
  });

  it("finds a number inside a phrase", () => {
    expect(values("долоон цаг")).toEqual([7]);
    expect(values("би зургаан цаг унтсан")).toEqual([6]);
  });

  it("handles halves, decimals and tenths", () => {
    expect(values("унтсан цаг: долоо хагас")).toEqual([7.5]);
    expect(values("температур гучин зургаа цэг тав")).toEqual([36.5]);
    expect(values("гуч зургаа аравны тав")).toEqual([36.5]);
  });

  it("splits two separate Mongolian numbers", () => {
    expect(values("зуун хорь наян")).toEqual([120, 80]);
  });

  it("does not merge across punctuation", () => {
    expect(values("ерэн, найм")).toEqual([90, 8]);
  });

  it("marks word numbers as kind words", () => {
    expect(extractNumbers("ерэн найм")[0].kind).toBe("words");
    const [n] = extractNumbers("ерэн найм хувь");
    expect(n.text).toBe("ерэн найм");
    expect(n.start).toBe(0);
    expect(n.end).toBe(9);
  });
});

describe("extractNumbers: mixed language", () => {
  it("orders results by position across languages and digit/word forms", () => {
    const found = extractNumbers("sleep долоон цаг, pulse 68 and glucose ninety eight");
    expect(found.map((n) => [n.value, n.kind])).toEqual([
      [7, "words"],
      [68, "digits"],
      [98, "words"],
    ]);
    for (let i = 1; i < found.length; i++) expect(found[i].start).toBeGreaterThan(found[i - 1].start);
  });

  it("keeps digits and mixed-script words apart", () => {
    expect(values("68 би зургаан")).toEqual([68, 6]);
  });
});

describe("matchesAnyNumber", () => {
  it("is true when some extracted number equals the value", () => {
    expect(matchesAnyNumber(98, "ерэн найм")).toBe(true);
    expect(matchesAnyNumber(120, "My blood pressure is one twenty over eighty")).toBe(true);
    expect(matchesAnyNumber(80, "120/80")).toBe(true);
    expect(matchesAnyNumber(7.5, "унтсан цаг: долоо хагас")).toBe(true);
  });

  it("is false when the speaker never said the value", () => {
    expect(matchesAnyNumber(99, "ерэн найм")).toBe(false);
    expect(matchesAnyNumber(7, "I feel fine")).toBe(false);
    expect(matchesAnyNumber(98, "")).toBe(false);
  });

  it("honours the tolerance", () => {
    expect(matchesAnyNumber(36.6, "36.5")).toBe(false);
    expect(matchesAnyNumber(36.6, "36.5", 0.1)).toBe(true);
    expect(matchesAnyNumber(36.8, "36.5", 0.1)).toBe(false);
  });
});
