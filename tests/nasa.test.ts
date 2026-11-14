import { describe, expect, it } from "vitest";
import { MARS_COMM_DELAY, NASA_HAZARDS, NASA_SOURCES } from "@/lib/nasa/hazards";
import type { HazardKey } from "@/lib/types";

const HAZARD_KEYS: HazardKey[] = [
  "radiation",
  "isolation_confinement",
  "distance_from_earth",
  "gravity",
  "hostile_closed_environment",
];

const wordCount = (s: string): number => s.trim().split(/\s+/).length;

describe("NASA_HAZARDS", () => {
  it("has exactly the five hazard keys", () => {
    expect(Object.keys(NASA_HAZARDS).sort()).toEqual([...HAZARD_KEYS].sort());
  });

  it.each(HAZARD_KEYS)("%s has https url and non-empty bilingual name and summary", (key) => {
    const h = NASA_HAZARDS[key];
    expect(h.url).toMatch(/^https:\/\/www\.nasa\.gov\/hrp\//);
    for (const lang of ["en", "mn"] as const) {
      expect(h.name[lang].trim().length).toBeGreaterThan(0);
      expect(h.summary[lang].trim().length).toBeGreaterThan(0);
      expect(wordCount(h.summary[lang])).toBeLessThanOrEqual(25);
    }
    expect(typeof h.verified).toBe("boolean");
  });

  it("uses NASA's English names and the workbook's Mongolian wording", () => {
    expect(NASA_HAZARDS.gravity.name.en).toBe("Gravity Fields");
    expect(NASA_HAZARDS.gravity.name.mn).toBe("Таталцал");
    expect(NASA_HAZARDS.hostile_closed_environment.name.mn).toBe("Хаалттай орчин");
    expect(NASA_HAZARDS.isolation_confinement.name.mn).toBe("Тусгаарлалт ба хязгаарлалт");
  });

  it("keeps Mongolian text in Cyrillic and free of emojis", () => {
    for (const key of HAZARD_KEYS) {
      expect(NASA_HAZARDS[key].name.mn).toMatch(/\p{Script=Cyrillic}/u);
      expect(NASA_HAZARDS[key].summary.mn).toMatch(/\p{Script=Cyrillic}/u);
      for (const text of [NASA_HAZARDS[key].summary.en, NASA_HAZARDS[key].summary.mn]) {
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it("never uses diagnosis or treatment wording", () => {
    for (const key of HAZARD_KEYS) {
      expect(NASA_HAZARDS[key].summary.en).not.toMatch(/diagnos|treat|drug|medicat/i);
    }
  });
});

describe("NASA_SOURCES", () => {
  it("lists the three HRP pages with https urls and the fetch date", () => {
    expect(NASA_SOURCES.map((s) => s.url)).toEqual([
      "https://www.nasa.gov/hrp/hazards/",
      "https://www.nasa.gov/hrp/risks/",
      "https://www.nasa.gov/hrp/ongoing-hrp-research/",
    ]);
    for (const s of NASA_SOURCES) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.fetchedOn).toBe("2026-11-14");
      expect(typeof s.ok).toBe("boolean");
    }
  });

  it("only marks hazards verified when the hazards page was fetched ok", () => {
    const hazardsPageOk = NASA_SOURCES.find((s) => s.url.endsWith("/hazards/"))?.ok ?? false;
    for (const key of HAZARD_KEYS) {
      if (NASA_HAZARDS[key].verified) expect(hazardsPageOk).toBe(true);
    }
  });
});

describe("MARS_COMM_DELAY", () => {
  it("is not quoted as verified unless it carries a figure", () => {
    expect(MARS_COMM_DELAY.note.length).toBeGreaterThan(0);
    if (MARS_COMM_DELAY.minutes === null) expect(MARS_COMM_DELAY.verified).toBe(false);
    else expect(MARS_COMM_DELAY.minutes).toBeGreaterThan(0);
  });
});
