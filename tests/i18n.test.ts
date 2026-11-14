import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { areaDictionaries, dictionaries } from "@/i18n/dictionary";
import { interpolate, resetMissingKeyWarnings, translate } from "@/i18n/translate";
import type { Status } from "@/lib/types";

const areas = Object.entries(areaDictionaries);

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("area dictionaries", () => {
  it("covers the five expected areas", () => {
    expect(Object.keys(areaDictionaries).sort()).toEqual(
      ["checkin", "crew", "dashboard", "earth", "shell"].sort(),
    );
  });

  for (const [area, dict] of areas) {
    describe(area, () => {
      it("has identical key sets in en and mn", () => {
        const en = Object.keys(dict.en).sort();
        const mn = Object.keys(dict.mn).sort();
        const onlyEn = en.filter((k) => !(k in dict.mn));
        const onlyMn = mn.filter((k) => !(k in dict.en));
        expect({ onlyEn, onlyMn }).toEqual({ onlyEn: [], onlyMn: [] });
      });

      it(`prefixes every key with "${area}."`, () => {
        const bad = [...Object.keys(dict.en), ...Object.keys(dict.mn)].filter(
          (k) => !k.startsWith(`${area}.`),
        );
        expect(bad).toEqual([]);
      });

      it("has no empty strings and uses the same {placeholders} in both languages", () => {
        for (const key of Object.keys(dict.en)) {
          expect(dict.en[key].trim(), `en ${key}`).not.toBe("");
          expect(dict.mn[key]?.trim(), `mn ${key}`).not.toBe("");
          expect(placeholders(dict.mn[key] ?? ""), `placeholders of ${key}`).toEqual(
            placeholders(dict.en[key]),
          );
        }
      });

      it("contains no emoji", () => {
        const emoji = /\p{Extended_Pictographic}/u;
        for (const lang of ["en", "mn"] as const) {
          for (const [key, text] of Object.entries(dict[lang])) {
            expect(emoji.test(text), `${lang} ${key}`).toBe(false);
          }
        }
      });
    });
  }
});

describe("merged dictionaries", () => {
  it("contain every area key in both languages with no cross-area collisions", () => {
    for (const lang of ["en", "mn"] as const) {
      const total = areas.reduce((n, [, d]) => n + Object.keys(d[lang]).length, 0);
      expect(Object.keys(dictionaries[lang]).length).toBe(total);
      for (const [, d] of areas) {
        for (const [key, text] of Object.entries(d[lang])) {
          expect(dictionaries[lang][key]).toBe(text);
        }
      }
    }
  });
});

describe("shell strings", () => {
  it("name all four statuses in both languages", () => {
    const statuses: Status[] = ["green", "yellow", "red", "no_data"];
    const en = statuses.map((s) => dictionaries.en[`shell.status.${s}`]);
    const mn = statuses.map((s) => dictionaries.mn[`shell.status.${s}`]);
    expect(en).toEqual(["Normal", "Watch", "Alert", "No data"]);
    expect(mn).toEqual(["Хэвийн", "Анхаар", "Сэрэмжлүүлэг", "Өгөгдөлгүй"]);
  });

  it("keep the honesty labels", () => {
    expect(dictionaries.en["shell.ribbon.text"]).toMatch(/not a medical device/i);
    expect(dictionaries.en["shell.ribbon.text"]).toMatch(/demo parameters/i);
    expect(dictionaries.en["shell.ribbon.text"]).toMatch(/simulated/i);
    expect(dictionaries.mn["shell.demoParameter"]).toBe("демо параметр");
    expect(dictionaries.mn["shell.simulated"]).toBe("симуляци");
  });

  it("write Mongolian strings in Cyrillic", () => {
    const cyrillic = /\p{Script=Cyrillic}/u;
    const keys = Object.keys(areaDictionaries.shell.mn).filter(
      // brand name, the English language label and a pure-placeholder template are language-neutral
      (k) =>
        k !== "shell.title" &&
        k !== "shell.lang.en" &&
        !/^(\{\w+\}|[:\s/])*$/.test(areaDictionaries.shell.mn[k]),
    );
    for (const key of keys) {
      expect(cyrillic.test(areaDictionaries.shell.mn[key]), key).toBe(true);
    }
  });
});

