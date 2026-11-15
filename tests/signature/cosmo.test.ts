import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang, SummaryPayload } from "@/lib/types";
import { SIGNATURE_DISCLAIMER } from "@/lib/signature/facts";
import { renderTriageTemplate } from "@/lib/signature/templates";
import type { Agent, AgentArgs } from "@/server/agent/agent";
import { ClaudeAgent, type LlmClient } from "@/server/agent/claudeAgent";
import { HybridAgent } from "@/server/agent/hybridAgent";
import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import { ScriptedAgent } from "@/server/agent/scriptedAgent";
import {
  SIGNATURE_PROMPT_ADDITION,
  SIGNATURE_TOOL_DEFINITIONS,
  SIGNATURE_TOOL_NAMES,
  acceptSignatureAnswer,
  answerSignatureQuestion,
  detectSignatureIntent,
  executeSignatureTool,
  insertBeforeDisclaimer,
  panelClockDay,
  referenceCrewFor,
  signatureFollowUp,
  triageFactsFor,
  type SignatureAnswerArgs,
} from "@/server/agent/signature";
import { TOOL_DEFINITIONS, TOOL_NAMES } from "@/server/agent/tools";
import { SYSTEM_PROMPT } from "@/server/agent/prompt";
import { setClockForTests } from "@/server/clock";
import { getEnv } from "@/server/env";
import { assistantText, eventsOf, playTurn, startCheckIn } from "../helpers/agent";
import { TEST_TODAY, freshSeededDb } from "../helpers/db";
import { historyFromSeries } from "../helpers/health";

/** a scripted agent that also words signature answers (the live path), with a given reply */
function signatureAgent(reply: (args: SignatureAnswerArgs) => string | null): Agent & { asked: SignatureAnswerArgs[] } {
  const rules = new ScriptedAgent();
  const asked: SignatureAnswerArgs[] = [];
  return {
    name: "claude",
    asked,
    decide: (args: AgentArgs) => rules.decide(args),
    answerAboutSignature: async (args) => {
      asked.push(args);
      return reply(args);
    },
  };
}

