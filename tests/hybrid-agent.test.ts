import { describe, expect, it } from "vitest";
import type { AgentArgs, AgentDecision, Agent } from "@/server/agent/agent";
import { HybridAgent, fastPathVerdict } from "@/server/agent/hybridAgent";
import { ScriptedAgent } from "@/server/agent/scriptedAgent";
import type { MachineCtx } from "@/server/agent/machine";
import type { CrewPublic, QuestionId } from "@/lib/types";

const crew: CrewPublic = { id: "alex", name: "Alex", role: "Commander", preferredLanguage: "en", mascotVariant: 2, avatarSeed: "alex-2" };

function ctx(state: MachineCtx["state"], extra: Partial<MachineCtx> = {}): MachineCtx {
  return { state, smallTalkTurns: 1, proposed: true, clarifyCount: {}, skipped: [], filled: [], ...extra } as MachineCtx;
}

function args(state: MachineCtx["state"], text: string, expected: QuestionId | null, extra: Partial<MachineCtx> = {}): AgentArgs {
  return {
    crew,
    ctx: ctx(state, extra),
    text,
    lang: "en",
    expected,
    recorded: {},
    history: [],
    validate: () => ({ ok: true }) as never,
  };
}

class CountingLive implements Agent {
  readonly name = "claude" as const;
  calls = 0;
  async decide(): Promise<AgentDecision> {
    this.calls += 1;
    return { records: [], emotion: "happy", replyText: "from the model" };
  }
}

describe("fastPathVerdict", () => {
  const rules = new ScriptedAgent();
  const verdict = async (a: AgentArgs) => fastPathVerdict(a, await rules.decide(a));

  it("takes clear answers to the expected question without the model", async () => {
    expect((await verdict(args("KPI_CAPTURE", "I slept about six and a half hours.", "sleep"))).fast).toBe(true);
    expect((await verdict(args("KPI_CAPTURE", "120 over 80", "blood_pressure"))).fast).toBe(true);
    expect((await verdict(args("KPI_CAPTURE", "No headache, no dizziness, no nausea.", "symptoms"))).fast).toBe(true);
    expect((await verdict(args("KPI_CAPTURE", "nothing to add", "day_note"))).fast).toBe(true);
  });

  it("sends unclear, partial and out-of-range answers to the model", async () => {
    expect((await verdict(args("KPI_CAPTURE", "hmm, not sure, maybe later", "sleep"))).fast).toBe(false);
    expect((await verdict(args("KPI_CAPTURE", "my pulse is 301", "heart_rate"))).fast).toBe(false);
    expect((await verdict(args("KPI_CAPTURE", "about 120", "blood_pressure"))).fast).toBe(false);
  });

  it("keeps small talk with the model but lets an unmistakable start through", async () => {
    expect((await verdict(args("SMALL_TALK", "I'm a bit tired today.", null, { proposed: false }))).fast).toBe(false);
    expect((await verdict(args("SMALL_TALK", "Yes, let's start.", null, { proposed: true }))).fast).toBe(true);
  });

  it("at the read-back: a clear yes or a clear correction is instant, a bare no goes to the model", async () => {
    expect((await verdict(args("CONFIRM", "Yes, that's right.", null))).fast).toBe(true);
    expect((await verdict(args("CONFIRM", "No, I slept seven hours.", null))).fast).toBe(true);
    expect((await verdict(args("CONFIRM", "No.", null))).fast).toBe(false);
  });
});

describe("HybridAgent", () => {
  it("calls the live model only when the rules are not enough", async () => {
    const live = new CountingLive();
    const agent = new HybridAgent(live);

    const fast = await agent.decide(args("KPI_CAPTURE", "Pulse is 68.", "heart_rate"));
    expect(live.calls).toBe(0);
    expect(fast.llmMs).toBe(0);
    expect(fast.records.map((r) => r.key)).toEqual(["heart_rate"]);

    const slow = await agent.decide(args("SMALL_TALK", "Honestly a long day, the experiment ran late.", null, { proposed: false }));
    expect(live.calls).toBe(1);
    expect(slow.replyText).toBe("from the model");
  });

  it("delegates summary phrasing to the live agent when it has one", async () => {
    const live = new CountingLive();
    expect(await new HybridAgent(live).phraseSummary({ findings: {} as never, lang: "en", crew })).toBeNull();
  });
});
