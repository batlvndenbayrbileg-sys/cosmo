import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrewPublic } from "@/lib/types";
import { LlmUnavailable, type Agent, type AgentArgs } from "@/server/agent/agent";
import { ClaudeAgent, type LlmClient } from "@/server/agent/claudeAgent";
import { HybridAgent } from "@/server/agent/hybridAgent";
import { createLocalAgent, parseLocalMessage, toLocalBody } from "@/server/agent/localLlm";
import { DEFAULT_LOCAL_TIMEOUT_MS, localLlmStatus, type LocalLlmConfig } from "@/server/agent/localLlmConfig";
import { initialCtx, type MachineCtx } from "@/server/agent/machine";
import { ScriptedAgent } from "@/server/agent/scriptedAgent";
import { CONNECTIVITY_COOLDOWN_MS, TieredAgent, type Tier } from "@/server/agent/tieredAgent";
import { executeTool } from "@/server/agent/tools";
import { setClockForTests } from "@/server/clock";
import { getCrewPublic } from "@/server/db/repos/crew";
import { parseEnv } from "@/server/env";
import { assistantText, eventsOf, playTurn, startCheckIn, toolContext } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/* ───────────── fakes (no real Ollama exists on this machine: fetch is always mocked) ───────────── */

const LOCAL: LocalLlmConfig = { baseUrl: "http://localhost:11434", model: "qwen-test:8b", timeoutMs: 2000 };

function message(stopReason: string, text: string): Record<string, unknown> {
  return {
    id: "msg_local",
    type: "message",
    role: "assistant",
    model: LOCAL.model,
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** stubs the global fetch with a queue of responses (or a function), records every request */
function stubFetch(responses: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const queue = [...responses];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const next = queue.shift();
    if (next === undefined) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(init ?? {});
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

/** a Claude whose every call fails like an unreachable API */
function claudeDown(): { agent: ClaudeAgent; calls: () => number } {
  let n = 0;
  const client: LlmClient = {
    messages: {
      stream() {
        n += 1;
        return { finalMessage: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { status: undefined }); } };
      },
    },
  };
  return { agent: new ClaudeAgent({ client }), calls: () => n };
}

/** a Claude that refuses every request (stop_reason "refusal"), built as defaultAgent() builds the Claude tier */
function claudeRefuses(): { agent: ClaudeAgent; calls: () => number } {
  let n = 0;
  const client: LlmClient = {
    messages: {
      stream() {
        n += 1;
        return { finalMessage: async () => message("refusal", "") as unknown as Anthropic.Message };
      },
    },
  };
  return { agent: new ClaudeAgent({ client, surfaceRefusals: true }), calls: () => n };
}

function claudeSays(text: string): { agent: ClaudeAgent; calls: () => number } {
  let n = 0;
  const client: LlmClient = {
    messages: {
      stream() {
        n += 1;
        return { finalMessage: async () => message("end_turn", text) as unknown as Anthropic.Message };
      },
    },
  };
  return { agent: new ClaudeAgent({ client }), calls: () => n };
}

let checkInId: string;
let crew: CrewPublic;
let info: { mock: { calls: unknown[][] } };

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
  checkInId = await startCheckIn("bat", "en");
  crew = await getCrewPublic("bat");
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setClockForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function smallTalkArgs(utterance: string): AgentArgs {
  const ctx: MachineCtx = { ...initialCtx(), state: "SMALL_TALK", proposed: false, smallTalkTurns: 1 };
  return {
    crew,
    ctx,
    text: utterance,
    lang: "en",
    expected: null,
    recorded: {},
    history: [],
    validate: (name, input) => executeTool(toolContext("bat", checkInId, "SMALL_TALK", utterance, { dryRun: true }), name, input),
  };
}

const logged = () => info.mock.calls.map((c) => String(c[0]));

/* ───────────── configuration ───────────── */

describe("local model configuration", () => {
  it("is off when both variables are unset (as on Vercel)", () => {
    const env = parseEnv({ DEMO_MODE: "live", ANTHROPIC_API_KEY: "k" });
    expect(env.localLlmUrl).toBeUndefined();
    expect(env.localLlmModel).toBeUndefined();
    expect(env.localLlmTimeoutMs).toBeUndefined();
    expect(env.localLlmAllowRemote).toBe(false);
    expect(localLlmStatus(env)).toEqual({ kind: "off" });
    // blank lines from .env.example count as unset
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: " ", LOCAL_LLM_MODEL: "" }))).toEqual({ kind: "off" });
  });

  it("accepts this machine only: localhost, 127.0.0.1 and [::1]", () => {
    for (const url of ["http://localhost:11434", "http://127.0.0.1:11434/", "http://[::1]:11434", "http://LOCALHOST:11434"]) {
      const s = localLlmStatus(parseEnv({ LOCAL_LLM_URL: url, LOCAL_LLM_MODEL: "m" }));
      expect(s.kind, url).toBe("on");
      if (s.kind === "on") {
        expect(s.config.baseUrl.endsWith("/")).toBe(false);
        expect(s.config.timeoutMs).toBe(DEFAULT_LOCAL_TIMEOUT_MS);
      }
    }
  });

  it("refuses a non-local host unless LOCAL_LLM_ALLOW_REMOTE=1", () => {
    for (const url of ["http://192.168.1.20:11434", "https://ollama.example.com", "http://localhost.evil.test:11434", "http://127.0.0.2:11434"]) {
      expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: url, LOCAL_LLM_MODEL: "m" })).kind, url).toBe("refused");
    }
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: "http://192.168.1.20:11434", LOCAL_LLM_MODEL: "m", LOCAL_LLM_ALLOW_REMOTE: "1" })).kind).toBe("on");
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: "http://192.168.1.20:11434", LOCAL_LLM_MODEL: "m", LOCAL_LLM_ALLOW_REMOTE: "yes" })).kind).toBe("refused");
  });

  it("refuses half a configuration, a non-URL and a non-http scheme; reads the timeout", () => {
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: "http://localhost:11434" })).kind).toBe("refused");
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_MODEL: "m" })).kind).toBe("refused");
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: "not a url", LOCAL_LLM_MODEL: "m" })).kind).toBe("refused");
    expect(localLlmStatus(parseEnv({ LOCAL_LLM_URL: "file://localhost/x", LOCAL_LLM_MODEL: "m" })).kind).toBe("refused");
    const s = localLlmStatus(parseEnv({ LOCAL_LLM_URL: "http://localhost:11434", LOCAL_LLM_MODEL: "m", LOCAL_LLM_TIMEOUT_MS: "45000" }));
    expect(s.kind === "on" && s.config.timeoutMs).toBe(45000);
    const bad = localLlmStatus(parseEnv({ LOCAL_LLM_URL: "http://localhost:11434", LOCAL_LLM_MODEL: "m", LOCAL_LLM_TIMEOUT_MS: "soon" }));
    expect(bad.kind === "on" && bad.config.timeoutMs).toBe(DEFAULT_LOCAL_TIMEOUT_MS);
  });
});

