import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { signatureStrings } from "@/i18n/strings/signature";
import type { Lang } from "@/lib/types";
import { hasForbiddenWording } from "@/lib/signature/facts";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData, loadSecondAssay } from "@/server/signature/files";
import { panelOf } from "@/components/signature/logic";
import { SIGNATURE_LIMIT_CARDS } from "@/components/signature/CardLimits";
import { TriageCard } from "@/components/signature/TriageCard";
import { FingerprintCard } from "@/components/signature/FingerprintCard";
import { RecoveryCard } from "@/components/signature/RecoveryCard";
import { EvidenceCard } from "@/components/signature/EvidenceCard";

const view = buildSignatureView(getLabData(), loadSecondAssay().matrix);
const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const render = (el: ReactElement, lang: Lang) => renderToStaticMarkup(createElement(Provider, { initialLang: lang }, el));
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

describe("signature T10: references (docs/sources.md)", () => {
  it("lists the twelve references of spec section 11", () => {
    const md = read("docs/sources.md");
    const at = md.indexOf("## Signature Triage");
    expect(at).toBeGreaterThan(0);
    const section = md.slice(at);
    const ids = [
      "10.26030/e0rx-sh52",
      "10.26030/mc5d-p710",
      "10.26030/7cax-yj10",
      "10.1038/s41467-024-49211-2",
      "10.1038/s41467-024-48806-z",
      "20140002769",
      "20160003864",
      "https://torchlight-summit.pages.dev/narrative/immune/",
      "10.1016/j.celrep.2020.108429",
      "20210026808",
      "20240004905",
      "20230001079",
    ];
    for (const id of ids) expect(section, id).toContain(id);
    // the same identifiers are the spec's
    const spec = read("docs/SIGNATURE_SPEC.md");
    const refs = spec.slice(spec.indexOf("## 11. Sources"));
    for (const id of ids) expect(refs, id).toContain(id);
    // numbered 1..12, each once
    const numbers = [...section.matchAll(/^(\d{1,2})\. /gmu)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

describe("signature T10: a Limitations line under each card title tooltip", () => {
  const cards: Record<(typeof SIGNATURE_LIMIT_CARDS)[number], () => ReactElement> = {
    triage: () => createElement(TriageCard, { panel: panelOf(view, "C003", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }),
    fp: () => createElement(FingerprintCard, { view, panel: panelOf(view, "C003", "R+1") }),
    rec: () => createElement(RecoveryCard, { view, crew: "C003", timepoint: "R+1" }),
    ev: () => createElement(EvidenceCard),
  };

  it("one sentence per card in both languages, from spec section 8, without forbidden wording", () => {
    expect([...SIGNATURE_LIMIT_CARDS]).toEqual(["triage", "fp", "rec", "ev"]);
    for (const lang of ["en", "mn"] as const) {
      for (const c of SIGNATURE_LIMIT_CARDS) {
        const s = signatureStrings[lang][`dashboard.signature.limits.${c}`];
        expect(s, `${lang} ${c}`).toBeTruthy();
        expect(s.trim().split(/(?<=[.!?])\s+/u), `${lang} ${c} one sentence`).toHaveLength(1);
        expect(hasForbiddenWording(s), `${lang} ${c}`).toBe(false);
      }
    }
    expect(signatureStrings.en["dashboard.signature.limits.triage"]).toMatch(/n = 4/);
    expect(signatureStrings.en["dashboard.signature.limits.fp"]).toMatch(/research assays, not clinical tests/);
    expect(signatureStrings.en["dashboard.signature.limits.rec"]).toMatch(/no sample between day 1 and day 45/i);
    expect(signatureStrings.en["dashboard.signature.limits.ev"]).toMatch(/none in flight/);
  });

  it("every card renders a title tooltip trigger whose label carries the Limitations line (EN and MN)", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const c of SIGNATURE_LIMIT_CARDS) {
        const html = decode(render(cards[c](), lang));
        const trigger = new RegExp(`data-slot="signature-limits"[^>]*data-card="${c}"`, "u");
        expect(html, `${lang} ${c}`).toMatch(trigger);
        const label = signatureStrings[lang]["dashboard.signature.limits.label"];
        expect(html, `${lang} ${c}`).toContain(`${label}: ${signatureStrings[lang][`dashboard.signature.limits.${c}`]}`);
      }
    }
  });
});
