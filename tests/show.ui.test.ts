import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { KpiKey, Lang, MeasurementValue } from "@/lib/types";
import { I18nProvider } from "@/i18n/I18nProvider";
import { dictionaries } from "@/i18n/dictionary";
import type { HistoryDay } from "@/lib/health/baseline";
import { showVitalFromStat, type ShowPanel } from "@/lib/show";
import { decideShow } from "@/server/agent/show";
import { ShowPanelView, ShowStage } from "@/components/show/ShowPanels";
import { BodyMap } from "@/components/show/BodyMap";
import { saraaGreen } from "@/lib/fixtures/dashboard";

const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang; children?: ReactNode }>;

function render(node: ReactNode, lang: Lang = "en"): string {
  return renderToStaticMarkup(createElement(Provider, { initialLang: lang }, node));
}

const HISTORY: HistoryDay[] = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-10-${String(17 + i).padStart(2, "0")}`,
  values: { heart_rate: 64 + (i % 5), sleep_hours: 7 + (i % 3) * 0.5, bp_systolic: 118, bp_diastolic: 76, water_ml: 2100 },
}));
const TODAY: Partial<Record<KpiKey, MeasurementValue>> = {
  heart_rate: 72,
  sleep_hours: 6.5,
  bp_systolic: 124,
  bp_diastolic: 80,
  water_ml: 1500,
  temperature_c: 36.8,
  glucose_mgdl: 98,
  mood: 4,
  exercise_min: 30,
  vision_check: 0,
};

function panels(text: string, recorded: KpiKey[] = [], state: "KPI_CAPTURE" | "DONE" = "KPI_CAPTURE"): ShowPanel[] {
  return decideShow({ text, lang: "en", state, recorded, values: TODAY, history: HISTORY, summary: false });
}

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("panel server render", () => {
  it("ECG card: the value, its status, the baseline and a trace labelled simulated (en + mn)", () => {
    const [ecg] = panels("how is my heart rate?");
    const en = render(createElement(ShowPanelView, { panel: ecg }));
    expect(en).toContain('data-panel="ecg"');
    expect(strip(en)).toContain("72");
    expect(en).toContain("Simulated trace");
    expect(en).toMatch(/Usual 6\d/);
    expect(en).toContain("demo parameter");
    expect(en).toContain('aria-label="Heart rate 72 bpm. The moving trace is a simulated illustration, not a recording."');
    const mn = render(createElement(ShowPanelView, { panel: ecg }), "mn");
    expect(mn).toContain("Симуляци долгион");
    expect(mn).toContain("Пульс");
    expect(mn).toContain("удаа/мин");
  });

  it("vital card: blood pressure as one value with the personal band and the 'just recorded' tag", () => {
    const [bp] = panels("", ["bp_systolic", "bp_diastolic"]);
    const html = render(createElement(ShowPanelView, { panel: bp }));
    expect(strip(html)).toContain("124/80");
    expect(html).toContain("Blood pressure");
    expect(html).toContain("Just recorded");
    expect(html).toContain('data-slot="show-band"');
    expect(html).toContain('data-slot="show-today"');
    expect(render(createElement(ShowPanelView, { panel: bp }), "mn")).toContain("Сая бүртгэгдлээ");
  });

  it("ring card: water against the demo target, SpO2 as not measured", () => {
    const [water] = panels("how much water did I drink?");
    const w = strip(render(createElement(ShowPanelView, { panel: water })));
    expect(w).toContain("1500 of 2000 ml (demo target)");
    const [spo2] = panels("what is my oxygen?");
    const s = render(createElement(ShowPanelView, { panel: spo2 }));
    expect(s).toContain("Not measured in this prototype");
    expect(s).toContain('data-metric="spo2"');
    expect(strip(s)).not.toMatch(/\d+ ?%/);
  });

  it("trend card: 14 days, the band label and today's value", () => {
    const [trend] = panels("show my sleep over the past two weeks");
    const html = render(createElement(ShowPanelView, { panel: trend }));
    expect(html).toContain('data-panel="trend"');
    expect(html).toContain("Personal baseline band");
    expect(strip(html)).toContain("Past 14 days and today");
    expect(strip(html)).toContain("6.5 h");
    expect(render(createElement(ShowPanelView, { panel: trend }), "mn")).toContain("Хувийн суурь түвшний муж");
  });

  it("vital card: a scale value reads '4/5' once, never '4/5 /5' (en + mn)", () => {
    const [mood] = panels("how is my mood?", [], "DONE");
    const en = strip(render(createElement(ShowPanelView, { panel: mood })));
    expect(en).toContain("4/5");
    expect(en).not.toMatch(/\/5\s*\/5/);
    const mn = strip(render(createElement(ShowPanelView, { panel: mood }), "mn"));
    expect(mn).not.toMatch(/\/5\s*\/5/);
  });

  it("link cards: Signature Triage opens its page, labs say where they are", () => {
    const sig = render(createElement(ShowPanelView, { panel: { kind: "signature", id: "signature" }, checkInId: "c1" }));
    expect(sig).toContain('href="/signature?checkInId=c1"');
    // the crew member's own linked reference panel, like the dashboard's Signature link
    const own = render(createElement(ShowPanelView, { panel: { kind: "signature", id: "signature", reference: "C001" }, checkInId: "c1" }));
    expect(own).toContain('href="/signature?crew=C001&amp;checkInId=c1"');
    expect(sig).toContain("Signature Triage");
    const labs = render(createElement(ShowPanelView, { panel: { kind: "labs", id: "labs" } }));
    expect(labs).toContain("It is in the Labs tab of your dashboard.");
    const labsButton = render(createElement(ShowPanelView, { panel: { kind: "labs", id: "labs" }, onOpenLabs: () => {} }));
    expect(labsButton).toContain("Open the Labs tab");
  });

  it("the glass stack: header, every panel, footer; nothing without a show", () => {
    const shown = panels("how are my heart rate and blood pressure?");
    const html = render(
      createElement(ShowStage, { show: { seq: 1, panels: shown }, hold: true, onDismiss: () => {}, placement: "wide" }),
    );
    expect(html).toContain('data-slot="show-stage"');
    expect(html).toContain("Health dashboard");
    expect(html).toContain("Prototype data");
    expect(html).toContain("Concept demonstration · not clinically validated");
    expect(html).toContain('aria-label="Hide these panels"');
    expect(html.match(/data-panel=/g)).toHaveLength(2);
    const mn = render(
      createElement(ShowStage, { show: { seq: 1, panels: shown }, hold: true, onDismiss: () => {}, placement: "narrow", top: 300 }),
      "mn",
    );
    expect(mn).toContain("Эрүүл мэндийн самбар");
    expect(mn).toContain("Концепцийн үзүүлэн");
    expect(render(createElement(ShowStage, { show: null, hold: false, onDismiss: () => {}, placement: "wide" }))).toBe("");
  });

  it("on the check-in stage the panels stay under the clarification bubble (z-10) and the vision card (z-40)", () => {
    const shown = panels("how is my heart rate?");
    const z = (placement: "wide" | "narrow" | "dashboard") => {
      const html = render(createElement(ShowStage, { show: { seq: 1, panels: shown }, hold: true, onDismiss: () => {}, placement, top: 10 }));
      const cls = /data-slot="show-stage"[^>]*class="([^"]+)"/.exec(html)?.[1] ?? /class="([^"]+)"[^>]*data-slot="show-stage"/.exec(html)?.[1] ?? "";
      return cls.split(/\s+/).filter((c) => /^z-/.test(c));
    };
    expect(z("wide")).toEqual(["z-[5]"]);
    expect(z("narrow")).toEqual(["z-[5]"]);
    expect(z("dashboard")).toEqual(["z-40"]);
  });
});

describe("body map server render", () => {
  it("puts each value at its body part with its status, SpO2 as not measured (en + mn)", () => {
    const [body] = panels("show my body");
    if (body.kind !== "body") throw new Error("expected the body map");
    const html = render(createElement(BodyMap, { vitals: body.vitals, animate: false }));
    const text = strip(html);
    for (const site of ["Head", "Forehead", "Eyes", "Lungs", "Heart", "Abdomen", "Legs"]) expect(text).toContain(site);
    expect(text).toContain("72 bpm");
    expect(text).toContain("124/80");
    expect(text).toContain("36.8 °C");
    expect(text).toContain("SpO2 not measured");
    // a scale value carries its name (the "4/5" alone would not say what it is)
    expect(text).toContain("Mood 4/5");
    expect(html.match(/data-site=/g)).toHaveLength(7);
    const mn = strip(render(createElement(BodyMap, { vitals: body.vitals, animate: false }), "mn"));
    expect(mn).toContain("Зүрх");
    expect(mn).toContain("72 удаа/мин");
    expect(mn).toContain("SpO2 хэмжээгүй");
    expect(mn).toContain("Сэтгэл 4/5");
  });

  it("says 'not recorded' at a part with no value today", () => {
    const html = strip(render(createElement(BodyMap, { vitals: [], animate: false })));
    expect(html).toContain("Not recorded");
  });

  it("every body-map and show string exists in both languages", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const key of Object.keys(dictionaries.en).filter((k) => k.startsWith("checkin.show.") || k.startsWith("dashboard.bodyMap."))) {
        expect(dictionaries[lang][key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });

  it("draws the dashboard's own numbers (the Vitals tab maps payload.kpis with showVitalFromStat)", () => {
    const vitals = saraaGreen.kpis.map(showVitalFromStat);
    const hr = saraaGreen.kpis.find((k) => k.key === "heart_rate")!;
    const html = strip(render(createElement(BodyMap, { vitals, animate: false })));
    expect(html).toContain(`${hr.value} bpm`);
    const sd = vitals.find((v) => v.key === "heart_rate")!.sd;
    expect(sd).toBeGreaterThanOrEqual(hr.baselineSd ?? 0);
  });
});
