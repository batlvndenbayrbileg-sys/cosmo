import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { Lang } from "@/lib/types";
import { dictionaries } from "@/i18n/dictionary";
import { signatureStrings } from "@/i18n/strings/signature";
import { POST_TIMEPOINTS, REFERENCE_CREW } from "@/lib/signature/config";
import { hasForbiddenWording } from "@/lib/signature/facts";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData } from "@/server/signature/files";
import {
  classLabel,
  drawerSeries,
  envelopeFor,
  fingerprintRows,
  markerTooltip,
  noiseCaption,
  noiseStrip,
  otherChanges,
  panelOf,
  reasonText,
  triageTrack,
} from "@/components/signature/logic";
import { TriageCard } from "@/components/signature/TriageCard";
import { FingerprintCard } from "@/components/signature/FingerprintCard";
import { SignatureView } from "@/components/signature/SignatureView";

const view = buildSignatureView(getLabData());
// the provider's props type demands `children`; React.createElement takes children as arguments
const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const html = (el: ReactElement) => renderToStaticMarkup(el);
const mn = (el: ReactElement) => renderToStaticMarkup(createElement(Provider, { initialLang: "mn" }, el));
/** visible text of rendered markup (tags and attributes removed) */
const textOf = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

describe("signature T7: page data", () => {
  it("scores the four post-flight panels of C001..C004 and keeps the six markers in display order", () => {
    expect(view.crew).toEqual([...REFERENCE_CREW]);
    expect(view.timepoints).toEqual([...POST_TIMEPOINTS]);
    expect(view.markers.map((m) => m.name)).toEqual(["il_6", "mcp_1", "il_10", "il_27", "glucose", "monocytes"]);
    expect(view.markers.map((m) => m.tier)).toEqual(["core", "core", "core", "supporting", "supporting", "supporting"]);
    expect(view.markers.map((m) => m.unit)).toEqual(["pg/mL", "pg/mL", "pg/mL", "pg/mL", "mg/dL", "%"]);
    for (const c of REFERENCE_CREW) {
      for (const p of view.panels[c]) {
        const f = SIGNATURE_REFERENCE.panels[`${c}_${p.timepoint}`];
        expect(p.fri, `${c} ${p.timepoint}`).toBeCloseTo(f.fri as number, 1);
        expect(p.cls).toBe(f.class);
      }
    }
    expect(view.qcLog).toHaveLength(12);
    // serialisable: it crosses the server -> client boundary as props
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("z at R+1 behind the Inspiration4 envelope matches the build-prompt numbers", () => {
    const z = (name: string) => view.markers.find((m) => m.name === name)!.zR1;
    const r = (rec: Record<string, number | null>) => REFERENCE_CREW.map((c) => Math.round((rec[c] as number) * 100) / 100);
    expect(r(z("il_6"))).toEqual([5.47, 1.56, 6.57, 2.94]);
    expect(r(z("mcp_1"))).toEqual([1.66, 1.87, 3.87, 0.53]);
    expect(r(z("monocytes"))).toEqual([1.34, 3.26, 3.07, 1.11]);
    // C003's envelope = min-max of the other three crew
    const env = envelopeFor(view.markers[0], "C003")!;
    expect(env[0]).toBeCloseTo(1.56, 2);
    expect(env[1]).toBeCloseTo(5.47, 2);
  });
});

describe("signature T7: Triage card logic", () => {
  it("C003 R+1: track 67 with whisker 65-68, teal high zone, badge Expected flight response", () => {
    const p = panelOf(view, "C003", "R+1");
    const track = triageTrack(p);
    expect(track.friLabel).toBe("67");
    expect(track.bandLabel).toEqual(["65", "68"]);
    expect(track.zones.map((z) => [z.from, z.to, z.tone])).toEqual([
      [0, 20, "slate"],
      [20, 40, "amber"],
      [40, 100, "teal"],
    ]);
    expect(classLabel(p.cls, "en")).toBe("Expected flight response");
    expect(reasonText(p, "en")).toBe("Day 1 after landing: inside the flight window");
    expect(p.borderline).toBe(false);
  });

  it("C002 R+45: 53, red high zone, Unexpected activation, outside the window", () => {
    const p = panelOf(view, "C002", "R+45");
    const track = triageTrack(p);
    expect(track.friLabel).toBe("53");
    expect(track.bandLabel).toEqual(["50", "62"]);
    expect(track.zones[2].tone).toBe("red");
    expect(classLabel(p.cls, "en")).toBe("Unexpected activation");
    expect(reasonText(p, "en")).toBe("Day 45 after landing: outside the 7-day flight window");
  });

  it("the timepoint selector switches the panel: C003 R+45 12, R+82 30, R+194 57", () => {
    expect(POST_TIMEPOINTS.map((t) => triageTrack(panelOf(view, "C003", t)).friLabel)).toEqual(["67", "12", "30", "57"]);
    expect(classLabel(panelOf(view, "C003", "R+82").cls, "en")).toBe("Indeterminate");
    expect(panelOf(view, "C001", "R+1").borderline).toBe(true);
  });

  it('"How sure are we?": 12 control dots from the fixture, max 37.4, 2 of 12 scored 36-37', () => {
    const strip = noiseStrip();
    expect(strip.dots).toEqual([0, 1.2, 4.4, 6, 7.8, 7.9, 9, 9.3, 18.1, 18.9, 36.5, 37.4]);
    expect(strip.n).toBe(12);
    expect(strip.max).toBe(37.4);
    expect(strip.median).toBe(8.4);
    expect(noiseCaption(strip, "en")).toBe("2 of 12 no-flight controls scored 36–37");
    expect(noiseCaption(strip, "mn")).toBe("Нислэггүй 12 хяналтаас 2 нь 36–37 оноо авсан");
  });
});

describe("signature T7: Fingerprint card logic", () => {
  it("C003 R+1: IL-6 bar capped at 4 with the build-prompt tooltip", () => {
    const rows = fingerprintRows(view, panelOf(view, "C003", "R+1"), "en");
    expect(rows.map((r) => r.label)).toEqual(["IL-6", "MCP-1", "IL-10", "IL-27", "Glucose", "Monocytes %"]);
    const il6 = rows[0];
    expect(il6.bar).toBe(4);
    expect(il6.capped).toBe(true);
    expect(il6.z).toBeCloseTo(6.57, 2);
    expect(markerTooltip(il6, "en")).toBe("7.6 pg/mL, baseline 2.67, x2.8, above all your pre-flight values");
    expect(markerTooltip(rows[3], "en")).toBe("2096.95 pg/mL, baseline 1627.26, x1.3, within your pre-flight values");
    expect(markerTooltip(rows[5], "en")).toBe("9.4 %, baseline 6.8, x1.4, above all your pre-flight values");
    expect(rows.slice(1).every((r) => !r.capped)).toBe(true);
    expect(rows[1].bar).toBeCloseTo(3.87, 2);
  });

  it("C003 R+45: glucose has no bar, removed by the quality check", () => {
    const rows = fingerprintRows(view, panelOf(view, "C003", "R+45"), "en");
    const glucose = rows.find((r) => r.name === "glucose")!;
    expect(glucose.bar).toBeNull();
    expect(glucose.missing).toBe("qc");
    expect(markerTooltip(glucose, "en")).toBe("removed by a quality check");
    expect(glucose.envelope).not.toBeNull();
  });

  it("other large changes: C002 R+45 IL-8 x47; C003 R+1 IL-13 x8.0 and IL-22 x4.0", () => {
    expect(otherChanges(panelOf(view, "C002", "R+45"))).toEqual([{ label: "IL-8", fold: "47", direction: "up" }]);
    expect(otherChanges(panelOf(view, "C003", "R+1"))).toEqual([
      { label: "IL-13", fold: "8.0", direction: "up" },
      { label: "IL-22", fold: "4.0", direction: "up" },
    ]);
  });

  it("the analyte drawer shows the seven draws and the own pre-flight baseline", () => {
    const d = drawerSeries(view, "il_6", "C003")!;
    expect(d.points.map((p) => p.tp)).toEqual(["L-92", "L-44", "L-3", "R+1", "R+45", "R+82", "R+194"]);
    expect(d.points[3].value).toBe(7.6);
    expect(d.baseline).toBe(2.67);
    expect(d.unit).toBe("pg/mL");
    const g = drawerSeries(view, "glucose", "C003")!;
    expect(g.points.find((p) => p.tp === "R+45")!.value).toBeNull();
    expect(drawerSeries(view, "nope", "C003")).toBeNull();
  });
});

describe("signature T7: cards (server render smoke tests)", () => {
  it("Triage card C003 R+1: 67, range 65 to 68, badge, reason, source, selector, popover trigger", () => {
    const out = html(
      createElement(TriageCard, { panel: panelOf(view, "C003", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }),
    );
    expect(out).toContain(">67<");
    expect(out).toContain("range 65 to 68");
    expect(out).toContain("Expected flight response");
    expect(out).toContain("Day 1 after landing: inside the flight window");
    expect(out).toContain("How sure are we?");
    expect(out).toContain("2 of 12 no-flight controls scored 36–37");
    expect(out).toContain("Blood panels: Inspiration4 C003, NASA OSDR data, shown for demonstration");
    for (const tp of POST_TIMEPOINTS) expect(out).toContain(`>${tp}<`);
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('data-fri="66.9"');
  });

  it("Triage card marks a borderline panel and renders in Mongolian", () => {
    const en = html(createElement(TriageCard, { panel: panelOf(view, "C001", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }));
    expect(en).toContain("borderline");
    const out = mn(createElement(TriageCard, { panel: panelOf(view, "C003", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }));
    expect(out).toContain("Хүлээгдэж буй нислэгийн хариу урвал");
    expect(out).toContain("Хэр итгэлтэй вэ?");
  });

  it("Fingerprint card C003 R+1: six rows with tooltips, capped IL-6, other large changes as information only", () => {
    const out = html(createElement(FingerprintCard, { view, panel: panelOf(view, "C003", "R+1") }));
    expect(out).toContain("7.6 pg/mL, baseline 2.67, x2.8, above all your pre-flight values");
    expect(out).toContain("capped at 4");
    expect(out).toContain("Other large changes");
    expect(out).toContain("information only");
    expect(out).toContain("IL-13 x8.0");
    expect(out).toContain("IL-22 x4.0");
    expect(out.match(/Show [^<]+ over all seven draws/g)).toHaveLength(6);
  });

  it("Fingerprint card C003 R+45 says glucose was removed and lists falls as well as rises", () => {
    const out = html(createElement(FingerprintCard, { view, panel: panelOf(view, "C003", "R+45") }));
    expect(out).toContain("removed by a quality check");
    expect(otherChanges(panelOf(view, "C003", "R+45"))).toEqual([
      { label: "Eotaxin-3", fold: "0.2", direction: "down" },
      { label: "TARC", fold: "0.2", direction: "down" },
      { label: "IL-12p40", fold: "4.6", direction: "up" },
    ]);
    expect(out).toContain("Eotaxin-3 x0.2");
    expect(out).toContain("IL-12p40 x4.6");
  });

  it("a panel without other large changes says so", () => {
    const quiet = view.crew.flatMap((c) => view.panels[c]).filter((p) => p.otherLargeChanges.length === 0);
    expect(quiet.length).toBeGreaterThan(0);
    const out = html(createElement(FingerprintCard, { view, panel: quiet[0] }));
    expect(out).toContain("No other immune or cardiovascular marker changed 3-fold or more");
  });

  it("the page view starts on the requested crew and panel and switches every card together", () => {
    const out = html(createElement(SignatureView, { data: view, initialCrew: "C002", initialTimepoint: "R+45" }));
    expect(out).toContain("Unexpected activation");
    expect(out).toContain("IL-8 x47");
    expect(out).toContain("Inspiration4 C002");
    for (const c of REFERENCE_CREW) expect(out).toContain(`>${c}<`);
    expect(out).toContain("Decision support, not a diagnosis.");
  });
});

describe("signature T7: strings", () => {
  it("every dashboard.signature key exists in both languages and reaches the merged dictionary", () => {
    const en = Object.keys(signatureStrings.en).sort();
    expect(Object.keys(signatureStrings.mn).sort()).toEqual(en);
    for (const k of en) {
      expect(k.startsWith("dashboard.signature.")).toBe(true);
      expect(dictionaries.en[k]).toBe(signatureStrings.en[k]);
      expect(dictionaries.mn[k]).toBe(signatureStrings.mn[k]);
    }
  });

  it("no forbidden wording (build rule 6) in the signature strings or anything the cards show, both languages", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const [k, text] of Object.entries(signatureStrings[lang])) expect(hasForbiddenWording(text), `${lang} ${k}`).toBe(false);
    }
    for (const c of view.crew) {
      for (const tp of view.timepoints) {
        const page = createElement(SignatureView, { data: view, initialCrew: c, initialTimepoint: tp });
        expect(hasForbiddenWording(textOf(html(page))), `${c} ${tp} en`).toBe(false);
        expect(hasForbiddenWording(textOf(mn(page))), `${c} ${tp} mn`).toBe(false);
      }
    }
  });

  it("the cards hold no hard-coded fixture numbers: every number comes from the engine or the fixture", () => {
    const dir = path.join(process.cwd(), "src", "components", "signature");
    for (const f of ["TriageCard.tsx", "FingerprintCard.tsx", "SignatureView.tsx"]) {
      const src = readFileSync(path.join(dir, f), "utf8");
      for (const n of ["66.9", "37.4", "2.67", "47.04", "12.2"]) expect(src.includes(n), `${f} ${n}`).toBe(false);
    }
  });
});
