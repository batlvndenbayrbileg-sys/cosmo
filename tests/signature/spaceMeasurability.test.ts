import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { signatureStrings } from "@/i18n/strings/signature";
import type { Lang } from "@/lib/types";
import { assertNumbersGrounded, hasForbiddenWording, SIGNATURE_DISCLAIMER } from "@/lib/signature/facts";
import { TWINS_STUDY_DOI } from "@/lib/signature/evidence";
import {
  SPACE_STATEMENTS,
  assertNoOrbitClaim,
  onlyStatementSentences,
  orbitClaimFallback,
  spaceStatements,
} from "@/lib/signature/spaceMeasurability";
import { buildSignatureView } from "@/lib/signature/view";
import { ClaudeAgent, type LlmClient } from "@/server/agent/claudeAgent";
import { SYSTEM_PROMPT } from "@/server/agent/prompt";
import {
  SIGNATURE_PROMPT_ADDITION,
  SPACE_PROMPT_ADDITION,
  SPACE_TOOL_DEFINITION,
  SPACE_TOOL_NAME,
  acceptSignatureAnswer,
  answerSignatureQuestion,
  detectSignatureIntent,
  detectSpaceIntent,
  executeSpaceTool,
  renderSpaceTemplate,
  triageFactsFor,
} from "@/server/agent/signature";
import { TOOL_DEFINITIONS } from "@/server/agent/tools";
import { getLabData, loadSecondAssay } from "@/server/signature/files";
import { panelOf } from "@/components/signature/logic";
import { TriageCard } from "@/components/signature/TriageCard";
import { EvidenceCard } from "@/components/signature/EvidenceCard";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const Provider = I18nProvider as unknown as ComponentType<{ initialLang: Lang }>;
const mn = (el: ReactElement) => renderToStaticMarkup(createElement(Provider, { initialLang: "mn" }, el));
const textOf = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
const spec = fs.readFileSync(path.join(process.cwd(), "docs", "SIGNATURE_SPEC.md"), "utf8").replace(/\r\n/g, "\n");

describe("signature T14: statements S1-S3 (spec section 8.1, verbatim)", () => {
  it("S1-S3 equal the spec table in both languages", () => {
    for (const id of ["S1", "S2", "S3"] as const) {
      const row = new RegExp(`^\\| ${id} \\| (.+?) \\| (.+?) \\|$`, "mu").exec(spec);
      expect(row, id).not.toBeNull();
      expect(SPACE_STATEMENTS[id].en).toBe(row![1]);
      expect(SPACE_STATEMENTS[id].mn).toBe(row![2]);
    }
    expect(spaceStatements("en")).toHaveLength(3);
    expect(spaceStatements("mn")[0]).toBe(SPACE_STATEMENTS.S1.mn);
  });

  it("S1-S3 pass both guards (numbers and orbit claim) in both languages, and carry no forbidden wording", () => {
    for (const lang of ["en", "mn"] as const) {
      for (const s of spaceStatements(lang)) {
        expect(assertNumbersGrounded(s, { allowedNumbers: [] }), s).toBe(true);
        expect(assertNoOrbitClaim(s), s).toBe(true);
        expect(hasForbiddenWording(s), s).toBe(false);
      }
      expect(assertNoOrbitClaim(renderSpaceTemplate(lang))).toBe(true);
      expect(orbitClaimFallback(lang)).toBe(`${SPACE_STATEMENTS.S1[lang]} ${SPACE_STATEMENTS.S3[lang]}`);
    }
  });

  it("assertNoOrbitClaim: 'AEGIS measures IL-6 in orbit' fails, 'I do not measure anything in orbit myself' passes", () => {
    expect(assertNoOrbitClaim("AEGIS measures IL-6 in orbit")).toBe(false);
    expect(assertNoOrbitClaim("I do not measure anything in orbit myself")).toBe(true);
    expect(assertNoOrbitClaim("We track these markers on the ISS every week.")).toBe(false);
    expect(assertNoOrbitClaim("Cosmo is monitoring your cytokines in space.")).toBe(false);
    expect(assertNoOrbitClaim("Your IL-6 was measured in flight.")).toBe(false);
    expect(assertNoOrbitClaim("This cannot be measured in orbit today. Your IL-6 is 2.4 times your baseline.")).toBe(true);
    expect(assertNoOrbitClaim("IL-6 isn't measured on the ISS.")).toBe(true);
    // the claim in one sentence is not excused by a negation in another
    expect(assertNoOrbitClaim("I do not diagnose. AEGIS measures IL-6 in orbit.")).toBe(false);
    // Mongolian counterpart
    expect(assertNoOrbitClaim("AEGIS тойрог замд IL-6 хэмждэг.")).toBe(false);
    expect(assertNoOrbitClaim("Би өөрөө тойрог замд юу ч хэмждэггүй.")).toBe(true);
  });

  it("model wording of a space answer may leave sentences out, never add one", () => {
    expect(onlyStatementSentences(SPACE_STATEMENTS.S1.en, "en")).toBe(true);
    expect(onlyStatementSentences(`${SPACE_STATEMENTS.S1.en} ${SPACE_STATEMENTS.S3.en}`, "en")).toBe(true);
    expect(onlyStatementSentences("I do not measure anything in orbit myself.", "en")).toBe(true);
    expect(onlyStatementSentences(`${SPACE_STATEMENTS.S1.en} A new device will fix this soon.`, "en")).toBe(false);
    expect(onlyStatementSentences(SPACE_STATEMENTS.S1.en, "mn")).toBe(false);
    expect(onlyStatementSentences("", "en")).toBe(false);
  });
});