/* ───────────── defaultAgent() wiring ───────────── */

describe("defaultAgent() wiring", () => {
  async function wiringFor(source: Record<string, string>) {
    const actual = await vi.importActual<typeof import("@/server/env")>("@/server/env");
    const env = actual.parseEnv(source);
    vi.resetModules();
    vi.doMock("@/server/env", () => ({ ...actual, getEnv: () => env }));
    const turn = await import("@/server/agent/turn");
    const hybrid = await import("@/server/agent/hybridAgent");
    const claude = await import("@/server/agent/claudeAgent");
    const scripted = await import("@/server/agent/scriptedAgent");
    const tiered = await import("@/server/agent/tieredAgent");
    return { agent: turn.defaultAgent(), again: turn.defaultAgent(), hybrid, claude, scripted, tiered };
  }
  const liveOf = (a: Agent) => (a as unknown as { live: Agent }).live;
  const tiersOf = (a: Agent) => (a as unknown as { tiers: Tier[] }).tiers.map((t) => t.tier);

  afterEach(() => {
    vi.doUnmock("@/server/env");
    vi.resetModules();
  });

  it("unset: exactly as before - Hybrid(Claude) with a key, scripted without, no fetch", async () => {
    const { fn } = stubFetch([]);
    const withKey = await wiringFor({ DEMO_MODE: "live", ANTHROPIC_API_KEY: "sk-test" });
    expect(withKey.agent).toBeInstanceOf(withKey.hybrid.HybridAgent);
    expect(liveOf(withKey.agent)).toBeInstanceOf(withKey.claude.ClaudeAgent);
    expect(liveOf(withKey.agent)).not.toBeInstanceOf(withKey.tiered.TieredAgent);
    expect(withKey.again).toBe(withKey.agent);

    const noKey = await wiringFor({ DEMO_MODE: "live" });
    expect(noKey.agent).toBeInstanceOf(noKey.scripted.ScriptedAgent);

    const scriptedMode = await wiringFor({ DEMO_MODE: "scripted", ANTHROPIC_API_KEY: "sk-test" });
    expect(scriptedMode.agent).toBeInstanceOf(scriptedMode.scripted.ScriptedAgent);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a refused (non-local) URL leaves the wiring unchanged", async () => {
    const w = await wiringFor({ DEMO_MODE: "live", ANTHROPIC_API_KEY: "sk-test", LOCAL_LLM_URL: "http://10.0.0.5:11434", LOCAL_LLM_MODEL: "m" });
    expect(liveOf(w.agent)).toBeInstanceOf(w.claude.ClaudeAgent);
    const noKey = await wiringFor({ DEMO_MODE: "live", LOCAL_LLM_URL: "https://ollama.example.com", LOCAL_LLM_MODEL: "m" });
    expect(noKey.agent).toBeInstanceOf(noKey.scripted.ScriptedAgent);
  });

  it("configured: Claude then local with a key, local alone without one; scripted mode ignores it", async () => {
    const local = { LOCAL_LLM_URL: "http://localhost:11434", LOCAL_LLM_MODEL: "m" };
    const both = await wiringFor({ DEMO_MODE: "live", ANTHROPIC_API_KEY: "sk-test", ...local });
    expect(both.agent).toBeInstanceOf(both.hybrid.HybridAgent);
    expect(liveOf(both.agent)).toBeInstanceOf(both.tiered.TieredAgent);
    expect(tiersOf(liveOf(both.agent))).toEqual(["claude", "local"]);
    expect(both.again).toBe(both.agent);

    const onlyLocal = await wiringFor({ DEMO_MODE: "live", ...local });
    expect(tiersOf(liveOf(onlyLocal.agent))).toEqual(["local"]);

    const scriptedMode = await wiringFor({ DEMO_MODE: "scripted", ...local });
    expect(scriptedMode.agent).toBeInstanceOf(scriptedMode.scripted.ScriptedAgent);
  });
});