describe("signature T6: Cosmo tools", () => {
  it("two strict tools, outside the frozen check-in tool list and system prompt", () => {
    expect(SIGNATURE_TOOL_DEFINITIONS.map((t) => t.name)).toEqual([...SIGNATURE_TOOL_NAMES]);
    expect(SIGNATURE_TOOL_NAMES).toEqual(["get_signature_triage", "get_draw_advice"]);
    for (const t of SIGNATURE_TOOL_DEFINITIONS) {
      expect(t.strict).toBe(true);
      expect(Object.isFrozen(t)).toBe(true);
    }
    expect(TOOL_NAMES).toHaveLength(6);
    expect(TOOL_DEFINITIONS.some((t) => t.name.startsWith("get_signature") || t.name === "get_draw_advice")).toBe(false);
    expect(SYSTEM_PROMPT).not.toContain("Decision support");
    expect(SIGNATURE_PROMPT_ADDITION).toBe(
      "Use only numbers present in the tool result. At most five sentences, one action, end with: Decision support, not a diagnosis. / Энэ бол шийдвэр гаргахад туслах мэдээлэл, онош биш.",
    );
  });

  it("crew link: C001..C004 themselves, app crew bat/saraa/alex/mira -> C001..C004, anyone else none", () => {
    expect(["C003", "bat", "saraa", "alex", "mira", "nobody"].map(referenceCrewFor)).toEqual([
      "C003",
      "C001",
      "C002",
      "C003",
      "C004",
      null,
    ]);
  });

  it("get_signature_triage(crewId, panelId?) returns the facts; the latest panel up to today when no panel is named", () => {
    const named = executeSignatureTool("get_signature_triage", { crew_id: "alex", panel_id: "R+1" }, { lang: "en", today: null });
    expect(named.ok).toBe(true);
    if (named.ok && !("facts" in named.data)) {
      expect(named.data).toMatchObject({ kind: "triage", crew: "C003", timepoint: "R+1", fri: "67", band: ["65", "68"] });
    }
    expect(triageFactsFor("C003", "en", { today: 50 })?.timepoint).toBe("R+45");
    expect(triageFactsFor("C003", "en", { today: 1 })?.timepoint).toBe("R+1");
    expect(triageFactsFor("C003", "en", { timepoint: "R+194" })?.fri).toBe("57");
    expect(triageFactsFor("nobody", "en")).toBeNull();
    const unknown = executeSignatureTool("get_signature_triage", { crew_id: "nobody", panel_id: "" }, { lang: "en", today: null });
    expect(unknown).toMatchObject({ ok: false, code: "not_found" });
  });

  it("get_draw_advice(crewId) returns the rule ID and the facts", () => {
    const res = executeSignatureTool("get_draw_advice", { crew_id: "bat" }, { lang: "en", today: 30 });
    expect(res.ok).toBe(true);
    if (res.ok && "facts" in res.data) {
      // C001: R+1 imported on day 1 (EXPECTED, re-test on day 22) -> on day 30 the re-test is overdue: A1
      expect(res.data.rule).toBe("A1");
      expect(res.data.facts).toMatchObject({ kind: "draw", rule: "A1", crew: "C001", kitsLeft: "7", kitsTotal: "8", daysSinceLastPanel: "29" });
    }
    expect(executeSignatureTool("nope", {}, { lang: "en", today: 1 })).toMatchObject({ ok: false, code: "unknown_tool" });
    expect(executeSignatureTool("get_draw_advice", { crew: 1 }, { lang: "en", today: 1 })).toMatchObject({ ok: false, code: "bad_input" });
  });

  it("detects questions about the panel or a draw, and nothing else", () => {
    expect(detectSignatureIntent("What does my blood panel mean?")).toBe("get_signature_triage");
    expect(detectSignatureIntent("explain the flight response index")).toBe("get_signature_triage");
    expect(detectSignatureIntent("Миний цусны шинжилгээ юу гэсэн үг вэ?")).toBe("get_signature_triage");
    expect(detectSignatureIntent("Should I draw blood tomorrow?")).toBe("get_draw_advice");
    expect(detectSignatureIntent("how many kits are left")).toBe("get_draw_advice");
    expect(detectSignatureIntent("Маргааш цус авах уу?")).toBe("get_draw_advice");
    for (const q of ["why is my sleep yellow?", "what is my blood pressure?", "How was my heart rate today?", "Нойр минь яагаад шар байна?"]) {
      expect(detectSignatureIntent(q), q).toBeNull();
    }
  });

  it("acceptSignatureAnswer: grounded numbers and the disclaimer last, else rejected", () => {
    const f = triageFactsFor("C003", "en", { timepoint: "R+1" })!;
    const good = "Your new panel shows the expected flight pattern: index 67, range 65 to 68. IL-6 is about 2.8 times your baseline. A re-test in 15 days. Decision support, not a diagnosis.";
    expect(acceptSignatureAnswer(good, f, "en")).toBe(true);
    expect(acceptSignatureAnswer(good.replace("67", "72"), f, "en")).toBe(false);
    expect(acceptSignatureAnswer(good.replace(" Decision support, not a diagnosis.", ""), f, "en")).toBe(false);
    expect(acceptSignatureAnswer(good.replace("expected flight pattern", "normal pattern"), f, "en")).toBe(false);
    expect(acceptSignatureAnswer(good.replace("Decision support, not a diagnosis.", SIGNATURE_DISCLAIMER.mn), f, "en")).toBe(false);
    expect(acceptSignatureAnswer(renderTriageTemplate(f, "en"), f, "en")).toBe(true);
  });
});