describe("signature T14: get_space_measurability", () => {
  it("the tool returns the three strings for the session language; strict, outside the frozen tool list and system prompt", () => {
    for (const lang of ["en", "mn"] as const) {
      const res = executeSpaceTool({}, lang);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.statements).toHaveLength(3);
        expect(res.data.statements).toEqual(spaceStatements(lang));
        expect(res.data.statements.every((s) => typeof s === "string")).toBe(true);
        expect(res.data.allowedNumbers).toEqual([]);
      }
    }
    expect(executeSpaceTool({ crew: "x" }, "en")).toMatchObject({ ok: false, code: "bad_input" });
    expect(SPACE_TOOL_DEFINITION.name).toBe("get_space_measurability");
    expect(SPACE_TOOL_DEFINITION.strict).toBe(true);
    expect(Object.isFrozen(SPACE_TOOL_DEFINITION)).toBe(true);
    expect(TOOL_DEFINITIONS.some((t) => t.name === SPACE_TOOL_NAME)).toBe(false);
    expect(SPACE_PROMPT_ADDITION).toBe(
      "For questions about measuring in space, in orbit or on the ISS, call get_space_measurability and answer only from its result.",
    );
    expect(SYSTEM_PROMPT).not.toContain("get_space_measurability");
  });

  it("detects questions about measuring in space, in orbit or on the ISS, and nothing else", () => {
    for (const q of [
      "Can you measure this on the ISS?",
      "Can AEGIS measure IL-6 in orbit?",
      "is this tested in space?",
      "Could the station track these markers on board?",
      "Үүнийг сансарт хэмжиж болох уу?",
      "Тойрог замд IL-6 хэмждэг үү?",
    ]) {
      expect(detectSpaceIntent(q), q).toBe(true);
    }
    for (const q of ["What does my blood panel mean?", "Should I draw blood tomorrow?", "why is my sleep yellow?", "Миний цусны шинжилгээ юу гэсэн үг вэ?"]) {
      expect(detectSpaceIntent(q), q).toBe(false);
    }
    // the panel intent alone would have taken "IL-6 in orbit" as a panel question; the space intent is checked first
    expect(detectSignatureIntent("Can AEGIS measure IL-6 in orbit?")).toBe("get_signature_triage");
  });

  it("answers a space question from S1-S3 only (any crew member); model wording only when it shortens", async () => {
    const ctx = { lang: "en" as Lang, today: 1 };
    const plain = await answerSignatureQuestion({ crewId: "alex", text: "Can you measure this on the ISS?", lang: "en", ctx, history: [] });
    expect(plain).toMatchObject({ tool: "get_space_measurability", worded: false, text: renderSpaceTemplate("en") });
    const nobody = await answerSignatureQuestion({ crewId: "nobody", text: "Can you measure this on the ISS?", lang: "en", ctx, history: [] });
    expect(nobody?.text).toBe(renderSpaceTemplate("en"));
    const mnText = await answerSignatureQuestion({ crewId: "bat", text: "Үүнийг сансарт хэмжиж болох уу?", lang: "mn", ctx, history: [] });
    expect(mnText?.text).toBe(spaceStatements("mn").join(" "));
    expect(mnText?.text).not.toContain(SIGNATURE_DISCLAIMER.mn);

    const ask = (reply: string) =>
      answerSignatureQuestion({ crewId: "alex", text: "Can you measure this on the ISS?", lang: "en", ctx, history: [], answer: async () => reply });
    const short = `${SPACE_STATEMENTS.S1.en} ${SPACE_STATEMENTS.S3.en}`;
    expect(await ask(short)).toMatchObject({ text: short, worded: true });
    expect(await ask(`${SPACE_STATEMENTS.S1.en} The next mission will carry an IL-6 analyser.`)).toMatchObject({
      text: renderSpaceTemplate("en"),
      worded: false,
    });
    expect(await ask("Yes, AEGIS measures IL-6 in orbit.")).toMatchObject({ text: orbitClaimFallback("en"), worded: false });
  });

  it("a triage answer that claims in-flight measurement is replaced by S1 + S3; acceptSignatureAnswer runs the guard", async () => {
    const f = triageFactsFor("C003", "en", { timepoint: "R+1" })!;
    const claim = `Your index is ${f.fri}. AEGIS measures IL-6 in orbit. ${SIGNATURE_DISCLAIMER.en}`;
    expect(assertNumbersGrounded(claim, f)).toBe(true);
    expect(acceptSignatureAnswer(claim, f, "en")).toBe(false);
    expect(acceptSignatureAnswer(`Your index is ${f.fri}. ${SIGNATURE_DISCLAIMER.en}`, f, "en")).toBe(true);
    const r = await answerSignatureQuestion({
      crewId: "alex",
      text: "what does my blood panel mean?",
      lang: "en",
      ctx: { lang: "en", today: 1 },
      history: [],
      answer: async () => claim,
    });
    expect(r).toMatchObject({ tool: "get_signature_triage", worded: false, text: orbitClaimFallback("en") });
  });

  it("ClaudeAgent: the space addition rides in every signature directive; a space question gets the statements-only instruction", async () => {
    const bodies: Array<{ messages: Array<{ content: unknown }> }> = [];
    const client: LlmClient = {
      messages: {
        stream: (body) => {
          bodies.push(body as never);
          return {
            finalMessage: async () =>
              ({
                id: "m",
                type: "message",
                role: "assistant",
                model: "x",
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
                content: [{ type: "text", text: SPACE_STATEMENTS.S1.en }],
              }) as never,
          };
        },
      },
    };
    const agent = new ClaudeAgent({ client, model: "test" });
    const space = executeSpaceTool({}, "en");
    if (!space.ok) throw new Error("tool");
    const out = await agent.answerAboutSignature({ tool: SPACE_TOOL_NAME, facts: space.data, question: "on the ISS?", lang: "en", history: [] });
    expect(out).toBe(SPACE_STATEMENTS.S1.en);
    const d0 = String(bodies[0].messages[0].content);
    expect(d0).toContain(SPACE_PROMPT_ADDITION);
    expect(d0).toContain("tool_called: get_space_measurability");
    expect(d0).toContain(JSON.stringify(space.data));
    expect(d0).not.toContain(SIGNATURE_PROMPT_ADDITION);
    const facts = triageFactsFor("C003", "en", { timepoint: "R+1" })!;
    await agent.answerAboutSignature({ tool: "get_signature_triage", facts, question: "what does it mean?", lang: "en", history: [] });
    const d1 = String(bodies[1].messages[0].content);
    expect(d1).toContain(SIGNATURE_PROMPT_ADDITION);
    expect(d1).toContain(SPACE_PROMPT_ADDITION);
  });
});

