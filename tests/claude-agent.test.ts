import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CrewPublic, SummaryFindings, TurnRow } from "@/lib/types";
import { LlmUnavailable, type Agent, type AgentArgs } from "@/server/agent/agent";
import { ClaudeAgent, HISTORY_TURNS, buildMessages, resolveConfirmation, type LlmClient } from "@/server/agent/claudeAgent";
import { buildDirective } from "@/server/agent/directive";
import { initialCtx, type MachineCtx } from "@/server/agent/machine";
import { SYSTEM_PROMPT } from "@/server/agent/prompt";
import { ScriptedAgent } from "@/server/agent/scriptedAgent";
import { TOOL_DEFINITIONS, executeTool } from "@/server/agent/tools";
import { isSaneReply, isSaneSummaryText } from "@/server/agent/turn";
import { setClockForTests } from "@/server/clock";
import { getEnv } from "@/server/env";
import { getCrewPublic } from "@/server/db/repos/crew";
import { listAlerts } from "@/server/db/repos/alert";
import { getCheckIn } from "@/server/db/repos/checkin";
import { listMeasurements } from "@/server/db/repos/measurement";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn, toolContext } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

let checkInId: string;
let crew: CrewPublic;

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
  checkInId = await startCheckIn("bat", "en");
  crew = await getCrewPublic("bat");
});
afterEach(() => setClockForTests(null));

/* ───────────── fakes ───────────── */

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

function message(stopReason: string, content: Block[]): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test",
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    content: content.map((b) => (b.type === "text" ? { ...b, citations: null } : { ...b, caller: { type: "direct" } })),
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}

const tool = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const text = (t: string): Block => ({ type: "text", text: t });

function fakeClient(responses: Array<Anthropic.Message | Error>): { client: LlmClient; bodies: Anthropic.MessageStreamParams[] } {
  const bodies: Anthropic.MessageStreamParams[] = [];
  const queue = [...responses];
  const client: LlmClient = {
    messages: {
      stream(body) {
        bodies.push(structuredClone(body));
        const next = queue.shift();
        if (next === undefined) throw new Error("the fake client has no more responses");
        return {
          finalMessage: async () => {
            if (next instanceof Error) throw next;
            return next;
          },
        };
      },
    },
  };
  return { client, bodies };
}

function argsFor(state: MachineCtx["state"], utterance: string, over: Partial<AgentArgs> = {}): { args: AgentArgs; validated: string[] } {
  const ctx: MachineCtx = { ...initialCtx(), state, proposed: true, smallTalkTurns: 2 };
  const validated: string[] = [];
  const args: AgentArgs = {
    crew,
    ctx,
    text: utterance,
    lang: "en",
    expected: state === "KPI_CAPTURE" ? "sleep" : null,
    recorded: {},
    history: [],
    validate: (name, input) => {
      validated.push(name);
      return executeTool(toolContext("bat", checkInId, state, utterance, { dryRun: true }), name, input);
    },
    ...over,
  };
  return { args, validated };
}

const sleepCall = (id = "tu_1", value = 6, source = "6 hours") =>
  tool(id, "record_measurement", { key: "sleep_hours", value, unit: "h", source_text: source, confidence: 0.9 });

/* ───────────── request rules ───────────── */