describe("signature T6: guarded answer", () => {
  const ctx = { lang: "en" as Lang, today: 1 };

  it("not a signature question -> null (the caller answers as before)", async () => {
    expect(await answerSignatureQuestion({ crewId: "alex", text: "why is my sleep yellow?", lang: "en", ctx, history: [] })).toBeNull();
    expect(await answerSignatureQuestion({ crewId: "nobody", text: "what does my panel mean?", lang: "en", ctx, history: [] })).toBeNull();
  });

  it("without a model: the template", async () => {
    const r = await answerSignatureQuestion({ crewId: "alex", text: "what does my blood panel mean?", lang: "en", ctx, history: [] });
    expect(r).toMatchObject({ tool: "get_signature_triage", worded: false });
    expect(r!.text).toBe(renderTriageTemplate(triageFactsFor("alex", "en", { today: 1 })!, "en"));
  });

  it("model wording that passes the guard is spoken; an invented number or a missing disclaimer -> the template", async () => {
    const good = "Index 67, range 65 to 68: the expected flight pattern. Re-test in 15 days. Decision support, not a diagnosis.";
    const ok = await answerSignatureQuestion({ crewId: "alex", text: "what does my panel mean?", lang: "en", ctx, history: [], answer: async () => good });
    expect(ok).toMatchObject({ text: good, worded: true });
    const template = renderTriageTemplate(triageFactsFor("alex", "en", { today: 1 })!, "en");
    for (const bad of [good.replace("67", "72"), good.replace(" Decision support, not a diagnosis.", "")]) {
      const r = await answerSignatureQuestion({ crewId: "alex", text: "what does my panel mean?", lang: "en", ctx, history: [], answer: async () => bad });
      expect(r).toMatchObject({ text: template, worded: false });
    }
    const thrown = await answerSignatureQuestion({
      crewId: "alex",
      text: "what does my panel mean?",
      lang: "en",
      ctx,
      history: [],
      answer: async () => {
        throw new Error("down");
      },
    });
    expect(thrown?.text).toBe(template);
  });

  it("ClaudeAgent.answerAboutSignature: one call, frozen system prompt and tools, the addition and the tool result in the directive", async () => {
    const bodies: Array<{ system: unknown; tools: unknown; messages: Array<{ content: unknown }> }> = [];
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
                content: [{ type: "text", text: "Index 67. Decision support, not a diagnosis." }],
              }) as never,
          };
        },
      },
    };
    const agent = new ClaudeAgent({ client, model: "test" });
    const facts = triageFactsFor("C003", "en", { timepoint: "R+1" })!;
    const out = await agent.answerAboutSignature({ tool: "get_signature_triage", facts, question: "what does it mean?", lang: "en", history: [] });
    expect(out).toBe("Index 67. Decision support, not a diagnosis.");
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies[0].tools)).toBe(JSON.stringify(TOOL_DEFINITIONS));
    expect(bodies[0].system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    const directive = String(bodies[0].messages[0].content);
    expect(directive).toContain(SIGNATURE_PROMPT_ADDITION);
    expect(directive).toContain("tool_called: get_signature_triage");
    expect(directive).toContain(JSON.stringify(facts));
    // the hybrid agent forwards to the live one
    expect(await new HybridAgent(agent).answerAboutSignature({ tool: "get_signature_triage", facts, question: "q", lang: "en", history: [] })).toBe(
      "Index 67. Decision support, not a diagnosis.",
    );
  });
});

describe("signature T6: after the daily summary", () => {
  const start = "2026-10-01";

  it("panel clock = mission day of the check-in date (day 1 = MISSION_START_DATE)", () => {
    expect(panelClockDay("2026-10-01", start)).toBe(1);
    expect(panelClockDay("2026-11-14", start)).toBe(45);
    expect(panelClockDay("2026-09-20", start)).toBe(1);
  });

  it("offers the triage summary when a panel arrived since the last check-in, not again the next day", () => {
    // day 45 (2026-11-14): C001 R+45 was drawn today; the last check-in was on day 44
    const history = historyFromSeries({ sleep_hours: [7], heart_rate: [60], mood: [4] });
    const today = signatureFollowUp({ crewId: "bat", lang: "en", localDate: "2026-11-14", missionStartDate: start, history, todayValues: {} });
    expect(today).toContain("A new blood panel is in: Inspiration4 reference data, crew C001.");
    const mn = signatureFollowUp({ crewId: "bat", lang: "mn", localDate: "2026-11-14", missionStartDate: start, history, todayValues: {} });
    expect(mn).toContain("Цусны шинэ шинжилгээ ирлээ");
    // day 46 with a check-in on day 45: nothing new
    const next = [...history, { date: "2026-11-14", values: {} }];
    expect(signatureFollowUp({ crewId: "bat", lang: "en", localDate: "2026-11-15", missionStartDate: start, history: next, todayValues: {} })).toBe("");
    expect(signatureFollowUp({ crewId: "nobody", lang: "en", localDate: "2026-11-14", missionStartDate: start, history, todayValues: {} })).toBe("");
  });

  it("voices draw advice for A2 (three strained days, last panel 9 days ago) without a second disclaimer", () => {
    // day 54 (2026-11-23): last panel C001 R+45 (day 45) 9 days ago; 14 calm days then 2 strained days, today strained
    const dates = Array.from({ length: 16 }, (_, i) => new Date(Date.UTC(2026, 10, 7 + i)).toISOString().slice(0, 10));
    const history = dates.map((date, i) => ({
      date,
      values: i < 14 ? { sleep_hours: 7.0 + 0.1 * (i % 3), heart_rate: 58 + (i % 2), mood: 4 } : { sleep_hours: 5, heart_rate: 66, mood: 3 },
    }));
    const text = signatureFollowUp({
      crewId: "bat",
      lang: "en",
      localDate: "2026-11-23",
      missionStartDate: start,
      history,
      todayValues: { sleep_hours: 5, heart_rate: 66, mood: 3 },
    });
    expect(text).toContain("your strain score has been above 50 for three days in a row");
    expect(text).toContain("Your last blood panel was 9 days ago.");
    expect(text).toContain("you have 6 of 8 left");
    expect(text).not.toContain("Decision support");
  });

  it("insertBeforeDisclaimer keeps the disclaimer last", () => {
    expect(insertBeforeDisclaimer("Headline. Decision support, not a diagnosis.", "Offer.", "Decision support, not a diagnosis.")).toBe(
      "Headline. Offer. Decision support, not a diagnosis.",
    );
    expect(insertBeforeDisclaimer("Headline.", "Offer.", "Decision support, not a diagnosis.")).toBe("Headline. Offer.");
    expect(insertBeforeDisclaimer("Headline.", "", "x")).toBe("Headline.");
  });
});

