import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_GUIDES,
  CPR_RATE,
  STEP_ARTS,
  beatIntervalMs,
  beatsAt,
  clampRate,
  cyclePosition,
  findBuiltInGuide,
  formatElapsed,
  suggestGuides,
} from "@/lib/emergency";
import type { DashboardPayload, KpiKey, KpiStat, MeasurementValue, RedFlagRule } from "@/lib/types";
import { DASHBOARD_FIXTURES } from "@/lib/fixtures/dashboard";
import { STEP_ART, StepArt } from "@/components/emergency/art";
import { GuideGrid } from "@/components/emergency/GuideGrid";
import { GuideStepView } from "@/components/emergency/GuideStepView";
import { EmergencyGuidePanel } from "@/components/emergency/EmergencyGuidePanel";
import { IfWorseCard } from "@/components/dashboard/IfWorseCard";
import { NAV_ITEMS } from "@/components/dashboard/TopBar";

describe("CPR metronome maths", () => {
  it("runs inside the sourced 100-120 a minute range", () => {
    expect(CPR_RATE).toEqual({ min: 100, max: 120, default: 110 });
    expect(clampRate(80)).toBe(100);
    expect(clampRate(150)).toBe(120);
    expect(clampRate(Number.NaN)).toBe(110);
    expect(clampRate(112.4)).toBe(112);
  });

  it("gives the beat interval in milliseconds", () => {
    expect(beatIntervalMs(100)).toBe(600);
    expect(beatIntervalMs(120)).toBe(500);
    expect(beatIntervalMs(110)).toBeCloseTo(545.45, 1);
    expect(beatIntervalMs(200)).toBe(500); // clamped
  });

  it("counts beats from the first cue at 0 ms and positions them in cycles of 30", () => {
    expect(beatsAt(0, 120)).toBe(1);
    expect(beatsAt(499, 120)).toBe(1);
    expect(beatsAt(500, 120)).toBe(2);
    expect(beatsAt(60_000, 120)).toBe(121);
    expect(beatsAt(-5, 120)).toBe(0);
    expect(cyclePosition(0)).toBe(0);
    expect(cyclePosition(1)).toBe(1);
    expect(cyclePosition(30)).toBe(30);
    expect(cyclePosition(31)).toBe(1);
    // 110 a minute: one cycle of 30 takes a little over 16 seconds
    expect(30 * beatIntervalMs(110)).toBeCloseTo(16_364, 0);
  });

  it("formats the running timer as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_999)).toBe("0:09");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_600_000)).toBe("60:00");
    expect(formatElapsed(-10)).toBe("0:00");
  });
});

function payload(values: Partial<Record<KpiKey, MeasurementValue>>, rules: RedFlagRule[] = []): Pick<DashboardPayload, "kpis" | "summary"> {
  const kpis = Object.entries(values).map(([key, value]) => ({ key, value }) as unknown as KpiStat);
  const redFlags = rules.map((rule) => ({ rule, keys: [], text: { en: "", mn: "" } }));
  return { kpis, summary: { redFlags } as unknown as DashboardPayload["summary"] };
}

describe("contextual suggestions (If it gets worse)", () => {
  it("dizziness reported today points to the fainting guide", () => {
    expect(suggestGuides(payload({ symptom_dizziness: 1 }))).toEqual([{ scenarioId: "fainting", reason: "dizziness" }]);
    expect(suggestGuides(payload({ symptom_dizziness: 0 }))).toEqual([]);
  });

  it("the headache-plus-blurred-vision flag points to get-help, naming no injury", () => {
    expect(suggestGuides(payload({}, ["HEADACHE_PLUS_VISION"]))).toEqual([{ scenarioId: "call-for-help", reason: "headache_vision" }]);
  });

  it("serious words in a note are routed like speech; unknown words fall back to get-help", () => {
    expect(suggestGuides(payload({ symptom_note: "some chest pain after exercise" }, ["SERIOUS_SYMPTOM_WORD"]))).toEqual([
      { scenarioId: "chest-pain", reason: "note_words" },
    ]);
    expect(suggestGuides(payload({ day_note: "severe pain in my back" }, ["SERIOUS_SYMPTOM_WORD"]))).toEqual([
      { scenarioId: "call-for-help", reason: "note_words" },
    ]);
    // without the flag a note alone suggests nothing (no new thresholds)
    expect(suggestGuides(payload({ symptom_note: "chest pain" }))).toEqual([]);
  });

  it("keeps one suggestion per guide, in order, at most two", () => {
    const all = suggestGuides(payload({ symptom_dizziness: 1 }, ["HEADACHE_PLUS_VISION", "VITAL_RED", "SERIOUS_SYMPTOM_WORD"]));
    expect(all).toEqual([
      { scenarioId: "fainting", reason: "dizziness" },
      { scenarioId: "call-for-help", reason: "headache_vision" },
    ]);
  });

  it("works on every dashboard fixture and only names guides that exist", () => {
    for (const f of DASHBOARD_FIXTURES) {
      for (const s of suggestGuides(f.payload)) expect(findBuiltInGuide(s.scenarioId), f.id).not.toBeNull();
    }
  });
});