/* ───────────── the request and the response ───────────── */

describe("local request and response", () => {
  it("sends Ollama's Anthropic-compatible request: same prompt and tools, no caching, no tool_choice, not streamed", async () => {
    const { calls } = stubFetch([okJson(message("end_turn", "Good to hear."))]);
    const d = await createLocalAgent(LOCAL).decide(smallTalkArgs("I'm fine, thanks"));
    expect(d.replyText).toBe("Good to hear.");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:11434/v1/messages");
    const body = calls[0].body;
    expect(body.model).toBe(LOCAL.model);
    expect(body.stream).toBe(false);
    expect(body.tool_choice).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("cache_control");
    expect(JSON.stringify(body.tools)).not.toContain("strict");
    expect((body.tools as unknown[]).length).toBe(6);
    // the directive rides in the user turn, never as a mid-conversation system message
    for (const m of body.messages as Array<{ role: string }>) expect(m.role).not.toBe("system");
  });

  it("toLocalBody keeps everything else unchanged", () => {
    const body = {
      model: "claude-x",
      max_tokens: 700,
      system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }],
      tools: [],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: "hi" }],
    } as unknown as Anthropic.MessageStreamParams;
    expect(toLocalBody(body, "m")).toEqual({
      model: "m",
      max_tokens: 700,
      system: [{ type: "text", text: "S" }],
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "disabled" },
      stream: false,
    });
  });

  it("switches thinking off, and a reply of a thinking block plus a text block is accepted (text only is used)", async () => {
    const reply = {
      ...message("end_turn", ""),
      content: [
        { type: "thinking", thinking: "The astronaut says they are fine; acknowledge briefly.", signature: "" },
        { type: "text", text: "Good to hear." },
      ],
    };
    const { calls } = stubFetch([okJson(reply)]);
    const d = await createLocalAgent(LOCAL).decide(smallTalkArgs("I'm fine, thanks"));
    expect(calls[0].body.thinking).toEqual({ type: "disabled" });
    expect(d.replyText).toBe("Good to hear.");
  });

  it("parseLocalMessage refuses anything that is not a Message", () => {
    expect(() => parseLocalMessage(null)).toThrow();
    expect(() => parseLocalMessage({ content: "hi", stop_reason: "end_turn" })).toThrow();
    expect(() => parseLocalMessage({ content: [{ type: "text" }], stop_reason: "end_turn" })).toThrow();
    expect(() => parseLocalMessage({ content: [{ type: "tool_use", id: "t", name: "x", input: "oops" }], stop_reason: "tool_use" })).toThrow();
    expect(() => parseLocalMessage({ content: [{ type: "image" }], stop_reason: "end_turn" })).toThrow();
    expect(() => parseLocalMessage({ content: [{ type: "text", text: "ok" }] })).toThrow();
    expect(parseLocalMessage(message("end_turn", "ok")).content).toHaveLength(1);
  });
});