describe("ClaudeAgent request body", () => {
  async function bodyOf(state: MachineCtx["state"], utterance: string, history: TurnRow[] = []) {
    const { client, bodies } = fakeClient([message("end_turn", [text("Okay.")])]);
    const { args } = argsFor(state, utterance, { history });
    await new ClaudeAgent({ client }).decide(args);
    return bodies[0] as unknown as Record<string, unknown> & Anthropic.MessageStreamParams;
  }

  it("uses the configured model, effort low, tool_choice auto and strict tools", async () => {
    const body = await bodyOf("KPI_CAPTURE", "I slept 6 hours");
    expect(body.model).toBe(getEnv().anthropicModel);
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.tools).toHaveLength(6);
    for (const t of body.tools ?? []) expect((t as { strict?: boolean }).strict).toBe(true);
    expect(body.max_tokens).toBeGreaterThan(100);
  });

  it("sends no sampling parameters, no thinking parameter and no forced tool choice", async () => {
    const body = await bodyOf("KPI_CAPTURE", "I slept 6 hours");
    for (const forbidden of ["temperature", "top_p", "top_k", "thinking", "stream"]) {
      expect(body, forbidden).not.toHaveProperty(forbidden);
    }
    const choice = (body.tool_choice as { type: string }).type;
    expect(["any", "tool"]).not.toContain(choice);
  });

  it("never ends with an assistant message (no prefill)", async () => {
    for (const state of ["SMALL_TALK", "KPI_CAPTURE", "CONFIRM"] as const) {
      const body = await bodyOf(state, "hello", [
        { id: "1", speaker: "cosmo", text: "Hi Bat", language: "en", createdAt: "2026-11-14T08:00:00Z" },
      ]);
      expect(body.messages[body.messages.length - 1].role).not.toBe("assistant");
    }
  });

  it("keeps the tool list and the system prompt byte-identical across requests and states", async () => {
    const a = await bodyOf("SMALL_TALK", "hello");
    const b = await bodyOf("CONFIRM", "yes");
    expect(JSON.stringify(a.tools)).toBe(JSON.stringify(TOOL_DEFINITIONS));
    expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools));
    expect(JSON.stringify(a.system)).toBe(JSON.stringify(b.system));
    expect(a.system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  });

  it("puts the code-built directive after the conversation: state, language, expected question, missing keys, recorded values", async () => {
    const { client, bodies } = fakeClient([message("end_turn", [text("Okay.")])]);
    const { args } = argsFor("KPI_CAPTURE", "I slept 6 hours", {
      recorded: { sleep_hours: 6 },
      ctx: { ...initialCtx(), state: "KPI_CAPTURE", proposed: true, filled: ["sleep_hours"] },
      expected: "mood",
    });
    await new ClaudeAgent({ client }).decide(args);
    const messages = bodies[0].messages;
    const last = messages[messages.length - 1] as { role: string; content: string };
    expect(last.role).toBe("system");
    expect(last.content).toContain("state: KPI_CAPTURE");
    expect(last.content).toContain("reply_language: English");
    expect(last.content).toContain("expected_question: mood");
    expect(last.content).toContain('"sleep_hours":"6 h"');
    expect(last.content).not.toContain('"sleep_hours"]'); // sleep is no longer missing
    expect(messages[messages.length - 2]).toMatchObject({ role: "user" });
  });

  it("can send the directive inside the user turn for a model without system messages", async () => {
    const { client, bodies } = fakeClient([message("end_turn", [text("Okay.")])]);
    await new ClaudeAgent({ client, directiveRole: "user" }).decide(argsFor("SMALL_TALK", "hello").args);
    const messages = bodies[0].messages;
    expect(messages.every((m) => m.role !== "system")).toBe(true);
    const last = messages[messages.length - 1] as { content: Array<{ text: string }> };
    expect(last.content[0].text).toContain("DIRECTIVE");
    expect(last.content[1].text).toBe("hello");
  });

  it("keeps only the last 20 turns, merged into alternating user/assistant messages starting with user", () => {
    const history: TurnRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      speaker: i % 2 === 0 ? "cosmo" : "crew",
      text: `turn ${i}`,
      language: "en",
      createdAt: "2026-11-14T08:00:00Z",
    }));
    history.splice(5, 0, { id: "sys", speaker: "system", text: "tool log", language: "en", createdAt: "x" });
    const messages = buildMessages(history, "latest");
    const bodyText = JSON.stringify(messages);
    expect(bodyText).not.toContain("tool log");
    expect(bodyText).not.toContain("turn 0\"");
    expect(bodyText).toContain("turn 29");
    expect(messages[0].role).toBe("user");
    for (let i = 1; i < messages.length; i++) expect(messages[i].role).not.toBe(messages[i - 1].role);
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: expect.stringContaining("latest") });
    expect(HISTORY_TURNS).toBe(20);
  });

  it("the directive instructs by state", () => {
    const base = { lang: "mn" as const, crewName: "Bat", ctx: { smallTalkTurns: 0, proposed: false, filled: [] }, expected: null, recorded: {} };
    expect(buildDirective({ ...base, state: "CONFIRM" })).toContain("finish_confirmation");
    expect(buildDirective({ ...base, state: "CONFIRM" })).toContain("Mongolian");
    expect(buildDirective({ ...base, state: "DONE" })).toContain("Do not call any tool that writes");
    expect(buildDirective({ ...base, state: "SMALL_TALK", ctx: { smallTalkTurns: 1, proposed: false, filled: [] } })).toContain("propose logging");
  });
});

