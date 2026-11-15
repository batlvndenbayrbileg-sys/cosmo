import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { Lang } from "@/lib/types";
import checkinsJson from "@/data/demo_checkins.json";
import { KITS_TOTAL, TIMEPOINT_DAY } from "@/lib/signature/config";
import {
  BUILT_DEMO_CARDS,
  DEMO_CHECKIN_CREW,
  DEMO_CHECKIN_TODAY,
  PRESENTER_LINES,
  buildDemoBeats,
  demoDrawAdvice,
  demoDss,
  demoSpokenLines,
  simulatedCheckins,
  usualRestingHr,
  type DemoBeat,
  type DemoCard,
  type DemoCheckins,
} from "@/lib/signature/demo";
import { hasDisclaimer, hasForbiddenWording } from "@/lib/signature/facts";
import { SECOND_ASSAY_REFERENCE, SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData, loadSecondAssay } from "@/server/signature/files";
import { drawView, panelOf, recoveryTimeline } from "@/components/signature/logic";
import { SignatureDemo } from "@/components/signature/SignatureDemo";
import SignatureDemoPage from "@/app/demo/signature/page";

const view = buildSignatureView(getLabData(), loadSecondAssay().matrix);
const checkins = checkinsJson as unknown as DemoCheckins;
const beats = buildDemoBeats(view, checkins);
const beat = (id: DemoBeat["id"]) => beats.find((b) => b.id === id)!;

const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const render = (el: ReactElement, lang: Lang = "en") => renderToStaticMarkup(createElement(Provider, { initialLang: lang }, el));
const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

/** EN / MN dialogue of one situation in a doc, line wraps joined */
function dialogue(doc: string, label: string): { en: string; mn: string } {
  const at = doc.indexOf(`**(${label})`);
  expect(at, label).toBeGreaterThan(0);
  const block = doc.slice(at);
  const flat = (s: string | undefined) => (s ?? "").replace(/\s+/gu, " ").trim();
  return { en: flat(/EN: "([\s\S]*?)"\n\nMN:/u.exec(block)?.[1]), mn: flat(/MN: "([\s\S]*?)"\n/u.exec(block)?.[1]) };
}
const ADDENDUM = read("docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md");
const SPEC = read("docs/SIGNATURE_SPEC.md");