/* ───────────── the chain: Claude -> local -> rules ───────────── */

describe("Claude -> local -> rules", () => {
  it("Claude answers: the local model is never called", async () => {
    const { fn } = stubFetch([]);
    const claude = claudeSays("Glad to hear it.");
    const agent = new TieredAgent([{ tier: "claude", agent: claude.agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]);
    const d = await agent.decide(smallTalkArgs("I'm fine, thanks"));
    expect(d.replyText).toBe("Glad to hear it.");
    expect(fn).not.toHaveBeenCalled();
    expect(await agent.companionReply({ crew, ctx: initialCtx(), turn: 1, text: "rough day", lang: "en", history: [] })).toBe("Glad to hear it.");
    expect(fn).not.toHaveBeenCalled();
    expect(logged()).toContain("[aegis] turn answered by claude");
  });

  it("Claude unavailable, local answers: the local decision is used and the tier is logged without user content", async () => {
    const { calls } = stubFetch([okJson(message("end_turn", "Thanks for telling me."))]);
    const claude = claudeDown();
    const agent = new TieredAgent([{ tier: "claude", agent: claude.agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]);
    const d = await agent.decide(smallTalkArgs("my secret worry about the airlock"));
    expect(claude.calls()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(d.replyText).toBe("Thanks for telling me.");
    expect(logged()).toContain("[aegis] turn answered by local");
    for (const line of logged()) expect(line).not.toContain("airlock");
  });

  it("no key: the local model alone", async () => {
    stubFetch([okJson(message("end_turn", "Nice."))]);
    const agent = new TieredAgent([{ tier: "local", agent: createLocalAgent(LOCAL) }]);
    expect((await agent.decide(smallTalkArgs("hello"))).replyText).toBe("Nice.");
  });

  it("local HTTP error, timeout, bad JSON or a malformed message: LlmUnavailable, so the rules take over", async () => {
    const hanging = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const cases: Array<[string, Response | ((init: RequestInit) => Promise<Response>)]> = [
      ["http 500", new Response("boom", { status: 500 })],
      ["timeout", hanging],
      ["bad json", new Response("{not json", { status: 200 })],
      ["not a message", okJson({ message: { role: "assistant", content: "hi" } })],
      ["truncated", okJson(message("max_tokens", "Thanks for"))],
    ];
    for (const [label, response] of cases) {
      stubFetch([response]);
      const agent = new TieredAgent([
        { tier: "claude", agent: claudeDown().agent },
        { tier: "local", agent: createLocalAgent({ ...LOCAL, timeoutMs: 50 }) },
      ]);
      const err = await agent.decide(smallTalkArgs("hello")).catch((e: unknown) => e);
      expect(err, label).toBeInstanceOf(LlmUnavailable);
      expect((err as LlmUnavailable).reason, label).toMatch(/^claude: .*; local: /);
    }
    expect(logged()).toContain("[aegis] turn answered by rules");
  });

  it("in the pipeline a failing local model falls back to the rules for the turn", async () => {
    stubFetch([new Response("boom", { status: 503 })]);
    const agent = new HybridAgent(new TieredAgent([{ tier: "claude", agent: claudeDown().agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]));
    const events = await playTurn("bat", checkInId, "I'm fine, thanks", { agent });
    expect(eventsOf(events, "error")[0]).toMatchObject({ code: "LLM_FAILED", recoverable: true });
    expect(assistantText(events).length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe("done");
  });

  it("local text passes the same sanity gates: sane wording is used, anything else gets the template", async () => {
    const pipelineAgent = () =>
      new HybridAgent(new TieredAgent([{ tier: "claude", agent: claudeDown().agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]));

    stubFetch([okJson(message("end_turn", "Good to hear, Bat."))]);
    expect(assistantText(await playTurn("bat", checkInId, "I'm fine, thanks", { agent: pipelineAgent() }))).toBe("Good to hear, Bat.");

    const bad = [
      "That could be a diagnosis of something.",
      "Your pulse is 142, which is fine.",
      "One. Two. Three sentences here.",
      "Lovely \u{1F600}",
      "x".repeat(300),
    ];
    for (const reply of bad) {
      await freshSeededDb();
      const id = await startCheckIn("bat", "en");
      stubFetch([okJson(message("end_turn", reply))]);
      const events = await playTurn("bat", id, "I'm fine, thanks", { agent: pipelineAgent() });
      expect(eventsOf(events, "error"), reply).toEqual([]);
      expect(assistantText(events), reply).not.toBe(reply);
      expect(assistantText(events).length).toBeGreaterThan(0);
    }
  });

  it("a crisis turn never asks any model: the reply is the code template", async () => {
    const { fn } = stubFetch([]);
    const agent = new HybridAgent(new TieredAgent([{ tier: "local", agent: createLocalAgent(LOCAL) }]));
    const events = await playTurn("bat", checkInId, "I want to kill myself", { agent });
    expect(fn).not.toHaveBeenCalled();
    expect(assistantText(events).length).toBeGreaterThan(0);
  });

  it("an unreachable Claude is skipped for a while, so the local model answers without waiting for it", async () => {
    stubFetch([okJson(message("end_turn", "One.")), okJson(message("end_turn", "Two.")), okJson(message("end_turn", "Three."))]);
    const claude = claudeDown();
    let t = 1_000_000;
    const agent = new TieredAgent([{ tier: "claude", agent: claude.agent }, { tier: "local", agent: createLocalAgent(LOCAL) }], () => t);
    await agent.decide(smallTalkArgs("hello"));
    await agent.decide(smallTalkArgs("hello"));
    expect(claude.calls()).toBe(1);
    t += CONNECTIVITY_COOLDOWN_MS + 1;
    expect((await agent.decide(smallTalkArgs("hello"))).replyText).toBe("Three.");
    expect(claude.calls()).toBe(2);
  });

  it("a Claude refusal is final for a turn: the local model is never asked and the rules' template is spoken", async () => {
    // the template the rules alone give for this turn
    const scriptedId = await startCheckIn("bat", "en");
    const template = assistantText(await playTurn("bat", scriptedId, "I'm fine, thanks", { agent: new ScriptedAgent() }));
    expect(template.length).toBeGreaterThan(0);

    await freshSeededDb();
    const id = await startCheckIn("bat", "en");
    const { fn } = stubFetch([okJson(message("end_turn", "Local words."))]);
    const claude = claudeRefuses();
    const agent = new HybridAgent(new TieredAgent([{ tier: "claude", agent: claude.agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]));
    const events = await playTurn("bat", id, "I'm fine, thanks", { agent });
    expect(claude.calls()).toBe(1);
    expect(fn).not.toHaveBeenCalled();
    expect(eventsOf(events, "error")[0]).toMatchObject({ code: "LLM_FAILED" });
    expect(assistantText(events)).toBe(template);
    expect(logged()).toContain("[aegis] turn: claude refused, answered by rules (later tiers not asked)");
  });

  it("a Claude refusal is final for the wording methods too: null (the template), the local model is never asked", async () => {
    const { fn } = stubFetch([okJson(message("end_turn", "Local words."))]);
    const claude = claudeRefuses();
    const agent = new TieredAgent([{ tier: "claude", agent: claude.agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]);
    expect(await agent.companionReply({ crew, ctx: initialCtx(), turn: 1, text: "rough day", lang: "en", history: [] })).toBeNull();
    expect(await agent.answerAboutResults({ facts: {} as never, question: "how did I do?", lang: "en", history: [] })).toBeNull();
    expect(claude.calls()).toBe(2);
    expect(fn).not.toHaveBeenCalled();
    // and on its own (no surfaceRefusals), ClaudeAgent keeps returning null on a refusal, as before
    const plain = new ClaudeAgent({ client: { messages: { stream: () => ({ finalMessage: async () => message("refusal", "") as unknown as Anthropic.Message }) } } });
    expect(await plain.companionReply({ crew, ctx: initialCtx(), turn: 1, text: "rough day", lang: "en", history: [] })).toBeNull();
  });

  it("wording methods: Claude null -> local text; both null -> null (the template)", async () => {
    stubFetch([okJson(message("end_turn", "I'm here with you.")), new Response("down", { status: 500 })]);
    const agent = new TieredAgent([{ tier: "claude", agent: claudeDown().agent }, { tier: "local", agent: createLocalAgent(LOCAL) }]);
    const args = { crew, ctx: initialCtx(), turn: 1, text: "rough day", lang: "en" as const, history: [] };
    expect(await agent.companionReply(args)).toBe("I'm here with you.");
    expect(await agent.companionReply(args)).toBeNull();
    expect(logged()).toContain("[aegis] companion reply answered by local");
    expect(logged()).toContain("[aegis] companion reply answered by rules");
  });
});