/* ───────────── tool use ───────────── */

describe("ClaudeAgent tool use", () => {
  it("one call on the happy path: reply text and a valid tool call in one message become records and wording", async () => {
    const { client, bodies } = fakeClient([
      message("tool_use", [text("Got it, 6 hours. How is your mood, from 1 to 5?"), sleepCall()]),
    ]);
    const { args, validated } = argsFor("KPI_CAPTURE", "I slept 6 hours");
    const decision = await new ClaudeAgent({ client }).decide(args);

    expect(bodies).toHaveLength(1);
    expect(validated).toEqual(["record_measurement"]);
    expect(decision.records).toEqual([
      { key: "sleep_hours", value: 6, unit: "h", sourceText: "6 hours", confidence: 0.9 },
    ]);
    expect(decision.replyText).toBe("Got it, 6 hours. How is your mood, from 1 to 5?");
    expect(decision.llmMs).toBeGreaterThanOrEqual(0);
    // the agent itself never writes
    expect(await listMeasurements("bat", checkInId)).toHaveLength(0);
  });

  it("a rejected call triggers a second call with ALL tool results in one user message; the first reply is discarded", async () => {
    const { client, bodies } = fakeClient([
      message("tool_use", [
        text("Got it, 7 hours."),
        sleepCall("tu_bad", 7, "6 hours"), // 7 is not what was said
        tool("tu_ok", "record_measurement", { key: "mood", value: 4, unit: "", source_text: "mood is 4", confidence: 0.9 }),
      ]),
      message("end_turn", [text("Sorry, was that 6 hours or 7?")]),
    ]);
    const { args } = argsFor("KPI_CAPTURE", "I slept 6 hours and my mood is 4");
    const decision = await new ClaudeAgent({ client }).decide(args);

    expect(bodies).toHaveLength(2);
    const second = bodies[1].messages;
    const assistant = second[second.length - 3] as { role: string; content: Array<{ type: string }> };
    const results = second[second.length - 2] as { role: string; content: Array<{ type: string; tool_use_id: string; is_error?: boolean; content: string }> };
    expect(assistant.role).toBe("assistant");
    expect(assistant.content.filter((b) => b.type === "tool_use")).toHaveLength(2);
    expect(results.role).toBe("user");
    expect(results.content.map((r) => r.tool_use_id)).toEqual(["tu_bad", "tu_ok"]);
    expect(results.content[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(results.content[0].content).toMatch(/does not appear/);
    expect(results.content[1].is_error).toBeUndefined();
    expect(second[second.length - 1]).toMatchObject({ role: "system" }); // the directive stays last

    expect(decision.replyText).toBe("Sorry, was that 6 hours or 7?");
    expect(decision.records.map((r) => r.key)).toEqual(["mood"]); // the good call from the first message stands
    expect(decision.rejected).toEqual([{ key: "sleep_hours", reason: "unclear" }]);
  });

  it("the second request keeps every rule of the first (auto tool choice, same tools, no sampling parameters)", async () => {
    const { client, bodies } = fakeClient([
      message("tool_use", [sleepCall("tu_bad", 7, "6 hours")]),
      message("end_turn", [text("Could you repeat that?")]),
    ]);
    await new ClaudeAgent({ client }).decide(argsFor("KPI_CAPTURE", "I slept 6 hours").args);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.tool_choice).toEqual({ type: "auto" });
      expect(body.output_config).toEqual({ effort: "low" });
      expect(JSON.stringify(body.tools)).toBe(JSON.stringify(TOOL_DEFINITIONS));
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("thinking");
    }
  });

  it("a model request for data (get_baseline) is answered with code-computed numbers in a second call", async () => {
    const { client, bodies } = fakeClient([
      message("tool_use", [tool("tu_b", "get_baseline", {})]),
      message("end_turn", [text("Thanks, let's continue.")]),
    ]);
    await new ClaudeAgent({ client }).decide(argsFor("KPI_CAPTURE", "how was my week?").args);
    expect(bodies).toHaveLength(2);
    const second = bodies[1].messages;
    const results = second[second.length - 2] as { content: Array<{ content: string }> };
    expect(JSON.parse(results.content[0].content).baselines.sleep_hours.n).toBe(14);
  });

  it("a request_clarification call becomes a clarification, not a record", async () => {
    const { client } = fakeClient([
      message("tool_use", [text("Sorry, how many hours?"), tool("tu_c", "request_clarification", { key: "sleep_hours", reason: "no number heard" })]),
    ]);
    const decision = await new ClaudeAgent({ client }).decide(argsFor("KPI_CAPTURE", "I slept pretty well").args);
    expect(decision.records).toEqual([]);
    expect(decision.clarifications).toEqual([{ key: "sleep_hours", reason: "unclear" }]);
    expect(decision.replyText).toBe("Sorry, how many hours?");
  });

  it("at the read-back: finish_confirmation(true) gives yesNo true, a correction becomes a correction record", async () => {
    const yes = fakeClient([message("tool_use", [tool("tu_f", "finish_confirmation", { confirmed: true })])]);
    const d1 = await new ClaudeAgent({ client: yes.client }).decide(argsFor("CONFIRM", "Yes, that's right").args);
    expect(d1.yesNo).toBe(true);

    const fix = fakeClient([message("tool_use", [tool("tu_x", "correct_measurement", { key: "sleep_hours", value: 7 })])]);
    const d2 = await new ClaudeAgent({ client: fix.client }).decide(argsFor("CONFIRM", "No, I slept 7 hours").args);
    expect(d2.correction?.map((r) => [r.key, r.value])).toEqual([["sleep_hours", 7]]);
    expect(d2.yesNo).toBe(false); // the astronaut's own "No" wins over anything else
  });

  it("a model that says 'confirmed' to a clear 'no' is overruled by the words", async () => {
    const { client } = fakeClient([message("tool_use", [tool("tu_f", "finish_confirmation", { confirmed: true })])]);
    const d = await new ClaudeAgent({ client }).decide(argsFor("CONFIRM", "No, that is wrong").args);
    expect(d.yesNo).toBe(false);
  });

  it("a model 'confirmed' is accepted only when the astronaut's words agree (the confirmation is irreversible)", async () => {
    const confirm = (utterance: string) =>
      new ClaudeAgent({
        client: fakeClient([message("tool_use", [tool("tu_f", "finish_confirmation", { confirmed: true })])]).client,
      }).decide(argsFor("CONFIRM", utterance).args);
    // a question or an unrelated remark is not a yes: the read-back is asked again
    for (const said of [
      "hmm what does my blood pressure usually look like?",
      "my blood pressure was 120 over 80 yesterday",
      "let me think about it for a bit",
    ]) {
      expect((await confirm(said)).yesNo, said).toBeNull();
    }
    // rule-based yes, and a short plain affirmation the rules do not know, are accepted
    for (const said of ["Yes, that's right", "yes", "sounds right", "sounds good to me"]) {
      expect((await confirm(said)).yesNo, said).toBe(true);
    }
  });

  it("resolveConfirmation: rule 'no' wins, a model 'no' wins over a 'yes', 'true' needs agreement, no tool leaves it to the rules", () => {
    expect(resolveConfirmation("no that is wrong", "en", true)).toBe(false);
    expect(resolveConfirmation("yes", "en", false)).toBe(false);
    expect(resolveConfirmation("yes", "en", true)).toBe(true);
    expect(resolveConfirmation("hmm what is normal for me?", "en", true)).toBeNull();
    expect(resolveConfirmation("hmm what is normal for me", "en", true)).toBeNull(); // more than four words
    expect(resolveConfirmation("all fine 5", "en", true)).toBeNull(); // a digit
    expect(resolveConfirmation("hmm", "en", undefined)).toBeNull();
    expect(resolveConfirmation("yes", "en", undefined)).toBe(true);
    expect(resolveConfirmation("тийм", "mn", true)).toBe(true);
  });

  it("in the pipeline a model 'confirmed' to an unrelated question does not confirm the check-in", async () => {
    const id = checkInId;
    for (const say of ["hello", "I'm fine", "let's start", "6 hours", "4", "no", "120 over 80", "70", "36.6", "95", "2300 ml", "45 minutes", "sharp", "3", "nothing"]) {
      await playTurn("bat", id, say);
    }
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    const { client } = fakeClient([message("tool_use", [tool("tu_f", "finish_confirmation", { confirmed: true })])]);
    const events = await playTurn("bat", id, "hmm what does my blood pressure usually look like?", { agent: new ClaudeAgent({ client }) });
    expect(eventsOf(events, "summary")).toEqual([]);
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");
    expect((await getCheckIn("bat", id)).confirmedAt).toBeNull();
    expect((await getCheckIn("bat", id)).summaryJson).toBeNull();
    expect((await listAlerts("bat")).filter((a) => a.checkInId === id)).toEqual([]);
    expect(assistantText(events)).toMatch(/is everything correct/i);
  });

  it("a value that is already recorded and said again is reported as restated, not as a rejected proposal", async () => {
    const { client } = fakeClient([
      message("tool_use", [text("Noted."), tool("tu_r", "record_measurement", { key: "sleep_hours", value: 8, unit: "h", source_text: "8 hours", confidence: 0.9 })]),
      message("end_turn", [text("Noted. How is your mood, from 1 to 5?")]),
    ]);
    const { args } = argsFor("KPI_CAPTURE", "actually I slept 8 hours", {
      ctx: { ...initialCtx(), state: "KPI_CAPTURE", proposed: true, filled: ["sleep_hours"] },
      expected: "mood",
      recorded: { sleep_hours: 6 },
      validate: (name, input) =>
        executeTool(toolContext("bat", checkInId, "KPI_CAPTURE", "actually I slept 8 hours", { dryRun: true, filled: new Set(["sleep_hours"]) }), name, input),
    });
    const decision = await new ClaudeAgent({ client }).decide(args);
    expect(decision.restated).toEqual(["sleep_hours"]);
    expect(decision.rejected).toBeUndefined();
    expect(decision.records).toEqual([]);
  });

  it("calls that are illegal in the state are refused through the shared validator", async () => {
    const { client } = fakeClient([
      message("tool_use", [tool("tu_x", "correct_measurement", { key: "sleep_hours", value: 6 })]),
      message("end_turn", [text("Let's finish the questions first.")]),
    ]);
    const d = await new ClaudeAgent({ client }).decide(argsFor("KPI_CAPTURE", "change my sleep to 6 hours").args);
    expect(d.correction).toBeUndefined();
    expect(d.replyText).toBe("Let's finish the questions first.");
  });
});