describe("font subsets for Mongolian", () => {
  const layoutSrc = readFileSync(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
  const fontData = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "node_modules/next/dist/compiled/@next/font/dist/google/font-data.json",
      ),
      "utf8",
    ),
  ) as Record<string, { subsets: string[] }>;

  it("Inter is loaded with the extended Cyrillic subset (Ө and Ү are not in plain cyrillic)", () => {
    const match = layoutSrc.match(/Inter\(\{[\s\S]*?subsets:\s*\[([^\]]*)\]/);
    expect(match, "Inter() call with subsets").not.toBeNull();
    const subsets = [...(match?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
    expect(subsets).toEqual(expect.arrayContaining(["latin", "cyrillic", "cyrillic-ext"]));
    for (const s of subsets) expect(fontData.Inter.subsets).toContain(s);
  });

  it("the Mongolian-specific letters fall outside the plain cyrillic unicode-range", () => {
    // Google's "cyrillic" subset: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116.
    const inCyrillic = (cp: number) =>
      cp === 0x301 ||
      (cp >= 0x400 && cp <= 0x45f) ||
      (cp >= 0x490 && cp <= 0x491) ||
      (cp >= 0x4b0 && cp <= 0x4b1) ||
      cp === 0x2116;
    for (const ch of "ӨөҮү") expect(inCyrillic(ch.codePointAt(0) as number), ch).toBe(false);
    // Every Mongolian letter used in the shell strings that is outside "cyrillic" is in "cyrillic-ext".
    const inExt = (cp: number) => cp >= 0x460 && cp <= 0x52f;
    for (const ch of "ӨөҮү") expect(inExt(ch.codePointAt(0) as number), ch).toBe(true);
  });
});

describe("translate()", () => {
  const dict = {
    "x.greeting": "Hello {name}",
    "x.twice": "{n} and {n} again",
    "x.plain": "Plain text",
    "x.two": "{a}/{b}",
  };

  beforeEach(() => resetMissingKeyWarnings());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the text unchanged when there are no vars", () => {
    expect(translate(dict, "x.plain")).toBe("Plain text");
    expect(translate(dict, "x.greeting")).toBe("Hello {name}");
  });

  it("interpolates {name} placeholders, including repeats and numbers", () => {
    expect(translate(dict, "x.greeting", { name: "Bat" })).toBe("Hello Bat");
    expect(translate(dict, "x.twice", { n: 7 })).toBe("7 and 7 again");
    expect(translate(dict, "x.two", { a: 124, b: "82" })).toBe("124/82");
  });

  it("leaves a placeholder alone when its var is missing, and ignores extra vars", () => {
    expect(translate(dict, "x.two", { a: 1 })).toBe("1/{b}");
    expect(translate(dict, "x.plain", { unused: 1 })).toBe("Plain text");
  });

  it("does not re-interpolate substituted values", () => {
    expect(interpolate("{a}", { a: "{b}", b: "boom" })).toBe("{b}");
  });

  it("returns the key itself when it is missing", () => {
    expect(translate(dict, "x.nope")).toBe("x.nope");
    expect(translate(dict, "x.nope", { name: "Bat" })).toBe("x.nope");
  });

  it("does not treat inherited object properties as keys", () => {
    expect(translate(dict, "toString")).toBe("toString");
    expect(translate(dict, "constructor")).toBe("constructor");
  });

  it("warns once per missing key in development only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubEnv("NODE_ENV", "production");
    translate(dict, "x.missing");
    expect(warn).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "development");
    translate(dict, "x.missing");
    translate(dict, "x.missing");
    translate(dict, "x.other");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("x.missing");
    expect(warn.mock.calls[1][0]).toContain("x.other");
  });

  it("resolves real shell strings in both languages", () => {
    expect(translate(dictionaries.en, "shell.header.missionDay", { day: 12 })).toBe(
      "Mission day 12",
    );
    expect(translate(dictionaries.mn, "shell.header.missionDay", { day: 12 })).toBe(
      "Нислэгийн 12-р өдөр",
    );
  });
});