describe("signature T6: the check-in pipeline", () => {
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    await freshSeededDb();
  });
  afterEach(() => setClockForTests(null));

  async function finishDemo(lang: Lang, agent?: Agent): Promise<{ checkInId: string; summary: SummaryPayload }> {
    const checkInId = await startCheckIn("bat", lang);
    let summary: SummaryPayload | undefined;
    for (const line of DEMO_SCRIPTS[lang].lines) {
      const events = await playTurn("bat", checkInId, line.say, agent ? { agent } : {});
      summary = eventsOf(events, "summary")[0]?.summary ?? summary;
    }
    expect(summary).toBeDefined();
    return { checkInId, summary: summary! };
  }

  it("scripted agent: the summary is unchanged (no offer), and a panel question after it gets the template", async () => {
    for (const lang of ["en", "mn"] as const) {
      const { checkInId, summary } = await finishDemo(lang);
      expect(summary.spoken.text, lang).not.toMatch(/Inspiration4/);
      const events = await playTurn("bat", checkInId, lang === "en" ? "What does my blood panel mean?" : "Миний цусны шинжилгээ юу гэсэн үг вэ?");
      const today = panelClockDay("2026-11-14", getEnv().missionStartDate);
      const want = renderTriageTemplate(triageFactsFor("bat", lang, { today })!, lang);
      expect(assistantText(events), lang).toBe(want);
      expect(want.endsWith(SIGNATURE_DISCLAIMER[lang])).toBe(true);
      expect(eventsOf(events, "assistant")).toHaveLength(1);
    }
  });

  it("a question that is not about the panel still takes the dashboard Q&A path", async () => {
    const { checkInId } = await finishDemo("en");
    const text = assistantText(await playTurn("bat", checkInId, "Why is my sleep yellow?"));
    expect(text).not.toMatch(/blood panel|Flight Response Index/);
    expect(text).not.toContain("Decision support");
  });

  it("live path: the summary carries the offer before its disclaimer; the model's grounded wording is spoken, an invented number is not", async () => {
    const env = getEnv();
    const today = panelClockDay("2026-11-14", env.missionStartDate);
    const facts = triageFactsFor("bat", "en", { today })!;
    const good = `Your index is ${facts.fri}. ${SIGNATURE_DISCLAIMER.en}`;
    let reply = good;
    const agent = signatureAgent(() => reply);
    const { checkInId, summary } = await finishDemo("en", agent);
    if (facts.timepoint === "R+45" && today === 45) {
      expect(summary.spoken.text).toContain("A new blood panel is in: Inspiration4 reference data, crew C001.");
    }
    expect(summary.spoken.text.endsWith(summary.disclaimer.en)).toBe(true);

    expect(assistantText(await playTurn("bat", checkInId, "What does my blood panel mean?", { agent }))).toBe(good);
    expect(agent.asked.at(-1)?.tool).toBe("get_signature_triage");
    reply = "Your index is 72. " + SIGNATURE_DISCLAIMER.en;
    expect(assistantText(await playTurn("bat", checkInId, "What does my blood panel mean?", { agent }))).toBe(renderTriageTemplate(facts, "en"));
  });
});