/* ───────────── failures ───────────── */

describe("ClaudeAgent failures throw LlmUnavailable", () => {
  it("refusal: thrown before any tool is looked at", async () => {
    const { client } = fakeClient([message("refusal", [text("I can't help with that."), sleepCall()])]);
    const { args, validated } = argsFor("KPI_CAPTURE", "I slept 6 hours");
    await expect(new ClaudeAgent({ client }).decide(args)).rejects.toMatchObject({ name: "LlmUnavailable", reason: "refusal" });
    expect(validated).toEqual([]);
  });

  it("max_tokens: thrown before any tool is looked at (a truncated tool input is never run)", async () => {
    const { client } = fakeClient([message("max_tokens", [sleepCall()])]);
    const { args, validated } = argsFor("KPI_CAPTURE", "I slept 6 hours");
    await expect(new ClaudeAgent({ client }).decide(args)).rejects.toMatchObject({ reason: "max_tokens" });
    expect(validated).toEqual([]);
  });

  it("a refusal in the second call also throws", async () => {
    const { client } = fakeClient([message("tool_use", [sleepCall("t", 7, "6 hours")]), message("refusal", [])]);
    await expect(new ClaudeAgent({ client }).decide(argsFor("KPI_CAPTURE", "I slept 6 hours").args)).rejects.toBeInstanceOf(LlmUnavailable);
  });

  it("an API error becomes LlmUnavailable with the cause attached", async () => {
    const boom = new Error("529 overloaded");
    const { client } = fakeClient([boom]);
    const err = await new ClaudeAgent({ client }).decide(argsFor("SMALL_TALK", "hi").args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnavailable);
    expect((err as LlmUnavailable).cause).toBe(boom);
  });

  it("a call that never finishes times out", async () => {
    const hanging: LlmClient = { messages: { stream: () => ({ finalMessage: () => new Promise<Anthropic.Message>(() => {}) }) } };
    await expect(new ClaudeAgent({ client: hanging, timeoutMs: 30 }).decide(argsFor("SMALL_TALK", "hi").args)).rejects.toMatchObject({
      reason: expect.stringContaining("timeout"),
    });
  });

  it("no API key and no client: LlmUnavailable, nothing is sent", async () => {
    expect(getEnv().anthropicApiKey).toBeUndefined();
    await expect(new ClaudeAgent().decide(argsFor("SMALL_TALK", "hi").args)).rejects.toMatchObject({ name: "LlmUnavailable" });
  });

  it("an unexpected stop reason is not trusted", async () => {
    const { client } = fakeClient([message("pause_turn", [])]);
    await expect(new ClaudeAgent({ client }).decide(argsFor("SMALL_TALK", "hi").args)).rejects.toBeInstanceOf(LlmUnavailable);
  });
});