describe("emergency guide components (server render smoke tests)", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it("draws every step illustration as inline SVG", () => {
    expect(Object.keys(STEP_ART).sort()).toEqual([...STEP_ARTS].sort());
    for (const art of STEP_ARTS) {
      const out = html(createElement(StepArt, { art }));
      expect(out, art).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(out, art).not.toMatch(/<img|<image/);
    }
  });

  it("renders the grid with every guide as a button, get-help last, suggestions marked", () => {
    const out = html(createElement(GuideGrid, { scenarios: BUILTIN_GUIDES, lang: "en", onOpen: () => {}, suggested: ["fainting"], scope: "t" }));
    expect(out.match(/<button/g)).toHaveLength(BUILTIN_GUIDES.length);
    expect(out).toContain("Suggested today");
    expect(out.indexOf("Fainting or feeling faint")).toBeLessThan(out.indexOf("Not breathing: CPR"));
    expect(out.lastIndexOf("Get help now")).toBeGreaterThan(out.indexOf("Burns and scalds"));
    const mn = html(createElement(GuideGrid, { scenarios: BUILTIN_GUIDES, lang: "mn", onOpen: () => {}, scope: "t" }));
    expect(mn).toContain("Амьсгалахгүй байна: CPR");
  });

  it("renders a CPR step with progress, the metronome, call for help and the not-reviewed note", () => {
    const cpr = findBuiltInGuide("not-breathing")!;
    const props = {
      scenario: cpr,
      lang: "en" as const,
      step: 3,
      onStep: () => {},
      onBack: () => {},
      onCallHelp: () => {},
      onOpenGuide: () => {},
      titleOf: () => null,
    };
    const out = html(createElement(GuideStepView, props));
    expect(out).toContain(`4 / ${cpr.steps.length}`);
    expect(out).toContain("Compression rhythm");
    expect(out).toContain("110 a minute");
    expect(out).toContain("Call for help");
    expect(out).toContain("Not yet reviewed by a medical professional.");
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("sja.org.uk");
    const first = html(createElement(GuideStepView, { ...props, step: 0 }));
    expect(first).not.toContain("Compression rhythm");
  });

  it("the dashboard panel shows the grid or a guide in place, and the tab is in the tablist", () => {
    expect(NAV_ITEMS.map((n) => n.id)).toContain("guide");
    const base = { scenarios: [...BUILTIN_GUIDES], lang: "en" as const, onOpenId: () => {}, suggested: [] };
    expect(html(createElement(EmergencyGuidePanel, { ...base, openId: null }))).toContain("Choose a situation");
    const open = html(createElement(EmergencyGuidePanel, { ...base, openId: "choking" }));
    expect(open).toMatch(/<h3[^>]*>Choking<\/h3>/);
    expect(open).toContain("1 / 6");
    expect(open).toContain("Get help now.");
  });

  it("the If-it-gets-worse card names the guide and the reason", () => {
    const out = html(
      createElement(IfWorseCard, { suggestion: { scenarioId: "fainting", reason: "dizziness" }, scenarios: BUILTIN_GUIDES, onOpen: () => {} }),
    );
    expect(out).toContain("If it gets worse: Fainting or feeling faint");
    expect(out).toContain("Dizziness was reported today.");
    expect(html(createElement(IfWorseCard, { suggestion: undefined, scenarios: BUILTIN_GUIDES, onOpen: () => {} }))).toBe("");
  });
});