describe("signature T14: cards", () => {
  const view = buildSignatureView(getLabData(), loadSecondAssay().matrix);

  it("Triage card caption 'Scored on ground laboratory panels' (EN) / MN, as the trigger of the S1-S3 popover", () => {
    const en = html(createElement(TriageCard, { panel: panelOf(view, "C001", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }));
    expect(en).toContain(">Scored on ground laboratory panels<");
    expect(en).toContain('data-slot="signature-space-caption"');
    const out = mn(createElement(TriageCard, { panel: panelOf(view, "C003", "R+1"), timepoints: view.timepoints, onTimepoint: () => {} }));
    expect(out).toContain("Дэлхий дээрх лабораторийн хариугаар оноо өгсөн");
  });

  it("Evidence card: the row 'Different mission, same direction (n = 1)' with the two limiting sentences of spec 8 item 4b and ref. [9]", () => {
    const item = spec.slice(spec.indexOf("4b. **Different mission"), spec.indexOf("5. **Negative results"));
    const flat = item.replace(/\s+/gu, " ");
    const limits = /(Limits: .*? not the thresholds\.)/u.exec(flat)?.[1];
    expect(limits).toBeDefined();
    const out = textOf(html(createElement(EvidenceCard))).replace(/\s+/gu, " ");
    expect(out).toContain("Different mission, same direction (n = 1)");
    expect(out).toContain(limits!);
    expect(out).toContain(`DOI ${TWINS_STUDY_DOI}`);
    expect(spec).toContain(`DOI ${TWINS_STUDY_DOI}`);
    // static text: no percentages of that paper
    expect(signatureStrings.en["dashboard.signature.ev.twins.limits"]).not.toMatch(/%/);
    const outMn = textOf(mn(createElement(EvidenceCard)));
    expect(outMn).toContain("Өөр нислэг, ижил чиглэл (n = 1)");
  });

  it("the T14 strings exist in both languages with the same placeholders and no forbidden wording", () => {
    const keys = Object.keys(signatureStrings.en).filter((k) => /\.space\.|\.twins\./.test(k));
    expect(keys).toHaveLength(6);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      expect(vars(signatureStrings.mn[k]), k).toEqual(vars(signatureStrings.en[k]));
      for (const lang of ["en", "mn"] as const) {
        expect(hasForbiddenWording(signatureStrings[lang][k]), `${lang} ${k}`).toBe(false);
        expect(assertNoOrbitClaim(signatureStrings[lang][k]), `${lang} ${k}`).toBe(true);
      }
    }
  });
});