describe("signature T9: simulated check-ins (src/data/demo_checkins.json)", () => {
  it("the committed file is what `pnpm demo:checkins` writes: 14 calm days, then 3 days {5.0, 2, 66, 4, 3}, last day 91", () => {
    expect(checkins).toEqual(simulatedCheckins());
    expect(checkins.simulated).toBe(true);
    expect([checkins.crew, checkins.today]).toEqual(["C001", 91]);
    expect([DEMO_CHECKIN_CREW, DEMO_CHECKIN_TODAY]).toEqual(["C001", TIMEPOINT_DAY["R+82"] + 9]);
    expect(checkins.days).toHaveLength(17);
    expect(checkins.days.map((d) => d.day)).toEqual(Array.from({ length: 17 }, (_, i) => 75 + i));
    checkins.days.slice(0, 14).forEach((d, i) => {
      expect(d.sleep_hours).toBeCloseTo(7.0 + 0.1 * (i % 3), 9);
      expect([d.sleep_quality, d.resting_hr, d.fatigue, d.mood]).toEqual([4, 58 + (i % 2), 2, 4]);
    });
    for (const d of checkins.days.slice(14)) {
      expect([d.sleep_hours, d.sleep_quality, d.resting_hr, d.fatigue, d.mood]).toEqual([5.0, 2, 66, 4, 3]);
    }
  });

  it("DSS 90.0 on the first strained day, >= 50 on all three; usual resting HR 58.5", () => {
    const dss = demoDss(checkins);
    expect(dss.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(dss[14]).toBeCloseTo(90.0, 1);
    for (const v of dss.slice(14)) expect(v as number).toBeGreaterThanOrEqual(50);
    for (const v of dss.slice(5, 14)) expect(v as number).toBeLessThan(50);
    expect(usualRestingHr(checkins)).toBe(58.5);
  });

  it("draw advisor on day 91 for C001: rule A2, last panel 9 days ago (R+82), 5 of 8 kits left", () => {
    const a = demoDrawAdvice(view, checkins);
    expect(a.rule).toBe("A2");
    expect(a.daysSinceLastPanel).toBe(9);
    expect([a.kitsLeft, a.kitsTotal]).toEqual([5, KITS_TOTAL]);
  });
});

describe("signature T9: the addendum section 5 script", () => {
  it("eight beats in order, the crew, panel and mission clock of each, contiguous slots within 3:00", () => {
    expect(beats.map((b) => b.id)).toEqual(["intro", "a", "recovery", "c1", "c2", "d", "b", "evidence"]);
    expect(beats.map((b) => `${b.crew} ${b.timepoint}`)).toEqual([
      "C001 R+1",
      "C001 R+1",
      "C001 R+1",
      "C001 R+45",
      "C002 R+45",
      "C003 R+194",
      "C001 R+82",
      "C001 R+1",
    ]);
    expect(beats.map((b) => b.clockDay)).toEqual([1, 1, 1, 45, 45, 194, 91, 1]);
    expect(beats.map((b) => [b.start, b.end])).toEqual([
      [0, 20],
      [20, 55],
      [55, 70],
      [70, 85],
      [85, 120],
      [120, 145],
      [145, 160],
      [160, 180],
    ]);
    for (let i = 1; i < beats.length; i += 1) expect(beats[i].start).toBe(beats[i - 1].end);
    expect(beats[beats.length - 1].end).toBeLessThanOrEqual(180);
    expect(beats.filter((b) => b.simulated).map((b) => b.id)).toEqual(["b"]);
    expect(beat("b").dss).toEqual(demoDss(checkins));
  });

  it("every number on the cards of each beat is the fixture's", () => {
    const fx = (id: string) => SIGNATURE_REFERENCE.panels[id];
    const sa = (id: string) => SECOND_ASSAY_REFERENCE.panels[id];
    const p = (b: DemoBeat) => panelOf(view, b.crew, b.timepoint);
    for (const b of beats) {
      const panel = p(b);
      const ref = fx(`${b.crew}_${b.timepoint}`);
      expect(panel.fri, b.id).toBeCloseTo(ref.fri as number, 1);
      expect(panel.cls, b.id).toBe(ref.class);
      expect(panel.secondAssay?.badge ?? null, b.id).toBe(sa(`${b.crew}_${b.timepoint}`).badge);
    }
    // (a) 48 (40-60), EXPECTED, confirmed by two assays
    expect([p(beat("a")).fri, p(beat("a")).band]).toEqual([expect.closeTo(48.2, 1), [expect.closeTo(39.7, 1), expect.closeTo(60.4, 1)]]);
    expect(p(beat("a")).secondAssay?.badge).toBe("TWO_ASSAY_CONFIRMED");
    // recovery: re-test marker at day 22, one kit used
    const tl = recoveryTimeline(view, "C001", "R+1");
    expect(tl.recovery?.retestMissionDay).toBe(22);
    expect(drawView(view, "C001", "R+1").advice.kitsLeft).toBe(KITS_TOTAL - 1);
    // c1: C001 R+45 -> 1, BASELINE
    expect(p(beat("c1")).fri).toBeCloseTo(1.1, 1);
    expect(p(beat("c1")).cls).toBe("BASELINE");
    // c2: C002 R+45 -> 53, UNEXPECTED, confirmed, IL-8 47 / 40
    const c2 = p(beat("c2"));
    expect([c2.fri, c2.cls, c2.secondAssay?.badge]).toEqual([expect.closeTo(53.4, 1), "UNEXPECTED_ACTIVATION", "TWO_ASSAY_CONFIRMED"]);
    expect(c2.secondAssay?.il8.primaryFold).toBeCloseTo(47.04, 2);
    expect(c2.secondAssay?.il8.secondFold).toBeCloseTo(40.11, 2);
    // d: C003 R+194 -> 57, UNEXPECTED, single assay
    const d = p(beat("d"));
    expect([d.fri, d.cls, d.secondAssay?.badge]).toEqual([expect.closeTo(56.6, 1), "UNEXPECTED_ACTIVATION", "SINGLE_ASSAY"]);
  });

  it("Cosmo's lines are the addendum (a), (c1), (c2), (d) and spec (b) templates, verbatim; (a) in Mongolian with English captions", () => {
    const a = dialogue(ADDENDUM, "a");
    expect(beat("a").cosmo).toMatchObject({ lang: "mn", text: a.mn, caption: a.en, audioFile: "a_mn.mp3" });
    expect(beat("c1").cosmo).toMatchObject({ lang: "en", text: dialogue(ADDENDUM, "c1").en, audioFile: "c1_en.mp3" });
    expect(beat("c2").cosmo).toMatchObject({ lang: "en", text: dialogue(ADDENDUM, "c2").en, audioFile: "c2_en.mp3" });
    expect(beat("d").cosmo).toMatchObject({ lang: "en", text: dialogue(ADDENDUM, "d").en, audioFile: "d_en.mp3" });
    expect(beat("b").cosmo).toMatchObject({ lang: "en", text: dialogue(SPEC, "b").en, audioFile: "b_en.mp3" });
    for (const b of beats) {
      if (!b.cosmo) continue;
      expect(b.cosmo.caption, b.id).toBe(b.cosmo.lang === "en" ? b.cosmo.text : dialogue(ADDENDUM, "a").en);
      expect(hasDisclaimer(b.cosmo.text, b.cosmo.lang), b.id).toBe(true);
      expect(hasForbiddenWording(b.cosmo.text), b.id).toBe(false);
    }
    expect(beats.filter((b) => !b.cosmo).map((b) => b.id)).toEqual(["intro", "recovery", "evidence"]);
  });

  it("the audio generator voices every Cosmo beat in both languages, the MN lines equal the addendum / spec", () => {
    const mn = demoSpokenLines(beats, "mn", view, checkins);
    expect(mn.map((l) => l.id)).toEqual(["a", "c1", "c2", "d", "b"]);
    const want: Record<string, string> = {
      a: dialogue(ADDENDUM, "a").mn,
      c1: dialogue(ADDENDUM, "c1").mn,
      c2: dialogue(ADDENDUM, "c2").mn,
      d: dialogue(ADDENDUM, "d").mn,
      b: dialogue(SPEC, "b").mn,
    };
    for (const l of mn) expect(l.text, l.id).toBe(want[l.id]);
    expect(demoSpokenLines(beats, "en", view, checkins).map((l) => l.id)).toEqual(["a", "c1", "c2", "d", "b"]);
  });

  it("presenter lines are the addendum table's, verbatim", () => {
    expect(Object.keys(PRESENTER_LINES)).toEqual(["intro", "recovery", "c2", "d", "evidence"]);
    for (const [id, line] of Object.entries(PRESENTER_LINES)) {
      expect(ADDENDUM.includes(line as string), id).toBe(true);
      expect(hasForbiddenWording(line as string), id).toBe(false);
    }
  });

  it("a beat whose card was not built is skipped, never a blank screen; check-ins of another crew member skip beat (b)", () => {
    const without = (card: DemoCard) => new Set([...BUILT_DEMO_CARDS].filter((c) => c !== card));
    expect(buildDemoBeats(view, checkins, without("evidence")).map((b) => b.id)).toEqual(["intro", "a", "recovery", "c1", "c2", "d", "b"]);
    expect(buildDemoBeats(view, checkins, without("recovery")).map((b) => b.id)).toEqual(["intro", "a", "c1", "c2", "d", "evidence"]);
    expect(buildDemoBeats(view, checkins, new Set()).map((b) => b.id)).toEqual(["intro"]);
    expect(buildDemoBeats(view, { ...checkins, crew: "C004" }).map((b) => b.id)).not.toContain("b");
    for (const b of beats) expect(b.cards.length > 0 || b.presenter !== null || b.cosmo !== null, b.id).toBe(true);
  });
});

describe("signature T9: /demo/signature page", () => {
  const html = (initialBeat: number, audioFiles: string[] = [], lang: Lang = "en") =>
    textOf(render(createElement(SignatureDemo, { view, beats, audioBase: "/demo/audio/signature", audioFiles, initialBeat }), lang));
  const at = (id: DemoBeat["id"]) => beats.findIndex((b) => b.id === id);

  it("each beat shows its numbers, its mission clock and the Cosmo / presenter captions", () => {
    const a = html(at("a"));
    expect(a).toMatch(/Beat 2 of 8/);
    expect(a).toMatch(/Mission clock: day 1 after landing \(R\+1\)/);
    for (const s of ["48", "range 40 to 60", "Expected flight response", "Confirmed by two assays", "speaks Mongolian, English captions"]) {
      expect(a, s).toContain(s);
    }
    expect(a).toContain(dialogue(ADDENDUM, "a").en);
    expect(a).toContain(dialogue(ADDENDUM, "a").mn);
    expect(html(at("recovery"))).toMatch(/Next re-test: day 22/);
    expect(html(at("recovery"))).toMatch(/7 of 8 kits left/);
    const c1 = html(at("c1"));
    expect(c1).toMatch(/Mission clock: day 45 after landing/);
    expect(c1).toContain("Baseline");
    const c2 = html(at("c2"));
    for (const s of ["53", "Unexpected activation", "Confirmed by two assays", "IL-8", "47"]) expect(c2, s).toContain(s);
    const d = html(at("d"));
    for (const s of ["57", "Single assay", "Mission clock: day 194 after landing"]) expect(d, s).toContain(s);
    expect(textOf(render(createElement(SignatureDemo, { view, beats, audioBase: "", audioFiles: [], initialBeat: 0 })))).toContain(
      PRESENTER_LINES.intro as string,
    );
    expect(html(at("evidence"))).toContain("24 of 36");
  });

  it("beat (b) shows the 'Simulated check-ins' banner, rule A2, 9 days, 5 of 8 kits and the strain sparkline", () => {
    const b = html(at("b"));
    expect(b).toContain("Simulated check-ins: generated days, not a real person's data");
    for (const s of ["Rule A2", "Strain trigger: draw recommended", "Last panel 9 days ago", "5 of 8 kits left", "Daily strain score, last 14 days"]) {
      expect(b, s).toContain(s);
    }
    expect(b).toMatch(/Mission clock: day 91 after landing \(R\+91\)/);
    expect(html(at("a"))).not.toContain("Simulated check-ins");
  });

  it("captions only without a pre-generated clip; 'Pre-generated audio' when the beat's file exists", () => {
    expect(html(at("a"))).toContain("Captions only: no pre-generated audio for this beat");
    expect(html(at("a"), ["a_mn.mp3"])).toContain("Pre-generated audio");
    expect(html(at("c1"), ["a_mn.mp3"])).toContain("Captions only");
  });

  it("no forbidden wording on any beat, both languages", () => {
    for (let i = 0; i < beats.length; i += 1) {
      for (const lang of ["en", "mn"] as const) expect(hasForbiddenWording(html(i, [], lang)), `${beats[i].id} ${lang}`).toBe(false);
    }
  });

  it("the server page renders the script offline (no clip files committed: captions only)", () => {
    const page = textOf(render(SignatureDemoPage()));
    expect(page).toContain("Signature Triage: offline demo");
    expect(page).toContain("Beat 1 of 8");
    expect(page).toContain(PRESENTER_LINES.intro as string);
  });

  it("no network calls: no fetch, no Anthropic SDK, no ElevenLabs in the demo code", () => {
    for (const rel of ["src/lib/signature/demo.ts", "src/components/signature/SignatureDemo.tsx", "src/app/demo/signature/page.tsx"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|@anthropic-ai|api\.elevenlabs|synthesizeSpeech|\/api\//);
    }
  });
});
