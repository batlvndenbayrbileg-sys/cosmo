import type { CrewPublic, Lang, SummaryFindings, TurnRow } from "@/lib/types";
import { LlmUnavailable, type Agent, type AgentArgs, type AgentDecision, type CompanionReplyArgs } from "./agent";
import type { ResultsFacts } from "./resultsFacts";

/**
 * Live models in order of preference, used only when a local model is configured (localLlm.ts):
 *
 *   Claude (when ANTHROPIC_API_KEY is set) -> local model -> rules/templates
 *
 * decide(): the first tier that does not throw LlmUnavailable answers; when every tier is unavailable it throws
 * LlmUnavailable and the turn pipeline falls back to the scripted agent exactly as before. The wording methods return
 * the first non-null text; null means "use the template". Every text still passes the same sanity gates in turn.ts,
 * whichever tier wrote it: this class only chooses who is asked, never what is accepted.
 *
 * A refusal is final: when a tier refuses (stop_reason "refusal"; for the wording methods the Claude tier is built
 * with surfaceRefusals so it throws instead of returning null), no later tier is asked and the scripted agent and the
 * templates answer, exactly as before the local model existed.
 *
 * A tier that just failed on connectivity (API error or timeout) is skipped for CONNECTIVITY_COOLDOWN_MS, so an
 * offline machine does not wait for Claude's timeout on every turn before the local model is asked. The last tier is
 * never skipped. Logs name the tier only, never anything the astronaut said.
 */

export type TierName = "claude" | "local";

export interface Tier {
  tier: TierName;
  agent: Agent;
}

export const CONNECTIVITY_COOLDOWN_MS = 60_000;

function isConnectivity(reason: string): boolean {
  return reason === "API call failed" || reason.startsWith("timeout");
}

export function logTier(tier: TierName | "rules", what: string): void {
  console.info(`[aegis] ${what} answered by ${tier}`);
}

function logRefusal(tier: TierName, what: string): void {
  console.info(`[aegis] ${what}: ${tier} refused, answered by rules (later tiers not asked)`);
}

export class TieredAgent implements Agent {
  readonly name = "claude" as const;
  private readonly skipUntil = new Map<TierName, number>();

  constructor(
    private readonly tiers: readonly Tier[],
    private readonly now: () => number = Date.now,
  ) {}

  /** the tiers to ask now: a recently unreachable one is left out, except the last */
  private active(): Tier[] {
    const t = this.now();
    return this.tiers.filter((tier, i) => i === this.tiers.length - 1 || (this.skipUntil.get(tier.tier) ?? 0) <= t);
  }

  async decide(args: AgentArgs): Promise<AgentDecision> {
    const reasons: string[] = [];
    let lastCause: unknown;
    for (const { tier, agent } of this.active()) {
      try {
        const decision = await agent.decide(args);
        this.skipUntil.delete(tier);
        logTier(tier, "turn");
        return decision;
      } catch (err) {
        if (!(err instanceof LlmUnavailable)) throw err;
        if (err.reason === "refusal") {
          // final: the scripted agent and the templates answer; a later (weaker) tier is never asked instead
          logRefusal(tier, "turn");
          throw err;
        }
        reasons.push(`${tier}: ${err.reason}`);
        lastCause = err.cause;
        if (isConnectivity(err.reason)) this.skipUntil.set(tier, this.now() + CONNECTIVITY_COOLDOWN_MS);
      }
    }
    logTier("rules", "turn");
    throw new LlmUnavailable(reasons.join("; ") || "no live tier", lastCause === undefined ? undefined : { cause: lastCause });
  }

  private async firstText(what: string, ask: (agent: Agent) => Promise<string | null> | null): Promise<string | null> {
    for (const { tier, agent } of this.active()) {
      let out: string | null = null;
      try {
        out = await (ask(agent) ?? null);
      } catch (err) {
        if (err instanceof LlmUnavailable && err.reason === "refusal") {
          // a refusal (ClaudeAgent with surfaceRefusals) ends at the template, never at the next tier
          logRefusal(tier, what);
          return null;
        }
        out = null;
      }
      if (out) {
        logTier(tier, what);
        return out;
      }
    }
    logTier("rules", what);
    return null;
  }

  phraseSummary(args: { findings: SummaryFindings; lang: Lang; crew: CrewPublic }): Promise<string | null> {
    return this.firstText("summary", (a) => (a.phraseSummary ? a.phraseSummary(args) : null));
  }

  answerAboutResults(args: { facts: ResultsFacts; question: string; lang: Lang; history: TurnRow[] }): Promise<string | null> {
    return this.firstText("results question", (a) => (a.answerAboutResults ? a.answerAboutResults(args) : null));
  }

  companionReply(args: CompanionReplyArgs): Promise<string | null> {
    return this.firstText("companion reply", (a) => (a.companionReply ? a.companionReply(args) : null));
  }
}