/* ───────────── the pipeline around the agent ───────────── */

function withReply(replyText: string | undefined, extra: Partial<Agent> = {}): Agent {
  const scripted = new ScriptedAgent();
  return {
    name: "claude",
    decide: async (a) => ({ ...(await scripted.decide(a)), replyText }),
    ...extra,
  };
}

describe("turn pipeline with a live agent", () => {
  it("falls back to the scripted agent for the turn on LlmUnavailable and emits a recoverable error event", async () => {
    const broken: Agent = { name: "claude", decide: async () => { throw new LlmUnavailable("timeout"); } };
    const events = await playTurn("bat", checkInId, "I'm fine, thanks", { agent: broken });
    const error = eventsOf(events, "error");
    expect(error).toHaveLength(1);
    expect(error[0]).toMatchObject({ code: "LLM_FAILED", recoverable: true });
    expect(assistantText(events).length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe("done");
    expect((await ctxOf("bat", checkInId)).state).toBe("SMALL_TALK");
  });

  it("uses the model's wording when it is sane, the template otherwise", async () => {
    const sane = await playTurn("bat", checkInId, "I'm fine, thanks", { agent: withReply("Good to hear, Bat.") });
    expect(assistantText(sane)).toBe("Good to hear, Bat.");

    const bad: Array<string | undefined> = [
      "x".repeat(300),
      "One. Two. Three sentences here.",
      "Your pulse is 142, which is fine.",
      "That could be a diagnosis of something.",
      "Lovely \u{1F600}",
      undefined,
    ];
    for (const reply of bad) {
      const id = await startCheckInFresh();
      const events = await playTurn("bat", id, "I'm fine, thanks", { agent: withReply(reply) });
      expect(assistantText(events), String(reply)).not.toBe(reply);
      expect(assistantText(events).length).toBeGreaterThan(0);
    }
  });

  async function toCapture(id: string): Promise<void> {
    for (const say of ["hello", "I'm fine", "let's start"]) await playTurn("bat", id, say);
  }

  it("model wording for a question is only the acknowledgement: the question asked is always the one the machine expects", async () => {
    await toCapture(checkInId);
    // sleep and mood are both recorded; the machine now expects symptoms, the model asks about mood again
    const events = await playTurn("bat", checkInId, "6 hours and mood 4", {
      agent: withReply("Thanks. And how is your mood today?"),
    });
    expect(eventsOf(events, "measurement").map((m) => m.key)).toEqual(["sleep_hours", "mood"]);
    expect(eventsOf(events, "state")[0].expectedQuestion).toBe("symptoms");
    const said = assistantText(events);
    expect(said).toBe("Thanks. Any headache, dizziness or nausea?");
    expect(said).not.toMatch(/mood/i);

    // an acknowledgement without a question is kept, followed by the expected question
    const next = await playTurn("bat", checkInId, "no", { agent: withReply("Good to know, thank you.") });
    expect(eventsOf(next, "state")[0].expectedQuestion).toBe("blood_pressure");
    expect(assistantText(next)).toBe("Good to know, thank you. What is your blood pressure?");

    // a reply that is nothing but a (wrong) question falls back to the template, which asks the expected one
    const wrong = await playTurn("bat", checkInId, "120 over 80", { agent: withReply("What is your mood?") });
    expect(eventsOf(wrong, "state")[0].expectedQuestion).toBe("heart_rate");
    expect(assistantText(wrong)).toBe("Got it, 120 over 80. What is your pulse?");
  });

  it("a skipped question keeps the 'add it when we confirm' notice even when the model supplies wording", async () => {
    await toCapture(checkInId);
    const agent = withReply("No worries. How is your mood from 1 to 5?");
    const first = await playTurn("bat", checkInId, "no idea really", { agent });
    // clarification: template, not the model. The first unclear answer is asked again gently (reask.ts); the
    // "didn't catch" line comes with the second one
    expect(assistantText(first)).toMatch(/say that once more/i);
    expect(assistantText(first)).not.toContain("No worries");
    const second = await playTurn("bat", checkInId, "I really don't know", { agent });
    expect(assistantText(second)).toMatch(/didn't catch that/i);
    const third = await playTurn("bat", checkInId, "still no idea", { agent });
    expect(eventsOf(third, "state")[0].expectedQuestion).toBe("mood");
    expect(assistantText(third)).toMatch(/add it when we confirm/i);
    expect(assistantText(third)).not.toContain("No worries");
    expect((await ctxOf("bat", checkInId)).skipped).toEqual(["sleep"]);
  });

  it("a model reply cannot replace the clarification of an unusable answer (it could ask for another value)", async () => {
    await toCapture(checkInId);
    const events = await playTurn("bat", checkInId, "I slept 20 hours", { agent: withReply("Great, what is your mood?") });
    // changed 2026-11-15: the range re-ask names what was heard (valueChecks.rangeReply)
    expect(assistantText(events)).toMatch(/I heard 20 hours, which is too high for sleep/i);
    expect(assistantText(events)).not.toMatch(/mood/i);
  });

  it("a proposal reply from the model must actually be a question", async () => {
    await playTurn("bat", checkInId, "hello");
    const statement = await playTurn("bat", checkInId, "I'm fine", { agent: withReply("Glad to hear that.") });
    expect(assistantText(statement)).toMatch(/shall we log today's measurements/i);
  });

  it("never lets the model word the read-back (it is built by code from the stored values)", async () => {
    const id = checkInId;
    await playTurn("bat", id, "I slept 6 hours, mood 4, pulse 68");
    const events = await playTurn("bat", id, "yes", { agent: withReply("Everything is perfect, 999 percent.") });
    expect(assistantText(events)).not.toContain("999");
  });

  it("applies the model's records through the same validation: a number that is not in the words is dropped", async () => {
    const liar: Agent = {
      name: "claude",
      decide: async () => ({
        records: [{ key: "heart_rate", value: 99, unit: "bpm", sourceText: "pulse is 68", confidence: 0.9 }],
        emotion: "neutral",
        startAnswer: "yes",
      }),
    };
    await playTurn("bat", checkInId, "hello there");
    await playTurn("bat", checkInId, "nice day");
    const events = await playTurn("bat", checkInId, "Yes my pulse is 68", { agent: liar });
    expect(eventsOf(events, "measurement")).toEqual([]);
    expect((await listMeasurements("bat", checkInId)).find((m) => m.key === "heart_rate")).toBeUndefined();
  });

  it("model-phrased summaries are used only when every numeral is in the findings", async () => {
    const play = async (phrase: string) => {
      const id = await startCheckInFresh();
      const agent = withReply(undefined, { phraseSummary: async () => phrase });
      for (const say of ["hello", "I'm fine thanks", "let's start"]) await playTurn("bat", id, say);
      for (const say of ["6 hours", "4", "no", "120 over 80", "70", "36.6", "95", "2300 ml", "45 minutes", "sharp", "3", "nothing", "yes"]) {
        const events = await playTurn("bat", id, say, { agent });
        const summary = eventsOf(events, "summary")[0]?.summary;
        if (summary) return summary;
      }
      throw new Error("no summary was produced");
    };
    const good = await play("Steady day, Bat. Readiness is on track.");
    expect(good.spoken.text.startsWith("Steady day, Bat. Readiness is on track.")).toBe(true);
    expect(good.spoken.text).toContain("Decision support, not a diagnosis.");

    const invented = await play("Your readiness is 7 out of 100, take 3 breaks.");
    expect(invented.spoken.text).not.toContain("take 3 breaks");
  });
});

/** a clean database and a new open check-in for Bat (earlier ids of the same test become invalid) */
async function startCheckInFresh(): Promise<string> {
  await freshSeededDb();
  setClockForTests(TEST_TODAY);
  return startCheckIn("bat", "en");
}

describe("sanity checks", () => {
  const base = { userText: "I slept 6 hours", recorded: { sleep_hours: 6 }, question: "mood" as const };

  it("isSaneReply: length, sentences, numerals, emojis and forbidden words", () => {
    expect(isSaneReply("Got it, 6 hours. How is your mood, from 1 to 5?", base)).toBe(true);
    expect(isSaneReply("Got it, 7 hours.", base)).toBe(false);
    expect(isSaneReply("One. Two. Three.", base)).toBe(false);
    expect(isSaneReply("a".repeat(281), base)).toBe(false);
    expect(isSaneReply("", base)).toBe(false);
    expect(isSaneReply("Take this medication.", base)).toBe(false);
    expect(isSaneReply("Nice \u{1F44D}", base)).toBe(false);
    expect(isSaneReply("Got it, 5.5 hours.", { ...base, recorded: { sleep_hours: 5.5 } })).toBe(true);
  });

  it("isSaneSummaryText: every numeral must come from the findings", () => {
    const findings = { overall: "yellow", readiness: 85, headline: { en: "x 85", mn: "y" }, findings: [], recommendations: [], redFlags: [], disclaimer: { en: "d", mn: "d" } } as unknown as SummaryFindings;
    expect(isSaneSummaryText("Readiness is 85.", findings)).toBe(true);
    expect(isSaneSummaryText("Readiness is 86.", findings)).toBe(false);
    expect(isSaneSummaryText("Take a dosage.", findings)).toBe(false);
  });
});

