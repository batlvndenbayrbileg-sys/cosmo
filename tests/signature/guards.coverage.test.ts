import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Lang } from "@/lib/types";
import checkinsJson from "@/data/demo_checkins.json";
import { signatureStrings } from "@/i18n/strings/signature";
import { buildDemoBeats, demoLineOk, demoSpokenLines, type DemoCheckins } from "@/lib/signature/demo";
import { SIGNATURE_DISCLAIMER, buildFacts, hasForbiddenWording } from "@/lib/signature/facts";
import { assertNoOrbitClaim } from "@/lib/signature/spaceMeasurability";
import { renderTriageTemplate } from "@/lib/signature/templates";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData, loadSecondAssay } from "@/server/signature/files";

/**
 * T10 fix: the guards cover every place a sentence can come from. The demo's Cosmo lines pass the orbit-claim guard
 * too (not only numbers / disclaimer / wording); every EN and MN string of the signature UI passes the wording and
 * orbit guards; and no file of the feature (engine, cards, pages, strings) makes a network call.
 */

const view = buildSignatureView(getLabData(), loadSecondAssay().matrix);
const checkins = checkinsJson as unknown as DemoCheckins;
const beats = buildDemoBeats(view, checkins);

describe("signature T10 fix: demo Cosmo lines pass the orbit-claim guard", () => {
  it("demoLineOk rejects an in-flight measurement claim that the other guards let through", () => {
    const panel = view.panels.C001.find((p) => p.timepoint === "R+1")!;
    const facts = buildFacts(panel, { lang: "en", previous: null, qcLog: view.qcLog });
    const text = renderTriageTemplate(facts, "en");
    expect(demoLineOk(text, facts, "en")).toBe(true);
    const claim = text.replace(SIGNATURE_DISCLAIMER.en, `Cosmo measures IL-6 in orbit every day. ${SIGNATURE_DISCLAIMER.en}`);
    expect(hasForbiddenWording(claim)).toBe(false);
    expect(demoLineOk(claim, facts, "en")).toBe(false);
  });

  it("every beat's Cosmo line and caption, and the spoken lines in both languages, carry no orbit claim", () => {
    const withCosmo = beats.filter((b) => b.cosmo);
    expect(withCosmo.map((b) => b.id)).toEqual(["a", "c1", "c2", "d", "b"]);
    for (const b of withCosmo) {
      expect(assertNoOrbitClaim(b.cosmo!.text), b.id).toBe(true);
      expect(assertNoOrbitClaim(b.cosmo!.caption), b.id).toBe(true);
    }
    for (const lang of ["en", "mn"] as Lang[]) {
      for (const line of demoSpokenLines(beats, lang, view, checkins)) {
        expect(assertNoOrbitClaim(line.text), `${lang} ${line.id}`).toBe(true);
        expect(hasForbiddenWording(line.text), `${lang} ${line.id}`).toBe(false);
      }
    }
  });
});

describe("signature T10 fix: every signature UI string passes the wording and orbit guards", () => {
  it("identical EN / MN key sets; no value has forbidden wording or an in-flight claim", () => {
    const en = signatureStrings.en as Record<string, string>;
    const mn = signatureStrings.mn as Record<string, string>;
    expect(Object.keys(mn).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).length).toBeGreaterThan(50);
    for (const [lang, dict] of [
      ["en", en],
      ["mn", mn],
    ] as const) {
      for (const [key, value] of Object.entries(dict)) {
        expect(hasForbiddenWording(value), `${lang} ${key}: ${value}`).toBe(false);
        expect(assertNoOrbitClaim(value), `${lang} ${key}: ${value}`).toBe(true);
      }
    }
  });
});

describe("signature T10 fix: no network call anywhere in the feature", () => {
  const root = process.cwd();
  const filesUnder = (rel: string): string[] => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return [rel];
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .flatMap((e) => filesUnder(path.join(rel, e.name)))
      .filter((f) => /\.(ts|tsx)$/.test(f));
  };

  it("engine, cards, pages and strings: no fetch, XMLHttpRequest, WebSocket, EventSource, Anthropic or ElevenLabs", () => {
    const files = [
      ...filesUnder("src/lib/signature"),
      ...filesUnder("src/components/signature"),
      ...filesUnder("src/app/signature"),
      ...filesUnder("src/app/demo/signature"),
      ...filesUnder("src/server/signature"),
      "src/i18n/strings/signature.ts",
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      expect(src, rel).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|@anthropic-ai|api\.elevenlabs|synthesizeSpeech/);
    }
  });
});
